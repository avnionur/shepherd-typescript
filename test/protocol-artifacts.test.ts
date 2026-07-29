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

test("protocol generation rejects ordinal drift without a new ABI", async (context) => {
    const repositoryRoot = await createTemporaryRepository(context);
    const sourceConfig = await readFile(sourceConfigUrl, "utf8");
    const config = sourceConfig.replaceAll('"firstOwnerOrdinal": 0', '"firstOwnerOrdinal": 5');
    await writeFile(path.join(repositoryRoot, "protocol.config.json"), config);

    await assert.rejects(
        synchronizeProtocolArtifacts({ repositoryRoot }),
        /store migration constants/,
    );
});

test("protocol artifact generation rejects paths outside the repository", async (context) => {
    const sourceConfig = await readFile(sourceConfigUrl, "utf8");

    for (const unsafePath of [path.join(tmpdir(), "artifact.ts"), "..", "../artifact.ts"]) {
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

    const repositoryRoot = await createTemporaryRepository(context);
    const emptyPathConfig = sourceConfig.replace('"src/protocol/values.generated.ts"', '""');
    await writeFile(path.join(repositoryRoot, "protocol.config.json"), emptyPathConfig);
    await assert.rejects(
        synchronizeProtocolArtifacts({ repositoryRoot }),
        /recordValues must be a non-empty/,
    );
});

test("protocol artifact generation rejects protected and duplicate destinations", async (context) => {
    const sourceConfig = await readFile(sourceConfigUrl, "utf8");
    const protectedRoot = await createTemporaryRepository(context);
    const packagePath = path.join(protectedRoot, "package.json");
    await writeFile(packagePath, '{"preserved":true}\n');
    await writeFile(
        path.join(protectedRoot, "protocol.config.json"),
        sourceConfig.replace('"src/protocol/values.generated.ts"', '"package.json"'),
    );

    await assert.rejects(
        synchronizeProtocolArtifacts({ repositoryRoot: protectedRoot }),
        /artifact destinations/,
    );
    assert.equal(await readFile(packagePath, "utf8"), '{"preserved":true}\n');

    const duplicateRoot = await createTemporaryRepository(context);
    await writeFile(
        path.join(duplicateRoot, "protocol.config.json"),
        sourceConfig.replace(
            '"spec/schemas/record-view-v0.schema.json"',
            '"spec/schemas/record-body-v0.schema.json"',
        ),
    );
    await assert.rejects(
        synchronizeProtocolArtifacts({ repositoryRoot: duplicateRoot }),
        /destinations must be unique/,
    );
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
