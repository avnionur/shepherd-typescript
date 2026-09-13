import type { RecordId } from "../record/types.ts";
import type { ScopeWriter } from "../scope/types.ts";
import type { ReferenceCopyCarrier } from "./types.ts";

/** Closed options for one consume-once merge of a child scope into its owning parent. */
export type MergeScopeOptions = {
    /** Package-created carrier owning both worlds; required when the child owns reference-copy custody. */
    readonly carrier?: ReferenceCopyCarrier;
    /** Authenticated child writer proving child quiescence at admission. */
    readonly child: ScopeWriter;
    /** Globally idempotent merge command identity. */
    readonly commandId: string;
    /** Exact current child head fixed as the merged child cut. */
    readonly expectedChildHeadRecordId: RecordId;
    /** Exact current parent head the merge integrates against. */
    readonly expectedParentHeadRecordId: RecordId;
    /** Unix time used for deterministic fence evaluation; defaults to the current time. */
    readonly nowMilliseconds?: number;
    /** Authenticated owning-parent writer supplying explicit parent authority. */
    readonly parent: ScopeWriter;
};

/** Closed options for one logical discard of an owned child subtree with custody cleanup. */
export type DiscardScopeOptions = {
    /**
     * Package-created carrier owning subtree custody. Without it the logical discard still
     * completes and cleanup of owned custody stays pending for a later retry.
     */
    readonly carrier?: ReferenceCopyCarrier;
    /** Globally idempotent discard command identity. */
    readonly commandId: string;
    /** Exact current head of the discarded subtree root. */
    readonly expectedHeadRecordId: RecordId;
    /** Unix time used for deterministic fence evaluation; defaults to the current time. */
    readonly nowMilliseconds?: number;
    /** Authenticated owning-parent writer supplying explicit parent authority. */
    readonly parent: ScopeWriter;
    /** Exact owned child scope at the root of the discarded subtree. */
    readonly scopeId: string;
};
