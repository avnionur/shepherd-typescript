import { readFileSync } from "node:fs";

import {
    type ApplicationProtocolDefinition,
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
    type TreeRlProviderContext,
    type TreeRlRewardContext,
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

/**
 * Builds the exact static cassette of the synthetic workflow from one step on: stages before
 * `from` answer with the `base` label, stages from `from` on with `label`.
 */
export function cassette(label: string, from = 0, id = label): ModelProvider {
    const outputs: unknown[] = [];
    const exchanges: StaticProviderExchange[] = [];
    for (const [index, { dependsOn, stage }] of STAGES.entries()) {
        const answer = response(index < from ? "base" : label, stage);
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

/** Provider factory returning each rollout's cassette, with a log of every context. */
export function providerFactory(
    build: (context: TreeRlProviderContext) => ModelProvider = ({ fork_point, seed }) =>
        cassette(`s${seed}`, fork_point.step_index, `s${seed}:${fork_point.step_index}`),
): ((context: TreeRlProviderContext) => ModelProvider) & {
    readonly contexts: TreeRlProviderContext[];
} {
    const contexts: TreeRlProviderContext[] = [];
    return Object.assign(
        (context: TreeRlProviderContext) => {
            contexts.push(context);
            return build(context);
        },
        { contexts },
    );
}

/** Reward table keyed by `<fork step>:<seed>`: exact values with an exact overall mean of 3. */
export const REWARDS: Readonly<Record<string, number>> = {
    "0:3": 1,
    "0:5": 3,
    "1:3": 4,
    "1:5": 8,
    "2:3": 0,
    "2:5": 2,
};

/** Reward function reading a table by fork step and seed, with a log of every context. */
export function rewardOf(
    table: Readonly<Record<string, number | (() => number)>> = REWARDS,
): ((context: TreeRlRewardContext) => number) & { readonly contexts: TreeRlRewardContext[] } {
    const contexts: TreeRlRewardContext[] = [];
    return Object.assign(
        (context: TreeRlRewardContext) => {
            contexts.push(context);
            const entry = table[`${context.fork_point.step_index}:${context.seed}`];
            return typeof entry === "function" ? entry() : (entry as number);
        },
        { contexts },
    );
}

/** Base Tree-RL options over the synthetic workflow and the repository protocol. */
export function treeRlOptions(
    commandId: string,
    sourceSessionId: string,
    overrides: Partial<RunTreeRlRolloutsOptions> = {},
): RunTreeRlRolloutsOptions {
    return {
        claimId: "tree-rl",
        commandId,
        program: workflowProgram,
        protocol: treeRlProtocol(),
        provider: providerFactory(),
        reward: rewardOf(),
        sourceSessionId,
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
