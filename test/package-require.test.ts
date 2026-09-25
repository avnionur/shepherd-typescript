import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { resolveBuildOutputDirectory } from "../tooling/build/output.ts";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(repositoryRoot, "package.json"), "utf8")) as {
    readonly exports: Readonly<Record<string, Readonly<Record<string, string>>>>;
};
const requireModule = createRequire(import.meta.url);

test("every export condition set lets require() and import load the same target", () => {
    for (const [entry, conditions] of Object.entries(manifest.exports)) {
        assert.deepEqual(Object.keys(conditions), ["types", "import", "default"], entry);
        assert.equal(conditions.default, conditions.import, entry);
    }
});

test("no export's module graph uses top-level await, so require(esm) stays viable", () => {
    const outputDirectory = resolveBuildOutputDirectory();
    for (const [entry, conditions] of Object.entries(manifest.exports)) {
        const target = conditions.import;
        assert.ok(target, entry);
        const source = path
            .join(repositoryRoot, path.relative(outputDirectory, path.join(repositoryRoot, target)))
            .replace(/\.js$/u, ".ts");
        assert.doesNotThrow(() => requireModule(source), `${entry} (${source})`);
    }
});

test("the require(esm) guard detects top-level await", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-require-esm-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const modulePath = path.join(directory, "awaits.mjs");
    await writeFile(modulePath, "await Promise.resolve();\nexport const ready = true;\n");
    assert.throws(() => requireModule(modulePath), { code: "ERR_REQUIRE_ASYNC_MODULE" });
});
