import { createRecordId, type SemanticRecord } from "../canonical/canonical-record.ts";
import { projectionProtocolConfig, workspaceProtocolConfig } from "../protocol/config.ts";
import {
    DURABLE_EXECUTION_CLAIMED_APPEND_STATUSES,
    DURABLE_EXECUTION_RECOVERY_STATUSES,
    RECORD_MODES,
    type RETAINED_WORLD_JOURNAL_PHASES,
    RETAINED_WORLD_OUTPUT_STATUSES,
} from "../protocol/values.generated.ts";
import { ROOT_WITNESS_ID } from "../record/root-witness.ts";
import type { RecordId } from "../record/types.ts";
import { readDurableTaskExecution } from "../run/durable-execution-recovery.ts";
import { TraceStoreError } from "../store/errors.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import type { OwnerRecord } from "../store/types.ts";
import type { TaskWorldCaptureJournalInspection } from "./task-world-journal-types.ts";

const [CAPTURE_MODE] = RECORD_MODES;
const [COMMITTED_STATUS] = DURABLE_EXECUTION_CLAIMED_APPEND_STATUSES;
const [ABSENT_STATUS] = DURABLE_EXECUTION_RECOVERY_STATUSES;
const [RETAINED_STATUS] = RETAINED_WORLD_OUTPUT_STATUSES;

/** Ordered configured journal phase. @internal */
export type TaskWorldJournalPhase = (typeof RETAINED_WORLD_JOURNAL_PHASES)[number];

/** Exact started invocation authority for a guarded journal append. @internal */
export type TaskWorldJournalAuthority = {
    readonly claimId: string;
    readonly fencingToken: number;
};

/** Exact immutable journal schema/version pair selected by the calling public API. @internal */
export type TaskWorldJournalWriter = {
    readonly schemaId: string;
    readonly version: number;
};

/** Appends one idempotent capture-journal transition. @internal */
export function appendTaskWorldJournal(
    store: SQLiteTraceStore,
    runId: string,
    captureId: string,
    phase: TaskWorldJournalPhase,
    fields: SemanticRecord,
    parents: readonly RecordId[],
    writer: TaskWorldJournalWriter,
    authority: TaskWorldJournalAuthority | null = null,
): RecordId {
    const body = {
        ...fields,
        capture_id: captureId,
        capture_phase: phase,
        journal_version: writer.version,
        run_id: runId,
    } as SemanticRecord;
    const request = {
        append_intent_id: createRecordId({
            task_world_capture_journal: { capture_id: captureId, phase, run_id: runId },
        }),
        batch: {
            groups: [
                {
                    caused_by_record_ids: parents,
                    owner_id: runId,
                    records: [
                        {
                            body,
                            mode: CAPTURE_MODE,
                            schema_ref: writer.schemaId,
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    } as const;
    if (authority === null) return store.append(request).record_ids[0] as RecordId;
    const claimed = store.appendDurableExecutionTerminal(
        runId,
        authority.claimId,
        authority.fencingToken,
        request,
    );
    if (claimed.status !== COMMITTED_STATUS)
        throw new TraceStoreError("task-world journal append lost its invocation fence");
    const { receipt } = claimed;
    return receipt.record_ids[0] as RecordId;
}

/**
 * Reads one validated durable task-world journal without invoking a runner or carrier.
 *
 * @param store - Open trace store containing capture and execution evidence.
 * @param runId - Exact durable run identity to inspect.
 * @returns Frozen ordered journal prefix and ordinary recovery classification.
 * @throws {TraceStoreError} If retained execution or capture evidence is malformed.
 * @throws {TypeError} If the run identity is malformed.
 *
 * @example
 * ```ts
 * const journal = inspectTaskWorldCaptureJournal(store, "run:review:1");
 * journal.transitions.map((transition) => transition.phase);
 * ```
 *
 * @public
 */
export function inspectTaskWorldCaptureJournal(
    store: SQLiteTraceStore,
    runId: string,
): TaskWorldCaptureJournalInspection {
    const before = store.readOwner(runId);
    const recovery = readDurableTaskExecution(store, runId);
    const after = store.readOwner(runId);
    if (before.length !== after.length) {
        throw new TraceStoreError("task-world journal changed during inspection");
    }
    const records = terminalPrefix(after);
    const journal = records.filter((record) =>
        workspaceProtocolConfig.worldTaskCapture.journalReaders.some(
            ({ schemaId }) => schemaId === record.envelope.schema_ref,
        ),
    );
    const transitions = Object.freeze(
        journal.map((record) =>
            Object.freeze({
                body: record.body as SemanticRecord,
                phase: record.body.capture_phase as TaskWorldJournalPhase,
                record_id: record.envelope.record_id,
            }),
        ),
    );
    const output = records.find(
        (record) =>
            record.envelope.schema_ref === workspaceProtocolConfig.worldTaskCapture.captureSchemaId,
    );
    const captureId = transitions[0]?.body.capture_id ?? output?.body.capture_id;
    return Object.freeze({
        capture_id: typeof captureId === "string" ? captureId : null,
        output_record_id: output?.envelope.record_id ?? null,
        recovery_status: recovery.status,
        run_id: runId,
        status:
            output === undefined ? (transitions.at(-1)?.phase ?? ABSENT_STATUS) : RETAINED_STATUS,
        transitions,
    });
}

function terminalPrefix(records: readonly OwnerRecord[]): readonly OwnerRecord[] {
    const terminal = records.find((record) => {
        const schema = record.envelope.schema_ref;
        return [
            projectionProtocolConfig.executionHistory.executionSchemas.completed,
            projectionProtocolConfig.executionHistory.executionSchemas.failed,
        ].includes(schema);
    });
    return terminal === undefined
        ? records
        : records.filter((record) => record.view.owner_ordinal <= terminal.view.owner_ordinal);
}
