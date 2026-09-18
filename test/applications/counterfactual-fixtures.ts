import { readFileSync } from "node:fs";

import {
    type ApplicationProtocolDefinition,
    type CounterfactualCandidateDefinition,
    type CounterfactualEvaluation,
    type CounterfactualEvaluationContext,
    createStaticProvider,
    type ModelProvider,
    type ModelRequest,
    type ReplaySessionContext,
    type ReplaySessionProgram,
    type RunCounterfactualOptimizationOptions,
    readApplicationProtocol,
    schema,
    task,
} from "../../src/index.ts";

/** Repository Appendix F experiment definition read by the optimizer tests. */
export const counterfactualDefinition = (
    JSON.parse(
        readFileSync(
            new URL("../../config/research-applications.config.json", import.meta.url),
            "utf8",
        ),
    ) as { readonly counterfactual: Record<string, unknown> }
).counterfactual;

/** The repository's Appendix F protocol definition, validated, with optional overrides. */
export function counterfactualProtocol(
    overrides: Record<string, unknown> = {},
): ApplicationProtocolDefinition {
    return readApplicationProtocol({ ...counterfactualDefinition, ...overrides });
}

/** Protocol with the repository budgets replaced by the given ones. */
export function counterfactualProtocolWithBudgets(
    budgets: Record<string, number>,
): ApplicationProtocolDefinition {
    return counterfactualProtocol({
        budgets: { ...(counterfactualDefinition.budgets as Record<string, number>), ...budgets },
    });
}

/** Builds one canonical workflow request for a stage and the output it consumes. */
export function stageRequest(stage: string, prior: unknown, instruction = "perform"): ModelRequest {
    return {
        input: { prior: prior as never, stage },
        instruction: `${instruction} ${stage}`,
        outputSchema: { type: "object" },
    };
}

/** Options of a request-keyed provider. */
export type KeyedProviderOptions = {
    /** Cache-read tokens reported per invocation. */
    readonly cacheRead?: number;
    /** Cost reported per invocation; null reports no cost. */
    readonly costUsd?: number | null;
    /** Stage whose invocation throws. */
    readonly failStage?: string;
};

/** Stateless provider whose output is a pure function of the request, with an invocation log. */
export type KeyedProvider = ModelProvider & { readonly calls: string[] };

/**
 * Builds a stateless provider answering every request with `{ text: "<label>:<stage>" }`, so the
 * same provider can service the baseline and any number of branches.
 */
export function keyedProvider(label: string, options: KeyedProviderOptions = {}): KeyedProvider {
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
            if (stage === options.failStage) {
                throw new Error(`provider ${label} failed at ${stage}`);
            }
            return {
                output: { text: `${label}:${stage}` },
                usage: {
                    cacheCreationInputTokens: 1,
                    cacheReadInputTokens: options.cacheRead ?? 0,
                    costUsd: options.costUsd === undefined ? 0.5 : options.costUsd,
                    inputTokens: 10,
                    outputTokens: 2,
                },
            };
        },
    });
}

/**
 * Workflow: plan (0), independent research (1), draft from the plan (2), review of the draft (3).
 * Dependents: 0 → [2, 3], 1 → [], 2 → [3], 3 → [].
 */
export function workflowProgram(reviewInstruction = "perform"): ReplaySessionProgram {
    return async (context: ReplaySessionContext) => {
        const plan = await context.invokeProvider(stageRequest("plan", null));
        const research = await context.invokeProvider(stageRequest("research", null), {
            dependsOn: [],
        });
        const draft = await context.invokeProvider(stageRequest("draft", plan.response.output), {
            dependsOn: [plan.handle],
        });
        const review = await context.invokeProvider(
            stageRequest("review", draft.response.output, reviewInstruction),
            { dependsOn: [draft.handle] },
        );
        return { research: research.response.output, review: review.response.output };
    };
}

/** Workflow whose first request differs from the baseline's, so it cannot serve the prefix. */
export const mismatchedProgram: ReplaySessionProgram = async (context) => {
    await context.invokeProvider(stageRequest("plan", null, "rewrite"));
    return null;
};

/** Task-driven workflow: plan (0), task step from the plan (1), review of the task output (2). */
export const taskProgram: ReplaySessionProgram = async (context) => {
    const plan = await context.invokeProvider(stageRequest("plan", null));
    const drafted = await context.invokeTask({ dependsOn: [plan.handle] });
    const review = await context.invokeProvider(stageRequest("review", drafted.response.output), {
        dependsOn: [drafted.handle],
    });
    return review.response.output;
};

/** Builds one versioned drafting task with the given instruction. */
export function draftTask(version: string, instruction: string) {
    return {
        descriptor: task({
            input: schema.object({ stage: schema.string() }),
            instruction,
            name: "draft",
            output: schema.object({ text: schema.string() }),
            version,
        }),
        input: { stage: "draft" },
    };
}

/** Evaluator returning scripted verdicts by candidate name and recording every context. */
export function scriptedEvaluator(verdicts: Readonly<Record<string, CounterfactualEvaluation>>): ((
    context: CounterfactualEvaluationContext,
) => CounterfactualEvaluation) & {
    readonly contexts: CounterfactualEvaluationContext[];
} {
    const contexts: CounterfactualEvaluationContext[] = [];
    const evaluate = (context: CounterfactualEvaluationContext): CounterfactualEvaluation => {
        contexts.push(context);
        return verdicts[context.candidate.name] as CounterfactualEvaluation;
    };
    return Object.assign(evaluate, { contexts });
}

/** Passing verdict with a score. */
export function pass(score: number): CounterfactualEvaluation {
    return { passed: true, reason: `passed with ${score}`, score };
}

/** Failing verdict with a score. */
export function fail(score: number): CounterfactualEvaluation {
    return { passed: false, reason: `failed with ${score}`, score };
}

/** Provider-change candidate at one step. */
export function providerCandidate(
    name: string,
    stepIndex: number,
    provider: ModelProvider,
    overrides: Partial<CounterfactualCandidateDefinition> = {},
): CounterfactualCandidateDefinition {
    return { changes: ["provider"], name, provider, stepIndex, ...overrides };
}

/** Base optimizer options over the workflow program and the repository protocol. */
export function optimizerOptions(
    commandId: string,
    overrides: Partial<RunCounterfactualOptimizationOptions> = {},
): RunCounterfactualOptimizationOptions {
    return {
        baseline: {
            program: workflowProgram(),
            programId: "workflow:plan-draft-review.v1",
            provider: keyedProvider("base"),
        },
        candidates: [],
        claimId: "optimizer",
        commandId,
        evaluate: () => pass(1),
        protocol: counterfactualProtocol(),
        ...overrides,
    };
}
