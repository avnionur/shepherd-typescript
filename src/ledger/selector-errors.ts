import { projectionProtocolConfig } from "../protocol/config.ts";

type LedgerErrorPolicy = {
    readonly ambiguousCode: string;
    readonly ambiguousMessage: string;
    readonly notFoundCode: string;
    readonly notFoundMessage: string;
};

/** Raised when one read selector matches more than one ledger entry. */
export class LedgerSelectorAmbiguousError extends Error {
    /** Stable machine-readable selector ambiguity code. */
    readonly code: string;

    /**
     * @param message - Technical selector ambiguity description.
     * @param code - Stable machine-readable ambiguity code.
     */
    constructor(
        message: string,
        code = projectionProtocolConfig.taskRunLedgers.errors.ambiguousCode,
    ) {
        super(message);
        this.code = code;
        this.name = "LedgerSelectorAmbiguousError";
    }
}

/** Raised when one valid read selector matches no ledger entry. */
export class LedgerSelectorNotFoundError extends Error {
    /** Stable machine-readable missing-selector code. */
    readonly code: string;

    /**
     * @param message - Technical missing-selector description.
     * @param code - Stable machine-readable missing-selector code.
     */
    constructor(
        message: string,
        code = projectionProtocolConfig.taskRunLedgers.errors.notFoundCode,
    ) {
        super(message);
        this.code = code;
        this.name = "LedgerSelectorNotFoundError";
    }
}

/** Creates one configured ambiguity error for a validated selector. @internal */
export function ambiguousLedgerSelector(
    selector: string,
    policy: LedgerErrorPolicy = projectionProtocolConfig.taskRunLedgers.errors,
): LedgerSelectorAmbiguousError {
    return new LedgerSelectorAmbiguousError(
        `${policy.ambiguousMessage}: ${selector}`,
        policy.ambiguousCode,
    );
}

/** Creates one configured missing error for a validated selector. @internal */
export function missingLedgerSelector(
    selector: string,
    policy: LedgerErrorPolicy = projectionProtocolConfig.taskRunLedgers.errors,
): LedgerSelectorNotFoundError {
    return new LedgerSelectorNotFoundError(
        `${policy.notFoundMessage}: ${selector}`,
        policy.notFoundCode,
    );
}
