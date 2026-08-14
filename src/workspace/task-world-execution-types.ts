import type { RETAINED_WORLD_OUTPUT_STATUSES } from "../protocol/values.generated.ts";
import type { DurableTaskExecutionResult } from "../run/durable-execution-types.ts";
import type { TaskExecutionOptions } from "../run/execution-types.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import type { Cut } from "../store/types.ts";
import type { TaskSchema } from "../task/schema.ts";
import type { RetainedWorldRunner } from "./retained-world-runner-types.ts";
import type {
    ReferenceCopyCarrier,
    WorkspaceBinding,
    WorldChangeset,
    WorldRevision,
} from "./types.ts";

/** Closed options for one fenced durable retained-world task execution. */
export type CaptureTaskWorldOptions<
    I extends TaskSchema<unknown>,
    O extends TaskSchema<unknown>,
> = {
    /** Exact verified immutable revision used as execution input. */
    readonly baseRevision: WorldRevision;
    /** Exact canonical binding governed by the retained world. */
    readonly binding: WorkspaceBinding;
    /** Stable caller-assigned correlation identity for the world capture. */
    readonly captureId: string;
    /** Package-created carrier owning base, custody, and captured head. */
    readonly carrier: ReferenceCopyCarrier;
    /** Existing task execution contract associated with the world. */
    readonly execution: TaskExecutionOptions<I, O>;
    /** Registered runner invoked with isolated fenced authority. */
    readonly runner: RetainedWorldRunner<I, O>;
    /** Open durable trace store receiving execution and world evidence. */
    readonly store: SQLiteTraceStore;
};

/** Closed options for command-authorized recovery of one retained-world task capture. */
export type RecoverTaskWorldOptions<
    I extends TaskSchema<unknown>,
    O extends TaskSchema<unknown>,
> = CaptureTaskWorldOptions<I, O> & {
    /** Stable identity reused for every retry of this exact recovery request. */
    readonly commandId: string;
};

/** Verified immutable world attachment retained inside one terminal execution cut. */
export type RetainedWorldOutput = {
    /** Exact immutable input revision. */
    readonly base_revision_id: string;
    /** Exact workspace binding identity. */
    readonly binding_id: string;
    /** Stable caller capture identity. */
    readonly capture_id: string;
    /** Retained capture-record identity inside the terminal cut. */
    readonly capture_record_id: string;
    /** Exact mutable custody from which the head was captured. */
    readonly custody_id: string;
    /** Exact canonical changeset identity. */
    readonly changeset_id: string;
    /** Immutable terminal cut that contains the capture record. */
    readonly execution_cut: Cut;
    /** Exact downstream run-outcome record identity. */
    readonly execution_outcome_record_id: string;
    /** Exact immutable output revision. */
    readonly head_revision_id: string;
    /** Content-addressed retained-output identity. */
    readonly output_id: string;
    /** Exact durable run identity. */
    readonly run_id: string;
    /** Durable task-world capture protocol version. */
    readonly schema_version: number;
    /** Configured successful retention classification. */
    readonly status: (typeof RETAINED_WORLD_OUTPUT_STATUSES)[0];
    /** User binding content witness observed after execution. */
    readonly user_basis_after: string;
    /** User binding content witness observed before execution. */
    readonly user_basis_before: string;
};

/** Durable task result paired with its exact retained world attachment. */
export type TaskWorldCaptureResult = DurableTaskExecutionResult & {
    /** Canonical reconstructive comparison of base and captured head. */
    readonly changeset: WorldChangeset;
    /** Verified retained world attachment. */
    readonly output: RetainedWorldOutput;
};
