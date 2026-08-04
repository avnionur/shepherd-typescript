import type { SemanticValue } from "../canonical/canonical-record.ts";
import { createCanonicalSnapshot } from "../canonical/snapshot.ts";
import { effectProtocolConfig } from "../protocol/config.ts";
import { EffectHandlerNotFoundError } from "./handler-errors.ts";
import type { EffectHandler, EffectHandlerDispatch, EffectHandlerStack } from "./handler-types.ts";
import { createEffectOutcome } from "./records.ts";
import type { EffectIntent, EffectResult } from "./types.ts";
import { readEffectIntent } from "./validation.ts";

type HandlerBinding = Readonly<{
    handle: EffectHandler["handle"];
    handlerId: string;
    kind: string;
}>;

const selectHandler = {
    last_matching: (bindings: readonly HandlerBinding[], kind: string) => {
        for (let index = bindings.length - 1; index >= 0; index -= 1) {
            const binding = bindings[index];
            if (binding?.kind === kind) {
                return binding;
            }
        }
        return undefined;
    },
} satisfies Record<
    (typeof effectProtocolConfig.handlers)["selection"],
    (bindings: readonly HandlerBinding[], kind: string) => HandlerBinding | undefined
>;

const handleUnhandled = {
    throw: (intent: EffectIntent): never => {
        throw new EffectHandlerNotFoundError(intent.effect_id, intent.kind);
    },
} satisfies Record<
    (typeof effectProtocolConfig.handlers)["unhandled"],
    (intent: EffectIntent) => never
>;

/**
 * Creates an immutable exact-kind effect handler stack.
 *
 * Definitions are validated and snapshotted in installation order. The active protocol selects
 * the last matching handler, mirroring nearest dynamically scoped handler precedence.
 *
 * @param handlers - Ordered exact-kind handler definitions.
 * @returns An immutable stack that validates intents before invoking a handler.
 * @throws {TypeError} If the handler array or any definition is malformed or IDs are duplicated.
 *
 * @example
 * ```ts
 * const handlers = createEffectHandlerStack([{
 *     handlerId: "local.tool",
 *     kind: "tool.call",
 *     handle: (intent) => ({ ok: true, value: intent.effect_id }),
 * }]);
 * const dispatch = await handlers.dispatch(intent);
 * ```
 */
export function createEffectHandlerStack(handlers: readonly EffectHandler[]): EffectHandlerStack {
    const bindings = readHandlerBindings(handlers);
    return Object.freeze({
        dispatch: async <K extends string, P extends SemanticValue>(intent: EffectIntent<K, P>) => {
            const validated = readEffectIntent(intent);
            const snapshot = createCanonicalSnapshot(validated) as EffectIntent<K, P>;
            const binding = selectHandler[effectProtocolConfig.handlers.selection](
                bindings,
                snapshot.kind,
            );
            if (binding === undefined) {
                return handleUnhandled[effectProtocolConfig.handlers.unhandled](snapshot);
            }
            const result = (await binding.handle(snapshot)) as EffectResult<
                SemanticValue,
                SemanticValue
            >;
            return Object.freeze({
                handlerId: binding.handlerId,
                outcome: createEffectOutcome(snapshot, result),
            }) as EffectHandlerDispatch<K>;
        },
    });
}

function readHandlerBindings(value: unknown): readonly HandlerBinding[] {
    if (!Array.isArray(value) || Object.getOwnPropertySymbols(value).length > 0) {
        throw new TypeError("effect handlers must be a data array");
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const allowedKeys = new Set(["length"]);
    const bindings: HandlerBinding[] = [];
    const handlerIds = new Set<string>();
    for (let index = 0; index < value.length; index += 1) {
        const key = String(index);
        allowedKeys.add(key);
        const descriptor = descriptors[key];
        if (descriptor === undefined || !("value" in descriptor)) {
            throw new TypeError(`effect handlers[${index}] must be a data element`);
        }
        const binding = readHandlerBinding(descriptor.value, index);
        if (handlerIds.has(binding.handlerId)) {
            throw new TypeError("effect handler IDs must be unique");
        }
        handlerIds.add(binding.handlerId);
        bindings.push(binding);
    }
    if (Object.keys(descriptors).some((key) => !allowedKeys.has(key))) {
        throw new TypeError("effect handlers must not contain custom properties");
    }
    return Object.freeze(bindings);
}

function readHandlerBinding(value: unknown, index: number): HandlerBinding {
    if (
        value === null ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        (Object.getPrototypeOf(value) !== Object.prototype &&
            Object.getPrototypeOf(value) !== null) ||
        Object.getOwnPropertySymbols(value).length > 0
    ) {
        throw new TypeError(`effect handlers[${index}] must be a plain data object`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = ["handle", "handlerId", "kind"];
    if (Object.keys(descriptors).sort().join("\0") !== keys.join("\0")) {
        throw new TypeError(`effect handlers[${index}] must contain exactly its declared fields`);
    }
    const fields = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
        const descriptor = descriptors[key];
        if (descriptor === undefined || !("value" in descriptor)) {
            throw new TypeError(`effect handlers[${index}].${key} must be a data property`);
        }
        fields[key] = descriptor.value;
    }
    assertText(fields.handlerId, `effect handlers[${index}].handlerId`);
    assertText(fields.kind, `effect handlers[${index}].kind`);
    if (typeof fields.handle !== "function") {
        throw new TypeError(`effect handlers[${index}].handle must be a function`);
    }
    return Object.freeze({
        handle: fields.handle as EffectHandler["handle"],
        handlerId: fields.handlerId,
        kind: fields.kind,
    });
}

function assertText(value: unknown, subject: string): asserts value is string {
    if (typeof value !== "string" || value.length === 0 || /[\uD800-\uDFFF]/u.test(value)) {
        throw new TypeError(`${subject} must be a non-empty well-formed string`);
    }
}
