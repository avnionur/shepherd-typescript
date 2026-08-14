import type { RETAINED_WORLD_SETTLEMENT_ACTIONS } from "../protocol/values.generated.ts";
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
