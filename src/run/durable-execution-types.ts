import type { DURABLE_EXECUTION_RECOVERY_STATUSES } from "../protocol/values.generated.ts";
import type { RecordId } from "../record/types.ts";
import type { Cut } from "../store/types.ts";
import type { TaskExecutionResult } from "./execution-types.ts";

/** Durable trace evidence retained for one task execution. */
export type TaskExecutionLedgerReceipt = {
    /** Retained ordered artifact-record identities. */
    readonly artifact_record_ids: readonly RecordId[];
    /** Immutable cut ending at the retained lifecycle terminal. */
    readonly cut: Cut;
    /** Retained creation-record identity. */
    readonly created_record_id: RecordId;
    /** Retained terminal lifecycle-record identity. */
    readonly lifecycle_record_id: RecordId;
    /** Retained exact run-outcome-record identity. */
    readonly outcome_record_id: RecordId;
    /** Whether provider invocation reached the recorded start boundary. */
    readonly started: boolean;
    /** Retained start-record identity, or `null` when execution ended before invocation. */
    readonly started_record_id: RecordId | null;
    /** Retained aggregate usage-record identity, or `null` when no usage was observed. */
    readonly usage_record_id: RecordId | null;
};

/** Terminal task result paired with its durable trace evidence. */
export type DurableTaskExecutionResult = {
    /** Immutable artifacts, provider, control, usage, and outcome result. */
    readonly execution: TaskExecutionResult;
    /** Durable record identities and terminal cut. */
    readonly ledger: TaskExecutionLedgerReceipt;
};

/** Durable execution recovery classification returned by {@link readDurableTaskExecution}. */
export type DurableTaskExecutionRecovery =
    | {
          /** Run identity inspected for durable evidence. */
          readonly run_id: string;
          /** No durable creation evidence exists. */
          readonly status: (typeof DURABLE_EXECUTION_RECOVERY_STATUSES)[0];
      }
    | {
          /** Retained creation-record identity. */
          readonly created_record_id: RecordId;
          /** Run identity inspected for durable evidence. */
          readonly run_id: string;
          /** Creation committed before provider invocation began. */
          readonly status: (typeof DURABLE_EXECUTION_RECOVERY_STATUSES)[1];
      }
    | {
          /** Retained creation-record identity. */
          readonly created_record_id: RecordId;
          /** Run identity inspected for durable evidence. */
          readonly run_id: string;
          /** Retained start-record identity. */
          readonly started_record_id: RecordId;
          /** Provider invocation may already have occurred without terminal evidence. */
          readonly status: (typeof DURABLE_EXECUTION_RECOVERY_STATUSES)[2];
      }
    | {
          /** Reconstructed immutable execution result awaiting cut publication. */
          readonly execution: TaskExecutionResult;
          /** Terminal record evidence retained before cut publication. */
          readonly ledger: Omit<TaskExecutionLedgerReceipt, "cut">;
          /** Run identity inspected for durable evidence. */
          readonly run_id: string;
          /** Terminal evidence committed but its immutable cut is absent. */
          readonly status: (typeof DURABLE_EXECUTION_RECOVERY_STATUSES)[3];
      }
    | {
          /** Exact reconstructed durable task execution. */
          readonly result: DurableTaskExecutionResult;
          /** Run identity inspected for durable evidence. */
          readonly run_id: string;
          /** Terminal evidence and its cut are committed. */
          readonly status: (typeof DURABLE_EXECUTION_RECOVERY_STATUSES)[4];
      };
