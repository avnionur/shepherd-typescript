import { createRecordId, type SemanticRecord } from "../canonical/canonical-record.ts";
import { projectionProtocolConfig, runProtocolConfig } from "../protocol/config.ts";
import { RECORD_MODES, RUN_TERMINAL_STATUSES } from "../protocol/values.generated.ts";
import { ROOT_WITNESS_ID } from "../record/root-witness.ts";
import type { RecordId } from "../record/types.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import type { TaskSchema } from "../task/schema.ts";
import type { DurableTaskExecutionResult } from "./durable-execution-types.ts";
import { executePreparedTask } from "./execution.ts";
import { prepareTaskExecution } from "./execution-preparation.ts";
import type { TaskExecutionOptions, TaskExecutionResult } from "./execution-types.ts";

const [CAPTURE_MODE, DECLARATION_MODE] = RECORD_MODES;
const [FINISHED_RUN_STATUS] = RUN_TERMINAL_STATUSES;

/**
 * Executes one task while retaining its lifecycle, usage, and exact terminal outcome.
 *
 * Caller-owned options are fully validated before the creation record is appended. Creation and
 * start are retained at their actual execution boundaries. Usage, outcome, and terminal lifecycle
 * evidence commit atomically, after which an immutable terminal cut is published.
 *
 * @param store - Open SQLite trace store receiving execution evidence.
 * @param options - Exact task execution options accepted by {@link executeTask}.
 * @returns The immutable execution result and its durable record identities and cut.
 * @throws {TypeError} If execution options or task input are malformed.
 * @throws {TraceStoreError} If durable append or cut publication fails.
 *
 * @example
 * ```ts
 * const durable = await executeTaskDurably(store, {
 *     task: greet,
 *     input: { name: "Ada" },
 *     provider,
 *     runId: "run:greet:1",
 *     budget: { maxTurns: 1 },
 * });
 * const projected = store.projectExecution(durable.ledger.cut.cut_id);
 * ```
 *
 * @public
 */
export async function executeTaskDurably<
    I extends TaskSchema<unknown>,
    O extends TaskSchema<unknown>,
>(
    store: SQLiteTraceStore,
    options: TaskExecutionOptions<I, O>,
): Promise<DurableTaskExecutionResult> {
    const prepared = prepareTaskExecution(options);
    const { definition } = prepared;
    const schemas = projectionProtocolConfig.executionHistory.executionSchemas;
    const created = store.append({
        append_intent_id: createLedgerIntentId(definition.runId, schemas.created),
        batch: {
            groups: [
                {
                    owner_id: definition.runId,
                    records: [
                        {
                            body: {
                                payload: {
                                    budget: definition.budget,
                                    execution_id: definition.runId,
                                    inputs: { value: prepared.input },
                                    parent_execution_id: null,
                                    provider: prepared.provider,
                                    task_artifact_lock: definition.task.artifactLock,
                                    task_ref: definition.task.artifactLock.artifact_digest,
                                },
                            } as SemanticRecord,
                            mode: DECLARATION_MODE,
                            schema_ref: schemas.created,
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    });
    const createdRecordId = created.record_ids[0] as RecordId;
    let startedRecordId: RecordId | null = null;
    const execution = await executePreparedTask(prepared, () => {
        const started = store.append({
            append_intent_id: createLedgerIntentId(definition.runId, schemas.started),
            batch: {
                groups: [
                    {
                        caused_by_record_ids: [createdRecordId],
                        owner_id: definition.runId,
                        records: [
                            {
                                body: { payload: { execution_id: definition.runId } },
                                mode: CAPTURE_MODE,
                                schema_ref: schemas.started,
                                witness_ref: ROOT_WITNESS_ID,
                            },
                        ],
                    },
                ],
            },
        });
        startedRecordId = started.record_ids[0] as RecordId;
    });
    return retainTerminal(
        store,
        prepared.definition.runId,
        createdRecordId,
        startedRecordId,
        execution,
    );
}

function retainTerminal(
    store: SQLiteTraceStore,
    runId: string,
    createdRecordId: RecordId,
    startedRecordId: RecordId | null,
    execution: TaskExecutionResult,
): DurableTaskExecutionResult {
    const schemas = projectionProtocolConfig.executionHistory.executionSchemas;
    const finished = execution.outcome.outcome.status === FINISHED_RUN_STATUS;
    const lifecycleSchema = finished ? schemas.completed : schemas.failed;
    const usageLocalId = runProtocolConfig.schemas.usageId;
    const outcomeLocalId = runProtocolConfig.schemas.outcomeId;
    const terminal = store.append({
        append_intent_id: createLedgerIntentId(runId, runProtocolConfig.schemas.outcomeId),
        batch: {
            groups: [
                {
                    caused_by_record_ids: [startedRecordId ?? createdRecordId],
                    owner_id: runId,
                    records: [
                        ...(execution.usage === null
                            ? []
                            : [
                                  {
                                      append_local_id: usageLocalId,
                                      body: execution.usage,
                                      mode: CAPTURE_MODE,
                                      schema_ref: runProtocolConfig.schemas.usageId,
                                      witness_ref: ROOT_WITNESS_ID,
                                  },
                              ]),
                        {
                            append_local_id: outcomeLocalId,
                            body: execution.outcome,
                            ...(execution.usage === null
                                ? {}
                                : { caused_by_local_refs: [usageLocalId] }),
                            mode: CAPTURE_MODE,
                            schema_ref: runProtocolConfig.schemas.outcomeId,
                            witness_ref: ROOT_WITNESS_ID,
                        },
                        {
                            body: terminalLifecycleBody(runId, execution),
                            caused_by_local_refs: [outcomeLocalId],
                            mode: CAPTURE_MODE,
                            schema_ref: lifecycleSchema,
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    });
    const usageOffset = execution.usage === null ? 0 : 1;
    const usageRecordId = execution.usage === null ? null : (terminal.record_ids[0] as RecordId);
    const outcomeRecordId = terminal.record_ids[usageOffset] as RecordId;
    const lifecycleRecordId = terminal.record_ids[usageOffset + 1] as RecordId;
    const cut = store.publishCut({
        cut_id: createRecordId({ run_id: runId, through_record_id: lifecycleRecordId }),
        target_owner_id: runId,
        through_record_id: lifecycleRecordId,
    });
    return Object.freeze({
        execution,
        ledger: Object.freeze({
            cut,
            created_record_id: createdRecordId,
            lifecycle_record_id: lifecycleRecordId,
            outcome_record_id: outcomeRecordId,
            started: startedRecordId !== null,
            started_record_id: startedRecordId,
            usage_record_id: usageRecordId,
        }),
    });
}

function terminalLifecycleBody(runId: string, execution: TaskExecutionResult): SemanticRecord {
    const outcome = execution.outcome.outcome;
    if (outcome.status === FINISHED_RUN_STATUS) {
        return { payload: { execution_id: runId, outputs: { value: outcome.value } } };
    }
    const error = "message" in outcome ? outcome.message : outcome.reason;
    return { payload: { error, execution_id: runId } };
}

function createLedgerIntentId(runId: string, schemaRef: string): string {
    return createRecordId({ append_intent: { run_id: runId, schema_ref: schemaRef } });
}
