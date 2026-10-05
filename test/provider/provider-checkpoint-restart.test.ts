import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { SQLiteTraceStore } from "../../src/index.ts";
import { temporaryDirectory } from "../replay/fixtures.ts";

const worker = fileURLToPath(
    new URL("../fixtures/provider-checkpoint-process.ts", import.meta.url),
);

test("process-local conversation receipts refuse a fresh-process restore without reconstruction", async (context) => {
    const directory = await temporaryDirectory(context, "provider-memory-control");
    const args = [
        path.join(directory, "trace.sqlite"),
        path.join(directory, "checkpoint.json"),
        "memory",
    ];
    execFileSync(process.execPath, [worker, "capture", ...args]);
    const result = JSON.parse(
        execFileSync(process.execPath, [worker, "restore", ...args], { encoding: "utf8" }),
    ) as { status: string; failure: string; bodies: unknown[] };
    assert.equal(result.status, "failed");
    assert.match(result.failure, /does not hold/u);
    assert.deepEqual(result.bodies, []);
});

test("retained provider checkpoints restore exact request bytes and context in a fresh process", async (context) => {
    const directory = await temporaryDirectory(context, "provider-retained-restart");
    const args = [
        path.join(directory, "trace.sqlite"),
        path.join(directory, "checkpoint.json"),
        "retained",
    ];
    execFileSync(process.execPath, [worker, "capture", ...args]);
    const result = JSON.parse(
        execFileSync(process.execPath, [worker, "restore", ...args], { encoding: "utf8" }),
    ) as {
        status: string;
        bodies: string[];
        context: string;
        expectedBody: string;
        expectedContext: string;
    };
    assert.equal(result.status, "finished");
    assert.deepEqual(result.bodies, [result.expectedBody]);
    assert.equal(result.context, result.expectedContext);
    const importedPath = path.join(directory, "imported.sqlite");
    using source = new SQLiteTraceStore(args[0], { readOnly: true });
    using imported = new SQLiteTraceStore(importedPath);
    imported.importTrace(source.exportTrace());
    imported.close();
    const importedResult = JSON.parse(
        execFileSync(
            process.execPath,
            [worker, "restore", importedPath, args[1] as string, "retained", "imported-restart"],
            { encoding: "utf8" },
        ),
    ) as typeof result;
    assert.equal(importedResult.status, "finished");
    assert.deepEqual(importedResult.bodies, [result.expectedBody]);
    assert.equal(importedResult.context, result.expectedContext);
});
