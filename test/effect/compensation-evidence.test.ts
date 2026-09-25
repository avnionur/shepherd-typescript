import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { planEffectCompensations } from "../../src/effect/compensation.ts";
import type { MaterializedEffect } from "../../src/effect/compensation-evidence.ts";
import {
    createCompensationAppendIntentId,
    createCompensationAttemptBody,
    createCompensationIntentBody,
    createCompensationOutcomeBody,
    type EffectCompensationRecordBody,
    readCompensationRecordBody,
} from "../../src/effect/compensation-records.ts";
import {
    compensateEffects,
    createEffectCompensationRegistry,
    deriveEffectCompensationId,
    EffectCompensationConflictError,
    EffectCompensationEvidenceError,
    EffectCompensationFailedError,
    inspectEffectCompensation,
    ROOT_WITNESS_ID,
    SQLiteTraceStore,
} from "../../src/index.ts";
import { effectProtocolConfig } from "../../src/protocol/config.ts";
import { temporaryDirectory } from "../replay/fixtures.ts";
import {
    compensateRow,
    ROW_INSERT_KIND,
    rowCompensation,
    runRowSession,
} from "./compensation-fixtures.ts";

const config = effectProtocolConfig.compensation;
const TRIGGER = { command_id: "command:test", kind: "command" } as const;

async function fixture(context: Parameters<typeof temporaryDirectory>[0], label: string) {
    const directory = await temporaryDirectory(context, `compensation-evidence-${label}`);
    const store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    context.after(() => store.close());
    const world = path.join(directory, "world.sqlite");
    const { inspection } = await runRowSession(store, world, "session:rows", [
        ["a", "compensable"],
        ["b", "compensable"],
    ]);
    const step = inspection.steps[0];
    assert.ok(step?.effect?.outcome);
    return {
        compensationId: deriveEffectCompensationId(step.record_id),
        intent: step.effect.intent,
        outcome: step.effect.outcome,
        source: inspection,
        step,
        store,
        world,
    };
}

function forge(
    store: SQLiteTraceStore,
    compensationId: string,
    head: string | null,
    body: unknown,
    options: {
        readonly causes?: readonly string[];
        readonly mode?: "capture" | "declaration";
        readonly schema?: string;
    } = {},
): string {
    const appended = store.appendEffectCompensationRecord(compensationId, head, {
        append_intent_id: `intent:forged:${compensationId}:${head ?? "root"}:${JSON.stringify(body)}`,
        batch: {
            groups: [
                {
                    owner_id: compensationId,
                    records: [
                        {
                            body: body as never,
                            caused_by_record_ids: [
                                ...(options.causes ?? (head === null ? [] : [head])),
                            ],
                            mode: options.mode ?? "capture",
                            schema_ref: options.schema ?? config.traceSchema,
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    });
    assert.equal(appended.status, "appended");
    return (appended as { readonly receipt: { readonly record_ids: readonly string[] } }).receipt
        .record_ids[0] as string;
}

test("compensation record bodies are closed, versioned, and bound to their compensation", async (context) => {
    const { compensationId, intent, outcome, step } = await fixture(context, "bodies");
    const materialization = { kind: "replay_step", record_id: step.record_id } as const;
    const intentBody = createCompensationIntentBody(
        compensationId,
        materialization,
        intent,
        outcome,
    );
    const attemptBody = createCompensationAttemptBody(compensationId, 1, "handler", TRIGGER);
    const outcomeBody = createCompensationOutcomeBody(compensationId, 1, { ok: true, value: null });
    const failedBody = createCompensationOutcomeBody(compensationId, 1, {
        error: "refused",
        ok: false,
    });
    for (const body of [intentBody, attemptBody, outcomeBody, failedBody]) {
        assert.deepEqual(readCompensationRecordBody(body, compensationId), body);
    }
    assert.equal(failedBody.status, "failed");
    assert.notEqual(
        createCompensationAppendIntentId(attemptBody, 1),
        createCompensationAppendIntentId(attemptBody, 2),
    );
    const malformed: readonly unknown[] = [
        null,
        { ...intentBody, extra: true },
        { ...intentBody, compatibility_version: "other" },
        { ...intentBody, record_version: 99 },
        { ...intentBody, compensation_id: deriveEffectCompensationId(outcome.intent_ref as never) },
        { ...intentBody, materialization: { ...materialization, kind: "unknown" } },
        { ...intentBody, materialization: { ...materialization, record_id: "invalid" } },
        {
            ...intentBody,
            materialization: { ...materialization, record_id: `sha256:${"1".repeat(64)}` },
        },
        { ...intentBody, effect_intent: { ...intent, phase: "outcome" } },
        { ...intentBody, effect_outcome: { ...outcome, phase: "intent" } },
        { ...attemptBody, attempt: 0 },
        { ...attemptBody, attempt: 1.5 },
        { ...attemptBody, handler_id: "" },
        { ...attemptBody, handler_id: 7 },
        { ...attemptBody, trigger: { command_id: "", kind: "command" } },
        { ...attemptBody, trigger: { command_id: 7, kind: "command" } },
        { ...attemptBody, trigger: { command_id: "command", kind: "unknown" } },
        { ...attemptBody, trigger: { command_id: "command" } },
        { ...outcomeBody, status: "failed" },
        { ...outcomeBody, result: { ok: "yes" } },
        { ...outcomeBody, phase: "unknown" },
    ];
    for (const body of malformed) {
        assert.throws(
            () => readCompensationRecordBody(body, compensationId),
            EffectCompensationEvidenceError,
            JSON.stringify(body),
        );
    }
});

test("inspection refuses forged, reordered, or foreign compensation paths", async (context) => {
    const { intent, outcome, store } = await fixture(context, "fold");
    assert.throws(() => inspectEffectCompensation(store, { compensationId: "invalid" }), TypeError);
    const attempt = (id: string, number: number) =>
        createCompensationAttemptBody(id, number, "handler", TRIGGER);
    const done = (id: string, number: number) =>
        createCompensationOutcomeBody(id, number, { ok: true, value: null });
    // Each case forges one path after its intent; the materialization is a real retained record.
    const cases: readonly ((
        id: string,
        intentBody: EffectCompensationRecordBody,
        materialization: string,
    ) => void)[] = [
        (id, intentBody) => {
            forge(store, id, null, intentBody);
        },
        (id, intentBody, materialization) => {
            forge(store, id, null, attempt(id, 1), { causes: [materialization] });
            void intentBody;
        },
        (id, intentBody, materialization) => {
            const head = forge(store, id, null, intentBody, { causes: [materialization] });
            forge(store, id, head, { foreign: true }, { schema: "example.foreign.v1" });
        },
        (id, intentBody, materialization) => {
            const head = forge(store, id, null, intentBody, { causes: [materialization] });
            forge(store, id, head, { ...intentBody, extra: 1 });
        },
        (id, intentBody, materialization) => {
            const head = forge(store, id, null, intentBody, { causes: [materialization] });
            forge(store, id, head, intentBody);
        },
        (id, intentBody, materialization) => {
            const head = forge(store, id, null, intentBody, { causes: [materialization] });
            forge(store, id, head, done(id, 1));
        },
        (id, intentBody, materialization) => {
            const head = forge(store, id, null, intentBody, { causes: [materialization] });
            forge(store, id, head, attempt(id, 2));
        },
        (id, intentBody, materialization) => {
            const head = forge(store, id, null, intentBody, { causes: [materialization] });
            const started = forge(store, id, head, attempt(id, 1));
            const finished = forge(store, id, started, done(id, 1));
            forge(store, id, finished, attempt(id, 2));
        },
        (id, intentBody, materialization) => {
            const head = forge(store, id, null, intentBody, { causes: [materialization] });
            const started = forge(store, id, head, attempt(id, 1));
            forge(store, id, started, done(id, 2));
        },
        (id, intentBody, materialization) => {
            const head = forge(store, id, null, intentBody, { causes: [materialization] });
            forge(store, id, head, attempt(id, 1), { causes: [materialization] });
        },
        (id, intentBody, materialization) => {
            const head = forge(store, id, null, intentBody, { causes: [materialization] });
            forge(store, id, head, attempt(id, 1), { mode: "declaration" });
        },
    ];
    for (const [index, forgeCase] of cases.entries()) {
        const materialization = store.append({
            append_intent_id: `intent:materialization:${index}`,
            batch: {
                groups: [
                    {
                        owner_id: `run:materialization:${index}`,
                        records: [
                            {
                                body: { index },
                                mode: "capture",
                                schema_ref: "example.materialization.v1",
                                witness_ref: ROOT_WITNESS_ID,
                            },
                        ],
                    },
                ],
            },
        }).record_ids[0] as string;
        const id = deriveEffectCompensationId(materialization);
        forgeCase(
            id,
            createCompensationIntentBody(
                id,
                { kind: "replay_step", record_id: materialization },
                intent,
                outcome,
            ),
            materialization,
        );
        assert.throws(
            () => inspectEffectCompensation(store, { compensationId: id }),
            EffectCompensationEvidenceError,
            `case ${index}`,
        );
    }
});

test("a concurrent compensator that advances the path first makes the slower one conflict", async (context) => {
    const { source, step, store, world } = await fixture(context, "conflict");
    let nested = false;
    const registry = createEffectCompensationRegistry([
        {
            compensate: async (request) => {
                if (!nested) {
                    nested = true;
                    // Another compensator sees the uncertain attempt, re-invokes, and finishes first.
                    await compensateEffects(store, {
                        commandId: "compensate:fast",
                        effectRecordIds: [step.record_id],
                        registry,
                    });
                }
                return { ok: true, value: compensateRow(world, request) };
            },
            handlerId: "compensation:racing",
            kind: ROW_INSERT_KIND,
        },
    ]);
    await assert.rejects(
        compensateEffects(store, {
            commandId: "compensate:slow",
            effectRecordIds: [step.record_id],
            registry,
        }),
        (error: unknown) =>
            error instanceof EffectCompensationConflictError &&
            error.compensation_id === deriveEffectCompensationId(step.record_id) &&
            error.code === config.errors.conflictCode,
    );
    const inspection = inspectEffectCompensation(store, {
        compensationId: deriveEffectCompensationId(step.record_id),
    });
    assert.equal(inspection.status, "compensated");
    assert.deepEqual(
        inspection.attempts.map((entry) => [
            entry.trigger.command_id,
            entry.outcome?.status ?? null,
        ]),
        [
            ["compensate:slow", null],
            ["compensate:fast", "compensated"],
        ],
    );
    assert.equal(source.steps.length, 2);
});

test("explicit compensation reports failed results and triggers are bounded", async (context) => {
    const { step, store, world } = await fixture(context, "bounded");
    await assert.rejects(
        compensateEffects(store, {
            commandId: "compensate:refused",
            effectRecordIds: [step.record_id],
            registry: createEffectCompensationRegistry([
                {
                    compensate: () => ({ error: "locked", ok: false }),
                    handlerId: "compensation:refusing",
                    kind: ROW_INSERT_KIND,
                },
            ]),
        }),
        (error: unknown) =>
            error instanceof EffectCompensationFailedError &&
            error.code === config.errors.failedCode,
    );
    const effect = { intent: step.effect?.intent, outcome: step.effect?.outcome };
    const many = Array.from(
        { length: config.limits.maxEffectsPerTrigger + 1 },
        (_, index): MaterializedEffect =>
            ({
                ...effect,
                evidence: {
                    kind: "replay_step",
                    record_id: `sha256:${index.toString(16).padStart(64, "0")}`,
                },
            }) as MaterializedEffect,
    );
    assert.throws(
        () => planEffectCompensations(store, many, rowCompensation(world)),
        EffectCompensationEvidenceError,
    );
});
