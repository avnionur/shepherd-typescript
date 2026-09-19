import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { parse } from "yaml";

import {
    defaultRepositoryRoot,
    readReleaseIntegrityConfiguration,
    type SbomConfiguration,
} from "./integrity-config.ts";

/** CycloneDX hash entry. */
export type CycloneDxHash = {
    /** CycloneDX hash algorithm name such as `SHA-512`. */
    readonly alg: string;
    /** Lower-case hexadecimal digest. */
    readonly content: string;
};

/** CycloneDX name/value property. */
export type CycloneDxProperty = {
    /** Property name. */
    readonly name: string;
    /** Property value. */
    readonly value: string;
};

/** CycloneDX component limited to the fields this generator emits. */
export type CycloneDxComponent = {
    /** Unique reference; the package URL. */
    readonly "bom-ref": string;
    /** npm scope including `@`, when scoped. */
    readonly group?: string;
    /** Registry integrity digests from the lockfile. */
    readonly hashes?: readonly CycloneDxHash[];
    /** Declared licenses (root component only). */
    readonly licenses?: readonly { readonly license: { readonly id: string } }[];
    /** Package name without scope. */
    readonly name: string;
    /** Additional classification properties. */
    readonly properties?: readonly CycloneDxProperty[];
    /** npm package URL. */
    readonly purl: string;
    /** `required`, `optional`, or `excluded` (development and build tooling). */
    readonly scope?: "excluded" | "optional" | "required";
    /** CycloneDX component type. */
    readonly type: "application" | "library";
    /** Package version. */
    readonly version: string;
};

/** CycloneDX dependency edge list. */
export type CycloneDxDependency = {
    /** Sorted references this component depends on. */
    readonly dependsOn: readonly string[];
    /** Component reference. */
    readonly ref: string;
};

/** CycloneDX 1.5-shaped bill of materials derived from the lockfile. */
export type CycloneDxBom = {
    /** Configured format name. */
    readonly bomFormat: string;
    /** Components sorted by reference. */
    readonly components: readonly CycloneDxComponent[];
    /** Dependency graph sorted by reference. */
    readonly dependencies: readonly CycloneDxDependency[];
    /** Root component, generating tool, and lockfile facts. */
    readonly metadata: {
        /** The package this SBOM describes. */
        readonly component: CycloneDxComponent;
        /** Lockfile digest, lockfile version, and runtime component count. */
        readonly properties: readonly CycloneDxProperty[];
        /** Generating tool. */
        readonly tools: {
            /** Tool components. */
            readonly components: readonly CycloneDxComponent[];
        };
    };
    /** `urn:uuid:` serial derived from the BOM content; no randomness or clock. */
    readonly serialNumber: string;
    /** CycloneDX specification version. */
    readonly specVersion: string;
    /** BOM document version. */
    readonly version: number;
};

/** Inputs of a pure SBOM generation. */
export type SbomInputs = {
    /** SBOM settings. */
    readonly configuration: SbomConfiguration;
    /** pnpm lockfile text. */
    readonly lockfileText: string;
    /** Package manifest fields recorded for the root component. */
    readonly packageManifest: {
        /** SPDX license identifier. */
        readonly license: string;
        /** Package name. */
        readonly name: string;
        /** Package version. */
        readonly version: string;
    };
};

/** Repository location for SBOM file operations. */
export type SbomOptions = {
    /** Optional repository root; defaults to this package root. */
    readonly repositoryRoot?: string;
};

type LockDependency = { readonly name: string; readonly version: string };

const hashAlgorithms: Readonly<Record<string, string>> = {
    sha1: "SHA-1",
    sha256: "SHA-256",
    sha384: "SHA-384",
    sha512: "SHA-512",
};

/**
 * Generates a deterministic CycloneDX-shaped SBOM from a pnpm lockfile.
 *
 * Components reachable from the package's runtime `dependencies` are `required` (or `optional`
 * through optional runtime edges); every other locked package is development or build tooling
 * and is `excluded`. The serial number is derived from the content, so the same lockfile and
 * manifest always produce the same bytes.
 *
 * @param inputs - Lockfile text, root package fields, and SBOM settings.
 * @returns The bill of materials.
 * @throws {TypeError} If the lockfile shape, a package key, or an integrity value is invalid.
 */
export function generateSbom(inputs: SbomInputs): CycloneDxBom {
    const { configuration, lockfileText, packageManifest } = inputs;
    const lockfile = objectValue(parse(lockfileText) as unknown, "lockfile");
    const importer = objectValue(
        objectValue(lockfile.importers, "lockfile importers")["."],
        "lockfile root importer",
    );
    const packages = objectValue(lockfile.packages ?? {}, "lockfile packages");
    const snapshots = objectValue(lockfile.snapshots ?? {}, "lockfile snapshots");

    const edges = new Map<string, Set<string>>();
    const optionalEdges = new Map<string, Set<string>>();
    for (const [snapshotKey, snapshotValue] of Object.entries(snapshots)) {
        const snapshot = objectValue(snapshotValue, `snapshot ${snapshotKey}`);
        const packageKey = packageKeyOf(snapshotKey);
        const required = edges.get(packageKey) ?? new Set<string>();
        const optional = optionalEdges.get(packageKey) ?? new Set<string>();
        for (const dependency of dependencyList(snapshot.dependencies, snapshotKey)) {
            required.add(dependencyKey(dependency));
        }
        for (const dependency of dependencyList(snapshot.optionalDependencies, snapshotKey)) {
            optional.add(dependencyKey(dependency));
        }
        edges.set(packageKey, required);
        optionalEdges.set(packageKey, optional);
    }

    const importerList = (field: string): readonly string[] =>
        Object.entries(objectValue(importer[field] ?? {}, `root importer ${field}`)).map(
            ([name, value]) =>
                dependencyKey({
                    name,
                    version: stringValue(
                        objectValue(value, `root importer ${field} ${name}`).version,
                        `root importer ${field} ${name} version`,
                    ),
                }),
        );
    const scopes = new Map<string, "optional" | "required">();
    const visit = (key: string, scope: "optional" | "required"): void => {
        const existing = scopes.get(key);
        if (existing === "required" || existing === scope) {
            return;
        }
        scopes.set(key, scope);
        for (const next of edges.get(key) ?? []) {
            visit(next, scope);
        }
        for (const next of optionalEdges.get(key) ?? []) {
            visit(next, "optional");
        }
    };
    for (const key of importerList("dependencies")) {
        visit(key, "required");
    }
    for (const key of importerList("optionalDependencies")) {
        visit(key, "optional");
    }

    const components = Object.keys(packages)
        .sort()
        .map((packageKey): CycloneDxComponent => {
            const entry = objectValue(packages[packageKey], `package ${packageKey}`);
            const { name, version } = splitPackageKey(packageKey);
            const integrity = objectValue(
                entry.resolution ?? {},
                `package ${packageKey} resolution`,
            ).integrity;
            const scope = scopes.get(packageKey) ?? "excluded";
            const properties: CycloneDxProperty[] = [];
            if (scope === "excluded") {
                properties.push({ name: configuration.developmentProperty, value: "true" });
            }
            if (
                objectValue(snapshotOf(snapshots, packageKey), `snapshot ${packageKey}`)
                    .optional === true
            ) {
                properties.push({
                    name: `${configuration.propertyPrefix}:optional`,
                    value: "true",
                });
            }
            return {
                ...componentIdentity(name, version, "library"),
                ...(integrity === undefined
                    ? {}
                    : { hashes: hashesOf(stringValue(integrity, `${packageKey} integrity`)) }),
                ...(properties.length === 0 ? {} : { properties }),
                scope,
            };
        });
    const componentRefs = new Map(
        components.map((component) => [
            `${component.group === undefined ? "" : `${component.group}/`}${component.name}@${component.version}`,
            component["bom-ref"],
        ]),
    );
    const refOf = (key: string): string => {
        const ref = componentRefs.get(key);
        if (ref === undefined) {
            throw new TypeError(`lockfile dependency has no package entry: ${key}`);
        }
        return ref;
    };

    const rootComponent: CycloneDxComponent = {
        ...componentIdentity(packageManifest.name, packageManifest.version, "application"),
        licenses: [{ license: { id: packageManifest.license } }],
    };
    const dependencies: CycloneDxDependency[] = [
        {
            dependsOn: sortedUnique(
                ["dependencies", "devDependencies", "optionalDependencies"].flatMap((field) =>
                    importerList(field).map(refOf),
                ),
            ),
            ref: rootComponent["bom-ref"],
        },
        ...[...edges.keys()].map((packageKey) => ({
            dependsOn: sortedUnique(
                [
                    ...(edges.get(packageKey) as Set<string>),
                    ...(optionalEdges.get(packageKey) as Set<string>),
                ].map(refOf),
            ),
            ref: refOf(packageKey),
        })),
    ].sort((left, right) => (left.ref < right.ref ? -1 : 1));

    const lockfileDigest = createHash("sha256").update(lockfileText, "utf8").digest("hex");
    const unsigned = {
        bomFormat: configuration.bomFormat,
        components,
        dependencies,
        metadata: {
            component: rootComponent,
            properties: [
                { name: `${configuration.propertyPrefix}:lockfile`, value: configuration.lockfile },
                { name: `${configuration.propertyPrefix}:lockfile-sha256`, value: lockfileDigest },
                {
                    name: `${configuration.propertyPrefix}:lockfile-version`,
                    value: String(lockfile.lockfileVersion),
                },
                {
                    name: `${configuration.propertyPrefix}:runtime-components`,
                    value: String(components.filter(({ scope }) => scope !== "excluded").length),
                },
            ],
            tools: {
                components: [
                    {
                        "bom-ref": `${rootComponent["bom-ref"]}#sbom-generator`,
                        name: configuration.toolName,
                        purl: rootComponent.purl,
                        type: "application" as const,
                        version: packageManifest.version,
                    },
                ],
            },
        },
        specVersion: configuration.specVersion,
        version: 1,
    };
    const digest = createHash("sha256").update(JSON.stringify(unsigned), "utf8").digest("hex");
    const variant = ((Number.parseInt(digest[16] as string, 16) & 0x3) | 0x8).toString(16);
    const serial = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-8${digest.slice(13, 16)}-${variant}${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
    return {
        bomFormat: unsigned.bomFormat,
        components,
        dependencies,
        metadata: unsigned.metadata,
        serialNumber: `urn:uuid:${serial}`,
        specVersion: unsigned.specVersion,
        version: unsigned.version,
    };
}

/**
 * Serializes an SBOM as stable, indented JSON with a trailing newline.
 *
 * @param bom - Bill of materials.
 * @returns The JSON text.
 */
export function renderSbom(bom: CycloneDxBom): string {
    return `${JSON.stringify(bom, null, 4)}\n`;
}

/**
 * Generates the repository SBOM text from the configured lockfile and manifest.
 *
 * @param options - Optional repository root.
 * @returns The SBOM JSON text.
 * @throws {TypeError} If configuration, manifest, or lockfile content is invalid.
 * @throws {Error} If a configured file cannot be read.
 */
export async function generateRepositorySbom(options: SbomOptions = {}): Promise<string> {
    const repositoryRoot = path.resolve(options.repositoryRoot ?? defaultRepositoryRoot);
    const { sbom } = await readReleaseIntegrityConfiguration(repositoryRoot);
    const manifest = objectValue(
        JSON.parse(
            await readFile(path.join(repositoryRoot, sbom.packageManifest), "utf8"),
        ) as unknown,
        "package manifest",
    );
    return renderSbom(
        generateSbom({
            configuration: sbom,
            lockfileText: await readFile(path.join(repositoryRoot, sbom.lockfile), "utf8"),
            packageManifest: {
                license: stringValue(manifest.license, "package license"),
                name: stringValue(manifest.name, "package name"),
                version: stringValue(manifest.version, "package version"),
            },
        }),
    );
}

/**
 * Writes the checked-in SBOM artifact.
 *
 * @param repositoryRoot - Repository root containing the configuration, manifest, and lockfile.
 * @returns The absolute artifact path.
 * @throws {TypeError} If configuration or inputs are invalid.
 * @throws {Error} If reading or writing fails.
 */
export async function writeSbom(repositoryRoot: string): Promise<string> {
    const { sbom } = await readReleaseIntegrityConfiguration(repositoryRoot);
    const artifactPath = path.join(repositoryRoot, sbom.artifact);
    await writeFile(artifactPath, await generateRepositorySbom({ repositoryRoot }));
    return artifactPath;
}

/**
 * Checks that the checked-in SBOM matches the current lockfile and manifest exactly.
 *
 * @param options - Optional repository root.
 * @returns The absolute artifact path.
 * @throws {Error} If the artifact is missing or stale.
 */
export async function checkSbom(options: SbomOptions = {}): Promise<string> {
    const repositoryRoot = path.resolve(options.repositoryRoot ?? defaultRepositoryRoot);
    const { sbom } = await readReleaseIntegrityConfiguration(repositoryRoot);
    const artifactPath = path.join(repositoryRoot, sbom.artifact);
    const [actual, expected] = await Promise.all([
        readFile(artifactPath, "utf8"),
        generateRepositorySbom({ repositoryRoot }),
    ]);
    if (actual !== expected) {
        throw new Error(`SBOM is stale: ${sbom.artifact}; run \`pnpm generate:sbom\``);
    }
    return artifactPath;
}

function componentIdentity(
    fullName: string,
    version: string,
    type: "application" | "library",
): Pick<CycloneDxComponent, "bom-ref" | "group" | "name" | "purl" | "type" | "version"> {
    const slash = fullName.indexOf("/");
    const scoped = fullName.startsWith("@") && slash > 1;
    const group = scoped ? fullName.slice(0, slash) : undefined;
    const name = scoped ? fullName.slice(slash + 1) : fullName;
    const purl = `pkg:npm/${group === undefined ? "" : `${encodeURIComponent(group)}/`}${encodeURIComponent(name)}@${encodeURIComponent(version)}`;
    return {
        "bom-ref": purl,
        ...(group === undefined ? {} : { group }),
        name,
        purl,
        type,
        version,
    };
}

function packageKeyOf(snapshotKey: string): string {
    const peerSuffix = snapshotKey.indexOf("(");
    return peerSuffix < 0 ? snapshotKey : snapshotKey.slice(0, peerSuffix);
}

function dependencyKey({ name, version }: LockDependency): string {
    const resolved = packageKeyOf(version);
    return resolved.lastIndexOf("@") > 0 ? resolved : `${name}@${resolved}`;
}

function dependencyList(value: unknown, owner: string): readonly LockDependency[] {
    return Object.entries(objectValue(value ?? {}, `snapshot ${owner} dependencies`)).map(
        ([name, version]) => ({ name, version: stringValue(version, `${owner} ${name}`) }),
    );
}

function snapshotOf(snapshots: Readonly<Record<string, unknown>>, packageKey: string): unknown {
    const key = Object.keys(snapshots).find((candidate) => packageKeyOf(candidate) === packageKey);
    return key === undefined ? {} : snapshots[key];
}

function splitPackageKey(packageKey: string): LockDependency {
    const separator = packageKey.lastIndexOf("@");
    if (separator <= 0 || separator === packageKey.length - 1) {
        throw new TypeError(`lockfile package key must be name@version: ${packageKey}`);
    }
    return { name: packageKey.slice(0, separator), version: packageKey.slice(separator + 1) };
}

function hashesOf(integrity: string): readonly CycloneDxHash[] {
    return integrity.split(/\s+/u).map((entry) => {
        const separator = entry.indexOf("-");
        const alg = hashAlgorithms[entry.slice(0, separator)];
        if (separator < 0 || alg === undefined) {
            throw new TypeError(`unsupported lockfile integrity: ${entry}`);
        }
        return {
            alg,
            content: Buffer.from(entry.slice(separator + 1), "base64").toString("hex"),
        };
    });
}

function sortedUnique(values: readonly string[]): readonly string[] {
    return [...new Set(values)].sort();
}

function objectValue(value: unknown, label: string): Readonly<Record<string, unknown>> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new TypeError(`${label} must be an object`);
    }
    return value as Readonly<Record<string, unknown>>;
}

function stringValue(value: unknown, label: string): string {
    if (typeof value !== "string" || value.length === 0) {
        throw new TypeError(`${label} must be a non-empty string`);
    }
    return value;
}
