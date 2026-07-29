import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { synchronizeProtocolArtifacts } from "../scripts/generate-protocol-artifacts.ts";

const sourceConfigUrl = new URL("../protocol.config.json", import.meta.url);

test("protocol artifacts generate deterministically and pass check mode", async (context) => {
    const repositoryRoot = await createTemporaryRepository(context);
    const config = await readFile(sourceConfigUrl, "utf8");
    await writeFile(path.join(repositoryRoot, "protocol.config.json"), config);

    await synchronizeProtocolArtifacts({ repositoryRoot });
    await synchronizeProtocolArtifacts({ check: true, repositoryRoot });

    const generatedValues = await readFile(
        path.join(repositoryRoot, "src/protocol/values.generated.ts"),
        "utf8",
    );
    assert.match(generatedValues, /Generated from protocol\.config\.json/);
    assert.match(generatedValues, /\["capture", "declaration"\]/);

    await writeFile(
        path.join(repositoryRoot, "src/protocol/values.generated.ts"),
        `${generatedValues}\n`,
    );
    await assert.rejects(
        synchronizeProtocolArtifacts({ check: true, repositoryRoot }),
        /not synchronized/,
    );
});

test("record-view schema derives a nonzero ordinal floor from configuration", async (context) => {
    const repositoryRoot = await createTemporaryRepository(context);
    const sourceConfig = await readFile(sourceConfigUrl, "utf8");
    const config = sourceConfig.replace('"firstOwnerOrdinal": 0', '"firstOwnerOrdinal": 5');
    await writeFile(path.join(repositoryRoot, "protocol.config.json"), config);

    await synchronizeProtocolArtifacts({ repositoryRoot });

    const schema = JSON.parse(
        await readFile(
            path.join(repositoryRoot, "spec/schemas/record-view-v0.schema.json"),
            "utf8",
        ),
    ) as {
        readonly properties: {
            readonly owner_ordinal: {
                readonly minimum: number;
            };
        };
    };
    assert.equal(schema.properties.owner_ordinal.minimum, 5);
});

test("protocol artifact generation rejects paths outside the repository", async (context) => {
    const sourceConfig = await readFile(sourceConfigUrl, "utf8");

    for (const unsafePath of ["", path.join(tmpdir(), "artifact.ts"), "..", "../artifact.ts"]) {
        const repositoryRoot = await createTemporaryRepository(context);
        const config = sourceConfig.replace(
            '"src/protocol/values.generated.ts"',
            JSON.stringify(unsafePath),
        );
        await writeFile(path.join(repositoryRoot, "protocol.config.json"), config);

        await assert.rejects(
            synchronizeProtocolArtifacts({ repositoryRoot }),
            /unsafe protocol artifact path/,
        );
    }
});

test("protocol artifact generation rejects parent and artifact symlinks", async (context) => {
    const sourceConfig = await readFile(sourceConfigUrl, "utf8");
    const outsideRoot = await createTemporaryRepository(context);
    const parentLinkRoot = await createTemporaryRepository(context);
    await writeFile(path.join(parentLinkRoot, "protocol.config.json"), sourceConfig);
    await symlink(outsideRoot, path.join(parentLinkRoot, "src"), "dir");

    await assert.rejects(
        synchronizeProtocolArtifacts({ repositoryRoot: parentLinkRoot }),
        /artifact symlink/,
    );

    const artifactLinkRoot = await createTemporaryRepository(context);
    await writeFile(path.join(artifactLinkRoot, "protocol.config.json"), sourceConfig);
    await synchronizeProtocolArtifacts({ repositoryRoot: artifactLinkRoot });
    const generatedPath = path.join(artifactLinkRoot, "src/protocol/values.generated.ts");
    const outsideFile = path.join(outsideRoot, "outside.ts");
    await writeFile(outsideFile, "outside\n");
    await rm(generatedPath);
    await symlink(outsideFile, generatedPath);

    await assert.rejects(
        synchronizeProtocolArtifacts({ check: true, repositoryRoot: artifactLinkRoot }),
        /artifact symlink/,
    );
});

test("protocol artifact generation surfaces non-missing filesystem errors", async (context) => {
    const repositoryRoot = await createTemporaryRepository(context);
    const sourceConfig = await readFile(sourceConfigUrl, "utf8");
    await writeFile(path.join(repositoryRoot, "protocol.config.json"), sourceConfig);
    await writeFile(path.join(repositoryRoot, "src"), "not a directory");

    await assert.rejects(
        synchronizeProtocolArtifacts({ repositoryRoot }),
        (error: unknown) =>
            error instanceof Error &&
            "code" in error &&
            (error as NodeJS.ErrnoException).code === "ENOTDIR",
    );
});

async function createTemporaryRepository(context: { after(callback: () => unknown): void }) {
    const repositoryRoot = await mkdtemp(path.join(tmpdir(), "shepherd-protocol-test-"));
    context.after(() => rm(repositoryRoot, { force: true, recursive: true }));
    return repositoryRoot;
}
