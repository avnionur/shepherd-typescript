import assert from "node:assert/strict";
import { chmodSync, linkSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
    AppendIntentConflictError,
    inspectRetainedDeviceLayerWorld,
    openRetainedDeviceLayerWorld,
    recoverRetainedDeviceLayerWorld,
    reopenRetainedDeviceLayerWorld,
    SQLiteTraceStore,
} from "../../src/index.ts";
import { workspaceProtocolConfig } from "../../src/protocol/config.ts";
import { temporaryDirectory } from "../replay/fixtures.ts";

const config = workspaceProtocolConfig.deviceLayers.retained;

test("unsafe file access and invalid checkpoints refuse without changing retained bytes or journal", async (context) => {
    const directory = await temporaryDirectory(context, "device-public-refusals");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const options = {
        commandId: "create",
        root: directory,
        depth: { maxDepth: 3, retainNewest: 1 },
    };
    const world = await openRetainedDeviceLayerWorld(store, options);
    const repeated = await openRetainedDeviceLayerWorld(store, options);
    assert.equal(repeated.deviceId, world.deviceId);
    await repeated.close();
    await world.writeFile("note", Buffer.from("preserve"));
    mkdirSync(path.join(world.path, "directory"));
    const before = store.exportTrace();
    await assert.rejects(world.readFile("directory"), /regular file/u);
    await assert.rejects(world.writeFile("note", "wrong" as never), /bounded bytes/u);
    linkSync(path.join(world.path, "note"), path.join(directory, "linked"));
    await assert.rejects(world.writeFile("note", Buffer.from("wrong")), /owned regular file/u);
    await assert.rejects(world.readFile("note"), /regular file/u);
    assert.equal(readFileSync(path.join(directory, "linked"), "utf8"), "preserve");
    assert.equal(store.exportTrace(), before);
    // Move forward with a separate ordinary file; the linked entry remains refused by capture.
    await assert.rejects(
        world.checkpoint({ commandId: "linked", name: "linked" }),
        /unsupported entry/u,
    );
    await world.removePath("note");
    for (const name of ["", "../escape", "base"])
        await assert.rejects(
            world.checkpoint({ commandId: `invalid:${name}`, name }),
            /checkpoint name/u,
        );
    await assert.rejects(world.restore({ commandId: "unknown", name: "missing" }), /unknown/u);
    for (const name of ["one", "two", "three", "four"])
        await world.checkpoint({ commandId: name, name });
    await assert.rejects(
        world.checkpoint({ commandId: "retired", name: "one" }),
        /checkpoint name/u,
    );
    await assert.rejects(world.restore({ commandId: "retired-restore", name: "one" }), /retired/u);
    const restored = await world.restore({ commandId: "restore", name: "four" });
    assert.deepEqual(await world.restore({ commandId: "restore", name: "four" }), restored);
    const ready = inspectRetainedDeviceLayerWorld(store, { deviceId: world.deviceId });
    await assert.rejects(
        recoverRetainedDeviceLayerWorld(store, {
            deviceId: world.deviceId,
            commandId: "unneeded",
            expectedHeadRecordId: ready.headRecordId,
        }),
        AppendIntentConflictError,
    );
    await world.cleanup({ commandId: "cleanup" });
    await assert.rejects(
        reopenRetainedDeviceLayerWorld(store, { deviceId: world.deviceId }),
        /cleaned/u,
    );
    assert.throws(() => world.path, /closed/u);
});

test("unexpected root and wrapper entries and permission drift fence lifecycle mutations", async (context) => {
    const directory = await temporaryDirectory(context, "device-wrapper-refusals");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const world = await openRetainedDeviceLayerWorld(store, {
        commandId: "create",
        root: directory,
    });
    const wrapper = path.dirname(world.path);
    const root = path.dirname(wrapper);
    const before = store.exportTrace();
    for (const target of [root, path.join(root, config.layersDirectory), wrapper]) {
        const unexpected = path.join(target, "unrelated");
        writeFileSync(unexpected, "preserve");
        assert.equal(
            inspectRetainedDeviceLayerWorld(store, { deviceId: world.deviceId }).status,
            "unavailable",
        );
        await assert.rejects(world.cleanup({ commandId: "cleanup" }), /unowned|unexpected/u);
        assert.equal(readFileSync(unexpected, "utf8"), "preserve");
        // The test owns this extra file; remove through a rename outside the retained namespace.
        renameSync(unexpected, path.join(directory, `unrelated-${path.basename(target)}`));
    }
    chmodSync(root, 0o755);
    await assert.rejects(world.cleanup({ commandId: "cleanup" }), /permissions/u);
    chmodSync(root, config.directoryMode);
    assert.equal(store.exportTrace(), before);
});
