import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
    deriveRetainedDeviceLayerId,
    inspectRetainedDeviceLayerWorld,
    openRetainedDeviceLayerWorld,
    recoverRetainedDeviceLayerWorld,
    reopenRetainedDeviceLayerWorld,
    SQLiteTraceStore,
} from "../../src/index.ts";
import { workspaceProtocolConfig } from "../../src/protocol/config.ts";
import {
    assertUnreservedDeviceLayerOwners,
    runDeviceLayerJournalWork,
} from "../../src/store/device-layer-journals.ts";
import { CarrierBackendUnavailableError } from "../../src/workspace/carrier-backends.ts";
import { readRetainedDeviceHead } from "../../src/workspace/retained-device-records.ts";
import { temporaryDirectory } from "../replay/fixtures.ts";

const config = workspaceProtocolConfig.deviceLayers.retained;

test("adapter admission translates supported backend refusals and preserves unexpected failures", async (context) => {
    const directory = await temporaryDirectory(context, "device-adapter-failure");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const original = fs.mkdirSync;
    for (const fault of [
        new CarrierBackendUnavailableError(config.adapters.copy, "unavailable", "fixture"),
        new Error("unexpected backend fault"),
    ]) {
        const injected = context.mock.method(
            fs,
            "mkdirSync",
            (...args: Parameters<typeof original>) => {
                if (String(args[0]).includes(config.stagingDirectoryPrefix)) throw fault;
                return original(...args);
            },
        );
        syncBuiltinESMExports();
        try {
            await assert.rejects(
                openRetainedDeviceLayerWorld(store, {
                    commandId: "create",
                    root: directory,
                    adapter: config.adapters.clone,
                }),
                fault instanceof CarrierBackendUnavailableError
                    ? /durable adapter unavailable/u
                    : /unexpected backend fault/u,
            );
        } finally {
            injected.mock.restore();
            syncBuiltinESMExports();
        }
    }
    assert.throws(
        () =>
            inspectRetainedDeviceLayerWorld(store, {
                deviceId: deriveRetainedDeviceLayerId("create"),
            }),
        /journal is absent/u,
    );
});

test("journal authority refuses contradictory database reads and diagnoses non-error host failures", async (context) => {
    const directory = await temporaryDirectory(context, "device-store-faults");
    const database = path.join(directory, "trace.sqlite");
    using store = new SQLiteTraceStore(database);
    const world = await openRetainedDeviceLayerWorld(store, {
        commandId: "create",
        root: directory,
    });
    const head = readRetainedDeviceHead(store, world.deviceId);
    assert.doesNotThrow(() => assertUnreservedDeviceLayerOwners({ groups: [] }));
    const uid = Object.getOwnPropertyDescriptor(process, "getuid");
    assert.ok(uid);
    Object.defineProperty(process, "getuid", { value: undefined, configurable: true });
    try {
        assert.throws(() => store.deviceLayerDatabaseIdentity(), /single-link/u);
    } finally {
        Object.defineProperty(process, "getuid", uid);
    }
    const hostFault = context.mock.method(store, "readDeviceLayerRegistration", () => {
        throw "host authority fault";
    });
    try {
        assert.equal(
            inspectRetainedDeviceLayerWorld(store, { deviceId: world.deviceId }).reason,
            "host authority fault",
        );
    } finally {
        hostFault.mock.restore();
    }
    using raw = new DatabaseSync(database);
    const original = raw.prepare.bind(raw);
    const contradictory = context.mock.method(raw, "prepare", (sql: string) => {
        const statement = original(sql);
        if (sql.includes("ORDER BY owner_ordinal LIMIT 1"))
            context.mock.method(statement, "get", () => ({ record_id: head.recordId }));
        return statement;
    });
    try {
        assert.throws(
            () =>
                runDeviceLayerJournalWork(raw, world.deviceId, head.recordId, () => {
                    throw new Error("must not enter physical work");
                }),
            /registration differs/u,
        );
    } finally {
        contradictory.mock.restore();
    }
    await world.cleanup({ commandId: "cleanup" });
});

test("command arrival between optimistic read and locked admission refuses before publication", async (context) => {
    const directory = await temporaryDirectory(context, "device-command-admission");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const world = await openRetainedDeviceLayerWorld(store, {
        commandId: "create",
        root: directory,
    });
    const existing = store.readOwner(config.commandOwnerPrefix + "create");
    const original = store.readOwner.bind(store);
    for (const action of ["open", "checkpoint"]) {
        let reads = 0;
        const commandId = `racing-${action}`;
        const injection = context.mock.method(store, "readOwner", (owner: string) => {
            if (owner === config.commandOwnerPrefix + commandId && ++reads > 1) return existing;
            return original(owner);
        });
        const before = store.exportTrace();
        try {
            await assert.rejects(
                action === "open"
                    ? openRetainedDeviceLayerWorld(store, { commandId, root: directory })
                    : world.checkpoint({ commandId, name: "one" }),
                /command already exists/u,
            );
            assert.equal(reads, 2);
            assert.equal(store.exportTrace(), before);
        } finally {
            injection.mock.restore();
        }
    }
    await world.cleanup({ commandId: "cleanup" });
});

test("interrupted recovery admission can be retried or explicitly superseded at its exact head", async (context) => {
    const directory = await temporaryDirectory(context, "device-recovery-admission");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const originalSync = fs.fsyncSync;
    let calls = 0;
    const failure = context.mock.method(fs, "fsyncSync", (descriptor: number) => {
        originalSync(descriptor);
        if (++calls === 2) throw new Error("creation interrupted");
    });
    syncBuiltinESMExports();
    try {
        await assert.rejects(
            openRetainedDeviceLayerWorld(store, { commandId: "create", root: directory }),
            /creation interrupted/u,
        );
    } finally {
        failure.mock.restore();
        syncBuiltinESMExports();
    }
    const deviceId = deriveRetainedDeviceLayerId("create");
    const diagnosis = inspectRetainedDeviceLayerWorld(store, { deviceId });
    assert.equal(diagnosis.status, "pending");
    const recovery = {
        deviceId,
        commandId: "repair",
        expectedHeadRecordId: diagnosis.headRecordId,
    };
    const originalWork = store.runDeviceLayerJournalWork.bind(store);
    let workCalls = 0;
    const interrupted = context.mock.method(
        store,
        "runDeviceLayerJournalWork",
        (...args: Parameters<typeof originalWork>) => {
            if (++workCalls > 1) throw new Error("physical stage not entered");
            return originalWork(...args);
        },
    );
    try {
        await assert.rejects(
            recoverRetainedDeviceLayerWorld(store, recovery),
            /physical stage not entered/u,
        );
        await assert.rejects(
            recoverRetainedDeviceLayerWorld(store, recovery),
            /physical stage not entered/u,
        );
    } finally {
        interrupted.mock.restore();
    }
    const pending = inspectRetainedDeviceLayerWorld(store, { deviceId });
    assert.equal(pending.status, "pending");
    const existing = store.readOwner(config.commandOwnerPrefix + "repair");
    const originalRead = store.readOwner.bind(store);
    let reads = 0;
    const competing = context.mock.method(store, "readOwner", (owner: string) => {
        if (owner === config.commandOwnerPrefix + "competing" && ++reads > 1) return existing;
        return originalRead(owner);
    });
    try {
        await assert.rejects(
            recoverRetainedDeviceLayerWorld(store, {
                deviceId,
                commandId: "competing",
                expectedHeadRecordId: pending.headRecordId,
            }),
            /recovery command already exists/u,
        );
    } finally {
        competing.mock.restore();
    }
    const recovered = await recoverRetainedDeviceLayerWorld(store, {
        deviceId,
        commandId: "second-repair",
        expectedHeadRecordId: pending.headRecordId,
    });
    assert.equal(recovered.status, "ready");
    assert.deepEqual(await recoverRetainedDeviceLayerWorld(store, recovery), recovered);
    const world = await reopenRetainedDeviceLayerWorld(store, { deviceId });
    await world.cleanup({ commandId: "cleanup" });
});

test("recovery refuses a successor observed after an older device-head read", async (context) => {
    const directory = await temporaryDirectory(context, "device-head-read-race");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const world = await openRetainedDeviceLayerWorld(store, {
        commandId: "create",
        root: directory,
    });
    const priorRecords = store.readOwner(world.deviceId);
    const originalSync = fs.fsyncSync;
    let calls = 0;
    const failure = context.mock.method(fs, "fsyncSync", (descriptor: number) => {
        originalSync(descriptor);
        if (++calls === 2) throw new Error("checkpoint interrupted");
    });
    syncBuiltinESMExports();
    try {
        await assert.rejects(
            world.checkpoint({ commandId: "capture", name: "one" }),
            /checkpoint interrupted/u,
        );
    } finally {
        failure.mock.restore();
        syncBuiltinESMExports();
    }
    const diagnosis = inspectRetainedDeviceLayerWorld(store, { deviceId: world.deviceId });
    assert.equal(diagnosis.status, "pending");
    const recovery = {
        deviceId: world.deviceId,
        commandId: "repair",
        expectedHeadRecordId: diagnosis.headRecordId,
    };
    const originalWork = store.runDeviceLayerJournalWork.bind(store);
    let workCalls = 0;
    const interruption = context.mock.method(
        store,
        "runDeviceLayerJournalWork",
        (...args: Parameters<typeof originalWork>) => {
            if (++workCalls > 1) throw new Error("physical work not entered");
            return originalWork(...args);
        },
    );
    try {
        await assert.rejects(
            recoverRetainedDeviceLayerWorld(store, recovery),
            /physical work not entered/u,
        );
    } finally {
        interruption.mock.restore();
    }
    const originalRead = store.readOwner.bind(store);
    let deviceReads = 0;
    const stale = context.mock.method(store, "readOwner", (owner: string) =>
        owner === world.deviceId && ++deviceReads === 1 ? priorRecords : originalRead(owner),
    );
    const before = store.exportTrace();
    try {
        await assert.rejects(
            recoverRetainedDeviceLayerWorld(store, recovery),
            /recovery target operation changed/u,
        );
    } finally {
        stale.mock.restore();
    }
    assert.equal(store.exportTrace(), before);
    assert.equal((await recoverRetainedDeviceLayerWorld(store, recovery)).status, "ready");
    const reopened = await reopenRetainedDeviceLayerWorld(store, { deviceId: world.deviceId });
    await reopened.cleanup({ commandId: "cleanup" });
});
