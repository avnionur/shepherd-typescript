import type { AppendIntentId, BlobIntegrityIssue } from "./types.ts";

/** Stable recovery classification for one append intent. */
export type AppendRecoveryStatus = "committed" | "manual_recovery_required" | "retry_safe";

/** Stable defect classification for append recovery. */
export type AppendRecoveryIssue = "orphaned_rows" | "receipt_mismatch";

/** Read-only diagnosis describing how an append intent may be handled. */
export type AppendRecoveryDiagnostic = {
    /** Append intent inspected by the store. */
    readonly append_intent_id: AppendIntentId;
    /** Corruption requiring manual intervention, when present. */
    readonly issue: AppendRecoveryIssue | null;
    /** Whether the intent is committed, retryable, or requires manual recovery. */
    readonly status: AppendRecoveryStatus;
};

/** Stable classification for one whole-store integrity defect. */
export type TraceIntegrityIssueKind =
    | `blob_${BlobIntegrityIssue["kind"]}`
    | "append_receipt_mismatch"
    | "cut_mismatch"
    | "orphan_record"
    | "owner_ordinal_mismatch"
    | "parent_index_mismatch"
    | "record_mismatch"
    | "scope_registration_mismatch"
    | "sqlite_integrity_mismatch"
    | "supervised_dispatch_mismatch"
    | "trace_subscription_mismatch"
    | "witness_mismatch";

/** One classified defect found by a whole-store integrity scan. */
export type TraceIntegrityIssue = {
    /** Stable integrity-defect classification. */
    readonly kind: TraceIntegrityIssueKind;
    /** Retained identity or store area affected by the defect. */
    readonly subject_id: string;
};

/** Complete read-only integrity report for a trace store. */
export type TraceIntegrityReport = {
    /** Number of append intents whose receipts were examined. */
    readonly checked_append_intent_count: number;
    /** Number of registered blob identities examined. */
    readonly checked_blob_count: number;
    /** Number of published cut indexes examined. */
    readonly checked_cut_count: number;
    /** Number of retained owner paths examined. */
    readonly checked_owner_count: number;
    /** Number of canonical record rows examined, including the root witness. */
    readonly checked_record_count: number;
    /** Number of live scope registration rows examined against their retained records. */
    readonly checked_scope_count: number;
    /** Frozen classified defects in deterministic scan order. */
    readonly issues: readonly TraceIntegrityIssue[];
    /** Whether every examined store area passed verification. */
    readonly ok: boolean;
};
