import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
    assertSafeBuildOutputDirectory,
    resolveBuildOutputDirectory,
} from "../scripts/build-output.ts";

test("resolveBuildOutputDirectory returns the repository build directory", () => {
    assert.equal(
        resolveBuildOutputDirectory(),
        path.resolve(new URL("../dist", import.meta.url).pathname),
    );
});

test("resolveBuildOutputDirectory accepts contained output and rejects unsafe configuration", async (context) => {
    const repositoryRoot = await mkdtemp(path.join(tmpdir(), "shepherd-build-output-test-"));
    context.after(() => rm(repositoryRoot, { force: true, recursive: true }));
    const configurationPath = path.join(repositoryRoot, "tsconfig.build.json");

    await writeFile(configurationPath, JSON.stringify({ compilerOptions: { outDir: "output" } }));
    assert.equal(
        resolveBuildOutputDirectory({ configurationPath, repositoryRoot }),
        path.join(repositoryRoot, "output"),
    );
    await assertSafeBuildOutputDirectory(path.join(repositoryRoot, "output"), repositoryRoot);
    await mkdir(path.join(repositoryRoot, "output"));
    await assertSafeBuildOutputDirectory(path.join(repositoryRoot, "output"), repositoryRoot);
    await assert.rejects(
        assertSafeBuildOutputDirectory(path.join(repositoryRoot, "..", "output"), repositoryRoot),
        /must remain inside/,
    );
    await assert.rejects(
        assertSafeBuildOutputDirectory(repositoryRoot, repositoryRoot),
        /must remain inside/,
    );

    await writeFile(
        configurationPath,
        JSON.stringify({ compilerOptions: { outDir: "../output" } }),
    );
    assert.throws(
        () => resolveBuildOutputDirectory({ configurationPath, repositoryRoot }),
        /must remain inside/,
    );

    await writeFile(configurationPath, JSON.stringify({ compilerOptions: {} }));
    assert.throws(
        () => resolveBuildOutputDirectory({ configurationPath, repositoryRoot }),
        /must remain inside/,
    );
});

test("assertSafeBuildOutputDirectory rejects symlink ancestors without touching their targets", async (context) => {
    const repositoryRoot = await mkdtemp(path.join(tmpdir(), "shepherd-build-root-test-"));
    const externalRoot = await mkdtemp(path.join(tmpdir(), "shepherd-build-external-test-"));
    context.after(() => rm(repositoryRoot, { force: true, recursive: true }));
    context.after(() => rm(externalRoot, { force: true, recursive: true }));
    const markerPath = path.join(externalRoot, "marker.txt");
    await writeFile(markerPath, "preserved");
    await symlink(externalRoot, path.join(repositoryRoot, "linked-output"), "dir");

    await assert.rejects(
        assertSafeBuildOutputDirectory(
            path.join(repositoryRoot, "linked-output", "dist"),
            repositoryRoot,
        ),
        /must not contain symlinks/,
    );
    assert.equal(await readFile(markerPath, "utf8"), "preserved");
});
