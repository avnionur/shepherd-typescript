import assert from "node:assert/strict";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
    inspectRetainedDeviceLayerWorld,
    recoverRetainedDeviceLayerWorld,
    SQLiteTraceStore,
} from "../../src/index.ts";
import { workspaceProtocolConfig } from "../../src/protocol/config.ts";
import { temporaryDirectory } from "../replay/fixtures.ts";
import { killDeviceLayerWorker } from "./device-layer-test-fixtures.ts";

const config = workspaceProtocolConfig.deviceLayers.retained;

test("pending diagnosis detects replacement before publication and recovery preserves it", async (context) => {
    const directory = await temporaryDirectory(context, "device-pending-replacement");
    await killDeviceLayerWorker(context, directory, config.adapters.copy, "freeze");
    const { deviceId } = JSON.parse(
        readFileSync(path.join(directory, "reference.json"), "utf8"),
    ) as { deviceId: string };
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const initial = inspectRetainedDeviceLayerWorld(store, { deviceId });
    assert.equal(initial.status, "pending");
    const body = store.readRecord(initial.headRecordId)?.body;
    const plan = body?.plan as { copies: { target: string }[] };
    const payload = path.join(plan.copies[0]?.target as string, config.treeDirectory);
    renameSync(payload, path.join(directory, "held-staging"));
    mkdirSync(payload);
    writeFileSync(path.join(payload, "unrelated"), "preserve");
    const before = store.exportTrace();
    const diagnosis = inspectRetainedDeviceLayerWorld(store, { deviceId });
    assert.equal(diagnosis.status, "unavailable");
    assert.match(diagnosis.reason ?? "", /identity/u);
    await assert.rejects(
        recoverRetainedDeviceLayerWorld(store, {
            deviceId,
            commandId: "recover",
            expectedHeadRecordId: diagnosis.headRecordId,
        }),
        /identity/u,
    );
    assert.equal(store.exportTrace(), before);
    assert.equal(readFileSync(path.join(payload, "unrelated"), "utf8"), "preserve");
});
