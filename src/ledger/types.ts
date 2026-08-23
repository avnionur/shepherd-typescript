import type { SemanticRecord, SemanticValue } from "../canonical/canonical-record.ts";
import type { ProviderDescriptor } from "../provider/types.ts";
import type { RunBudgetDefinition } from "../run/control-types.ts";
import type { DurableTaskExecutionInspection } from "../run/durable-execution-inspection-types.ts";
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
    /** Repository-grant companion when supplied by an authenticated evidence source. */
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
