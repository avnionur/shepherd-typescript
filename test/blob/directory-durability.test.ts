import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { createMissingDirectory } from "../../src/blob/directory-durability.ts";

test("createMissingDirectory reports a directory another caller already created", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-directory-race-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const target = path.join(directory, "blobs");

    assert.equal(createMissingDirectory(target), true);
    assert.equal((await stat(target)).isDirectory(), true);
    assert.equal(createMissingDirectory(target), false);
    assert.throws(
        () => createMissingDirectory(path.join(directory, "missing", "blobs")),
        (error: NodeJS.ErrnoException) => error.code === "ENOENT",
    );
});
