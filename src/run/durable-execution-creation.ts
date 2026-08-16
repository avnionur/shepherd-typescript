import { createRecordId, type SemanticRecord } from "../canonical/canonical-record.ts";
import { projectionProtocolConfig } from "../protocol/config.ts";
import { RECORD_MODES } from "../protocol/values.generated.ts";
import { ROOT_WITNESS_ID } from "../record/root-witness.ts";
import type { RecordId } from "../record/types.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import type { TaskSchema } from "../task/schema.ts";
import type { PreparedTaskExecution } from "./execution-preparation.ts";

const [, DECLARATION_MODE] = RECORD_MODES;

/** Retains or verifies the exact configured durable-execution creation contract. @internal */
export function retainDurableExecutionCreation<
    I extends TaskSchema<unknown>,
    O extends TaskSchema<unknown>,
>(store: SQLiteTraceStore, prepared: PreparedTaskExecution<I, O>): RecordId {
    const { definition } = prepared;
    const createdSchema = projectionProtocolConfig.executionHistory.executionSchemas.created;
    const receipt = store.append({
        append_intent_id: createRecordId({
            append_intent: { run_id: definition.runId, schema_ref: createdSchema },
        }),
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
                            schema_ref: createdSchema,
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    });
    return receipt.record_ids[0] as RecordId;
}
