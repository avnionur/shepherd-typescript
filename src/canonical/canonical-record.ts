import { createHash } from "node:crypto";

import { kernelProtocolConfig, recordIdConfig } from "../protocol/config.ts";
import { CanonicalNestingLimitError } from "./errors.ts";
import { serializeJsonText } from "./json-text.ts";

/**
 * A scalar value accepted by the canonical semantic record format.
 *
 * Numbers must be finite. Strings must contain well-formed Unicode.
 *
 * @public
 */
export type SemanticScalar = boolean | null | number | string;

/**
 * Any recursively representable value accepted in a semantic record.
 *
 * Arrays must be dense data arrays without accessors or custom properties.
 *
 * @public
 */
export type SemanticValue = SemanticRecord | SemanticScalar | readonly SemanticValue[];

/**
 * A plain object containing semantic values.
 *
 * Properties whose value is `undefined` are omitted during canonicalization.
 * Symbol and accessor properties are rejected.
 *
 * @public
 */
export type SemanticRecord = {
    readonly [key: string]: SemanticValue | undefined;
};

/**
 * Serializes a semantic record deterministically.
 *
 * Object keys are sorted recursively, array order is preserved, undefined
 * object properties are omitted, and unsupported JSON values are rejected.
 * Arrays and objects may nest at most `kernel.canonicalization.maxNestingDepth`
 * levels, counting `record` itself as level one. The value is walked with an
 * explicit stack and the bound is checked before descending, so acceptance does
 * not depend on the caller's stack depth or JIT state.
 *
 * @param record - The plain semantic record to serialize.
 * @returns The record encoded as deterministic, whitespace-free JSON.
 * @throws {CanonicalNestingLimitError} If the record nests deeper than the
 * configured maximum nesting depth.
 * @throws {TypeError} If the record contains unsupported values, malformed
 * Unicode, accessors, custom array properties, or cycles.
 *
 * @example
 * ```ts
 * canonicalizeRecord({ operation: "task.started", ordinal: 1 });
 * // '{"operation":"task.started","ordinal":1}'
 * ```
 *
 * @public
 */
export function canonicalizeRecord(record: SemanticRecord): string {
    return canonicalizeSemanticValue(record);
}

/**
 * Serializes one canonical semantic value for internal content-addressed protocols.
 *
 * @param value - Scalar, array, or record accepted by the semantic value domain.
 * @returns The value encoded as deterministic, whitespace-free JSON.
 * @throws {CanonicalNestingLimitError} If the value nests deeper than
 * `kernel.canonicalization.maxNestingDepth`.
 * @throws {TypeError} If the value contains unsupported or malformed data.
 * @internal
 */
export function canonicalizeSemanticValue(value: SemanticValue): string {
    return encode(value, kernelProtocolConfig.canonicalization.maxNestingDepth);
}

/**
 * Serializes kernel framing around values already bounded by the canonical value domain.
 *
 * Record identity input, append batch digests, and native and redacted archives embed whole
 * record bodies a few levels deep, so they are encoded under
 * `maxNestingDepth + framingDepth`. Bodies themselves are validated against `maxNestingDepth`
 * before or while they are framed, so a body at the bound can be appended, exported, and imported.
 *
 * @param value - Kernel framing record whose embedded values are canonical values.
 * @returns The value encoded as deterministic, whitespace-free JSON.
 * @throws {CanonicalNestingLimitError} If the framing nests deeper than the framed bound.
 * @throws {TypeError} If the value contains unsupported or malformed data.
 * @internal
 */
export function canonicalizeKernelFrame(value: SemanticRecord): string {
    const { framingDepth, maxNestingDepth } = kernelProtocolConfig.canonicalization;
    return encode(value, maxNestingDepth + framingDepth);
}

function encode(value: SemanticValue, maxNestingDepth: number): string {
    try {
        // Normalized objects have a null prototype, which sends native `JSON.stringify` down a
        // recursive path that needs far more native stack per level than plain objects.
        return serializeJsonText(normalizeValue(value, maxNestingDepth));
    } catch (error) {
        // Output beyond the maximum string length, or a caller that has already exhausted nearly
        // all of the call stack, raises RangeError; the documented contract for unsupported input
        // is TypeError.
        if (error instanceof RangeError) {
            throw new TypeError("$ exceeds the runtime nesting or size limit for canonical JSON", {
                cause: error,
            });
        }
        throw error;
    }
}

/**
 * Creates a stable content-addressed identifier from a semantic record.
 *
 * The digest algorithm and identifier prefix come from `protocol.config.json`.
 *
 * @param record - The semantic record whose canonical representation is hashed.
 * @returns The configured algorithm prefix followed by the hexadecimal digest.
 * @throws {CanonicalNestingLimitError} If `record` nests deeper than the configured
 * `kernel.canonicalization.maxNestingDepth`.
 * @throws {TypeError} If `record` cannot be canonicalized.
 *
 * @public
 */
export function createRecordId(record: SemanticRecord): string {
    const digest = createHash(recordIdConfig.algorithm)
        .update(canonicalizeRecord(record), "utf8")
        .digest("hex");
    return `${recordIdConfig.prefix}${digest}`;
}

type ArrayFrame = {
    readonly kind: "array";
    readonly allowedKeys: Set<string>;
    readonly descriptors: { readonly [key: string]: PropertyDescriptor };
    index: number;
    readonly normalized: unknown[];
    readonly path: string;
    readonly source: readonly SemanticValue[];
};

type ObjectFrame = {
    readonly kind: "object";
    index: number;
    readonly keys: readonly string[];
    readonly normalized: Record<string, unknown>;
    readonly path: string;
    pendingKey: string;
    readonly source: SemanticRecord;
};

type Frame = ArrayFrame | ObjectFrame;

type Child = { readonly path: string; readonly value: SemanticValue };

/**
 * Normalizes a value with an explicit stack instead of recursion, so the configured depth bound,
 * not the caller's remaining call stack or JIT state, decides acceptance. Checks run in the same
 * depth-first order as a recursive walk, so the first reported defect is unchanged.
 */
function normalizeValue(value: SemanticValue, maxNestingDepth: number): unknown {
    const seen = new WeakSet<object>();
    const stack: Frame[] = [];
    let opened = openValue(value, "$", stack, seen, maxNestingDepth);
    while (stack.length > 0) {
        const frame = stack.at(-1) as Frame;
        if (opened !== FRAME_OPENED) {
            if (frame.kind === "array") frame.normalized.push(opened.value);
            else frame.normalized[frame.pendingKey] = opened.value;
        }
        const child = frame.kind === "array" ? nextArrayChild(frame) : nextObjectChild(frame);
        if (child !== undefined) {
            opened = openValue(child.value, child.path, stack, seen, maxNestingDepth);
            continue;
        }
        if (
            frame.kind === "array" &&
            Object.keys(frame.descriptors).some((key) => !frame.allowedKeys.has(key))
        ) {
            throw new TypeError(`${frame.path} must not contain custom properties`);
        }
        stack.pop();
        seen.delete(frame.source);
        opened = { value: frame.normalized };
    }
    return (opened as { readonly value: unknown }).value;
}

const FRAME_OPENED = Symbol("frame opened");

function openValue(
    value: SemanticValue,
    path: string,
    stack: Frame[],
    seen: WeakSet<object>,
    maxNestingDepth: number,
): typeof FRAME_OPENED | { readonly value: unknown } {
    if (typeof value === "string") {
        assertWellFormedString(value, path);
        return { value };
    }

    if (value === null || typeof value === "boolean") {
        return { value };
    }

    if (typeof value === "number") {
        if (!Number.isFinite(value)) {
            throw new TypeError(`${path} must contain a finite number`);
        }

        return { value: Object.is(value, -0) ? 0 : value };
    }

    if (Array.isArray(value)) {
        const values = value as readonly SemanticValue[];
        enterContainer(values, path, stack, seen, maxNestingDepth);
        if (Object.getOwnPropertySymbols(values).length > 0) {
            throw new TypeError(`${path} must not contain symbol properties`);
        }
        stack.push({
            allowedKeys: new Set(["length"]),
            descriptors: Object.getOwnPropertyDescriptors(values),
            index: 0,
            kind: "array",
            normalized: [],
            path,
            source: values,
        });
        return FRAME_OPENED;
    }

    const record = value as SemanticRecord;
    const prototype: unknown = Object.getPrototypeOf(record);
    if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError(`${path} must contain only arrays and plain objects`);
    }

    if (Object.getOwnPropertySymbols(record).length > 0) {
        throw new TypeError(`${path} must not contain symbol properties`);
    }

    enterContainer(record, path, stack, seen, maxNestingDepth);
    stack.push({
        index: 0,
        keys: Object.keys(Object.getOwnPropertyDescriptors(record)).sort(),
        kind: "object",
        normalized: Object.create(null) as Record<string, unknown>,
        path,
        pendingKey: "",
        source: record,
    });
    return FRAME_OPENED;
}

function nextArrayChild(frame: ArrayFrame): Child | undefined {
    if (frame.index >= frame.source.length) {
        return undefined;
    }
    const index = frame.index;
    frame.index += 1;
    const key = String(index);
    frame.allowedKeys.add(key);
    const descriptor = frame.descriptors[key];
    if (descriptor === undefined) {
        throw new TypeError(`${frame.path}[${index}] is a sparse array element`);
    }
    if (!("value" in descriptor)) {
        throw new TypeError(`${frame.path}[${index}] must not be an accessor array element`);
    }
    if (descriptor.value === undefined) {
        throw new TypeError(`${frame.path}[${index}] contains an undefined array element`);
    }
    return { path: `${frame.path}[${index}]`, value: descriptor.value as SemanticValue };
}

function nextObjectChild(frame: ObjectFrame): Child | undefined {
    while (frame.index < frame.keys.length) {
        const key = frame.keys[frame.index] as string;
        frame.index += 1;
        assertWellFormedString(key, `${frame.path} key`);
        const descriptor = Object.getOwnPropertyDescriptor(frame.source, key);
        if (descriptor === undefined) {
            throw new TypeError(`${frame.path}.${key} changed during canonicalization`);
        }
        if (!("value" in descriptor)) {
            throw new TypeError(`${frame.path}.${key} must not be an accessor property`);
        }
        if (descriptor.value !== undefined) {
            frame.pendingKey = key;
            return { path: `${frame.path}.${key}`, value: descriptor.value as SemanticValue };
        }
    }
    return undefined;
}

function enterContainer(
    value: object,
    path: string,
    stack: readonly Frame[],
    seen: WeakSet<object>,
    maxNestingDepth: number,
): void {
    if (seen.has(value)) {
        throw new TypeError(`${path} contains a cyclic record`);
    }
    // Every open frame is one enclosing container, so the stack length is the current depth.
    if (stack.length === maxNestingDepth) {
        throw new CanonicalNestingLimitError(maxNestingDepth);
    }
    seen.add(value);
}

function assertWellFormedString(value: string, path: string): void {
    if (/[\uD800-\uDFFF]/u.test(value)) {
        throw new TypeError(`${path} must contain valid Unicode without lone surrogates`);
    }
}
