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

// Iterative, like the canonical encoder, so freezing a value at the configured nesting bound does
// not depend on the caller's remaining stack.
function deepFreeze<T>(value: T): T {
    const pending: unknown[] = [value];
    while (pending.length > 0) {
        const current = pending.pop();
        if (current !== null && typeof current === "object") {
            // Push children one at a time: spreading them as call arguments throws RangeError for
            // containers wider than the engine's argument limit.
            for (const child of Object.values(current)) {
                pending.push(child);
            }
            Object.freeze(current);
        }
    }
    return value;
}
