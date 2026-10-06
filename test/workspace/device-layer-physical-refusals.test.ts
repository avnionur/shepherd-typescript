import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { openRetainedDeviceLayerWorld, SQLiteTraceStore } from "../../src/index.ts";
import { workspaceProtocolConfig } from "../../src/protocol/config.ts";
import {
    assertRetainedDevicePending,
    assertRetainedDevicePhysical,
    assertRetainedDeviceTree,
    cleanupRetainedDeviceGarbage,
    materializeRetainedDevicePlan,
} from "../../src/workspace/retained-device-physical.ts";
import { planRetainedDeviceCommand } from "../../src/workspace/retained-device-plans.ts";
import {
    type RetainedDeviceJournal,
    type RetainedDeviceState,
    readRetainedDeviceHead,
} from "../../src/workspace/retained-device-records.ts";
import { temporaryDirectory } from "../replay/fixtures.ts";

const config = workspaceProtocolConfig.deviceLayers.retained;

test("physical admission rejects unpublished roots, corrupt snapshots and invalid pending plans", async (context) => {
    const directory = await temporaryDirectory(context, "device-physical-refusals");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const world = await openRetainedDeviceLayerWorld(store, {
        commandId: "create",
        root: directory,
    });
    const state = readRetainedDeviceHead(store, world.deviceId).body.state;
    const tree = state.layers[0]!.tree;
    assert.doesNotThrow(() =>
        assertRetainedDevicePhysical(world.deviceId, {
            ...state,
            writable: null,
            garbage: [state.writable!],
        } as RetainedDeviceState),
    );
    const changedPayload = path.join(tree.directory, config.treeDirectory);
    const originalStat = fs.lstatSync;
    const injected = context.mock.method(
        fs,
        "lstatSync",
        (target: fs.PathLike, options?: fs.StatOptions) => {
            const result = originalStat(target, options);
            if (target !== changedPayload || options !== undefined || result === undefined)
                return result;
            return new Proxy(result, {
                get: (value, key) =>
                    key === "isDirectory" ? () => false : Reflect.get(value, key),
            });
        },
    );
    syncBuiltinESMExports();
    try {
        assert.throws(
            () => assertRetainedDeviceTree(world.deviceId, state, tree),
            /not a directory/u,
        );
    } finally {
        injected.mock.restore();
        syncBuiltinESMExports();
    }
    assert.throws(
        () => assertRetainedDeviceTree(world.deviceId, state, { ...tree, identity: null }),
        /not been published/u,
    );
    assert.throws(
        () => assertRetainedDevicePhysical(world.deviceId, { ...state, root_identity: null }),
        /root is not published/u,
    );
    assert.throws(
        () => assertRetainedDevicePending(world.deviceId, state, null, config.phases.prepared),
        /no plan/u,
    );
    fs.writeFileSync(path.join(tree.directory, config.treeDirectory, "extra"), "changed");
    assert.throws(() => assertRetainedDeviceTree(world.deviceId, state, tree), /snapshot bytes/u);
    fs.renameSync(
        path.join(tree.directory, config.treeDirectory, "extra"),
        path.join(directory, "held-extra"),
    );
    const restore = planRetainedDeviceCommand(state, config.actions.restore, "base", null);
    assert.throws(
        () =>
            materializeRetainedDevicePlan(world.deviceId, state, {
                ...restore,
                copies: [{ ...restore.copies[0]!, target: path.join(directory, "outside") }],
            }),
        /not planned/u,
    );
    assert.throws(
        () =>
            materializeRetainedDevicePlan(world.deviceId, state, {
                ...restore,
                copies: [
                    {
                        ...restore.copies[0]!,
                        source: path.relative(
                            process.cwd(),
                            path.join(tree.directory, config.treeDirectory),
                        ),
                    },
                ],
            }),
        /source is not absolute/u,
    );
    await world.cleanup({ commandId: "cleanup" });
});

for (const stage of [
    "root-extra",
    "root-marker",
    "layers-extra",
    "layers-marker",
    "wrapper-extra",
    "wrapper-marker",
    "payload-receipt",
] as const) {
    test(`garbage cleanup refuses ${stage} without deleting unrelated bytes`, async (context) => {
        const directory = await temporaryDirectory(context, `device-garbage-${stage}`);
        using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
        const world = await openRetainedDeviceLayerWorld(store, {
            commandId: "create",
            root: directory,
        });
        await world.writeFile("note", Buffer.from("preserve"));
        const state = readRetainedDeviceHead(store, world.deviceId).body.state;
        const cleanup = planRetainedDeviceCommand(
            state,
            config.actions.cleanup,
            undefined,
            null,
        ).next;
        const root = state.root;
        const layers = path.join(root, config.layersDirectory);
        const wrapper = path.dirname(world.path);
        const target = stage.startsWith("root-")
            ? root
            : stage.startsWith("layers-")
              ? layers
              : wrapper;
        const filename = stage.endsWith("extra")
            ? "unrelated"
            : stage === "payload-receipt"
              ? config.payloadIdentityFilename
              : config.ownershipFilename;
        const file = path.join(target, filename);
        if (stage.endsWith("extra")) fs.writeFileSync(file, "unrelated");
        else fs.renameSync(file, path.join(directory, "held-receipt"));
        assert.throws(() => cleanupRetainedDeviceGarbage(world.deviceId, cleanup), /unowned|lost/u);
        assert.equal(fs.readFileSync(path.join(world.path, "note"), "utf8"), "preserve");
        if (stage.endsWith("extra")) assert.equal(fs.readFileSync(file, "utf8"), "unrelated");
    });
}

test("cleanup refuses missing or unowned roots and permits only already removed owned garbage", async (context) => {
    const directory = await temporaryDirectory(context, "device-garbage-identities");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const world = await openRetainedDeviceLayerWorld(store, {
        commandId: "create",
        root: directory,
    });
    const state = readRetainedDeviceHead(store, world.deviceId).body.state;
    const cleanup = planRetainedDeviceCommand(state, config.actions.cleanup, undefined, null).next;
    assert.throws(
        () => cleanupRetainedDeviceGarbage(world.deviceId, { ...cleanup, root_identity: null }),
        /lacks ownership/u,
    );
    assert.throws(
        () => cleanupRetainedDeviceGarbage(world.deviceId, { ...cleanup, layers_identity: null }),
        /lacks ownership/u,
    );
    const held = path.join(directory, "held-root");
    fs.renameSync(state.root, held);
    assert.throws(() => cleanupRetainedDeviceGarbage(world.deviceId, state), /disappeared/u);
    assert.deepEqual(cleanupRetainedDeviceGarbage(world.deviceId, cleanup), {
        ...cleanup,
        garbage: [],
    });
    fs.renameSync(held, state.root);
    // A payload receipt is removed only after its payload; recovery accepts that exact partial state.
    const wrapper = path.dirname(world.path);
    fs.renameSync(world.path, path.join(directory, "held-payload"));
    fs.renameSync(
        path.join(wrapper, config.payloadIdentityFilename),
        path.join(directory, "held-receipt"),
    );
    const result = cleanupRetainedDeviceGarbage(world.deviceId, cleanup as RetainedDeviceState);
    assert.deepEqual(result.garbage, []);
    assert.equal(fs.existsSync(state.root), false);
});

test("pending creation refuses unowned entries, missing payloads and drifted sources", async (context) => {
    const directory = await temporaryDirectory(context, "device-pending-creation");
    const seed = path.join(directory, "seed");
    fs.mkdirSync(seed);
    fs.writeFileSync(path.join(seed, "note"), "original");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const world = await openRetainedDeviceLayerWorld(store, {
        commandId: "create",
        root: directory,
        seed,
    });
    const first = store.readOwner(world.deviceId)[0]!.body as unknown as RetainedDeviceJournal;
    assert.ok(first.plan);
    const wrapper = first.plan.copies[0]!.target;
    for (const target of [
        first.state.root,
        path.join(first.state.root, config.layersDirectory),
        wrapper,
    ]) {
        const file = path.join(target, "unrelated");
        fs.writeFileSync(file, "preserve");
        assert.throws(
            () =>
                assertRetainedDevicePending(
                    world.deviceId,
                    first.state,
                    first.plan,
                    config.phases.prepared,
                ),
            /unowned/u,
        );
        assert.equal(fs.readFileSync(file, "utf8"), "preserve");
        fs.renameSync(file, path.join(directory, `held-${path.basename(target)}`));
    }
    const payload = path.join(wrapper, config.treeDirectory);
    fs.renameSync(payload, path.join(directory, "held-payload"));
    assert.throws(
        () =>
            assertRetainedDevicePending(
                world.deviceId,
                first.state,
                first.plan,
                config.phases.prepared,
            ),
        /identity disappeared/u,
    );
    fs.renameSync(path.join(directory, "held-payload"), payload);
    fs.writeFileSync(path.join(payload, "note"), "partial");
    fs.writeFileSync(path.join(seed, "note"), "source drift");
    assert.throws(
        () =>
            assertRetainedDevicePending(
                world.deviceId,
                first.state,
                first.plan,
                config.phases.prepared,
            ),
        /source changed/u,
    );
    fs.renameSync(seed, path.join(directory, "held-seed"));
    assert.throws(
        () =>
            assertRetainedDevicePending(
                world.deviceId,
                first.state,
                first.plan,
                config.phases.prepared,
            ),
        /source disappeared/u,
    );
});
