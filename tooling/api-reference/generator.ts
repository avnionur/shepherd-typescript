import { lstat, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { ClassElement, Node, SourceFile, TypeElement } from "typescript/unstable/ast";
import {
    isCallSignatureDeclaration,
    isClassDeclaration,
    isClassStaticBlockDeclaration,
    isConstructorDeclaration,
    isConstructSignatureDeclaration,
    isGetAccessorDeclaration,
    isIndexSignatureDeclaration,
    isInterfaceDeclaration,
    isMethodDeclaration,
    isMethodSignatureDeclaration,
    isPropertyDeclaration,
    isPropertySignatureDeclaration,
    isSemicolonClassElement,
    isSetAccessorDeclaration,
    isVariableDeclaration,
    isVariableStatement,
} from "typescript/unstable/ast/is";
import {
    API,
    type Checker,
    type JSDocTagInfo,
    type Project,
    SymbolFlags,
    type Symbol as TypeScriptSymbol,
} from "typescript/unstable/sync";

/** Repository paths used to generate, write, or check the public API reference. */
export type ApiReferenceOptions = {
    /** Optional generator-configuration path. */
    readonly configurationPath?: string;
    /** Optional package-manifest path. */
    readonly packagePath?: string;
    /** Optional repository root; defaults to this package root. */
    readonly repositoryRoot?: string;
};

type EntryConfiguration = {
    readonly authority: string;
    readonly summary: string;
    readonly title: string;
};

type ForbiddenPattern = {
    readonly flags: string;
    readonly label: string;
    readonly pattern: string;
};

type ApiReferenceConfiguration = {
    readonly artifact: string;
    readonly declarationRoot: string;
    readonly entries: Readonly<Record<string, EntryConfiguration>>;
    readonly forbiddenDeclarationPatterns: readonly ForbiddenPattern[];
    readonly forbiddenPatterns: readonly ForbiddenPattern[];
    readonly runtime: string;
};

type PackageEntry = {
    readonly import: string;
    readonly types: string;
};

type PackageManifest = {
    readonly engines: { readonly node: string };
    readonly exports: Readonly<Record<string, PackageEntry>>;
    readonly name: string;
    readonly version: string;
};

type Documentation = {
    readonly summary: string;
    readonly tags: readonly JSDocTagInfo[];
};

/** One JSDoc block tag on a published symbol. */
export type PublishedTag = {
    /** Tag name without the leading `@`. */
    readonly name: string;
    /** Tag text; empty when the tag has no text. */
    readonly text: string;
};

/** One exported symbol of a supported package entry. */
export type PublishedSymbol = {
    /** Whether the symbol is `runtime-only`, `type-only`, or `runtime-and-type`. */
    readonly classification: string;
    /** Declaration kind such as `function`, `class`, or `type alias`. */
    readonly kind: string;
    /** Exported name. */
    readonly name: string;
    /** Printed declaration text without JSDoc, private, or internal members. */
    readonly signature: string;
    /** JSDoc block tags of the resolved symbol. */
    readonly tags: readonly PublishedTag[];
};

/** Exported symbols of one supported package entry. */
export type PublishedEntry = {
    /** Package export-map key such as `.` or `./trace`. */
    readonly entryName: string;
    /** Exported symbols sorted by name. */
    readonly symbols: readonly PublishedSymbol[];
};

/** The supported public API read from emitted declarations. */
export type PublishedApi = {
    /** Package entries sorted by export-map key. */
    readonly entries: readonly PublishedEntry[];
    /** Package name from the manifest. */
    readonly packageName: string;
    /** Package version from the manifest. */
    readonly packageVersion: string;
};

type DescribedSymbol = {
    readonly classification: string;
    readonly documentation: Documentation;
    readonly kind: string;
    readonly name: string;
    readonly renderedDeclarations: readonly {
        readonly declaration: Node;
        readonly signature: string;
    }[];
};

type PublishedDeclarationContext = {
    readonly configuration: ApiReferenceConfiguration;
    readonly entries: readonly {
        readonly entryName: string;
        readonly project: Project;
        readonly symbols: readonly DescribedSymbol[];
    }[];
    readonly packageManifest: PackageManifest;
};

type ResolvedApiReferenceOptions = {
    readonly configurationPath: string;
    readonly packagePath: string;
    readonly repositoryRoot: string;
};

const defaultRepositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

/**
 * Generates the deterministic public API reference from emitted package declarations.
 *
 * @param options - Optional repository, package-manifest, and generator-configuration paths.
 * @returns Markdown containing every supported package entry and exported symbol.
 * @throws {TypeError} If configuration, package exports, or declaration paths are unsafe.
 * @throws {Error} If declarations cannot be resolved or generated output leaks forbidden text.
 */
export async function generateApiReference(options: ApiReferenceOptions = {}): Promise<string> {
    return withPublishedDeclarations(options, (context) => {
        const { configuration, packageManifest } = context;
        const sections = context.entries.map(({ entryName, project, symbols }) =>
            renderEntry(
                project,
                symbols,
                entryName,
                configuration.entries[entryName] as EntryConfiguration,
                packageManifest.name,
                configuration.runtime,
            ),
        );
        const markdown = [
            "# Generated API reference",
            "",
            `Package: \`${packageManifest.name}\` ${packageManifest.version}`,
            "",
            "This file is generated deterministically from the emitted declaration targets in the",
            "package export map. Run `pnpm generate:api-reference` to update it or",
            "`pnpm check:api-reference` to reject drift.",
            "",
            `Package runtime requirement: \`${packageManifest.engines.node}\`.`,
            "",
            ...sections,
        ].join("\n");
        assertNoForbiddenText(markdown, configuration.forbiddenPatterns);
        return `${markdown.trimEnd()}\n`;
    });
}

/**
 * Reads every supported package entry's exported symbols from emitted declarations.
 *
 * The same validated declaration loading, containment, and internal-export checks as
 * {@link generateApiReference} apply, so a compatibility gate sees exactly the documented surface.
 *
 * @param options - Optional repository, package-manifest, and generator-configuration paths.
 * @returns The package identity and, per sorted entry, sorted exported symbols with their
 * classification, kind, printed declaration signature, and JSDoc tags.
 * @throws {TypeError} If configuration, package exports, or declaration paths are unsafe.
 * @throws {Error} If declarations cannot be resolved or an export is internal or forbidden.
 */
export async function readPublishedApi(options: ApiReferenceOptions = {}): Promise<PublishedApi> {
    return withPublishedDeclarations(options, (context) => ({
        entries: context.entries.map(({ entryName, symbols }) => ({
            entryName,
            symbols: symbols.map((symbol) => ({
                classification: symbol.classification,
                kind: symbol.kind,
                name: symbol.name,
                signature: symbol.renderedDeclarations.map(({ signature }) => signature).join("\n"),
                tags: symbol.documentation.tags.map(({ name, text }) => ({
                    name,
                    text: text ?? "",
                })),
            })),
        })),
        packageName: context.packageManifest.name,
        packageVersion: context.packageManifest.version,
    }));
}

async function withPublishedDeclarations<T>(
    options: ApiReferenceOptions,
    visit: (context: PublishedDeclarationContext) => T,
): Promise<T> {
    const { configurationPath, packagePath, repositoryRoot } = resolveOptions(options);
    const configuration = parseConfiguration(
        JSON.parse(await readFile(configurationPath, "utf8")) as unknown,
    );
    const packageManifest = parsePackageManifest(
        JSON.parse(await readFile(packagePath, "utf8")) as unknown,
    );
    const entryNames = Object.keys(packageManifest.exports).sort();
    const packageEntries = entryNames.map(
        (entryName) => [entryName, packageManifest.exports[entryName] as PackageEntry] as const,
    );
    assertExactEntries(entryNames, Object.keys(configuration.entries).sort());
    const declarationRoot = await resolveContainedRealPath(
        repositoryRoot,
        configuration.declarationRoot,
        "declaration root",
    );
    const declarationPaths = await Promise.all(
        packageEntries.map(async ([entryName, entry]) => {
            if (!entry.types.endsWith(".d.ts")) {
                throw new TypeError(
                    `package export ${entryName} must target an emitted declaration`,
                );
            }
            return resolveContainedRealPath(
                repositoryRoot,
                entry.types,
                `package export ${entryName}`,
            );
        }),
    );

    const api = new API({ cwd: repositoryRoot });
    try {
        const snapshot = api.updateSnapshot({ openFiles: declarationPaths });
        try {
            const entries = packageEntries.map(([entryName], index) => {
                const declarationPath = declarationPaths[index] as string;
                const project = snapshot.getDefaultProjectForFile(declarationPath) as Project;
                return {
                    entryName,
                    project,
                    symbols: describeEntry(
                        project,
                        declarationPath,
                        entryName,
                        declarationRoot,
                        configuration.forbiddenDeclarationPatterns,
                    ),
                };
            });
            return visit({ configuration, entries, packageManifest });
        } finally {
            snapshot.dispose();
        }
    } finally {
        api.close();
    }
}

/**
 * Writes the generated API reference to its validated configured artifact path.
 *
 * @param options - Optional repository, package-manifest, and generator-configuration paths.
 * @returns The absolute path written.
 * @throws {TypeError} If configuration or the artifact path is invalid or unsafe.
 * @throws {Error} If configuration/declarations cannot be read, generation fails, or writing fails.
 */
export async function writeApiReference(options: ApiReferenceOptions = {}): Promise<string> {
    const { configurationPath, repositoryRoot } = resolveOptions(options);
    const configuration = parseConfiguration(
        JSON.parse(await readFile(configurationPath, "utf8")) as unknown,
    );
    const artifactPath = await resolveSafeArtifactPath(repositoryRoot, configuration.artifact);
    await writeFile(artifactPath, await generateApiReference(options));
    return artifactPath;
}

/**
 * Checks that the configured checked-in API reference matches emitted declarations exactly.
 *
 * @param options - Optional repository, package-manifest, and generator-configuration paths.
 * @returns The absolute checked artifact path.
 * @throws {TypeError} If configuration or the artifact path is invalid or unsafe.
 * @throws {Error} If configuration/declarations cannot be read, generation fails, or the artifact
 * is missing or stale.
 */
export async function checkApiReference(options: ApiReferenceOptions = {}): Promise<string> {
    const { configurationPath, repositoryRoot } = resolveOptions(options);
    const configuration = parseConfiguration(
        JSON.parse(await readFile(configurationPath, "utf8")) as unknown,
    );
    const artifactPath = await resolveSafeArtifactPath(repositoryRoot, configuration.artifact);
    const [actual, expected] = await Promise.all([
        readFile(artifactPath, "utf8"),
        generateApiReference(options),
    ]);
    if (actual !== expected) {
        throw new Error(
            `generated API reference is stale: ${path.relative(repositoryRoot, artifactPath)}`,
        );
    }
    return artifactPath;
}

function describeEntry(
    project: Project,
    declarationPath: string,
    entryName: string,
    declarationRoot: string,
    forbiddenDeclarationPatterns: readonly ForbiddenPattern[],
): readonly DescribedSymbol[] {
    const sourceFile = project.program.getSourceFile(declarationPath) as SourceFile;
    const moduleSymbol = project.checker.getSymbolAtLocation(sourceFile);
    if (moduleSymbol === undefined) {
        throw new Error(`emitted declaration is not an external module: ${entryName}`);
    }
    const symbolMap = new Map(
        project.checker.getExportsOfModule(moduleSymbol).map((symbol) => [symbol.name, symbol]),
    );
    return [...symbolMap.keys()]
        .sort()
        .map((name) =>
            describeSymbol(
                project,
                symbolMap.get(name) as TypeScriptSymbol,
                declarationRoot,
                forbiddenDeclarationPatterns,
            ),
        );
}

function renderEntry(
    project: Project,
    symbols: readonly DescribedSymbol[],
    entryName: string,
    configuration: EntryConfiguration,
    packageName: string,
    runtime: string,
): string {
    const moduleSpecifier =
        entryName === "." ? packageName : `${packageName}/${entryName.slice(2)}`;
    const symbolSections = symbols.map((symbol) => renderSymbol(project, symbol));
    return [
        `## ${configuration.title}`,
        "",
        `Package entry: \`${entryName}\``,
        "",
        configuration.summary,
        "",
        `Runtime: ${runtime}`,
        "",
        `Authority and mutation: ${configuration.authority}`,
        "",
        "Import example:",
        "",
        "```ts",
        `import * as api from ${JSON.stringify(moduleSpecifier)};`,
        "void api;",
        "```",
        "",
        `Exported symbols: ${symbols.length}.`,
        "",
        ...symbolSections,
    ].join("\n");
}

function describeSymbol(
    project: Project,
    exportedSymbol: TypeScriptSymbol,
    declarationRoot: string,
    forbiddenDeclarationPatterns: readonly ForbiddenPattern[],
): DescribedSymbol {
    const symbol = resolveAlias(project.checker, exportedSymbol);
    const documentation = documentationOf(project.checker, symbol);
    if (documentation.tags.some(({ name }) => name === "internal")) {
        throw new Error(`supported export is marked internal: ${symbol.name}`);
    }
    const declarations = symbol.declarations.map((handle) => handle.resolve(project) as Node);
    for (const declaration of declarations) {
        const sourceFile = declaration.getSourceFile();
        if (
            !sourceFile.isDeclarationFile ||
            !isContainedPath(declarationRoot, sourceFile.fileName)
        ) {
            throw new Error(
                `supported export does not resolve inside emitted declarations: ${exportedSymbol.name}`,
            );
        }
        const origin = `${path.relative(declarationRoot, sourceFile.fileName).replaceAll(path.sep, "/")}#${exportedSymbol.name}`;
        assertNoForbiddenDeclaration(origin, forbiddenDeclarationPatterns);
    }
    return {
        classification: classificationOf(symbol),
        documentation,
        kind: kindOf(symbol),
        name: exportedSymbol.name,
        renderedDeclarations: declarations.map((declaration) => ({
            declaration,
            signature: renderDeclaration(project, declaration),
        })),
    };
}

function renderSymbol(project: Project, symbol: DescribedSymbol): string {
    const deprecated = symbol.documentation.tags.some(({ name }) => name === "deprecated");
    return [
        `### \`${symbol.name}\``,
        "",
        `Classification: \`${symbol.classification}\`. Kind: \`${symbol.kind}\`.${deprecated ? " Status: `deprecated`." : ""}`,
        "",
        symbol.documentation.summary,
        "",
        "Signature:",
        "",
        "```ts",
        symbol.renderedDeclarations.map(({ signature }) => signature).join("\n"),
        "```",
        "",
        ...renderTags(symbol.documentation.tags),
        ...symbol.renderedDeclarations.flatMap(({ declaration }) =>
            renderMemberDocumentationOf(project, declaration),
        ),
    ].join("\n");
}

function renderDeclaration(project: Project, declaration: Node): string {
    if (isVariableDeclaration(declaration) && isVariableStatement(declaration.parent.parent)) {
        return project.emitter.printNode(declaration.parent.parent);
    }
    if (!isClassDeclaration(declaration) && !isInterfaceDeclaration(declaration)) {
        return project.emitter.printNode(declaration);
    }
    const members = declaration.members.filter((member) => isPublishedMember(project, member));
    const printed = project.emitter.printNode(declaration);
    const firstMember = declaration.members[0];
    const opening =
        firstMember === undefined
            ? printed.slice(0, printed.lastIndexOf("}")).trimEnd()
            : printed.slice(0, printed.indexOf(project.emitter.printNode(firstMember))).trimEnd();
    return [
        opening,
        ...members.flatMap((member) =>
            project.emitter
                .printNode(member)
                .split("\n")
                .map((line) => `    ${line}`),
        ),
        "}",
    ].join("\n");
}

function renderMemberDocumentationOf(project: Project, declaration: Node): readonly string[] {
    if (!isClassDeclaration(declaration) && !isInterfaceDeclaration(declaration)) {
        return [];
    }
    return declaration.members
        .filter((member) => isPublishedMember(project, member))
        .flatMap((member) => renderMemberDocumentation(project, member));
}

function isPublishedMember(project: Project, member: ClassElement | TypeElement): boolean {
    const signature = project.emitter.printNode(member).trimStart();
    if (
        signature.startsWith("#") ||
        signature.startsWith("private ") ||
        signature.startsWith("protected ") ||
        isClassStaticBlockDeclaration(member) ||
        isSemicolonClassElement(member)
    ) {
        return false;
    }
    return !documentationOfMember(project.checker, member).tags.some(
        ({ name }) => name === "internal",
    );
}

function renderMemberDocumentation(
    project: Project,
    member: ClassElement | TypeElement,
): readonly string[] {
    const documentation = documentationOfMember(project.checker, member);
    if (documentation.summary.length === 0 && documentation.tags.length === 0) {
        return [];
    }
    return [
        `#### \`${memberName(member)}\``,
        "",
        documentation.summary,
        "",
        "```ts",
        project.emitter.printNode(member),
        "```",
        "",
        ...renderTags(documentation.tags),
    ];
}

function documentationOfMember(
    checker: Checker,
    member: ClassElement | TypeElement,
): Documentation {
    const name = memberNameNode(member);
    const symbol = name === undefined ? undefined : checker.getSymbolAtLocation(name);
    return symbol === undefined
        ? parseLeadingJsDoc(member.getFullText())
        : documentationOf(checker, symbol);
}

function memberNameNode(member: ClassElement | TypeElement): Node | undefined {
    if (
        isGetAccessorDeclaration(member) ||
        isSetAccessorDeclaration(member) ||
        isMethodDeclaration(member) ||
        isMethodSignatureDeclaration(member) ||
        isPropertyDeclaration(member) ||
        isPropertySignatureDeclaration(member)
    ) {
        return member.name;
    }
    return undefined;
}

function memberName(member: ClassElement | TypeElement): string {
    if (isConstructorDeclaration(member)) {
        return "constructor";
    }
    if (isCallSignatureDeclaration(member)) {
        return "call signature";
    }
    if (isConstructSignatureDeclaration(member)) {
        return "construct signature";
    }
    if (isIndexSignatureDeclaration(member)) {
        return "index signature";
    }
    return (memberNameNode(member) as Node).getText();
}

function documentationOf(checker: Checker, symbol: TypeScriptSymbol): Documentation {
    return {
        summary: checker.getDocumentationCommentOfSymbol(symbol).trim(),
        tags: checker.getJsDocTagsOfSymbol(symbol),
    };
}

function parseLeadingJsDoc(text: string): Documentation {
    const comment = /\/\*\*(?<body>[\s\S]*?)\*\//u.exec(text)?.groups?.body;
    if (comment === undefined) {
        return { summary: "", tags: [] };
    }
    const lines = comment.split("\n").map((line) => line.replace(/^\s*\* ?/u, "").trimEnd());
    const summary: string[] = [];
    const tags: { name: string; text: string }[] = [];
    for (const line of lines) {
        const tag = /^@(?<name>\S+)(?:\s+(?<text>.*))?$/u.exec(line)?.groups;
        if (tag?.name !== undefined) {
            tags.push({ name: tag.name, text: tag.text ?? "" });
        } else if (tags.length === 0) {
            summary.push(line);
        } else {
            const previous = tags.at(-1);
            if (previous !== undefined) {
                previous.text = `${previous.text}\n${line}`.trimEnd();
            }
        }
    }
    return { summary: summary.join("\n").trim(), tags };
}

function renderTags(tags: readonly JSDocTagInfo[]): readonly string[] {
    const visibleTags = tags.filter(({ name }) => name !== "public" && name !== "internal");
    if (visibleTags.length === 0) {
        return [];
    }
    return visibleTags.flatMap((tag) => [
        `${tagHeading(tag.name)}:`,
        "",
        tag.text === undefined || tag.text.length === 0 ? "- Declared." : `- ${tag.text}`,
        "",
    ]);
}

function tagHeading(name: string): string {
    if (name === "param") return "Parameter";
    if (name === "returns" || name === "return") return "Returns";
    if (name === "throws" || name === "exception") return "Throws";
    if (name === "example") return "Example";
    if (name === "deprecated") return "Deprecated";
    return `@${name}`;
}

function classificationOf(symbol: TypeScriptSymbol): string {
    const isRuntime = (symbol.flags & SymbolFlags.Value) !== 0;
    const isType = (symbol.flags & SymbolFlags.Type) !== 0;
    if (isRuntime && isType) return "runtime-and-type";
    if (isRuntime) return "runtime-only";
    return "type-only";
}

function kindOf(symbol: TypeScriptSymbol): string {
    let kind = "declaration";
    for (const [flag, name] of [
        [SymbolFlags.Class, "class"],
        [SymbolFlags.Interface, "interface"],
        [SymbolFlags.TypeAlias, "type alias"],
        [SymbolFlags.Function, "function"],
        [SymbolFlags.Enum, "enum"],
        [SymbolFlags.Variable, "variable"],
        [SymbolFlags.Namespace, "namespace"],
    ] as const) {
        if ((symbol.flags & flag) !== 0) {
            kind = name;
            break;
        }
    }
    return kind;
}

function resolveOptions(options: ApiReferenceOptions): ResolvedApiReferenceOptions {
    const repositoryRoot = path.resolve(options.repositoryRoot ?? defaultRepositoryRoot);
    return {
        configurationPath: path.resolve(
            options.configurationPath ?? path.join(repositoryRoot, "api-reference.config.json"),
        ),
        packagePath: path.resolve(options.packagePath ?? path.join(repositoryRoot, "package.json")),
        repositoryRoot,
    };
}

function resolveAlias(checker: Checker, symbol: TypeScriptSymbol): TypeScriptSymbol {
    return (symbol.flags & SymbolFlags.Alias) === 0 ? symbol : checker.getAliasedSymbol(symbol);
}

function parseConfiguration(value: unknown): ApiReferenceConfiguration {
    const root = objectValue(value, "API reference configuration");
    const entriesValue = objectValue(root.entries, "API reference entries");
    const entries: Record<string, EntryConfiguration> = {};
    for (const [entryName, entryValue] of Object.entries(entriesValue)) {
        const entry = objectValue(entryValue, `API reference entry ${entryName}`);
        entries[entryName] = {
            authority: stringValue(entry.authority, `${entryName} authority`),
            summary: stringValue(entry.summary, `${entryName} summary`),
            title: stringValue(entry.title, `${entryName} title`),
        };
    }
    const forbiddenDeclarationPatterns = parseForbiddenPatterns(
        root.forbiddenDeclarationPatterns,
        "forbiddenDeclarationPatterns",
    );
    const forbiddenPatterns = parseForbiddenPatterns(root.forbiddenPatterns, "forbiddenPatterns");
    return {
        artifact: stringValue(root.artifact, "API reference artifact"),
        declarationRoot: stringValue(root.declarationRoot, "API reference declarationRoot"),
        entries,
        forbiddenDeclarationPatterns,
        forbiddenPatterns,
        runtime: stringValue(root.runtime, "API reference runtime"),
    };
}

function parseForbiddenPatterns(value: unknown, name: string): readonly ForbiddenPattern[] {
    if (!Array.isArray(value)) {
        throw new TypeError(`API reference ${name} must be an array`);
    }
    return value.map((value, index) => {
        const pattern = objectValue(value, `forbidden pattern ${index}`);
        const parsed = {
            flags: stringValue(pattern.flags, `forbidden pattern ${index} flags`),
            label: stringValue(pattern.label, `forbidden pattern ${index} label`),
            pattern: stringValue(pattern.pattern, `forbidden pattern ${index} pattern`),
        };
        new RegExp(parsed.pattern, parsed.flags);
        return parsed;
    });
}

function parsePackageManifest(value: unknown): PackageManifest {
    const root = objectValue(value, "package manifest");
    const engines = objectValue(root.engines, "package engines");
    const exportsValue = objectValue(root.exports, "package exports");
    const exports: Record<string, PackageEntry> = {};
    for (const [entryName, entryValue] of Object.entries(exportsValue)) {
        const entry = objectValue(entryValue, `package export ${entryName}`);
        exports[entryName] = {
            import: stringValue(entry.import, `${entryName} import target`),
            types: stringValue(entry.types, `${entryName} declaration target`),
        };
    }
    return {
        engines: { node: stringValue(engines.node, "package Node engine") },
        exports,
        name: stringValue(root.name, "package name"),
        version: stringValue(root.version, "package version"),
    };
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new TypeError(`${label} must be an object`);
    }
    return value as Record<string, unknown>;
}

function stringValue(value: unknown, label: string): string {
    if (typeof value !== "string" || value.length === 0) {
        throw new TypeError(`${label} must be a non-empty string`);
    }
    return value;
}

function assertExactEntries(
    packageEntries: readonly string[],
    configuredEntries: readonly string[],
): void {
    if (
        packageEntries.length !== configuredEntries.length ||
        packageEntries.some((entry, index) => entry !== configuredEntries[index])
    ) {
        throw new TypeError("API reference entries must exactly match the package export map");
    }
}

function assertNoForbiddenText(markdown: string, patterns: readonly ForbiddenPattern[]): void {
    for (const { flags, label, pattern } of patterns) {
        if (new RegExp(pattern, flags).test(markdown)) {
            throw new Error(`generated API reference contains forbidden ${label}`);
        }
    }
}

function assertNoForbiddenDeclaration(origin: string, patterns: readonly ForbiddenPattern[]): void {
    for (const { flags, label, pattern } of patterns) {
        if (new RegExp(pattern, flags).test(origin)) {
            throw new Error(`supported export resolves from forbidden ${label}: ${origin}`);
        }
    }
}

function resolveContainedPath(repositoryRoot: string, target: string, label: string): string {
    const resolved = path.resolve(repositoryRoot, target);
    const relative = path.relative(repositoryRoot, resolved);
    if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`)) {
        throw new TypeError(`${label} path must remain inside the repository`);
    }
    return resolved;
}

async function resolveContainedRealPath(
    repositoryRoot: string,
    target: string,
    label: string,
): Promise<string> {
    const resolved = resolveContainedPath(repositoryRoot, target, label);
    const [realRepositoryRoot, realTarget] = await Promise.all([
        realpath(repositoryRoot),
        realpath(resolved),
    ]);
    const relative = path.relative(realRepositoryRoot, realTarget);
    if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`)) {
        throw new TypeError(`${label} real path must remain inside the repository`);
    }
    return realTarget;
}

async function resolveSafeArtifactPath(repositoryRoot: string, target: string): Promise<string> {
    const artifactPath = resolveContainedPath(repositoryRoot, target, "artifact");
    const [realRepositoryRoot, realParent] = await Promise.all([
        realpath(repositoryRoot),
        realpath(path.dirname(artifactPath)),
    ]);
    if (!isContainedPath(realRepositoryRoot, realParent)) {
        throw new TypeError("artifact parent must remain inside the repository");
    }
    try {
        const status = await lstat(artifactPath);
        if (status.isSymbolicLink() || !status.isFile()) {
            throw new TypeError("artifact must be a regular file without symlinks");
        }
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            throw error;
        }
    }
    return artifactPath;
}

function isContainedPath(container: string, target: string): boolean {
    const relative = path.relative(container, target);
    return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`));
}
