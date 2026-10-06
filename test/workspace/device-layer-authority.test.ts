import assert from "node:assert/strict";
import {
    copyFileSync,
    existsSync,
    mkdirSync,
    readFileSync,
    renameSync,
    symlinkSync,
    writeFileSync,
} from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
    AppendIntentConflictError,
    inspectRetainedDeviceLayerWorld,
    openRetainedDeviceLayerWorld,
    reopenRetainedDeviceLayerWorld,
    SQLiteTraceStore,
} from "../../src/index.ts";
import { temporaryDirectory } from "../replay/fixtures.ts";

test("stale handles and reused command identities refuse before physical work", async (context) => {
    const directory = await temporaryDirectory(context, "device-authority");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const world = await openRetainedDeviceLayerWorld(store, {
        commandId: "create",
        root: directory,
    });
    await world.writeFile("note", Buffer.from("original long value"));
    await world.writeFile("note", Buffer.from("short"));
    assert.equal((await world.readFile("note")).toString(), "short");
    const stale = await reopenRetainedDeviceLayerWorld(store, { deviceId: world.deviceId });
    const captured = await world.checkpoint({ commandId: "checkpoint", name: "one" });
    await assert.rejects(stale.writeFile("note", Buffer.from("stale")), AppendIntentConflictError);
    const before = store.exportTrace();
    assert.deepEqual(await world.checkpoint({ commandId: "checkpoint", name: "one" }), captured);
    await assert.rejects(
        world.checkpoint({ commandId: "checkpoint", name: "another" }),
        AppendIntentConflictError,
    );
    await assert.rejects(
        openRetainedDeviceLayerWorld(store, {
            commandId: "create",
            root: directory,
            depth: { maxDepth: 4, retainNewest: 1 },
        }),
        AppendIntentConflictError,
    );
    assert.equal(store.exportTrace(), before);
    assert.equal((await world.readFile("note")).toString(), "short");
    await world.close();
    await assert.rejects(world.readFile("note"), /closed/u);
    const fresh = await reopenRetainedDeviceLayerWorld(store, { deviceId: world.deviceId });
    await fresh.cleanup({ commandId: "cleanup" });
    assert.equal(
        inspectRetainedDeviceLayerWorld(store, { deviceId: world.deviceId }).status,
        "cleaned",
    );
});

test("imported records and copied database files never inherit physical device authority", async (context) => {
    const directory = await temporaryDirectory(context, "device-import-authority");
    const database = path.join(directory, "trace.sqlite");
    const store = new SQLiteTraceStore(database);
    const world = await openRetainedDeviceLayerWorld(store, {
        commandId: "create",
        root: directory,
    });
    await world.writeFile("note", Buffer.from("private bytes"));
    const deviceId = world.deviceId;
    const worldPath = world.path;
    const archive = store.exportTrace();
    await world.close();
    store.close();
    const copiedPath = path.join(directory, "copied.sqlite");
    copyFileSync(database, copiedPath);
    using copied = new SQLiteTraceStore(copiedPath);
    using imported = new SQLiteTraceStore(path.join(directory, "imported.sqlite"));
    imported.importTrace(archive);
    for (const target of [copied, imported]) {
        const before = target.exportTrace();
        assert.equal(inspectRetainedDeviceLayerWorld(target, { deviceId }).status, "unavailable");
        await assert.rejects(
            reopenRetainedDeviceLayerWorld(target, { deviceId }),
            /local authority/u,
        );
        assert.equal(target.exportTrace(), before);
        assert.equal(readFileSync(path.join(worldPath, "note"), "utf8"), "private bytes");
    }
    using original = new SQLiteTraceStore(database);
    const reopened = await reopenRetainedDeviceLayerWorld(original, { deviceId });
    await reopened.cleanup({ commandId: "cleanup" });
});

test("root replacement and a payload symlink cannot redirect restoration or cleanup", async (context) => {
    const directory = await temporaryDirectory(context, "device-root-replacement");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const world = await openRetainedDeviceLayerWorld(store, {
        commandId: "create",
        root: directory,
    });
    await world.writeFile("note", Buffer.from("retained"));
    await world.checkpoint({ commandId: "capture", name: "one" });
    const root = path.dirname(path.dirname(world.path));
    const heldRoot = path.join(directory, "held-root");
    renameSync(root, heldRoot);
    mkdirSync(root);
    writeFileSync(path.join(root, "unrelated"), "preserve");
    const before = store.exportTrace();
    await assert.rejects(world.cleanup({ commandId: "refused-cleanup" }), /identity changed/u);
    assert.equal(readFileSync(path.join(root, "unrelated"), "utf8"), "preserve");
    assert.equal(store.exportTrace(), before);
    renameSync(root, path.join(directory, "unrelated-root"));
    renameSync(heldRoot, root);
    const payload = world.path;
    const heldPayload = path.join(directory, "held-payload");
    renameSync(payload, heldPayload);
    symlinkSync(path.join(directory, "unrelated-root"), payload);
    await assert.rejects(world.restore({ commandId: "refused-restore", name: "one" }), /payload/u);
    assert.equal(existsSync(path.join(directory, "unrelated-root", "unrelated")), true);
    assert.equal(store.exportTrace(), before);
});

test("unsupported adapters, memory stores and malformed durable options refuse", async (context) => {
    const directory = await temporaryDirectory(context, "device-admission");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const before = store.exportTrace();
    for (const options of [
        { adapter: "overlay" },
        { adapter: "container" },
        { adapter: "custom" },
        { adapter: null },
        { depth: null },
        { depth: { maxDepth: null } },
        { depth: { maxDepth: 2, retainNewest: 1 } },
        { extra: true },
    ])
        await assert.rejects(
            openRetainedDeviceLayerWorld(store, {
                commandId: "invalid",
                root: directory,
                ...options,
            } as never),
        );
    await assert.rejects(
        openRetainedDeviceLayerWorld(store, {
            commandId: "overlap",
            root: directory,
            seed: directory,
        }),
        /overlaps/u,
    );
    using memory = new SQLiteTraceStore();
    await assert.rejects(
        openRetainedDeviceLayerWorld(memory, { commandId: "memory", root: directory }),
        /file-backed/u,
    );
    assert.equal(store.exportTrace(), before);
});

test("replacing the payload directory preserves the replacement and refuses reopen or cleanup", async (context) => {
    const directory = await temporaryDirectory(context, "device-payload-replacement");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const world = await openRetainedDeviceLayerWorld(store, {
        commandId: "create",
        root: directory,
    });
    await world.writeFile("note", Buffer.from("original"));
    const payload = world.path;
    renameSync(payload, path.join(directory, "original-payload"));
    mkdirSync(payload);
    writeFileSync(path.join(payload, "unrelated"), "preserve");
    const before = store.exportTrace();
    await assert.rejects(
        reopenRetainedDeviceLayerWorld(store, { deviceId: world.deviceId }),
        /identity/u,
    );
    await assert.rejects(world.cleanup({ commandId: "cleanup" }), /identity/u);
    assert.equal(readFileSync(path.join(payload, "unrelated"), "utf8"), "preserve");
    assert.equal(store.exportTrace(), before);
});
