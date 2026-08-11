import { runProtocolConfig } from "../protocol/config.ts";
import {
    DURABLE_EXECUTION_INVOCATION_CLAIM_STATUSES,
    DURABLE_EXECUTION_RECOVERY_STATUSES,
} from "../protocol/values.generated.ts";
import { TraceStoreError } from "../store/errors.ts";

const [
    ABSENT_RECOVERY_STATUS,
    CREATED_RECOVERY_STATUS,
    STARTED_RECOVERY_STATUS,
    TERMINAL_PENDING_CUT_STATUS,
] = DURABLE_EXECUTION_RECOVERY_STATUSES;
const [, LOST_CLAIM_STATUS] = DURABLE_EXECUTION_INVOCATION_CLAIM_STATUSES;

/** Raised when recovery is requested for a run without retained creation evidence. */
export class DurableExecutionRecoveryAbsentError extends TraceStoreError {
    /** Stable configuration-owned absent-recovery error code. */
    readonly code = runProtocolConfig.execution.errors.recoveryAbsentCode;
    /** Run that has no durable creation evidence. */
    readonly run_id: string;
    /** Typed absent recovery status. */
    readonly status = ABSENT_RECOVERY_STATUS;

    /**
     * Creates an absent-run recovery failure.
     *
     * @param runId - Run that cannot be recovered because it has no creation evidence.
     */
    constructor(runId: string) {
        super(runProtocolConfig.execution.errors.recoveryAbsentMessage);
        this.run_id = runId;
    }
}

/** Raised when durable evidence cannot prove that provider invocation is safe to repeat. */
export class DurableExecutionRecoveryError extends TraceStoreError {
    /** Stable configuration-owned recovery error code. */
    readonly code: string;
    /** Run whose retained start has no terminal evidence. */
    readonly run_id: string;
    /** Unsafe durable recovery state. */
    readonly status = STARTED_RECOVERY_STATUS;

    /**
     * Creates an unsafe-started-run recovery failure.
     *
     * @param runId - Run whose provider may already have been invoked.
     */
    constructor(runId: string) {
        super(runProtocolConfig.execution.errors.recoveryStartedMessage);
        this.code = runProtocolConfig.execution.errors.recoveryStartedCode;
        this.run_id = runId;
    }
}

/** Raised when an existing incomplete execution requires an explicit durable command. */
export class DurableExecutionRecoveryCommandRequiredError extends TraceStoreError {
    /** Stable configuration-owned command-required error code. */
    readonly code = runProtocolConfig.execution.errors.recoveryCommandRequiredCode;
    /** Run whose incomplete evidence requires explicit recovery authority. */
    readonly run_id: string;
    /** Incomplete state that cannot be advanced by ordinary execution. */
    readonly status: typeof CREATED_RECOVERY_STATUS | typeof TERMINAL_PENDING_CUT_STATUS;

    /**
     * Creates an explicit-command-required recovery failure.
     *
     * @param runId - Run whose incomplete evidence requires recovery authority.
     * @param status - Recoverable incomplete state rejected by ordinary execution.
     */
    constructor(
        runId: string,
        status: typeof CREATED_RECOVERY_STATUS | typeof TERMINAL_PENDING_CUT_STATUS,
    ) {
        super(runProtocolConfig.execution.errors.recoveryCommandRequiredMessage);
        this.run_id = runId;
        this.status = status;
    }
}

/** Raised when another caller already owns the durable provider-invocation claim. */
export class DurableExecutionClaimLostError extends TraceStoreError {
    /** Stable configuration-owned claim-loss error code. */
    readonly code = runProtocolConfig.execution.errors.claimLostCode;
    /** Claim identity that won admission. */
    readonly claim_id: string;
    /** Run whose invocation boundary is owned by another caller. */
    readonly run_id: string;
    /** Typed losing-claim result status. */
    readonly status = LOST_CLAIM_STATUS;

    /**
     * Creates a typed losing-claim result.
     *
     * @param runId - Run whose invocation boundary is already claimed.
     * @param claimId - Current winning claim identity.
     */
    constructor(runId: string, claimId: string) {
        super(runProtocolConfig.execution.errors.claimLostMessage);
        this.run_id = runId;
        this.claim_id = claimId;
    }
}

/** Raised when an invocation claim expires or is superseded before start publication. */
export class DurableExecutionClaimFencedError extends TraceStoreError {
    /** Stable configuration-owned fencing error code. */
    readonly code = runProtocolConfig.execution.errors.claimFencedCode;
    /** Claim identity rejected at the start boundary. */
    readonly claim_id: string;
    /** Run whose start publication was fenced. */
    readonly run_id: string;

    /**
     * Creates an expired-or-superseded claim failure.
     *
     * @param runId - Run whose start publication was rejected.
     * @param claimId - Rejected claim identity.
     */
    constructor(runId: string, claimId: string) {
        super(runProtocolConfig.execution.errors.claimFencedMessage);
        this.run_id = runId;
        this.claim_id = claimId;
    }
}
