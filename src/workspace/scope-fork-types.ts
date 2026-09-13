import type { RecordId } from "../record/types.ts";
import type { ScopeResourceGrantRequest, ScopeWriter } from "../scope/types.ts";
import type { ReferenceCopyCarrier, WorkspaceBinding } from "./types.ts";

/** Closed options for one reference-copy scope fork under explicit parent writer authority. */
export type ForkScopeOptions = {
    /** Package-created binding naming the single active bound resource. */
    readonly binding: WorkspaceBinding;
    /** Package-created reference-copy carrier owning the child custody. */
    readonly carrier: ReferenceCopyCarrier;
    /** Globally idempotent fork command identity. */
    readonly commandId: string;
    /** Optional durable execution owner path with retained creation evidence. */
    readonly executionId?: string;
    /** Exact current parent head fixed as the child's trace origin. */
    readonly expectedHeadRecordId: RecordId;
    /** Requested child authority attenuated by parent and ceiling; must grant the bound resource. */
    readonly grant: ScopeResourceGrantRequest;
    /** Unix time used for deterministic fence evaluation; defaults to the current time. */
    readonly nowMilliseconds?: number;
    /**
     * Exact immutable origin revision: a binding snapshot for a trace-only parent, or a capture
     * of the parent world's current custody for a forked parent.
     */
    readonly originRevisionId: string;
    /** Authenticated parent writer supplying explicit parent authority and quiescence. */
    readonly parent: ScopeWriter;
};
