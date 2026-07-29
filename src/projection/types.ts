import type { RecordId } from "../record/types.ts";
import type { Cut } from "../store/types.ts";

/** Effective lifecycle state derived for one execution owner. */
export type ExecutionStatus = "failed" | "pending" | "running" | "succeeded";

/** Disposable execution value projected from an immutable trace slice. */
export type Execution = {
    /** Cut that fixed the projected owner prefix. */
    readonly cut?: Cut;
    /** Terminal failure text, when the effective lifecycle failed. */
    readonly error: string | null;
    /** Trace owner whose lifecycle was projected. */
    readonly execution_id: string;
    /** Inputs captured by the latest creation record. */
    readonly inputs: Readonly<Record<string, unknown>>;
    /** Outputs captured by the latest successful terminal record. */
    readonly outputs: Readonly<Record<string, unknown>>;
    /** Optional parent execution captured at creation. */
    readonly parent_execution_id: string | null;
    /** Record that most recently started the execution. */
    readonly started_record_id: RecordId | null;
    /** Effective lifecycle state. */
    readonly status: ExecutionStatus;
    /** Task reference captured at creation. */
    readonly task_ref: string;
    /** Record that most recently completed or failed the execution. */
    readonly terminal_record_id: RecordId | null;
};

/** Parent-owned relationship transition between two executions. */
export type ExecutionRelation = {
    /** Published cut fixing the child execution state, when available. */
    readonly child_cut_id: string | null;
    /** Related child execution owner. */
    readonly child_execution_id: string;
    /** Record that retained this relationship transition. */
    readonly created_record_id: RecordId;
    /** Parent execution that owns the relation. */
    readonly parent_execution_id: string;
    /** Stable relation identity whose latest transition is effective. */
    readonly relation_id: string;
    /** Relationship transition kind. */
    readonly relation_kind: "abandoned" | "adopted" | "spawned";
};

/** One active child and the relation selecting its retained cut. */
export type EffectiveChild = {
    /** Child execution projected at its immutable cut. */
    readonly execution: Execution;
    /** Effective parent-owned relation. */
    readonly relation: ExecutionRelation;
};

/** Parent-published semantic data visible in effective history. */
export type PublishedRecord = {
    /** Published structured data. */
    readonly data: Readonly<Record<string, unknown>>;
    /** Schema-defined publication kind. */
    readonly kind: string;
    /** Retained publication record identity. */
    readonly record_id: RecordId;
};

/** Disposable effective history projected from root and child trace cuts. */
export type EffectiveHistory = {
    /** Active child executions with their selecting relations. */
    readonly children: readonly EffectiveChild[];
    /** Parent-published semantic data in owner order. */
    readonly published_records: readonly PublishedRecord[];
    /** Every retained parent relation transition in owner order. */
    readonly relations: readonly ExecutionRelation[];
    /** Root execution projected at the requested cut. */
    readonly root: Execution;
};
