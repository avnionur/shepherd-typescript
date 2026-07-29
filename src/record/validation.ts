import { canonicalizeRecord, type SemanticRecord } from "../canonical/canonical-record.ts";
import { createRecordEnvelope } from "./envelope.ts";
import {
    assertNonEmptyString,
    assertRecordId,
    assertRecordMode,
    assertString,
    validateRecordBody,
} from "./guards.ts";
import type { RecordBody, RecordEnvelope, RecordMode } from "./types.ts";

/**
 * Validates an envelope and verifies its identity against a record body.
 *
 * @param value - The untrusted envelope value to validate.
 * @param body - The body whose semantic identity the envelope must contain.
 * @throws {TypeError} If the shape is invalid or its identity does not match `body`.
 *
 * @public
 */
export function validateRecordEnvelope(
    value: unknown,
    body: RecordBody,
): asserts value is RecordEnvelope {
    validateRecordBody(body);
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError("record envelope must be a plain object");
    }

    const expectedKeys = [
        "caused_by_record_ids",
        "digest",
        "mode",
        "record_id",
        "schema_ref",
        "witness_ref",
    ];
    if (Object.keys(value).sort().join("\0") !== expectedKeys.join("\0")) {
        throw new TypeError("record envelope must contain exactly the v0 envelope fields");
    }
    const envelope = JSON.parse(canonicalizeRecord(value as SemanticRecord)) as Record<
        string,
        unknown
    >;

    assertNonEmptyString(envelope.schema_ref, "schema_ref");
    assertRecordMode(envelope.mode);
    assertString(envelope.witness_ref, "witness_ref");
    if (!Array.isArray(envelope.caused_by_record_ids)) {
        throw new TypeError("caused_by_record_ids must be an array");
    }
    const causedBy: string[] = [];
    for (const [index, recordId] of envelope.caused_by_record_ids.entries()) {
        assertRecordId(recordId, `caused_by_record_ids[${index}]`);
        causedBy.push(recordId);
    }
    assertRecordId(envelope.record_id, "record_id");
    assertRecordId(envelope.digest, "digest");

    const expected = createRecordEnvelope({
        body,
        caused_by_record_ids: causedBy,
        mode: envelope.mode as RecordMode,
        schema_ref: envelope.schema_ref,
        witness_ref: envelope.witness_ref,
    });
    if (canonicalizeRecord(envelope as SemanticRecord) !== canonicalizeRecord(expected)) {
        throw new TypeError("record envelope identity does not match its semantic input");
    }
}
