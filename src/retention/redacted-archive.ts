import { assertBlobId } from "../blob/identity.ts";
import { canonicalizeRecord, type SemanticRecord } from "../canonical/canonical-record.ts";
import { decodeTraceArchive, readCut, readIntent, readView } from "../interchange/decode.ts";
import { TraceArchiveLimitError } from "../interchange/errors.ts";
import { assertTraceArchiveCount, assertTraceArchiveText } from "../interchange/limits.ts";
import { kernelProtocolConfig, retentionProtocolConfig } from "../protocol/config.ts";
import { retentionDigestHexLength } from "../protocol/config-retention.ts";
import {
    assertNonEmptyString,
    assertRecordId,
    assertRecordMode,
    assertString,
} from "../record/guards.ts";
import type { RecordBody, RecordEnvelope } from "../record/types.ts";
import { validateRecordEnvelope } from "../record/validation.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import { RedactedTraceArchiveError } from "./errors.ts";
import {
    createSchemaClassifier,
    type RetentionClassificationOptions,
    type RetentionDataClass,
    type RetentionExportDisposition,
} from "./policy.ts";
import { retentionDigest, scanSemanticValueForSecrets } from "./secret-scan.ts";

/**
 * Marker that replaces a record body in a redacted archive.
 *
 * @public
 */
export type RedactedRecordBody = {
    /**
     * Digest of the canonical body under the configured retention digest, or `null` when the
     * data class omits bodies without disclosure.
     */
    readonly body_digest: string | null;
    /** Retention data class of the record. */
    readonly data_class: RetentionDataClass;
    /** Always `true`; distinguishes the marker from a verbatim body. */
    readonly redacted: true;
    /** Sorted secret classes detected in the body; empty when none or when omitted. */
    readonly secret_classes: readonly string[];
};

/**
 * Counts verified from one redacted trace archive.
 *
 * @public
 */
export type RedactedTraceArchiveSummary = {
    /** Blob identities listed without content. */
    readonly blob_count: number;
    /** Published cuts. */
    readonly cut_count: number;
    /** Records whose body is exported verbatim and whose identity was re-derived. */
    readonly included_record_count: number;
    /** Records whose body was omitted without disclosure. */
    readonly omitted_body_count: number;
    /** Every archived record, including the root witness. */
    readonly record_count: number;
    /** Owner-local record occurrences. */
    readonly record_view_count: number;
    /** Records whose body was replaced by a digest-bearing marker. */
    readonly redacted_record_count: number;
    /** Redacted records whose marker reports at least one detected secret class. */
    readonly secret_record_count: number;
};

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
    "retention_compatibility_version",
    "source_format",
    "source_format_version",
];
const RECORD_KEYS = ["body", "data_class", "disposition", "envelope"];
const MARKER_KEYS = ["body_digest", "data_class", "redacted", "secret_classes"];
const ENVELOPE_KEYS = [
    "caused_by_record_ids",
    "digest",
    "mode",
    "record_id",
    "schema_ref",
    "witness_ref",
];

/**
 * Exports a store as a one-way redacted archive under the configured retention policy.
 *
 * The export is built on `store.exportTrace()`, so it covers exactly one integrity-verified
 * snapshot. Every record keeps its envelope and `record_id`; its body is exported verbatim only
 * when its data class disposition is `include` and no configured detector matches it. Otherwise
 * the body is replaced by a {@link RedactedRecordBody} marker. Views, intents, and cuts are kept;
 * blobs are listed by identity and length without content. Envelopes, owner identifiers, intent
 * identifiers, and blob bytes are not scanned. The result can be checked with
 * {@link verifyRedactedTraceArchive} and is refused by every import.
 *
 * @param store - Open trace store; it is only read.
 * @param options - Optional caller classification of unconfigured schema identifiers.
 * @returns Deterministic canonical JSON in the configured redacted-archive format.
 * @throws {TraceStoreError} If the store is closed or fails integrity verification.
 * @throws {TypeError} If the options are malformed.
 *
 * @example
 * ```ts
 * const redacted = exportRedactedTraceArchive(store);
 * const summary = verifyRedactedTraceArchive(redacted);
 * console.log(summary.redacted_record_count);
 * ```
 *
 * @public
 */
export function exportRedactedTraceArchive(
    store: SQLiteTraceStore,
    options: RetentionClassificationOptions = {},
): string {
    const classify = createSchemaClassifier(options);
    // The store's own export is trusted input; interchange limits bound untrusted archives only.
    const archive = decodeTraceArchive(store.exportTrace(), null);
    return canonicalizeRecord({
        append_intents: archive.appendIntents.map((intent) => ({ ...intent })),
        blobs: archive.blobs.map(({ blob_id, byte_length }) => ({ blob_id, byte_length })),
        canonical_version: kernelProtocolConfig.canonicalVersion,
        cuts: archive.cuts.map((cut) => ({ ...cut })),
        format: retentionProtocolConfig.redactedArchive.format,
        format_version: retentionProtocolConfig.redactedArchive.formatVersion,
        kernel_abi_version: kernelProtocolConfig.abiVersion,
        record_views: archive.recordViews.map((view) => ({ ...view })),
        records: archive.records.map(({ body, envelope }) => {
            const { data_class: dataClass, disposition } = classify(envelope.schema_ref);
            return {
                ...redactBody(body, dataClass, disposition),
                data_class: dataClass,
                envelope,
            };
        }),
        retention_compatibility_version: retentionProtocolConfig.compatibilityVersion,
        source_format: kernelProtocolConfig.interchange.format,
        source_format_version: kernelProtocolConfig.interchange.formatVersion,
    } as unknown as SemanticRecord);
}

/**
 * Verifies the structure and policy conformance of a redacted trace archive.
 *
 * Verbatim records have their identity re-derived from envelope and body and are re-scanned;
 * redacted records must carry a well-formed marker whose data class and disposition match the
 * configured policy for their schema. Views and cuts must cite archived records. Verification
 * does not recover redacted content and does not make the archive importable.
 *
 * @param archiveJson - Text produced by {@link exportRedactedTraceArchive}.
 * @param options - The caller classification used at export time, if any.
 * @returns Frozen counts of the verified archive.
 * @throws {RedactedTraceArchiveError} If the archive is malformed, uses unsupported versions, or
 * disagrees with the retention policy.
 * @throws {TraceArchiveLimitError} If the text exceeds the configured interchange byte or nesting
 * limit before parsing, or a collection exceeds its configured count.
 * @throws {TypeError} If the options are malformed.
 *
 * @public
 */
export function verifyRedactedTraceArchive(
    archiveJson: string,
    options: RetentionClassificationOptions = {},
): RedactedTraceArchiveSummary {
    const classify = createSchemaClassifier(options);
    const archive = readClosed(parseArchive(archiveJson), ARCHIVE_KEYS, "redacted trace archive");
    if (
        archive.format !== retentionProtocolConfig.redactedArchive.format ||
        archive.format_version !== retentionProtocolConfig.redactedArchive.formatVersion ||
        archive.kernel_abi_version !== kernelProtocolConfig.abiVersion ||
        archive.canonical_version !== kernelProtocolConfig.canonicalVersion ||
        archive.retention_compatibility_version !== retentionProtocolConfig.compatibilityVersion ||
        archive.source_format !== kernelProtocolConfig.interchange.format ||
        archive.source_format_version !== kernelProtocolConfig.interchange.formatVersion
    ) {
        throw new RedactedTraceArchiveError("redacted trace archive versions are unsupported");
    }
    const limits = kernelProtocolConfig.interchange.limits;
    assertTraceArchiveCount(archive.append_intents, "maxAppendIntents", limits);
    assertTraceArchiveCount(archive.blobs, "maxBlobs", limits);
    assertTraceArchiveCount(archive.cuts, "maxCuts", limits);
    assertTraceArchiveCount(archive.records, "maxRecords", limits);
    assertTraceArchiveCount(archive.record_views, "maxRecordViews", limits);
    const counts = {
        included: 0,
        omitted: 0,
        redacted: 0,
        secret: 0,
    };
    const recordIds = new Set<string>();
    let previousRecordId = "";
    for (const [index, value] of readList(archive.records, "records").entries()) {
        const record = readClosed(value, RECORD_KEYS, `records[${index}]`);
        const envelope = guard(() => readEnvelope(record.envelope), `records[${index}].envelope`);
        if (envelope.record_id <= previousRecordId) {
            throw new RedactedTraceArchiveError(
                `records[${index}] must be in strictly ascending record identity order`,
            );
        }
        previousRecordId = envelope.record_id;
        recordIds.add(envelope.record_id);
        const expected = classify(envelope.schema_ref);
        if (record.data_class !== expected.data_class) {
            throw new RedactedTraceArchiveError(
                `records[${index}] data class disagrees with the retention policy`,
            );
        }
        const kind = verifyRecordBody(record, envelope, expected.disposition, index);
        counts[kind] += 1;
        if (kind === "redacted" && (record.body as RedactedRecordBody).secret_classes.length > 0) {
            counts.secret += 1;
        }
    }
    const views = readList(archive.record_views, "record_views").map((value, index) =>
        guard(() => readView(value, index), `record_views[${index}]`),
    );
    const cuts = readList(archive.cuts, "cuts").map((value, index) =>
        guard(() => readCut(value, index), `cuts[${index}]`),
    );
    for (const [index, value] of readList(archive.append_intents, "append_intents").entries()) {
        guard(() => readIntent(value, index), `append_intents[${index}]`);
    }
    const blobs = readList(archive.blobs, "blobs");
    for (const [index, value] of blobs.entries()) {
        const blob = readClosed(value, ["blob_id", "byte_length"], `blobs[${index}]`);
        guard(() => assertBlobId(blob.blob_id, `blobs[${index}].blob_id`), `blobs[${index}]`);
        if (!Number.isSafeInteger(blob.byte_length) || Number(blob.byte_length) < 0) {
            throw new RedactedTraceArchiveError(`blobs[${index}] byte length is invalid`);
        }
    }
    const cited = [
        ...views.map(({ record_id }) => record_id),
        ...cuts.flatMap((cut) => [cut.created_by_record_id, cut.through_record_id]),
    ];
    if (cited.some((recordId) => !recordIds.has(recordId))) {
        throw new RedactedTraceArchiveError(
            "redacted trace archive views and cuts must cite archived records",
        );
    }
    return Object.freeze({
        blob_count: blobs.length,
        cut_count: cuts.length,
        included_record_count: counts.included,
        omitted_body_count: counts.omitted,
        record_count: recordIds.size,
        record_view_count: views.length,
        redacted_record_count: counts.redacted,
        secret_record_count: counts.secret,
    });
}

function redactBody(
    body: RecordBody,
    dataClass: RetentionDataClass,
    disposition: RetentionExportDisposition,
): {
    readonly body: RecordBody | RedactedRecordBody;
    readonly disposition: RetentionExportDisposition;
} {
    if (disposition === "omit-body") {
        return {
            body: { body_digest: null, data_class: dataClass, redacted: true, secret_classes: [] },
            disposition,
        };
    }
    const scan = scanSemanticValueForSecrets(body);
    if (disposition === "include" && scan.findings.length === 0) {
        return { body, disposition };
    }
    return {
        body: {
            body_digest: retentionDigest(canonicalizeRecord(body)),
            data_class: dataClass,
            redacted: true,
            secret_classes: scan.secret_classes,
        },
        disposition: "redact",
    };
}

function verifyRecordBody(
    record: Readonly<Record<string, unknown>>,
    envelope: RecordEnvelope,
    configured: RetentionExportDisposition,
    index: number,
): "included" | "omitted" | "redacted" {
    const path = `records[${index}]`;
    if (record.disposition === "include" && configured === "include") {
        guard(() => validateRecordEnvelope(envelope, record.body as RecordBody), `${path}.body`);
        if (scanSemanticValueForSecrets(record.body as RecordBody).findings.length > 0) {
            throw new RedactedTraceArchiveError(`${path}.body contains a detected secret`);
        }
        return "included";
    }
    const marker = readClosed(record.body, MARKER_KEYS, `${path}.body`);
    const secretClasses = readList(marker.secret_classes, `${path}.body.secret_classes`);
    const configuredNames = retentionProtocolConfig.secretClasses.map(({ name }) => name);
    if (
        marker.redacted !== true ||
        marker.data_class !== record.data_class ||
        secretClasses.some(
            (name, position) =>
                typeof name !== "string" ||
                !configuredNames.includes(name) ||
                (position > 0 && name <= (secretClasses[position - 1] as string)),
        )
    ) {
        throw new RedactedTraceArchiveError(`${path}.body is not a valid redaction marker`);
    }
    if (record.disposition === "omit-body" && configured === "omit-body") {
        if (marker.body_digest !== null || secretClasses.length > 0) {
            throw new RedactedTraceArchiveError(`${path}.body discloses an omitted body`);
        }
        return "omitted";
    }
    if (
        record.disposition !== "redact" ||
        configured === "omit-body" ||
        (configured === "include" && secretClasses.length === 0) ||
        !isRetentionDigest(marker.body_digest)
    ) {
        throw new RedactedTraceArchiveError(`${path} disposition disagrees with the policy`);
    }
    return "redacted";
}

function readEnvelope(value: unknown): RecordEnvelope {
    const envelope = readClosed(value, ENVELOPE_KEYS, "envelope");
    assertRecordId(envelope.record_id, "record_id");
    assertRecordId(envelope.digest, "digest");
    assertNonEmptyString(envelope.schema_ref, "schema_ref");
    assertRecordMode(envelope.mode);
    assertString(envelope.witness_ref, "witness_ref");
    if (envelope.witness_ref !== "") {
        assertRecordId(envelope.witness_ref, "witness_ref");
    }
    for (const [position, parent] of readList(
        envelope.caused_by_record_ids,
        "caused_by_record_ids",
    ).entries()) {
        assertRecordId(parent, `caused_by_record_ids[${position}]`);
    }
    if (envelope.digest !== envelope.record_id) {
        throw new TypeError("envelope digest must equal its record identity");
    }
    return envelope as unknown as RecordEnvelope;
}

function isRetentionDigest(value: unknown): boolean {
    const prefix = retentionProtocolConfig.digestPrefix;
    return (
        typeof value === "string" &&
        value.startsWith(prefix) &&
        new RegExp(
            `^[0-9a-f]{${retentionDigestHexLength(retentionProtocolConfig.digestAlgorithm)}}$`,
            "u",
        ).test(value.slice(prefix.length))
    );
}

function parseArchive(archiveJson: string): unknown {
    if (typeof archiveJson !== "string") {
        throw new RedactedTraceArchiveError("redacted trace archive must be JSON text");
    }
    try {
        assertTraceArchiveText(archiveJson, kernelProtocolConfig.interchange.limits);
        return JSON.parse(archiveJson);
    } catch (error) {
        if (error instanceof TraceArchiveLimitError) throw error;
        throw new RedactedTraceArchiveError(
            "redacted trace archive must contain valid JSON without repeated keys",
            { cause: error },
        );
    }
}

function readClosed(
    value: unknown,
    keys: readonly string[],
    path: string,
): Readonly<Record<string, unknown>> {
    if (
        value === null ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        Object.keys(value).sort().join("\0") !== keys.join("\0")
    ) {
        throw new RedactedTraceArchiveError(`${path} must contain exactly its declared fields`);
    }
    return value as Readonly<Record<string, unknown>>;
}

function readList(value: unknown, path: string): readonly unknown[] {
    if (!Array.isArray(value)) {
        throw new RedactedTraceArchiveError(`${path} must be an array`);
    }
    return value;
}

function guard<T>(read: () => T, path: string): T {
    try {
        return read();
    } catch (error) {
        throw new RedactedTraceArchiveError(`${path} is invalid`, { cause: error });
    }
}
