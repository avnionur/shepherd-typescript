import assert from "node:assert/strict";
import { test } from "node:test";

import {
    ApplicationBudgetError,
    ApplicationEvidenceError,
    ApplicationProtocolError,
    ApplicationVerificationError,
    type CounterfactualEdit,
    createEffectHandlerStack,
    deriveApplicationOwnerId,
    inspectCounterfactualOptimization,
    type RunCounterfactualOptimizationOptions,
    runCounterfactualOptimization,
    SQLiteTraceStore,
} from "../../src/index.ts";
import {
    applyFixtureEdit,
    counterfactualDefinition,
    counterfactualProtocolWith,
    dataset,
    labelMetric,
    mismatchedProgram,
    optimizerOptions,
    providerEdit,
    providerRegistry,
    reflection,
    scriptedProposer,
    workflowProgram,
} from "./counterfactual-fixtures.ts";

const notifyHandlers = createEffectHandlerStack([
    { handle: () => ({ ok: true, value: null }), handlerId: "handler:notify", kind: "notify" },
]);

function ownerCount(store: SQLiteTraceStore, commandId: string): number {
    return store.readOwner(deriveApplicationOwnerId(commandId)).length;
}

/** Options proposing the given edits from the baseline in one iteration. */
function oneIteration(
    commandId: string,
    edits: readonly CounterfactualEdit[],
    overrides: Partial<RunCounterfactualOptimizationOptions> = {},
    registry = providerRegistry(),
): RunCounterfactualOptimizationOptions {
    return optimizerOptions(
        commandId,
        {
            proposer: scriptedProposer([[{ edits, parent: null, reflection: reflection(null) }]]),
            ...overrides,
        },
        registry,
    );
}

test("an unexplained suffix divergence rejects the candidate, stops the run, and reruns fail closed", async () => {
    using store = new SQLiteTraceStore();
    const registry = providerRegistry();
    const commandId = "application:cro:unexplained";
    const metric = labelMetric({});
    const options = oneIteration(
        commandId,
        [
            {
                ...providerEdit("handlers-only", 0, "unused", {
                    patch: { program: "rewrite" },
                    scope: "downstream",
                }),
                changes: ["handlers"],
            },
            providerEdit("never-reached", 2, "later"),
        ],
        {
            applyEdit: applyFixtureEdit(registry, {
                handlers: notifyHandlers,
                programs: { rewrite: workflowProgram("rewrite") },
            }),
            metric,
        },
        registry,
    );
    await assert.rejects(
        runCounterfactualOptimization(store, options),
        (error: unknown) =>
            error instanceof ApplicationEvidenceError &&
            error.code === "APPLICATION_EVIDENCE_INVALID" &&
            /first divergence 3, unexplained \[3\]/u.test(error.message),
    );
    assert.equal(metric.contexts.length, 6, "a disproven candidate is never scored");
    const inspection = inspectCounterfactualOptimization(
        store,
        deriveApplicationOwnerId(commandId),
    );
    const [rejected] = inspection.candidates;
    assert.equal(inspection.candidates.length, 1);
    assert.equal(rejected?.status, "rejected");
    assert.equal(rejected?.failure?.code, "APPLICATION_EVIDENCE_INVALID");
    assert.equal(rejected?.gate, null);
    assert.deepEqual(rejected?.targeted, []);
    assert.equal(inspection.selection, null);
    assert.equal(inspection.manifest, null);
    assert.equal(inspection.cut_id, null);
    // Rerunning re-raises the retained failure without replaying anything or writing a record.
    const records = ownerCount(store, commandId);
    await assert.rejects(runCounterfactualOptimization(store, options), ApplicationEvidenceError);
    assert.equal(ownerCount(store, commandId), records);
    assert.deepEqual(registry.get("later").calls, []);
    assert.equal(store.verifyIntegrity().ok, true);
});

test("a candidate whose branch or full replay session failed is rejected before scoring", async () => {
    for (const [label, failStage, stepIndex, message] of [
        ["branch", "draft", 0, /branch session .* ended failed instead of finished/u],
        ["full-replay", "plan", 2, /full replay session .* ended failed instead of finished/u],
    ] as const) {
        using store = new SQLiteTraceStore();
        const commandId = `application:cro:failed:${label}`;
        const registry = providerRegistry({ failing: { failStage } });
        const metric = labelMetric({});
        const options = oneIteration(
            commandId,
            [
                providerEdit("broken", stepIndex, "failing"),
                providerEdit("never-reached", 3, "later"),
            ],
            { baselines: ["full_replay"], metric },
            registry,
        );
        await assert.rejects(
            runCounterfactualOptimization(store, options),
            (error: unknown) =>
                error instanceof ApplicationEvidenceError && message.test(error.message),
        );
        assert.equal(metric.contexts.length, 6, "only the baselines were scored");
        const inspection = inspectCounterfactualOptimization(
            store,
            deriveApplicationOwnerId(commandId),
        );
        const [broken] = inspection.candidates;
        assert.equal(broken?.status, "rejected");
        assert.equal(broken?.failure?.code, "APPLICATION_EVIDENCE_INVALID");
        assert.deepEqual(broken?.targeted, []);
        // The failed live call is measured as one call whose cost is unknown, never as free.
        assert.equal(broken?.cost.provider_calls, label === "branch" ? 3 : 2);
        assert.equal(broken?.cost.cost_usd, label === "branch" ? null : 1);
        assert.equal(inspection.selection, null);
        const records = ownerCount(store, commandId);
        await assert.rejects(
            runCounterfactualOptimization(store, options),
            ApplicationEvidenceError,
        );
        assert.equal(ownerCount(store, commandId), records);
        assert.deepEqual(registry.get("later").calls, []);
    }
});

test("a baseline session that did not finish or a failing baseline metric is refused before any application record", async () => {
    using store = new SQLiteTraceStore();
    const registry = providerRegistry({ base: { failStage: "review" } });
    await assert.rejects(
        runCounterfactualOptimization(
            store,
            oneIteration("application:cro:failed-baseline", [], {}, registry),
        ),
        (error: unknown) =>
            error instanceof ApplicationEvidenceError && /did not finish/u.test(error.message),
    );
    assert.equal(ownerCount(store, "application:cro:failed-baseline"), 0);
    for (const metric of [
        () => {
            throw new Error("metric unavailable");
        },
        () => Number.NaN,
    ]) {
        await assert.rejects(
            runCounterfactualOptimization(
                store,
                oneIteration("application:cro:baseline-metric", [], { metric }),
            ),
            (error: unknown) =>
                error instanceof ApplicationVerificationError &&
                /metric failed for the baseline session of example train-1/u.test(error.message),
        );
        assert.equal(ownerCount(store, "application:cro:baseline-metric"), 0);
    }
});

test("a branch whose program cannot re-issue the recorded prefix is retained as a rejected candidate", async () => {
    using store = new SQLiteTraceStore();
    const registry = providerRegistry();
    const commandId = "application:cro:prefix";
    await assert.rejects(
        runCounterfactualOptimization(
            store,
            oneIteration(
                commandId,
                [
                    providerEdit("wrong-prefix", 0, "alt", {
                        patch: { program: "mismatched", provider: "alt" },
                        scope: "downstream",
                    }),
                ],
                {
                    applyEdit: applyFixtureEdit(registry, {
                        programs: { mismatched: mismatchedProgram },
                    }),
                },
                registry,
            ),
        ),
        (error: unknown) =>
            error instanceof ApplicationEvidenceError &&
            /branch session .* ended failed instead of finished/u.test(error.message),
    );
    const inspection = inspectCounterfactualOptimization(
        store,
        deriveApplicationOwnerId(commandId),
    );
    assert.equal(inspection.candidates[0]?.status, "rejected");
    assert.equal(inspection.selection, null);
});

test("a candidate metric that throws or returns a non-finite score fails verification", async () => {
    for (const [label, bad] of [
        [
            "throws",
            () => {
                throw new Error("metric unavailable");
            },
        ],
        ["nan", () => Number.NaN],
    ] as const) {
        using store = new SQLiteTraceStore();
        const commandId = `application:cro:metric:${label}`;
        const options = oneIteration(commandId, [providerEdit("candidate", 0, "alt")], {
            baselines: ["full_replay"],
            metric: (context) => (context.candidate === null ? 0 : bad()),
        });
        await assert.rejects(
            runCounterfactualOptimization(store, options),
            (error: unknown) =>
                error instanceof ApplicationVerificationError &&
                error.code === "APPLICATION_VERIFICATION_FAILED" &&
                error.cause instanceof Error,
        );
        const inspection = inspectCounterfactualOptimization(
            store,
            deriveApplicationOwnerId(commandId),
        );
        const [candidate] = inspection.candidates;
        assert.equal(candidate?.status, "rejected");
        assert.equal(candidate?.failure?.code, "APPLICATION_VERIFICATION_FAILED");
        assert.deepEqual(candidate?.targeted, []);
        assert.equal(candidate?.cost.provider_calls, 4);
        assert.equal(inspection.manifest, null);
        await assert.rejects(
            runCounterfactualOptimization(store, { ...options, metric: () => 1 }),
            ApplicationVerificationError,
        );
    }
});

test("malformed options, datasets, and protocols are refused before any record", async () => {
    using store = new SQLiteTraceStore();
    const recordCount = () =>
        (JSON.parse(store.exportTrace()) as { readonly records: readonly unknown[] }).records
            .length;
    const pristine = recordCount();
    const budgets = counterfactualDefinition.budgets as Record<string, number>;
    const thresholds = counterfactualDefinition.thresholds as Record<string, number>;
    const refusals: readonly [Record<string, unknown>, (error: unknown) => boolean][] = [
        [{ baselines: ["full_replay", "full_replay"] }, (error) => error instanceof TypeError],
        [{ metric: "no" }, (error) => error instanceof TypeError],
        [{ proposer: "no" }, (error) => error instanceof TypeError],
        [{ applyEdit: "no" }, (error) => error instanceof TypeError],
        [{ clock: "no" }, (error) => error instanceof TypeError],
        [
            { baseline: { program: "no", programId: "workflow" } },
            (error) => error instanceof TypeError,
        ],
        [{ dataset: { dev: [], train: dataset.train } }, (error) => error instanceof TypeError],
        [
            { dataset: { dev: [{ id: "unknown", input: null }], train: dataset.train } },
            (error) => error instanceof TypeError && /dataset items/u.test(`${error}`),
        ],
        [
            { dataset: { dev: [{ id: "train-1", input: null }], train: dataset.train } },
            (error) => error instanceof TypeError,
        ],
        [
            { protocol: { ...counterfactualDefinition, kind: "tree_rl" } },
            (error) => error instanceof ApplicationProtocolError,
        ],
        [
            {
                protocol: {
                    ...counterfactualDefinition,
                    surfaces: (
                        counterfactualDefinition.surfaces as readonly { readonly role: string }[]
                    ).filter((surface) => surface.role !== "handoff"),
                },
            },
            (error) =>
                error instanceof ApplicationProtocolError &&
                /role handoff is required/u.test(error.message),
        ],
        [
            { protocol: { ...counterfactualDefinition, budgets: { maxCandidates: 2 } } },
            (error) =>
                error instanceof ApplicationProtocolError &&
                /budgets must declare/u.test(error.message),
        ],
        [
            {
                protocol: {
                    ...counterfactualDefinition,
                    thresholds: Object.fromEntries(
                        Object.entries(thresholds).filter(([key]) => key !== "minPromotionScore"),
                    ),
                },
            },
            (error) =>
                error instanceof ApplicationProtocolError &&
                /thresholds must declare minPromotionScore/u.test(error.message),
        ],
        [
            {
                protocol: {
                    ...counterfactualDefinition,
                    thresholds: { ...thresholds, targetedMaxScoreDrop: "0.02" },
                },
            },
            (error) => error instanceof ApplicationProtocolError,
        ],
        [
            {
                protocol: Object.fromEntries(
                    Object.entries(counterfactualDefinition).filter(
                        ([key]) => key !== "thresholds",
                    ),
                ),
            },
            (error) =>
                error instanceof ApplicationProtocolError &&
                /thresholds must declare/u.test(error.message),
        ],
        [
            { protocol: counterfactualProtocolWith({ maxCandidates: 0 }) },
            (error) => error instanceof ApplicationProtocolError,
        ],
        [
            { protocol: counterfactualProtocolWith({ maxCandidates: 33 }) },
            (error) => error instanceof ApplicationProtocolError,
        ],
        [
            { protocol: counterfactualProtocolWith({ iterations: 65 }) },
            (error) => error instanceof ApplicationProtocolError,
        ],
        [
            { protocol: counterfactualProtocolWith({ ...budgets, maxProposalAttempts: 0 }) },
            (error) => error instanceof ApplicationProtocolError,
        ],
    ];
    const registry = providerRegistry();
    for (const [index, [overrides, matches]] of refusals.entries()) {
        const commandId = `application:cro:refusal:${index}`;
        await assert.rejects(
            (async () =>
                runCounterfactualOptimization(store, {
                    ...oneIteration(commandId, [], {}, registry),
                    ...overrides,
                } as never))(),
            matches,
            `refusal ${index}`,
        );
        assert.equal(ownerCount(store, commandId), 0);
    }
    // Nothing was recorded: no application record, no baseline session, and no provider call.
    assert.equal(recordCount(), pristine);
    assert.deepEqual(registry.get("base").calls, []);
});

test("a rerun under another protocol, dataset, or baselines is refused without a record", async () => {
    using store = new SQLiteTraceStore();
    const commandId = "application:cro:rerun";
    const options = oneIteration(commandId, [providerEdit("x", 0, "alt")]);
    await runCounterfactualOptimization(store, options);
    const records = ownerCount(store, commandId);
    await assert.rejects(
        runCounterfactualOptimization(store, {
            ...options,
            protocol: counterfactualProtocolWith({ iterations: 1, maxProviderCalls: 127 }),
        }),
        ApplicationProtocolError,
    );
    for (const changed of [
        {
            dataset: {
                ...dataset,
                dev: [{ id: "dev-1", input: "changed" }, dataset.dev[1] as never],
            },
        },
        { baselines: ["full_replay"] as const },
    ]) {
        await assert.rejects(
            runCounterfactualOptimization(store, { ...options, ...changed } as never),
            (error: unknown) =>
                error instanceof ApplicationEvidenceError &&
                /different dataset or baselines/u.test(error.message),
        );
    }
    assert.equal(ownerCount(store, commandId), records);
});

test("the provider-call budget refuses a branch before it opens, checks the baseline, and refuses an overrun", async () => {
    using store = new SQLiteTraceStore();
    const registry = providerRegistry();
    const commandId = "application:cro:budget";
    // Baselines use 24 calls; the first edit's branch 1 call fits, the second's 4 do not.
    const options = oneIteration(
        commandId,
        [providerEdit("fits", 3, "first"), providerEdit("exceeds", 0, "second")],
        { protocol: counterfactualProtocolWith({ iterations: 1, maxProviderCalls: 27 }) },
        registry,
    );
    await assert.rejects(
        runCounterfactualOptimization(store, options),
        (error: unknown) =>
            error instanceof ApplicationBudgetError && /maxProviderCalls 27/u.test(error.message),
    );
    const inspection = inspectCounterfactualOptimization(
        store,
        deriveApplicationOwnerId(commandId),
    );
    assert.equal(inspection.candidates[0]?.cost.provider_calls, 1);
    assert.equal(inspection.candidates.length, 1);
    assert.deepEqual(registry.get("second").calls, []);
    const records = ownerCount(store, commandId);
    await assert.rejects(runCounterfactualOptimization(store, options), ApplicationBudgetError);
    assert.equal(ownerCount(store, commandId), records);
    // The measured baselines are checked before the opened record.
    await assert.rejects(
        runCounterfactualOptimization(
            store,
            oneIteration("application:cro:baseline-budget", [], {
                protocol: counterfactualProtocolWith({ iterations: 1, maxProviderCalls: 10 }),
            }),
        ),
        (error: unknown) =>
            error instanceof ApplicationBudgetError &&
            /12 measured live provider call\(s\)/u.test(error.message),
    );
    assert.equal(ownerCount(store, "application:cro:baseline-budget"), 0);
});

/** Store that fails the first application append of a chosen record once, simulating a crash. */
class CrashingStore extends SQLiteTraceStore {
    crashWhen: ((body: Record<string, unknown>, schema: string) => boolean) | null = null;
    moveHead = false;

    override appendApplicationRecord(
        ...args: Parameters<SQLiteTraceStore["appendApplicationRecord"]>
    ): ReturnType<SQLiteTraceStore["appendApplicationRecord"]> {
        const [, , request] = args;
        const record = request.batch.groups[0]?.records[0];
        if (this.moveHead) {
            this.moveHead = false;
            return { status: "head_moved" };
        }
        if (
            this.crashWhen?.(record?.body as Record<string, unknown>, record?.schema_ref as string)
        ) {
            this.crashWhen = null;
            throw new Error("simulated crash");
        }
        return super.appendApplicationRecord(...args);
    }
}

test("a crash before an outcome, the selection, or the manifest converges on rerun without replaying", async () => {
    using store = new CrashingStore();
    const registry = providerRegistry();
    const commandId = "application:cro:crash";
    const metric = labelMetric({ first: { "dev-1": 1, "dev-2": 1, "train-1": 1 } });
    const options = oneIteration(
        commandId,
        [providerEdit("first", 0, "first"), providerEdit("second", 3, "second")],
        { baselines: ["full_replay"], metric },
        registry,
    );
    const applicationId = deriveApplicationOwnerId(commandId);
    store.crashWhen = (body) => body.phase === "candidate" && body.name === "second";
    await assert.rejects(runCounterfactualOptimization(store, options), /simulated crash/u);
    // A retained edit the applier no longer materializes is inconsistent evidence.
    await assert.rejects(
        runCounterfactualOptimization(store, { ...options, applyEdit: () => ({}) }),
        (error: unknown) =>
            error instanceof ApplicationEvidenceError &&
            /retained candidate first no longer applies to its parent/u.test(error.message),
    );
    assert.equal(inspectCounterfactualOptimization(store, applicationId).candidates.length, 1);
    const calls = () => [...registry.providers.values()].map((provider) => provider.calls.length);
    const before = calls();
    store.crashWhen = (body) => body.phase === "selection";
    await assert.rejects(runCounterfactualOptimization(store, options), /simulated crash/u);
    assert.deepEqual(calls(), before);
    store.crashWhen = (_body, schema) => schema === "shepherd.application.manifest.v1";
    await assert.rejects(runCounterfactualOptimization(store, options), /simulated crash/u);
    const settled = inspectCounterfactualOptimization(store, applicationId);
    assert.equal(settled.selection?.selected_candidate_id, settled.candidates[0]?.candidate_id);
    assert.equal(settled.manifest, null);
    const { inspection, manifest } = await runCounterfactualOptimization(store, options);
    assert.deepEqual(calls(), before);
    assert.equal(inspection.selection?.record_id, settled.selection?.record_id);
    assert.equal(inspection.candidates[1]?.status, "archived");
    assert.notEqual(manifest, null);
    assert.equal(store.verifyIntegrity().ok, true);
    // A moved application head is refused as inconsistent evidence.
    store.moveHead = true;
    await assert.rejects(
        runCounterfactualOptimization(store, { ...options, commandId: "application:cro:moved" }),
        (error: unknown) =>
            error instanceof ApplicationEvidenceError && /head moved/u.test(error.message),
    );
});
