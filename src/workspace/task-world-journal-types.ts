import type { SemanticRecord } from "../canonical/canonical-record.ts";
import type {
    DURABLE_EXECUTION_RECOVERY_STATUSES,
    RETAINED_WORLD_JOURNAL_PHASES,
    RETAINED_WORLD_OUTPUT_STATUSES,
} from "../protocol/values.generated.ts";
import type { RecordId } from "../record/types.ts";

/** Durable task-world journal phase or its absent/retained projection. */
export type TaskWorldCaptureJournalStatus =
    | (typeof DURABLE_EXECUTION_RECOVERY_STATUSES)[0]
    | (typeof RETAINED_WORLD_JOURNAL_PHASES)[number]
    | (typeof RETAINED_WORLD_OUTPUT_STATUSES)[0];

/** One validated immutable capture-journal transition. */
export type TaskWorldCaptureJournalTransition = {
    /** Canonical closed transition body. */
    readonly body: SemanticRecord;
    /** Configured ordered journal phase. */
    readonly phase: (typeof RETAINED_WORLD_JOURNAL_PHASES)[number];
    /** Exact retained transition record identity. */
    readonly record_id: RecordId;
};

/** Restart-safe read projection of one durable task-world capture journal. */
export type TaskWorldCaptureJournalInspection = {
    /** Stable capture identity, or `null` when no journal exists. */
    readonly capture_id: string | null;
    /** Retained world-output record identity, or `null` before retention. */
    readonly output_record_id: RecordId | null;
    /** Ordinary durable execution recovery classification. */
    readonly recovery_status: (typeof DURABLE_EXECUTION_RECOVERY_STATUSES)[number];
    /** Exact durable run identity. */
    readonly run_id: string;
    /** Latest validated capture phase. */
    readonly status: TaskWorldCaptureJournalStatus;
    /** Ordered immutable transition prefix. */
    readonly transitions: readonly TaskWorldCaptureJournalTransition[];
};
