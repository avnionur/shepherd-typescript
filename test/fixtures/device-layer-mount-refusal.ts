import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
    inspectRetainedDeviceLayerWorld,
    openRetainedDeviceLayerWorld,
    SQLiteTraceStore,
} from "../../src/index.ts";
import { workspaceProtocolConfig } from "../../src/protocol/config.ts";

const overlay = workspaceProtocolConfig.carrierBackends.overlay;
assert.ok(
    overlay.platforms.includes(process.platform),
    "run inside the supported Linux mount namespace",
);
const directory = mkdtempSync(path.join(tmpdir(), "shepherd-device-mount-"));
const outside = path.join(directory, "unrelated");
mkdirSync(outside);
writeFileSync(path.join(outside, "keep.txt"), "preserve");
using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
const world = await openRetainedDeviceLayerWorld(store, {
    commandId: "create",
    root: directory,
    adapter: workspaceProtocolConfig.deviceLayers.retained.adapters.copy,
});
await world.writeFile("owned.txt", Buffer.from("owned"));
await world.checkpoint({ commandId: "checkpoint", name: "one" });
const mounted = path.join(world.path, "borrowed");
mkdirSync(mounted);
execFileSync(overlay.mountExecutable, ["--bind", outside, mounted]);
try {
    const before = store.exportTrace();
    const diagnosis = inspectRetainedDeviceLayerWorld(store, { deviceId: world.deviceId });
    assert.equal(diagnosis.status, "unavailable");
    assert.match(diagnosis.reason ?? "", /mount/u);
    await assert.rejects(world.restore({ commandId: "restore", name: "one" }), /mount/u);
    await assert.rejects(world.cleanup({ commandId: "cleanup" }), /mount/u);
    assert.equal(store.exportTrace(), before);
    assert.equal(readFileSync(path.join(outside, "keep.txt"), "utf8"), "preserve");
} finally {
    execFileSync(overlay.unmountExecutable, [mounted]);
}
await world.cleanup({ commandId: "cleanup" });
assert.equal(readFileSync(path.join(outside, "keep.txt"), "utf8"), "preserve");
console.log(
    JSON.stringify({ directory, foreignBindMountRefused: true, unrelatedBytesPreserved: true }),
);
