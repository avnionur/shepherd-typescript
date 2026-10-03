import assert from "node:assert/strict";
import { test } from "node:test";
import {
    captureTaskWorldDurably,
    createEffectOutcome,
    createRetainedWorldRunner,
    type EffectIntent,
    type EffectOutcome,
    executeTask,
    inspectTaskWorldEffects,
    type OwnerRecord,
    type RecordBody,
    SQLiteTraceStore,
    TraceStoreError,
} from "../../src/index.ts";
import { createWorldEffectFixture } from "./world-effect-fixtures.ts";

test("operation inspection refuses forged authority, ordering, outcomes and bounded content evidence", async (context) => {
    const fixture = await createWorldEffectFixture(context);
    using store = new SQLiteTraceStore(fixture.storePath);
    const runner = createRetainedWorldRunner({
        enforcement: "advisory",
        runnerId: "evidence-validation",
        run: async (execution) => {
            await execution.world.writeText("value.txt", "changed");
            await execution.world.readText("value.txt");
            await assert.rejects(execution.world.readText("../denied"), TypeError);
            await execution.world.writeText("value.txt", "original");
            return executeTask(execution.execution);
        },
    });
    await captureTaskWorldDurably({ ...fixture.options, runner, store });
    const records = store.readOwner(fixture.options.execution.runId);
    const patch = (
        phase: string,
        index: number | undefined,
        mutate: (body: Record<string, unknown>) => void,
    ): readonly OwnerRecord[] => {
        let changed = 0;
        let changedIntent: EffectIntent | undefined;
        let result = records.map((record) => {
            if (
                record.body.world_effect_version === undefined ||
                record.body.phase !== phase ||
                record.body.index !== index
            )
                return record;
            changed += 1;
            const body = structuredClone(record.body) as Record<string, unknown>;
            mutate(body);
            if (phase === "intent") changedIntent = body.effect as EffectIntent;
            return { ...record, body: body as RecordBody };
        });
        assert.equal(changed, 1);
        // Keep the generic effect pair consistent: the world-specific rules must reject it.
        if (changedIntent !== undefined) {
            const intent = changedIntent;
            result = result.map((record) => {
                if (
                    record.body.world_effect_version === undefined ||
                    record.body.phase !== "outcome" ||
                    record.body.index !== index
                )
                    return record;
                const outcome = record.body.effect as unknown as EffectOutcome;
                return {
                    ...record,
                    body: {
                        ...record.body,
                        effect: createEffectOutcome(
                            intent,
                            outcome.result,
                        ) as unknown as RecordBody,
                    },
                };
            });
        }
        return result;
    };
    const payload = (body: Record<string, unknown>) =>
        (body.effect as Record<string, unknown>).payload as Record<string, unknown>;
    const outcomeValue = (body: Record<string, unknown>) =>
        ((body.effect as Record<string, unknown>).result as Record<string, unknown>)
            .value as Record<string, unknown>;
    const cases: readonly (readonly [string, readonly OwnerRecord[]])[] = [
        [
            "version",
            patch("opened", undefined, (body) => {
                body.world_effect_version = 0;
            }),
        ],
        [
            "opening phase",
            patch("opened", undefined, (body) => {
                body.phase = "intent";
            }),
        ],
        [
            "authority",
            patch("opened", undefined, (body) => {
                (body.authority as Record<string, unknown>).fencing_token = 123;
            }),
        ],
        [
            "capture identity",
            patch("intent", 0, (body) => {
                body.capture_id = "other";
            }),
        ],
        [
            "run identity",
            patch("intent", 0, (body) => {
                body.run_id = "other";
            }),
        ],
        [
            "operation position",
            patch("intent", 0, (body) => {
                body.index = 2;
            }),
        ],
        [
            "effect identity",
            patch("intent", 0, (body) => {
                (body.effect as Record<string, unknown>).effect_id = "foreign";
            }),
        ],
        [
            "effect kind",
            patch("intent", 0, (body) => {
                (body.effect as Record<string, unknown>).kind = "foreign";
            }),
        ],
        [
            "required authority",
            patch("intent", 0, (body) => {
                payload(body).required_atom = "read";
            }),
        ],
        [
            "authority citation",
            patch("intent", 0, (body) => {
                payload(body).authority_record_id = records[0]?.envelope.record_id;
            }),
        ],
        [
            "reversibility",
            patch("intent", 0, (body) => {
                (body.effect as Record<string, unknown>).reversibility = "compensable";
            }),
        ],
        [
            "read/write shape",
            patch("intent", 1, (body) => {
                payload(body).content = payload(body).path;
            }),
        ],
        [
            "text flags",
            patch("intent", 0, (body) => {
                (payload(body).path as Record<string, unknown>).valid_text = 1;
            }),
        ],
        [
            "text bound",
            patch("intent", 0, (body) => {
                (payload(body).path as Record<string, unknown>).within_bound = false;
            }),
        ],
        [
            "invalid digest",
            patch("intent", 0, (body) => {
                (payload(body).path as Record<string, unknown>).digest = "bad";
            }),
        ],
        [
            "invalid text digest",
            patch("intent", 0, (body) => {
                (payload(body).path as Record<string, unknown>).valid_text = false;
            }),
        ],
        [
            "non-text contradiction",
            patch("intent", 0, (body) => {
                (payload(body).path as Record<string, unknown>).byte_length = null;
            }),
        ],
        [
            "admission correlation",
            patch("admitted", 0, (body) => {
                body.effect_id = "foreign";
            }),
        ],
        [
            "outcome ordering",
            patch("outcome", 0, (body) => {
                body.index = 2;
            }),
        ],
        [
            "outcome correlation",
            patch("outcome", 0, (body) => {
                (body.effect as Record<string, unknown>).intent_ref = "wrong";
            }),
        ],
        [
            "unknown success",
            patch("outcome", 0, (body) => {
                outcomeValue(body).status = "foreign";
            }),
        ],
        [
            "write/read result",
            patch("outcome", 0, (body) => {
                outcomeValue(body).result = {};
            }),
        ],
        [
            "invalid read evidence",
            patch("outcome", 1, (body) => {
                outcomeValue(body).result = {
                    byte_length: null,
                    digest: null,
                    valid_text: false,
                    within_bound: false,
                };
            }),
        ],
        [
            "false refusal after admission",
            patch("outcome", 0, (body) => {
                (body.effect as Record<string, unknown>).result = {
                    ok: false,
                    error: { status: "refused" },
                };
            }),
        ],
        [
            "unknown failure",
            patch("outcome", 2, (body) => {
                (body.effect as Record<string, unknown>).result = {
                    ok: false,
                    error: { status: "foreign" },
                };
            }),
        ],
        [
            "unknown phase",
            patch("outcome", 0, (body) => {
                body.phase = "foreign";
            }),
        ],
        [
            "extra field",
            patch("intent", 0, (body) => {
                body.extra = true;
            }),
        ],
        [
            "incomplete settled capture",
            records.filter(
                (record) =>
                    !(
                        record.body.world_effect_version !== undefined &&
                        record.body.phase === "outcome" &&
                        record.body.index === 3
                    ),
            ),
        ],
        [
            "foreign predecessor",
            records.map((record) =>
                record.body.world_effect_version !== undefined &&
                record.body.phase === "intent" &&
                record.body.index === 0
                    ? { ...record, envelope: { ...record.envelope, caused_by_record_ids: [] } }
                    : record,
            ),
        ],
        [
            "foreign envelope",
            records.map((record) =>
                record.body.world_effect_version !== undefined && record.body.phase === "opened"
                    ? { ...record, envelope: { ...record.envelope, mode: "declaration" as const } }
                    : record,
            ),
        ],
    ];
    for (const [label, malformed] of cases) {
        using corrupted = new SQLiteTraceStore(fixture.storePath, { readOnly: true });
        const originalRead = corrupted.readOwner.bind(corrupted);
        corrupted.readOwner = (ownerId) =>
            ownerId === fixture.options.execution.runId ? malformed : originalRead(ownerId);
        assert.throws(
            () => inspectTaskWorldEffects(corrupted, fixture.options.execution.runId),
            (error: unknown) =>
                error instanceof TraceStoreError &&
                /world operation evidence is malformed/u.test(error.message),
            label,
        );
    }
    using mismatchedOutput = new SQLiteTraceStore(fixture.storePath, { readOnly: true });
    const readOutput = mismatchedOutput.readOwner.bind(mismatchedOutput);
    mismatchedOutput.readOwner = (ownerId) =>
        readOutput(ownerId).map((record) =>
            record.body.output_id === undefined
                ? record
                : {
                      ...record,
                      body: { ...record.body, binding_id: "binding:sha256:other" },
                  },
        );
    assert.throws(
        () => inspectTaskWorldEffects(mismatchedOutput, fixture.options.execution.runId),
        /durable execution evidence is malformed/u,
    );
    assert.equal(
        inspectTaskWorldEffects(store, fixture.options.execution.runId).operations.length,
        4,
    );
});

test("operation inspection distinguishes absent evidence and refuses a changing owner snapshot", async (context) => {
    using empty = new SQLiteTraceStore();
    assert.deepEqual(inspectTaskWorldEffects(empty, "missing-run"), {
        authority: null,
        authority_record_id: null,
        capture_id: null,
        operations: [],
        run_id: "missing-run",
        status: "absent",
        recovery_status: "absent",
    });
    assert.throws(() => inspectTaskWorldEffects(empty, ""), TypeError);
    const fixture = await createWorldEffectFixture(context);
    using store = new SQLiteTraceStore(fixture.storePath);
    const runner = createRetainedWorldRunner({
        enforcement: "advisory",
        runnerId: "inspection-snapshot",
        run: (execution) => executeTask(execution.execution),
    });
    await captureTaskWorldDurably({ ...fixture.options, runner, store });
    using changing = new SQLiteTraceStore(fixture.storePath, { readOnly: true });
    const originalRead = changing.readOwner.bind(changing);
    let reads = 0;
    changing.readOwner = (ownerId) => {
        const records = originalRead(ownerId);
        reads += 1;
        return reads < 3 ? records : records.slice(0, -1);
    };
    assert.throws(
        () => inspectTaskWorldEffects(changing, fixture.options.execution.runId),
        /changed during inspection/u,
    );
});
