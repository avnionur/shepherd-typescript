import { readFileSync } from "node:fs";

import {
    type ApplicationProtocolDefinition,
    type CounterfactualDataset,
    type CounterfactualEdit,
    type CounterfactualEditApplication,
    type CounterfactualEditContext,
    type CounterfactualMetricContext,
    type CounterfactualProposal,
    type CounterfactualProposer,
    type CounterfactualProposerContext,
    createStaticProvider,
    type ModelProvider,
    type ModelRequest,
    type ReplaySessionContext,
    type ReplaySessionProgram,
    type RunCounterfactualOptimizationOptions,
    readApplicationProtocol,
    type SemanticValue,
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

/** Protocol with the repository budgets and thresholds replaced by the given ones. */
export function counterfactualProtocolWith(
    budgets: Record<string, number>,
    thresholds: Record<string, number> = {},
): ApplicationProtocolDefinition {
    return counterfactualProtocol({
        budgets: { ...(counterfactualDefinition.budgets as Record<string, number>), ...budgets },
        thresholds: {
            ...(counterfactualDefinition.thresholds as Record<string, number>),
            ...thresholds,
        },
    });
}

/** Train then dev example identities of the repository protocol's dataset items. */
export const TRAIN = ["train-1", "train-2", "train-3", "train-4"] as const;
/** Dev example identities of the repository protocol's dataset items. */
export const DEV = ["dev-1", "dev-2"] as const;

/** The repository dataset: every example's input is its identity. */
export const dataset: CounterfactualDataset = {
    dev: DEV.map((id) => ({ id, input: id })),
    train: TRAIN.map((id) => ({ id, input: id })),
};

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
    return { review: review.response.output };
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

/** Score table by provider label of the final review output, then example identity. */
export type ScoreTable = Readonly<Record<string, Readonly<Record<string, number>>>>;

/** Metric reading the review label and scoring it from a table; unlisted pairs score zero. */
export function labelMetric(scores: ScoreTable): ((
    context: CounterfactualMetricContext,
) => number) & {
    readonly contexts: CounterfactualMetricContext[];
} {
    const contexts: CounterfactualMetricContext[] = [];
    const metric = (context: CounterfactualMetricContext): number => {
        contexts.push(context);
        const result = context.session.terminal?.result?.value as {
            readonly review?: { readonly text: string };
        } | null;
        const [label] = (result?.review?.text ?? "").split(":");
        return scores[label as string]?.[context.example.id] ?? 0;
    };
    return Object.assign(metric, { contexts });
}

/** Registry of keyed providers by label, so every edit naming a label shares one provider. */
export function providerRegistry(options: Readonly<Record<string, KeyedProviderOptions>> = {}): {
    readonly get: (label: string) => KeyedProvider;
    readonly providers: Map<string, KeyedProvider>;
} {
    const providers = new Map<string, KeyedProvider>();
    return {
        get: (label) => {
            const existing = providers.get(label);
            if (existing !== undefined) {
                return existing;
            }
            const created = keyedProvider(label, options[label] ?? {});
            providers.set(label, created);
            return created;
        },
        providers,
    };
}

/**
 * Edit applier: a `provider` change swaps in the registry provider named by the patch; a `task`
 * change swaps in the patch's draft task; a `handlers` change uses the given stack; a patch with a
 * `program` key swaps in the named program.
 */
export function applyFixtureEdit(
    registry: ReturnType<typeof providerRegistry>,
    extras: {
        readonly handlers?: CounterfactualEditApplication["handlers"];
        readonly programs?: Readonly<Record<string, ReplaySessionProgram>>;
    } = {},
): (context: CounterfactualEditContext) => CounterfactualEditApplication {
    return ({ edit }) => {
        const patch = (edit.patch ?? {}) as Readonly<Record<string, string>>;
        const program = patch.program === undefined ? undefined : extras.programs?.[patch.program];
        return {
            ...(edit.changes.includes("provider")
                ? { provider: registry.get(patch.provider as string) }
                : {}),
            ...(edit.changes.includes("task")
                ? {
                      task: () => draftTask(patch.version as string, patch.instruction as string),
                  }
                : {}),
            ...(edit.changes.includes("handlers") && extras.handlers !== undefined
                ? { handlers: extras.handlers }
                : {}),
            ...(program === undefined ? {} : { program: () => program }),
        };
    };
}

/** Builds one provider edit whose patch names the provider label. */
export function providerEdit(
    name: string,
    stepIndex: number,
    label: string,
    overrides: Partial<CounterfactualEdit> = {},
): CounterfactualEdit {
    return {
        changes: ["provider"],
        fix_set: ["train-1"],
        guard_set: [],
        mechanism: `${name} mechanism`,
        name,
        patch: { provider: label },
        prior: 0.1,
        rationale: `${name} rationale`,
        scope: "request",
        step_index: stepIndex,
        ...overrides,
    };
}

/** Reflection naming the parent, citing findings, and enumerating the configured floor. */
export function reflection(
    parent: string | null,
    findings: readonly string[] = ["baseline traces fail train-1"],
    mechanisms = 12,
): SemanticValue {
    return {
        findings: [...findings],
        hypotheses: Array.from({ length: mechanisms }, (_, index) => ({
            mechanism: `considered mechanism ${index}`,
            prior: (index + 1) / (mechanisms + 1),
        })),
        parent,
    };
}

/** One scripted proposer iteration: a proposal or a function of the context. */
export type ScriptedAttempt =
    | CounterfactualProposal
    | ((context: CounterfactualProposerContext) => CounterfactualProposal);

/**
 * Scripted caller proposer answering attempt `a` of iteration `i` with `iterations[i][a]`, and
 * recording every context it received.
 */
export function scriptedProposer(
    iterations: readonly (readonly ScriptedAttempt[])[],
): CounterfactualProposer & {
    readonly contexts: CounterfactualProposerContext[];
} {
    const contexts: CounterfactualProposerContext[] = [];
    const proposer: CounterfactualProposer = (context) => {
        contexts.push(context);
        const attempt = iterations[context.iteration]?.[context.attempt];
        if (attempt === undefined) {
            throw new Error(
                `no scripted attempt ${context.attempt} of iteration ${context.iteration}`,
            );
        }
        return typeof attempt === "function" ? attempt(context) : attempt;
    };
    return Object.assign(proposer, { contexts });
}

/** One-iteration proposal from the baseline with the given edits. */
export function baselineProposal(edits: readonly CounterfactualEdit[]): CounterfactualProposal {
    return { edits, parent: null, reflection: reflection(null) };
}

/** Base optimizer options over the workflow program and the repository protocol. */
export function optimizerOptions(
    commandId: string,
    overrides: Partial<RunCounterfactualOptimizationOptions> = {},
    registry = providerRegistry(),
): RunCounterfactualOptimizationOptions {
    const program = workflowProgram();
    return {
        applyEdit: applyFixtureEdit(registry),
        baseline: {
            program: () => program,
            programId: "workflow:plan-draft-review.v1",
            provider: registry.get("base"),
        },
        claimId: "optimizer",
        commandId,
        dataset,
        metric: labelMetric({}),
        proposer: scriptedProposer([]),
        protocol: counterfactualProtocolWith({ iterations: 1 }),
        ...overrides,
    };
}
