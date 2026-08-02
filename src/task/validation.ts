import { canonicalizeRecord, type SemanticRecord } from "../canonical/canonical-record.ts";

/** Validates one non-empty well-formed task-domain string. @internal */
export function assertTaskText(value: unknown, subject: string): asserts value is string {
    if (typeof value !== "string" || value.length === 0 || /[\uD800-\uDFFF]/u.test(value)) {
        throw new TypeError(`${subject} must be a non-empty well-formed string`);
    }
}

/** Validates one canonical semantic record. @internal */
export function assertTaskSemanticRecord(
    value: unknown,
    subject: string,
): asserts value is SemanticRecord {
    try {
        canonicalizeRecord(value as SemanticRecord);
    } catch (error) {
        throw new TypeError(`${subject} must be a canonical semantic record`, { cause: error });
    }
}

/** Reads an exact plain object without invoking accessors. @internal */
export function readTaskDataObject(
    value: unknown,
    keys: readonly string[],
    subject: string,
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
    if (Object.keys(descriptors).sort().join("\0") !== [...keys].sort().join("\0")) {
        throw new TypeError(`${subject} must contain exactly its declared fields`);
    }
    const fields = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
        const descriptor = descriptors[key];
        if (descriptor === undefined || !("value" in descriptor)) {
            throw new TypeError(`${subject} ${key} must be a data property`);
        }
        fields[key] = descriptor.value;
    }
    return fields;
}
