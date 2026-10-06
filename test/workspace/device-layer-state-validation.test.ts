import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { openRetainedDeviceLayerWorld, SQLiteTraceStore } from "../../src/index.ts";
import { workspaceProtocolConfig } from "../../src/protocol/config.ts";
import { validateRetainedDeviceState } from "../../src/workspace/retained-device-physical.ts";
import { planRetainedDeviceCommand } from "../../src/workspace/retained-device-plans.ts";
import { readRetainedDeviceHead } from "../../src/workspace/retained-device-records.ts";
import { temporaryDirectory } from "../replay/fixtures.ts";

test("retained state rejects invalid counters, names, ownership identities and escaping resources", async (context) => {
    const directory = await temporaryDirectory(context, "device-state-validation");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const world = await openRetainedDeviceLayerWorld(store, {
        commandId: "create",
        root: directory,
    });
    const state = readRetainedDeviceHead(store, world.deviceId).body.state;
    const config = workspaceProtocolConfig.deviceLayers.retained;
    const invalid = [
        { generation: -1 },
        { ordinal: 0 },
        { generation: Infinity },
        { root: "relative" },
        { configuration_id: "wrong" },
        { adapter: "unsupported" },
        { parent_identity: { device: "bad", inode: "1" } },
        { root_identity: { device: "1", inode: "bad" } },
        { retired: ["base"] },
        { retired: ["invalid/name"] },
        { writable: { ...state.writable, directory: false } },
        { writable: { ...state.writable, directory: path.join(directory, "outside") } },
        { layers: [{ ...state.layers[0], layer: "wrong" }] },
        { layers: [{ ...state.layers[0], layer: "1" }] },
        { layers: [{ ...state.layers[0], tree: { ...state.layers[0]!.tree, content_id: null } }] },
        { garbage: [{ ...state.writable, identity: null }] },
        { garbage: [{ ...state.writable, payload_identity: null }] },
        { garbage: [state.writable] },
    ];
    for (const change of invalid)
        assert.throws(
            () => validateRetainedDeviceState(world.deviceId, { ...state, ...change } as never),
            TypeError,
            JSON.stringify(change),
        );
    assert.throws(
        () =>
            planRetainedDeviceCommand(
                { ...state, generation: Number.MAX_SAFE_INTEGER },
                config.actions.cleanup,
                undefined,
                null,
            ),
        /generation/u,
    );
    assert.throws(
        () =>
            planRetainedDeviceCommand(
                { ...state, ordinal: Number.MAX_SAFE_INTEGER },
                config.actions.checkpoint,
                "one",
                state.layers[0]!.tree.content_id,
            ),
        /ordinal/u,
    );
    assert.throws(
        () => planRetainedDeviceCommand(state, config.actions.checkpoint, "one", null),
        /content identity/u,
    );
    await world.cleanup({ commandId: "cleanup" });
});
