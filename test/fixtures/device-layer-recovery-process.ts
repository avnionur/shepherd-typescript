import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
    inspectRetainedDeviceLayerWorld,
    openRetainedDeviceLayerWorld,
    reopenRetainedDeviceLayerWorld,
    SQLiteTraceStore,
} from "../../src/index.ts";

const [mode, directory] = process.argv.slice(2);
assert.ok(directory);
using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
const metadataPath = path.join(directory, "reference.json");
if (mode === "capture") {
    const world = await openRetainedDeviceLayerWorld(store, {
        commandId: "create",
        root: directory,
        adapter: "copy",
        depth: { maxDepth: 4, retainNewest: 1 },
    });
    await world.writeFile("notes.txt", Buffer.from("one"));
    await world.checkpoint({ commandId: "capture-one", name: "one" });
    await world.writeFile("notes.txt", Buffer.from("two"));
    await world.checkpoint({ commandId: "capture-two", name: "two" });
    await world.writeFile("notes.txt", Buffer.from("uncheckpointed"));
    writeFileSync(metadataPath, JSON.stringify({ deviceId: world.deviceId }));
    await world.close();
} else {
    assert.equal(mode, "restore");
    const { deviceId } = JSON.parse(readFileSync(metadataPath, "utf8")) as { deviceId: string };
    const world = await reopenRetainedDeviceLayerWorld(store, { deviceId });
    assert.deepEqual(
        world.layers().map((layer) => layer.checkpoint),
        ["base", "one", "two"],
    );
    assert.equal((await world.readFile("notes.txt")).toString(), "uncheckpointed");
    await world.restore({ commandId: "restore-one", name: "one" });
    assert.equal((await world.readFile("notes.txt")).toString(), "one");
    assert.deepEqual(
        world.layers().map((layer) => layer.checkpoint),
        ["base", "one"],
    );
    const diagnosis = inspectRetainedDeviceLayerWorld(store, { deviceId });
    assert.equal(diagnosis.status, "ready");
    assert.ok(diagnosis.generation > 0);
    assert.ok(store.readRecord(diagnosis.headRecordId));
    await world.close();
    console.log(JSON.stringify({ deviceId, status: diagnosis.status, restored: "one" }));
}
