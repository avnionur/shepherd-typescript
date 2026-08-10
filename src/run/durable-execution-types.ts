import type { RecordId } from "../record/types.ts";
import type { Cut } from "../store/types.ts";
import type { TaskExecutionResult } from "./execution-types.ts";

/** Durable trace evidence retained for one task execution. */
export type TaskExecutionLedgerReceipt = {
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
    /** Immutable provider, control, usage, and outcome result. */
    readonly execution: TaskExecutionResult;
    /** Durable record identities and terminal cut. */
    readonly ledger: TaskExecutionLedgerReceipt;
};
