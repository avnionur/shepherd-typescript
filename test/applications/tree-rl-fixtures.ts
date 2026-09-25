import { readFileSync } from "node:fs";

import {
    type ApplicationProtocolDefinition,
    canonicalizeRecord,
    createEffectHandlerStack,
    createEffectIntent,
    createStaticProvider,
    type ModelProvider,
    type ModelRequest,
    type ModelResponse,
    type ReplaySessionContext,
    type ReplaySessionProgram,
    type RunTreeRlRolloutsOptions,
    readApplicationProtocol,
    runReplaySession,
    type SQLiteTraceStore,
    type StaticProviderExchange,
    type TreeRlForkSelectionContext,
    type TreeRlForkSelector,
    type TreeRlProviderContext,
    type TreeRlRewardContext,
    type TreeRlToolCall,
} from "../../src/index.ts";

/** Repository §5.3 experiment definition read by the Tree-RL tests. */
export const treeRlDefinition = (
    JSON.parse(
        readFileSync(
            new URL("../../config/research-applications.config.json", import.meta.url),
            "utf8",
        ),
    ) as { readonly treeRl: Record<string, unknown> }
).treeRl;

/** The repository's §5.3 protocol definition, validated, with optional overrides. */
export function treeRlProtocol(
    overrides: Record<string, unknown> = {},
): ApplicationProtocolDefinition {
    return readApplicationProtocol({ ...treeRlDefinition, ...overrides });
}

/** Protocol with the repository budgets replaced by the given ones. */
export function treeRlProtocolWithBudgets(
    budgets: Record<string, number>,
    overrides: Record<string, unknown> = {},
): ApplicationProtocolDefinition {
    return treeRlProtocol({
        budgets: { ...(treeRlDefinition.budgets as Record<string, number>), ...budgets },
        ...overrides,
    });
}

/** One provider stage of the synthetic workflow and the stage whose output it consumes. */
type Stage = { readonly dependsOn: number | null; readonly stage: string };

/**
 * Synthetic deterministic workflow: plan (0), explore from the plan (1), draft from the
 * exploration (2), an independent note (3), and the answer from the draft (4).
 * Transitive dependents: 0 → [1, 2, 4], 1 → [2, 4], 2 → [4], 3 → [], 4 → [].
 */
export const STAGES: readonly Stage[] = [
    { dependsOn: null, stage: "plan" },
    { dependsOn: 0, stage: "explore" },
    { dependsOn: 1, stage: "draft" },
    { dependsOn: null, stage: "note" },
    { dependsOn: 2, stage: "answer" },
];

/** Program identity of the synthetic workflow. */
export const PROGRAM_ID = "workflow:plan-explore-draft-note-answer.v1";

function stageRequest(stage: string, prior: unknown): ModelRequest {
    return {
        input: { prior: prior as never, stage },
        instruction: `perform ${stage}`,
        outputSchema: { type: "object" },
    };
}

function response(label: string, stage: string): ModelResponse {
    return {
        output: { text: `${label}:${stage}` },
        usage: {
            cacheCreationInputTokens: 1,
            cacheReadInputTokens: 2,
            costUsd: 0.25,
            inputTokens: 10,
            outputTokens: 2,
        },
    };
}

/** The synthetic workflow program; every step declares exactly its consumed dependency. */
export const workflowProgram: ReplaySessionProgram = async (context: ReplaySessionContext) => {
    const outputs: unknown[] = [];
    const handles: unknown[] = [];
    for (const { dependsOn, stage } of STAGES) {
        const step = await context.invokeProvider(
            stageRequest(stage, dependsOn === null ? null : outputs[dependsOn]),
            { dependsOn: dependsOn === null ? [] : [handles[dependsOn] as never] },
        );
        outputs.push(step.response.output);
        handles.push(step.handle);
    }
    return { answer: outputs[4] as never, note: outputs[3] as never };
};

/** Canonical rendering of a proposed tool call as a workflow stage output (the "renderer"). */
export function renderToolCall(toolCall: TreeRlToolCall): { readonly text: string } {
    return { text: `${toolCall.name}(${canonicalizeRecord(toolCall.arguments)})` };
}

/**
 * Builds the exact static cassette of the synthetic workflow from one step on: stages before
 * `from` answer with the `prefix` label, stages from `from` on with `label`; a `toolCall` replaces
 * the first live stage's answer with its rendering.
 */
export function cassette(
    label: string,
    from = 0,
    id = label,
    prefix = "base",
    toolCall: TreeRlToolCall | null = null,
): ModelProvider {
    const outputs: unknown[] = [];
    const exchanges: StaticProviderExchange[] = [];
    for (const [index, { dependsOn, stage }] of STAGES.entries()) {
        const base = response(index < from ? prefix : label, stage);
        const answer =
            index === from && toolCall !== null
                ? { ...base, output: renderToolCall(toolCall) }
                : base;
        if (index >= from) {
            exchanges.push({
                request: stageRequest(stage, dependsOn === null ? null : outputs[dependsOn]),
                response: answer,
            });
        }
        outputs.push(answer.output);
    }
    return createStaticProvider({
        descriptor: { id: `provider:${id}`, model: "fixture-v1" },
        exchanges,
    });
}

/** Records the synthetic source session under one command and returns its identity. */
export async function recordSource(
    store: SQLiteTraceStore,
    commandId = "source:tree-rl",
    program: ReplaySessionProgram = workflowProgram,
    provider: ModelProvider = cassette("base"),
    extra: Record<string, unknown> = {},
): Promise<string> {
    const { inspection } = await runReplaySession(store, {
        claimId: "source",
        commandId,
        program,
        programId: PROGRAM_ID,
        provider,
        ...extra,
    });
    return inspection.session_id;
}

/** Root session identity to its cassette label, in group order. */
export type RootLabels = ReadonlyMap<string, string>;

/**
 * Records one root session per label (each answering every stage with its label) and returns the
 * identities with their labels in order.
 */
export async function recordRoots(
    store: SQLiteTraceStore,
    labels: readonly string[] = ["base", "alt"],
    commandPrefix = "root:tree-rl",
): Promise<RootLabels> {
    const roots = new Map<string, string>();
    for (const label of labels) {
        roots.set(
            await recordSource(
                store,
                `${commandPrefix}:${label}`,
                workflowProgram,
                cassette(label),
            ),
            label,
        );
    }
    return roots;
}

/** Provider factory returning each rollout's cassette, with a log of every context. */
export function providerFactory(
    labels: RootLabels,
    build: (context: TreeRlProviderContext, root: string) => ModelProvider = (context, root) =>
        cassette(
            `s${context.seed}`,
            context.fork_point.step_index,
            `${root}:s${context.seed}:${context.fork_point.step_index}`,
            root,
            context.tool_call,
        ),
): ((context: TreeRlProviderContext) => ModelProvider) & {
    readonly contexts: TreeRlProviderContext[];
} {
    const contexts: TreeRlProviderContext[] = [];
    return Object.assign(
        (context: TreeRlProviderContext) => {
            contexts.push(context);
            return build(context, labels.get(context.root_session_id) as string);
        },
        { contexts },
    );
}

/**
 * Reward table keyed by `<root label>` for a root and `<root label>:<seed>` for a branch. Tree
 * `base`: 1, 3, 5 (mean 3); tree `alt`: 3, 1, 2 (mean 2); roots 1 and 3 (mean 2).
 */
export const REWARDS: Readonly<Record<string, number>> = {
    alt: 3,
    "alt:3": 1,
    "alt:5": 2,
    base: 1,
    "base:3": 3,
    "base:5": 5,
};

/** Reward function reading a table by root label and seed, with a log of every context. */
export function rewardOf(
    labels: RootLabels,
    table: Readonly<Record<string, number | (() => number)>> = REWARDS,
): ((context: TreeRlRewardContext) => number) & { readonly contexts: TreeRlRewardContext[] } {
    const contexts: TreeRlRewardContext[] = [];
    return Object.assign(
        (context: TreeRlRewardContext) => {
            contexts.push(context);
            const root = labels.get(context.root.session_id) as string;
            const entry = table[context.seed === null ? root : `${root}:${context.seed}`];
            return typeof entry === "function" ? entry() : (entry as number);
        },
        { contexts },
    );
}

/** Selector proposing a fixed turn and tool call, with a log of every context. */
export function fixedSelector(
    turn = 2,
    toolCall: TreeRlToolCall | null = null,
): TreeRlForkSelector & { readonly contexts: TreeRlForkSelectionContext[] } {
    const contexts: TreeRlForkSelectionContext[] = [];
    return Object.assign(
        (context: TreeRlForkSelectionContext) => {
            contexts.push(context);
            return { branch_turn: turn, reason: `fork at turn ${turn}`, tool_call: toolCall };
        },
        { contexts },
    );
}

/** Base Tree-RL options: one prompt over the given roots and the repository protocol. */
export function treeRlOptions(
    commandId: string,
    labels: RootLabels,
    overrides: Partial<RunTreeRlRolloutsOptions> = {},
): RunTreeRlRolloutsOptions {
    return {
        claimId: "tree-rl",
        commandId,
        prompts: [{ id: "task", program: workflowProgram, roots: [...labels.keys()] }],
        protocol: treeRlProtocol(),
        provider: providerFactory(labels),
        reward: rewardOf(labels),
        selector: fixedSelector(),
        ...overrides,
    };
}

/** Notification intent whose payload is the plan output without a declared dependency. */
function notifyOf(payload: unknown) {
    return createEffectIntent({
        effectId: "effect:notify",
        kind: "notify",
        payload: payload as never,
        reversibility: "reversible",
    });
}

/** Handler stack materializing the notification. */
export const notifyHandlers = createEffectHandlerStack([
    { handle: () => ({ ok: true, value: null }), handlerId: "handler:notify", kind: "notify" },
]);

/**
 * Workflow with an undeclared dependency: plan (0), a notification carrying the plan output that
 * declares no dependency (1), and the answer from the plan (2). A rollout forked at the plan
 * changes the notification without an explained cause.
 */
export const undeclaredProgram: ReplaySessionProgram = async (context) => {
    const plan = await context.invokeProvider(stageRequest("plan", null), { dependsOn: [] });
    await context.dispatchEffect(notifyOf(plan.response.output), { dependsOn: [] });
    const answer = await context.invokeProvider(stageRequest("answer", plan.response.output), {
        dependsOn: [plan.handle],
    });
    return answer.response.output;
};

/** Exact cassette of the undeclared-dependency workflow from the plan on. */
export function undeclaredCassette(label: string): ModelProvider {
    const plan = response(label, "plan");
    return createStaticProvider({
        descriptor: { id: `provider:undeclared:${label}`, model: "fixture-v1" },
        exchanges: [
            { request: stageRequest("plan", null), response: plan },
            { request: stageRequest("answer", plan.output), response: response(label, "answer") },
        ],
    });
}
