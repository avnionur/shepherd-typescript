import { providerProtocolConfig } from "../protocol/config.ts";

/** Error raised after a static provider consumes its complete cassette. */
export class StaticProviderExhaustedError extends Error {
    /** Stable configured machine-readable error code. */
    readonly code = providerProtocolConfig.static.errors.exhaustedCode;
    /** Zero-based cassette position requested by the rejected invocation. */
    readonly position: number;

    /**
     * Creates a cassette-exhaustion error.
     *
     * @param position - Zero-based position requested after the final exchange.
     */
    constructor(position: number) {
        super(providerProtocolConfig.static.errors.exhaustedMessage);
        this.name = "StaticProviderExhaustedError";
        this.position = position;
    }
}

/** Error raised when a request does not match the next static exchange. */
export class StaticProviderRequestMismatchError extends Error {
    /** Stable configured machine-readable error code. */
    readonly code = providerProtocolConfig.static.errors.mismatchCode;
    /** Zero-based cassette position that rejected the request. */
    readonly position: number;

    /**
     * Creates a static request-mismatch error.
     *
     * @param position - Zero-based expected exchange position.
     */
    constructor(position: number) {
        super(providerProtocolConfig.static.errors.mismatchMessage);
        this.name = "StaticProviderRequestMismatchError";
        this.position = position;
    }
}
