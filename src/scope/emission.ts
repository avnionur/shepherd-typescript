import { scopeProtocolConfig } from "../protocol/config.ts";
import { RECORD_MODES } from "../protocol/values.generated.ts";
import { assertRecordId } from "../record/guards.ts";
import { ROOT_WITNESS_ID } from "../record/root-witness.ts";
import type { RecordBody, RecordId } from "../record/types.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import {
    createScopeCommandAppendIntentId,
    createScopeEmissionBody,
    readCitedRecordIds,
    readScopeData,
} from "./records.ts";
import type { EmitScopeRecordOptions, ScopeEmissionReceipt } from "./types.ts";
import { assertScopeText, readNowMilliseconds, readScopeDataObject } from "./validation.ts";
import { assertScopeWriter } from "./writer.ts";

const [CAPTURE_MODE] = RECORD_MODES;

/**
 * Durably emits validated application data onto one scope-local history under a current fence.
 *
 * The emission record is caused by the exact expected head and every cited retained record, so
 * it extends only the emitting scope's path; it never appears in a parent's effective history,
 * fabricates an outcome, or authorizes external execution. An exact retry of the same command
 * returns the original receipt across restart, including after the head advanced, the fence was
 * released, or a new writer was admitted; changed content conflicts.
 *
 * @param store - Open writable trace store holding the scope registration.
 * @param options - Authenticated writer, exact head, command identity, data, and citations.
 * @returns Frozen durable emission receipt.
 * @throws {ScopeWriterFencedError} If the writer fence is released, expired, or superseded.
 * @throws {ScopeHeadConflictError} If the expected head is not current.
 * @throws {ScopeEvidenceError} If the scope is not registered for mutation or a citation is absent.
 * @throws {AppendIntentConflictError} If the command identity already names different content.
 * @throws {TraceStoreError} If the store is closed.
 * @throws {TypeError} If the writer is forged, data is not canonical, or options are malformed.
 *
 * @example
 * ```ts
 * const emitted = emitScopeRecord(store, {
 *     commandId: "scope-command:emit:1",
 *     data: { note: "draft" },
 *     expectedHeadRecordId: root.head.record_id,
 *     writer,
 * });
 * ```
 *
 * @public
 */
export function emitScopeRecord(
    store: SQLiteTraceStore,
    options: EmitScopeRecordOptions,
): ScopeEmissionReceipt {
    const fields = readScopeDataObject(
        options,
        ["commandId", "data", "expectedHeadRecordId", "writer"],
        "emitScopeRecord options",
        ["citedRecordIds", "nowMilliseconds"],
    );
    assertScopeText(fields.commandId, "commandId");
    assertRecordId(fields.expectedHeadRecordId, "expectedHeadRecordId");
    assertScopeWriter(fields.writer, store);
    const nowMilliseconds = readNowMilliseconds(fields.nowMilliseconds, "nowMilliseconds");
    const citedRecordIds = readCitedRecordIds(fields.citedRecordIds ?? [], "emitScopeRecord");
    if (citedRecordIds.includes(fields.expectedHeadRecordId)) {
        throw new TypeError("citedRecordIds must not include the expected head");
    }
    const data = readScopeData(fields.data, "data");
    const scopeId = fields.writer.scope_id;
    const body = createScopeEmissionBody({
        citedRecordIds,
        commandId: fields.commandId,
        data,
        expectedHeadRecordId: fields.expectedHeadRecordId,
        scopeId,
    });
    const receipt = store.emitScopeRecord(
        scopeId,
        { claimId: fields.writer.claim_id, fencingToken: fields.writer.fencing_token },
        fields.expectedHeadRecordId,
        citedRecordIds,
        nowMilliseconds,
        {
            append_intent_id: createScopeCommandAppendIntentId(fields.commandId),
            batch: {
                groups: [
                    {
                        owner_id: scopeId,
                        records: [
                            {
                                body: body as unknown as RecordBody,
                                caused_by_record_ids: [
                                    fields.expectedHeadRecordId,
                                    ...citedRecordIds,
                                ],
                                mode: CAPTURE_MODE,
                                schema_ref: scopeProtocolConfig.traceSchemas.emission,
                                witness_ref: ROOT_WITNESS_ID,
                            },
                        ],
                    },
                ],
            },
        },
    );
    const range = receipt.owner_ordinal_ranges.get(scopeId) as readonly [number, number];
    return Object.freeze({
        command_id: fields.commandId,
        head: Object.freeze({
            owner_ordinal: range[0],
            record_id: receipt.record_ids[0] as RecordId,
        }),
        previous_head_record_id: fields.expectedHeadRecordId,
        scope_id: scopeId,
    });
}
