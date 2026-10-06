import assert from "node:assert/strict";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
    inspectRetainedDeviceLayerWorld,
    openRetainedDeviceLayerWorld,
    type RecordBody,
    ROOT_WITNESS_ID,
    SQLiteTraceStore,
} from "../../src/index.ts";
import { workspaceProtocolConfig } from "../../src/protocol/config.ts";
import { temporaryDirectory } from "../replay/fixtures.ts";

type Body = Record<string, unknown>;
const config = workspaceProtocolConfig.deviceLayers.retained;
const object = (value: Body, key: string) => value[key] as Body;

test("canonical but contradictory device journals are refused before physical admission", async (context) => {
    const directory = await temporaryDirectory(context, "device-journal-validation");
    using source = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const world = await openRetainedDeviceLayerWorld(source, {
        commandId: "create",
        root: directory,
    });
    await world.writeFile("note", Buffer.from("original"));
    await world.checkpoint({ commandId: "checkpoint", name: "one" });
    const bodies = source
        .readOwner(world.deviceId)
        .map((record) => structuredClone(record.body) as Body);
    const changes: readonly ((bodies: Body[]) => void)[] = [
        (records) => {
            object(records[1] as Body, "state").writable = null;
        },
        (records) => {
            object(records[0] as Body, "state").ordinal = -1;
        },
        (records) => {
            object(records[0] as Body, "state").layers = false;
        },
        (records) => {
            (records[0] as Body).device_id = world.deviceId.replace(
                /.$/u,
                world.deviceId.endsWith("a") ? "b" : "a",
            );
        },
        (records) => {
            object(records[1] as Body, "state").layers = [];
        },
        (records) => {
            object(
                (object(records[1] as Body, "state").layers as Body[])[0] as Body,
                "tree",
            ).identity = null;
        },
        (records) => {
            object(
                (object(records[1] as Body, "state").layers as Body[])[0] as Body,
                "tree",
            ).payload_identity = null;
        },
        (records) => {
            (records[2] as Body).recovery = {
                command_id: "changed",
                expected_head_record_id: ROOT_WITNESS_ID,
            };
        },
        (records) => {
            (records[0] as Body).record_version = 999;
        },
        (records) => {
            (records[0] as Body).plan = null;
        },
        (records) => {
            object(records[0] as Body, "state").generation = 1;
        },
        (records) => {
            object(records[0] as Body, "request").root = path.join(directory, "different");
        },
        (records) => {
            object(object(records[0] as Body, "plan"), "next").ownership_key = "different";
        },
        (records) => {
            (records[0] as Body).phase = config.phases.completed;
        },
        (records) => {
            (records[1] as Body).operation = config.actions.restore;
        },
        (records) => {
            (records[1] as Body).recovery = {
                command_id: "forged",
                expected_head_record_id: ROOT_WITNESS_ID,
            };
        },
        (records) => {
            (records[1] as Body).phase = config.phases.prepared;
        },
        (records) => {
            object(records[1] as Body, "state").root_identity = null;
        },
        (records) => {
            object(records[2] as Body, "state").generation = 999;
        },
        (records) => {
            (records[2] as Body).phase = config.phases.prepared;
        },
        (records) => {
            object(records[3] as Body, "state").generation = 999;
        },
        (records) => {
            object(records[3] as Body, "request").name = "different";
        },
        (records) => {
            ((object(records[3] as Body, "plan").copies as Body[])[0] as Body).source =
                "/unrelated";
        },
        (records) => {
            object(object(records[3] as Body, "plan"), "next").retired = ["unearned"];
        },
    ];
    for (const change of changes) {
        using target = new SQLiteTraceStore();
        const altered = structuredClone(bodies);
        change(altered);
        let previous = ROOT_WITNESS_ID;
        for (const [index, body] of altered.entries()) {
            const receipt = target.injectSupervisionContext([ROOT_WITNESS_ID], {
                append_intent_id: `forged:${index}`,
                batch: {
                    groups: [
                        {
                            owner_id: world.deviceId,
                            records: [
                                {
                                    body: body as RecordBody,
                                    schema_ref: config.traceSchema,
                                    mode: "capture",
                                    witness_ref: ROOT_WITNESS_ID,
                                    caused_by_record_ids: [previous],
                                },
                            ],
                        },
                    ],
                },
            });
            previous = receipt.record_ids[0] as string;
        }
        assert.throws(
            () => inspectRetainedDeviceLayerWorld(target, { deviceId: world.deviceId }),
            TypeError,
            change.toString(),
        );
    }
    assert.equal((await world.readFile("note")).toString(), "original");
    await world.cleanup({ commandId: "cleanup" });
});

test("cached journal validation still authenticates persisted bytes on every read", async (context) => {
    const directory = await temporaryDirectory(context, "device-cache-integrity");
    const database = path.join(directory, "trace.sqlite");
    using store = new SQLiteTraceStore(database);
    const world = await openRetainedDeviceLayerWorld(store, {
        commandId: "create",
        root: directory,
    });
    const head = inspectRetainedDeviceLayerWorld(store, { deviceId: world.deviceId });
    assert.equal(head.status, "ready");
    using raw = new DatabaseSync(database);
    const original = raw
        .prepare("SELECT body_json FROM records WHERE record_id = ?")
        .get(head.headRecordId)?.body_json as string;
    const body = JSON.parse(original) as Body;
    object(body, "state").generation = 999;
    raw.prepare("UPDATE records SET body_json = ? WHERE record_id = ?").run(
        JSON.stringify(body),
        head.headRecordId,
    );
    assert.throws(
        () => inspectRetainedDeviceLayerWorld(store, { deviceId: world.deviceId }),
        /identity/u,
    );
    raw.prepare("UPDATE records SET body_json = ? WHERE record_id = ?").run(
        original,
        head.headRecordId,
    );
    assert.equal(
        inspectRetainedDeviceLayerWorld(store, { deviceId: world.deviceId }).status,
        "ready",
    );
    await world.cleanup({ commandId: "cleanup" });
});

test("orphan command occurrences and broken journal causality cannot authorize a device", async (context) => {
    const directory = await temporaryDirectory(context, "device-orphan-journals");
    using source = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const world = await openRetainedDeviceLayerWorld(source, {
        commandId: "create",
        root: directory,
    });
    const first = source.readOwner(world.deviceId)[0]!;
    for (const owner of [world.deviceId, config.commandOwnerPrefix + "create"]) {
        using target = new SQLiteTraceStore();
        target.injectSupervisionContext([ROOT_WITNESS_ID], {
            append_intent_id: "orphan",
            batch: {
                groups: [
                    {
                        owner_id: owner,
                        records: [
                            {
                                body: first.body,
                                mode: "capture",
                                schema_ref: config.traceSchema,
                                witness_ref: ROOT_WITNESS_ID,
                                caused_by_record_ids: [],
                            },
                        ],
                    },
                ],
            },
        });
        if (owner === world.deviceId)
            assert.throws(
                () => inspectRetainedDeviceLayerWorld(target, { deviceId: world.deviceId }),
                /causality/u,
            );
        else
            await assert.rejects(
                openRetainedDeviceLayerWorld(target, { commandId: "create", root: directory }),
                /no lifecycle journal occurrence/u,
            );
    }
    await world.cleanup({ commandId: "cleanup" });
});
