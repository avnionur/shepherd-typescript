import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import {
    AppendIntentConflictError,
    reopenRetainedDeviceLayerWorld,
    SQLiteTraceStore,
} from "../../src/index.ts";

const [database, deviceId, ready, gate, commandId] = process.argv.slice(2);
assert.ok(database && deviceId && ready && gate && commandId);
using store = new SQLiteTraceStore(database);
const world = await reopenRetainedDeviceLayerWorld(store, { deviceId });
writeFileSync(ready, "ready");
const deadline = Date.now() + 30_000;
while (!existsSync(gate) && Date.now() < deadline)
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
assert.ok(existsSync(gate));
try {
    const result = await world.checkpoint({ commandId, name: commandId });
    console.log(JSON.stringify({ ok: true, result }));
} catch (error) {
    console.log(
        JSON.stringify({
            ok: false,
            headConflict: error instanceof AppendIntentConflictError,
            message: error instanceof Error ? error.message : String(error),
        }),
    );
}
