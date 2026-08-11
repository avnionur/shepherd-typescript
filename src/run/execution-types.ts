import type { ModelProvider, ProviderDescriptor } from "../provider/types.ts";
import type { InferTaskSchema, TaskSchema } from "../task/schema.ts";
import type { TaskDescriptor } from "../task/types.ts";
import type { RunArtifact } from "./artifact-types.ts";
import type { RunBudgetDefinition, RunControlSnapshot } from "./control-types.ts";
import type { RunOutcome } from "./types.ts";
import type { RunUsage } from "./usage-types.ts";

/** Options for one provider-backed bodyless task execution. */
export type TaskExecutionOptions<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>> = {
    /** Resource limits enforced across the execution. */
    readonly budget: RunBudgetDefinition;
    /** Input inferred from and validated by the task input schema. */
    readonly input: InferTaskSchema<I>;
    /** Provider-neutral structured model boundary used for the execution. */
    readonly provider: ModelProvider;
    /** Caller-assigned stable identity for the run records. */
    readonly runId: string;
    /** Optional caller cancellation signal composed into execution control. */
    readonly signal?: AbortSignal;
    /** Immutable bodyless task descriptor to execute. */
    readonly task: TaskDescriptor<I, O>;
};

/** Terminal records and final observable state produced by one task execution. */
export type TaskExecutionResult = {
    /** Immutable ordered side-channel artifacts emitted by the provider. */
    readonly artifacts: readonly RunArtifact[];
    /** Final run-control snapshot captured before internal resource cleanup. */
    readonly control: RunControlSnapshot;
    /** Immutable terminal outcome bound to the exact task artifact lock. */
    readonly outcome: RunOutcome;
    /** Immutable provider identity used for the invocation. */
    readonly provider: ProviderDescriptor;
    /** Aggregate provider usage, or `null` when no provider response was observed. */
    readonly usage: RunUsage | null;
};
