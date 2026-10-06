import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
    inspectRetainedDeviceLayerWorld,
    openRetainedDeviceLayerWorld,
    recoverRetainedDeviceLayerWorld,
    reopenRetainedDeviceLayerWorld,
    SQLiteTraceStore,
} from "../../src/index.ts";
import { workspaceProtocolConfig } from "../../src/protocol/config.ts";
import { temporaryDirectory } from "../replay/fixtures.ts";
import { killDeviceLayerWorker } from "./device-layer-test-fixtures.ts";

test("a delayed native clone cannot target a recreated world after its parent dies", async (context) => {
    if (
        !workspaceProtocolConfig.carrierBackends.clone.helper.platforms.includes(process.platform)
    ) {
        context.diagnostic("external clone helper is not used on this host");
        return;
    }
    const directory = await temporaryDirectory(context, "device-late-clone");
    await killDeviceLayerWorker(
        context,
        directory,
        workspaceProtocolConfig.deviceLayers.retained.adapters.clone,
        "helper",
    );
    const { deviceId } = JSON.parse(
        readFileSync(path.join(directory, "reference.json"), "utf8"),
    ) as { deviceId: string };
    const relays = JSON.parse(readFileSync(path.join(directory, "clone-relay.json"), "utf8")) as {
        pid: number;
        gate: string;
        result: string;
        target: string;
    }[];
    assert.equal(relays.length, 2);
    context.after(() => {
        for (const relay of relays)
            if (!existsSync(relay.result)) {
                try {
                    process.kill(relay.pid, "SIGKILL");
                } catch {}
            }
    });
    const release = async (relay: (typeof relays)[number]): Promise<void> => {
        writeFileSync(relay.gate, "release");
        const deadline = Date.now() + 30_000;
        while (!existsSync(relay.result) && Date.now() < deadline)
            await new Promise((resolve) => setTimeout(resolve, 10));
        assert.ok(existsSync(relay.result), "delayed helper did not exit");
        assert.deepEqual(JSON.parse(readFileSync(relay.result, "utf8")), { cloned: false });
    };
    using original = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const diagnosis = inspectRetainedDeviceLayerWorld(original, { deviceId });
    assert.equal(diagnosis.status, "pending");
    await recoverRetainedDeviceLayerWorld(original, {
        deviceId,
        commandId: "recover",
        expectedHeadRecordId: diagnosis.headRecordId,
    });
    const recovered = await reopenRetainedDeviceLayerWorld(original, { deviceId });
    const oldRoot = path.dirname(path.dirname(recovered.path));
    await recovered.writeFile("notes.txt", Buffer.from("later suffix"));
    await release(relays[0] as (typeof relays)[number]);
    assert.equal(
        readFileSync((relays[0] as (typeof relays)[number]).target, "utf8"),
        "uncheckpointed",
    );
    await recovered.cleanup({ commandId: "cleanup" });
    using freshStore = new SQLiteTraceStore(path.join(directory, "fresh.sqlite"));
    const fresh = await openRetainedDeviceLayerWorld(freshStore, {
        commandId: "create",
        root: directory,
    });
    assert.equal(fresh.deviceId, deviceId);
    assert.notEqual(path.dirname(path.dirname(fresh.path)), oldRoot);
    await fresh.writeFile("notes.txt", Buffer.from("new world"));
    await release(relays[1] as (typeof relays)[number]);
    assert.equal(existsSync((relays[1] as (typeof relays)[number]).target), false);
    assert.equal((await fresh.readFile("notes.txt")).toString(), "new world");
    await fresh.cleanup({ commandId: "fresh-cleanup" });
});
