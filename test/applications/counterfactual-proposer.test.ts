import assert from "node:assert/strict";
import { test } from "node:test";
import {
    checkCroReflectionContract,
    croPromotes,
    croTokenSimilarity,
    evaluateCroGate,
    readCroThresholds,
} from "../../src/applications/counterfactual-gate.ts";
import {
    ApplicationProtocolError,
    ApplicationVerificationError,
    type CounterfactualProposal,
    createProgramConversationProvider,
    createToolLoopCounterfactualProposer,
    deriveApplicationOwnerId,
    inspectCounterfactualOptimization,
    inspectReplaySession,
    type ModelContentBlock,
    type ModelConversationRequest,
    runCounterfactualOptimization,
    type SemanticValue,
    SQLiteTraceStore,
} from "../../src/index.ts";
import {
    applyFixtureEdit,
    counterfactualDefinition,
    counterfactualProtocol,
    counterfactualProtocolWith,
    labelMetric,
    optimizerOptions,
    providerEdit,
    providerRegistry,
    reflection,
    scriptedProposer,
} from "./counterfactual-fixtures.ts";

const thresholds = readCroThresholds(counterfactualProtocol().thresholds);

function ownerCount(store: SQLiteTraceStore, commandId: string): number {
    return store.readOwner(deriveApplicationOwnerId(commandId)).length;
}

test("the gate, promotion, similarity, and reflection contract follow the configured thresholds", () => {
    assert.notEqual(typeof thresholds, "string");
    const configured = thresholds as Exclude<typeof thresholds, string>;
    assert.deepEqual(configured, {
        audaciousPrior: 0.2,
        duplicateSimilarity: 0.85,
        improveThreshold: 0.67,
        maxScoreDrop: 0.02,
        minPromotionScore: 0.5,
        minScoreLift: 0,
        promoteDevEpsilon: 0.05,
    });
    assert.equal(readCroThresholds({}), "reflectionAudaciousPrior");
    const verdict = evaluateCroGate(configured, [
        { parent_score: 0, role: "fix", score: 1 },
        { parent_score: 0.2, role: "fix", score: 0.9 },
        { parent_score: 0.5, role: "fix", score: 0.5 },
        { parent_score: 1, role: "guard", score: 0.99 },
    ]);
    assert.equal(verdict.improve_fraction, 2 / 3);
    assert.equal(verdict.max_guard_drop, 1 - 0.99);
    assert.equal(verdict.passed, false);
    assert.match(verdict.reason, /improved fix fraction .* is below 0\.67/u);
    assert.equal(
        evaluateCroGate({ ...configured, improveThreshold: 0.6 }, [
            { parent_score: 0, role: "fix", score: 1 },
            { parent_score: 1, role: "guard", score: 0.97 },
        ]).passed,
        false,
        "a guard drop above 0.02 fails",
    );
    assert.equal(croPromotes(configured, 0.5, 0.55), true);
    assert.equal(croPromotes(configured, 0.49, 0.55), false);
    assert.equal(croPromotes(configured, 0.45, 0.45), false, "below the minimum score");
    assert.equal(croTokenSimilarity("Tighten the review", "tighten the REVIEW"), 1);
    assert.equal(croTokenSimilarity("a b", "c d"), 0);
    const edit = providerEdit("dup", 0, "x", { mechanism: "tighten the review", prior: 0.1 });
    const ledger = [{ mechanism: "tighten the review", name: "old", promoted: false }];
    assert.deepEqual(
        checkCroReflectionContract(reflection(null, ["old"]), [edit], ledger, configured, 12),
        ["edit dup repeats the mechanism of old without explaining how it differs by:"],
    );
    assert.deepEqual(
        checkCroReflectionContract(
            reflection(null, ["old differs by: a stricter rubric"]),
            [edit],
            ledger,
            configured,
            12,
        ),
        [],
    );
    assert.deepEqual(
        checkCroReflectionContract(
            reflection(null, ["nothing cited"], 3),
            [{ ...edit, mechanism: "new", prior: 0.5 }],
            ledger,
            configured,
            12,
        ),
        [
            "findings must cite at least one prior candidate by name",
            "hypotheses must enumerate at least 12 mechanisms with priors, not 3",
            "at least one edit must carry a prior below 0.2",
        ],
    );
    assert.match(
        evaluateCroGate(configured, [
            { parent_score: 0, role: "fix", score: 1 },
            { parent_score: 1, role: "guard", score: -1 },
        ]).reason,
        /aggregate lift -0\.5 is below 0/u,
    );
    assert.equal(croTokenSimilarity("", "--"), 0);
    // A reflection without findings or hypotheses, or with text findings, is read as such.
    assert.deepEqual(checkCroReflectionContract(null, [edit], [], configured, 1), [
        "hypotheses must enumerate at least 1 mechanisms with priors, not 0",
    ]);
    assert.deepEqual(
        checkCroReflectionContract(
            { findings: "old differs by: a rubric", hypotheses: [] },
            [edit],
            ledger,
            configured,
            0,
        ),
        [],
    );
    // A near-duplicate of a promoted mechanism passes silently.
    assert.deepEqual(
        checkCroReflectionContract(
            reflection(null, ["kept"]),
            [edit],
            [{ mechanism: "tighten the review", name: "kept", promoted: true }],
            configured,
            12,
        ),
        [],
    );
});

test("refused proposals are retried with their reasons before any evaluation and retained as refusals", async () => {
    using store = new SQLiteTraceStore();
    const registry = providerRegistry();
    const valid = providerEdit("valid", 0, "valid");
    const attempts: readonly CounterfactualProposal[] = [
        { parent: null, reflection: reflection(null) } as unknown as CounterfactualProposal,
        { edits: [valid], parent: "nobody", reflection: reflection("nobody") },
        {
            edits: [
                providerEdit("a", 0, "a"),
                providerEdit("b", 0, "b"),
                providerEdit("c", 0, "c"),
            ],
            parent: null,
            reflection: reflection(null),
        },
        {
            edits: [providerEdit("dev-fix", 0, "x", { fix_set: ["dev-1"] })],
            parent: null,
            reflection: reflection(null),
        },
        { edits: [valid], parent: null, reflection: { findings: [], parent: null } },
        { edits: [valid], parent: null, reflection: reflection(null, [], 3) },
        { edits: [{ ...valid, prior: 0.5 }], parent: null, reflection: reflection(null) },
        {
            edits: [providerEdit("far", 9, "x")],
            parent: null,
            reflection: reflection(null),
        },
        {
            edits: [
                {
                    ...providerEdit("handlers-at-provider", 0, "x"),
                    changes: ["handlers"],
                },
            ],
            parent: null,
            reflection: reflection(null),
        },
        {
            edits: [
                {
                    ...providerEdit("no-handlers", 0, "x"),
                    changes: ["handlers"],
                    scope: "downstream",
                },
            ],
            parent: null,
            reflection: reflection(null),
        },
        { edits: [valid], parent: null, reflection: reflection("other") },
        {
            edits: [providerEdit("twin", 0, "x"), providerEdit("twin", 1, "y")],
            parent: null,
            reflection: reflection(null),
        },
        { edits: [providerEdit("throws", 0, "x")], parent: null, reflection: reflection(null) },
        { edits: [providerEdit("empty", 0, "x")], parent: null, reflection: reflection(null) },
        {
            edits: [
                providerEdit("many", 0, "x", {
                    fix_set: Array.from({ length: 30 }, (_, index) => `missing-example-${index}`),
                }),
            ],
            parent: null,
            reflection: reflection(null),
        },
        { edits: [valid], parent: null, reflection: reflection(null) },
    ];
    const proposer = scriptedProposer([attempts]);
    const { inspection } = await runCounterfactualOptimization(
        store,
        optimizerOptions(
            "application:cro:refusals",
            {
                applyEdit: (context) => {
                    if (context.edit.name === "throws") {
                        throw "boom";
                    }
                    return context.edit.name === "empty"
                        ? (undefined as never)
                        : applyFixtureEdit(registry)(context);
                },
                metric: labelMetric({}),
                proposer,
                protocol: counterfactualProtocolWith({ iterations: 1, maxProposalAttempts: 16 }),
            },
            registry,
        ),
    );
    const [proposal] = inspection.proposals;
    assert.equal(proposal?.attempts, 16);
    assert.equal(proposal?.failure, null);
    const expected = [
        /malformed proposal/u,
        /parent nobody is not in the parent pool/u,
        /between 1 and 2 edits, not 3/u,
        /names dev-1, which is not a train example/u,
        /not admitted by the reflection schema/u,
        /at least 12 mechanisms with priors, not 3/u,
        /prior below 0\.2/u,
        /edits step 9, which its request edit cannot alter on example train-1/u,
        /edits step 0, which its request edit cannot alter/u,
        /applied without exactly its declared replacements/u,
        /reflection parent disagrees with the proposal/u,
        /candidate name twin is not unique in the run/u,
        /edit throws could not be applied: boom/u,
        /edit empty was applied without exactly its declared replacements/u,
        /names missing-example-0, which is not a train example/u,
    ];
    assert.equal(proposal?.refusals.length, expected.length);
    for (const [index, pattern] of expected.entries()) {
        assert.match(proposal?.refusals[index] as string, pattern, `refusal ${index}`);
        assert.match(proposal?.refusals[index] as string, new RegExp(`^attempt ${index}: `, "u"));
    }
    // Each retry saw every earlier refusal; nothing was replayed for a refused attempt.
    assert.deepEqual(
        proposer.contexts.map((context) => context.feedback.length),
        Array.from({ length: 16 }, (_, index) => index),
    );
    // Refusal reasons are bounded by the configured reason length.
    assert.equal(proposal?.refusals[14]?.length, 1024);
    assert.deepEqual(
        inspection.candidates.map((candidate) => candidate.name),
        ["valid"],
    );
    assert.deepEqual([...registry.providers.keys()], ["base", "valid"]);
});

test("the near-duplicate rule requires citing the archived candidate and how the new edit differs", async () => {
    using store = new SQLiteTraceStore();
    const duplicate = providerEdit("again", 0, "again", {
        mechanism: "tighten the review wording",
    });
    const proposer = scriptedProposer([
        [
            {
                edits: [
                    providerEdit("first", 0, "first", { mechanism: "tighten the review wording" }),
                ],
                parent: null,
                reflection: reflection(null),
            },
        ],
        [
            { edits: [duplicate], parent: null, reflection: reflection(null, ["nothing"]) },
            { edits: [duplicate], parent: null, reflection: reflection(null, ["first failed"]) },
            {
                edits: [duplicate],
                parent: null,
                reflection: reflection(null, ["first differs by: the edit now targets step 0"]),
            },
        ],
    ]);
    const { inspection } = await runCounterfactualOptimization(
        store,
        optimizerOptions("application:cro:duplicate", {
            proposer,
            protocol: counterfactualProtocolWith({ iterations: 2, maxProposalAttempts: 3 }),
        }),
    );
    assert.equal(inspection.candidates[0]?.status, "archived");
    const second = inspection.proposals[1];
    assert.equal(second?.attempts, 3);
    assert.match(second?.refusals[0] as string, /findings must cite at least one prior candidate/u);
    assert.match(second?.refusals[0] as string, /repeats the mechanism of first/u);
    assert.match(second?.refusals[1] as string, /repeats the mechanism of first/u);
    assert.equal(inspection.candidates[1]?.name, "again");
});

test("an iteration whose every attempt is refused is retained and fails verification on every rerun", async () => {
    using store = new SQLiteTraceStore();
    const commandId = "application:cro:exhausted";
    const options = optimizerOptions(commandId, {
        proposer: scriptedProposer([
            [
                { edits: [], parent: null, reflection: reflection(null) },
                { edits: [], parent: null, reflection: reflection(null) },
            ],
        ]),
        protocol: counterfactualProtocolWith({ iterations: 1, maxProposalAttempts: 2 }),
    });
    await assert.rejects(
        runCounterfactualOptimization(store, options),
        (error: unknown) =>
            error instanceof ApplicationVerificationError &&
            error.code === "APPLICATION_VERIFICATION_FAILED" &&
            /every proposer attempt of iteration 0 was refused/u.test(error.message),
    );
    const inspection = inspectCounterfactualOptimization(
        store,
        deriveApplicationOwnerId(commandId),
    );
    assert.equal(inspection.proposals[0]?.failure?.code, "APPLICATION_VERIFICATION_FAILED");
    assert.equal(inspection.proposals[0]?.refusals.length, 2);
    assert.deepEqual(inspection.proposals[0]?.candidates, []);
    assert.equal(inspection.selection, null);
    assert.equal(inspection.manifest, null);
    const records = ownerCount(store, commandId);
    await assert.rejects(
        runCounterfactualOptimization(store, {
            ...options,
            proposer: () => {
                throw new Error("a retained failure must not propose again");
            },
        }),
        ApplicationVerificationError,
    );
    assert.equal(ownerCount(store, commandId), records);
});

/** Scripted conversational model answering the n-th turn with `turns[n]`. */
function conversationModel(
    turns: readonly ((request: ModelConversationRequest) => {
        readonly content: readonly ModelContentBlock[];
        readonly output: SemanticValue;
    })[],
) {
    const requests: ModelConversationRequest[] = [];
    const provider = createProgramConversationProvider({
        id: "proposer-model",
        respond: (request) => {
            requests.push(request);
            const index = request.messages.filter((message) => message.role === "assistant").length;
            const turn = turns[index];
            if (turn === undefined) {
                throw new Error(`no scripted proposer turn ${index}`);
            }
            const { content, output } = turn(request);
            const calls = content.some((block) => block.type === "tool_use");
            return {
                message: { content, role: "assistant" },
                output: calls ? null : output,
                stopReason: calls ? "tool_use" : "end_turn",
                usage: {
                    cacheCreationInputTokens: 0,
                    cacheReadInputTokens: 0,
                    costUsd: null,
                    inputTokens: 5,
                    outputTokens: 1,
                },
            };
        },
    });
    return { provider, requests };
}

function toolResultValue(request: ModelConversationRequest, id: string): Record<string, unknown> {
    const block = request.messages
        .at(-1)
        ?.content.find((entry) => entry.type === "tool_result" && entry.toolUseId === id);
    assert.ok(block && block.type === "tool_result", `tool result ${id}`);
    const parsed = JSON.parse(block.content) as {
        readonly result: { readonly ok: boolean; readonly value: Record<string, unknown> };
    };
    assert.equal(parsed.result.ok, true, `tool ${id} succeeded`);
    return parsed.result.value;
}

test("the provider-backed proposer runs a replayable tool loop over the traces and its proposal is admitted", async () => {
    using store = new SQLiteTraceStore();
    const registry = providerRegistry();
    const seen: Record<string, Record<string, unknown>> = {};
    const edit = providerEdit("replan", 0, "replanned", { fix_set: ["train-1", "train-2"] });
    const { provider, requests } = conversationModel([
        () => ({
            content: [
                { id: "inspect", input: {}, name: "inspect_candidates", type: "tool_use" },
                {
                    id: "read",
                    input: { candidate: null, example_id: "train-1" },
                    name: "read_effect_trace",
                    type: "tool_use",
                },
                {
                    id: "grep",
                    input: { candidate: null, pattern: "base:review" },
                    name: "grep_effect_traces",
                    type: "tool_use",
                },
            ],
            output: null,
        }),
        (request) => {
            seen.inspect = toolResultValue(request, "inspect");
            seen.read = toolResultValue(request, "read");
            seen.grep = toolResultValue(request, "grep");
            return {
                content: [
                    {
                        id: "propose",
                        input: edit as unknown as Record<string, SemanticValue>,
                        name: "propose_candidate",
                        type: "tool_use",
                    },
                    {
                        id: "malformed",
                        input: { name: "no-sets" },
                        name: "propose_candidate",
                        type: "tool_use",
                    },
                ],
                output: null,
            };
        },
        () => ({
            content: [{ text: "reflection attached", type: "text" }],
            output: JSON.stringify(reflection(null)),
        }),
    ]);
    const commandId = "application:cro:tool-loop";
    const options = optimizerOptions(
        commandId,
        {
            metric: labelMetric({ replanned: { "train-1": 1, "train-2": 1 } }),
            proposer: createToolLoopCounterfactualProposer({ model: provider }),
            protocol: counterfactualProtocolWith({ iterations: 1 }),
        },
        registry,
    );
    const { inspection, manifest } = await runCounterfactualOptimization(store, options);
    // The loop read the pool, a baseline trace, and grepped the baseline traces.
    assert.deepEqual(seen.inspect?.pool, [{ dev_score: 0, name: null }]);
    assert.equal((seen.read?.steps as readonly unknown[] | undefined)?.length, 4);
    assert.equal(seen.read?.example_id, "train-1");
    const matches = seen.grep?.matches as readonly { readonly example_id: string }[];
    assert.deepEqual(
        matches.map((match) => match.example_id),
        ["train-1", "train-2", "train-3", "train-4", "dev-1", "dev-2"],
    );
    assert.equal(seen.grep?.truncated, false);
    // The system prompt is the pinned proposer prompt and the brief is the first user message.
    assert.equal(
        requests[0]?.system,
        (counterfactualDefinition.surfaces as readonly { content: unknown; id: string }[]).find(
            (surface) => surface.id === "proposer.propose",
        )?.content,
    );
    assert.deepEqual(
        requests[0]?.tools?.map((tool) => tool.name),
        ["inspect_candidates", "read_effect_trace", "grep_effect_traces", "propose_candidate"],
    );
    // Only the schema-valid propose call joined the proposal.
    const [proposal] = inspection.proposals;
    assert.deepEqual(
        proposal?.candidates.map((plan) => plan.name),
        ["replan"],
    );
    assert.equal(proposal?.proposer_session_ids.length, 1);
    const session = inspectReplaySession(store, {
        sessionId: proposal?.proposer_session_ids[0] as string,
    });
    assert.equal(session.program_id, "shepherd.application.cro.proposer.v1");
    assert.deepEqual(
        session.steps.map((step) => step.kind),
        ["provider", "effect", "effect", "effect", "provider", "effect", "provider"],
    );
    // The edit graduates on its fix set but its dev score misses the minimum promotion score.
    assert.equal(inspection.candidates[0]?.status, "evaluated");
    // The proposer session's three turns are measured in the manifest costs.
    assert.equal(manifest.costs.provider_calls, 24 + 3 + 8 + 8);
    // A repeat serves the retained proposer session without calling the model.
    const turns = requests.length;
    await runCounterfactualOptimization(store, options);
    assert.equal(requests.length, turns);
});

test("a provider-backed attempt that reaches its turn limit is refused and retried in a new session", async () => {
    using store = new SQLiteTraceStore();
    const { provider } = conversationModel([
        () => ({
            content: [{ id: "inspect", input: {}, name: "inspect_candidates", type: "tool_use" }],
            output: null,
        }),
    ]);
    const commandId = "application:cro:turn-limit";
    await assert.rejects(
        runCounterfactualOptimization(
            store,
            optimizerOptions(commandId, {
                proposer: createToolLoopCounterfactualProposer({ maxTurns: 1, model: provider }),
                protocol: counterfactualProtocolWith({ iterations: 1, maxProposalAttempts: 2 }),
            }),
        ),
        ApplicationVerificationError,
    );
    const inspection = inspectCounterfactualOptimization(
        store,
        deriveApplicationOwnerId(commandId),
    );
    const [proposal] = inspection.proposals;
    assert.equal(proposal?.proposer_session_ids.length, 2);
    assert.match(proposal?.refusals[0] as string, /reached its turn limit without a reflection/u);
    // A tool surface naming no configured operation is a protocol error of the proposer.
    const surfaces = (counterfactualDefinition.surfaces as readonly Record<string, unknown>[]).map(
        (surface) =>
            surface.id === "tool.inspect_candidates"
                ? { ...surface, content: { ...(surface.content as object), name: "bash" } }
                : surface,
    );
    await assert.rejects(
        runCounterfactualOptimization(
            store,
            optimizerOptions("application:cro:unknown-tool", {
                proposer: createToolLoopCounterfactualProposer({ model: provider }),
                protocol: counterfactualProtocol({
                    budgets: {
                        ...(counterfactualDefinition.budgets as object),
                        iterations: 1,
                    },
                    surfaces,
                }),
            }),
        ),
        (error: unknown) =>
            error instanceof ApplicationProtocolError &&
            /configured operation/u.test(error.message),
    );
    assert.throws(
        () => createToolLoopCounterfactualProposer({ maxTurns: 0, model: provider }),
        TypeError,
    );
});

test("the provider-backed proposer reads promoted and archived candidates, reports tool failures, and parses object reflections", async () => {
    using store = new SQLiteTraceStore();
    const registry = providerRegistry();
    const seen: Record<string, unknown> = {};
    const errors: Record<string, boolean> = {};
    const toolResultOf = (request: ModelConversationRequest, id: string) => {
        const block = request.messages
            .at(-1)
            ?.content.find((entry) => entry.type === "tool_result" && entry.toolUseId === id);
        assert.ok(block && block.type === "tool_result");
        errors[id] = block.isError;
        return JSON.parse(block.content) as { readonly result: { readonly value: unknown } };
    };
    const calls: readonly [string, string, Record<string, SemanticValue>][] = [
        ["inspect", "inspect_candidates", {}],
        ["read-good", "read_effect_trace", { candidate: "good", example_id: "dev-1" }],
        ["grep-bad", "grep_effect_traces", { candidate: "bad", pattern: "." }],
        ["grep-invalid", "grep_effect_traces", { candidate: null, pattern: "(" }],
        ["grep-long", "grep_effect_traces", { candidate: null, pattern: "x".repeat(300) }],
        ["read-ghost", "read_effect_trace", { candidate: "ghost", example_id: "train-1" }],
        ["read-nowhere", "read_effect_trace", { candidate: null, example_id: "nowhere" }],
    ];
    const { provider } = conversationModel([
        () => ({
            content: calls.map(([id, name, input]) => ({ id, input, name, type: "tool_use" })),
            output: null,
        }),
        (request) => {
            for (const [id] of calls) {
                seen[id] = toolResultOf(request, id).result.value;
            }
            return {
                content: [
                    {
                        id: "propose",
                        input: providerEdit("child", 3, "child") as unknown as Record<
                            string,
                            SemanticValue
                        >,
                        name: "propose_candidate",
                        type: "tool_use",
                    },
                ],
                output: null,
            };
        },
        () => ({
            content: [{ text: "done", type: "text" }],
            output: reflection("good", ["bad was archived"]),
        }),
    ]);
    const toolLoop = createToolLoopCounterfactualProposer({ model: provider });
    const { inspection } = await runCounterfactualOptimization(
        store,
        optimizerOptions(
            "application:cro:tool-loop-pool",
            {
                clock: () => 5_000,
                metric: labelMetric({ good: { "dev-1": 1, "dev-2": 1, "train-1": 1 } }),
                proposer: (context) =>
                    context.iteration === 0
                        ? {
                              edits: [
                                  providerEdit("good", 0, "good"),
                                  providerEdit("bad", 3, "bad"),
                              ],
                              parent: null,
                              reflection: reflection(null),
                          }
                        : context.iteration === 1
                          ? {
                                edits: [providerEdit("first-child", 3, "first")],
                                parent: "good",
                                reflection: reflection("good", ["bad was archived"]),
                            }
                          : toolLoop(context),
                protocol: counterfactualProtocolWith({ iterations: 3 }),
            },
            registry,
        ),
    );
    const inspected = seen.inspect as {
        readonly candidates: readonly { readonly name: string; readonly parent: string | null }[];
        readonly pool: readonly { readonly name: string | null }[];
    };
    assert.deepEqual(
        inspected.candidates.map((candidate) => [candidate.name, candidate.parent]),
        [
            ["good", null],
            ["bad", null],
            ["first-child", "good"],
        ],
    );
    assert.deepEqual(
        inspected.pool.map((member) => member.name),
        [null, "good"],
    );
    assert.equal((seen["read-good"] as { readonly example_id: string }).example_id, "dev-1");
    assert.equal((seen["grep-bad"] as { readonly matches: readonly unknown[] }).matches.length, 4);
    for (const id of ["grep-invalid", "grep-long", "read-ghost", "read-nowhere"]) {
        assert.equal(errors[id], true, id);
    }
    assert.equal(errors.inspect, false);
    const [good, bad, , child] = inspection.candidates;
    assert.equal(good?.status, "promoted");
    assert.equal(bad?.status, "archived");
    assert.equal(child?.parent_candidate_id, good?.candidate_id);
    assert.equal(inspection.proposals[2]?.proposer_session_ids.length, 1);
});

test("a proposer session that fails or answers with text that is not JSON is refused", async () => {
    const failing = createProgramConversationProvider({
        id: "failing-proposer",
        respond: () => {
            throw new Error("proposer model unavailable");
        },
    });
    const { provider: textual } = conversationModel([
        () => ({ content: [{ text: "not json", type: "text" }], output: "not json" }),
    ]);
    for (const [label, model, pattern] of [
        ["failed", failing, /ended failed instead of finished/u],
        ["text", textual, /returned a reflection that is not JSON/u],
    ] as const) {
        using store = new SQLiteTraceStore();
        const commandId = `application:cro:proposer-${label}`;
        await assert.rejects(
            runCounterfactualOptimization(
                store,
                optimizerOptions(commandId, {
                    proposer: createToolLoopCounterfactualProposer({ model }),
                    protocol: counterfactualProtocolWith({ iterations: 1, maxProposalAttempts: 1 }),
                }),
            ),
            ApplicationVerificationError,
        );
        const inspection = inspectCounterfactualOptimization(
            store,
            deriveApplicationOwnerId(commandId),
        );
        assert.match(inspection.proposals[0]?.refusals[0] as string, pattern, label);
    }
});

test("tool-loop proposer options and proposer tool surfaces are validated", async () => {
    const { provider } = conversationModel([]);
    for (const options of [
        null,
        "model",
        [],
        { extra: true, model: provider },
        {},
        { model: { converse: () => null } },
        { maxTurns: 1.5, model: provider },
        { maxTurns: 1000, model: provider },
    ]) {
        assert.throws(
            () => createToolLoopCounterfactualProposer(options as never),
            TypeError,
            JSON.stringify(options),
        );
    }
    const surfaces = counterfactualDefinition.surfaces as readonly Record<string, unknown>[];
    for (const [label, changed, pattern] of [
        [
            "no-propose",
            surfaces.filter((surface) => surface.id !== "tool.propose_candidate"),
            /offers no propose_candidate tool/u,
        ],
        [
            "no-description",
            surfaces.map((surface) =>
                surface.id === "tool.inspect_candidates"
                    ? {
                          ...surface,
                          content: { ...(surface.content as object), description: 1 },
                      }
                    : surface,
            ),
            /must declare a configured operation name, a description/u,
        ],
    ] as const) {
        using store = new SQLiteTraceStore();
        await assert.rejects(
            runCounterfactualOptimization(
                store,
                optimizerOptions(`application:cro:surfaces:${label}`, {
                    proposer: createToolLoopCounterfactualProposer({ model: provider }),
                    protocol: counterfactualProtocol({
                        budgets: counterfactualProtocolWith({ iterations: 1 }).budgets,
                        surfaces: changed,
                    }),
                }),
            ),
            (error: unknown) =>
                error instanceof ApplicationProtocolError && pattern.test(error.message),
            label,
        );
    }
});
