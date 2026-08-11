import type {
    DURABLE_EXECUTION_CONTROL_COMMAND_KINDS,
    RUN_CONTINUATION_CONSTITUENT_KINDS,
    RUN_CONTINUATION_EVIDENCE_STATUSES,
} from "../protocol/values.generated.ts";
import type { RecordId } from "../record/types.ts";
import type { TaskSchema } from "../task/schema.ts";
import type { DurableTaskExecutionResult } from "./durable-execution-types.ts";
import type { TaskExecutionOptions } from "./execution-types.ts";

/** Canonical semantic body retained for one durable recovery command. */
export type DurableExecutionRecoveryCommand = {
    /** Caller-supplied globally idempotent command identity. */
    readonly command_id: string;
    /** Configured durable control-command discriminant. */
    readonly command_kind: (typeof DURABLE_EXECUTION_CONTROL_COMMAND_KINDS)[0];
    /** Existing durable run to recover. */
    readonly execution_id: string;
};

/** Canonical semantic body retained for one durable pause request. */
export type DurableExecutionPauseCommand = {
    /** Caller-supplied globally idempotent command identity. */
    readonly command_id: string;
    /** Configured durable pause-command discriminant. */
    readonly command_kind: (typeof DURABLE_EXECUTION_CONTROL_COMMAND_KINDS)[1];
    /** Durable run whose running lifecycle is targeted. */
    readonly execution_id: string;
    /** Exact running lifecycle record expected by the caller. */
    readonly expected_lifecycle_record_id: RecordId;
    /** Exact current invocation fencing token. */
    readonly fencing_token: number;
    /** Non-empty operator or controller reason. */
    readonly reason: string;
};

/** Canonical semantic body retained for one durable resume command. */
export type DurableExecutionResumeCommand = {
    /** Caller-supplied globally idempotent command identity. */
    readonly command_id: string;
    /** Configured durable resume-command discriminant. */
    readonly command_kind: (typeof DURABLE_EXECUTION_CONTROL_COMMAND_KINDS)[2];
    /** Exact continuation descriptor authorizing restoration. */
    readonly continuation_descriptor_id: RecordId;
    /** Durable run whose suspended lifecycle is targeted. */
    readonly execution_id: string;
    /** Exact suspension acknowledgement expected by the caller. */
    readonly expected_lifecycle_record_id: RecordId;
};

/** Canonical semantic body retained for one durable cancellation request. */
export type DurableExecutionCancellationCommand = {
    /** Caller-supplied globally idempotent command identity. */
    readonly command_id: string;
    /** Configured durable cancellation-command discriminant. */
    readonly command_kind: (typeof DURABLE_EXECUTION_CONTROL_COMMAND_KINDS)[3];
    /** Durable run whose running lifecycle is targeted. */
    readonly execution_id: string;
    /** Exact running lifecycle record expected by the caller. */
    readonly expected_lifecycle_record_id: RecordId;
    /** Exact current invocation fencing token. */
    readonly fencing_token: number;
    /** Non-empty operator or controller reason. */
    readonly reason: string;
};

/** Options for retaining one globally idempotent durable cancellation request. */
export type DurableTaskCancellationOptions = {
    /** Stable identity reused for every retry of this exact cancellation request. */
    readonly commandId: string;
    /** Exact running lifecycle record expected by the caller. */
    readonly expectedLifecycleRecordId: RecordId;
    /** Exact current invocation fencing token. */
    readonly fencingToken: number;
    /** Non-empty operator or controller reason. */
    readonly reason: string;
    /** Durable run whose running lifecycle is targeted. */
    readonly runId: string;
};

/** Stable canonical evidence retained for one durable cancellation request. */
export type DurableTaskCancellationCommandReceipt = {
    /** Caller-supplied globally idempotent command identity. */
    readonly command_id: string;
    /** Canonical cancellation-command record identity. */
    readonly record_id: RecordId;
};

/** Options for acknowledging cancellation at the exact current worker safe boundary. */
export type DurableTaskCancellationAcknowledgementOptions = {
    /** Retained cancellation command authorizing terminalization. */
    readonly cancelCommandRecordId: RecordId;
    /** Exact current worker claim identity. */
    readonly claimId: string;
    /** Exact running lifecycle record expected by the worker. */
    readonly expectedLifecycleRecordId: RecordId;
    /** Exact current invocation fencing token. */
    readonly fencingToken: number;
    /** Durable run whose worker reached the safe boundary. */
    readonly runId: string;
};

/** Options for retaining one globally idempotent durable pause request. */
export type DurableTaskPauseOptions = {
    /** Stable identity reused for every retry of this exact pause request. */
    readonly commandId: string;
    /** Exact running lifecycle record expected by the caller. */
    readonly expectedLifecycleRecordId: RecordId;
    /** Exact current invocation fencing token. */
    readonly fencingToken: number;
    /** Non-empty operator or controller reason. */
    readonly reason: string;
    /** Durable run whose running lifecycle is targeted. */
    readonly runId: string;
};

/** Stable canonical evidence retained for one durable pause request. */
export type DurableTaskPauseCommandReceipt = {
    /** Caller-supplied globally idempotent command identity. */
    readonly command_id: string;
    /** Canonical pause-command record identity. */
    readonly record_id: RecordId;
};

/** Configured continuation constituent classified by a checkpoint adapter. */
export type RunContinuationCheckpointEvidence = {
    /** Configured continuation constituent kind. */
    readonly kind: (typeof RUN_CONTINUATION_CONSTITUENT_KINDS)[number];
    /** Content-addressed or otherwise stable receipt identity for verified evidence. */
    readonly receipt_id?: string;
    /** Configured evidence classification. */
    readonly status: (typeof RUN_CONTINUATION_EVIDENCE_STATUSES)[number];
};

/** Immutable context presented to each continuation checkpoint adapter. */
export type RunContinuationCheckpointContext = {
    /** Exact current running lifecycle record. */
    readonly expected_lifecycle_record_id: RecordId;
    /** Durable run being checkpointed. */
    readonly run_id: string;
    /** Stable immutable cut identity selected for the safe boundary. */
    readonly trace_cut_id: string;
};

/** Adapter for one configured continuation constituent at a proven safe boundary. */
export type RunContinuationCheckpointAdapter = {
    /** Configured constituent owned by this adapter. */
    readonly kind: (typeof RUN_CONTINUATION_CONSTITUENT_KINDS)[number];
    /**
     * Captures or classifies this constituent without publishing lifecycle acknowledgement.
     *
     * @param context - Exact run, running head, and proposed trace cut.
     * @returns Stable evidence that can be retried without rerunning the adapter.
     */
    readonly checkpoint: (
        context: RunContinuationCheckpointContext,
    ) => Promise<RunContinuationCheckpointEvidence>;
};

/** Options for collecting every configured continuation constituent at a safe boundary. */
export type RunContinuationCheckpointOptions = {
    /** One adapter for every configured constituent, in configured order. */
    readonly adapters: readonly RunContinuationCheckpointAdapter[];
    /** Exact current running lifecycle record. */
    readonly expectedLifecycleRecordId: RecordId;
    /** Durable run being checkpointed. */
    readonly runId: string;
    /** Stable immutable cut identity selected for the safe boundary. */
    readonly traceCutId: string;
};

/** Options for atomically acknowledging command-authorized durable suspension. */
export type DurableTaskSuspensionOptions = {
    /** Exact checkpoint evidence previously returned by the configured adapters. */
    readonly constituents: readonly RunContinuationCheckpointEvidence[];
    /** Exact current running lifecycle record. */
    readonly expectedLifecycleRecordId: RecordId;
    /** Exact current invocation fencing token. */
    readonly fencingToken: number;
    /** Retained pause command authorizing this suspension. */
    readonly pauseCommandRecordId: RecordId;
    /** Durable run whose worker reached the safe boundary. */
    readonly runId: string;
    /** Stable immutable cut identity through the running boundary. */
    readonly traceCutId: string;
};

/** Canonical descriptor and acknowledgement retained for one suspended run. */
export type DurableTaskSuspensionReceipt = {
    /** Canonical suspension-acknowledgement record identity. */
    readonly acknowledgement_record_id: RecordId;
    /** Canonical continuation-descriptor record identity. */
    readonly continuation_descriptor_record_id: RecordId;
    /** Stable immutable cut identity cited by the continuation descriptor. */
    readonly trace_cut_id: string;
};

/** Options for atomically resuming one exactly suspended durable task. */
export type DurableTaskResumeOptions = {
    /** Stable identity reused for every retry of this exact resume request. */
    readonly commandId: string;
    /** Exact continuation descriptor cited by the suspension acknowledgement. */
    readonly continuationDescriptorRecordId: RecordId;
    /** Exact suspension acknowledgement expected as the lifecycle head. */
    readonly expectedLifecycleRecordId: RecordId;
    /** Durable run being resumed. */
    readonly runId: string;
};

/** Canonical command, running acknowledgement, and new worker authority for a resumed run. */
export type DurableTaskResumeReceipt = {
    /** Deterministic worker claim identity bound to the resume command. */
    readonly claim_id: string;
    /** Canonical resume-command record identity. */
    readonly command_record_id: RecordId;
    /** New monotonic invocation fencing token. */
    readonly fencing_token: number;
    /** Unix time when the new worker lease expires. */
    readonly lease_expires_at: number;
    /** Canonical running-continuation acknowledgement identity. */
    readonly running_record_id: RecordId;
};

/** Stable canonical evidence retained for one durable recovery command. */
export type DurableExecutionRecoveryCommandReceipt = {
    /** Caller-supplied globally idempotent command identity. */
    readonly command_id: string;
    /** Canonical control-command record identity. */
    readonly record_id: RecordId;
};

/** Options for one idempotent durable task-recovery command. */
export type DurableTaskRecoveryOptions<
    I extends TaskSchema<unknown>,
    O extends TaskSchema<unknown>,
> = {
    /** Stable identity reused for every retry of this exact recovery request. */
    readonly commandId: string;
    /** Exact task execution contract whose retained creation evidence must already exist. */
    readonly execution: TaskExecutionOptions<I, O>;
};

/** Recovered durable result paired with its canonical control-command evidence. */
export type DurableTaskRecoveryResult = {
    /** Retained idempotent recovery-command evidence. */
    readonly command: DurableExecutionRecoveryCommandReceipt;
    /** Reconstructed or newly completed durable task execution. */
    readonly result: DurableTaskExecutionResult;
};
