import type { SemanticValue } from "../canonical/canonical-record.ts";
import { createCanonicalSnapshot } from "../canonical/snapshot.ts";
import { assertNonEmptyString } from "../record/guards.ts";
import { type TaskSchema, taskSchemaMetadata } from "../task/schema.ts";
import type { EffectHandler } from "./handler-types.ts";
import type { EffectIntent, EffectResult } from "./types.ts";
import { readDataObject, readEffectIntent, readEffectResult } from "./validation.ts";

/** Definition of an in-process effect handler with an inferred, validated payload. */
export type TypedEffectHandlerOptions<P> = {
    /** Stable diagnostic identity used by ordinary stack precedence. */
    readonly handlerId: string;
    /** Exact effect kind accepted by this handler. */
    readonly kind: string;
    /** Package-created runtime schema that authenticates and parses the payload. */
    readonly payloadSchema: TaskSchema<P>;
    /**
     * Interprets a validated payload and immutable canonical intent.
     *
     * @param payload - Immutable schema-parsed value; void schemas yield undefined.
     * @param intent - Immutable original intent, preserving its canonical payload and identity.
     * @returns Canonical success/failure data, synchronously or asynchronously.
     * @throws Callback failures propagate unchanged.
     */
    readonly handle: (
        payload: P,
        intent: EffectIntent,
    ) =>
        | EffectResult<SemanticValue, SemanticValue>
        | Promise<EffectResult<SemanticValue, SemanticValue>>;
};

/**
 * Adapts a schema-validated typed callback to an ordinary immutable effect handler.
 *
 * @param options - Exact kind/identity, package-created payload schema, and callback.
 * @returns A frozen handler accepted by createEffectHandlerStack. Direct handle calls also
 * validate the canonical intent, kind, payload, and returned semantic result.
 * @throws {TypeError} If options or schema are invalid. Returned handle calls reject invalid
 * intents, wrong kinds, malformed payloads, or malformed results before exposing them.
 * @throws Returned handle calls propagate callback errors unchanged.
 *
 * @example
 * const handler = createTypedEffectHandler({
 *   handlerId: "format", kind: "text.format",
 *   payloadSchema: schema.object({ text: schema.string() }),
 *   handle: ({ text }) => ({ ok: true, value: text.toUpperCase() }),
 * });
 */
export function createTypedEffectHandler<P>(options: TypedEffectHandlerOptions<P>): EffectHandler {
    const fields = readDataObject(
        options,
        ["handlerId", "kind", "payloadSchema", "handle"],
        "typed effect handler",
    );
    assertNonEmptyString(fields.handlerId, "handlerId");
    assertNonEmptyString(fields.kind, "kind");
    if (typeof fields.handle !== "function")
        throw new TypeError("typed effect handler handle must be a function");
    const metadata = taskSchemaMetadata(fields.payloadSchema as TaskSchema<P>);
    const handle = fields.handle as TypedEffectHandlerOptions<P>["handle"];
    const { handlerId, kind } = fields;
    return Object.freeze({
        handlerId,
        kind,
        handle: async (intent: EffectIntent) => {
            const validated = createCanonicalSnapshot(readEffectIntent(intent)) as EffectIntent;
            if (validated.kind !== kind)
                throw new TypeError("typed effect handler kind does not match intent");
            const payload = metadata.parse(validated.payload, "$");
            return createCanonicalSnapshot(
                readEffectResult(await handle(payload, validated)),
            ) as EffectResult<SemanticValue, SemanticValue>;
        },
    });
}
