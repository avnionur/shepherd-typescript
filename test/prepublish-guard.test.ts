import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
    assertPublishedTargetsExist,
    findMissingPublishedTargets,
} from "../tooling/release/prepublish-guard.ts";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

test("the prepublish guard reads every target from the manifest and names missing ones", async (context) => {
    const root = await mkdtemp(path.join(tmpdir(), "shepherd-prepublish-"));
    context.after(() => rm(root, { force: true, recursive: true }));
    await writeFile(
        path.join(root, "package.json"),
        JSON.stringify({
            bin: { tool: "out/cli.js" },
            exports: {
                ".": {
                    default: "./out/index.js",
                    import: "./out/index.js",
                    types: "./out/index.d.ts",
                },
            },
            main: "out/index.js",
            types: "out/index.d.ts",
        }),
    );
    assert.deepEqual(findMissingPublishedTargets(root), [
        "./out/index.d.ts",
        "./out/index.js",
        "out/cli.js",
        "out/index.d.ts",
        "out/index.js",
    ]);
    assert.throws(
        () => assertPublishedTargetsExist(root),
        /refusing to publish: package\.json targets are missing \(run `pnpm build` first\):\n- \.\/out\/index\.d\.ts/u,
    );
    await mkdir(path.join(root, "out"));
    for (const file of ["cli.js", "index.js", "index.d.ts"]) {
        await writeFile(path.join(root, "out", file), "");
    }
    assert.deepEqual(findMissingPublishedTargets(root), []);
    assert.doesNotThrow(() => assertPublishedTargetsExist(root));
});

test("the prepublish guard accepts manifests without bin or exports", async (context) => {
    const root = await mkdtemp(path.join(tmpdir(), "shepherd-prepublish-"));
    context.after(() => rm(root, { force: true, recursive: true }));
    await writeFile(path.join(root, "package.json"), JSON.stringify({ main: "index.js" }));

    assert.deepEqual(findMissingPublishedTargets(root), ["index.js"]);
    await writeFile(path.join(root, "index.js"), "");
    assert.deepEqual(findMissingPublishedTargets(root), []);
});

test("package.json publishes publicly with provenance and guards publication", async () => {
    const manifest = JSON.parse(
        await readFile(path.join(repositoryRoot, "package.json"), "utf8"),
    ) as {
        readonly publishConfig?: { readonly access?: string; readonly provenance?: boolean };
        readonly scripts: Readonly<Record<string, string>>;
    };
    assert.deepEqual(manifest.publishConfig, { access: "public", provenance: true });
    assert.equal(manifest.scripts.prepublishOnly, "node scripts/prepublish-guard.ts");
});
