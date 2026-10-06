import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
    createCloneDeviceLayerAdapter,
    inspectRetainedDeviceLayerWorld,
    openRetainedDeviceLayerWorld,
    recoverRetainedDeviceLayerWorld,
    reopenRetainedDeviceLayerWorld,
    SQLiteTraceStore,
} from "../../src/index.ts";
import { workspaceProtocolConfig } from "../../src/protocol/config.ts";
import { temporaryDirectory } from "../replay/fixtures.ts";

import { killDeviceLayerWorker } from "./device-layer-test-fixtures.ts";

const adapters = workspaceProtocolConfig.deviceLayers.retained.adapters;

for (const adapter of [adapters.copy, adapters.clone]) {
    for (const point of ["freeze", "restore", "compaction", "cleanup"]) {
        test(`${adapter} recovers after SIGKILL during ${point} without touching sibling paths`, async (context) => {
            const directory = await temporaryDirectory(context, `device-kill-${adapter}-${point}`);
            if (adapter === adapters.clone) {
                const probe = await createCloneDeviceLayerAdapter().probe({ root: directory });
                if (!probe.available) {
                    using unavailableStore = new SQLiteTraceStore(
                        path.join(directory, "unavailable.sqlite"),
                    );
                    await assert.rejects(
                        openRetainedDeviceLayerWorld(unavailableStore, {
                            commandId: "unavailable",
                            root: directory,
                            adapter,
                        }),
                        /unavailable/u,
                    );
                    context.diagnostic(
                        `clone recovery unavailable on this filesystem: ${probe.reason}`,
                    );
                    return;
                }
            }
            const sibling = path.join(directory, "unrelated.txt");
            writeFileSync(sibling, "preserve");
            await killDeviceLayerWorker(context, directory, adapter, point);
            const { deviceId } = JSON.parse(
                readFileSync(path.join(directory, "reference.json"), "utf8"),
            ) as { deviceId: string };
            const database = path.join(directory, "trace.sqlite");
            using reader = new SQLiteTraceStore(database, { readOnly: true });
            const before = reader.exportTrace();
            const diagnosis = inspectRetainedDeviceLayerWorld(reader, { deviceId });
            assert.equal(diagnosis.status, "pending", diagnosis.reason ?? "");
            assert.equal(reader.exportTrace(), before);
            using store = new SQLiteTraceStore(database);
            await assert.rejects(reopenRetainedDeviceLayerWorld(store, { deviceId }), /pending/u);
            const result = await recoverRetainedDeviceLayerWorld(store, {
                deviceId,
                commandId: "recover",
                expectedHeadRecordId: diagnosis.headRecordId,
            });
            assert.equal(
                result.status,
                point === "cleanup" ? "cleaned" : "ready",
                result.reason ?? "",
            );
            assert.equal(readFileSync(sibling, "utf8"), "preserve");
            if (point !== "cleanup") {
                const reopened = await reopenRetainedDeviceLayerWorld(store, { deviceId });
                assert.equal(
                    (await reopened.readFile("notes.txt")).toString(),
                    point === "restore" ? "one" : "uncheckpointed",
                );
                if (point === "freeze" || point === "compaction") {
                    assert.deepEqual(
                        reopened.layers().map((layer) => layer.checkpoint),
                        ["three", "killed"],
                    );
                    assert.deepEqual(result.retiredNames, ["base", "one", "two"]);
                    await assert.rejects(
                        reopened.restore({ commandId: "retired", name: "one" }),
                        /retired/u,
                    );
                }
                await reopened.cleanup({ commandId: "cleanup" });
            }
            assert.equal(store.verifyIntegrity().ok, true);
        });
    }
}
