import { readFileSync } from "node:fs";

import type {
    ApplicationEvaluationBinding,
    ApplicationEvaluationExperiment,
    ModelProvider,
} from "../../src/index.ts";
import {
    type RepositoryEvaluation,
    resolveRepositoryEvaluation,
} from "../../tooling/evaluation/harness.ts";

/** Parsed repository research applications configuration. */
export function researchConfiguration(): Record<string, unknown> {
    return JSON.parse(
        readFileSync(
            new URL("../../config/research-applications.config.json", import.meta.url),
            "utf8",
        ),
    ) as Record<string, unknown>;
}

/** The repository evaluation resolved from an optionally mutated configuration. */
export function repositoryEvaluation(
    mutate: (configuration: Record<string, unknown>) => void = () => {},
): RepositoryEvaluation {
    const configuration = researchConfiguration();
    mutate(configuration);
    return resolveRepositoryEvaluation(configuration);
}

/** Raw, unvalidated copy of a definition for mutation. */
export function rawDefinition(evaluation: RepositoryEvaluation): Record<string, unknown> & {
    experiments: Record<string, unknown>[];
    limitations: Record<string, unknown>[];
} {
    return structuredClone(evaluation.definition) as never;
}

/** Binding factory that records every experiment it was asked to bind. */
export function recordingBinder(
    evaluation: RepositoryEvaluation,
    map: (binding: ApplicationEvaluationBinding) => unknown = (binding) => binding,
): ((experiment: ApplicationEvaluationExperiment) => ApplicationEvaluationBinding) & {
    readonly calls: string[];
} {
    const calls: string[] = [];
    return Object.assign(
        (experiment: ApplicationEvaluationExperiment) => {
            calls.push(experiment.id);
            return map(evaluation.bind(experiment)) as ApplicationEvaluationBinding;
        },
        { calls },
    );
}

function refusing(label: string): never {
    throw new Error(`${label} must not run on a repeated evaluation`);
}

type Bag = Readonly<Record<string, unknown>>;

function refusingProvider(provider: unknown): ModelProvider {
    return {
        descriptor: (provider as ModelProvider).descriptor,
        invoke: async () => refusing("provider"),
    };
}

/**
 * Replaces every executable part of a binding (providers, programs, policy, evaluator, reward, and
 * factory) with one that throws, keeping descriptors so static-kind checks still pass.
 */
export function poisoned(binding: ApplicationEvaluationBinding): ApplicationEvaluationBinding {
    const options = binding.options as unknown as Bag;
    const replaced: Record<string, unknown> = { ...options };
    if ("workers" in options) {
        replaced.workers = (options.workers as readonly Bag[]).map((worker) => ({
            ...worker,
            provider: refusingProvider(worker.provider),
        }));
        replaced.policy = () => refusing("policy");
    }
    if ("candidates" in options) {
        const baseline = options.baseline as Bag;
        replaced.baseline = { ...baseline, provider: refusingProvider(baseline.provider) };
        replaced.candidates = (options.candidates as readonly Bag[]).map((candidate) => ({
            ...candidate,
            provider: refusingProvider(candidate.provider),
        }));
        replaced.evaluate = () => refusing("evaluator");
    }
    if ("workflow" in options) {
        const workflow = options.workflow as Bag;
        replaced.workflow = { ...workflow, provider: refusingProvider(workflow.provider) };
        replaced.compressor = {
            ...(options.compressor as object),
            program: () => refusing("compressor"),
        };
        replaced.verifier = {
            ...(options.verifier as object),
            program: () => refusing("verifier"),
        };
    }
    if ("reward" in options) {
        replaced.provider = () => refusing("provider factory");
        replaced.reward = () => refusing("reward");
    }
    const source = (binding as { readonly source?: Bag }).source;
    return {
        ...binding,
        options: replaced,
        ...(source === undefined
            ? {}
            : { source: { ...source, provider: refusingProvider(source.provider) } }),
    } as ApplicationEvaluationBinding;
}
