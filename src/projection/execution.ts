import { projectionProtocolConfig } from "../protocol/config.ts";
import { assertNonEmptyString } from "../record/guards.ts";
import type { RecordId } from "../record/types.ts";
import type { Cut, Slice } from "../store/types.ts";
import { assertHistoryProjectionCompatible } from "./compatibility.ts";
import {
    readProjectionPayload,
    readProjectionRecord,
    snapshotProjectionObject,
} from "./record-values.ts";
import type { Execution, ExecutionStatus } from "./types.ts";

/**
 * Projects one execution lifecycle from a compatible payload-visible slice.
 *
 * @param slice - Immutable owner-prefix slice containing lifecycle records.
 * @param executionId - Execution owner to fold in owner-ordinal order.
 * @param cut - Optional published cut represented by the returned projection.
 * @returns A frozen disposable execution value.
 * @throws {ProjectionCompatibilityError} If the slice omits required modes or payloads.
 * @throws {TraceStoreError} If selected lifecycle evidence is absent or malformed.
 * @throws {TypeError} If the execution identifier is empty.
 *
 * @public
 */
export function projectExecution(slice: Slice, executionId: string, cut?: Cut): Execution {
    assertNonEmptyString(executionId, "executionId");
    assertHistoryProjectionCompatible(slice);
    let taskRef = "";
    let parentExecutionId: string | null = null;
    let inputs: Readonly<Record<string, unknown>> = Object.freeze({});
    let outputs: Readonly<Record<string, unknown>> = Object.freeze({});
    let error: string | null = null;
    let status: ExecutionStatus = "pending";
    let startedRecordId: RecordId | null = null;
    let terminalRecordId: RecordId | null = null;
    const schemas = projectionProtocolConfig.executionHistory.executionSchemas;

    for (const recordId of slice.owner_paths[executionId] ?? []) {
        const visible = readProjectionRecord(slice, recordId, "execution projection");
        if (!Object.values(schemas).includes(visible.envelope.schema_ref)) {
            continue;
        }
        const payload = readProjectionPayload(visible, "execution lifecycle");
        if (
            payload.execution_id !== undefined &&
            payload.execution_id !== null &&
            payload.execution_id !== executionId
        ) {
            continue;
        }
        if (visible.envelope.schema_ref === schemas.created) {
            taskRef = String(payload.task_ref ?? "");
            parentExecutionId =
                payload.parent_execution_id === undefined || payload.parent_execution_id === null
                    ? null
                    : String(payload.parent_execution_id);
            inputs = snapshotProjectionObject(payload.inputs);
            status = "pending";
        } else if (visible.envelope.schema_ref === schemas.started) {
            startedRecordId = visible.envelope.record_id;
            status = "running";
        } else if (visible.envelope.schema_ref === schemas.completed) {
            outputs = snapshotProjectionObject(payload.outputs);
            error = null;
            terminalRecordId = visible.envelope.record_id;
            status = "succeeded";
        } else if (visible.envelope.schema_ref === schemas.failed) {
            outputs = Object.freeze({});
            error = String(payload.error ?? "");
            terminalRecordId = visible.envelope.record_id;
            status = "failed";
        }
    }
    return Object.freeze({
        ...(cut === undefined ? {} : { cut }),
        error,
        execution_id: executionId,
        inputs,
        outputs,
        parent_execution_id: parentExecutionId,
        started_record_id: startedRecordId,
        status,
        task_ref: taskRef,
        terminal_record_id: terminalRecordId,
    });
}
