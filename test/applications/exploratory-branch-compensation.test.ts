import assert from "node:assert/strict";
import { test } from "node:test";

import {
    createEffectHandlerStack,
    createEffectIntent,
    deriveEffectCompensationId,
    type EffectHandlerStack,
    inspectReplaySession,
    type ReplaySessionProgram,
    runCounterfactualOptimization,
    runTrajectoryCompression,
    runTreeRlRollouts,
    SQLiteTraceStore,
} from "../../src/index.ts";
import {
    compressionOptions,
    exploreWorkflow,
    notifyIntent,
    stageProvider,
} from "./compression-fixtures.ts";
import {
    workflowProgram as croWorkflow,
    labelMetric,
    optimizerOptions,
    providerEdit,
    providerRegistry,
    reflection,
    scriptedProposer,
} from "./counterfactual-fixtures.ts";
import { cassette, recordSource, treeRlOptions, workflowProgram } from "./tree-rl-fixtures.ts";

const LEDGER_KIND = "ledger.record";
const SESSION_SCHEMA = "shepherd.replay.session.v1";

/**
 * Handler stack materializing the compensable ledger entry and the compression workflow's
 * notification, logging every ledger materialization.
 */
function ledgerHandlers(calls: string[]): EffectHandlerStack {
    return createEffectHandlerStack([
        {
            handle: (intent) => {
                calls.push(intent.effect_id);
                return { ok: true, value: null };
            },
            handlerId: "handler:ledger",
            kind: LEDGER_KIND,
        },
        {
            handle: () => ({ ok: true, value: null }),
            handlerId: "handler:notify",
            kind: notifyIntent.kind,
        },
    ]);
}

/** Runs a program, then records one compensable ledger entry that depends on nothing. */
function withLedger(program: ReplaySessionProgram): ReplaySessionProgram {
    return async (context) => {
        const result = await program(context);
        await context.dispatchEffect(
            createEffectIntent({
                effectId: "effect:ledger",
                kind: LEDGER_KIND,
                payload: { entry: "result" },
                reversibility: "compensable",
            }),
            { dependsOn: [] },
        );
        return result;
    };
}

/**
 * Asserts that at least one retained session materialized a successful compensable ledger entry and
 * that no compensation path exists for any of them: no handler was required or invoked.
 */
function assertNothingCompensated(store: SQLiteTraceStore): void {
    let compensable = 0;
    for (const sessionId of store.listOwnersBySchema(SESSION_SCHEMA, 256, 0)) {
        for (const step of inspectReplaySession(store, { sessionId }).steps) {
            if (
                step.source === "live" &&
                step.effect?.intent.reversibility === "compensable" &&
                step.effect.outcome?.result.ok === true
            ) {
                compensable += 1;
                assert.deepEqual(store.readOwner(deriveEffectCompensationId(step.record_id)), []);
            }
        }
    }
    assert.ok(compensable > 1, "sources and branches materialized compensable effects");
}

test("Tree-RL rollouts over roots with compensable suffix effects retain the roots and compensate nothing", async () => {
    using store = new SQLiteTraceStore();
    const calls: string[] = [];
    const handlers = ledgerHandlers(calls);
    const program = withLedger(workflowProgram);
    const labels = new Map<string, string>();
    for (const label of ["base", "alt"]) {
        labels.set(
            await recordSource(store, `root:ledger:${label}`, program, cassette(label), {
                handlers,
            }),
            label,
        );
    }
    const { inspection } = await runTreeRlRollouts(
        store,
        treeRlOptions("application:tree-rl:ledger", labels, {
            normalization: "none",
            prompts: [{ handlers, id: "task", program, roots: [...labels.keys()] }],
        }),
    );
    assert.ok(inspection.rollouts.length > 0);
    for (const entry of inspection.rollouts) {
        assert.equal(entry.record?.status, "completed", JSON.stringify(entry.record?.failure));
    }
    // Two roots, then one live ledger entry per rollout suffix.
    assert.equal(calls.length, 2 + inspection.rollouts.length);
    assertNothingCompensated(store);
});

test("CRO candidate replays over baselines with compensable suffix effects compensate nothing", async () => {
    using store = new SQLiteTraceStore();
    const calls: string[] = [];
    const registry = providerRegistry();
    const program = withLedger(croWorkflow());
    const options = optimizerOptions(
        "application:cro:ledger",
        {
            baseline: {
                handlers: ledgerHandlers(calls),
                program: () => program,
                programId: "workflow:plan-draft-review-ledger.v1",
                provider: registry.get("base"),
            },
            metric: labelMetric({ replanned: { "train-1": 1 } }),
            proposer: scriptedProposer([
                [
                    {
                        edits: [providerEdit("replan", 0, "replanned")],
                        parent: null,
                        reflection: reflection(null),
                    },
                ],
            ]),
        },
        registry,
    );
    const { inspection } = await runCounterfactualOptimization(store, options);
    assert.ok(inspection.candidates.length > 0);
    assert.ok(inspection.candidates.every((candidate) => candidate.targeted.length > 0));
    assertNothingCompensated(store);
});

test("trajectory compression reruns a source with compensable suffix effects without compensating it", async () => {
    using store = new SQLiteTraceStore();
    const calls: string[] = [];
    const { inspection } = await runTrajectoryCompression(
        store,
        compressionOptions("application:compression:ledger", {
            workflow: {
                handlers: ledgerHandlers(calls),
                program: (guidance) => withLedger(exploreWorkflow()(guidance)),
                programId: "workflow:explore-answer-ledger.v1",
                provider: stageProvider("base"),
            },
        }),
    );
    assert.equal(inspection.compression.rewound?.status, "rewound");
    assert.ok(inspection.compression.outcome !== null);
    assertNothingCompensated(store);
});
