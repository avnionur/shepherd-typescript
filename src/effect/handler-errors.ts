import { publicErrorCodes } from "../errors/public-errors.ts";

/** Error thrown when an effect handler stack has no exact-kind match. */
export class EffectHandlerNotFoundError extends Error {
    /** Stable configured machine-readable error code. */
    readonly code = publicErrorCodes.effects.handlerNotFound;
    /** Caller-assigned identity of the unhandled effect intent. */
    public readonly effectId: string;

    /** Application-defined kind of the unhandled effect intent. */
    public readonly kind: string;

    /**
     * Creates an unhandled-effect diagnostic.
     *
     * @param effectId - Caller-assigned effect identity.
     * @param kind - Exact effect kind that could not be resolved.
     */
    public constructor(effectId: string, kind: string) {
        super(`No effect handler matched kind: ${kind}`);
        this.name = "EffectHandlerNotFoundError";
        this.effectId = effectId;
        this.kind = kind;
    }
}
