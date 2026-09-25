import assert from "node:assert/strict";
import { test } from "node:test";

import {
    ApplicationBudgetError,
    ApplicationVerificationError,
    createEffectHandlerStack,
    deriveApplicationOwnerId,
    inspectCounterfactualOptimization,
    inspectReplaySession,
    type ReplaySessionProgram,
    runCounterfactualOptimization,
    SQLiteTraceStore,
} from "../../src/index.ts";
import {
    applyFixtureEdit,
    counterfactualProtocolWith,
    draftTask,
    labelMetric,
    optimizerOptions,
    providerEdit,
    providerRegistry,
    reflection,
    scriptedProposer,
    stageRequest,
    taskProgram,
    workflowProgram,
} from "./counterfactual-fixtures.ts";

const notifyHandlers = createEffectHandlerStack([
    { handle: () => ({ ok: true, value: null }), handlerId: "handler:notify", kind: "notify" },
]);

const PROMOTED_ALT = { alt: { "dev-1": 1, "dev-2": 1, "train-1": 1 } };

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

test("a task-only child of a promoted provider edit replays its suffix under the parent's provider and full-replays the effective workflow", async () => {
    using store = new SQLiteTraceStore();
    const registry = providerRegistry();
    const proposer = scriptedProposer([
        [
            {
                edits: [providerEdit("alt-plan", 0, "alt", { scope: "downstream" })],
                parent: null,
                reflection: reflection(null),
            },
        ],
        [
            {
                edits: [
                    {
                        ...providerEdit("concise-draft", 1, "unused", {
                            patch: { instruction: "Draft a concise version.", version: "2" },
                            scope: "downstream",
                        }),
                        changes: ["task"],
                    },
                ],
                parent: "alt-plan",
                reflection: reflection("alt-plan", ["alt-plan was promoted"]),
            },
        ],
    ]);
    const { inspection } = await runCounterfactualOptimization(
        store,
        optimizerOptions(
            "application:cro:lineage-task",
            {
                baseline: {
                    program: () => taskProgram,
                    programId: "workflow:task.v1",
                    provider: registry.get("base"),
                    task: () => draftTask("1", "Draft the plan."),
                },
                baselines: ["full_replay"],
                metric: labelMetric(PROMOTED_ALT),
                proposer,
                protocol: counterfactualProtocolWith({ iterations: 2 }),
            },
            registry,
        ),
    );
    const [parent, child] = inspection.candidates;
    assert.equal(parent?.status, "promoted");
    const result = child?.targeted[0];
    assert.equal(result?.target.step_index, 2);
    assert.deepEqual(result?.divergence.unexplained, []);
    // The child's live review runs under the parent's provider, not the baseline's.
    assert.deepEqual(outputs(store, result?.session_id as string), [
        "base:plan",
        "alt:draft",
        "alt:review",
    ]);
    // The full replay runs every step live under the resolved provider and the child's task.
    const full = inspectReplaySession(store, { sessionId: result?.baseline?.session_id as string });
    assert.deepEqual(outputs(store, full.session_id), ["alt:plan", "alt:draft", "alt:review"]);
    assert.equal(full.steps[1]?.provider?.request.instruction, "Draft a concise version.");
    // The baseline provider served only the six baseline sessions.
    assert.equal(registry.get("base").calls.length, 6 * 3);
});

test("a handlers-only child under a promoted provider-and-program edit inherits the parent's provider and program", async () => {
    using store = new SQLiteTraceStore();
    const registry = providerRegistry();
    const proposer = scriptedProposer([
        [
            {
                edits: [
                    providerEdit("alt-plan", 0, "alt", {
                        patch: { program: "rewrite", provider: "alt" },
                        scope: "downstream",
                    }),
                ],
                parent: null,
                reflection: reflection(null),
            },
        ],
        [
            {
                edits: [
                    {
                        ...providerEdit("notify", 2, "unused", { scope: "downstream" }),
                        changes: ["handlers"],
                    },
                ],
                parent: "alt-plan",
                reflection: reflection("alt-plan", ["alt-plan was promoted"]),
            },
        ],
    ]);
    const { inspection } = await runCounterfactualOptimization(
        store,
        optimizerOptions(
            "application:cro:lineage-handlers",
            {
                applyEdit: applyFixtureEdit(registry, {
                    handlers: notifyHandlers,
                    programs: { rewrite: workflowProgram("rewrite") },
                }),
                metric: labelMetric(PROMOTED_ALT),
                proposer,
                protocol: counterfactualProtocolWith({ iterations: 2 }),
            },
            registry,
        ),
    );
    const [parent, child] = inspection.candidates;
    assert.equal(parent?.status, "promoted");
    const parentResult = parent?.targeted[0];
    const result = child?.targeted[0];
    assert.equal(result?.target.step_index, 3);
    // The re-executed review is identical to the parent's: same provider, same program.
    assert.deepEqual(result?.divergence, {
        common_prefix_id: inspectReplaySession(store, {
            sessionId: parentResult?.session_id as string,
        }).steps[3]?.prefix_id,
        first_divergence_index: null,
        live_steps: 1,
        recorded_steps: 3,
        unexplained: [],
    });
    assert.equal(outputs(store, result?.session_id as string)[3], "alt:review");
    assert.equal(inspection.manifest?.kind, "counterfactual_optimization");
});

test("an edit whose step is outside a parent's example session is refused at proposal time", async () => {
    using store = new SQLiteTraceStore();
    const commandId = "application:cro:short-parent";
    const proposer = scriptedProposer([
        [
            {
                edits: [providerEdit("short", 0, "short")],
                parent: null,
                reflection: reflection(null),
            },
        ],
        [
            {
                edits: [providerEdit("child", 2, "alt")],
                parent: "short",
                reflection: reflection("short", ["short was promoted"]),
            },
        ],
    ]);
    const options = optimizerOptions(commandId, {
        baseline: {
            program: () => variableProgram,
            programId: "workflow:variable.v1",
            provider: providerRegistry().get("base"),
        },
        metric: ({ candidate }) => (candidate === null ? 0 : 1),
        proposer,
        protocol: counterfactualProtocolWith({ iterations: 2, maxProposalAttempts: 1 }),
    });
    await assert.rejects(
        runCounterfactualOptimization(store, options),
        ApplicationVerificationError,
    );
    const inspection = inspectCounterfactualOptimization(
        store,
        deriveApplicationOwnerId(commandId),
    );
    assert.equal(inspection.candidates[0]?.status, "promoted");
    assert.match(
        inspection.proposals[1]?.refusals[0] as string,
        /edits step 2, which its request edit cannot alter on example train-1/u,
    );
    // The baseline itself retains three steps; only the promoted parent's sessions are shorter.
    assert.equal(
        inspectReplaySession(store, { sessionId: inspection.examples[0]?.session_id as string })
            .steps.length,
        3,
    );
});

test("a session that issues more calls than projected is refused after it by its measured calls", async () => {
    using store = new SQLiteTraceStore();
    const registry = providerRegistry();
    const commandId = "application:cro:overrun";
    const options = optimizerOptions(
        commandId,
        {
            baseline: {
                program: () => variableProgram,
                programId: "workflow:variable.v1",
                provider: registry.get("base"),
            },
            proposer: scriptedProposer([
                [
                    {
                        edits: [providerEdit("long", 0, "long")],
                        parent: null,
                        reflection: reflection(null),
                    },
                ],
            ]),
            // Six baselines use 18 calls; the projected 3 fit; the branch issues 4.
            protocol: counterfactualProtocolWith({ iterations: 1, maxProviderCalls: 21 }),
        },
        registry,
    );
    await assert.rejects(
        runCounterfactualOptimization(store, options),
        (error: unknown) =>
            error instanceof ApplicationBudgetError &&
            /22 measured live provider call\(s\)/u.test(error.message),
    );
    const inspection = inspectCounterfactualOptimization(
        store,
        deriveApplicationOwnerId(commandId),
    );
    assert.equal(inspection.candidates.length, 0);
    assert.equal(inspection.proposals[0]?.candidates[0]?.name, "long");
    const calls = registry.get("long").calls.length;
    const records = ownerCount(store, commandId);
    await assert.rejects(runCounterfactualOptimization(store, options), ApplicationBudgetError);
    assert.equal(registry.get("long").calls.length, calls);
    assert.equal(ownerCount(store, commandId), records);
});
