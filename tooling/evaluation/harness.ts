import {
    APPLICATION_KINDS,
    APPLICATION_SUPERVISION_POLICY_KINDS,
    type ApplicationEvaluationBinding,
    type ApplicationEvaluationDefinition,
    type ApplicationEvaluationExperiment,
    type CodingSupervisorWorkerDefinition,
    createStaticProvider,
    DELEGATION_PARENT_KINDS,
    type ModelProvider,
    type ModelRequest,
    type ModelResponse,
    type ModelUsage,
    REPLAY_CHANGE_DIMENSIONS,
    type ReplaySessionContext,
    type ReplaySessionProgram,
    type ReplayStepHandle,
    type StaticProviderExchange,
    schema,
    type TrajectoryCompressionGuidance,
    type TrajectoryCompressionProgram,
    type TrajectoryCompressorContext,
    type TrajectoryVerifierContext,
    task,
} from "../../src/index.ts";
import { applicationsProtocolConfig } from "../../src/protocol/config.ts";

/** One workflow stage: its name, the stage whose output it consumes, and whether a hint skips it. */
type Stage = {
    readonly dependsOn: number | null;
    readonly skippable?: boolean;
    readonly stage: string;
};

/** Versioned task descriptor fields. */
type TaskFields = {
    readonly instruction: string;
    readonly name: string;
    readonly version: string;
};

/** Configured verdict of a program-serviced verifier or evaluator. */
type Verdict = {
    readonly passed?: boolean;
    readonly reason: string;
    readonly score: number;
    readonly verdict?: string;
};

type SupervisorFixture = {
    readonly acceptWorker: string;
    readonly observeRounds: number;
    readonly parentBudget: Readonly<Record<string, number>>;
    readonly supervisorId: string;
    readonly task: TaskFields;
    readonly workers: readonly {
        readonly budget: Readonly<Record<string, number>>;
        readonly text: string;
        readonly workerId: string;
    }[];
};

type OptimizerFixture = {
    readonly baselineLabel: string;
    readonly candidates: readonly {
        readonly label: string;
        readonly name: string;
        readonly stepIndex: number;
        readonly verdict: Verdict;
    }[];
    readonly claimId: string;
    readonly programId: string;
    readonly stages: readonly Stage[];
};

type CompressionFixture = {
    readonly childBudget: Readonly<Record<string, number>>;
    readonly claimId: string;
    readonly compressorTask: TaskFields;
    readonly forkStepIndex: number;
    readonly hint: { readonly citedStepIndices: readonly number[]; readonly text: string };
    readonly label: string;
    readonly parentBudget: Readonly<Record<string, number>>;
    readonly programId: string;
    readonly stages: readonly Stage[];
    readonly supervisorId: string;
    readonly verdicts: { readonly accepted: Verdict; readonly rejected: Verdict };
    readonly verifierTask: TaskFields;
};

type TreeRlFixture = {
    readonly claimId: string;
    readonly programId: string;
    readonly rewards: Readonly<Record<string, number>>;
    readonly seedLabelPrefix: string;
    readonly sourceClaimId: string;
    readonly sourceLabel: string;
    readonly stages: readonly Stage[];
};

/** Repository evaluation section of `config/research-applications.config.json`. */
export type RepositoryEvaluationConfig = {
    /** Repository-relative generated artifact destinations. */
    readonly artifacts: {
        /** Normative documentation page the generated page links to. */
        readonly documentation: string;
        /** Human-readable generated page. */
        readonly page: string;
        /** Digest-bearing JSON report. */
        readonly report: string;
    };
    /** Evaluation definition whose experiments name a protocol section of the configuration. */
    readonly definition: Omit<ApplicationEvaluationDefinition, "experiments"> & {
        readonly experiments: readonly (Omit<ApplicationEvaluationExperiment, "protocol"> & {
            readonly protocol: string;
        })[];
    };
    /** Executable fixture data by experiment identity. */
    readonly fixtures: Readonly<Record<string, unknown>>;
    /** Model identity and per-call usage every fixture provider reports. */
    readonly provider: {
        readonly instruction: string;
        readonly model: string;
        readonly usage: ModelUsage;
    };
};

/** Repository evaluation definition, artifact destinations, and binding factory. */
export type RepositoryEvaluation = {
    /** Repository-relative generated artifact destinations. */
    readonly artifacts: RepositoryEvaluationConfig["artifacts"];
    /** Factory returning fresh executable bindings for one evaluation run. */
    readonly bind: (experiment: ApplicationEvaluationExperiment) => ApplicationEvaluationBinding;
    /** Evaluation definition with every protocol resolved from the configuration. */
    readonly definition: ApplicationEvaluationDefinition;
};

const fields = applicationsProtocolConfig.compression.childFields;
const [SUPERVISOR_KIND, OPTIMIZER_KIND, COMPRESSION_KIND, TREE_RL_KIND] = APPLICATION_KINDS;
const [OBSERVE, , , , ACCEPT] = APPLICATION_SUPERVISION_POLICY_KINDS;
const [ROOT_PARENT] = DELEGATION_PARENT_KINDS;
const [, PROVIDER_CHANGE] = REPLAY_CHANGE_DIMENSIONS;

/**
 * Resolves the repository evaluation from the parsed research applications configuration.
 *
 * Each experiment's `protocol` names a top-level protocol section of the configuration; its
 * fixture data builds offline static providers, deterministic programs, the supervisor policy, the
 * optimizer evaluator, the compression children, and the Tree-RL reward. Every call to `bind`
 * returns fresh providers, so one resolved evaluation can run against any number of stores.
 *
 * @param configuration - Parsed `config/research-applications.config.json`.
 * @returns The definition, the binding factory, and the artifact destinations; an experiment naming
 * an absent protocol section is refused by the evaluation runner.
 */
export function resolveRepositoryEvaluation(
    configuration: Readonly<Record<string, unknown>>,
): RepositoryEvaluation {
    const evaluation = configuration.evaluation as RepositoryEvaluationConfig;
    const definition = {
        ...evaluation.definition,
        experiments: evaluation.definition.experiments.map((experiment) => ({
            ...experiment,
            protocol: configuration[experiment.protocol],
        })) as unknown as readonly ApplicationEvaluationExperiment[],
    };
    const kit = providerKit(evaluation.provider);
    const builders: Readonly<
        Record<string, (fixture: never, experiment: ApplicationEvaluationExperiment) => unknown>
    > = {
        [SUPERVISOR_KIND]: (fixture: SupervisorFixture, experiment) =>
            supervisorBinding(fixture, experiment, kit),
        [OPTIMIZER_KIND]: (fixture: OptimizerFixture) => optimizerBinding(fixture, kit),
        [COMPRESSION_KIND]: (fixture: CompressionFixture) => compressionBinding(fixture, kit),
        [TREE_RL_KIND]: (fixture: TreeRlFixture) => treeRlBinding(fixture, kit),
    };
    return {
        artifacts: evaluation.artifacts,
        bind: (experiment) =>
            (builders[experiment.protocol.kind] as (typeof builders)[string])(
                evaluation.fixtures[experiment.id] as never,
                experiment,
            ) as ApplicationEvaluationBinding,
        definition,
    };
}

type ProviderKit = {
    readonly cassette: (
        stages: readonly Stage[],
        prefixLabel: string,
        label: string,
        from: number,
        id: string,
    ) => ModelProvider;
    readonly keyed: (id: string, answer: (request: ModelRequest) => unknown) => ModelProvider;
    readonly request: (stage: string, prior: unknown) => ModelRequest;
    readonly response: (label: string, stage: string) => ModelResponse;
};

function providerKit(provider: RepositoryEvaluationConfig["provider"]): ProviderKit {
    const request = (stage: string, prior: unknown): ModelRequest => ({
        input: { prior: prior as never, stage },
        instruction: `${provider.instruction} ${stage}`,
        outputSchema: { type: "object" },
    });
    const response = (label: string, stage: string): ModelResponse => ({
        output: { text: `${label}:${stage}` },
        usage: provider.usage,
    });
    return {
        cassette: (stages, prefixLabel, label, from, id) => {
            const outputs: unknown[] = [];
            const exchanges: StaticProviderExchange[] = [];
            for (const [index, { dependsOn, stage }] of stages.entries()) {
                const answer = response(index < from ? prefixLabel : label, stage);
                if (index >= from) {
                    exchanges.push({
                        request: request(stage, dependsOn === null ? null : outputs[dependsOn]),
                        response: answer,
                    });
                }
                outputs.push(answer.output);
            }
            return createStaticProvider({
                descriptor: { id: `provider:${id}`, model: provider.model },
                exchanges,
            });
        },
        keyed: (id, answer) => {
            const { descriptor } = createStaticProvider({
                descriptor: { id: `provider:${id}`, model: provider.model },
                exchanges: [],
            });
            return Object.freeze({
                descriptor,
                invoke: async (modelRequest: ModelRequest) => ({
                    output: answer(modelRequest) as never,
                    usage: provider.usage,
                }),
            });
        },
        request,
        response,
    };
}

/**
 * Deterministic stage workflow. Under a guidance with a hint, skippable stages at or after the fork
 * point are not issued, so a stage that depends only on unskipped stages is reached in fewer steps.
 */
function stageWorkflow(
    stages: readonly Stage[],
    kit: ProviderKit,
    guidance: TrajectoryCompressionGuidance | null = null,
): ReplaySessionProgram {
    return async (context: ReplaySessionContext) => {
        const outputs: unknown[] = [];
        const handles: ReplayStepHandle[] = [];
        for (const { dependsOn, skippable, stage } of stages) {
            if (
                skippable === true &&
                guidance?.hint != null &&
                context.step_count >= guidance.fork_point.step_index
            ) {
                outputs.push(null);
                handles.push(null as never);
                continue;
            }
            const step = await context.invokeProvider(
                kit.request(stage, dependsOn === null ? null : outputs[dependsOn]),
                { dependsOn: dependsOn === null ? [] : [handles[dependsOn] as ReplayStepHandle] },
            );
            outputs.push(step.response.output);
            handles.push(step.handle);
        }
        return outputs.at(-1) as never;
    };
}

function descriptorOf(
    fields: TaskFields,
    input: Record<string, unknown>,
    output: Record<string, unknown>,
) {
    return task({
        input: schema.object(input as never),
        instruction: fields.instruction,
        name: fields.name,
        output: schema.object(output as never),
        version: fields.version,
    });
}

function supervisorBinding(
    fixture: SupervisorFixture,
    experiment: ApplicationEvaluationExperiment,
    kit: ProviderKit,
): ApplicationEvaluationBinding {
    const [path] = experiment.protocol.dataset.items as readonly string[];
    const editTask = descriptorOf(
        fixture.task,
        { path: schema.string(), text: schema.string() },
        { path: schema.string(), text: schema.string() },
    );
    const workers: CodingSupervisorWorkerDefinition[] = fixture.workers.map((worker) => ({
        budget: worker.budget,
        grant: [],
        input: { path, text: worker.text },
        provider: kit.keyed(`worker:${worker.workerId}`, () => ({ path, text: worker.text })),
        task: editTask,
        workerId: worker.workerId,
    }));
    return {
        kind: SUPERVISOR_KIND,
        options: {
            changedPaths: ({ output }) => [(output as { readonly path: string }).path],
            parent: { budget: fixture.parentBudget, ceiling: [], kind: ROOT_PARENT },
            policy: ({ round }) =>
                round <= fixture.observeRounds
                    ? { kind: OBSERVE }
                    : { kind: ACCEPT, worker_id: fixture.acceptWorker },
            supervisorId: fixture.supervisorId,
            workers,
        },
    };
}

function optimizerBinding(
    fixture: OptimizerFixture,
    kit: ProviderKit,
): ApplicationEvaluationBinding {
    const keyedStage = (label: string) =>
        kit.keyed(
            label,
            (request) => kit.response(label, (request.input as { stage: string }).stage).output,
        );
    const verdicts = new Map(
        fixture.candidates.map((candidate) => [candidate.name, candidate.verdict]),
    );
    return {
        kind: OPTIMIZER_KIND,
        options: {
            baseline: {
                program: stageWorkflow(fixture.stages, kit),
                programId: fixture.programId,
                provider: keyedStage(fixture.baselineLabel),
            },
            candidates: fixture.candidates.map((candidate) => ({
                changes: [PROVIDER_CHANGE],
                name: candidate.name,
                provider: keyedStage(candidate.label),
                stepIndex: candidate.stepIndex,
            })),
            claimId: fixture.claimId,
            evaluate: ({ candidate }) => {
                const verdict = verdicts.get(candidate.name) as Verdict;
                return {
                    passed: verdict.passed === true,
                    reason: verdict.reason,
                    score: verdict.score,
                };
            },
        },
    };
}

function compressionBinding(
    fixture: CompressionFixture,
    kit: ProviderKit,
): ApplicationEvaluationBinding {
    const childText = (value: unknown) => ({ [fields.output]: JSON.stringify(value) });
    const text = { [fields.input]: schema.string() };
    const output = { [fields.output]: schema.string() };
    const child = <Program>(taskFields: TaskFields, program: Program) => ({
        budget: fixture.childBudget,
        grant: [],
        program,
        task: descriptorOf(taskFields, text, output),
    });
    const program: TrajectoryCompressionProgram = (guidance) =>
        stageWorkflow(fixture.stages, kit, guidance);
    return {
        kind: COMPRESSION_KIND,
        options: {
            claimId: fixture.claimId,
            compressor: child(fixture.compressorTask, ({ source }: TrajectoryCompressorContext) =>
                childText({
                    fork_point: {
                        prefix_id: source.steps[fixture.forkStepIndex - 1]?.prefix_id,
                        session_id: source.session_id,
                        step_index: fixture.forkStepIndex,
                    },
                    hint: {
                        cited_step_indices: fixture.hint.citedStepIndices,
                        text: fixture.hint.text,
                    },
                }),
            ),
            parent: { budget: fixture.parentBudget, ceiling: [], kind: ROOT_PARENT },
            supervisorId: fixture.supervisorId,
            verifier: child(
                fixture.verifierTask,
                ({ compressed, original }: TrajectoryVerifierContext) => {
                    const same =
                        JSON.stringify(compressed.terminal?.result) ===
                        JSON.stringify(original.terminal?.result);
                    const { reason, score, verdict } = same
                        ? fixture.verdicts.accepted
                        : fixture.verdicts.rejected;
                    return childText({ reason, score, verdict });
                },
            ),
            workflow: {
                program,
                programId: fixture.programId,
                provider: kit.keyed(
                    fixture.label,
                    (request) =>
                        kit.response(fixture.label, (request.input as { stage: string }).stage)
                            .output,
                ),
            },
        },
    };
}

function treeRlBinding(fixture: TreeRlFixture, kit: ProviderKit): ApplicationEvaluationBinding {
    const program = stageWorkflow(fixture.stages, kit);
    return {
        kind: TREE_RL_KIND,
        options: {
            claimId: fixture.claimId,
            program,
            provider: ({ fork_point, seed }) =>
                kit.cassette(
                    fixture.stages,
                    fixture.sourceLabel,
                    `${fixture.seedLabelPrefix}${seed}`,
                    fork_point.step_index,
                    `${fixture.seedLabelPrefix}${seed}:${fork_point.step_index}`,
                ),
            reward: ({ fork_point, seed }) =>
                fixture.rewards[`${fork_point.step_index}:${seed}`] as number,
        },
        source: {
            claimId: fixture.sourceClaimId,
            program,
            programId: fixture.programId,
            provider: kit.cassette(
                fixture.stages,
                fixture.sourceLabel,
                fixture.sourceLabel,
                0,
                fixture.sourceLabel,
            ),
        },
    };
}
