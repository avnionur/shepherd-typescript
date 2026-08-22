import { createHash } from "node:crypto";

import { canonicalizeRecord, type SemanticRecord } from "../canonical/canonical-record.ts";
import { workspaceProtocolConfig } from "../protocol/config.ts";
import {
    RECORD_MODES,
    RETAINED_WORLD_SETTLEMENT_ACTIONS,
    RETAINED_WORLD_SETTLEMENT_CITATION_VERSION,
    RETAINED_WORLD_SETTLEMENT_STATES,
} from "../protocol/values.generated.ts";
import { assertNonEmptyString, assertRecordId } from "../record/guards.ts";
import { ROOT_WITNESS_ID } from "../record/root-witness.ts";
import type { RecordId } from "../record/types.ts";
import type { DurableTaskExecutionSettlementInspection } from "../run/durable-execution-inspection-types.ts";
import { TraceStoreError } from "../store/errors.ts";
import {
    decodeRetainedWorldSettlementOperation,
    decodeRetainedWorldSettlementTerminalReceipt,
} from "../store/retained-world-settlement-codec.ts";
import { readRetainedWorldSettlementRequest } from "../store/retained-world-settlements.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import type {
    RetainedWorldSettlementAdmission,
    RetainedWorldSettlementJournal,
} from "../store/types.ts";

const [CAPTURE_MODE] = RECORD_MODES;
const [, , APPLY_ACTION] = RETAINED_WORLD_SETTLEMENT_ACTIONS;
const [PREPARED_STATE, , SELECTED_STATE, DISCARDED_STATE, APPLIED_STATE] =
    RETAINED_WORLD_SETTLEMENT_STATES;
const CITATION_FIELDS = [
    "action",
    "capture_record_id",
    "citation_cut_id",
    "citation_version",
    "command_id",
    "execution_cut_id",
    "operation_digest",
    "operation_id",
    "operation_json",
    "outcome_record_id",
    "output_id",
    "receipt_digest",
    "receipt_json",
    "request_id",
    "run_id",
    "state",
    "terminal_record_id",
] as const;

/** Exact terminal execution identities attached to a settlement citation. @internal */
export type RetainedWorldSettlementCitationTrace = Readonly<{
    capture_record_id: RecordId;
    execution_cut_id: string;
    outcome_record_id: RecordId;
    run_id: string;
    terminal_record_id: RecordId;
}>;

type RetainedWorldSettlementExecutionTrace = Readonly<{
    capture_record_id?: RecordId;
    execution_cut_id: string;
    outcome_record_id: RecordId;
    run_id: string;
    terminal_record_id: RecordId;
}>;

/** Idempotently appends and publishes one terminal settlement citation. @internal */
export function publishRetainedWorldSettlementCitation(
    store: SQLiteTraceStore,
    journal: RetainedWorldSettlementJournal,
    trace: RetainedWorldSettlementCitationTrace,
): DurableTaskExecutionSettlementInspection {
    const { admission, operation, receipt } = journal;
    // Public settlement coordinators and the closed journal validator establish this authority.
    /* node:coverage ignore next 12 */
    if (
        operation === null ||
        receipt === null ||
        (journal.state !== SELECTED_STATE &&
            journal.state !== DISCARDED_STATE &&
            journal.state !== APPLIED_STATE) ||
        admission.request.run_id !== trace.run_id ||
        admission.request.capture_record_id !== trace.capture_record_id ||
        admission.request.execution_cut_id !== trace.execution_cut_id
    ) {
        throw new TypeError("terminal settlement citation authority is inconsistent");
    }
    const citationCutId = `${workspaceProtocolConfig.settlement.citationCutIdPrefix}${receipt.digest}`;
    const body = {
        action: admission.action,
        capture_record_id: trace.capture_record_id,
        citation_cut_id: citationCutId,
        citation_version: RETAINED_WORLD_SETTLEMENT_CITATION_VERSION,
        command_id: admission.command_id,
        execution_cut_id: trace.execution_cut_id,
        operation_digest: operation.digest,
        operation_id: operation.id,
        operation_json: operation.json,
        outcome_record_id: trace.outcome_record_id,
        output_id: admission.output_id,
        receipt_digest: receipt.digest,
        receipt_json: receipt.json,
        request_id: admission.request_id,
        run_id: trace.run_id,
        state: journal.state,
        terminal_record_id: trace.terminal_record_id,
    } as const;
    const appended = store.append({
        append_intent_id: `${workspaceProtocolConfig.settlement.citationAppendIntentPrefix}${receipt.digest}`,
        batch: {
            groups: [
                {
                    owner_id: trace.run_id,
                    records: [
                        {
                            body,
                            caused_by_record_ids: [
                                trace.capture_record_id,
                                trace.outcome_record_id,
                                trace.terminal_record_id,
                            ],
                            mode: CAPTURE_MODE,
                            schema_ref: workspaceProtocolConfig.settlement.citationSchemaId,
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    });
    const citationRecordId = appended.record_ids[0] as RecordId;
    store.publishCut({
        cut_id: citationCutId,
        target_owner_id: trace.run_id,
        through_record_id: citationRecordId,
    });
    return readRetainedWorldSettlementCitations(
        store,
        trace,
    )[0] as DurableTaskExecutionSettlementInspection;
}

/** Reads every validated terminal settlement citation for one durable execution. @internal */
export function readRetainedWorldSettlementCitations(
    store: SQLiteTraceStore,
    trace: RetainedWorldSettlementExecutionTrace,
): readonly DurableTaskExecutionSettlementInspection[] {
    try {
        const citations = store
            .readOwner(trace.run_id)
            .filter(
                (record) =>
                    record.envelope.schema_ref ===
                    workspaceProtocolConfig.settlement.citationSchemaId,
            );
        const seenOutputs = new Set<string>();
        const seenCommands = new Set<string>();
        const seenRecords = new Set<RecordId>();
        const result: DurableTaskExecutionSettlementInspection[] = [];
        for (const record of citations) {
            if (seenRecords.has(record.envelope.record_id)) continue;
            seenRecords.add(record.envelope.record_id);
            const fields = readExactObject(record.body, CITATION_FIELDS, "settlement citation");
            const textFields = CITATION_FIELDS.filter((field) => field !== "citation_version");
            for (const field of textFields) assertNonEmptyString(fields[field], field);
            assertRecordId(fields.capture_record_id, "settlement citation capture record");
            assertRecordId(fields.outcome_record_id, "settlement citation outcome record");
            assertRecordId(fields.terminal_record_id, "settlement citation terminal record");
            // Individual contradictions are reachable only from corrupt retained store evidence.
            /* node:coverage ignore next 14 */
            if (
                fields.citation_version !== RETAINED_WORLD_SETTLEMENT_CITATION_VERSION ||
                fields.run_id !== trace.run_id ||
                (trace.capture_record_id !== undefined &&
                    fields.capture_record_id !== trace.capture_record_id) ||
                fields.execution_cut_id !== trace.execution_cut_id ||
                fields.outcome_record_id !== trace.outcome_record_id ||
                fields.terminal_record_id !== trace.terminal_record_id ||
                (fields.state !== SELECTED_STATE &&
                    fields.state !== DISCARDED_STATE &&
                    fields.state !== APPLIED_STATE)
            ) {
                throw new TypeError("settlement citation trace identity is inconsistent");
            }
            const operationValue = JSON.parse(fields.operation_json as string) as unknown;
            const operationAction =
                operationValue !== null &&
                typeof operationValue === "object" &&
                !Array.isArray(operationValue)
                    ? Object.getOwnPropertyDescriptor(operationValue, "action")?.value
                    : undefined;
            const operationFields = readExactObject(
                operationValue,
                operationAction === APPLY_ACTION
                    ? ["action", "application_plan", "operation_version", "request", "request_id"]
                    : ["action", "operation_version", "request", "request_id"],
                "settlement citation operation",
            );
            const request = readRetainedWorldSettlementRequest(operationFields.request);
            const requestJson = canonicalizeRecord(request as unknown as SemanticRecord);
            const requestDigest = createHash(workspaceProtocolConfig.digestAlgorithm)
                .update(requestJson)
                .digest("hex");
            const requestId = `${workspaceProtocolConfig.settlement.requestIdPrefix}${requestDigest}`;
            const admission = Object.freeze({
                action: request.action,
                command_id: request.command_id,
                output_id: request.output_id,
                request,
                request_id: requestId,
                state: PREPARED_STATE,
            }) satisfies RetainedWorldSettlementAdmission;
            const operation = decodeRetainedWorldSettlementOperation(
                fields.operation_json as string,
                admission,
            );
            const receipt = decodeRetainedWorldSettlementTerminalReceipt(
                fields.receipt_json as string,
                operation,
            );
            const expectedCutId = `${workspaceProtocolConfig.settlement.citationCutIdPrefix}${receipt.digest}`;
            // The canonical codecs and validated store envelope establish the equalities below.
            /* node:coverage ignore next 27 */
            if (
                fields.action !== request.action ||
                fields.action !== receipt.value.action ||
                fields.command_id !== request.command_id ||
                fields.output_id !== request.output_id ||
                fields.request_id !== requestId ||
                fields.request_id !== operationFields.request_id ||
                fields.operation_id !== operation.id ||
                fields.operation_digest !== operation.digest ||
                fields.receipt_digest !== receipt.digest ||
                fields.state !== receipt.value.state ||
                fields.citation_cut_id !== expectedCutId ||
                request.run_id !== trace.run_id ||
                request.capture_record_id !== fields.capture_record_id ||
                request.execution_cut_id !== trace.execution_cut_id ||
                seenOutputs.has(request.output_id) ||
                seenCommands.has(request.command_id) ||
                record.envelope.mode !== CAPTURE_MODE ||
                record.envelope.witness_ref !== ROOT_WITNESS_ID ||
                !sameRecordIds(record.envelope.caused_by_record_ids, [
                    request.capture_record_id,
                    trace.outcome_record_id,
                    trace.terminal_record_id,
                ])
            ) {
                throw new TypeError("settlement citation evidence is inconsistent");
            }
            const citationCut = store.readCut(expectedCutId);
            // readCut already validates the indexed publication before returning it.
            /* node:coverage ignore next 7 */
            if (
                citationCut.target_owner_id !== trace.run_id ||
                citationCut.publisher_owner_id !== trace.run_id ||
                citationCut.through_record_id !== record.envelope.record_id
            ) {
                throw new TypeError("settlement citation cut is inconsistent");
            }
            const localJournal = store.readRetainedWorldSettlementJournal(request.output_id);
            // A local journal, when present, has already passed the same canonical codecs.
            /* node:coverage ignore next 11 */
            if (
                localJournal !== undefined &&
                (localJournal.state !== fields.state ||
                    localJournal.operation?.id !== operation.id ||
                    localJournal.operation.digest !== operation.digest ||
                    localJournal.operation.json !== operation.json ||
                    localJournal.receipt?.digest !== receipt.digest ||
                    localJournal.receipt.json !== receipt.json)
            ) {
                throw new TypeError("settlement citation disagrees with its local journal");
            }
            seenOutputs.add(request.output_id);
            seenCommands.add(request.command_id);
            result.push(
                Object.freeze({
                    action: request.action,
                    citation_cut: citationCut,
                    citation_record_id: record.envelope.record_id,
                    citation_version: RETAINED_WORLD_SETTLEMENT_CITATION_VERSION,
                    command_id: request.command_id,
                    operation: Object.freeze({
                        digest: operation.digest,
                        id: operation.id,
                        json: operation.json,
                    }),
                    output_id: request.output_id,
                    receipt: Object.freeze({ digest: receipt.digest, json: receipt.json }),
                    request_id: requestId,
                    state: receipt.value.state,
                    trace: Object.freeze({
                        capture_record_id: request.capture_record_id,
                        execution_cut_id: trace.execution_cut_id,
                        outcome_record_id: trace.outcome_record_id,
                        terminal_record_id: trace.terminal_record_id,
                    }),
                }),
            );
        }
        return Object.freeze(result);
    } catch (error) {
        if (error instanceof TraceStoreError) throw error;
        throw new TraceStoreError("durable execution settlement citation is malformed", {
            cause: error,
        });
    }
}

function readExactObject<const Key extends string>(
    value: unknown,
    keys: readonly Key[],
    subject: string,
): Record<Key, unknown> {
    /* node:coverage ignore next 8 */
    if (
        value === null ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    ) {
        throw new TypeError(`${subject} must be exact data`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const ownKeys = Reflect.ownKeys(descriptors);
    const expected = [...keys].sort();
    /* node:coverage ignore next 8 */
    if (
        ownKeys.some((key) => typeof key !== "string") ||
        ownKeys.length !== expected.length ||
        (ownKeys as string[]).sort().some((key, index) => key !== expected[index]) ||
        (ownKeys as string[]).some((key) => !("value" in (descriptors[key] as PropertyDescriptor)))
    ) {
        throw new TypeError(`${subject} must be exact data`);
    }
    return Object.fromEntries(
        keys.map((key) => [key, (descriptors[key] as PropertyDescriptor).value]),
    ) as Record<Key, unknown>;
}

/* node:coverage ignore next 5 */
function sameRecordIds(left: readonly RecordId[], right: readonly RecordId[]): boolean {
    return (
        left.length === right.length && left.every((recordId, index) => recordId === right[index])
    );
}
