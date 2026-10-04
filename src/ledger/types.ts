import type { SemanticRecord, SemanticValue } from "../canonical/canonical-record.ts";
import type { RUN_CONTINUATION_EVIDENCE_STATUSES } from "../protocol/values.generated.ts";
import type { ProviderDescriptor } from "../provider/types.ts";
import type { RunBudgetDefinition } from "../run/control-types.ts";
import type {
    DurableExecutionCancellationCommand,
    DurableExecutionInactiveCancellationCommand,
    DurableExecutionPauseCommand,
    DurableExecutionRecoveryCommand,
    DurableExecutionResumeCommand,
} from "../run/durable-execution-control-types.ts";
import type {
    DurableTaskExecutionInspection,
    DurableTaskExecutionSettlementInspection,
} from "../run/durable-execution-inspection-types.ts";
import type { Cut, Slice } from "../store/types.ts";
import type { TaskArtifact, TaskArtifactLock } from "../task/types.ts";
import type {
    RepositoryTaskGrantArtifact,
    RepositoryTaskGrantArtifactLock,
} from "../workspace/repository-grant-types.ts";
import type { RetainedWorldOutput } from "../workspace/task-world-execution-types.ts";
import type { TaskWorldCaptureJournalInspection } from "../workspace/task-world-journal-types.ts";

/** Closed bounded pagination options for task/run ledger lists. */
export type LedgerListOptions = {
    /** Maximum entries returned, bounded by protocol configuration. */
    readonly limit?: number;
    /** Zero-based canonical entry offset. */
    readonly offset?: number;
};

/** Immutable repository-grant companion evidence for one task artifact. */
export type TaskLedgerRepositoryGrantEvidence = {
    /** Canonical repository-grant artifact. */
    readonly artifact: RepositoryTaskGrantArtifact;
    /** Exact content-addressed repository-grant artifact lock. */
    readonly artifact_lock: RepositoryTaskGrantArtifactLock;
};

/** Immutable registered-task ledger projection. */
export type TaskLedgerEntry = {
    /** Canonical bodyless task artifact. */
    readonly artifact: TaskArtifact;
    /** Exact verified task artifact lock. */
    readonly artifact_lock: TaskArtifactLock;
    /** Disposable projection compatibility namespace. */
    readonly compatibility_version: string;
    /** Public task/run ledger projection version. */
    readonly ledger_version: number;
    /** Validated registered declaration or an authenticated caller-supplied companion; not a run grant. */
    readonly repository_grant: TaskLedgerRepositoryGrantEvidence | null;
};

/** One validated native-jail process intent, start, or receipt retained on a run owner. */
export type RunLedgerNativeJailProcessEvidence = {
    /** Canonical validated native process evidence body. */
    readonly body: SemanticRecord;
    /** Exact native process evidence record identity. */
    readonly record_id: string;
};

/** Immutable task/run ledger projection for one durable execution owner. */
export type RunLedgerEntry = {
    /** Validated execution budget retained at creation. */
    readonly budget: RunBudgetDefinition;
    /** Canonical durable creation-record identity used for import-stable ordering. */
    readonly created_record_id: string;
    /** Canonical validated task input retained at creation. */
    readonly input: SemanticValue;
    /** Disposable projection compatibility namespace. */
    readonly compatibility_version: string;
    /** Existing durable lifecycle/artifact/usage/outcome/cut/settlement inspection. */
    readonly inspection: DurableTaskExecutionInspection;
    /** Immutable provider descriptor retained before invocation. */
    readonly provider: ProviderDescriptor;
    /** Public task/run ledger projection version. */
    readonly ledger_version: number;
    /** Ordered native-jail process intent/start/receipt evidence when present. */
    readonly native_jail_processes: readonly RunLedgerNativeJailProcessEvidence[];
    /** Exact retained-world output reconstructed from cut-bounded evidence when present. */
    readonly output: RetainedWorldOutput | null;
    /** Exact durable run owner identity. */
    readonly run_id: string;
    /** Exact task artifact lock retained before invocation. */
    readonly task_artifact_lock: TaskArtifactLock;
    /** Capture, placement, jail, output, and recovery journal evidence when retained. */
    readonly world_capture: TaskWorldCaptureJournalInspection;
};

/** Immutable cut-bounded retained-world output citation projection. */
export type OutputCitationEntry = {
    /** Disposable projection compatibility namespace. */
    readonly compatibility_version: string;
    /** Exact retained output and its execution-cut/custody citations. */
    readonly output: RetainedWorldOutput;
    /** Public output citation projection version. */
    readonly output_citation_version: number;
    /** Durable creation record of the cited run. */
    readonly run_created_record_id: string;
    /** Exact durable run identity. */
    readonly run_id: string;
    /** Ordered terminal settlements citing this exact output. */
    readonly settlements: readonly DurableTaskExecutionSettlementInspection[];
    /** Exact task artifact lock cited by the durable run. */
    readonly task_artifact_lock: TaskArtifactLock;
    /** Validated capture journal bounded by the cited execution cut. */
    readonly world_capture: TaskWorldCaptureJournalInspection;
};

/** Immutable published-cut trace revision and its exact resolved owner-prefix slice. */
export type TraceRevisionEntry = {
    /** Disposable projection compatibility namespace. */
    readonly compatibility_version: string;
    /** Exact immutable published cut. */
    readonly cut: Cut;
    /** Cut-bounded graph-shaped records, paths, causality, anchors, and witnesses. */
    readonly slice: Slice;
    /** Public trace revision projection version. */
    readonly trace_revision_version: number;
};

/** Validated canonical durable control command retained on one run owner. */
export type RecoveryCommandEvidence = {
    /** Exact canonical command body. */
    readonly command:
        | DurableExecutionCancellationCommand
        | DurableExecutionInactiveCancellationCommand
        | DurableExecutionPauseCommand
        | DurableExecutionRecoveryCommand
        | DurableExecutionResumeCommand;
    /** Exact causal parents cited by the command record. */
    readonly caused_by_record_ids: readonly string[];
    /** Exact command record identity. */
    readonly record_id: string;
};

/** Bounded retained records directly caused by one exact durable command. */
export type RecoveryCommandResult = {
    /** Exact command whose application is described. */
    readonly command_record_id: string;
    /** Ordered directly caused lifecycle/evidence records within the recovery bound. */
    readonly effect_record_ids: readonly string[];
};

/** Archive-stable canonical claim/fence evidence, or an explicit unavailable classification. */
export type RecoveryInvocationClaimEvidence =
    | {
          /** Exact retained claim identity. */
          readonly claim_id: string;
          /** Positive retained fencing token. */
          readonly fencing_token: number;
          /** Record carrying the canonical claim/fence evidence. */
          readonly record_id: string;
          /** Configured verified evidence classification. */
          readonly status: (typeof RUN_CONTINUATION_EVIDENCE_STATUSES)[0];
      }
    | {
          /** Private lease state has no archive-stable canonical record. */
          readonly status: (typeof RUN_CONTINUATION_EVIDENCE_STATUSES)[2];
      };

/** Immutable bounded durable recovery/control record projection for one run. */
export type RecoveryRecordEntry = {
    /** Direct bounded results for every retained command. */
    readonly command_results: readonly RecoveryCommandResult[];
    /** Ordered validated control commands retained before the lifecycle bound. */
    readonly commands: readonly RecoveryCommandEvidence[];
    /** Disposable projection compatibility namespace. */
    readonly compatibility_version: string;
    /** Archive-stable claim/fence evidence when canonically retained. */
    readonly invocation_claim: RecoveryInvocationClaimEvidence;
    /** Complete validated durable lifecycle projection. */
    readonly lifecycle: DurableTaskExecutionInspection["lifecycle"];
    /** Exact lifecycle head bounding this projection. */
    readonly lifecycle_head_record_id: string;
    /** Configured recovery classification at read time. */
    readonly recovery_status: DurableTaskExecutionInspection["status"];
    /** Public recovery record projection version. */
    readonly recovery_record_version: number;
    /** Exact durable run identity. */
    readonly run_id: string;
};
