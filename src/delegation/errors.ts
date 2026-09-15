import { delegationProtocolConfig } from "../protocol/config.ts";
import { TraceStoreError } from "../store/errors.ts";

const errors = delegationProtocolConfig.errors;

/**
 * Raised when retained or supplied delegation evidence is absent, malformed, or inconsistent.
 *
 * @public
 */
export class DelegationEvidenceError extends TraceStoreError {
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
 * Raised when a delegation command identity already names a retained command with different
 * content.
 *
 * @public
 */
export class DelegationCommandConflictError extends TraceStoreError {
    /** Stable configuration-owned command-conflict code. */
    override readonly code = errors.commandConflictCode;
    /** Conflicting command identity. */
    readonly command_id: string;
    /** Handle the retained command opened or mutated. */
    readonly handle_id: string;

    /**
     * Creates a command-conflict failure.
     *
     * @param handleId - Handle the retained command belongs to.
     * @param commandId - Conflicting command identity.
     */
    constructor(handleId: string, commandId: string) {
        super(errors.commandConflictMessage);
        this.handle_id = handleId;
        this.command_id = commandId;
    }
}

/**
 * Raised when a handle command is admitted against a head that has since moved.
 *
 * No record is written; the caller re-inspects the handle and decides again.
 *
 * @public
 */
export class DelegationHeadConflictError extends TraceStoreError {
    /** Stable configuration-owned head-conflict code. */
    override readonly code = errors.headConflictCode;
    /** Head the command expected. */
    readonly expected_head_record_id: string;
    /** Handle whose head moved. */
    readonly handle_id: string;

    /**
     * Creates a head-conflict failure.
     *
     * @param handleId - Handle whose head moved.
     * @param expectedHeadRecordId - Head the command expected.
     */
    constructor(handleId: string, expectedHeadRecordId: string) {
        super(errors.headConflictMessage);
        this.handle_id = handleId;
        this.expected_head_record_id = expectedHeadRecordId;
    }
}

/**
 * Raised when a requested grant or budget would amplify the parent's authority.
 *
 * @public
 */
export class DelegationAuthorityError extends TraceStoreError {
    /** Stable configuration-owned authority code. */
    override readonly code = errors.authorityCode;

    /**
     * Creates an authority failure.
     *
     * @param detail - Specific description appended to the configured message.
     * @param options - Optional in-memory cause retained for diagnostics.
     */
    constructor(detail: string, options?: ErrorOptions) {
        super(`${errors.authorityMessage}: ${detail}`, options);
    }
}

/**
 * Raised when a handle's derived status does not admit the requested command.
 *
 * @public
 */
export class DelegationStatusError extends TraceStoreError {
    /** Stable configuration-owned status code. */
    override readonly code = errors.statusCode;
    /** Handle whose status refused the command. */
    readonly handle_id: string;
    /** Derived status at refusal. */
    readonly status: string;

    /**
     * Creates a status failure.
     *
     * @param handleId - Handle whose status refused the command.
     * @param status - Derived status at refusal.
     * @param detail - Specific description appended to the configured message.
     */
    constructor(handleId: string, status: string, detail: string) {
        super(`${errors.statusMessage}: ${detail}`);
        this.handle_id = handleId;
        this.status = status;
    }
}

/**
 * Raised when a handle command names a supervisor that does not currently own the handle.
 *
 * Ownership is derived from the opened record and every retained handoff; a former supervisor
 * or an unknown supervisor is refused without writing.
 *
 * @public
 */
export class DelegationSupervisorError extends TraceStoreError {
    /** Stable configuration-owned supervisor-mismatch code. */
    override readonly code = errors.supervisorCode;
    /** Supervisor that currently owns the handle. */
    readonly current_supervisor_id: string;
    /** Handle the command addressed. */
    readonly handle_id: string;
    /** Supervisor the command named. */
    readonly supervisor_id: string;

    /**
     * Creates a supervisor-mismatch failure.
     *
     * @param handleId - Handle the command addressed.
     * @param supervisorId - Supervisor the command named.
     * @param currentSupervisorId - Supervisor that currently owns the handle.
     */
    constructor(handleId: string, supervisorId: string, currentSupervisorId: string) {
        super(errors.supervisorMessage);
        this.handle_id = handleId;
        this.supervisor_id = supervisorId;
        this.current_supervisor_id = currentSupervisorId;
    }
}

/**
 * Raised when a child run whose task value carries revised or synthesized provenance is run before
 * the current supervisor approved it.
 *
 * No child record is written.
 *
 * @public
 */
export class DelegationApprovalRequiredError extends TraceStoreError {
    /** Stable configuration-owned approval-required code. */
    override readonly code = errors.approvalRequiredCode;
    /** Handle awaiting approval. */
    readonly handle_id: string;

    /**
     * Creates an approval-required failure.
     *
     * @param handleId - Handle awaiting approval.
     */
    constructor(handleId: string) {
        super(errors.approvalRequiredMessage);
        this.handle_id = handleId;
    }
}
