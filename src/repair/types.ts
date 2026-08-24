import type {
    ORPHAN_REPAIR_BLOCKERS,
    ORPHAN_REPAIR_ERROR_CODES,
    ORPHAN_REPAIR_PRE_RUN_STATUSES,
    ORPHAN_REPAIR_SESSION_STATUSES,
} from "../protocol/values.generated.ts";
import type { RecordId } from "../record/types.ts";

/** Stable configured reason why orphan bookkeeping cannot be repaired. */
export type OrphanRepairBlocker =
    (typeof ORPHAN_REPAIR_BLOCKERS)[keyof typeof ORPHAN_REPAIR_BLOCKERS];

/** Stable configured explicit-repair failure code. */
export type OrphanRepairErrorCode =
    (typeof ORPHAN_REPAIR_ERROR_CODES)[keyof typeof ORPHAN_REPAIR_ERROR_CODES];

/** Exact bookkeeping retained while one reversible runtime operation is open. */
export type OperationBookkeepingDefinition = {
    /** Optional canonical trace record explaining why the operation remains open. */
    readonly cause_record_id: RecordId | null;
    /** Human-readable retained cause bounded by protocol configuration. */
    readonly retained_cause: string;
    /** Public operation-bookkeeping wire version. */
    readonly operation_version: number;
    /** Exact globally unique operation identity. */
    readonly operation_id: string;
    /** Provider-call boundary state; started calls are never repairable. */
    readonly provider_call_started: boolean;
    /** Exact durable owner, normally a run identity. */
    readonly owner_id: string;
    /** Exact session that opened the operation. */
    readonly session_id: string;
    /** Exact scope identity, or null for an unscoped operation. */
    readonly scope_id: string | null;
    /** Whether work-in-progress scope authority owns this operation. */
    readonly scope_owned: boolean;
};

/** Durable proof supplied after an external session-liveness authority proves a session dead. */
export type OperationSessionDeathEvidence = {
    /** Exact external evidence identity proving session death. */
    readonly death_evidence_id: string;
    /** Exact session whose retained operations become orphaned. */
    readonly session_id: string;
};

/** One immutable diagnosed open-operation entry. */
export type OrphanOperationDiagnosis = OperationBookkeepingDefinition & {
    /** Stable configured blockers preventing bookkeeping-only repair. */
    readonly blockers: readonly OrphanRepairBlocker[];
    /** Exact external session-death evidence, or null while the session remains live. */
    readonly death_evidence_id: string | null;
    /** Whether every narrow repair precondition is proven. */
    readonly repairable: boolean;
    /** Retained liveness classification for the owning session. */
    readonly session_status: (typeof ORPHAN_REPAIR_SESSION_STATUSES)[keyof typeof ORPHAN_REPAIR_SESSION_STATUSES];
};

/** Pagination options for read-only orphaned-operation diagnosis. */
export type OrphanOperationDiagnosisOptions = {
    /** Maximum entries returned, bounded by protocol configuration. */
    readonly limit?: number;
    /** Canonical operation-order offset. */
    readonly offset?: number;
};

/** Bounded immutable diagnosis of every retained open operation. */
export type OrphanOperationDiagnosisReport = {
    /** Exact digest identity over the complete unpaginated open-operation basis. */
    readonly basis_id: string;
    /** Number of open operations blocked from repair. */
    readonly blocked_count: number;
    /** Public diagnosis wire version. */
    readonly diagnosis_version: number;
    /** Applied page limit. */
    readonly limit: number;
    /** Canonical page offset. */
    readonly offset: number;
    /** Frozen page ordered by exact operation identity. */
    readonly operations: readonly OrphanOperationDiagnosis[];
    /** Number of open operations proven repairable. */
    readonly repairable_count: number;
    /** Total complete-basis open-operation count. */
    readonly total_count: number;
};

/** Globally idempotent exact command authorizing one bookkeeping-only repair. */
export type OrphanRepairCommand = {
    /** Exact diagnosis basis expected by the caller. */
    readonly basis_id: string;
    /** Globally idempotent caller-selected command identity. */
    readonly command_id: string;
    /** Public repair-command wire version. */
    readonly command_version: number;
    /** Exact complete orphan set; order is canonicalized as set identity. */
    readonly operation_ids: readonly string[];
};

/** Durable prepared command evidence retained before bookkeeping mutation. */
export type OrphanRepairPreparation = {
    /** Canonical prepared command. */
    readonly command: OrphanRepairCommand;
    /** Canonical trace record retaining the command. */
    readonly command_record_id: RecordId;
};

/** Canonical successful or empty bookkeeping-repair receipt. */
export type OrphanRepairReceipt = {
    /** Exact diagnosis basis consumed by the command. */
    readonly basis_id: string;
    /** Globally idempotent command identity. */
    readonly command_id: string;
    /** Canonical command evidence record. */
    readonly command_record_id: RecordId;
    /** Exact repaired operation identities in canonical order. */
    readonly operation_ids: readonly string[];
    /** Number of operation bookkeeping rows removed. */
    readonly repaired_count: number;
    /** Content-addressed canonical receipt identity. */
    readonly receipt_id: string;
    /** Canonical receipt evidence record. */
    readonly receipt_record_id: RecordId;
    /** Public repair-receipt wire version. */
    readonly receipt_version: number;
};

/** Fail-soft pre-run reclaim result that always preserves a manual diagnosis. */
export type OrphanPreRunReclaimResult =
    | {
          /** Exact diagnosis retained for inspection or retry. */
          readonly diagnosis: OrphanOperationDiagnosisReport;
          /** Successful repair receipt, including the empty no-op case. */
          readonly receipt: OrphanRepairReceipt;
          /** Reclaim completed without blocking run start. */
          readonly status: (typeof ORPHAN_REPAIR_PRE_RUN_STATUSES)["repaired"];
      }
    | {
          /** Exact diagnosis retained for manual repair, or null when corruption prevents one. */
          readonly diagnosis: OrphanOperationDiagnosisReport | null;
          /** Stable refusal or failure code. */
          readonly error_code: OrphanRepairErrorCode;
          /** Reclaim was declined without blocking run start. */
          readonly status: (typeof ORPHAN_REPAIR_PRE_RUN_STATUSES)["declined"];
      };
