import { replayProtocolConfig } from "../protocol/config.ts";
import { TraceStoreError } from "../store/errors.ts";

const errors = replayProtocolConfig.errors;

/**
 * Raised when retained or supplied replay evidence is absent, malformed, or inconsistent.
 *
 * @public
 */
export class ReplayEvidenceError extends TraceStoreError {
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
 * Raised when retained replay evidence names an unsupported compatibility or record version.
 *
 * Imported archives from other replay protocol versions remain inspectable as ordinary trace records
 * but are never replayed.
 *
 * @public
 */
export class ReplayCompatibilityError extends TraceStoreError {
    /** Stable configuration-owned compatibility code. */
    override readonly code = errors.compatibilityCode;
    /** Retained compatibility namespace. */
    readonly compatibility_version: unknown;
    /** Retained replay record version. */
    readonly replay_version: unknown;

    /**
     * Creates an unsupported-version failure.
     *
     * @param compatibilityVersion - Retained compatibility namespace.
     * @param replayVersion - Retained replay record version.
     */
    constructor(compatibilityVersion: unknown, replayVersion: unknown) {
        super(errors.compatibilityMessage);
        this.compatibility_version = compatibilityVersion;
        this.replay_version = replayVersion;
    }
}

/**
 * Raised when another unexpired writer holds a replay session lease.
 *
 * @public
 */
export class ReplayLeaseConflictError extends TraceStoreError {
    /** Stable configuration-owned lease-conflict code. */
    override readonly code = errors.leaseConflictCode;
    /** Claim identity currently holding the lease. */
    readonly claim_id: string;
    /** Session whose lease is held. */
    readonly session_id: string;

    /**
     * Creates a held-lease failure.
     *
     * @param sessionId - Session whose lease is held.
     * @param claimId - Current holder.
     */
    constructor(sessionId: string, claimId: string) {
        super(errors.leaseConflictMessage);
        this.session_id = sessionId;
        this.claim_id = claimId;
    }
}

/**
 * Raised when a session writer's lease is released, expired, superseded, or unknown.
 *
 * @public
 */
export class ReplayLeaseFencedError extends TraceStoreError {
    /** Stable configuration-owned fenced-lease code. */
    override readonly code = errors.leaseFencedCode;
    /** Rejected claim identity. */
    readonly claim_id: string;
    /** Session whose append was fenced. */
    readonly session_id: string;

    /**
     * Creates a fenced-lease failure.
     *
     * @param sessionId - Session whose append was rejected.
     * @param claimId - Rejected claim identity.
     */
    constructor(sessionId: string, claimId: string) {
        super(errors.leaseFencedMessage);
        this.session_id = sessionId;
        this.claim_id = claimId;
    }
}

/**
 * Raised when a session command names a non-terminal session that is not held by a live writer.
 *
 * Sessions are never resumed in place; recovery replays from a retained checkpoint or step
 * boundary.
 *
 * @public
 */
export class ReplaySessionInterruptedError extends TraceStoreError {
    /** Stable configuration-owned interrupted-session code. */
    override readonly code = errors.interruptedCode;
    /** Record-derived recovery classification. */
    readonly classification: string;
    /** Interrupted session. */
    readonly session_id: string;

    /**
     * Creates an interrupted-session failure.
     *
     * @param sessionId - Interrupted session.
     * @param classification - Record-derived recovery classification.
     */
    constructor(sessionId: string, classification: string) {
        super(errors.interruptedMessage);
        this.session_id = sessionId;
        this.classification = classification;
    }
}

/**
 * Raised when a session retains an effect admission without its step.
 *
 * The handler may have changed the world, so the effect is never re-invoked and the boundary is
 * never used as a replay target.
 *
 * @public
 */
export class ReplayMaterializationUncertainError extends TraceStoreError {
    /** Stable configuration-owned uncertain-materialization code. */
    override readonly code = errors.materializationUncertainCode;
    /** Retained admission record. */
    readonly admission_record_id: string;
    /** Session requiring manual recovery. */
    readonly session_id: string;

    /**
     * Creates an uncertain-materialization failure.
     *
     * @param sessionId - Session requiring manual recovery.
     * @param admissionRecordId - Retained admission record.
     */
    constructor(sessionId: string, admissionRecordId: string) {
        super(errors.materializationUncertainMessage);
        this.session_id = sessionId;
        this.admission_record_id = admissionRecordId;
    }
}

/**
 * Raised when a replayed prefix differs from the recorded prefix.
 *
 * @public
 */
export class ReplayPrefixMismatchError extends TraceStoreError {
    /** Stable configuration-owned prefix-mismatch code. */
    override readonly code = errors.prefixMismatchCode;
    /** First mismatching step index, or null for a whole-prefix identity mismatch. */
    readonly step_index: number | null;

    /**
     * Creates a prefix-mismatch failure.
     *
     * @param stepIndex - First mismatching step index, or null.
     * @param detail - Specific description appended to the configured message.
     */
    constructor(stepIndex: number | null, detail: string) {
        super(`${errors.prefixMismatchMessage}: ${detail}`);
        this.step_index = stepIndex;
    }
}

/**
 * Raised when a replay target has unavailable constituents.
 *
 * @public
 */
export class ReplayCheckpointUnavailableError extends TraceStoreError {
    /** Stable configuration-owned unavailable-target code. */
    override readonly code = errors.checkpointUnavailableCode;
    /** Unavailable constituents with their retained reasons. */
    readonly unavailable: readonly {
        readonly kind: string;
        readonly name: string | null;
        readonly reason: string;
    }[];

    /**
     * Creates an unavailable-target failure.
     *
     * @param unavailable - Unavailable constituents with their retained reasons.
     */
    constructor(
        unavailable: readonly {
            readonly kind: string;
            readonly name: string | null;
            readonly reason: string;
        }[],
    ) {
        super(
            `${errors.checkpointUnavailableMessage}: ${unavailable
                .map((entry) => `${entry.kind}${entry.name === null ? "" : `:${entry.name}`}`)
                .join(", ")}`,
        );
        this.unavailable = Object.freeze(unavailable.map((entry) => Object.freeze({ ...entry })));
    }
}

/**
 * Raised when a restoration target or restored constituent fails verification.
 *
 * @public
 */
export class ReplayRestoreError extends TraceStoreError {
    /** Stable configuration-owned restoration code. */
    override readonly code = errors.restoreCode;

    /**
     * Creates a restoration failure.
     *
     * @param detail - Specific description appended to the configured message.
     * @param options - Optional in-memory cause retained for diagnostics.
     */
    constructor(detail: string, options?: ErrorOptions) {
        super(`${errors.restoreMessage}: ${detail}`, options);
    }
}

/**
 * Raised to the session program when a branch suffix effect is refused by replay policy.
 *
 * @public
 */
export class ReplayEffectRefusedError extends TraceStoreError {
    /** Stable configuration-owned refused-effect code. */
    override readonly code = errors.effectRefusedCode;
    /** Refused step index. */
    readonly step_index: number;

    /**
     * Creates a refused-effect failure.
     *
     * @param stepIndex - Refused step index.
     */
    constructor(stepIndex: number) {
        super(errors.effectRefusedMessage);
        this.step_index = stepIndex;
    }
}

/**
 * Raised to the session program for a provider or effect step that failed.
 *
 * The same error is raised when the failure first happens and whenever the failed step is served
 * from a recorded prefix, so program control flow is identical in both cases.
 *
 * @public
 */
export class ReplayStepFailureError extends Error {
    /** Stable configuration-owned step-failure code. */
    readonly code = errors.stepFailureCode;
    /** Retained failure class name. */
    readonly failure_name: string;
    /** Retained bounded failure message. */
    readonly failure_message: string;
    /** Failed step index. */
    readonly step_index: number;

    /**
     * Creates a step failure.
     *
     * @param stepIndex - Failed step index.
     * @param failureName - Retained failure class name.
     * @param failureMessage - Retained bounded failure message.
     * @param options - Optional in-memory cause of a live failure.
     */
    constructor(
        stepIndex: number,
        failureName: string,
        failureMessage: string,
        options?: ErrorOptions,
    ) {
        super(
            `${errors.stepFailureMessage}: ${stepIndex}: ${failureName}: ${failureMessage}`,
            options,
        );
        this.name = "ReplayStepFailureError";
        this.step_index = stepIndex;
        this.failure_name = failureName;
        this.failure_message = failureMessage;
    }
}
