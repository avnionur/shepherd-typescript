import { scopeProtocolConfig } from "../protocol/config.ts";
import { TraceStoreError } from "../store/errors.ts";
import type { RetainedWorldApplicationConflictEvidence } from "../workspace/retained-world-application-types.ts";

/**
 * Raised when a scope authority request cites unknown resources or exceeds parent or ceiling authority.
 *
 * @public
 */
export class ScopeAuthorityError extends TraceStoreError {
    /** Stable configuration-owned refused-authority code. */
    override readonly code = scopeProtocolConfig.errors.authorityCode;

    /**
     * Creates a refused-authority failure.
     *
     * @param detail - Optional specific refusal description appended to the configured message.
     */
    constructor(detail?: string) {
        super(
            detail === undefined
                ? scopeProtocolConfig.errors.authorityMessage
                : `${scopeProtocolConfig.errors.authorityMessage}: ${detail}`,
        );
    }
}

/**
 * Raised when retained or cited scope evidence is absent, malformed, or inconsistent.
 *
 * @public
 */
export class ScopeEvidenceError extends TraceStoreError {
    /** Stable configuration-owned invalid-evidence code. */
    override readonly code = scopeProtocolConfig.errors.evidenceCode;

    /**
     * Creates an invalid-evidence failure.
     *
     * @param detail - Optional specific description appended to the configured message.
     * @param options - Optional in-memory cause retained for diagnostics.
     */
    constructor(detail?: string, options?: ErrorOptions) {
        super(
            detail === undefined
                ? scopeProtocolConfig.errors.evidenceMessage
                : `${scopeProtocolConfig.errors.evidenceMessage}: ${detail}`,
            options,
        );
    }
}

/**
 * Raised when a scope command names an expected head that is no longer current.
 *
 * @public
 */
export class ScopeHeadConflictError extends TraceStoreError {
    /** Stable configuration-owned stale-head code. */
    override readonly code = scopeProtocolConfig.errors.headConflictCode;
    /** Scope whose head advanced past the caller's expectation. */
    readonly scope_id: string;

    /**
     * Creates a stale expected-head failure.
     *
     * @param scopeId - Scope whose current head disagrees with the command.
     */
    constructor(scopeId: string) {
        super(scopeProtocolConfig.errors.headConflictMessage);
        this.scope_id = scopeId;
    }
}

/**
 * Raised when another unexpired caller holds the scope writer claim.
 *
 * @public
 */
export class ScopeWriterConflictError extends TraceStoreError {
    /** Stable configuration-owned writer-conflict code. */
    override readonly code = scopeProtocolConfig.errors.writerConflictCode;
    /** Claim identity currently holding the scope. */
    readonly claim_id: string;
    /** Scope whose writer authority is held by another caller. */
    readonly scope_id: string;

    /**
     * Creates a lost writer-claim failure.
     *
     * @param scopeId - Scope whose writer claim is held.
     * @param claimId - Winning claim identity.
     */
    constructor(scopeId: string, claimId: string) {
        super(scopeProtocolConfig.errors.writerConflictMessage);
        this.scope_id = scopeId;
        this.claim_id = claimId;
    }
}

/**
 * Raised when a scope writer fence is released, expired, superseded, or unknown.
 *
 * @public
 */
export class ScopeWriterFencedError extends TraceStoreError {
    /** Stable configuration-owned fenced-writer code. */
    override readonly code = scopeProtocolConfig.errors.writerFencedCode;
    /** Claim identity rejected at the command boundary. */
    readonly claim_id: string;
    /** Scope whose command was fenced. */
    readonly scope_id: string;

    /**
     * Creates a fenced-writer failure.
     *
     * @param scopeId - Scope whose command was rejected.
     * @param claimId - Rejected claim identity.
     */
    constructor(scopeId: string, claimId: string) {
        super(scopeProtocolConfig.errors.writerFencedMessage);
        this.scope_id = scopeId;
        this.claim_id = claimId;
    }
}

/**
 * Raised when a merge's child delta and current-parent delta from their common origin overlap.
 *
 * The refusal retains nothing and consumes neither scope.
 *
 * @public
 */
export class ScopeMergeConflictError extends TraceStoreError {
    /** Stable configuration-owned merge-conflict code. */
    override readonly code = scopeProtocolConfig.errors.mergeConflictCode;
    /** Content-addressed bounded portable path-conflict evidence. */
    readonly conflict: RetainedWorldApplicationConflictEvidence;

    /**
     * Creates an overlapping-merge failure.
     *
     * @param conflict - Exact conflict evidence between the child and current-parent changed paths.
     */
    constructor(conflict: RetainedWorldApplicationConflictEvidence) {
        super(scopeProtocolConfig.errors.mergeConflictMessage);
        this.conflict = conflict;
    }
}

/**
 * Raised when affected scopes are not quiescent: a live descendant, a pending command, or an
 * unreleased writer claim.
 *
 * @public
 */
export class ScopeQuiescenceError extends TraceStoreError {
    /** Stable configuration-owned not-quiescent code. */
    override readonly code = scopeProtocolConfig.errors.quiescenceCode;
    /** Scope whose state blocks the operation. */
    readonly scope_id: string;

    /**
     * Creates a not-quiescent failure.
     *
     * @param scopeId - Scope whose live state blocks the operation.
     * @param detail - Specific description appended to the configured message.
     */
    constructor(scopeId: string, detail: string) {
        super(`${scopeProtocolConfig.errors.quiescenceMessage}: ${detail}`);
        this.scope_id = scopeId;
    }
}

/**
 * Raised when a scope is merged, discarded, or reserved by another terminal decision.
 *
 * @public
 */
export class ScopeTerminalConflictError extends TraceStoreError {
    /** Stable configuration-owned terminal-conflict code. */
    override readonly code = scopeProtocolConfig.errors.terminalConflictCode;
    /** Scope whose terminal state refuses the command. */
    readonly scope_id: string;

    /**
     * Creates a terminal-conflict failure.
     *
     * @param scopeId - Scope that is not open or already retains another terminal decision.
     */
    constructor(scopeId: string) {
        super(scopeProtocolConfig.errors.terminalConflictMessage);
        this.scope_id = scopeId;
    }
}
