import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
    compensateEffects,
    createEffectCompensationRegistry,
    deriveEffectCompensationId,
    EffectCompensationConflictError,
    inspectEffectCompensationOwnership,
    SQLiteTraceStore,
} from "../../src/index.ts";
import { effectProtocolConfig } from "../../src/protocol/config.ts";
import { temporaryDirectory } from "../replay/fixtures.ts";
import {
    compensateRow,
    ROW_INSERT_KIND,
    readCompensationLog,
    readRowIds,
    rowCompensation,
    runRowSession,
} from "./compensation-fixtures.ts";

test("a second connection cannot invoke an actively owned compensation", async (context) => {
    const directory = await temporaryDirectory(context, "compensation-exclusive");
    const databasePath = path.join(directory, "trace.sqlite");
    using first = new SQLiteTraceStore(databasePath);
    using second = new SQLiteTraceStore(databasePath);
    const { inspection } = await runRowSession(
        first,
        path.join(directory, "world.sqlite"),
        "source",
        [["a", "compensable"]],
    );
    const recordId = inspection.steps[0]?.record_id;
    assert.ok(recordId);
    let release: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
        release = resolve;
    });
    let calls = 0;
    const registry = createEffectCompensationRegistry([
        {
            handlerId: "exclusive",
            kind: ROW_INSERT_KIND,
            compensate: async () => {
                calls += 1;
                if (calls === 1) await pending;
                return { ok: true, value: null };
            },
        },
    ]);
    const owned = compensateEffects(first, {
        commandId: "first",
        effectRecordIds: [recordId],
        registry,
    });
    // Observe the first promise immediately: the old implementation can later conflict.
    const observed = owned.then(
        () => null,
        (error: unknown) => error,
    );
    try {
        await assert.rejects(
            compensateEffects(second, {
                commandId: "second",
                effectRecordIds: [recordId],
                registry,
            }),
            EffectCompensationConflictError,
        );
        assert.equal(calls, 1);
    } finally {
        release();
        await observed;
    }
    assert.equal(await observed, null);
});

test("separate processes serialize compensation ownership and retain one external invocation", async (context) => {
    const directory = await temporaryDirectory(context, "compensation-processes");
    const database = path.join(directory, "trace.sqlite");
    const world = path.join(directory, "world.sqlite");
    using store = new SQLiteTraceStore(database);
    const { inspection } = await runRowSession(store, world, "source", [["a", "compensable"]]);
    const recordId = inspection.steps[0]?.record_id;
    assert.ok(recordId);
    const start = (mode: string) => {
        const child = fork(
            fileURLToPath(new URL("../fixtures/compensation-owner-process.ts", import.meta.url)),
            [database, world, recordId, mode],
            { silent: true, execArgv: [] },
        );
        context.after(() => {
            if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        });
        return child;
    };
    const first = start("hold");
    const firstExit = once(first, "exit");
    const [entered] = await once(first, "message");
    assert.equal(entered.kind, "entered");
    const compensationId = deriveEffectCompensationId(recordId);
    const active = inspectEffectCompensationOwnership(store, { compensationId });
    assert.equal(active.compensation.status, "uncertain");
    assert.equal(active.ownership.status, "active");
    const second = start("run");
    const secondExit = once(second, "exit");
    const [refused] = await once(second, "message");
    assert.deepEqual(refused, { kind: "error", name: "EffectCompensationConflictError" });
    await secondExit;
    assert.deepEqual(readCompensationLog(world).get(compensationId), {
        invocations: 1,
        deleted: 1,
    });
    const done = once(first, "message");
    first.send("continue");
    assert.deepEqual((await done)[0], { kind: "done" });
    await firstExit;
    assert.equal(
        inspectEffectCompensationOwnership(store, { compensationId }).ownership.status,
        "released",
    );
    assert.equal(store.verifyIntegrity().ok, true);
});

test("SIGKILL before invocation, after world change and before outcome preserves expiry and stable-key recovery", async (context) => {
    for (const mode of ["before", "after", "publication"]) {
        const directory = await temporaryDirectory(context, `compensation-kill-${mode}`);
        const database = path.join(directory, "trace.sqlite");
        const world = path.join(directory, "world.sqlite");
        const seed = new SQLiteTraceStore(database);
        const { inspection } = await runRowSession(seed, world, "source", [["a", "compensable"]]);
        const recordId = inspection.steps[0]?.record_id;
        assert.ok(recordId);
        seed.close();
        const child = fork(
            fileURLToPath(new URL("../fixtures/compensation-owner-process.ts", import.meta.url)),
            [database, world, recordId, mode],
            { silent: true, execArgv: [] },
        );
        const [code, signal] = await once(child, "exit");
        assert.equal(code, null);
        assert.equal(signal, "SIGKILL");
        using reopened = new SQLiteTraceStore(database);
        const compensationId = deriveEffectCompensationId(recordId);
        const active = inspectEffectCompensationOwnership(reopened, { compensationId });
        assert.equal(active.ownership.status, "active");
        assert.equal(active.compensation.status, "uncertain");
        const retry = {
            commandId: "recover",
            effectRecordIds: [recordId],
            registry: rowCompensation(world),
        };
        await assert.rejects(compensateEffects(reopened, retry), EffectCompensationConflictError);
        assert.deepEqual(readRowIds(world), mode === "before" ? ["a"] : []);
        // Advance only the lease clock, after proving the actual process has died.
        const clock = context.mock.method(
            Date,
            "now",
            () => (active.ownership.lease_expires_at as number) + 1,
        );
        assert.equal(
            inspectEffectCompensationOwnership(reopened, { compensationId }).ownership.status,
            "expired",
        );
        await compensateEffects(reopened, retry);
        clock.mock.restore();
        assert.deepEqual(readRowIds(world), []);
        assert.deepEqual(readCompensationLog(world).get(compensationId), {
            invocations: mode === "before" ? 1 : 2,
            deleted: 1,
        });
        const settled = inspectEffectCompensationOwnership(reopened, { compensationId });
        assert.equal(settled.compensation.status, "compensated");
        assert.equal(settled.ownership.fencing_token, 2);
        using imported = new SQLiteTraceStore();
        imported.importTrace(reopened.exportTrace());
        const importedView = inspectEffectCompensationOwnership(imported, { compensationId });
        assert.deepEqual(importedView.compensation, settled.compensation);
        assert.equal(importedView.ownership.status, "absent");
        assert.equal(reopened.verifyIntegrity().ok, true);
    }
});

test("heartbeat extends a live lease and an expired holder cannot settle or release its replacement", async (context) => {
    const directory = await temporaryDirectory(context, "compensation-fences");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const world = path.join(directory, "world.sqlite");
    const { inspection } = await runRowSession(store, world, "source", [["a", "compensable"]]);
    const recordId = inspection.steps[0]?.record_id;
    assert.ok(recordId);
    const compensationId = deriveEffectCompensationId(recordId);
    let releaseFirst: () => void = () => {};
    let releaseSecond: () => void = () => {};
    const firstWait = new Promise<void>((resolve) => {
        releaseFirst = resolve;
    });
    const secondWait = new Promise<void>((resolve) => {
        releaseSecond = resolve;
    });
    let invocations = 0;
    const registry = createEffectCompensationRegistry([
        {
            handlerId: "fenced-world",
            kind: ROW_INSERT_KIND,
            compensate: async (request) => {
                invocations += 1;
                const result = compensateRow(world, request);
                await (invocations === 1 ? firstWait : secondWait);
                return { ok: true, value: result };
            },
        },
    ]);
    context.mock.timers.enable({ apis: ["Date", "setInterval"], now: Date.now() });
    const first = compensateEffects(store, {
        commandId: "first",
        effectRecordIds: [recordId],
        registry,
    }).then(
        () => null,
        (error: unknown) => error,
    );
    const initial = inspectEffectCompensationOwnership(store, { compensationId });
    for (
        let elapsed = 0;
        elapsed < effectProtocolConfig.compensation.ownership.leaseMilliseconds * 2;
        elapsed += effectProtocolConfig.compensation.ownership.renewalMilliseconds
    ) {
        context.mock.timers.tick(effectProtocolConfig.compensation.ownership.renewalMilliseconds);
    }
    const renewed = inspectEffectCompensationOwnership(store, { compensationId });
    assert.equal(renewed.ownership.status, "active");
    assert.ok(
        (renewed.ownership.lease_expires_at as number) >
            (initial.ownership.lease_expires_at as number),
    );
    await assert.rejects(
        compensateEffects(store, { commandId: "blocked", effectRecordIds: [recordId], registry }),
        EffectCompensationConflictError,
    );
    // Move the clock beyond the lease without delivering heartbeats, modeling a stopped worker.
    const clock = context.mock.method(
        Date,
        "now",
        () => (renewed.ownership.lease_expires_at as number) + 1,
    );
    const second = compensateEffects(store, {
        commandId: "replacement",
        effectRecordIds: [recordId],
        registry,
    });
    const replacement = inspectEffectCompensationOwnership(store, { compensationId });
    assert.equal(replacement.ownership.fencing_token, 2);
    assert.notEqual(replacement.ownership.claim_id, initial.ownership.claim_id);
    releaseFirst();
    assert.ok((await first) instanceof EffectCompensationConflictError);
    assert.equal(
        inspectEffectCompensationOwnership(store, { compensationId }).ownership.status,
        "active",
    );
    releaseSecond();
    await second;
    clock.mock.restore();
    context.mock.timers.reset();
    assert.deepEqual(readCompensationLog(world).get(compensationId), {
        invocations: 2,
        deleted: 1,
    });
    assert.equal(
        inspectEffectCompensationOwnership(store, { compensationId }).compensation.status,
        "compensated",
    );
});

test("publication uncertainty blocks duplicate admission and heartbeat failure prevents a success receipt", async (context) => {
    const directory = await temporaryDirectory(context, "compensation-uncertainty");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const world = path.join(directory, "world.sqlite");
    const { inspection } = await runRowSession(store, world, "source", [
        ["a", "compensable"],
        ["b", "compensable"],
    ]);
    const firstId = inspection.steps[0]?.record_id;
    const secondId = inspection.steps[1]?.record_id;
    assert.ok(firstId && secondId);
    const originalClaim = store.claimEffectCompensationAttempt.bind(store);
    store.claimEffectCompensationAttempt = (...args) => {
        originalClaim(...args);
        throw new Error("lost admission acknowledgement");
    };
    await assert.rejects(
        compensateEffects(store, {
            commandId: "lost",
            effectRecordIds: [firstId],
            registry: rowCompensation(world),
        }),
        /lost admission/u,
    );
    store.claimEffectCompensationAttempt = originalClaim;
    assert.deepEqual(readRowIds(world), ["a", "b"]);
    await assert.rejects(
        compensateEffects(store, {
            commandId: "duplicate",
            effectRecordIds: [firstId],
            registry: rowCompensation(world),
        }),
        EffectCompensationConflictError,
    );
    let release: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
        release = resolve;
    });
    const registry = createEffectCompensationRegistry([
        {
            handlerId: "heartbeat",
            kind: ROW_INSERT_KIND,
            compensate: async (request) => {
                const value = compensateRow(world, request);
                await pending;
                return { ok: true, value };
            },
        },
    ]);
    context.mock.timers.enable({ apis: ["setInterval"] });
    const work = compensateEffects(store, {
        commandId: "heartbeat",
        effectRecordIds: [secondId],
        registry,
    }).then(
        () => null,
        (error: unknown) => error,
    );
    const renew = store.renewEffectCompensationClaim.bind(store);
    store.renewEffectCompensationClaim = () => {
        throw new Error("heartbeat storage failed");
    };
    context.mock.timers.tick(effectProtocolConfig.compensation.ownership.renewalMilliseconds);
    release();
    assert.match(String(await work), /heartbeat storage failed/u);
    store.renewEffectCompensationClaim = renew;
    context.mock.timers.reset();
    const view = inspectEffectCompensationOwnership(store, {
        compensationId: deriveEffectCompensationId(secondId),
    });
    assert.equal(view.compensation.status, "uncertain");
    assert.equal(view.ownership.status, "released");
    await compensateEffects(store, {
        commandId: "recover",
        effectRecordIds: [secondId],
        registry: rowCompensation(world),
    });
    assert.deepEqual(readCompensationLog(world).get(deriveEffectCompensationId(secondId)), {
        invocations: 2,
        deleted: 1,
    });
});
