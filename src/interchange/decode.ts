import { assertBlobId } from "../blob/identity.ts";
import { canonicalizeRecord, type SemanticRecord } from "../canonical/canonical-record.ts";
import { CanonicalNestingLimitError } from "../canonical/errors.ts";
import { kernelProtocolConfig, retentionProtocolConfig } from "../protocol/config.ts";
import type { TraceArchiveLimitsConfig } from "../protocol/config-types.ts";
import { assertNonEmptyString, assertRecordId, validateRecordBody } from "../record/guards.ts";
import type { RecordEnvelope } from "../record/types.ts";
import { validateRecordEnvelope } from "../record/validation.ts";
import { RedactedTraceArchiveError } from "../retention/errors.ts";
import { isBatchDigest } from "../store/codec.ts";
import { TraceArchiveLimitError } from "./errors.ts";
import { assertTraceArchiveCount, assertTraceArchiveText } from "./limits.ts";
import type {
    DecodedTraceArchive,
    TraceArchiveBlob,
    TraceArchiveCut,
    TraceArchiveIntent,
    TraceArchiveRecord,
    TraceArchiveView,
} from "./types.ts";

const ARCHIVE_KEYS = [
    "append_intents",
    "blobs",
    "canonical_version",
    "cuts",
    "format",
    "format_version",
    "kernel_abi_version",
    "record_views",
    "records",
];

/**
 * Decodes and validates the closed native trace-archive wire shape.
 *
 * A redacted archive is refused before any structural check: redaction is one-way and a redacted
 * archive never re-enters a trace store. Configured interchange limits are checked first: byte
 * length, nesting depth, and repeated object keys before parsing, collection counts and the
 * declared blob byte total before any record or blob is decoded. `limits` is `null` only for the
 * store's own export.
 *
 * @throws {TraceArchiveLimitError} If a configured interchange limit is exceeded.
 * @throws {CanonicalNestingLimitError} If a record body, envelope, or receipt nests deeper than
 * `kernel.canonicalization.maxNestingDepth`.
 * @throws {RedactedTraceArchiveError} If the archive is a redacted archive.
 * @throws {TypeError} If the archive is malformed or repeats an object key.
 */
export function decodeTraceArchive(
    serialized: string,
    limits: TraceArchiveLimitsConfig | null = kernelProtocolConfig.interchange.limits,
): DecodedTraceArchive {
    if (typeof serialized !== "string") {
        throw new TypeError("trace archive must be JSON text");
    }
    if (limits !== null) assertTraceArchiveText(serialized, limits);
    let parsed: unknown;
    try {
        parsed = JSON.parse(serialized);
    } catch (error) {
        throw new TypeError("trace archive must contain valid JSON", { cause: error });
    }
    if (
        parsed !== null &&
        typeof parsed === "object" &&
        (parsed as Record<string, unknown>).format ===
            retentionProtocolConfig.redactedArchive.format
    ) {
        throw new RedactedTraceArchiveError(
            "redacted trace archives are one-way exports and cannot be imported",
        );
    }
    const archive = readObject(parsed, ARCHIVE_KEYS, "trace archive");
    if (
        archive.format !== kernelProtocolConfig.interchange.format ||
        archive.format_version !== kernelProtocolConfig.interchange.formatVersion ||
        archive.kernel_abi_version !== kernelProtocolConfig.abiVersion ||
        archive.canonical_version !== kernelProtocolConfig.canonicalVersion
    ) {
        throw new TypeError("trace archive protocol versions are unsupported");
    }
    const appendIntents = readArray(archive.append_intents, "append_intents");
    const blobs = readArray(archive.blobs, "blobs");
    const cuts = readArray(archive.cuts, "cuts");
    const records = readArray(archive.records, "records");
    const recordViews = readArray(archive.record_views, "record_views");
    if (limits !== null) {
        assertTraceArchiveCount(appendIntents, "maxAppendIntents", limits);
        assertTraceArchiveCount(blobs, "maxBlobs", limits);
        assertTraceArchiveCount(cuts, "maxCuts", limits);
        assertTraceArchiveCount(records, "maxRecords", limits);
        assertTraceArchiveCount(recordViews, "maxRecordViews", limits);
    }
    let declaredBlobBytes = 0;
    return {
        appendIntents: appendIntents.map(readIntent),
        blobs: blobs.map((value, index) =>
            readBlob(value, index, (byteLength) => {
                declaredBlobBytes += byteLength;
                if (limits !== null && declaredBlobBytes > limits.maxBlobBytes) {
                    throw new TraceArchiveLimitError("maxBlobBytes", limits.maxBlobBytes);
                }
            }),
        ),
        cuts: cuts.map(readCut),
        records: records.map(readRecord),
        recordViews: recordViews.map(readView),
    };
}

function readRecord(value: unknown, index: number): TraceArchiveRecord {
    const record = readObject(value, ["body", "envelope"], `records[${index}]`);
    validateRecordBody(record.body);
    validateRecordEnvelope(record.envelope, record.body);
    return { body: record.body, envelope: record.envelope as RecordEnvelope };
}

/** Validates one archived owner view. @internal */
export function readView(value: unknown, index: number): TraceArchiveView {
    const view = readObject(
        value,
        ["append_intent_id", "append_position", "owner_id", "owner_ordinal", "record_id"],
        `record_views[${index}]`,
    );
    assertNonEmptyString(view.append_intent_id, `record_views[${index}].append_intent_id`);
    assertNonEmptyString(view.owner_id, `record_views[${index}].owner_id`);
    assertRecordId(view.record_id, `record_views[${index}].record_id`);
    return {
        append_intent_id: view.append_intent_id,
        append_position: readInteger(
            view.append_position,
            `record_views[${index}].append_position`,
        ),
        owner_id: view.owner_id,
        owner_ordinal: readInteger(view.owner_ordinal, `record_views[${index}].owner_ordinal`),
        record_id: view.record_id,
    };
}

/** Validates one archived append intent. @internal */
export function readIntent(value: unknown, index: number): TraceArchiveIntent {
    const intent = readObject(
        value,
        ["append_intent_id", "batch_digest", "receipt_json"],
        `append_intents[${index}]`,
    );
    assertNonEmptyString(intent.append_intent_id, `append_intents[${index}].append_intent_id`);
    if (!isBatchDigest(intent.batch_digest)) {
        throw new TypeError(`append_intents[${index}].batch_digest is invalid`);
    }
    if (typeof intent.receipt_json !== "string") {
        throw new TypeError(`append_intents[${index}].receipt_json must be JSON text`);
    }
    // Stores retain receipts in canonical form; anything else (repeated keys included) could be
    // read differently by another parser.
    let canonicalReceipt: string | undefined;
    try {
        canonicalReceipt = canonicalizeRecord(JSON.parse(intent.receipt_json) as SemanticRecord);
    } catch (error) {
        if (error instanceof CanonicalNestingLimitError) throw error;
        canonicalReceipt = undefined;
    }
    if (canonicalReceipt !== intent.receipt_json) {
        throw new TypeError(`append_intents[${index}].receipt_json must be canonical JSON`);
    }
    return {
        append_intent_id: intent.append_intent_id,
        batch_digest: intent.batch_digest,
        receipt_json: intent.receipt_json,
    };
}

/** Validates one archived cut. @internal */
export function readCut(value: unknown, index: number): TraceArchiveCut {
    const cut = readObject(
        value,
        [
            "append_intent_id",
            "created_by_record_id",
            "cut_id",
            "publisher_owner_id",
            "target_owner_id",
            "through_owner_ordinal",
            "through_record_id",
        ],
        `cuts[${index}]`,
    );
    for (const key of ["append_intent_id", "cut_id", "publisher_owner_id", "target_owner_id"]) {
        assertNonEmptyString(cut[key], `cuts[${index}].${key}`);
    }
    assertRecordId(cut.created_by_record_id, `cuts[${index}].created_by_record_id`);
    assertRecordId(cut.through_record_id, `cuts[${index}].through_record_id`);
    return {
        append_intent_id: cut.append_intent_id as string,
        created_by_record_id: cut.created_by_record_id,
        cut_id: cut.cut_id as string,
        publisher_owner_id: cut.publisher_owner_id as string,
        target_owner_id: cut.target_owner_id as string,
        through_owner_ordinal: readInteger(
            cut.through_owner_ordinal,
            `cuts[${index}].through_owner_ordinal`,
        ),
        through_record_id: cut.through_record_id,
    };
}

function readBlob(
    value: unknown,
    index: number,
    admitDeclaredBytes: (byteLength: number) => void,
): TraceArchiveBlob {
    const blob = readObject(value, ["blob_id", "byte_length", "content_base64"], `blobs[${index}]`);
    assertBlobId(blob.blob_id, `blobs[${index}].blob_id`);
    const byteLength = readInteger(blob.byte_length, `blobs[${index}].byte_length`);
    if (typeof blob.content_base64 !== "string") {
        throw new TypeError(`blobs[${index}].content_base64 must be a string`);
    }
    // Canonical padded base64 has exactly this length, so decoding is bounded by the declaration.
    if (blob.content_base64.length !== 4 * Math.ceil(byteLength / 3)) {
        throw new TypeError(`blobs[${index}] content does not match its declared length`);
    }
    admitDeclaredBytes(byteLength);
    const content = Buffer.from(blob.content_base64, kernelProtocolConfig.interchange.blobEncoding);
    if (
        content.toString(kernelProtocolConfig.interchange.blobEncoding) !== blob.content_base64 ||
        content.byteLength !== byteLength
    ) {
        throw new TypeError(`blobs[${index}] content does not match its declared length`);
    }
    return { blob_id: blob.blob_id, byte_length: byteLength, content };
}

function readObject(
    value: unknown,
    keys: readonly string[],
    path: string,
): Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError(`${path} must be an object`);
    }
    const actualKeys = Object.keys(value).sort();
    if (actualKeys.length !== keys.length || actualKeys.some((key, index) => key !== keys[index])) {
        throw new TypeError(`${path} must contain exactly the archive fields`);
    }
    return value as Record<string, unknown>;
}

function readArray(value: unknown, path: string): readonly unknown[] {
    if (!Array.isArray(value)) {
        throw new TypeError(`${path} must be an array`);
    }
    return value;
}

function readInteger(value: unknown, path: string): number {
    if (!Number.isSafeInteger(value) || Number(value) < 0) {
        throw new TypeError(`${path} must be a non-negative safe integer`);
    }
    return Number(value);
}
