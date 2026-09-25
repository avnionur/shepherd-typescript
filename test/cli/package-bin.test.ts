import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { runCli } from "../../src/index.ts";

test("package bin metadata matches the public distinct CLI executable", async () => {
    const root = new URL("../../", import.meta.url);
    const packageManifest = JSON.parse(readFileSync(new URL("package.json", root), "utf8")) as {
        readonly bin: Readonly<Record<string, string>>;
        readonly files: readonly string[];
        readonly exports: Readonly<Record<string, unknown>>;
        readonly main: string;
        readonly types: string;
    };
    const protocol = JSON.parse(readFileSync(new URL("protocol.config.json", root), "utf8")) as {
        readonly cli: { readonly executableName: string; readonly executablePath: string };
    };

    const output: string[] = [];
    assert.equal(
        await runCli(["--help"], {
            cwd: process.cwd(),
            stderr: () => undefined,
            stdout: (text) => output.push(text),
        }),
        0,
    );
    const executable = /^Usage: (?<name>\S+)/u.exec(output.join(""))?.groups?.name;
    assert.equal(executable, protocol.cli.executableName);
    assert.deepEqual(packageManifest.bin, { [executable as string]: protocol.cli.executablePath });
    assert.equal(packageManifest.files.includes("dist/src"), true);
    assert.equal(packageManifest.files.includes("dist/public-errors.config.json"), true);
    assert.equal(packageManifest.files.includes("/api-reference.config.json"), true);
    assert.equal(packageManifest.files.includes("docs/generated/api-reference.md"), true);
    assert.equal(packageManifest.main, "dist/src/index.js");
    assert.equal(packageManifest.types, "dist/src/index.d.ts");
    assert.deepEqual(
        packageManifest.exports,
        withRequireCondition({
            ".": { import: "./dist/src/index.js", types: "./dist/src/index.d.ts" },
            "./applications": {
                import: "./dist/src/facades/applications.js",
                types: "./dist/src/facades/applications.d.ts",
            },
            "./canonical": {
                import: "./dist/src/facades/canonical.js",
                types: "./dist/src/facades/canonical.d.ts",
            },
            "./cli": {
                import: "./dist/src/facades/cli.js",
                types: "./dist/src/facades/cli.d.ts",
            },
            "./delegation": {
                import: "./dist/src/facades/delegation.js",
                types: "./dist/src/facades/delegation.d.ts",
            },
            "./effects": {
                import: "./dist/src/facades/effects.js",
                types: "./dist/src/facades/effects.d.ts",
            },
            "./operations": {
                import: "./dist/src/facades/operations.js",
                types: "./dist/src/facades/operations.d.ts",
            },
            "./providers": {
                import: "./dist/src/facades/providers.js",
                types: "./dist/src/facades/providers.d.ts",
            },
            "./read": {
                import: "./dist/src/facades/read.js",
                types: "./dist/src/facades/read.d.ts",
            },
            "./replay": {
                import: "./dist/src/facades/replay.js",
                types: "./dist/src/facades/replay.d.ts",
            },
            "./runs": {
                import: "./dist/src/facades/runs.js",
                types: "./dist/src/facades/runs.d.ts",
            },
            "./scopes": {
                import: "./dist/src/facades/scopes.js",
                types: "./dist/src/facades/scopes.d.ts",
            },
            "./supervision": {
                import: "./dist/src/facades/supervision.js",
                types: "./dist/src/facades/supervision.d.ts",
            },
            "./tasks": {
                import: "./dist/src/facades/tasks.js",
                types: "./dist/src/facades/tasks.d.ts",
            },
            "./trace": {
                import: "./dist/src/facades/trace.js",
                types: "./dist/src/facades/trace.d.ts",
            },
            "./workspace": {
                import: "./dist/src/facades/workspace.js",
                types: "./dist/src/facades/workspace.d.ts",
            },
        }),
    );
});

/** Adds the `default` condition (require(esm), #224) that names the same target as `import`. */
function withRequireCondition(
    exports: Readonly<Record<string, { readonly import: string; readonly types: string }>>,
): Readonly<Record<string, unknown>> {
    return Object.fromEntries(
        Object.entries(exports).map(([entry, conditions]) => [
            entry,
            { ...conditions, default: conditions.import },
        ]),
    );
}
