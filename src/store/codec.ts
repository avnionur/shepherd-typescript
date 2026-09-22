import { createHash } from "node:crypto";

import type { AppendBatchDraft, PlannedAppendBatch } from "../append/types.ts";
import {
    canonicalizeKernelFrame,
    canonicalizeRecord,
    type SemanticRecord,
} from "../canonical/canonical-record.ts";
import { kernelProtocolConfig } from "../protocol/config.ts";
import { assertNonEmptyString, assertRecordId } from "../record/guards.ts";
import type { RecordId } from "../record/types.ts";
import { TraceStoreError } from "./errors.ts";
import type { AppendReceipt } from "./types.ts";

/** Creates the configured idempotency digest for a normalized batch. */
export function createBatchDigest(batch: AppendBatchDraft): string {
    return createHash(kernelProtocolConfig.store.appendIntentDigestAlgorithm)
        .update(canonicalizeKernelFrame(batch as unknown as SemanticRecord), "utf8")
        .digest("hex");
}

const BATCH_DIGEST_LENGTH = createHash(
    kernelProtocolConfig.store.appendIntentDigestAlgorithm,
).digest("hex").length;

/** Whether a value has the shape of a configured batch digest: lowercase hex of the digest length. */
export function isBatchDigest(value: unknown): value is string {
    return (
        typeof value === "string" &&
        value.length === BATCH_DIGEST_LENGTH &&
        /^[0-9a-f]+$/u.test(value)
    );
}

/** Creates a durable receipt from a planned append. */
export function createAppendReceipt(
    appendIntentId: string,
    plan: PlannedAppendBatch,
): AppendReceipt {
    return freezeReceipt({
        append_intent_id: appendIntentId,
        causal_edges: plan.causal_edges,
        owner_ordinal_ranges: plan.owner_ordinal_ranges,
        record_ids: plan.records.map(({ envelope }) => envelope.record_id),
    });
}

/** Encodes a receipt as deterministic JSON for idempotent replay. */
export function encodeAppendReceipt(receipt: AppendReceipt): string {
    return canonicalizeRecord({
        append_intent_id: receipt.append_intent_id,
        causal_edges: receipt.causal_edges,
        owner_ordinal_ranges: [...receipt.owner_ordinal_ranges],
        record_ids: receipt.record_ids,
    });
}

/** Decodes and validates a previously committed receipt. */
export function decodeAppendReceipt(value: string, expectedIntentId: string): AppendReceipt {
    try {
        const parsed = readReceiptObject(JSON.parse(value));
        assertNonEmptyString(parsed.append_intent_id, "stored receipt append_intent_id");
        if (parsed.append_intent_id !== expectedIntentId) {
            throw new TypeError("stored receipt append intent does not match its lookup key");
        }
        const recordIds = readRecordIds(parsed.record_ids);
        const causalEdges = readCausalEdges(parsed.causal_edges, new Set(recordIds));
        const ownerOrdinalRanges = readOwnerOrdinalRanges(parsed.owner_ordinal_ranges);
        const occurrenceCount = [...ownerOrdinalRanges.values()].reduce(
            (count, [first, last]) => count + last - first + 1,
            0,
        );
        if (occurrenceCount !== recordIds.length) {
            throw new TypeError(
                "stored receipt ordinal ranges do not cover its record occurrences",
            );
        }
        return freezeReceipt({
            append_intent_id: parsed.append_intent_id,
            causal_edges: causalEdges,
            owner_ordinal_ranges: ownerOrdinalRanges,
            record_ids: recordIds,
        });
    } catch (error) {
        throw new TraceStoreError("stored append receipt is invalid", { cause: error });
    }
}

function readReceiptObject(value: unknown): Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError("stored receipt must be an object");
    }
    const parsed = value as Record<string, unknown>;
    const keys = Object.keys(parsed).sort();
    const expectedKeys = ["append_intent_id", "causal_edges", "owner_ordinal_ranges", "record_ids"];
    if (
        keys.length !== expectedKeys.length ||
        keys.some((key, index) => key !== expectedKeys[index])
    ) {
        throw new TypeError("stored receipt must contain exactly the receipt fields");
    }
    return parsed;
}

function readRecordIds(value: unknown): readonly RecordId[] {
    if (!Array.isArray(value)) {
        throw new TypeError("stored receipt record_ids must be an array");
    }
    for (const [index, recordId] of value.entries()) {
        assertRecordId(recordId, `stored receipt record_ids[${index}]`);
    }
    return value;
}

function readCausalEdges(
    value: unknown,
    childRecordIds: ReadonlySet<RecordId>,
): readonly (readonly [RecordId, RecordId])[] {
    if (!Array.isArray(value)) {
        throw new TypeError("stored receipt causal_edges must be an array");
    }
    return value.map((edge, index) => {
        if (!Array.isArray(edge) || edge.length !== 2) {
            throw new TypeError(`stored receipt causal_edges[${index}] must be a pair`);
        }
        const [parentId, childId] = edge;
        assertRecordId(parentId, `stored receipt causal_edges[${index}][0]`);
        assertRecordId(childId, `stored receipt causal_edges[${index}][1]`);
        if (!childRecordIds.has(childId)) {
            throw new TypeError(`stored receipt causal_edges[${index}] has an unknown child`);
        }
        return Object.freeze([parentId, childId] as const);
    });
}

function readOwnerOrdinalRanges(value: unknown): ReadonlyMap<string, readonly [number, number]> {
    if (!Array.isArray(value)) {
        throw new TypeError("stored receipt owner_ordinal_ranges must be an array");
    }
    const ranges = new Map<string, readonly [number, number]>();
    for (const [index, entry] of value.entries()) {
        if (!Array.isArray(entry) || entry.length !== 2) {
            throw new TypeError(`stored receipt owner_ordinal_ranges[${index}] must be a pair`);
        }
        const [ownerId, range] = entry;
        assertNonEmptyString(ownerId, `stored receipt owner_ordinal_ranges[${index}][0]`);
        if (ranges.has(ownerId)) {
            throw new TypeError(`stored receipt owner_ordinal_ranges repeats owner ${ownerId}`);
        }
        if (!Array.isArray(range) || range.length !== 2) {
            throw new TypeError(`stored receipt owner_ordinal_ranges[${index}][1] must be a pair`);
        }
        const [first, last] = range;
        if (
            !Number.isSafeInteger(first) ||
            !Number.isSafeInteger(last) ||
            first < kernelProtocolConfig.append.firstOwnerOrdinal ||
            last > kernelProtocolConfig.append.lastOwnerOrdinal ||
            first > last
        ) {
            throw new TypeError(
                `stored receipt owner_ordinal_ranges[${index}][1] is outside the configured range`,
            );
        }
        ranges.set(ownerId, Object.freeze([first, last] as const));
    }
    return ranges;
}

function freezeReceipt(receipt: AppendReceipt): AppendReceipt {
    return Object.freeze({
        append_intent_id: receipt.append_intent_id,
        causal_edges: Object.freeze(
            receipt.causal_edges.map((edge) => Object.freeze([...edge] as const)),
        ),
        owner_ordinal_ranges: new Map(
            [...receipt.owner_ordinal_ranges].map(([owner, range]) => [
                owner,
                Object.freeze([...range] as const),
            ]),
        ),
        record_ids: Object.freeze([...receipt.record_ids]),
    });
}
