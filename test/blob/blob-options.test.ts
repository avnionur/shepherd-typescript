import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { resolveBlobDirectory } from "../../src/store/blob-options.ts";

test("blob directory resolution canonicalizes trusted bases without adopting other paths", () => {
    const currentDirectory = process.cwd();

    assert.equal(
        resolveBlobDirectory(":memory:", { blobDirectory: currentDirectory }).path,
        currentDirectory,
    );
    assert.equal(
        resolveBlobDirectory(":memory:", {
            blobDirectory: path.join(currentDirectory, "nested"),
        }).path,
        path.join(currentDirectory, "nested"),
    );
    assert.equal(
        resolveBlobDirectory(":memory:", { blobDirectory: path.dirname(currentDirectory) }).path,
        path.dirname(currentDirectory),
    );
});
