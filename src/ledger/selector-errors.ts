import { projectionProtocolConfig } from "../protocol/config.ts";

/** Raised when one read selector matches more than one ledger entry. */
export class LedgerSelectorAmbiguousError extends Error {
    /** Stable machine-readable selector ambiguity code. */
    readonly code = projectionProtocolConfig.taskRunLedgers.errors.ambiguousCode;

    /** @param message - Technical selector ambiguity description. */
    constructor(message: string) {
        super(message);
        this.name = "LedgerSelectorAmbiguousError";
    }
}

/** Raised when one valid read selector matches no ledger entry. */
export class LedgerSelectorNotFoundError extends Error {
    /** Stable machine-readable missing-selector code. */
    readonly code = projectionProtocolConfig.taskRunLedgers.errors.notFoundCode;

    /** @param message - Technical missing-selector description. */
    constructor(message: string) {
        super(message);
        this.name = "LedgerSelectorNotFoundError";
    }
}

/** Creates one configured ambiguity error for a validated selector. @internal */
export function ambiguousLedgerSelector(selector: string): LedgerSelectorAmbiguousError {
    return new LedgerSelectorAmbiguousError(
        `${projectionProtocolConfig.taskRunLedgers.errors.ambiguousMessage}: ${selector}`,
    );
}

/** Creates one configured missing error for a validated selector. @internal */
export function missingLedgerSelector(selector: string): LedgerSelectorNotFoundError {
    return new LedgerSelectorNotFoundError(
        `${projectionProtocolConfig.taskRunLedgers.errors.notFoundMessage}: ${selector}`,
    );
}
