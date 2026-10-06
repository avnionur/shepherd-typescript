import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
    openRetainedDeviceLayerWorld,
    reopenRetainedDeviceLayerWorld,
    SQLiteTraceStore,
} from "../../src/index.ts";
import { temporaryDirectory } from "../replay/fixtures.ts";

const worker = fileURLToPath(new URL("../fixtures/device-layer-race-process.ts", import.meta.url));

test("two processes at the same journal head admit exactly one physical checkpoint", async (context) => {
    const directory = await temporaryDirectory(context, "device-race");
    const database = path.join(directory, "trace.sqlite");
    using store = new SQLiteTraceStore(database);
    const world = await openRetainedDeviceLayerWorld(store, {
        commandId: "create",
        root: directory,
    });
    await world.writeFile("note", Buffer.from("stable"));
    const gate = path.join(directory, "go");
    const ready = [path.join(directory, "one-ready"), path.join(directory, "two-ready")];
    const runs = ready.map(
        (signal, index) =>
            new Promise<{ ok: boolean; headConflict?: boolean }>((resolve, reject) => {
                const child = execFile(
                    process.execPath,
                    [worker, database, world.deviceId, signal, gate, index === 0 ? "one" : "two"],
                    { encoding: "utf8", timeout: 30_000 },
                    (error, stdout, stderr) => {
                        if (error) reject(new Error(stderr, { cause: error }));
                        else resolve(JSON.parse(stdout) as { ok: boolean; headConflict?: boolean });
                    },
                );
                context.after(() => child.kill("SIGKILL"));
            }),
    );
    const finished = Promise.all(runs);
    const deadline = Date.now() + 30_000;
    while (!ready.every((signal) => existsSync(signal)) && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(ready.every((signal) => existsSync(signal)));
    writeFileSync(gate, "go");
    const results = await finished;
    assert.equal(results.filter((result) => result.ok).length, 1);
    assert.equal(results.find((result) => !result.ok)?.headConflict, true, JSON.stringify(results));
    const reopened = await reopenRetainedDeviceLayerWorld(store, { deviceId: world.deviceId });
    assert.equal(reopened.layers().length, 2);
    assert.equal((await reopened.readFile("note")).toString(), "stable");
    await reopened.cleanup({ commandId: "cleanup" });
});
