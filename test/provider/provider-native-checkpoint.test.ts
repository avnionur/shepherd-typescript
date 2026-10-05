import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { SQLiteTraceStore } from "../../src/index.ts";
import { temporaryDirectory } from "../replay/fixtures.ts";

const worker = fileURLToPath(
    new URL("../fixtures/provider-native-checkpoint-process.ts", import.meta.url),
);

test("native tool-use, tool-result, system and definition prefix bytes survive restart and native import", async (context) => {
    const directory = await temporaryDirectory(context, "native-provider-checkpoint");
    const database = path.join(directory, "source.sqlite");
    const metadata = path.join(directory, "checkpoint.json");
    execFileSync(process.execPath, [worker, "capture", database, metadata]);
    for (const [target, command] of [
        [database, "restart"],
        [path.join(directory, "imported.sqlite"), "imported"],
    ] as const) {
        if (target !== database) {
            using source = new SQLiteTraceStore(database, { readOnly: true });
            using imported = new SQLiteTraceStore(target);
            imported.importTrace(source.exportTrace());
        }
        const result = JSON.parse(
            execFileSync(process.execPath, [worker, "restore", target, metadata, command], {
                encoding: "utf8",
            }),
        ) as {
            status: string;
            bodies: string[];
            restoredContext: string;
            expectedBody: string;
            expectedContext: string;
        };
        assert.equal(result.status, "finished");
        assert.deepEqual(result.bodies, [result.expectedBody]);
        assert.equal(result.restoredContext, result.expectedContext);
        assert.match(result.expectedBody, /tool_use/u);
        assert.match(result.expectedBody, /tool_result/u);
        assert.match(result.expectedBody, /fixture_echo/u);
    }
});
