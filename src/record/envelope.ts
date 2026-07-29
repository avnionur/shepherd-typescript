import { createHash } from "node:crypto";

import { canonicalizeRecord, type SemanticRecord } from "../canonical/canonical-record.ts";
import { kernelProtocolConfig, recordIdConfig } from "../protocol/config.ts";
import {
    assertNonEmptyString,
    assertRecordId,
    assertRecordMode,
    assertWitnessRules,
    validateRecordBody,
} from "./guards.ts";
import type { RecordBody, RecordEnvelope, RecordEnvelopeDraft } from "./types.ts";

/**
 * Creates a content-addressed record envelope from semantic input.
 *
 * Causal-parent order is preserved and participates in identity. The returned
 * `record_id` and `digest` are equal under kernel ABI v0.
 *
 * @param draft - Schema, mode, body, witness, and ordered causal references.
 * @returns The validated semantic envelope.
 * @throws {TypeError} If a field is malformed or the body cannot be canonicalized.
 *
 * @public
 */
export function createRecordEnvelope<TBody extends RecordBody>(
    draft: RecordEnvelopeDraft<TBody>,
): RecordEnvelope {
    assertNonEmptyString(draft.schema_ref, "schema_ref");
    assertRecordMode(draft.mode);
    validateRecordBody(draft.body);

    const causedBy = draft.caused_by_record_ids ?? [];
    if (!Array.isArray(causedBy)) {
        throw new TypeError("caused_by_record_ids must be an array");
    }
    canonicalizeRecord({ caused_by_record_ids: causedBy });
    for (const [index, recordId] of causedBy.entries()) {
        assertRecordId(recordId, `caused_by_record_ids[${index}]`);
    }
    assertWitnessRules(draft, causedBy);

    const canonicalInput: SemanticRecord = {
        body: draft.body,
        caused_by: [...causedBy],
        kind: kernelProtocolConfig.recordKind,
        mode: draft.mode,
        schema_ref: draft.schema_ref,
        witness: draft.witness_ref,
    };
    const digest = createHash(recordIdConfig.algorithm)
        .update(`${kernelProtocolConfig.canonicalVersion}\n`, "ascii")
        .update(canonicalizeRecord(canonicalInput), "utf8")
        .digest("hex");
    const recordId = `${recordIdConfig.prefix}${digest}`;

    return {
        record_id: recordId,
        digest: recordId,
        schema_ref: draft.schema_ref,
        mode: draft.mode,
        witness_ref: draft.witness_ref,
        caused_by_record_ids: [...causedBy],
    };
}
