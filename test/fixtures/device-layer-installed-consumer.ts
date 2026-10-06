import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type * as Trace from "../../src/facades/trace.ts";
import type * as Workspace from "../../src/facades/workspace.ts";

// Run twice against a fresh archive installation: <consumer-dir> <package-name> capture|restore.
const [consumer, packageName, mode] = process.argv.slice(2);
assert.ok(consumer && packageName && (mode === "capture" || mode === "restore"));
const require = createRequire(path.join(path.resolve(consumer), "probe.cjs"));
const workspace = require(`${packageName}/workspace`) as typeof Workspace;
const trace = require(`${packageName}/trace`) as typeof Trace;
using store = new trace.SQLiteTraceStore(path.join(consumer, "trace.sqlite"));
const reference = path.join(consumer, "device.json");
if (mode === "capture") {
    const world = await workspace.openRetainedDeviceLayerWorld(store, {
        commandId: "create",
        root: consumer,
    });
    await world.writeFile("note", Buffer.from("captured"));
    await world.checkpoint({ commandId: "capture", name: "one" });
    await world.writeFile("note", Buffer.from("mutable"));
    writeFileSync(reference, JSON.stringify({ deviceId: world.deviceId }));
    await world.close();
} else {
    const { deviceId } = JSON.parse(readFileSync(reference, "utf8")) as { deviceId: string };
    const world = await workspace.reopenRetainedDeviceLayerWorld(store, { deviceId });
    assert.equal((await world.readFile("note")).toString(), "mutable");
    await world.restore({ commandId: "restore", name: "one" });
    assert.equal((await world.readFile("note")).toString(), "captured");
    await world.cleanup({ commandId: "cleanup" });
    assert.equal(workspace.inspectRetainedDeviceLayerWorld(store, { deviceId }).status, "cleaned");
}
console.log(`installed device ${mode}: passed`);
