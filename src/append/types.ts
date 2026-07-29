import type { RecordBody, RecordEnvelope, RecordId, RecordMode } from "../record/types.ts";

/**
 * Stable identifier for one owner-local trace path.
 *
 * @public
 */
export type TraceOwnerId = string;

/**
 * Configured-floor position of a retained record on an owner path.
 *
 * @public
 */
export type OwnerOrdinal = number;

/**
 * Batch-local name used by later drafts to cite an earlier record.
 *
 * @public
 */
export type AppendLocalId = string;

/**
 * Append-time semantic input for one record.
 *
 * @public
 */
export type AppendRecordDraft<TBody extends RecordBody = RecordBody> = {
    /** Optional batch-local name for references from later drafts. */
    readonly append_local_id?: AppendLocalId;
    /** Schema-specific semantic payload. */
    readonly body: TBody;
    /** Stored causal parents appended after group-level parents. */
    readonly caused_by_record_ids?: readonly RecordId[];
    /** Earlier batch-local parents appended after stored parents. */
    readonly caused_by_local_refs?: readonly AppendLocalId[];
    /** Whether the body declares intended state or captures observed state. */
    readonly mode: RecordMode;
    /** Non-empty identifier for the body schema. */
    readonly schema_ref: string;
    /** Retained witness record identifier. */
    readonly witness_ref: RecordId;
};

/**
 * Ordered record drafts sharing one owner path and common causal parents.
 *
 * @public
 */
export type AppendGroupDraft = {
    /** Common stored parents prepended to every record draft in this group. */
    readonly caused_by_record_ids?: readonly RecordId[];
    /** Stable owner path receiving the planned records. */
    readonly owner_id: TraceOwnerId;
    /** Ordered record drafts for this owner path. */
    readonly records: readonly AppendRecordDraft[];
};

/**
 * Ordered groups prepared as one future atomic append operation.
 *
 * @public
 */
export type AppendBatchDraft = {
    /** Ordered owner-local append groups. */
    readonly groups: readonly AppendGroupDraft[];
};

/**
 * Existing trace state required to plan parent resolution and ordinals.
 *
 * @public
 */
export type AppendPlanningState = {
    /** Record identifiers already retained by the target store. */
    readonly known_record_ids?: ReadonlySet<RecordId>;
    /** Next unallocated ordinal for each owner path. */
    readonly next_owner_ordinals?: ReadonlyMap<TraceOwnerId, OwnerOrdinal>;
};

/**
 * Path-local metadata assigned without changing semantic record identity.
 *
 * @public
 */
export type RecordView = {
    /** Stable owner path containing this record occurrence. */
    readonly owner_id: TraceOwnerId;
    /** Position allocated on the owner path. */
    readonly owner_ordinal: OwnerOrdinal;
};

/**
 * One planned record with semantic content and path-local placement.
 *
 * @public
 */
export type PlannedRecord = {
    /** Canonical semantic payload snapshot. */
    readonly body: RecordBody;
    /** Content-addressed semantic envelope. */
    readonly envelope: RecordEnvelope;
    /** Owner-local placement outside semantic identity. */
    readonly view: RecordView;
};

/**
 * Deterministic result of validating and planning an append batch.
 *
 * @public
 */
export type PlannedAppendBatch = {
    /** Ordered parent-to-child edges produced by planned records. */
    readonly causal_edges: readonly (readonly [RecordId, RecordId])[];
    /** Next unallocated ordinal for every supplied or changed owner. */
    readonly next_owner_ordinals: ReadonlyMap<TraceOwnerId, OwnerOrdinal>;
    /** Inclusive allocated ordinal range for every changed owner. */
    readonly owner_ordinal_ranges: ReadonlyMap<TraceOwnerId, readonly [OwnerOrdinal, OwnerOrdinal]>;
    /** Planned records in batch and group order. */
    readonly records: readonly PlannedRecord[];
};
