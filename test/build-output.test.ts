import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
    assertSafeBuildOutputDirectory,
    cleanBuildOutput,
    copyRuntimeConfiguration,
    resolveBuildOutputDirectory,
} from "../tooling/build/output.ts";

test("resolveBuildOutputDirectory returns the repository build directory", () => {
    assert.equal(
        resolveBuildOutputDirectory(),
        path.resolve(fileURLToPath(new URL("../dist", import.meta.url))),
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

test("build output cleanup and runtime configuration copying use the validated output seam", async (context) => {
    const repositoryRoot = await mkdtemp(path.join(tmpdir(), "shepherd-build-actions-test-"));
    const externalRoot = await mkdtemp(path.join(tmpdir(), "shepherd-build-actions-external-"));
    context.after(() => rm(repositoryRoot, { force: true, recursive: true }));
    context.after(() => rm(externalRoot, { force: true, recursive: true }));
    const configurationPath = path.join(repositoryRoot, "tsconfig.build.json");
    const firstConfigPath = path.join(repositoryRoot, "protocol.config.json");
    const secondConfigPath = path.join(repositoryRoot, "public-errors.config.json");
    const outputDirectory = path.join(repositoryRoot, "dist");
    const options = {
        configurationPath,
        configurationUrls: [pathToFileURL(firstConfigPath), pathToFileURL(secondConfigPath)],
        repositoryRoot,
    };
    await writeFile(configurationPath, JSON.stringify({ compilerOptions: { outDir: "dist" } }));
    await writeFile(firstConfigPath, "protocol\n");
    await writeFile(secondConfigPath, "errors\n");

    await copyRuntimeConfiguration(options);
    assert.equal(
        await readFile(path.join(outputDirectory, "protocol.config.json"), "utf8"),
        "protocol\n",
    );
    assert.equal(
        await readFile(path.join(outputDirectory, "public-errors.config.json"), "utf8"),
        "errors\n",
    );

    await cleanBuildOutput(options);
    await assert.rejects(readFile(outputDirectory), { code: "ENOENT" });

    await copyRuntimeConfiguration({ configurationPath, repositoryRoot });
    assert.deepEqual(
        JSON.parse(await readFile(path.join(outputDirectory, "protocol.config.json"), "utf8")),
        JSON.parse(await readFile(new URL("../protocol.config.json", import.meta.url), "utf8")),
    );
    assert.deepEqual(
        JSON.parse(await readFile(path.join(outputDirectory, "public-errors.config.json"), "utf8")),
        JSON.parse(
            await readFile(new URL("../public-errors.config.json", import.meta.url), "utf8"),
        ),
    );
    await cleanBuildOutput({ configurationPath, repositoryRoot });

    await symlink(externalRoot, outputDirectory, "dir");
    await assert.rejects(copyRuntimeConfiguration(options), /must not contain symlinks/u);
    await assert.rejects(readFile(path.join(externalRoot, "protocol.config.json")), {
        code: "ENOENT",
    });
});
