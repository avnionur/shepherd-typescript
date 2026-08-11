import { createHash } from "node:crypto";

import { recordIdConfig } from "../protocol/config.ts";

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
 *
 * @param record - The plain semantic record to serialize.
 * @returns The record encoded as deterministic, whitespace-free JSON.
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
 * @throws {TypeError} If the value contains unsupported or malformed data.
 * @internal
 */
export function canonicalizeSemanticValue(value: SemanticValue): string {
    return JSON.stringify(normalizeValue(value, new WeakSet<object>(), "$"));
}

/**
 * Creates a stable content-addressed identifier from a semantic record.
 *
 * The digest algorithm and identifier prefix come from `protocol.config.json`.
 *
 * @param record - The semantic record whose canonical representation is hashed.
 * @returns The configured algorithm prefix followed by the hexadecimal digest.
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

function normalizeValue(value: SemanticValue, seen: WeakSet<object>, path: string): unknown {
    if (typeof value === "string") {
        assertWellFormedString(value, path);
        return value;
    }

    if (value === null || typeof value === "boolean") {
        return value;
    }

    if (typeof value === "number") {
        if (!Number.isFinite(value)) {
            throw new TypeError(`${path} must contain a finite number`);
        }

        return Object.is(value, -0) ? 0 : value;
    }

    if (Array.isArray(value)) {
        return normalizeArray(value as readonly SemanticValue[], seen, path);
    }

    return normalizeObject(value as SemanticRecord, seen, path);
}

function normalizeArray(
    values: readonly SemanticValue[],
    seen: WeakSet<object>,
    path: string,
): readonly unknown[] {
    enterContainer(values, seen, path);

    try {
        if (Object.getOwnPropertySymbols(values).length > 0) {
            throw new TypeError(`${path} must not contain symbol properties`);
        }

        const descriptors = Object.getOwnPropertyDescriptors(values);
        const allowedKeys = new Set(["length"]);
        const normalized: unknown[] = [];

        for (let index = 0; index < values.length; index += 1) {
            const key = String(index);
            allowedKeys.add(key);
            const descriptor = descriptors[key];
            if (descriptor === undefined) {
                throw new TypeError(`${path}[${index}] is a sparse array element`);
            }
            if (!("value" in descriptor)) {
                throw new TypeError(`${path}[${index}] must not be an accessor array element`);
            }
            if (descriptor.value === undefined) {
                throw new TypeError(`${path}[${index}] contains an undefined array element`);
            }

            normalized.push(
                normalizeValue(descriptor.value as SemanticValue, seen, `${path}[${index}]`),
            );
        }

        if (Object.keys(descriptors).some((key) => !allowedKeys.has(key))) {
            throw new TypeError(`${path} must not contain custom properties`);
        }

        return normalized;
    } finally {
        seen.delete(values);
    }
}

function normalizeObject(
    value: SemanticRecord,
    seen: WeakSet<object>,
    path: string,
): Readonly<Record<string, unknown>> {
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError(`${path} must contain only arrays and plain objects`);
    }

    if (Object.getOwnPropertySymbols(value).length > 0) {
        throw new TypeError(`${path} must not contain symbol properties`);
    }

    enterContainer(value, seen, path);

    try {
        const normalized = Object.create(null) as Record<string, unknown>;
        const descriptors = Object.getOwnPropertyDescriptors(value);

        for (const key of Object.keys(descriptors).sort()) {
            assertWellFormedString(key, `${path} key`);
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (descriptor === undefined) {
                throw new TypeError(`${path}.${key} changed during canonicalization`);
            }
            if (!("value" in descriptor)) {
                throw new TypeError(`${path}.${key} must not be an accessor property`);
            }
            if (descriptor.value !== undefined) {
                normalized[key] = normalizeValue(
                    descriptor.value as SemanticValue,
                    seen,
                    `${path}.${key}`,
                );
            }
        }

        return normalized;
    } finally {
        seen.delete(value);
    }
}

function enterContainer(value: object, seen: WeakSet<object>, path: string): void {
    if (seen.has(value)) {
        throw new TypeError(`${path} contains a cyclic record`);
    }

    seen.add(value);
}

function assertWellFormedString(value: string, path: string): void {
    if (/[\uD800-\uDFFF]/u.test(value)) {
        throw new TypeError(`${path} must contain valid Unicode without lone surrogates`);
    }
}
