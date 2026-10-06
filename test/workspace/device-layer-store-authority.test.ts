import assert from "node:assert/strict";
import { chmodSync, linkSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
    deriveRetainedDeviceLayerId,
    openRetainedDeviceLayerWorld,
    ROOT_WITNESS_ID,
    SQLiteTraceStore,
} from "../../src/index.ts";
import { workspaceProtocolConfig } from "../../src/protocol/config.ts";
import { verifyDeviceLayerRegistration } from "../../src/store/device-layer-journals.ts";
import { temporaryDirectory } from "../replay/fixtures.ts";

const config = workspaceProtocolConfig.deviceLayers.retained;

test("general appends cannot publish reserved device journals and unregistered work cannot touch files", async (context) => {
    const directory = await temporaryDirectory(context, "device-store-authority");
    const database = path.join(directory, "trace.sqlite");
    using store = new SQLiteTraceStore(database);
    for (const owner of [
        deriveRetainedDeviceLayerId("forged"),
        config.commandOwnerPrefix + "forged",
    ])
        assert.throws(
            () =>
                store.append({
                    append_intent_id: owner,
                    batch: {
                        groups: [
                            {
                                owner_id: owner,
                                records: [
                                    {
                                        body: {},
                                        mode: "capture",
                                        schema_ref: config.traceSchema,
                                        witness_ref: ROOT_WITNESS_ID,
                                        caused_by_record_ids: [ROOT_WITNESS_ID],
                                    },
                                ],
                            },
                        ],
                    },
                }),
            /local lifecycle authority/u,
        );
    assert.throws(
        () =>
            store.runDeviceLayerJournalWork("invalid", null, () => {
                throw new Error("must not execute");
            }),
        /invalid retained device identity/u,
    );
    assert.throws(
        () =>
            store.runDeviceLayerJournalWork(deriveRetainedDeviceLayerId("absent"), null, () => ({
                request: null,
                value: null,
            })),
        /requires creation evidence/u,
    );
    using raw = new DatabaseSync(database);
    assert.throws(
        () => verifyDeviceLayerRegistration(raw, deriveRetainedDeviceLayerId("absent")),
        /absent/u,
    );
    const world = await openRetainedDeviceLayerWorld(store, {
        commandId: "create",
        root: directory,
    });
    await world.writeFile("note", Buffer.from("preserve"));
    const registration = store.readDeviceLayerRegistration(world.deviceId);
    assert.ok(registration);
    raw.prepare("DELETE FROM device_layer_registrations WHERE device_id = ?").run(world.deviceId);
    await assert.rejects(world.writeFile("note", Buffer.from("wrong")), /no authority/u);
    raw.prepare("INSERT INTO device_layer_registrations VALUES (?, ?, ?)").run(
        world.deviceId,
        registration.creation_record_id,
        registration.database_identity,
    );
    chmodSync(database, 0o644);
    await assert.rejects(world.writeFile("note", Buffer.from("wrong")), /single-link/u);
    chmodSync(database, 0o600);
    using readonly = new SQLiteTraceStore(database, { readOnly: true });
    assert.throws(
        () =>
            readonly.runDeviceLayerJournalWork(world.deviceId, null, () => {
                throw new Error("must not execute");
            }),
        /writable/u,
    );
    assert.equal(readFileSync(path.join(world.path, "note"), "utf8"), "preserve");
    await world.cleanup({ commandId: "cleanup" });
    linkSync(database, path.join(directory, "linked.sqlite"));
    assert.throws(() => store.deviceLayerDatabaseIdentity(), /single-link/u);
});
