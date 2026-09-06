import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
    copyFileSync,
    lstatSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    realpathSync,
    writeFileSync,
} from "node:fs";
import path from "node:path";

/** Locations supplied by the isolated installed-package conformance runner. */
export type PackagedExampleOptions = {
    /** Checkout providing the pinned compiler and Node declarations. */
    readonly repositoryRoot: string;
    /** Freshly installed package, never the source checkout. */
    readonly installedPackageRoot: string;
    /** Isolated parent beside the installed node_modules directory. */
    readonly consumerParent: string;
};

type ExampleManifest = {
    readonly documentation?: readonly string[];
    readonly examples: readonly {
        readonly source: string;
        readonly configuration: string;
        readonly expectedResult: unknown;
        readonly expectedFiles: Readonly<Record<string, string>>;
        readonly reviews?: readonly {
            readonly source: string;
            readonly configuration: string;
            readonly expectedResult: unknown;
        }[];
    }[];
};

/**
 * Typechecks and executes every configured shipped TypeScript example as an installed consumer.
 *
 * @param options - Fresh installation, isolated consumer parent, and compiler checkout.
 * @returns Nothing after transcripts, selected files, and existing-directory refusal pass.
 * @throws {Error} If artifacts are unsafe/missing, compilation or execution fails, or evidence
 * differs from the independent manifest expectations.
 */
export function testPackagedExamples(options: PackagedExampleOptions): void {
    const packageManifest = JSON.parse(
        readFileSync(path.join(options.installedPackageRoot, "package.json"), "utf8"),
    ) as { readonly exampleManifest: string };
    const manifestPath = packageFile(options.installedPackageRoot, packageManifest.exampleManifest);
    assert.deepEqual(
        readFileSync(manifestPath),
        readFileSync(packageFile(options.repositoryRoot, packageManifest.exampleManifest)),
    );
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ExampleManifest;
    assert.ok(Array.isArray(manifest.examples) && manifest.examples.length > 0);
    const verifiedSources = new Set(
        manifest.examples.flatMap((example) => [
            example.source,
            ...(example.reviews ?? []).map((review: { readonly source: string }) => review.source),
        ]),
    );
    for (const document of manifest.documentation ?? []) {
        const markdown = readFileSync(packageFile(options.installedPackageRoot, document), "utf8");
        assert.equal(markdown, readFileSync(packageFile(options.repositoryRoot, document), "utf8"));
        const snippets = [...markdown.matchAll(/^```ts(?: ([^\r\n]+))?\r?\n([\s\S]*?)^```/gm)];
        assert.ok(snippets.length > 0, "configured guide must contain tested TypeScript excerpts");
        for (const snippet of snippets) {
            const source = snippet[1]?.replace(/^source=/u, "");
            assert.ok(
                source && snippet[1]?.startsWith("source=") && verifiedSources.has(source),
                "guide excerpt must name a typechecked and executed example",
            );
            const code = snippet[2]?.trim();
            assert.ok(
                code &&
                    readFileSync(
                        packageFile(options.installedPackageRoot, source),
                        "utf8",
                    ).includes(code),
                "guide TypeScript excerpt differs from the executed installed example",
            );
        }
    }
    for (const example of manifest.examples) {
        const consumerRoot = mkdtempSync(path.join(options.consumerParent, "example-"));
        const source = path.join(consumerRoot, "example.ts");
        const configuration = path.join(consumerRoot, "example.json");
        for (const [relative, destination] of [
            [example.source, source],
            [example.configuration, configuration],
        ] as const) {
            const installed = packageFile(options.installedPackageRoot, relative);
            assert.deepEqual(
                readFileSync(installed),
                readFileSync(packageFile(options.repositoryRoot, relative)),
            );
            copyFileSync(installed, destination);
        }
        writeFileSync(path.join(consumerRoot, "package.json"), '{"type":"module"}\n');
        const typeConfiguration = path.join(consumerRoot, "tsconfig.json");
        writeFileSync(
            typeConfiguration,
            JSON.stringify({
                compilerOptions: {
                    erasableSyntaxOnly: true,
                    exactOptionalPropertyTypes: true,
                    lib: ["ESNext"],
                    module: "NodeNext",
                    moduleResolution: "NodeNext",
                    noEmit: true,
                    noUncheckedIndexedAccess: true,
                    strict: true,
                    target: "ESNext",
                    typeRoots: [path.join(options.repositoryRoot, "node_modules", "@types")],
                    types: ["node"],
                    verbatimModuleSyntax: true,
                },
                files: [source],
            }),
        );
        execFileSync(
            path.join(
                options.repositoryRoot,
                "node_modules",
                ".bin",
                process.platform === "win32" ? "tsc.cmd" : "tsc",
            ),
            ["--project", typeConfiguration],
            { cwd: consumerRoot, stdio: "pipe" },
        );
        const workspaceRoot = path.join(consumerRoot, "workspace");
        const args = [source, workspaceRoot, configuration];
        const output = execFileSync(process.execPath, args, {
            cwd: consumerRoot,
            encoding: "utf8",
        });
        assert.deepEqual(JSON.parse(output), example.expectedResult);
        for (const [relative, expected] of Object.entries(example.expectedFiles)) {
            assert.equal(readFileSync(packageFile(workspaceRoot, relative), "utf8"), expected);
        }
        assert.throws(
            () => execFileSync(process.execPath, args, { cwd: consumerRoot, stdio: "pipe" }),
            /EEXIST/u,
        );
        for (const [relative, expected] of Object.entries(example.expectedFiles)) {
            assert.equal(readFileSync(packageFile(workspaceRoot, relative), "utf8"), expected);
        }
        for (const review of example.reviews ?? []) {
            for (const [relative, destination] of [
                [review.source, source],
                [review.configuration, configuration],
            ] as const) {
                const installed = packageFile(options.installedPackageRoot, relative);
                assert.deepEqual(
                    readFileSync(installed),
                    readFileSync(packageFile(options.repositoryRoot, relative)),
                );
                copyFileSync(installed, destination);
            }
            execFileSync(
                path.join(
                    options.repositoryRoot,
                    "node_modules",
                    ".bin",
                    process.platform === "win32" ? "tsc.cmd" : "tsc",
                ),
                ["--project", typeConfiguration],
                { cwd: consumerRoot, stdio: "pipe" },
            );
            for (let attempt = 0; attempt < 2; attempt++) {
                const beforeReview = snapshotFiles(workspaceRoot);
                const reviewed = execFileSync(process.execPath, args, {
                    cwd: consumerRoot,
                    encoding: "utf8",
                });
                assert.deepEqual(JSON.parse(reviewed), review.expectedResult);
                assert.deepEqual(
                    snapshotFiles(workspaceRoot),
                    beforeReview,
                    "review changed workspace or retained evidence files",
                );
                for (const [relative, expected] of Object.entries(example.expectedFiles)) {
                    assert.equal(
                        readFileSync(packageFile(workspaceRoot, relative), "utf8"),
                        expected,
                    );
                }
            }
        }
        for (const [relative, expected] of Object.entries(example.expectedFiles)) {
            assert.equal(readFileSync(packageFile(workspaceRoot, relative), "utf8"), expected);
        }
    }
}

function snapshotFiles(root: string): readonly string[] {
    return readdirSync(root, { recursive: true, withFileTypes: true })
        .map((entry) => {
            const absolute = path.join(entry.parentPath, entry.name);
            const relative = path.relative(root, absolute).split(path.sep).join("/");
            assert.ok(
                entry.isDirectory() || entry.isFile(),
                "fixture contains an unsupported file type",
            );
            return entry.isDirectory()
                ? `directory:${relative}`
                : `file:${relative}:${createHash("sha256").update(readFileSync(absolute)).digest("hex")}`;
        })
        .sort();
}

function packageFile(root: string, relative: string): string {
    assert.equal(typeof relative, "string", "package example manifest/path is required");
    assert.ok(relative.length > 0 && !path.isAbsolute(relative) && !relative.includes("\\"));
    const resolvedRoot = realpathSync(root);
    const candidate = path.resolve(resolvedRoot, relative);
    assert.ok(candidate.startsWith(`${resolvedRoot}${path.sep}`), "example path escapes its root");
    const resolved = realpathSync(candidate);
    assert.ok(
        resolved.startsWith(`${resolvedRoot}${path.sep}`),
        "example real path escapes its root",
    );
    assert.ok(lstatSync(candidate).isFile(), "example path must be a regular file");
    return resolved;
}
