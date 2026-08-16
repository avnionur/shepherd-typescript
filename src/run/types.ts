import type { SemanticValue } from "../canonical/canonical-record.ts";
import type { RUN_TERMINAL_STATUSES } from "../protocol/values.generated.ts";
import type { TaskArtifactLock } from "../task/types.ts";

/** Configured terminal status of one completed run record. */
export type RunTerminalStatus = (typeof RUN_TERMINAL_STATUSES)[number];

/** Successful terminal definition accepted by {@link createRunOutcome}. */
export type FinishedRunDefinition<V extends SemanticValue = SemanticValue> = {
    /** Terminal success discriminant. */
    readonly status: (typeof RUN_TERMINAL_STATUSES)[0];
    /** Canonical task result value. */
    readonly value: V;
};

/** Failed terminal definition accepted by {@link createRunOutcome}. */
export type FailedRunDefinition = {
    /** Stable application or provider error classification. */
    readonly errorType: string;
    /** Inspectable failure description. */
    readonly message: string;
    /** Whether a caller may reasonably retry the run, when known. */
    readonly retryable?: boolean;
    /** Terminal failure discriminant. */
    readonly status: (typeof RUN_TERMINAL_STATUSES)[1];
};

/** Budget-exhausted terminal definition accepted by {@link createRunOutcome}. */
export type ExhaustedRunDefinition = {
    /** Inspectable budget exhaustion explanation. */
    readonly reason: string;
    /** Terminal budget exhaustion discriminant. */
    readonly status: (typeof RUN_TERMINAL_STATUSES)[2];
};

/** Externally cancelled terminal definition accepted by {@link createRunOutcome}. */
export type CancelledRunDefinition = {
    /** Inspectable cancellation explanation. */
    readonly reason: string;
    /** Terminal cancellation discriminant. */
    readonly status: (typeof RUN_TERMINAL_STATUSES)[3];
};

/** One of the four accepted terminal run definitions. */
export type RunTerminalDefinition<V extends SemanticValue = SemanticValue> =
    | CancelledRunDefinition
    | ExhaustedRunDefinition
    | FailedRunDefinition
    | FinishedRunDefinition<V>;

/** Definition accepted by {@link createRunOutcome}. */
export type RunOutcomeDefinition<O extends RunTerminalDefinition = RunTerminalDefinition> = {
    /** Exactly one terminal result for the run. */
    readonly outcome: O;
    /** Caller-assigned stable run identity. */
    readonly runId: string;
    /** Exact immutable task revision executed by the run. */
    readonly taskArtifactLock: TaskArtifactLock;
};

/** Successful immutable terminal run value. */
export type FinishedRunOutcome<V extends SemanticValue = SemanticValue> = {
    /** Terminal success discriminant. */
    readonly status: (typeof RUN_TERMINAL_STATUSES)[0];
    /** Canonical task result value. */
    readonly value: V;
};

/** Failed immutable terminal run value. */
export type FailedRunOutcome = {
    /** Stable application or provider error classification. */
    readonly error_type: string;
    /** Inspectable failure description. */
    readonly message: string;
    /** Retry guidance, or `null` when the runtime cannot classify retryability. */
    readonly retryable: boolean | null;
    /** Terminal failure discriminant. */
    readonly status: (typeof RUN_TERMINAL_STATUSES)[1];
};

/** Budget-exhausted immutable terminal run value. */
export type ExhaustedRunOutcome = {
    /** Inspectable budget exhaustion explanation. */
    readonly reason: string;
    /** Terminal budget exhaustion discriminant. */
    readonly status: (typeof RUN_TERMINAL_STATUSES)[2];
};

/** Externally cancelled immutable terminal run value. */
export type CancelledRunOutcome = {
    /** Inspectable cancellation explanation. */
    readonly reason: string;
    /** Terminal cancellation discriminant. */
    readonly status: (typeof RUN_TERMINAL_STATUSES)[3];
};

/** One immutable terminal run value. */
export type RunTerminalOutcome<V extends SemanticValue = SemanticValue> =
    | CancelledRunOutcome
    | ExhaustedRunOutcome
    | FailedRunOutcome
    | FinishedRunOutcome<V>;

/** Immutable versioned record for exactly one terminal task-run result. */
export type RunOutcome<O extends RunTerminalOutcome = RunTerminalOutcome> = {
    /** Configured run-outcome wire version. */
    readonly outcome_version: number;
    /** Exactly one inspectable terminal result. */
    readonly outcome: O;
    /** Caller-assigned stable run identity. */
    readonly run_id: string;
    /** Exact immutable task revision executed by the run. */
    readonly task_artifact_lock: TaskArtifactLock;
};

/** Maps an accepted terminal definition to its exact immutable wire outcome. */
export type RunOutcomeFor<O extends RunTerminalDefinition> = RunOutcome<
    O extends FinishedRunDefinition<infer V>
        ? FinishedRunOutcome<V>
        : O extends FailedRunDefinition
          ? FailedRunOutcome
          : O extends ExhaustedRunDefinition
            ? ExhaustedRunOutcome
            : CancelledRunOutcome
>;
