import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openRetainedDeviceLayerWorld, SQLiteTraceStore } from "../../src/index.ts";
import { workspaceProtocolConfig } from "../../src/protocol/config.ts";

const [directory, adapter, point] = process.argv.slice(2);
assert.ok(directory && adapter && point);
const config = workspaceProtocolConfig.deviceLayers.retained;
using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
const world = await openRetainedDeviceLayerWorld(store, {
    commandId: "create",
    root: directory,
    adapter,
    depth: { maxDepth: 4, retainNewest: 1 },
});
for (const name of ["one", "two", "three"]) {
    await world.writeFile("notes.txt", Buffer.from(name));
    await world.checkpoint({ commandId: `checkpoint:${name}`, name });
}
await world.writeFile("notes.txt", Buffer.from("uncheckpointed"));
fs.writeFileSync(
    path.join(directory, "reference.json"),
    JSON.stringify({ deviceId: world.deviceId }),
);
let armed = true;
const originalWrite = fs.writeSync;
const stop = (): void => {
    if (!armed) return;
    armed = false;
    originalWrite(1, "READY\n");
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
};
const descriptors = new Map<number, string>();
const originalOpen = fs.openSync;
Object.defineProperty(fs, "openSync", {
    value: (...args: unknown[]) => {
        const descriptor = Reflect.apply(originalOpen, fs, args) as number;
        descriptors.set(descriptor, String(args[0]));
        return descriptor;
    },
});
const originalSync = fs.fsyncSync;
Object.defineProperty(fs, "fsyncSync", {
    value: (descriptor: number) => {
        originalSync(descriptor);
        if (!armed || point === "cleanup") return;
        const target = descriptors.get(descriptor) ?? "";
        if (!target.endsWith(path.join(config.treeDirectory, "notes.txt"))) return;
        const body = store.readOwner(world.deviceId).at(-1)?.body;
        if (body?.phase !== config.phases.prepared) return;
        const plan = body.plan as { compaction: { into: string } | null };
        if (point === "restore" && target.includes(config.writableDirectoryPrefix)) stop();
        if (
            point === "freeze" &&
            target.includes(`${path.sep}${config.layersDirectory}${path.sep}`)
        )
            stop();
        if (
            point === "compaction" &&
            plan.compaction !== null &&
            target.includes(`${path.sep}${plan.compaction.into}${path.sep}`)
        )
            stop();
    },
});
const originalRemove = fs.rmSync;
Object.defineProperty(fs, "rmSync", {
    value: (...args: unknown[]) => {
        Reflect.apply(originalRemove, fs, args);
        if (
            armed &&
            point === "cleanup" &&
            String(args[0]).includes(`${path.sep}${config.layersDirectory}${path.sep}`)
        )
            stop();
    },
});
const originalSpawn = childProcess.spawnSync;
Object.defineProperty(childProcess, "spawnSync", {
    value: (...args: unknown[]) => {
        const commandArgs = args[1] as string[];
        if (
            armed &&
            point === "helper" &&
            commandArgs?.[1]?.endsWith(path.join(config.treeDirectory, "notes.txt"))
        ) {
            const relays = ["before", "after"].map((label) => {
                const gate = path.join(directory, `clone-${label}-gate`);
                const result = path.join(directory, `clone-${label}-result.json`);
                const relay = childProcess.spawn(
                    process.execPath,
                    [
                        fileURLToPath(new URL("./device-layer-delayed-clone.ts", import.meta.url)),
                        args[0] as string,
                        commandArgs[0] as string,
                        commandArgs[1] as string,
                        gate,
                        result,
                    ],
                    { detached: true, stdio: "ignore" },
                );
                relay.unref();
                return {
                    pid: relay.pid,
                    gate,
                    result,
                    source: commandArgs[0],
                    target: commandArgs[1],
                };
            });
            fs.writeFileSync(path.join(directory, "clone-relay.json"), JSON.stringify(relays));
            stop();
        }
        return Reflect.apply(originalSpawn, childProcess, args);
    },
});
syncBuiltinESMExports();
if (point === "restore") await world.restore({ commandId: "interrupted", name: "one" });
else if (point === "cleanup") await world.cleanup({ commandId: "interrupted" });
else await world.checkpoint({ commandId: "interrupted", name: "killed" });
assert.fail("fault hook did not stop the worker");
