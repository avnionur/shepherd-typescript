import { canonicalizeRecord, type SemanticRecord } from "../canonical/canonical-record.ts";
import { CanonicalNestingLimitError } from "../canonical/errors.ts";

/** Validates one non-empty well-formed run-domain string. @internal */
export function assertRunText(value: unknown, subject: string): asserts value is string {
    assertRunWellFormedString(value, subject);
    if (value.length === 0) {
        throw new TypeError(`${subject} must be non-empty`);
    }
}

/** Validates one possibly empty well-formed run-domain string. @internal */
export function assertRunWellFormedString(
    value: unknown,
    subject: string,
): asserts value is string {
    if (typeof value !== "string" || /[\uD800-\uDFFF]/u.test(value)) {
        throw new TypeError(`${subject} must be a well-formed string`);
    }
}

/** Validates one canonical semantic run record. @internal */
export function assertRunSemanticRecord(
    value: unknown,
    subject: string,
): asserts value is SemanticRecord {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError(`${subject} must be a canonical semantic record`);
    }
    try {
        canonicalizeRecord(value as SemanticRecord);
    } catch (error) {
        if (error instanceof CanonicalNestingLimitError) throw error;
        throw new TypeError(`${subject} must be a canonical semantic record`, { cause: error });
    }
}

/** Reads an exact plain run-domain data object without invoking accessors. @internal */
export function readRunDataObject(
    value: unknown,
    keys: readonly string[],
    subject: string,
    optionalKeys: readonly string[] = [],
): Record<string, unknown> {
    if (
        value === null ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        (Object.getPrototypeOf(value) !== Object.prototype &&
            Object.getPrototypeOf(value) !== null) ||
        Object.getOwnPropertySymbols(value).length > 0
    ) {
        throw new TypeError(`${subject} must be a plain data object`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const declaredKeys = [...keys, ...optionalKeys];
    if (
        Object.keys(descriptors).some((key) => !declaredKeys.includes(key)) ||
        keys.some((key) => descriptors[key] === undefined)
    ) {
        throw new TypeError(`${subject} must contain exactly its declared fields`);
    }
    const fields = Object.create(null) as Record<string, unknown>;
    for (const key of declaredKeys) {
        const descriptor = descriptors[key];
        if (descriptor === undefined) {
            fields[key] = undefined;
            continue;
        }
        if (!("value" in descriptor)) {
            throw new TypeError(`${subject} ${key} must be a data property`);
        }
        fields[key] = descriptor.value;
    }
    return fields;
}
