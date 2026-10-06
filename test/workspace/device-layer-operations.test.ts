import assert from "node:assert/strict";
import { chmodSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
    backupTraceStore,
    createCloneDeviceLayerAdapter,
    inspectRetainedDeviceLayerWorld,
    openRetainedDeviceLayerWorld,
    ROOT_WITNESS_ID,
    restoreTraceStoreBackup,
    SQLiteTraceStore,
    verifyTraceStoreBackup,
} from "../../src/index.ts";
import { workspaceProtocolConfig } from "../../src/protocol/config.ts";
import { temporaryDirectory } from "../replay/fixtures.ts";

const config = workspaceProtocolConfig.deviceLayers.retained;

test("seeded trees retain bytes, modes and links across capture and restore on available adapters", async (context) => {
    const directory = await temporaryDirectory(context, "device-seed");
    const seed = path.join(directory, "seed");
    mkdirSync(seed);
    mkdirSync(path.join(seed, "nested"));
    writeFileSync(path.join(seed, "nested", "note"), "seed");
    chmodSync(path.join(seed, "nested", "note"), 0o640);
    const outside = path.join(directory, "outside");
    mkdirSync(outside);
    writeFileSync(path.join(outside, "keep"), "preserve");
    symlinkSync(outside, path.join(seed, "link"));
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const identities: string[] = [];
    for (const adapter of [config.adapters.copy, config.adapters.clone]) {
        if (
            adapter === config.adapters.clone &&
            !(await createCloneDeviceLayerAdapter().probe({ root: directory })).available
        )
            continue;
        const world = await openRetainedDeviceLayerWorld(store, {
            commandId: adapter,
            root: directory,
            seed,
            adapter,
        });
        identities.push(world.layers()[0]?.contentId as string);
        assert.deepEqual(
            (await world.listFiles()).map((file) => file.path),
            ["nested/note"],
        );
        await assert.rejects(world.readFile("link/keep"), /symbolic link/u);
        await world.writeFile("nested/note", Buffer.from("changed"));
        await world.checkpoint({ commandId: `${adapter}:checkpoint`, name: "one" });
        await world.removePath("nested");
        await world.removePath("missing/absent");
        await world.restore({ commandId: `${adapter}:restore`, name: "one" });
        assert.equal((await world.readFile("nested/note")).toString(), "changed");
        await world.restore({ commandId: `${adapter}:base`, name: "base" });
        assert.equal((await world.readFile("nested/note")).toString(), "seed");
        await world.checkpoint({ commandId: `${adapter}:reuse-name`, name: "one" });
        await world.cleanup({ commandId: `${adapter}:cleanup` });
        assert.equal(readFileSync(path.join(outside, "keep"), "utf8"), "preserve");
    }
    assert.ok(identities.every((identity) => identity === identities[0]));
});

test("maintenance preserves live device authority while verified backups retain facts without adopting resources", async (context) => {
    const directory = await temporaryDirectory(context, "device-maintenance");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const world = await openRetainedDeviceLayerWorld(store, {
        commandId: "create",
        root: directory,
    });
    await world.writeFile("note", Buffer.from("retained"));
    await world.checkpoint({ commandId: "capture", name: "one" });
    const before = store.exportTrace();
    for (const mode of ["inspect", "checkpoint", "optimize", "vacuum"] as const) {
        store.maintain({ mode });
        assert.equal(store.exportTrace(), before);
        assert.equal(
            inspectRetainedDeviceLayerWorld(store, { deviceId: world.deviceId }).status,
            "ready",
        );
    }
    const destination = path.join(directory, "backup");
    const backup = await backupTraceStore(store, { destination });
    await verifyTraceStoreBackup(destination, { expectedManifestId: backup.manifest_id });
    const restoredPath = path.join(directory, "restored.sqlite");
    await restoreTraceStoreBackup(destination, restoredPath, {
        expectedManifestId: backup.manifest_id,
    });
    using restored = new SQLiteTraceStore(restoredPath);
    assert.equal(restored.exportTrace(), before);
    assert.equal(
        inspectRetainedDeviceLayerWorld(restored, { deviceId: world.deviceId }).status,
        "unavailable",
    );
    assert.equal((await world.readFile("note")).toString(), "retained");
    await world.cleanup({ commandId: "cleanup" });
});

test("corrupt local registration is diagnosed and cannot admit filesystem work", async (context) => {
    const directory = await temporaryDirectory(context, "device-registration");
    const database = path.join(directory, "trace.sqlite");
    using store = new SQLiteTraceStore(database);
    const world = await openRetainedDeviceLayerWorld(store, {
        commandId: "create",
        root: directory,
    });
    await world.writeFile("note", Buffer.from("preserve"));
    const creation = store.readOwner(world.deviceId)[0]?.envelope.record_id;
    assert.ok(creation);
    using raw = new DatabaseSync(database);
    raw.prepare(
        "UPDATE device_layer_registrations SET creation_record_id = ? WHERE device_id = ?",
    ).run(ROOT_WITNESS_ID, world.deviceId);
    assert.equal(store.verifyIntegrity().ok, false);
    assert.equal(
        inspectRetainedDeviceLayerWorld(store, { deviceId: world.deviceId }).status,
        "unavailable",
    );
    await assert.rejects(world.writeFile("note", Buffer.from("wrong")), /registration/u);
    assert.equal(readFileSync(path.join(world.path, "note"), "utf8"), "preserve");
    raw.prepare(
        "UPDATE device_layer_registrations SET creation_record_id = ? WHERE device_id = ?",
    ).run(creation, world.deviceId);
    assert.equal(store.verifyIntegrity().ok, true);
    await world.cleanup({ commandId: "cleanup" });
});
