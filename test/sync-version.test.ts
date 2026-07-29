import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { parseReleaseConfig, synchronizeVersions } from "../scripts/sync-version.ts";

test("parseReleaseConfig accepts ordinary YAML formatting", () => {
    assert.deepEqual(
        parseReleaseConfig(`
cognia:
  version: "1.2.3"
versionFiles: [package.json]
`),
        {
            version: "1.2.3",
            versionFiles: ["package.json"],
        },
    );
});

test("parseReleaseConfig rejects invalid configuration shapes", () => {
    const invalidConfigurations = [
        "",
        "{}",
        "cognia:\n  version: 1\nversionFiles: []\n",
        "cognia:\n  version: next\nversionFiles: []\n",
        "cognia:\n  version: 1.2.3\nversionFiles: package.json\n",
        "cognia:\n  version: 1.2.3\nversionFiles: [1]\n",
    ];

    for (const configuration of invalidConfigurations) {
        assert.throws(() => parseReleaseConfig(configuration), /release-config\.yaml must define/);
    }
});

test("synchronizeVersions updates configured JSON manifests", async (context) => {
    const repositoryRoot = await createTemporaryRepository(context);
    const configPath = path.join(repositoryRoot, "release-config.yaml");
    const packagePath = path.join(repositoryRoot, "package.json");
    await writeFile(configPath, "cognia:\n  version: 1.2.3\nversionFiles:\n  - package.json\n");
    await writeFile(packagePath, '{"name":"example","version":"0.0.1"}\n');

    assert.equal(await synchronizeVersions({ configPath, repositoryRoot }), 1);
    assert.deepEqual(JSON.parse(await readFile(packagePath, "utf8")), {
        name: "example",
        version: "1.2.3",
    });
});

test("synchronizeVersions rejects unsafe paths", async (context) => {
    const repositoryRoot = await createTemporaryRepository(context);
    const configPath = path.join(repositoryRoot, "release-config.yaml");
    const unsafePaths = [
        "",
        String.raw`directory\file.json`,
        "%2e%2e/outside.json",
        "?file.json",
        path.join(repositoryRoot, "package.json"),
    ];

    for (const unsafePath of unsafePaths) {
        await writeFile(
            configPath,
            `cognia:\n  version: 1.2.3\nversionFiles:\n  - ${JSON.stringify(unsafePath)}\n`,
        );
        await assert.rejects(synchronizeVersions({ configPath, repositoryRoot }), /unsafe path/);
    }
});

test("synchronizeVersions rejects symlinks that escape the repository", async (context) => {
    const repositoryRoot = await createTemporaryRepository(context);
    const outsideRoot = await createTemporaryRepository(context);
    const configPath = path.join(repositoryRoot, "release-config.yaml");
    const outsidePath = path.join(outsideRoot, "outside.json");
    await writeFile(outsidePath, '{"version":"0.0.1"}\n');
    await symlink(outsidePath, path.join(repositoryRoot, "linked.json"));
    await writeFile(configPath, "cognia:\n  version: 1.2.3\nversionFiles:\n  - linked.json\n");

    await assert.rejects(
        synchronizeVersions({ configPath, repositoryRoot }),
        /escapes the repository/,
    );
});

test("synchronizeVersions validates every target before writing", async (context) => {
    const repositoryRoot = await createTemporaryRepository(context);
    const configPath = path.join(repositoryRoot, "release-config.yaml");
    const packagePath = path.join(repositoryRoot, "package.json");
    await writeFile(
        configPath,
        "cognia:\n  version: 1.2.3\nversionFiles:\n  - package.json\n  - invalid.json\n",
    );
    await writeFile(packagePath, '{"name":"example","version":"0.0.1"}\n');
    await writeFile(path.join(repositoryRoot, "invalid.json"), "[]\n");

    await assert.rejects(
        synchronizeVersions({ configPath, repositoryRoot }),
        /must contain a JSON object/,
    );
    assert.equal(await readFile(packagePath, "utf8"), '{"name":"example","version":"0.0.1"}\n');
});

async function createTemporaryRepository(context: { after(callback: () => unknown): void }) {
    const repositoryRoot = await mkdtemp(path.join(tmpdir(), "shepherd-version-test-"));
    context.after(() => rm(repositoryRoot, { force: true, recursive: true }));
    return repositoryRoot;
}
