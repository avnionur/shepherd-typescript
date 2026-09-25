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

/** Configured live-provider failure reason. */
export type LiveProviderErrorReason = "credential" | "http" | "response" | "transport";

/**
 * Error raised by a live provider adapter. Its message never contains the provider credential:
 * provider-supplied detail is bounded and every occurrence of the credential is redacted before
 * the message is built.
 */
export class LiveProviderError extends Error {
    /** Stable configured machine-readable error code. */
    readonly code: string;
    /** Failure reason. */
    readonly reason: LiveProviderErrorReason;
    /** HTTP status for an `http` failure, otherwise null. */
    readonly status: number | null;

    /**
     * Creates a live-provider failure.
     *
     * @param reason - Failure reason selecting the configured code and message.
     * @param detail - Already-redacted bounded detail appended to the configured message, or null.
     * @param status - HTTP status for an `http` failure, otherwise null.
     * @param options - Standard error options; a cause stays an in-memory diagnostic.
     */
    constructor(
        reason: LiveProviderErrorReason,
        detail: string | null,
        status: number | null = null,
        options?: ErrorOptions,
    ) {
        const errors = providerProtocolConfig.live.errors;
        const [code, message] = (
            {
                credential: [errors.credentialCode, errors.credentialMessage],
                http: [errors.httpCode, errors.httpMessage],
                response: [errors.responseCode, errors.responseMessage],
                transport: [errors.transportCode, errors.transportMessage],
            } as const
        )[reason];
        super(detail === null ? message : `${message}: ${detail}`, options);
        this.name = "LiveProviderError";
        this.code = code;
        this.reason = reason;
        this.status = status;
    }
}
