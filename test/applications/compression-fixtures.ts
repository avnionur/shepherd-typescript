import { readFileSync } from "node:fs";

import {
    type ApplicationProtocolDefinition,
    type ChildRunRootParent,
    createEffectHandlerStack,
    createEffectIntent,
    createStaticProvider,
    type ModelProvider,
    type ModelRequest,
    type ReplayProviderSessionAdapter,
    type ReplaySessionContext,
    type ReplayStepHandle,
    type RunTrajectoryCompressionOptions,
    readApplicationProtocol,
    schema,
    type TrajectoryCompressionGuidance,
    type TrajectoryCompressionProgram,
    type TrajectoryCompressionProposal,
    type TrajectoryCompressorContext,
    type TrajectoryVerifierContext,
    task,
} from "../../src/index.ts";
import { applicationsProtocolConfig } from "../../src/protocol/config.ts";

const fields = applicationsProtocolConfig.compression.childFields;

/** Repository Appendix D experiment definition read by the compression tests. */
export const compressionDefinition = (
    JSON.parse(
        readFileSync(
            new URL("../../config/research-applications.config.json", import.meta.url),
            "utf8",
        ),
    ) as { readonly compression: Record<string, unknown> }
).compression;

/** The repository's Appendix D protocol definition, validated, with optional overrides. */
export function compressionProtocol(
    overrides: Record<string, unknown> = {},
): ApplicationProtocolDefinition {
    return readApplicationProtocol({ ...compressionDefinition, ...overrides });
}

/** Protocol with the repository budgets replaced by the given ones. */
export function compressionProtocolWithBudgets(
    budgets: Record<string, number>,
): ApplicationProtocolDefinition {
    return compressionProtocol({
        budgets: { ...(compressionDefinition.budgets as Record<string, number>), ...budgets },
    });
}

/** Options of a stage-keyed workflow provider. */
export type StageProviderOptions = {
    /** Cost reported per invocation; null reports no cost. */
    readonly costUsd?: number | null;
    /** Stage whose output reports that exploration is done. */
    readonly doneAt?: string;
    /** Stage whose invocation throws. */
    readonly failStage?: string;
    /** One-based invocation of the failing stage that throws; every invocation when omitted. */
    readonly failOnCall?: number;
};

/** Stateless provider whose output is a pure function of the stage, with an invocation log. */
export type StageProvider = ModelProvider & { readonly calls: string[] };

/** Builds a stateless provider answering every request with `{ text: "<label>:<stage>" }`. */
export function stageProvider(label: string, options: StageProviderOptions = {}): StageProvider {
    const { descriptor } = createStaticProvider({
        descriptor: { id: `provider:${label}`, model: "fixture-v1" },
        exchanges: [],
    });
    const calls: string[] = [];
    return Object.freeze({
        calls,
        descriptor,
        invoke: async (request: ModelRequest) => {
            const stage = (request.input as { readonly stage: string }).stage;
            calls.push(stage);
            if (
                stage === options.failStage &&
                (options.failOnCall === undefined ||
                    calls.filter((call) => call === stage).length === options.failOnCall)
            ) {
                throw new Error(`provider ${label} failed at ${stage}`);
            }
            return {
                output: { text: stage === options.doneAt ? `${label}:done` : `${label}:${stage}` },
                usage: {
                    cacheCreationInputTokens: 1,
                    cacheReadInputTokens: 2,
                    costUsd: options.costUsd === undefined ? 0.25 : options.costUsd,
                    inputTokens: 10,
                    outputTokens: 2,
                },
            };
        },
    });
}

function stageRequest(stage: string, prior: unknown): ModelRequest {
    return {
        input: { prior: prior as never, stage },
        instruction: `perform ${stage}`,
        outputSchema: { type: "object" },
    };
}

/** Reversible notification intent the workflow dispatches before answering. */
export const notifyIntent = createEffectIntent({
    effectId: "effect:notify",
    kind: "notify",
    payload: { stage: "explored" },
    reversibility: "reversible",
});

/** Handler stack materializing the notification. */
export const notifyHandlers = createEffectHandlerStack([
    { handle: () => ({ ok: true, value: null }), handlerId: "handler:notify", kind: "notify" },
]);

/** Options of the explore-and-answer workflow. */
export type ExploreWorkflowOptions = {
    /** Capture a coupled checkpoint at step boundary one. */
    readonly checkpoint?: boolean;
    /** Invocation log of guided program instances. */
    readonly guided?: TrajectoryCompressionGuidance[];
};

/**
 * Explore-and-answer workflow: plan (0), explore-a (1), explore-b (2), notify effect (3), answer
 * (4). Exploration stops early when a stage reports done. Under a guidance with a hint, every
 * exploration and the notification are skipped from the fork point onward, so the answer, which
 * depends only on the plan, is reached in fewer steps with the same output.
 */
export function exploreWorkflow(
    options: ExploreWorkflowOptions = {},
): TrajectoryCompressionProgram {
    return (guidance) => {
        if (guidance !== null) {
            options.guided?.push(guidance);
        }
        return async (context: ReplaySessionContext) => {
            const shortcut = () =>
                guidance !== null &&
                guidance.hint !== null &&
                context.step_count >= guidance.fork_point.step_index;
            const plan = await context.invokeProvider(stageRequest("plan", null));
            if (options.checkpoint === true) {
                await context.checkpoint();
            }
            let prior: { readonly handle: ReplayStepHandle; readonly output: unknown } = {
                handle: plan.handle,
                output: plan.response.output,
            };
            for (const stage of ["explore-a", "explore-b"]) {
                if (shortcut()) {
                    break;
                }
                const step = await context.invokeProvider(stageRequest(stage, prior.output), {
                    dependsOn: [prior.handle],
                });
                prior = { handle: step.handle, output: step.response.output };
                if ((step.response.output as { readonly text: string }).text.endsWith(":done")) {
                    break;
                }
            }
            if (!shortcut()) {
                await context.dispatchEffect(notifyIntent, { dependsOn: [] });
            }
            const answer = await context.invokeProvider(
                stageRequest("answer", plan.response.output),
                { dependsOn: [plan.handle] },
            );
            return answer.response.output;
        };
    };
}

/** Compressor task over the configured evidence and output text fields. */
export const compressorTask = task({
    input: schema.object({ [fields.input]: schema.string() }),
    instruction: "Propose one fork point and hint that shorten the recorded trajectory.",
    name: "trajectory-compressor",
    output: schema.object({ [fields.output]: schema.string() }),
    version: "1",
});

/** Verifier task over the configured evidence and output text fields. */
export const verifierTask = task({
    input: schema.object({ [fields.input]: schema.string() }),
    instruction: "Verify that the compressed trajectory reaches the original result.",
    name: "trajectory-verifier",
    output: schema.object({ [fields.output]: schema.string() }),
    version: "1",
});

/** Wraps one value as the canonical JSON text output of a delegated child. */
export function childOutput(value: unknown): Record<string, string> {
    return { [fields.output]: JSON.stringify(value) };
}

/**
 * Proposal forking the source at a boundary with a hint citing the explorations. The prefix identity
 * is the retained one at the boundary, or null at step 0 and outside the source.
 */
export function forkAt(
    stepIndex: number,
    hint: string | null = "answer directly from the plan",
): (context: TrajectoryCompressorContext) => TrajectoryCompressionProposal {
    return ({ source }) => ({
        fork_point: {
            prefix_id: source.steps[stepIndex - 1]?.prefix_id ?? null,
            session_id: source.session_id,
            step_index: stepIndex,
        },
        hint: hint === null ? null : { cited_step_indices: [1, 2], text: hint },
    });
}

/** Program-serviced compressor returning the proposal built from the source, logging contexts. */
export function compressorOf(
    propose: (context: TrajectoryCompressorContext) => unknown,
    contexts: TrajectoryCompressorContext[] = [],
): RunTrajectoryCompressionOptions["compressor"] {
    return {
        budget: { maxTurns: 1 },
        grant: [],
        program: (context: TrajectoryCompressorContext) => {
            contexts.push(context);
            return childOutput(propose(context));
        },
        task: compressorTask,
    };
}

/** Verdict a verifier fixture returns. */
export type FixtureVerdict = {
    readonly reason: string;
    readonly score: number;
    readonly verdict: string;
};

/** Verifier accepting exactly when the candidate reaches the original result. */
export function sameResult(context: TrajectoryVerifierContext): FixtureVerdict {
    const same =
        JSON.stringify(context.compressed.terminal?.result) ===
        JSON.stringify(context.original.terminal?.result);
    return same
        ? { reason: "the candidate reaches the original result", score: 1, verdict: "accepted" }
        : { reason: "the candidate result differs", score: 0, verdict: "rejected" };
}

/** Program-serviced verifier returning the given verdict function's result, logging contexts. */
export function verifierOf(
    judge: (context: TrajectoryVerifierContext) => unknown = sameResult,
    contexts: TrajectoryVerifierContext[] = [],
): RunTrajectoryCompressionOptions["verifier"] {
    return {
        budget: { maxTurns: 1 },
        grant: [],
        program: (context: TrajectoryVerifierContext) => {
            contexts.push(context);
            return childOutput(judge(context));
        },
        task: verifierTask,
    };
}

/**
 * Provider-serviced child answering with the canonical JSON text of `answer(evidence)`, where the
 * evidence is parsed from the request input, with a call log.
 */
export function childProvider(
    label: string,
    answer: (evidence: Record<string, unknown>) => unknown,
    costUsd: number | null = 0.1,
): StageProvider {
    const { descriptor } = createStaticProvider({
        descriptor: { id: `provider:${label}`, model: "fixture-v1" },
        exchanges: [],
    });
    const calls: string[] = [];
    return Object.freeze({
        calls,
        descriptor,
        invoke: async (request: ModelRequest) => {
            calls.push(label);
            const evidence = JSON.parse(
                (request.input as Record<string, string>)[fields.input] as string,
            ) as Record<string, unknown>;
            return {
                output: childOutput(answer(evidence)),
                usage: {
                    cacheCreationInputTokens: 0,
                    cacheReadInputTokens: 0,
                    costUsd,
                    inputTokens: 5,
                    outputTokens: 3,
                },
            };
        },
    });
}

/** Root declaration bounding every compressor and verifier child. */
export function rootParent(): ChildRunRootParent {
    return { budget: { maxTurns: 16 }, ceiling: [], kind: "root" };
}

/** Provider-session adapter whose checkpoints are unavailable with a fixed reason. */
export function unavailableSession(reason: string): ReplayProviderSessionAdapter {
    return {
        adapterId: "adapter:unavailable",
        checkpoint: () => ({ reason, status: "unavailable" }),
        restore: () => {
            throw new Error("an unavailable provider session must never be restored");
        },
    };
}

/** Provider-session adapter capturing verified receipts, optionally failing every restore. */
export function verifiedSession(failRestore = false): ReplayProviderSessionAdapter & {
    readonly restores: string[];
} {
    const sessions = new Map<string, string | null>();
    const restores: string[] = [];
    return {
        adapterId: "adapter:verified",
        checkpoint: (context) => {
            const receiptId = `receipt:${context.session_id}:${context.step_count}`;
            sessions.set(receiptId, context.context_prefix_id);
            return { contextPrefixId: context.context_prefix_id, receiptId, status: "verified" };
        },
        restore: (receiptId) => {
            restores.push(receiptId);
            if (failRestore) {
                throw new Error("provider session restore failed");
            }
            return sessions.get(receiptId) ?? null;
        },
        restores,
    };
}

/** Base compression options over the explore workflow and the repository protocol. */
export function compressionOptions(
    commandId: string,
    overrides: Partial<RunTrajectoryCompressionOptions> = {},
): RunTrajectoryCompressionOptions {
    return {
        claimId: "compression",
        clock: () => 5_000,
        commandId,
        compressor: compressorOf(forkAt(1)),
        parent: rootParent(),
        protocol: compressionProtocol(),
        supervisorId: "supervisor:compression",
        verifier: verifierOf(),
        workflow: {
            handlers: notifyHandlers,
            program: exploreWorkflow(),
            programId: "workflow:explore-answer.v1",
            provider: stageProvider("base"),
        },
        ...overrides,
    };
}
