import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { Ajv2020, type AnySchemaObject } from "ajv/dist/2020.js";
import * as workspace from "../../src/facades/workspace.ts";
import { openRetainedDeviceLayerWorld, SQLiteTraceStore } from "../../src/index.ts";
import { workspaceProtocolConfig } from "../../src/protocol/config.ts";
import { readRetainedDeviceLayersConfig } from "../../src/protocol/config-retained-device-layers.ts";
import { temporaryDirectory } from "../replay/fixtures.ts";

const config = workspaceProtocolConfig.deviceLayers.retained;

test("retained lifecycle schemas accept every publication phase and typed receipts name real evidence", async (context) => {
    const directory = await temporaryDirectory(context, "device-schema");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const world = await openRetainedDeviceLayerWorld(store, {
        commandId: "create",
        root: directory,
        depth: { maxDepth: 4, retainNewest: 1 },
    });
    for (const name of ["one", "two", "three", "four"]) {
        await world.writeFile("note", Buffer.from(name));
        const checkpoint = await world.checkpoint({ commandId: name, name });
        assert.equal(store.readRecord(checkpoint.recordId)?.body.phase, config.phases.completed);
        assert.equal(world.layers().at(-1)?.contentId, checkpoint.contentId);
        assert.ok(checkpoint.generation > 0);
    }
    const restored = await world.restore({ commandId: "restore", name: "three" });
    assert.equal(store.readRecord(restored.recordId)?.body.phase, config.phases.completed);
    await world.cleanup({ commandId: "cleanup" });
    const ajv = new Ajv2020({ strict: true });
    const validate = ajv.compile(
        JSON.parse(
            readFileSync(
                new URL(
                    "../../spec/schemas/device-layer-lifecycle-v1.schema.json",
                    import.meta.url,
                ),
                "utf8",
            ),
        ) as AnySchemaObject,
    );
    const phases = new Set<string>();
    for (const record of store.readOwner(world.deviceId)) {
        assert.equal(validate(record.body), true, ajv.errorsText(validate.errors));
        assert.equal(validate({ ...record.body, extra: true }), false);
        assert.equal(validate({ ...record.body, record_version: 999 }), false);
        phases.add(record.body.phase as string);
    }
    assert.deepEqual([...phases], Object.values(config.phases));
    assert.equal(workspace.openRetainedDeviceLayerWorld, openRetainedDeviceLayerWorld);
    assert.deepEqual([...workspace.RETAINED_DEVICE_STATUSES], Object.values(config.statuses));
});

test("durable configuration rejects malformed layout, versions and bounds", () => {
    assert.deepEqual(readRetainedDeviceLayersConfig(config), config);
    for (const change of [
        { extra: true },
        { recordVersion: 0 },
        { schemaId: "relative" },
        { ownershipFilename: "../outside" },
        { rootDirectoryPrefix: "../outside" },
        { limits: { ...config.limits, maxEntries: 0 } },
    ])
        assert.throws(() => readRetainedDeviceLayersConfig({ ...config, ...change }), TypeError);
});
