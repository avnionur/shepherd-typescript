import assert from "node:assert/strict";
import { test } from "node:test";

import {
    ApplicationBudgetError,
    ApplicationEvidenceError,
    ApplicationProtocolError,
    ApplicationVerificationError,
    createEffectHandlerStack,
    deriveApplicationOwnerId,
    inspectCounterfactualOptimization,
    runCounterfactualOptimization,
    SQLiteTraceStore,
} from "../../src/index.ts";
import {
    counterfactualDefinition,
    counterfactualProtocol,
    counterfactualProtocolWithBudgets,
    keyedProvider,
    mismatchedProgram,
    optimizerOptions,
    pass,
    providerCandidate,
    scriptedEvaluator,
    workflowProgram,
} from "./counterfactual-fixtures.ts";

const notifyHandlers = createEffectHandlerStack([
    { handle: () => ({ ok: true, value: null }), handlerId: "handler:notify", kind: "notify" },
]);

function ownerCount(store: SQLiteTraceStore, commandId: string): number {
    return store.readOwner(deriveApplicationOwnerId(commandId)).length;
}

test("an unexplained suffix divergence rejects the candidate, stops the run, and reruns fail closed", async () => {
    using store = new SQLiteTraceStore();
    const later = keyedProvider("later");
    const options = optimizerOptions("application:cro:unexplained", {
        candidates: [
            {
                changes: ["handlers"],
                handlers: notifyHandlers,
                name: "handlers-only",
                program: workflowProgram("rewrite"),
                stepIndex: 0,
            },
            providerCandidate("never-reached", 2, later),
        ],
        evaluate: () => {
            throw new Error("a disproven candidate must not be evaluated");
        },
    });
    await assert.rejects(
        runCounterfactualOptimization(store, options),
        (error: unknown) =>
            error instanceof ApplicationEvidenceError &&
            error.code === "APPLICATION_EVIDENCE_INVALID",
    );
    const applicationId = deriveApplicationOwnerId("application:cro:unexplained");
    const inspection = inspectCounterfactualOptimization(store, applicationId);
    const [rejected, unreached] = inspection.candidates;
    assert.equal(rejected?.outcome?.status, "rejected");
    assert.equal(rejected?.outcome?.failure?.code, "APPLICATION_EVIDENCE_INVALID");
    assert.equal(rejected?.outcome?.evaluation, null);
    assert.deepEqual(rejected?.outcome?.divergence?.unexplained, [3]);
    assert.equal(rejected?.outcome?.divergence?.first_divergence_index, 3);
    assert.equal(unreached?.proposed, null);
    assert.equal(unreached?.outcome, null);
    assert.equal(inspection.promotion, null);
    assert.equal(inspection.manifest, null);
    assert.equal(inspection.cut_id, null);
    assert.equal(inspection.manifest_record_id, null);
    // Rerunning re-raises the retained failure without replaying anything or writing a record.
    const records = ownerCount(store, "application:cro:unexplained");
    await assert.rejects(runCounterfactualOptimization(store, options), ApplicationEvidenceError);
    assert.equal(ownerCount(store, "application:cro:unexplained"), records);
    assert.deepEqual(later.calls, []);
    assert.equal(store.verifyIntegrity().ok, true);
});

test("a candidate whose branch session failed is rejected before the evaluator and never promoted", async () => {
    using store = new SQLiteTraceStore();
    const commandId = "application:cro:failed-branch";
    const later = keyedProvider("later");
    const evaluate = scriptedEvaluator({ broken: pass(5), "never-reached": pass(5) });
    const options = optimizerOptions(commandId, {
        baselines: ["full_replay"],
        candidates: [
            providerCandidate("broken", 0, keyedProvider("failing", { failStage: "draft" })),
            providerCandidate("never-reached", 2, later),
        ],
        evaluate,
    });
    await assert.rejects(
        runCounterfactualOptimization(store, options),
        (error: unknown) =>
            error instanceof ApplicationEvidenceError &&
            error.code === "APPLICATION_EVIDENCE_INVALID" &&
            /ended failed instead of finished/u.test(error.message),
    );
    assert.deepEqual(evaluate.contexts, []);
    const inspection = inspectCounterfactualOptimization(
        store,
        deriveApplicationOwnerId(commandId),
    );
    const [broken, unreached] = inspection.candidates;
    assert.equal(broken?.outcome?.status, "rejected");
    assert.equal(broken?.outcome?.failure?.code, "APPLICATION_EVIDENCE_INVALID");
    assert.equal(broken?.outcome?.evaluation, null);
    assert.equal(broken?.outcome?.baseline, null);
    // The failed live call is measured as one call whose cost is unknown, never as free.
    assert.equal(broken?.outcome?.cost?.provider_calls, 1);
    assert.equal(broken?.outcome?.cost?.input_tokens, 0);
    assert.equal(broken?.outcome?.cost?.cost_usd, null);
    assert.equal(unreached?.proposed, null);
    assert.equal(inspection.promotion, null);
    assert.equal(inspection.manifest, null);
    const records = ownerCount(store, commandId);
    await assert.rejects(runCounterfactualOptimization(store, options), ApplicationEvidenceError);
    assert.equal(ownerCount(store, commandId), records);
    assert.deepEqual(later.calls, []);
    assert.deepEqual(evaluate.contexts, []);
    assert.equal(store.verifyIntegrity().ok, true);
});

test("a candidate whose full replay failed is rejected before the evaluator and never promoted", async () => {
    using store = new SQLiteTraceStore();
    const commandId = "application:cro:failed-full-replay";
    // The edit at step 2 replays only the review live, so the branch finishes; the full replay
    // runs the plan live under the same provider and fails there.
    const failing = keyedProvider("failing", { failStage: "plan" });
    const evaluate = scriptedEvaluator({ "late-edit": pass(5) });
    const options = optimizerOptions(commandId, {
        baselines: ["full_replay"],
        candidates: [providerCandidate("late-edit", 2, failing)],
        evaluate,
    });
    await assert.rejects(
        runCounterfactualOptimization(store, options),
        (error: unknown) =>
            error instanceof ApplicationEvidenceError &&
            /full replay session .* ended failed instead of finished/u.test(error.message),
    );
    assert.deepEqual(failing.calls, ["review", "plan"]);
    assert.deepEqual(evaluate.contexts, []);
    const inspection = inspectCounterfactualOptimization(
        store,
        deriveApplicationOwnerId(commandId),
    );
    const outcome = inspection.candidates[0]?.outcome;
    assert.equal(outcome?.status, "rejected");
    assert.equal(outcome?.failure?.code, "APPLICATION_EVIDENCE_INVALID");
    assert.equal(outcome?.baseline, null);
    assert.equal(outcome?.evaluation, null);
    assert.equal(outcome?.cost?.provider_calls, 1);
    assert.equal(inspection.promotion, null);
    assert.equal(inspection.manifest, null);
});

test("a baseline session that did not finish is refused before any application record", async () => {
    using store = new SQLiteTraceStore();
    const commandId = "application:cro:failed-baseline";
    await assert.rejects(
        runCounterfactualOptimization(
            store,
            optimizerOptions(commandId, {
                baseline: {
                    program: workflowProgram(),
                    programId: "workflow:plan-draft-review.v1",
                    provider: keyedProvider("base", { failStage: "review" }),
                },
                candidates: [providerCandidate("candidate", 0, keyedProvider("alt"))],
            }),
        ),
        (error: unknown) =>
            error instanceof ApplicationEvidenceError && /did not finish/u.test(error.message),
    );
    assert.equal(ownerCount(store, commandId), 0);
});

test("a branch that diverges before its target is retained as a rejected, never promoted candidate", async () => {
    using store = new SQLiteTraceStore();
    await assert.rejects(
        runCounterfactualOptimization(
            store,
            optimizerOptions("application:cro:prefix", {
                candidates: [
                    providerCandidate("wrong-prefix", 0, keyedProvider("alt"), {
                        program: mismatchedProgram,
                    }),
                ],
            }),
        ),
        ApplicationEvidenceError,
    );
    const inspection = inspectCounterfactualOptimization(
        store,
        deriveApplicationOwnerId("application:cro:prefix"),
    );
    const outcome = inspection.candidates[0]?.outcome;
    assert.equal(outcome?.status, "rejected");
    assert.equal(outcome?.divergence?.first_divergence_index, 0);
    assert.equal(outcome?.divergence?.common_prefix_id, null);
    assert.equal(outcome?.divergence?.live_steps, 0);
    assert.equal(outcome?.target.step_index, 2);
    assert.equal(inspection.promotion, null);
});

test("an evaluator that throws or returns a malformed verdict fails verification and promotes nothing", async () => {
    for (const [label, evaluate] of [
        [
            "throws",
            () => {
                throw new Error("evaluator unavailable");
            },
        ],
        ["malformed", () => ({ passed: true, reason: "no score", score: Number.NaN })],
    ] as const) {
        using store = new SQLiteTraceStore();
        const commandId = `application:cro:evaluator:${label}`;
        const options = optimizerOptions(commandId, {
            baselines: ["full_replay"],
            candidates: [providerCandidate("candidate", 0, keyedProvider("alt"))],
            evaluate,
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
        const outcome = inspection.candidates[0]?.outcome;
        assert.equal(outcome?.status, "rejected");
        assert.equal(outcome?.failure?.code, "APPLICATION_VERIFICATION_FAILED");
        assert.equal(outcome?.evaluation, null);
        assert.equal(outcome?.baseline?.provider_calls, 4);
        assert.equal(inspection.promotion, null);
        assert.equal(inspection.manifest, null);
        await assert.rejects(
            runCounterfactualOptimization(store, { ...options, evaluate: () => pass(5) }),
            ApplicationVerificationError,
        );
        assert.equal(
            inspectCounterfactualOptimization(store, deriveApplicationOwnerId(commandId)).promotion,
            null,
        );
    }
});

test("undeclared edit kinds and malformed or over-limit candidate sets are refused before any record", async () => {
    using store = new SQLiteTraceStore();
    const recordCount = () =>
        (JSON.parse(store.exportTrace()) as { readonly records: readonly unknown[] }).records
            .length;
    const pristine = recordCount();
    const provider = keyedProvider("alt");
    const refusals: readonly [Record<string, unknown>, (error: unknown) => boolean][] = [
        [
            { candidates: [{ changes: ["program"], name: "x", stepIndex: 0 }] },
            (error) =>
                error instanceof ApplicationProtocolError &&
                /unsupported edit kind program/u.test(error.message),
        ],
        [
            {
                candidates: Array.from({ length: 5 }, (_, index) =>
                    providerCandidate(`c${index}`, 0, provider),
                ),
            },
            (error) =>
                error instanceof ApplicationBudgetError &&
                error.code === "APPLICATION_BUDGET_EXCEEDED",
        ],
        [{ candidates: [] }, (error) => error instanceof TypeError],
        [
            { candidates: [{ changes: [], name: "x", stepIndex: 0 }] },
            (error) => error instanceof TypeError,
        ],
        [
            { candidates: [{ changes: ["provider", "provider"], name: "x", stepIndex: 0 }] },
            (error) => error instanceof TypeError,
        ],
        [
            { candidates: [{ changes: ["provider"], name: "x", stepIndex: 0 }] },
            (error) => error instanceof TypeError && /provider must be supplied/u.test(`${error}`),
        ],
        [
            { candidates: [providerCandidate("x", 0, provider, { parent: "missing" })] },
            (error) => error instanceof TypeError,
        ],
        [
            {
                candidates: [
                    providerCandidate("x", 0, provider),
                    providerCandidate("x", 1, provider),
                ],
            },
            (error) => error instanceof TypeError,
        ],
        [
            { candidates: [providerCandidate("x", 0, provider, { program: "no" as never })] },
            (error) => error instanceof TypeError,
        ],
        [{ baselines: ["full_replay", "full_replay"] }, (error) => error instanceof TypeError],
        [{ evaluate: "no" }, (error) => error instanceof TypeError],
        [{ clock: "no" }, (error) => error instanceof TypeError],
        [
            { baseline: { program: "no", programId: "workflow" } },
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
            (error) => error instanceof ApplicationProtocolError,
        ],
        [
            { protocol: counterfactualProtocolWithBudgets({ maxCandidates: 0 }) },
            (error) => error instanceof ApplicationProtocolError,
        ],
        [
            { protocol: counterfactualProtocolWithBudgets({ maxCandidates: 33 }) },
            (error) => error instanceof ApplicationProtocolError,
        ],
    ];
    for (const [index, [overrides, matches]] of refusals.entries()) {
        const commandId = `application:cro:refusal:${index}`;
        await assert.rejects(
            runCounterfactualOptimization(store, {
                ...optimizerOptions(commandId, {
                    candidates: [providerCandidate("ok", 0, provider)],
                }),
                ...overrides,
            } as never),
            matches,
            `refusal ${index}`,
        );
        assert.equal(ownerCount(store, commandId), 0);
    }
    // Nothing was recorded: no application record, no baseline session, and no provider call.
    assert.equal(recordCount(), pristine);
    assert.deepEqual(provider.calls, []);
});

test("a rerun under another protocol or candidate plan is refused without a record", async () => {
    using store = new SQLiteTraceStore();
    const provider = keyedProvider("alt");
    const options = optimizerOptions("application:cro:rerun", {
        candidates: [providerCandidate("x", 0, provider)],
    });
    await runCounterfactualOptimization(store, options);
    const records = ownerCount(store, "application:cro:rerun");
    await assert.rejects(
        runCounterfactualOptimization(store, {
            ...options,
            protocol: counterfactualProtocol({ protocolVersion: "appendix-f.v2" }),
        }),
        ApplicationProtocolError,
    );
    await assert.rejects(
        runCounterfactualOptimization(store, {
            ...options,
            candidates: [providerCandidate("x", 1, provider)],
        }),
        ApplicationEvidenceError,
    );
    assert.equal(ownerCount(store, "application:cro:rerun"), records);
    await assert.rejects(
        runCounterfactualOptimization(store, {
            ...options,
            candidates: [providerCandidate("x", 9, provider)],
            commandId: "application:cro:out-of-range",
        }),
        ApplicationProtocolError,
    );
    assert.equal(ownerCount(store, "application:cro:out-of-range"), 0);
});

test("the provider-call budget refuses a branch before it opens and keeps the retained evidence", async () => {
    using store = new SQLiteTraceStore();
    const second = keyedProvider("second");
    const options = optimizerOptions("application:cro:budget", {
        candidates: [
            providerCandidate("fits", 2, keyedProvider("first")),
            providerCandidate("exceeds", 0, second),
        ],
        protocol: counterfactualProtocolWithBudgets({ maxProviderCalls: 6 }),
    });
    await assert.rejects(
        runCounterfactualOptimization(store, options),
        (error: unknown) =>
            error instanceof ApplicationBudgetError && /maxProviderCalls 6/u.test(error.message),
    );
    const applicationId = deriveApplicationOwnerId("application:cro:budget");
    const inspection = inspectCounterfactualOptimization(store, applicationId);
    assert.equal(inspection.candidates[0]?.outcome?.cost?.provider_calls, 1);
    assert.equal(inspection.candidates[1]?.proposed?.status, "proposed");
    assert.equal(inspection.candidates[1]?.outcome, null);
    assert.equal(
        store.readOwner(inspection.candidates[1]?.proposed?.branch_session_id as string).length,
        0,
    );
    assert.deepEqual(second.calls, []);
    // The rerun counts the retained sessions and refuses again without a record.
    const records = ownerCount(store, "application:cro:budget");
    await assert.rejects(runCounterfactualOptimization(store, options), ApplicationBudgetError);
    assert.equal(ownerCount(store, "application:cro:budget"), records);
    // Full replay is budgeted too.
    await assert.rejects(
        runCounterfactualOptimization(store, {
            ...optimizerOptions("application:cro:budget-full", {
                baselines: ["full_replay"],
                candidates: [providerCandidate("fits", 2, keyedProvider("first"))],
            }),
            protocol: counterfactualProtocolWithBudgets({ maxProviderCalls: 6 }),
        }),
        ApplicationBudgetError,
    );
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

test("a crash after a candidate branch converges on rerun without replaying the branch", async () => {
    using store = new CrashingStore();
    const first = keyedProvider("first");
    const second = keyedProvider("second");
    const options = optimizerOptions("application:cro:crash", {
        baselines: ["full_replay"],
        candidates: [providerCandidate("first", 0, first), providerCandidate("second", 2, second)],
        evaluate: () => pass(3),
    });
    const applicationId = deriveApplicationOwnerId("application:cro:crash");
    // Crash after the second candidate's branch and comparison, before its outcome record.
    store.crashWhen = (body) => body.status === "evaluated" && body.name === "second";
    await assert.rejects(runCounterfactualOptimization(store, options), /simulated crash/u);
    const crashed = inspectCounterfactualOptimization(store, applicationId);
    assert.equal(crashed.candidates[0]?.outcome?.status, "evaluated");
    assert.equal(crashed.candidates[1]?.proposed?.status, "proposed");
    assert.equal(crashed.candidates[1]?.outcome, null);
    const branchId = crashed.candidates[1]?.proposed?.branch_session_id as string;
    const branchRecords = store.readOwner(branchId).length;
    assert.ok(branchRecords > 0);
    const calls = [first.calls.length, second.calls.length];
    // Crash again between the promotion and the manifest.
    store.crashWhen = (_body, schema) => schema === "shepherd.application.manifest.v1";
    await assert.rejects(runCounterfactualOptimization(store, options), /simulated crash/u);
    assert.deepEqual([first.calls.length, second.calls.length], calls);
    assert.equal(store.readOwner(branchId).length, branchRecords);
    const promoted = inspectCounterfactualOptimization(store, applicationId);
    assert.equal(promoted.promotion?.name, "first");
    assert.equal(promoted.manifest, null);
    // The final rerun retains the manifest without a second promotion or any replay.
    const { inspection, manifest } = await runCounterfactualOptimization(store, options);
    assert.deepEqual([first.calls.length, second.calls.length], calls);
    assert.equal(inspection.promotion?.record_id, promoted.promotion?.record_id);
    assert.equal(inspection.candidates[1]?.outcome?.status, "evaluated");
    assert.equal(manifest.costs.provider_calls, 4 + 2 + 4 + 1 + 4);
    assert.equal(store.verifyIntegrity().ok, true);
    // A moved application head is refused as inconsistent evidence.
    store.moveHead = true;
    await assert.rejects(
        runCounterfactualOptimization(store, {
            ...options,
            commandId: "application:cro:moved",
        }),
        (error: unknown) =>
            error instanceof ApplicationEvidenceError && /head moved/u.test(error.message),
    );
});
