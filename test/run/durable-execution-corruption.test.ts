import assert from "node:assert/strict";
import { test } from "node:test";
import type { OwnerRecord, RecordEnvelope, SemanticRecord } from "../../src/index.ts";
import {
    createStaticProvider,
    executeTaskDurably,
    readDurableTaskExecution,
    SQLiteTraceStore,
    schema,
    TraceStoreError,
    task,
} from "../../src/index.ts";

class RetainedEvidenceStore extends SQLiteTraceStore {
    readonly #records: readonly OwnerRecord[];

    constructor(records: readonly OwnerRecord[]) {
        super();
        this.#records = records;
    }

    override readOwner(_ownerId: string): readonly OwnerRecord[] {
        return this.#records;
    }
}

class FailingEvidenceStore extends SQLiteTraceStore {
    override readOwner(_ownerId: string): readonly OwnerRecord[] {
        throw new TraceStoreError("retained read failed");
    }
}

function replaceSchemaRecord(
    records: readonly OwnerRecord[],
    schemaRef: string,
    replace: (record: OwnerRecord) => OwnerRecord,
): readonly OwnerRecord[] {
    return records.map((record) =>
        record.envelope.schema_ref === schemaRef ? replace(record) : record,
    );
}

function replaceEnvelope(record: OwnerRecord, fields: Partial<RecordEnvelope>): OwnerRecord {
    return { ...record, envelope: { ...record.envelope, ...fields } };
}

function replacePayload(record: OwnerRecord, fields: SemanticRecord): OwnerRecord {
    return { ...record, body: { payload: fields } };
}

function replaceBody(record: OwnerRecord, fields: SemanticRecord): OwnerRecord {
    return { ...record, body: fields };
}

function payload(record: OwnerRecord): SemanticRecord {
    return record.body.payload as SemanticRecord;
}

function assertMalformed(records: readonly OwnerRecord[], runId: string): void {
    using store = new RetainedEvidenceStore(records);
    assert.throws(() => readDurableTaskExecution(store, runId), TraceStoreError);
}

test("readDurableTaskExecution validates absent reads and propagates store failures", () => {
    using empty = new SQLiteTraceStore();
    assert.deepEqual(readDurableTaskExecution(empty, "run:absent"), {
        run_id: "run:absent",
        status: "absent",
    });
    assert.throws(() => readDurableTaskExecution(empty, ""), TypeError);

    using failing = new FailingEvidenceStore();
    assert.throws(
        () => readDurableTaskExecution(failing, "run:failed-read"),
        /retained read failed/u,
    );
});

test("readDurableTaskExecution rejects inconsistent retained lifecycle evidence", async () => {
    const runId = "run:corrupt-recovery";
    const fixtureTask = task({
        input: schema.void(),
        instruction: "Return a durable fixture.",
        name: "corrupt-recovery",
        output: schema.string(),
        version: "1.0.0",
    });
    const otherTask = task({
        input: schema.void(),
        instruction: "Return another fixture.",
        name: "other-recovery",
        output: schema.string(),
        version: "1.0.0",
    });
    const provider = createStaticProvider({
        descriptor: { id: "corrupt-recovery", model: "offline-v1" },
        exchanges: [
            {
                request: {
                    input: null,
                    instruction: fixtureTask.instruction,
                    outputSchema: fixtureTask.artifact.output_schema,
                },
                response: {
                    output: "durable",
                    usage: {
                        cacheCreationInputTokens: 0,
                        cacheReadInputTokens: 0,
                        costUsd: null,
                        inputTokens: 1,
                        outputTokens: 1,
                    },
                },
            },
        ],
    });
    using source = new SQLiteTraceStore();
    const durable = await executeTaskDurably(source, {
        budget: { maxTurns: 1 },
        input: undefined,
        provider,
        runId,
        task: fixtureTask,
    });
    const failedTask = task({
        input: schema.void(),
        instruction: "Fail to expose the configured lifecycle schema.",
        name: "failed-schema-fixture",
        output: schema.void(),
        version: "1.0.0",
    });
    const failedRunId = `${runId}:failed-schema`;
    const failedDurable = await executeTaskDurably(source, {
        budget: {},
        input: undefined,
        provider: {
            descriptor: () => ({
                capabilities: { streaming: false, structuredOutput: true, tools: false },
                id: "failed-schema-fixture",
                kind: "static" as const,
                model: "offline-v1",
            }),
            invoke: () => {
                throw new Error("schema fixture");
            },
        },
        runId: failedRunId,
        task: failedTask,
    });
    const failedTerminal = source.readRecord(failedDurable.ledger.lifecycle_record_id);
    assert.ok(failedTerminal);
    const failedSchema = failedTerminal.envelope.schema_ref;
    const records = source.readOwner(runId);
    const created = records.find(
        (record) => record.envelope.record_id === durable.ledger.created_record_id,
    );
    const started = records.find(
        (record) => record.envelope.record_id === durable.ledger.started_record_id,
    );
    const usage = records.find(
        (record) => record.envelope.record_id === durable.ledger.usage_record_id,
    );
    const outcome = records.find(
        (record) => record.envelope.record_id === durable.ledger.outcome_record_id,
    );
    const terminal = records.find(
        (record) => record.envelope.record_id === durable.ledger.lifecycle_record_id,
    );
    const cut = records.find(
        (record) => record.envelope.record_id === durable.ledger.cut.created_by_record_id,
    );
    assert.ok(created && started && usage && outcome && terminal && cut);
    const schemas = {
        completed: terminal.envelope.schema_ref,
        created: created.envelope.schema_ref,
        cut: cut.envelope.schema_ref,
        outcome: outcome.envelope.schema_ref,
        started: started.envelope.schema_ref,
        usage: usage.envelope.schema_ref,
    };

    const without = (schemaRef: string): readonly OwnerRecord[] =>
        records.filter((record) => record.envelope.schema_ref !== schemaRef);
    assertMalformed(without(schemas.created), runId);
    assertMalformed([...records, created], runId);
    assertMalformed([...records, started], runId);
    assertMalformed([...records, outcome], runId);
    assertMalformed([...records, terminal], runId);
    assertMalformed([...records, cut], runId);
    assertMalformed(without(schemas.outcome), runId);
    assertMalformed(without(schemas.completed), runId);
    assertMalformed([created, usage], runId);

    const startPayload = payload(started);
    assertMalformed(
        replaceSchemaRecord(records, schemas.started, (record) =>
            replacePayload(record, { ...startPayload, execution_id: "run:other" }),
        ),
        runId,
    );
    const terminalPayload = payload(terminal);
    const terminalControl = terminalPayload.control as SemanticRecord;
    const terminalConsumed = terminalControl.consumed as SemanticRecord;
    for (const consumed of [
        { ...terminalConsumed, effects: 1 },
        { ...terminalConsumed, inputTokens: 0 },
        { ...terminalConsumed, turns: 0 },
    ]) {
        assertMalformed(
            replaceSchemaRecord(records, schemas.completed, (record) =>
                replacePayload(record, {
                    ...terminalPayload,
                    control: { ...terminalControl, consumed },
                }),
            ),
            runId,
        );
    }
    assertMalformed(
        replaceSchemaRecord(records, schemas.completed, (record) =>
            replacePayload(record, { ...terminalPayload, execution_id: "run:other" }),
        ),
        runId,
    );
    const createdPayload = payload(created);
    assertMalformed(
        replaceSchemaRecord(records, schemas.created, (record) =>
            replacePayload(record, {
                ...createdPayload,
                task_artifact_lock: otherTask.artifactLock,
                task_ref: otherTask.artifactLock.artifact_digest,
            }),
        ),
        runId,
    );
    assertMalformed(without(schemas.started), runId);
    const withoutStartOrUsage = without(schemas.started).filter(
        (record) => record.envelope.schema_ref !== schemas.usage,
    );
    const noStartCausality = withoutStartOrUsage.map((record) => {
        if (record.envelope.record_id === outcome.envelope.record_id) {
            return replaceEnvelope(record, {
                caused_by_record_ids: Object.freeze([created.envelope.record_id]),
            });
        }
        if (record.envelope.record_id === terminal.envelope.record_id) {
            return replaceEnvelope(record, {
                caused_by_record_ids: Object.freeze([
                    created.envelope.record_id,
                    outcome.envelope.record_id,
                ]),
            });
        }
        return record;
    });
    assertMalformed(
        replaceSchemaRecord(noStartCausality, schemas.completed, (record) =>
            replacePayload(record, {
                ...terminalPayload,
                control: {
                    ...terminalControl,
                    consumed: { ...terminalConsumed, inputTokens: 0, outputTokens: 0, turns: 0 },
                },
            }),
        ),
        runId,
    );

    assertMalformed(
        replaceSchemaRecord(records, schemas.completed, (record) =>
            replacePayload(record, {
                ...terminalPayload,
                outputs: { value: "changed" },
            }),
        ),
        runId,
    );
    assertMalformed(
        replaceSchemaRecord(records, schemas.completed, (record) =>
            replaceEnvelope(record, { schema_ref: failedSchema }),
        ),
        runId,
    );

    for (const fields of [
        { mode: "capture" as const },
        { witness_ref: "record:sha256:other" },
        { caused_by_record_ids: [started.envelope.record_id] },
    ]) {
        assertMalformed(
            replaceSchemaRecord(records, schemas.created, (record) =>
                replaceEnvelope(record, fields),
            ),
            runId,
        );
    }
    assertMalformed(
        replaceSchemaRecord(records, schemas.started, (record) =>
            replaceEnvelope(record, { caused_by_record_ids: [outcome.envelope.record_id] }),
        ),
        runId,
    );

    const cutBody = cut.body;
    for (const fields of [{ cut_id: "cut:other" }, { publisher_owner_id: "run:other" }]) {
        assertMalformed(
            replaceSchemaRecord(records, schemas.cut, (record) => ({
                ...record,
                body: { ...cutBody, ...fields },
            })),
            runId,
        );
    }
    const unrelatedTarget = { ...cut, body: { ...cutBody, target_owner_id: "run:other" } };
    const unrelatedThrough = {
        ...cut,
        body: { ...cutBody, through_record_id: outcome.envelope.record_id },
    };
    using ignoresUnrelated = new RetainedEvidenceStore([
        ...records.filter((record) => record !== cut),
        unrelatedTarget,
        unrelatedThrough,
    ]);
    assert.equal(readDurableTaskExecution(ignoresUnrelated, runId).status, "terminal_pending_cut");
});

test("readDurableTaskExecution rejects failure lifecycle disagreement", async () => {
    const runId = "run:corrupt-failure-recovery";
    const fixtureTask = task({
        input: schema.void(),
        instruction: "Fail durably.",
        name: "corrupt-failure-recovery",
        output: schema.void(),
        version: "1.0.0",
    });
    const provider = {
        descriptor: () => ({
            capabilities: { streaming: false, structuredOutput: true, tools: false },
            id: "corrupt-failure-recovery",
            kind: "static" as const,
            model: "offline-v1",
        }),
        invoke: () => {
            throw new Error("retained failure");
        },
    };
    using source = new SQLiteTraceStore();
    const durable = await executeTaskDurably(source, {
        budget: {},
        input: undefined,
        provider,
        runId,
        task: fixtureTask,
    });
    const completedTask = task({
        input: schema.void(),
        instruction: "Complete to expose the configured lifecycle schema.",
        name: "completed-schema-fixture",
        output: schema.void(),
        version: "1.0.0",
    });
    const completedRunId = `${runId}:completed-schema`;
    const completedDurable = await executeTaskDurably(source, {
        budget: { maxTurns: 1 },
        input: undefined,
        provider: createStaticProvider({
            descriptor: { id: "completed-schema-fixture", model: "offline-v1" },
            exchanges: [
                {
                    request: {
                        input: null,
                        instruction: completedTask.instruction,
                        outputSchema: completedTask.artifact.output_schema,
                    },
                    response: {
                        output: null,
                        usage: {
                            cacheCreationInputTokens: 0,
                            cacheReadInputTokens: 0,
                            costUsd: null,
                            inputTokens: 0,
                            outputTokens: 0,
                        },
                    },
                },
            ],
        }),
        runId: completedRunId,
        task: completedTask,
    });
    const completedTerminal = source.readRecord(completedDurable.ledger.lifecycle_record_id);
    assert.ok(completedTerminal);
    const completedSchema = completedTerminal.envelope.schema_ref;
    const records = source.readOwner(runId);
    const terminal = records.find(
        (record) => record.envelope.record_id === durable.ledger.lifecycle_record_id,
    );
    const started = records.find(
        (record) => record.envelope.record_id === durable.ledger.started_record_id,
    );
    assert.ok(terminal && started);
    const failedSchema = terminal.envelope.schema_ref;
    const startedSchema = started.envelope.schema_ref;
    const terminalPayload = payload(terminal);

    assertMalformed(
        replaceSchemaRecord(records, failedSchema, (record) =>
            replacePayload(record, { ...terminalPayload, error: "changed" }),
        ),
        runId,
    );
    assertMalformed(
        replaceSchemaRecord(records, failedSchema, (record) =>
            replaceEnvelope(record, { schema_ref: completedSchema }),
        ),
        runId,
    );
    assertMalformed(
        records.filter((record) => record.envelope.schema_ref !== startedSchema),
        runId,
    );
});

test("readDurableTaskExecution rejects malformed or unavailable retained artifacts", async () => {
    const runId = "run:corrupt-artifacts";
    const fixtureTask = task({
        input: schema.void(),
        instruction: "Return retained artifacts.",
        name: "corrupt-artifacts",
        output: schema.string(),
        version: "1.0.0",
    });
    const usage = {
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        costUsd: null,
        inputTokens: 1,
        outputTokens: 1,
    };
    using source = new SQLiteTraceStore();
    const durable = await executeTaskDurably(source, {
        budget: { maxTurns: 1 },
        input: undefined,
        provider: {
            descriptor: () => ({
                capabilities: { streaming: false, structuredOutput: true, tools: false },
                id: "corrupt-artifact-provider",
                kind: "static" as const,
                model: "offline-v1",
            }),
            invoke: async () => ({
                artifacts: [
                    {
                        content: { text: "first", type: "text" as const },
                        kind: "report",
                        metadata: {},
                        name: "first.txt",
                    },
                    {
                        content: { text: "second", type: "text" as const },
                        kind: "report",
                        metadata: {},
                        name: "second.txt",
                    },
                ],
                output: "complete",
                usage,
            }),
        },
        runId,
        task: fixtureTask,
    });
    const records = source.readOwner(runId);
    const artifacts = durable.ledger.artifact_record_ids.map((recordId) => {
        const record = records.find((candidate) => candidate.envelope.record_id === recordId);
        assert.ok(record);
        return record;
    });
    const [firstArtifact, secondArtifact] = artifacts;
    assert.ok(firstArtifact && secondArtifact);

    assertMalformed(
        records.filter((record) => record.envelope.record_id !== firstArtifact.envelope.record_id),
        runId,
    );
    assertMalformed([...records, firstArtifact], runId);
    assertMalformed(
        records.map((record) =>
            record === firstArtifact
                ? secondArtifact
                : record === secondArtifact
                  ? firstArtifact
                  : record,
        ),
        runId,
    );
    assertMalformed(
        [
            ...records,
            {
                ...firstArtifact,
                envelope: {
                    ...firstArtifact.envelope,
                    digest: "sha256:orphan",
                    record_id: "sha256:orphan",
                },
            },
        ],
        runId,
    );
    assertMalformed(
        records.map((record) =>
            record.envelope.record_id === firstArtifact.envelope.record_id
                ? replaceBody(record, secondArtifact.body)
                : record,
        ),
        runId,
    );
    assertMalformed(
        records.map((record) =>
            record.envelope.record_id === secondArtifact.envelope.record_id
                ? replaceEnvelope(record, {
                      caused_by_record_ids: Object.freeze([durable.ledger.created_record_id]),
                  })
                : record,
        ),
        runId,
    );
    assertMalformed(
        records.map((record) =>
            record.envelope.record_id === firstArtifact.envelope.record_id
                ? replaceBody(record, { ...firstArtifact.body, run_id: "run:other" })
                : record,
        ),
        runId,
    );

    const blobRunId = `${runId}:blob`;
    const receipt = source.putBlob(Uint8Array.of(7, 8, 9));
    await executeTaskDurably(source, {
        budget: { maxTurns: 1 },
        input: undefined,
        provider: {
            descriptor: () => ({
                capabilities: { streaming: false, structuredOutput: true, tools: false },
                id: "corrupt-blob-provider",
                kind: "static" as const,
                model: "offline-v1",
            }),
            invoke: async () => ({
                artifacts: [
                    {
                        content: { receipt, type: "blob" as const },
                        kind: "binary",
                        metadata: {},
                        name: "retained.bin",
                    },
                ],
                output: "complete",
                usage,
            }),
        },
        runId: blobRunId,
        task: fixtureTask,
    });
    assertMalformed(source.readOwner(blobRunId), blobRunId);
});
