import type { ProofEnvelope } from "../formal/types.ts";
import type {
    DURABLE_EXECUTION_RECOVERY_STATUSES,
    RETAINED_WORLD_SETTLEMENT_ACTIONS,
    RETAINED_WORLD_SETTLEMENT_CITATION_VERSION,
    RETAINED_WORLD_SETTLEMENT_STATES,
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

/** Canonical settlement operation evidence attached to a durable execution. */
export type DurableTaskExecutionSettlementOperationInspection = {
    /** Secure digest of the canonical operation JSON. */
    readonly digest: string;
    /** Content-addressed operation identity. */
    readonly id: string;
    /** Canonical operation JSON retained by the settlement journal. */
    readonly json: string;
};

/** Canonical terminal settlement receipt attached to a durable execution. */
export type DurableTaskExecutionSettlementReceiptInspection = {
    /** Secure digest of the canonical terminal receipt JSON. */
    readonly digest: string;
    /** Canonical terminal receipt JSON retained by the settlement journal. */
    readonly json: string;
};

/** Exact terminal trace identities cited by one retained-world settlement. */
export type DurableTaskExecutionSettlementTraceInspection = {
    /** Retained world-output capture record cited by the settlement request. */
    readonly capture_record_id: RecordId;
    /** Immutable terminal execution cut cited by the settlement request. */
    readonly execution_cut_id: string;
    /** Terminal execution outcome record cited by the retained output. */
    readonly outcome_record_id: RecordId;
    /** Terminal lifecycle record fixed by the execution cut. */
    readonly terminal_record_id: RecordId;
};

/** One validated, cut-bounded retained-world settlement citation. */
export type DurableTaskExecutionSettlementInspection = {
    /** Exact configured terminal settlement action. */
    readonly action: (typeof RETAINED_WORLD_SETTLEMENT_ACTIONS)[number];
    /** Immutable cut fixing the citation on the execution owner. */
    readonly citation_cut: Cut;
    /** Canonical retained citation record. */
    readonly citation_record_id: RecordId;
    /** Configured citation record version. */
    readonly citation_version: typeof RETAINED_WORLD_SETTLEMENT_CITATION_VERSION;
    /** Globally idempotent caller command identity. */
    readonly command_id: string;
    /** Exact deterministic settlement operation. */
    readonly operation: DurableTaskExecutionSettlementOperationInspection;
    /** Exact retained-output identity consumed by the settlement. */
    readonly output_id: string;
    /** Exact terminal settlement receipt. */
    readonly receipt: DurableTaskExecutionSettlementReceiptInspection;
    /** Content-addressed authenticated settlement request identity. */
    readonly request_id: string;
    /** Configured terminal settlement state. */
    readonly state: (typeof RETAINED_WORLD_SETTLEMENT_STATES)[2 | 3 | 4 | 5];
    /** Exact durable execution evidence bound into the settlement. */
    readonly trace: DurableTaskExecutionSettlementTraceInspection;
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
    /**
     * Inspectable claim strength: `runtime_only` by default, imported non-runtime claims only as
     * `claimed_proof_backed` metadata, and `extension` for publication controls.
     */
    readonly proof: ProofEnvelope;
    /** Stable durable run identity. */
    readonly run_id: string;
    /** Ordered terminal settlement citations published for this execution. */
    readonly settlements: readonly DurableTaskExecutionSettlementInspection[];
    /** Configured durable recovery classification at inspection time. */
    readonly status: (typeof DURABLE_EXECUTION_RECOVERY_STATUSES)[number];
    /** Aggregate usage evidence, or `null` when none was observed. */
    readonly usage: DurableTaskExecutionUsageInspection | null;
};
