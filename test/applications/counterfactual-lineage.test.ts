import assert from "node:assert/strict";
import { test } from "node:test";

import {
    ApplicationBudgetError,
    ApplicationEvidenceError,
    ApplicationProtocolError,
    createEffectHandlerStack,
    deriveApplicationOwnerId,
    inspectCounterfactualOptimization,
    inspectReplaySession,
    type ReplaySessionProgram,
    runCounterfactualOptimization,
    SQLiteTraceStore,
} from "../../src/index.ts";
import {
    counterfactualProtocolWithBudgets,
    draftTask,
    keyedProvider,
    optimizerOptions,
    pass,
    providerCandidate,
    stageRequest,
    taskProgram,
    workflowProgram,
} from "./counterfactual-fixtures.ts";

const notifyHandlers = createEffectHandlerStack([
    { handle: () => ({ ok: true, value: null }), handlerId: "handler:notify", kind: "notify" },
]);

function ownerCount(store: SQLiteTraceStore, commandId: string): number {
    return store.readOwner(deriveApplicationOwnerId(commandId)).length;
}

function outputs(store: SQLiteTraceStore, sessionId: string): unknown[] {
    return inspectReplaySession(store, { sessionId }).steps.map(
        (step) => (step.provider?.response?.output as { readonly text?: string } | null)?.text,
    );
}

/**
 * Workflow whose length depends on the draft: plan (0), draft from the plan (1), then nothing
 * after a `short:` draft, two extensions after a `long:` draft, and one review otherwise.
 */
const variableProgram: ReplaySessionProgram = async (context) => {
    const plan = await context.invokeProvider(stageRequest("plan", null));
    const draft = await context.invokeProvider(stageRequest("draft", plan.response.output), {
        dependsOn: [plan.handle],
    });
    const text = (draft.response.output as { readonly text: string }).text;
    if (text.startsWith("short:")) {
        return text;
    }
    if (text.startsWith("long:")) {
        const first = await context.invokeProvider(stageRequest("extend", text), {
            dependsOn: [draft.handle],
        });
        await context.invokeProvider(stageRequest("polish", first.response.output), {
            dependsOn: [first.handle],
        });
        return text;
    }
    await context.invokeProvider(stageRequest("review", text), { dependsOn: [draft.handle] });
    return text;
};

test("a task-only child replays its suffix under the parent's provider and full-replays the effective workflow", async () => {
    using store = new SQLiteTraceStore();
    const base = keyedProvider("base");
    const alt = keyedProvider("alt");
    const { inspection } = await runCounterfactualOptimization(store, {
        ...optimizerOptions("application:cro:lineage-task"),
        baseline: {
            program: taskProgram,
            programId: "workflow:task.v1",
            provider: base,
            task: draftTask("1", "Draft the plan."),
        },
        baselines: ["full_replay"],
        candidates: [
            providerCandidate("alt-plan", 0, alt),
            {
                changes: ["task"],
                name: "concise-draft",
                parent: "alt-plan",
                stepIndex: 1,
                task: draftTask("2", "Draft a concise version."),
            },
        ],
    });
    const child = inspection.candidates[1]?.outcome;
    assert.equal(child?.status, "evaluated");
    assert.equal(child?.target.step_index, 2);
    assert.deepEqual(child?.divergence?.unexplained, []);
    // The child's live review runs under the parent's provider, not the baseline's.
    assert.deepEqual(outputs(store, child?.branch_session_id as string), [
        "base:plan",
        "alt:draft",
        "alt:review",
    ]);
    // The full replay runs every step live under the same resolved provider and the child's task.
    const full = inspectReplaySession(store, { sessionId: child?.baseline?.session_id as string });
    assert.deepEqual(outputs(store, full.session_id), ["alt:plan", "alt:draft", "alt:review"]);
    assert.equal(full.steps[1]?.provider?.request.instruction, "Draft a concise version.");
    // The baseline provider served only the baseline session.
    assert.deepEqual(base.calls, ["plan", "draft", "review"]);
});

test("a handlers-only child under a provider-change parent inherits the parent's provider and program", async () => {
    using store = new SQLiteTraceStore();
    const alt = keyedProvider("alt");
    const { inspection } = await runCounterfactualOptimization(store, {
        ...optimizerOptions("application:cro:lineage-handlers"),
        candidates: [
            providerCandidate("alt-plan", 0, alt, { program: workflowProgram("rewrite") }),
            {
                changes: ["handlers"],
                handlers: notifyHandlers,
                name: "notify",
                parent: "alt-plan",
                stepIndex: 2,
            },
        ],
        evaluate: () => pass(1),
    });
    const [parent, child] = inspection.candidates;
    assert.equal(child?.outcome?.status, "evaluated");
    assert.equal(child?.outcome?.target.step_index, 3);
    // The re-executed review is identical to the parent's: same provider, same program.
    assert.deepEqual(child?.outcome?.divergence, {
        common_prefix_id: inspectReplaySession(store, {
            sessionId: parent?.outcome?.branch_session_id as string,
        }).steps[3]?.prefix_id,
        first_divergence_index: null,
        live_steps: 1,
        recorded_steps: 3,
        unexplained: [],
    });
    assert.equal(outputs(store, child?.outcome?.branch_session_id as string)[3], "alt:review");
    assert.equal(inspection.manifest?.kind, "counterfactual_optimization");
});

test("an edited step outside the baseline is refused before any application record and a corrected rerun succeeds", async () => {
    using store = new SQLiteTraceStore();
    const alt = keyedProvider("alt");
    for (const candidates of [
        [providerCandidate("x", 9, alt)],
        [providerCandidate("x", 0, alt), providerCandidate("y", 4, alt, { parent: "x" })],
    ]) {
        await assert.rejects(
            runCounterfactualOptimization(
                store,
                optimizerOptions("application:cro:step-range", { candidates }),
            ),
            (error: unknown) =>
                error instanceof ApplicationProtocolError &&
                /outside the 4 baseline steps/u.test(error.message),
        );
        assert.equal(ownerCount(store, "application:cro:step-range"), 0);
    }
    assert.deepEqual(alt.calls, []);
    const { inspection } = await runCounterfactualOptimization(
        store,
        optimizerOptions("application:cro:step-range", {
            candidates: [providerCandidate("x", 0, alt), providerCandidate("y", 3, alt)],
        }),
    );
    assert.equal(inspection.candidates[1]?.outcome?.status, "evaluated");
    assert.notEqual(inspection.manifest, null);
});

test("a child whose edited step is not retained in its shorter parent branch is refused before its proposal", async () => {
    using store = new SQLiteTraceStore();
    const options = optimizerOptions("application:cro:short-parent", {
        baseline: {
            program: variableProgram,
            programId: "workflow:variable.v1",
            provider: keyedProvider("base"),
        },
        candidates: [
            providerCandidate("short", 0, keyedProvider("short")),
            providerCandidate("child", 2, keyedProvider("alt"), { parent: "short" }),
        ],
    });
    for (let attempt = 0; attempt < 2; attempt += 1) {
        await assert.rejects(
            runCounterfactualOptimization(store, options),
            (error: unknown) =>
                error instanceof ApplicationEvidenceError &&
                /its source retains 2 steps/u.test(error.message),
        );
    }
    const inspection = inspectCounterfactualOptimization(
        store,
        deriveApplicationOwnerId("application:cro:short-parent"),
    );
    assert.equal(inspection.candidates[0]?.outcome?.status, "evaluated");
    assert.equal(inspection.candidates[1]?.proposed, null);
});

test("the measured baseline is checked against the provider-call budget before the opened record", async () => {
    using store = new SQLiteTraceStore();
    const alt = keyedProvider("alt");
    const options = optimizerOptions("application:cro:baseline-budget", {
        candidates: [providerCandidate("x", 0, alt)],
        protocol: counterfactualProtocolWithBudgets({ maxProviderCalls: 2 }),
    });
    for (let attempt = 0; attempt < 2; attempt += 1) {
        await assert.rejects(
            runCounterfactualOptimization(store, options),
            (error: unknown) =>
                error instanceof ApplicationBudgetError &&
                /4 measured live provider call\(s\)/u.test(error.message),
        );
        assert.equal(ownerCount(store, "application:cro:baseline-budget"), 0);
    }
    assert.deepEqual(alt.calls, []);
    // No record binds the run to the refused protocol, so a larger budget proceeds.
    const { inspection } = await runCounterfactualOptimization(store, {
        ...options,
        protocol: counterfactualProtocolWithBudgets({ maxProviderCalls: 8 }),
    });
    assert.equal(inspection.candidates[0]?.outcome?.status, "evaluated");
});

test("a session that issues more calls than projected is refused after it by its measured calls", async () => {
    using store = new SQLiteTraceStore();
    const long = keyedProvider("long");
    const options = optimizerOptions("application:cro:overrun", {
        baseline: {
            program: variableProgram,
            programId: "workflow:variable.v1",
            provider: keyedProvider("base"),
        },
        candidates: [providerCandidate("long", 0, long)],
        // Baseline 3 calls plus a projected 2 fit; the branch issues 3.
        protocol: counterfactualProtocolWithBudgets({ maxProviderCalls: 5 }),
    });
    await assert.rejects(
        runCounterfactualOptimization(store, options),
        (error: unknown) =>
            error instanceof ApplicationBudgetError &&
            /6 measured live provider call\(s\)/u.test(error.message),
    );
    const applicationId = deriveApplicationOwnerId("application:cro:overrun");
    const proposed = inspectCounterfactualOptimization(store, applicationId).candidates[0];
    assert.equal(proposed?.proposed?.status, "proposed");
    assert.equal(proposed?.outcome, null);
    assert.equal(
        inspectReplaySession(store, { sessionId: proposed?.proposed?.branch_session_id as string })
            .terminal?.status,
        "finished",
    );
    const calls = long.calls.length;
    const records = ownerCount(store, "application:cro:overrun");
    await assert.rejects(runCounterfactualOptimization(store, options), ApplicationBudgetError);
    assert.equal(long.calls.length, calls);
    assert.equal(ownerCount(store, "application:cro:overrun"), records);
});
