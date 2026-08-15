import type {
    RETAINED_WORLD_SETTLEMENT_ACTIONS,
    RETAINED_WORLD_SETTLEMENT_STATES,
    RETAINED_WORLD_SETTLEMENT_VERSION,
} from "../protocol/values.generated.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import type {
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
