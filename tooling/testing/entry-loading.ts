import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

/** Fresh installation locations for package-entry import conformance. */
export type EntryLoadingOptions = {
    /** Repository containing the reviewed loading policy. */
    readonly repositoryRoot: string;
    /** Installed tarball package root. */
    readonly installedPackageRoot: string;
    /** Isolated directory beside the installation's node_modules. */
    readonly consumerParent: string;
};

/**
 * Checks installed entry loading and configured type-only consumers without Node declarations.
 *
 * @param options - Repository policy and isolated installed-package locations.
 * @returns Nothing when the export map and all loading expectations agree.
 * @throws {Error} If policy is missing, imports fail, or observed dependencies violate policy.
 */
export function testEntryLoading(options: EntryLoadingOptions): void {
    const manifest = JSON.parse(
        readFileSync(path.join(options.installedPackageRoot, "package.json"), "utf8"),
    ) as {
        readonly name: string;
        readonly exports: Readonly<Record<string, unknown>>;
    };
    const policy = JSON.parse(
        readFileSync(path.join(options.repositoryRoot, "config/entry-loading.config.json"), "utf8"),
    ) as {
        readonly entries: Readonly<
            Record<
                string,
                {
                    readonly required: readonly string[];
                    readonly forbidden: readonly string[];
                    readonly webSafeTypeProbe?: string;
                }
            >
        >;
    };
    assert.deepEqual(
        Object.keys(policy.entries).sort(),
        Object.keys(manifest.exports).sort(),
        "loading policy must cover exactly the supported package exports",
    );
    const consumer = mkdtempSync(path.join(options.consumerParent, "entry-loading-"));
    const hookPath = path.join(consumer, "observe.mjs");
    writeFileSync(
        hookPath,
        `import { registerHooks } from "node:module";
const loaded = new Set();
registerHooks({ load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (url.startsWith("node:")) loaded.add(url);
    return result;
} });
process.on("exit", () => process.stdout.write(JSON.stringify([...loaded].sort()) + "\\n"));
`,
    );
    for (const [entry, expected] of Object.entries(policy.entries)) {
        const specifier = entry === "." ? manifest.name : `${manifest.name}/${entry.slice(2)}`;
        const probePath = path.join(consumer, "probe.mjs");
        writeFileSync(
            probePath,
            expected.webSafeTypeProbe === undefined
                ? `import ${JSON.stringify(specifier)};\n`
                : `import * as entry from ${JSON.stringify(specifier)};\nif (Object.keys(entry).length !== 0) throw new Error("type-only entry exported runtime values");\n`,
        );
        const observed: unknown = JSON.parse(
            execFileSync(process.execPath, ["--import", hookPath, probePath], {
                cwd: consumer,
                encoding: "utf8",
            }),
        );
        assert.ok(Array.isArray(observed) && observed.every((value) => typeof value === "string"));
        if (expected.webSafeTypeProbe !== undefined) {
            assert.deepEqual(observed, [], `${entry} must not load any Node builtins`);
            const compilerManifestPath = createRequire(import.meta.url).resolve(
                "typescript/package.json",
            );
            const compilerManifest = JSON.parse(readFileSync(compilerManifestPath, "utf8")) as {
                readonly bin: { readonly tsc: string };
            };
            const typeProbe = path.join(consumer, "probe.ts");
            writeFileSync(
                typeProbe,
                readFileSync(
                    path.join(options.repositoryRoot, expected.webSafeTypeProbe),
                    "utf8",
                ).replaceAll("PACKAGE_READ_ENTRY", specifier),
            );
            for (const resolution of ["Bundler", "NodeNext"]) {
                const typeConfig = path.join(consumer, "tsconfig.json");
                writeFileSync(
                    typeConfig,
                    JSON.stringify({
                        compilerOptions: {
                            lib: ["ESNext", "DOM"],
                            module: resolution === "Bundler" ? "ESNext" : "NodeNext",
                            moduleResolution: resolution,
                            noEmit: true,
                            strict: true,
                            skipLibCheck: false,
                            target: "ESNext",
                            types: [],
                        },
                        files: [typeProbe],
                    }),
                );
                execFileSync(
                    process.execPath,
                    [
                        path.resolve(path.dirname(compilerManifestPath), compilerManifest.bin.tsc),
                        "--project",
                        typeConfig,
                    ],
                    { cwd: consumer, stdio: "inherit" },
                );
            }
        }
        for (const required of expected.required) {
            assert.ok(observed.includes(required), `${entry} did not load required ${required}`);
        }
        for (const forbidden of expected.forbidden) {
            assert.ok(!observed.includes(forbidden), `${entry} unexpectedly loaded ${forbidden}`);
        }
    }
}
