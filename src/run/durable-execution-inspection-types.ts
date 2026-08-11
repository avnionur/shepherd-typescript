import type {
    DURABLE_EXECUTION_RECOVERY_STATUSES,
    RUN_CONTINUATION_CONSTITUENT_KINDS,
    RUN_CONTINUATION_EVIDENCE_STATUSES,
    RUN_LIFECYCLE_SUSPENDED_STATUS,
    RUN_LIFECYCLE_WAITING_STATUS,
} from "../protocol/values.generated.ts";
import type { RecordId } from "../record/types.ts";
import type { Cut } from "../store/types.ts";
import type { RunArtifact } from "./artifact-types.ts";
import type { RunOutcome } from "./types.ts";
import type { RunUsage } from "./usage-types.ts";

/** One retained artifact and its canonical record identity in an inspection view. */
export type DurableTaskExecutionArtifactInspection = {
    /** Reconstructed immutable run artifact. */
    readonly artifact: RunArtifact;
    /** Canonical artifact-record identity. */
    readonly record_id: RecordId;
};

/** One retained terminal outcome and its canonical record identity. */
export type DurableTaskExecutionOutcomeInspection = {
    /** Reconstructed immutable terminal outcome. */
    readonly outcome: RunOutcome;
    /** Canonical outcome-record identity. */
    readonly record_id: RecordId;
};

/** One retained aggregate usage value and its canonical record identity. */
export type DurableTaskExecutionUsageInspection = {
    /** Canonical usage-record identity. */
    readonly record_id: RecordId;
    /** Reconstructed immutable aggregate usage. */
    readonly usage: RunUsage;
};

/** One classified continuation constituent in a durable inspection view. */
export type DurableTaskExecutionContinuationConstituentInspection = {
    /** Configured continuation constituent kind. */
    readonly kind: (typeof RUN_CONTINUATION_CONSTITUENT_KINDS)[number];
    /** Durable receipt identity when the evidence is verified. */
    readonly receipt_id: string | null;
    /** Configured evidence classification. */
    readonly status: (typeof RUN_CONTINUATION_EVIDENCE_STATUSES)[number];
};

/** Validated continuation descriptor and its immutable trace cut. */
export type DurableTaskExecutionContinuationInspection = {
    /** Ordered configured continuation constituents. */
    readonly constituents: readonly DurableTaskExecutionContinuationConstituentInspection[];
    /** Canonical continuation-descriptor record identity. */
    readonly record_id: RecordId;
    /** Immutable trace cut cited by the descriptor. */
    readonly trace_cut: Cut;
};

/** Read-only waiting or suspension acknowledgement evidence. */
export type DurableTaskExecutionQuiescentInspection =
    | {
          /** Canonical waiting-acknowledgement record identity. */
          readonly acknowledgement_record_id: RecordId;
          /** Configured waiting-acknowledgement schema. */
          readonly acknowledgement_schema_ref: string;
          /** Validated continuation descriptor. */
          readonly continuation: DurableTaskExecutionContinuationInspection;
          /** Pause command is absent for prerequisite-driven waiting. */
          readonly pause_command_record_id: null;
          /** Exact prerequisite named by the waiting acknowledgement. */
          readonly prerequisite: {
              /** Configured or application-defined prerequisite kind. */
              readonly kind: string;
              /** Stable prerequisite identity. */
              readonly prerequisite_id: string;
          };
          /** Configured prerequisite-driven lifecycle status. */
          readonly status: typeof RUN_LIFECYCLE_WAITING_STATUS;
      }
    | {
          /** Canonical suspension-acknowledgement record identity. */
          readonly acknowledgement_record_id: RecordId;
          /** Configured suspension-acknowledgement schema. */
          readonly acknowledgement_schema_ref: string;
          /** Validated continuation descriptor. */
          readonly continuation: DurableTaskExecutionContinuationInspection;
          /** Retained pause-command record cited by the acknowledgement. */
          readonly pause_command_record_id: RecordId;
          /** Prerequisite is absent for control-driven suspension. */
          readonly prerequisite: null;
          /** Configured control-driven lifecycle status. */
          readonly status: typeof RUN_LIFECYCLE_SUSPENDED_STATUS;
      };

/** Lifecycle record identities visible for one durable task execution. */
export type DurableTaskExecutionLifecycleInspection = {
    /** Creation-record identity, or `null` when the run is absent. */
    readonly created_record_id: RecordId | null;
    /** Current validated waiting or suspension evidence, or `null` while not quiescent. */
    readonly quiescent: DurableTaskExecutionQuiescentInspection | null;
    /** Running-continuation acknowledgement, or `null` unless a suspended run was resumed. */
    readonly running_continuation_record_id: RecordId | null;
    /** Start-record identity, or `null` before provider invocation. */
    readonly started_record_id: RecordId | null;
    /** Terminal lifecycle-record identity, or `null` before terminal publication. */
    readonly terminal_record_id: RecordId | null;
    /** Configured terminal lifecycle schema, or `null` before terminal publication. */
    readonly terminal_schema_ref: string | null;
};

/** Read-only projection of validated durable task-execution evidence. */
export type DurableTaskExecutionInspection = {
    /** Ordered retained artifacts with their canonical record identities. */
    readonly artifacts: readonly DurableTaskExecutionArtifactInspection[];
    /** Ordered direct `[cause, effect]` record edges from canonical envelopes. */
    readonly causal_edges: readonly (readonly [RecordId, RecordId])[];
    /** Immutable terminal cut, or `null` until cut publication. */
    readonly cut: Cut | null;
    /** Retained lifecycle record identities and terminal schema. */
    readonly lifecycle: DurableTaskExecutionLifecycleInspection;
    /** Exact terminal outcome evidence, or `null` before terminal publication. */
    readonly outcome: DurableTaskExecutionOutcomeInspection | null;
    /** Stable durable run identity. */
    readonly run_id: string;
    /** Configured durable recovery classification at inspection time. */
    readonly status: (typeof DURABLE_EXECUTION_RECOVERY_STATUSES)[number];
    /** Aggregate usage evidence, or `null` when none was observed. */
    readonly usage: DurableTaskExecutionUsageInspection | null;
};
