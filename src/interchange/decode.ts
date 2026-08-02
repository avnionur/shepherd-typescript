import { createHash } from "node:crypto";

import { assertBlobId } from "../blob/identity.ts";
import { kernelProtocolConfig } from "../protocol/config.ts";
import { assertNonEmptyString, assertRecordId, validateRecordBody } from "../record/guards.ts";
import type { RecordEnvelope } from "../record/types.ts";
import { validateRecordEnvelope } from "../record/validation.ts";
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

/** Decodes and validates the closed native trace-archive wire shape. */
export function decodeTraceArchive(serialized: string): DecodedTraceArchive {
    if (typeof serialized !== "string") {
        throw new TypeError("trace archive must be JSON text");
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(serialized);
    } catch (error) {
        throw new TypeError("trace archive must contain valid JSON", { cause: error });
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
    return {
        appendIntents: readArray(archive.append_intents, "append_intents").map(readIntent),
        blobs: readArray(archive.blobs, "blobs").map(readBlob),
        cuts: readArray(archive.cuts, "cuts").map(readCut),
        records: readArray(archive.records, "records").map(readRecord),
        recordViews: readArray(archive.record_views, "record_views").map(readView),
    };
}

function readRecord(value: unknown, index: number): TraceArchiveRecord {
    const record = readObject(value, ["body", "envelope"], `records[${index}]`);
    validateRecordBody(record.body);
    validateRecordEnvelope(record.envelope, record.body);
    return { body: record.body, envelope: record.envelope as RecordEnvelope };
}

function readView(value: unknown, index: number): TraceArchiveView {
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

function readIntent(value: unknown, index: number): TraceArchiveIntent {
    const intent = readObject(
        value,
        ["append_intent_id", "batch_digest", "receipt_json"],
        `append_intents[${index}]`,
    );
    assertNonEmptyString(intent.append_intent_id, `append_intents[${index}].append_intent_id`);
    const digestLength = createHash(kernelProtocolConfig.store.appendIntentDigestAlgorithm).digest(
        "hex",
    ).length;
    if (
        typeof intent.batch_digest !== "string" ||
        intent.batch_digest.length !== digestLength ||
        !/^[0-9a-f]+$/u.test(intent.batch_digest)
    ) {
        throw new TypeError(`append_intents[${index}].batch_digest is invalid`);
    }
    if (typeof intent.receipt_json !== "string") {
        throw new TypeError(`append_intents[${index}].receipt_json must be JSON text`);
    }
    return {
        append_intent_id: intent.append_intent_id,
        batch_digest: intent.batch_digest,
        receipt_json: intent.receipt_json,
    };
}

function readCut(value: unknown, index: number): TraceArchiveCut {
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

function readBlob(value: unknown, index: number): TraceArchiveBlob {
    const blob = readObject(value, ["blob_id", "byte_length", "content_base64"], `blobs[${index}]`);
    assertBlobId(blob.blob_id, `blobs[${index}].blob_id`);
    const byteLength = readInteger(blob.byte_length, `blobs[${index}].byte_length`);
    if (typeof blob.content_base64 !== "string") {
        throw new TypeError(`blobs[${index}].content_base64 must be a string`);
    }
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
