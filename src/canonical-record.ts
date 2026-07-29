import { createHash } from "node:crypto";

import protocolConfig from "../protocol.config.json" with { type: "json" };

/** A scalar value accepted by the canonical semantic record format. */
export type SemanticScalar = boolean | null | number | string;

/** A value accepted by the canonical semantic record format. */
export type SemanticValue = SemanticRecord | SemanticScalar | readonly SemanticValue[];

/** A semantic record whose undefined object properties are omitted. */
export type SemanticRecord = {
    readonly [key: string]: SemanticValue | undefined;
};

/**
 * Serializes a semantic record deterministically.
 *
 * Object keys are sorted recursively, array order is preserved, undefined
 * object properties are omitted, and unsupported JSON values are rejected.
 */
export function canonicalizeRecord(record: SemanticRecord): string {
    return JSON.stringify(normalizeValue(record, new WeakSet<object>(), "$"));
}

/** Creates a content-addressed identifier from a canonical semantic record. */
export function createRecordId(record: SemanticRecord): string {
    const digest = createHash(protocolConfig.recordId.algorithm)
        .update(canonicalizeRecord(record), "utf8")
        .digest("hex");
    return `${protocolConfig.recordId.prefix}${digest}`;
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
    if (!value.isWellFormed()) {
        throw new TypeError(`${path} must contain valid Unicode without lone surrogates`);
    }
}
