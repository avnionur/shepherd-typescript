import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import {
    compensateEffects,
    createEffectCompensationRegistry,
    deriveEffectCompensationId,
    deriveReplaySessionId,
    EffectCompensationEvidenceError,
    EffectCompensationFailedError,
    EffectCompensationHandlerNotFoundError,
    type EffectCompensationRegistry,
    inspectEffectCompensation,
    inspectReplaySession,
    type ReplaySessionInspection,
    ROOT_WITNESS_ID,
    replayReplaySession,
    rewindReplaySession,
    SQLiteTraceStore,
    TraceStoreError,
} from "../../src/index.ts";
import { effectProtocolConfig } from "../../src/protocol/config.ts";
import { temporaryDirectory } from "../replay/fixtures.ts";
import {
    compensateRow,
    ROW_INSERT_KIND,
    readCompensationLog,
    readRowIds,
    rowCompensation,
    rowInsertHandlers,
    rowProgram,
    runRowSession,
} from "./compensation-fixtures.ts";

const ROWS = [
    ["a", "compensable"],
    ["b", "compensable"],
    ["c", "reversible"],
    ["d", "compensable"],
] as const;

async function fixture(context: Parameters<typeof temporaryDirectory>[0], label: string) {
    const directory = await temporaryDirectory(context, `compensation-${label}`);
    const store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    context.after(() => store.close());
    const world = path.join(directory, "world.sqlite");
    const { inspection } = await runRowSession(store, world, "session:rows", ROWS);
    return { directory, source: inspection, store, world };
}

function compensationOf(source: ReplaySessionInspection, index: number): string {
    return deriveEffectCompensationId(source.steps[index]?.record_id as string);
}

test("registries hold exactly one compensation handler per effect kind", () => {
    const handler = {
        compensate: () => ({ ok: true, value: null }) as const,
        handlerId: "compensation:one",
        kind: "rows.insert",
    };
    const registry = createEffectCompensationRegistry([handler]);
    assert.deepEqual(registry.kinds, ["rows.insert"]);
    assert.equal(registry.resolve("rows.insert")?.handlerId, "compensation:one");
    assert.equal(registry.resolve("rows.update"), undefined);
    assert.equal(Object.isFrozen(registry), true);
    assert.throws(
        () =>
            createEffectCompensationRegistry([
                handler,
                { ...handler, handlerId: "compensation:two" },
            ]),
        TypeError,
    );
    assert.throws(
        () => createEffectCompensationRegistry([handler, { ...handler, kind: "rows.update" }]),
        TypeError,
    );
    assert.throws(() => createEffectCompensationRegistry([{ ...handler, kind: "" }]), TypeError);
    assert.throws(
        () => createEffectCompensationRegistry([{ ...handler, compensate: null as never }]),
        TypeError,
    );
    assert.throws(() => createEffectCompensationRegistry({} as never), TypeError);
});

test("rewind compensates the source suffix once, in reverse materialization order, with retained records", async (context) => {
    const { source, store, world } = await fixture(context, "rewind");
    assert.deepEqual(readRowIds(world), ["a", "b", "c", "d"]);

    // Without handlers nothing is written: no branch, no compensation path.
    await assert.rejects(
        rewindReplaySession(store, {
            claimId: "operator",
            commandId: "rewind:no-handlers",
            sourceSessionId: source.session_id,
            target: { stepCount: 1 },
        }),
        (error: unknown) =>
            error instanceof EffectCompensationHandlerNotFoundError &&
            error.kind === ROW_INSERT_KIND &&
            error.code === effectProtocolConfig.compensation.errors.handlerNotFoundCode,
    );
    assert.equal(store.readOwner(deriveReplaySessionId("rewind:no-handlers")).length, 0);
    assert.equal(store.readOwner(compensationOf(source, 3)).length, 0);

    const calls: string[] = [];
    const { inspection: rewound } = await rewindReplaySession(store, {
        claimId: "operator",
        commandId: "rewind:1",
        compensation: rowCompensation(world, calls),
        sourceSessionId: source.session_id,
        target: { stepCount: 1 },
    });
    assert.equal(rewound.terminal?.status, "rewound");
    // Reverse order; the reversible effect and the prefix are untouched.
    assert.deepEqual(calls, ["effect:row:d", "effect:row:b"]);
    assert.deepEqual(readRowIds(world), ["a", "c"]);
    const compensated = inspectEffectCompensation(store, {
        compensationId: compensationOf(source, 3),
    });
    assert.equal(compensated.status, "compensated");
    assert.deepEqual(compensated.materialization, {
        kind: "replay_step",
        record_id: source.steps[3]?.record_id,
    });
    assert.deepEqual(compensated.effect_intent, source.steps[3]?.effect?.intent);
    assert.deepEqual(compensated.effect_outcome, source.steps[3]?.effect?.outcome);
    assert.equal(compensated.attempts.length, 1);
    assert.deepEqual(compensated.attempts[0]?.trigger, {
        command_id: "rewind:1",
        kind: "replay_rewind",
    });
    assert.equal(compensated.attempts[0]?.handler_id, "compensation:rows.delete");
    assert.deepEqual(compensated.attempts[0]?.outcome?.result, {
        ok: true,
        value: { deleted: 1 },
    });
    assert.equal(Object.isFrozen(compensated), true);
    // Retained records: intent (caused by the materialization), attempt, outcome.
    const records = store.readOwner(compensated.compensation_id);
    assert.deepEqual(
        records.map((record) => (record.body as { readonly phase: string }).phase),
        ["intent", "attempt", "outcome"],
    );
    assert.deepEqual(records[0]?.envelope.caused_by_record_ids, [source.steps[3]?.record_id]);
    assert.equal(records[0]?.envelope.schema_ref, effectProtocolConfig.compensation.traceSchema);

    // Repeating the completed branch neither restores nor compensates.
    const repeated = await rewindReplaySession(store, {
        claimId: "operator",
        commandId: "rewind:1",
        compensation: rowCompensation(world, calls),
        sourceSessionId: source.session_id,
        target: { stepCount: 1 },
    });
    assert.deepEqual(repeated.inspection, rewound);

    // A second rewind of the same source past the same effects compensates only the new one,
    // and needs no handler for effects already compensated.
    await rewindReplaySession(store, {
        claimId: "operator",
        commandId: "rewind:0",
        compensation: rowCompensation(world, calls),
        sourceSessionId: source.session_id,
        target: { stepCount: 0 },
    });
    assert.deepEqual(calls, ["effect:row:d", "effect:row:b", "effect:row:a"]);
    assert.deepEqual(readRowIds(world), ["c"]);

    // Rewinding the branch past its recorded prefix reaches the same original materialization.
    const empty = createEffectCompensationRegistry([]);
    await rewindReplaySession(store, {
        claimId: "operator",
        commandId: "rewind:branch",
        compensation: empty,
        sourceSessionId: rewound.session_id,
        target: { stepCount: 0 },
    });
    assert.deepEqual(calls, ["effect:row:d", "effect:row:b", "effect:row:a"]);
    for (const [key, entry] of readCompensationLog(world)) {
        assert.deepEqual(entry, { deleted: 1, invocations: 1 }, key);
    }
    assert.equal(store.verifyIntegrity().ok, true);
});

test("replay compensates the source suffix before the live suffix re-materializes it", async (context) => {
    const { source, store, world } = await fixture(context, "replay");
    const calls: string[] = [];
    const { inspection } = await replayReplaySession(store, {
        changes: ["handlers"],
        claimId: "operator",
        commandId: "replay:2",
        compensation: rowCompensation(world, calls),
        handlers: rowInsertHandlers(world),
        program: rowProgram(ROWS),
        sourceSessionId: source.session_id,
        target: { stepCount: 2 },
    });
    assert.equal(inspection.terminal?.status, "finished");
    assert.deepEqual(calls, ["effect:row:d"]);
    // d was compensated before the branch opened; the live suffix then re-materialized c and d.
    assert.deepEqual(readRowIds(world), ["a", "b", "c", "d"]);
    const compensation = inspectEffectCompensation(store, {
        compensationId: compensationOf(source, 3),
    });
    assert.deepEqual(compensation.attempts[0]?.trigger, {
        command_id: "replay:2",
        kind: "replay_replay",
    });
    assert.equal(inspection.steps[3]?.source, "live");
    assert.notEqual(inspection.steps[3]?.record_id, source.steps[3]?.record_id);
});

test("a handler that throws after changing the world leaves the attempt uncertain and a retry compensates idempotently", async (context) => {
    const { source, store, world } = await fixture(context, "uncertain");
    const calls: string[] = [];
    let crash = true;
    const registry = rowCompensation(world, calls, () => {
        if (crash) {
            crash = false;
            throw new Error("process died after the delete committed");
        }
    });
    const options = {
        claimId: "operator",
        commandId: "rewind:uncertain",
        compensation: registry,
        sourceSessionId: source.session_id,
        target: { stepCount: 3 },
    } as const;
    await assert.rejects(rewindReplaySession(store, options), /process died/u);
    const compensationId = compensationOf(source, 3);
    const uncertain = inspectEffectCompensation(store, { compensationId });
    assert.equal(uncertain.status, "uncertain");
    assert.equal(uncertain.attempts[0]?.outcome, null);
    assert.deepEqual(readRowIds(world), ["a", "b", "c"]);
    assert.equal(store.readOwner(deriveReplaySessionId("rewind:uncertain")).length, 0);

    const { inspection } = await rewindReplaySession(store, options);
    assert.equal(inspection.terminal?.status, "rewound");
    const compensated = inspectEffectCompensation(store, { compensationId });
    assert.equal(compensated.status, "compensated");
    assert.deepEqual(
        compensated.attempts.map((attempt) => [attempt.attempt, attempt.outcome?.status ?? null]),
        [
            [1, null],
            [2, "compensated"],
        ],
    );
    assert.deepEqual(compensated.attempts[1]?.outcome?.result, {
        ok: true,
        value: { deleted: 0 },
    });
    assert.deepEqual(calls, ["effect:row:d", "effect:row:d"]);
    // Two invocations under one idempotency key changed the world exactly once.
    assert.deepEqual(readCompensationLog(world).get(compensationId), {
        deleted: 1,
        invocations: 2,
    });
    assert.deepEqual(readRowIds(world), ["a", "b", "c"]);
});

test("a failed compensation is retained, reported after every effect was attempted, and retried by the next trigger", async (context) => {
    const { source, store, world } = await fixture(context, "failed");
    const calls: string[] = [];
    let refuse = true;
    const registry = createEffectCompensationRegistry([
        {
            compensate: (request) => {
                calls.push(request.intent.effect_id);
                if (refuse && request.intent.effect_id === "effect:row:d") {
                    return { error: { reason: "locked" }, ok: false };
                }
                return { ok: true, value: compensateRow(world, request) };
            },
            handlerId: "compensation:flaky",
            kind: ROW_INSERT_KIND,
        },
    ]);
    const options = {
        claimId: "operator",
        commandId: "rewind:failed",
        compensation: registry,
        sourceSessionId: source.session_id,
        target: { stepCount: 1 },
    } as const;
    await assert.rejects(
        rewindReplaySession(store, options),
        (error: unknown) =>
            error instanceof EffectCompensationFailedError &&
            error.compensation_ids.length === 1 &&
            error.compensation_ids[0] === compensationOf(source, 3),
    );
    assert.deepEqual(calls, ["effect:row:d", "effect:row:b"]);
    assert.deepEqual(readRowIds(world), ["a", "c", "d"]);
    const failed = inspectEffectCompensation(store, { compensationId: compensationOf(source, 3) });
    assert.equal(failed.status, "failed");
    assert.deepEqual(failed.attempts[0]?.outcome?.result, {
        error: { reason: "locked" },
        ok: false,
    });
    refuse = false;
    await rewindReplaySession(store, options);
    assert.deepEqual(calls, ["effect:row:d", "effect:row:b", "effect:row:d"]);
    assert.deepEqual(readRowIds(world), ["a", "c"]);
    assert.equal(
        inspectEffectCompensation(store, { compensationId: compensationOf(source, 3) }).status,
        "compensated",
    );
});

test("explicit compensation resolves recorded steps to their origin and refuses non-compensable evidence", async (context) => {
    const { source, store, world } = await fixture(context, "explicit");
    const calls: string[] = [];
    const registry: EffectCompensationRegistry = rowCompensation(world, calls);
    await assert.rejects(
        compensateEffects(store, {
            commandId: "compensate:reversible",
            effectRecordIds: [source.steps[2]?.record_id as string],
            registry,
        }),
        EffectCompensationEvidenceError,
    );
    await assert.rejects(
        compensateEffects(store, {
            commandId: "compensate:session",
            effectRecordIds: [source.session_record_id],
            registry,
        }),
        EffectCompensationEvidenceError,
    );
    await assert.rejects(
        compensateEffects(store, {
            commandId: "compensate:missing",
            effectRecordIds: [`sha256:${"0".repeat(64)}`],
            registry,
        }),
        EffectCompensationEvidenceError,
    );
    await assert.rejects(
        compensateEffects(store, {
            commandId: "compensate:forged",
            effectRecordIds: [],
            registry: { kinds: [], resolve: () => undefined },
        }),
        TypeError,
    );
    // A branch whose recorded prefix copies the source's first two steps.
    const { inspection: branch } = await rewindReplaySession(store, {
        claimId: "operator",
        commandId: "rewind:2",
        compensation: registry,
        sourceSessionId: source.session_id,
        target: { stepCount: 2 },
    });
    assert.deepEqual(calls, ["effect:row:d"]);
    const receipt = await compensateEffects(store, {
        commandId: "compensate:prefix",
        effectRecordIds: [
            branch.steps[0]?.record_id as string,
            branch.steps[1]?.record_id as string,
            source.steps[3]?.record_id as string,
        ],
        registry,
    });
    assert.deepEqual(calls, ["effect:row:d", "effect:row:b", "effect:row:a"]);
    assert.deepEqual(
        receipt.compensations.map((entry) => entry.materialization.record_id),
        [3, 1, 0].map((index) => source.steps[index]?.record_id),
    );
    assert.deepEqual(
        receipt.compensations.map((entry) => entry.status),
        ["compensated", "compensated", "compensated"],
    );
    assert.equal(receipt.compensations[1]?.attempts[0]?.trigger.kind, "command");
    assert.deepEqual(readRowIds(world), ["c"]);
    assert.throws(
        () => inspectEffectCompensation(store, { compensationId: compensationOf(source, 2) }),
        EffectCompensationEvidenceError,
    );
});

test("compensation paths are reserved against raw appends and cut publication", async (context) => {
    const { source, store } = await fixture(context, "reserved");
    const compensationId = compensationOf(source, 0);
    assert.throws(
        () =>
            store.append({
                append_intent_id: "intent:forged-compensation",
                batch: {
                    groups: [
                        {
                            owner_id: compensationId,
                            records: [
                                {
                                    body: { phase: "outcome" },
                                    mode: "capture",
                                    schema_ref: effectProtocolConfig.compensation.traceSchema,
                                    witness_ref: ROOT_WITNESS_ID,
                                },
                            ],
                        },
                    ],
                },
            }),
        TraceStoreError,
    );
    assert.throws(
        () =>
            store.publishCut({
                cut_id: "cut:forged",
                publisher_owner_id: compensationId,
                target_owner_id: source.session_id,
                through_record_id: source.session_record_id,
            }),
        TraceStoreError,
    );
    assert.equal(
        inspectReplaySession(store, { sessionId: source.session_id }).steps.length,
        ROWS.length,
    );
});
