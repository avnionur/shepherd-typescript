import { supervisionProtocolConfig } from "../protocol/config.ts";
import { TraceStoreError } from "../store/errors.ts";

const errors = supervisionProtocolConfig.errors;

/**
 * Raised when retained or cited supervision evidence is absent, malformed, or inconsistent.
 *
 * @public
 */
export class SupervisionEvidenceError extends TraceStoreError {
    /** Stable configuration-owned invalid-evidence code. */
    override readonly code = errors.evidenceCode;

    /**
     * Creates an invalid-evidence failure.
     *
     * @param detail - Specific description appended to the configured message.
     * @param options - Optional in-memory cause retained for diagnostics.
     */
    constructor(detail: string, options?: ErrorOptions) {
        super(`${errors.evidenceMessage}: ${detail}`, options);
    }
}

/**
 * Raised when a subscription cursor regresses, passes delivered records, or names different owners.
 *
 * @public
 */
export class SupervisionCursorConflictError extends TraceStoreError {
    /** Stable configuration-owned cursor-conflict code. */
    override readonly code = errors.cursorConflictCode;
    /** Durable subscription identity, or null for an ephemeral subscription. */
    readonly subscription_id: string | null;

    /**
     * Creates a cursor-conflict failure.
     *
     * @param subscriptionId - Durable subscription identity, or null when ephemeral.
     * @param detail - Specific description appended to the configured message.
     */
    constructor(subscriptionId: string | null, detail: string) {
        super(`${errors.cursorConflictMessage}: ${detail}`);
        this.subscription_id = subscriptionId;
    }
}

/**
 * Raised when subscription lag exceeds the bound declared with the `fail` overflow policy.
 *
 * The acknowledged cursor is unchanged, so a reconnect resumes without loss.
 *
 * @public
 */
export class SupervisionSubscriptionOverflowError extends TraceStoreError {
    /** Stable configuration-owned overflow code. */
    override readonly code = errors.overflowCode;
    /** Retained records not yet delivered when the bound was exceeded. */
    readonly lag_records: number;
    /** Declared maximum lag. */
    readonly max_lag_records: number;

    /**
     * Creates an overflow failure.
     *
     * @param lagRecords - Retained but undelivered record count.
     * @param maxLagRecords - Declared lag bound.
     */
    constructor(lagRecords: number, maxLagRecords: number) {
        super(errors.overflowMessage);
        this.lag_records = lagRecords;
        this.max_lag_records = maxLagRecords;
    }
}

/**
 * Raised when another unexpired dispatcher holds a supervised dispatch decision lease.
 *
 * @public
 */
export class SupervisionLeaseConflictError extends TraceStoreError {
    /** Stable configuration-owned lease-conflict code. */
    override readonly code = errors.leaseConflictCode;
    /** Claim identity currently holding the lease. */
    readonly claim_id: string;
    /** Dispatch whose lease is held. */
    readonly dispatch_id: string;

    /**
     * Creates a held-lease failure.
     *
     * @param dispatchId - Dispatch whose lease is held.
     * @param claimId - Current holder.
     */
    constructor(dispatchId: string, claimId: string) {
        super(errors.leaseConflictMessage);
        this.dispatch_id = dispatchId;
        this.claim_id = claimId;
    }
}

/**
 * Raised when a dispatcher's decision lease is released, expired, superseded, or unknown.
 *
 * @public
 */
export class SupervisionLeaseFencedError extends TraceStoreError {
    /** Stable configuration-owned fenced-lease code. */
    override readonly code = errors.leaseFencedCode;
    /** Rejected claim identity. */
    readonly claim_id: string;
    /** Dispatch whose append was fenced. */
    readonly dispatch_id: string;

    /**
     * Creates a fenced-lease failure.
     *
     * @param dispatchId - Dispatch whose command was rejected.
     * @param claimId - Rejected claim identity.
     */
    constructor(dispatchId: string, claimId: string) {
        super(errors.leaseFencedMessage);
        this.dispatch_id = dispatchId;
        this.claim_id = claimId;
    }
}

/**
 * Raised when a supervised effect retains admission without resolution.
 *
 * The handler may have changed the world. The runtime neither retries it nor fabricates an outcome.
 *
 * @public
 */
export class SupervisionMaterializationUncertainError extends TraceStoreError {
    /** Stable configuration-owned uncertain-materialization code. */
    override readonly code = errors.materializationUncertainCode;
    /** Retained admission record. */
    readonly admission_record_id: string;
    /** Dispatch requiring manual recovery. */
    readonly dispatch_id: string;

    /**
     * Creates an uncertain-materialization failure.
     *
     * @param dispatchId - Dispatch requiring manual recovery.
     * @param admissionRecordId - Retained admission record.
     */
    constructor(dispatchId: string, admissionRecordId: string) {
        super(errors.materializationUncertainMessage);
        this.dispatch_id = dispatchId;
        this.admission_record_id = admissionRecordId;
    }
}

/**
 * Raised when an approval verdict names no current pending approval request.
 *
 * @public
 */
export class SupervisionApprovalConflictError extends TraceStoreError {
    /** Stable configuration-owned approval-conflict code. */
    override readonly code = errors.approvalConflictCode;
    /** Dispatch the verdict targeted. */
    readonly dispatch_id: string;

    /**
     * Creates an approval-conflict failure.
     *
     * @param dispatchId - Dispatch whose pending request does not match.
     */
    constructor(dispatchId: string) {
        super(errors.approvalConflictMessage);
        this.dispatch_id = dispatchId;
    }
}
