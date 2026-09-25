import assert from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { packWithConfiguredPacker } from "../tooling/release/pack.ts";

/** Fake packer: node evaluates `script` with the destination as `process.argv[1]`. */
function fakePacker(script: string): readonly string[] {
    return [process.execPath, "-e", script];
}

async function temporaryRoot(context: { after(callback: () => unknown): void }): Promise<string> {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), "shepherd-pack-")));
    context.after(() => rm(root, { force: true, recursive: true }));
    return root;
}

test("the configured packer's JSON result names the tarball in the destination", async (context) => {
    const root = await temporaryRoot(context);
    const destination = path.join(root, "out");
    // The fake packer checks its argument, working directory, and environment before answering.
    const checkedArray = fakePacker(
        [
            "if (process.argv[1] !== process.env.EXPECTED_DESTINATION) process.exit(3);",
            "if (process.cwd() !== process.env.EXPECTED_ROOT) process.exit(4);",
            "if (process.env.npm_config_update_notifier !== 'false') process.exit(5);",
            "process.stdout.write(JSON.stringify([{ filename: 'pkg-1.0.0.tgz' }]));",
        ].join(""),
    );

    assert.equal(
        await packWithConfiguredPacker({
            destination,
            environment: { EXPECTED_DESTINATION: destination, EXPECTED_ROOT: root },
            packCommand: checkedArray,
            repositoryRoot: root,
        }),
        path.join(destination, "pkg-1.0.0.tgz"),
    );
    assert.equal(
        await packWithConfiguredPacker({
            destination,
            packCommand: fakePacker(
                "process.stdout.write(JSON.stringify({ pkg: { filename: 'keyed-2.0.0.tgz' } }))",
            ),
            repositoryRoot: root,
        }),
        path.join(destination, "keyed-2.0.0.tgz"),
    );
});

test("the packer refuses empty commands, failed runs, and results without a tarball", async (context) => {
    const root = await temporaryRoot(context);
    const destination = path.join(root, "out");

    await assert.rejects(
        packWithConfiguredPacker({ destination, packCommand: [], repositoryRoot: root }),
        /pack command is empty/u,
    );
    await assert.rejects(
        packWithConfiguredPacker({
            destination,
            packCommand: fakePacker("process.exit(7)"),
            repositoryRoot: root,
        }),
        /exited with 7/u,
    );
    await assert.rejects(
        packWithConfiguredPacker({
            destination,
            packCommand: [path.join(root, "missing-packer")],
            repositoryRoot: root,
        }),
        (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT",
    );
    for (const output of ["[]", "{}", '[{"filename":7}]']) {
        await assert.rejects(
            packWithConfiguredPacker({
                destination,
                packCommand: fakePacker(`process.stdout.write(${JSON.stringify(output)})`),
                repositoryRoot: root,
            }),
            /pack produced no tarball/u,
        );
    }
    await assert.rejects(
        packWithConfiguredPacker({
            destination,
            packCommand: fakePacker("process.stdout.write('not json')"),
            repositoryRoot: root,
        }),
        SyntaxError,
    );
});
