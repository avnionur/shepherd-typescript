import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
 * Imports every supported installed entry in a fresh process and checks builtin dependencies.
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
        readFileSync(path.join(options.repositoryRoot, "entry-loading.config.json"), "utf8"),
    ) as {
        readonly entries: Readonly<
            Record<
                string,
                {
                    readonly required: readonly string[];
                    readonly forbidden: readonly string[];
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
        writeFileSync(probePath, `import ${JSON.stringify(specifier)};\n`);
        const observed: unknown = JSON.parse(
            execFileSync(process.execPath, ["--import", hookPath, probePath], {
                cwd: consumer,
                encoding: "utf8",
            }),
        );
        assert.ok(Array.isArray(observed) && observed.every((value) => typeof value === "string"));
        for (const required of expected.required) {
            assert.ok(observed.includes(required), `${entry} did not load required ${required}`);
        }
        for (const forbidden of expected.forbidden) {
            assert.ok(!observed.includes(forbidden), `${entry} unexpectedly loaded ${forbidden}`);
        }
    }
}
