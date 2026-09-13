import type { SemanticRecord } from "../canonical/canonical-record.ts";
import type {
    SCOPE_SCHEDULING_DECISIONS,
    SCOPE_SCHEDULING_OUTCOMES,
} from "../protocol/values.generated.ts";
import type {
    ScopeEmissionReceipt,
    ScopeResourceGrantRequest,
    ScopeWriter,
} from "../scope/types.ts";
import type { ReferenceCopyCarrier, WorkspaceBinding } from "./types.ts";

/** Configured settlement decision a scheduled scope returns: merge or discard. */
export type ScopeTreeDecision = (typeof SCOPE_SCHEDULING_DECISIONS)[number];

/** Configured outcome of one scheduled scope: merged, discarded, conflicted, or failed. */
export type ScopeTreeOutcomeStatus = (typeof SCOPE_SCHEDULING_OUTCOMES)[number];

/** Live context handed to one scheduled scope's work after its children settled. */
export type ScopeTreeContext = {
    /** Settled outcomes of this scope's children in declared order. */
    readonly children: readonly ScopeTreeOutcome[];
    /** Mutable custody path of a reference-copy scope, otherwise null. */
    readonly custodyPath: string | null;
    /**
     * Emits validated application data under a deterministic command identity derived from the
     * scope path and key, so re-running work after a restart never duplicates the emission.
     *
     * @param key - Emission key unique within this scope.
     * @param data - Canonical application data.
     * @returns Original emission receipt, replayed when already retained.
     */
    readonly emit: (key: string, data: SemanticRecord) => ScopeEmissionReceipt;
    /** Node keys from the tree root to this scope. */
    readonly path: readonly string[];
    /** Scheduled scope identity. */
    readonly scopeId: string;
    /** Current writer of the scheduled scope. */
    readonly writer: ScopeWriter;
};

/** One declared scope in a scheduled tree. */
export type ScopeTreeNode = {
    /** Child scopes settled before this scope's own work runs. */
    readonly children?: readonly ScopeTreeNode[];
    /** Forks a reference-copy world of this binding from the parent world when present. */
    readonly fork?: {
        /** Package-created binding naming the single bound resource. */
        readonly binding: WorkspaceBinding;
    };
    /** Requested authority attenuated by the parent and ceiling. */
    readonly grant: ScopeResourceGrantRequest;
    /** Key unique among siblings, used in deterministic command identities. */
    readonly key: string;
    /**
     * Caller work returning the settlement decision; defaults to merge. Work may run again after
     * a restart until its scope settles, so side effects must be idempotent; use `emit`.
     */
    readonly run?: (context: ScopeTreeContext) => Promise<ScopeTreeDecision> | ScopeTreeDecision;
};

/** Settled result of one scheduled scope. */
export type ScopeTreeOutcome = {
    /** Settled child outcomes in declared order. */
    readonly children: readonly ScopeTreeOutcome[];
    /** Work failure description, or null. */
    readonly failure: string | null;
    /** Declared node key. */
    readonly key: string;
    /** Scheduled scope identity. */
    readonly scope_id: string;
    /** Settled outcome. */
    readonly status: ScopeTreeOutcomeStatus;
};

/** Closed options for scheduling a tree of child scopes under one parent writer. */
export type RunScopeTreeOptions = {
    /** Package-created carrier; required when any node forks a world. */
    readonly carrier?: ReferenceCopyCarrier;
    /** Child scopes of the parent in declared order. */
    readonly children: readonly ScopeTreeNode[];
    /** Deterministic prefix of every scheduled command and writer claim identity. */
    readonly commandPrefix: string;
    /** Maximum sibling subtrees running concurrently, within the configured bound. */
    readonly maxParallel: number;
    /** Authenticated writer of the parent scope. */
    readonly parent: ScopeWriter;
};

/** Settled report of one scheduled tree. */
export type ScopeTreeReport = {
    /** Settled outcomes of the parent's children in declared order. */
    readonly outcomes: readonly ScopeTreeOutcome[];
    /** Parent scope identity. */
    readonly parent_scope_id: string;
};
