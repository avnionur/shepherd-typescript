import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { test } from "node:test";
import {
    AppendIntentConflictError,
    deriveRetainedDeviceLayerId,
    inspectRetainedDeviceLayerWorld,
    openRetainedDeviceLayerWorld,
    recoverRetainedDeviceLayerWorld,
    reopenRetainedDeviceLayerWorld,
    SQLiteTraceStore,
} from "../../src/index.ts";
import { workspaceProtocolConfig } from "../../src/protocol/config.ts";
import { temporaryDirectory } from "../replay/fixtures.ts";

for (const action of ["create", "restore", "cleanup"] as const) {
    test(`${action} recovers after each physical durability boundary without losing sibling data`, async (context) => {
        const parent = await temporaryDirectory(context, `device-durability-${action}`);
        let total = 0;
        for (let failure = 0; failure <= total; failure++) {
            const directory = path.join(parent, String(failure));
            fs.mkdirSync(directory);
            fs.writeFileSync(path.join(directory, "sibling"), "preserve");
            using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
            const options = { commandId: "create", root: directory };
            const world =
                action === "create" ? null : await openRetainedDeviceLayerWorld(store, options);
            if (world !== null) {
                await world.writeFile("note", Buffer.from("captured"));
                await world.checkpoint({ commandId: "capture", name: "one" });
                await world.writeFile("note", Buffer.from("mutable"));
            }
            let calls = 0;
            const original = fs.fsyncSync;
            const injected = context.mock.method(fs, "fsyncSync", (descriptor: number) => {
                original(descriptor);
                if (++calls === failure) throw new Error("injected durability failure");
            });
            syncBuiltinESMExports();
            try {
                const result =
                    action === "create"
                        ? openRetainedDeviceLayerWorld(store, options)
                        : action === "restore"
                          ? world!.restore({ commandId: "restore", name: "one" })
                          : world!.cleanup({ commandId: "cleanup" });
                if (failure === 0) await result;
                else await assert.rejects(result, /injected durability failure/u);
            } finally {
                injected.mock.restore();
                syncBuiltinESMExports();
            }
            if (failure === 0) {
                total = calls;
                continue;
            }
            const deviceId = deriveRetainedDeviceLayerId("create");
            const diagnosis = inspectRetainedDeviceLayerWorld(store, { deviceId });
            const recovery = {
                deviceId,
                commandId: "recover",
                expectedHeadRecordId: diagnosis.headRecordId,
            };
            if (diagnosis.status === "unavailable") {
                // Death between directory publication and its receipt is intentionally fenced.
                assert.match(diagnosis.reason ?? "", /ENOENT/u);
                const config = workspaceProtocolConfig.deviceLayers.retained;
                assert.ok(
                    [config.ownershipFilename, config.payloadIdentityFilename].some((name) =>
                        diagnosis.reason?.endsWith(`${name}'`),
                    ),
                );
                const before = store.exportTrace();
                await assert.rejects(recoverRetainedDeviceLayerWorld(store, recovery), /ENOENT/u);
                assert.equal(store.exportTrace(), before);
                assert.equal(fs.readFileSync(path.join(directory, "sibling"), "utf8"), "preserve");
                continue;
            }
            assert.equal(diagnosis.status, "pending", `boundary ${failure}: ${diagnosis.reason}`);
            if (action === "restore")
                await assert.rejects(
                    world!.restore({ commandId: "restore", name: "one" }),
                    /pending explicit recovery/u,
                );
            const recovered = await recoverRetainedDeviceLayerWorld(store, recovery);
            assert.equal(recovered.status, action === "cleanup" ? "cleaned" : "ready");
            const beforeRetry = store.exportTrace();
            assert.deepEqual(await recoverRetainedDeviceLayerWorld(store, recovery), recovered);
            await assert.rejects(
                recoverRetainedDeviceLayerWorld(store, {
                    ...recovery,
                    expectedHeadRecordId: recovered.headRecordId,
                }),
                AppendIntentConflictError,
            );
            assert.equal(store.exportTrace(), beforeRetry);
            if (action !== "cleanup") {
                const reopened = await reopenRetainedDeviceLayerWorld(store, { deviceId });
                if (action === "restore")
                    assert.equal((await reopened.readFile("note")).toString(), "captured");
                await reopened.cleanup({ commandId: "final-cleanup" });
            }
            assert.equal(fs.readFileSync(path.join(directory, "sibling"), "utf8"), "preserve");
        }
        assert.ok(total > 0);
        context.diagnostic(`Verified ${total} real fsync boundaries`);
    });
}
