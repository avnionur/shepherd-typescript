import { canonicalizeRecord, type SemanticRecord } from "./canonical-record.ts";

/**
 * Creates a canonical, deeply frozen snapshot of one semantic record.
 *
 * @param value - Canonicalizable semantic record to copy.
 * @returns A deeply frozen plain-data snapshot.
 * @throws {TypeError} If the record cannot be canonicalized.
 *
 * @internal
 */
export function createCanonicalSnapshot(value: SemanticRecord): SemanticRecord {
    return deepFreeze(JSON.parse(canonicalizeRecord(value)) as SemanticRecord);
}

function deepFreeze<T>(value: T): T {
    if (value !== null && typeof value === "object") {
        for (const child of Object.values(value)) {
            deepFreeze(child);
        }
        Object.freeze(value);
    }
    return value;
}
