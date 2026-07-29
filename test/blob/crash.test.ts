import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { access, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { setTimeout } from "node:timers/promises";

import { SQLiteTraceStore } from "../../src/index.ts";

test("a process crash after blob publication leaves no false receipt and remains retryable", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-blob-crash-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const databasePath = path.join(directory, "trace.sqlite");
    const blobDirectory = path.join(directory, "blobs");
    const content = new TextEncoder().encode("shepherd");
    const blobId = "sha256:def3735d7a0d2696775d6d72f379e4536c4d9e3cd6367f27a0bcb7f40d4558fb";
    const digest = blobId.slice("sha256:".length);
    const bucket = path.join(blobDirectory, digest.slice(0, 2));
    const blobPath = path.join(bucket, digest);
    new SQLiteTraceStore(databasePath, { blobDirectory }).close();

    const moduleUrl = new URL("../../src/index.ts", import.meta.url).href;
    const childSource = `
        import { SQLiteTraceStore } from ${JSON.stringify(moduleUrl)};
        const store = new SQLiteTraceStore(
            ${JSON.stringify(databasePath)},
            { blobDirectory: ${JSON.stringify(blobDirectory)} },
        );
        process.stdout.write("ready\\n");
        process.stdin.once("data", () => {
            store.putBlob(new TextEncoder().encode("shepherd"));
            process.stdout.write("unexpected-commit\\n");
        });
    `;
    const child = spawn(process.execPath, ["--input-type=module", "--eval", childSource], {
        stdio: ["pipe", "pipe", "pipe"],
    });
    context.after(() => {
        if (child.exitCode === null && child.signalCode === null) {
            child.kill("SIGKILL");
        }
    });
    const [readyOutput] = (await once(child.stdout, "data")) as [Buffer];
    assert.equal(readyOutput.toString(), "ready\n");

    const lock = new DatabaseSync(databasePath);
    lock.exec("BEGIN IMMEDIATE");
    child.stdin.write("put");
    await waitForPublishedBlob(blobPath, bucket);
    assert.equal(child.kill("SIGKILL"), true);
    const [, signal] = (await once(child, "exit")) as [number | null, NodeJS.Signals | null];
    assert.equal(signal, "SIGKILL");
    lock.exec("ROLLBACK");
    lock.close();

    const reopened = new SQLiteTraceStore(databasePath, { blobDirectory });
    assert.equal(reopened.readBlob(blobId), undefined);
    assert.equal(reopened.putBlob(content).blob_id, blobId);
    assert.deepEqual(reopened.readBlob(blobId), content);
    assert.deepEqual(
        (await readdir(bucket)).filter((name) => name.startsWith(".tmp-")),
        [],
    );
    reopened.close();
});

async function waitForPublishedBlob(blobPath: string, bucket: string): Promise<void> {
    for (let attempt = 0; attempt < 200; attempt += 1) {
        try {
            await access(blobPath);
            const entries = await readdir(bucket);
            if (!entries.some((name) => name.startsWith(".tmp-"))) {
                return;
            }
        } catch {
            // Publication has not reached the durable filesystem boundary yet.
        }
        await setTimeout(10);
    }
    throw new Error("child did not publish the blob before the crash-test deadline");
}
