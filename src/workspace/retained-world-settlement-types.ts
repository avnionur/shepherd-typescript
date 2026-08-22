import type {
    RETAINED_WORLD_SETTLEMENT_ACTIONS,
    RETAINED_WORLD_SETTLEMENT_STATES,
    RETAINED_WORLD_SETTLEMENT_VERSION,
} from "../protocol/values.generated.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import type {
    RetainedWorldApplicationPlanEvidence,
    RetainedWorldSettlementAdmission,
    RetainedWorldSettlementRequest,
} from "../store/types.ts";
import type { RetainedWorldOutput } from "./task-world-execution-types.ts";
import type { ReferenceCopyCarrier, WorkspaceBinding } from "./types.ts";

/** Closed options for authenticated consume-once retained-world settlement admission. */
export type PrepareRetainedWorldSettlementOptions = {
    /** Exact configured terminal settlement action. */
    readonly action: (typeof RETAINED_WORLD_SETTLEMENT_ACTIONS)[number];
    /** Package-created canonical binding cited by the retained output. */
    readonly binding: WorkspaceBinding;
    /** Package-created carrier owning the retained revisions and custody. */
    readonly carrier: ReferenceCopyCarrier;
    /** Globally idempotent identity for this exact settlement request. */
    readonly commandId: string;
    /** Exact retained output returned by durable task-world capture or recovery. */
    readonly output: RetainedWorldOutput;
    /** Open durable trace store containing the output's terminal execution evidence. */
    readonly store: SQLiteTraceStore;
};

/** Authenticated prepared settlement decision and its exact closed request. */
export type PreparedRetainedWorldSettlement = RetainedWorldSettlementAdmission & {
    /** Exact request authenticated before atomic consume-once admission. */
    readonly request: RetainedWorldSettlementRequest;
};

/** Closed authorities for exact-ID retained-world discard and recovery. */
export type DiscardRetainedWorldSettlementOptions = {
    /** Package-created carrier owning the admitted custody and immutable revisions. */
    readonly carrier: ReferenceCopyCarrier;
    /** Exact retained-output identity previously admitted for discard. */
    readonly outputId: string;
    /** Open trace store retaining the authenticated settlement journal. */
    readonly store: SQLiteTraceStore;
};

/** Completed durable discard result after idempotent physical custody cleanup. */
export type DiscardedRetainedWorldSettlement = {
    /** Configured discard action. */
    readonly action: (typeof RETAINED_WORLD_SETTLEMENT_ACTIONS)[1];
    /** Confirms the carrier cleanup receipt is durably complete. */
    readonly cleanup_completed: true;
    /** Deterministic operation identity retained before cleanup. */
    readonly operation_id: string;
    /** Exact retained-output identity consumed by discard. */
    readonly output_id: string;
    /** Exact authenticated request identity. */
    readonly request_id: string;
    /** Public exact-request settlement protocol version. */
    readonly settlement_version: typeof RETAINED_WORLD_SETTLEMENT_VERSION;
    /** Configured terminal discarded state. */
    readonly state: (typeof RETAINED_WORLD_SETTLEMENT_STATES)[3];
};

/** Closed authorities for exact-ID retained-world selection and recovery. */
export type SelectRetainedWorldSettlementOptions = {
    /** Package-created canonical binding cited by the admitted retained output. */
    readonly binding: WorkspaceBinding;
    /** Package-created carrier owning the admitted immutable revisions. */
    readonly carrier: ReferenceCopyCarrier;
    /** Exact retained-output identity previously admitted for selection. */
    readonly outputId: string;
    /** Open trace store retaining the authenticated settlement journal. */
    readonly store: SQLiteTraceStore;
};

/** Completed durable selection result after authenticated carrier publication. */
export type SelectedRetainedWorldSettlement = {
    /** Configured select action. */
    readonly action: (typeof RETAINED_WORLD_SETTLEMENT_ACTIONS)[0];
    /** Deterministic operation identity retained before publication. */
    readonly operation_id: string;
    /** Exact retained-output identity consumed by selection. */
    readonly output_id: string;
    /** Exact carrier publication identity cited by the terminal settlement receipt. */
    readonly publication_id: string;
    /** Exact authenticated request identity. */
    readonly request_id: string;
    /** Public exact-request settlement protocol version. */
    readonly settlement_version: typeof RETAINED_WORLD_SETTLEMENT_VERSION;
    /** Configured terminal selected state. */
    readonly state: (typeof RETAINED_WORLD_SETTLEMENT_STATES)[2];
    /** Semantic user-basis witness observed after complete carrier publication. */
    readonly user_basis_after: string;
};

/** Closed authorities for exact-ID retained-world apply and recovery. */
export type ApplyRetainedWorldSettlementOptions = {
    /** Package-created canonical binding cited by the admitted retained output. */
    readonly binding: WorkspaceBinding;
    /** Package-created carrier owning current, base, and retained revisions. */
    readonly carrier: ReferenceCopyCarrier;
    /** Exact retained-output identity previously admitted for apply. */
    readonly outputId: string;
    /** Open trace store retaining the authenticated settlement journal. */
    readonly store: SQLiteTraceStore;
};

/** Completed durable apply result after authenticated carrier publication. */
export type AppliedRetainedWorldSettlement = {
    /** Configured apply action. */
    readonly action: (typeof RETAINED_WORLD_SETTLEMENT_ACTIONS)[2];
    /** Immutable revision published by apply. */
    readonly applied_revision_id: string;
    /** Exact content-addressed three-way application plan. */
    readonly application_plan_id: string;
    /** Deterministic operation identity retained before publication. */
    readonly operation_id: string;
    /** Exact retained-output identity consumed by apply. */
    readonly output_id: string;
    /** Exact carrier publication identity cited by the terminal settlement receipt. */
    readonly publication_id: string;
    /** Configured reason explaining degenerate or three-way planning. */
    readonly plan_reason: RetainedWorldApplicationPlanEvidence["reason"];
    /** Configured successful planning status. */
    readonly plan_status: RetainedWorldApplicationPlanEvidence["status"];
    /** Exact authenticated request identity. */
    readonly request_id: string;
    /** Public exact-request settlement protocol version. */
    readonly settlement_version: typeof RETAINED_WORLD_SETTLEMENT_VERSION;
    /** Configured terminal applied state. */
    readonly state: (typeof RETAINED_WORLD_SETTLEMENT_STATES)[4];
    /** Semantic user-basis witness observed after complete publication. */
    readonly user_basis_after: string;
};
