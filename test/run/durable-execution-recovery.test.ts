import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
    type Cut,
    type CutSpec,
    createRecordId,
    createStaticProvider,
    DurableExecutionRecoveryCommandRequiredError,
    DurableExecutionRecoveryError,
    executeTaskDurably,
    ROOT_WITNESS_ID,
    readDurableTaskExecution,
    recoverTaskDurably,
    SQLiteTraceStore,
    schema,
    task,
} from "../../src/index.ts";

class InterruptingCutStore extends SQLiteTraceStore {
    #interruptNextCut = true;

    override publishCut(spec: CutSpec): Cut {
        if (this.#interruptNextCut) {
            this.#interruptNextCut = false;
            throw new Error("cut publication interrupted");
        }
        return super.publishCut(spec);
    }
}

test("readDurableTaskExecution reconstructs a committed result after reopening", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-execution-recovery-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const databasePath = path.join(directory, "trace.sqlite");
    const recoverableTask = task({
        input: schema.string(),
        instruction: "Return the supplied value.",
        name: "recoverable-result",
        output: schema.string(),
        version: "1.0.0",
    });
    const provider = createStaticProvider({
        descriptor: { id: "recovery-fixture", model: "offline-v1" },
        exchanges: [
            {
                request: {
                    input: "retained",
                    instruction: recoverableTask.instruction,
                    outputSchema: recoverableTask.artifact.output_schema,
                },
                response: {
                    output: "retained",
                    usage: {
                        cacheCreationInputTokens: 1,
                        cacheReadInputTokens: 2,
                        costUsd: 0.01,
                        inputTokens: 3,
                        outputTokens: 1,
                    },
                },
            },
        ],
    });
    const original = new SQLiteTraceStore(databasePath);
    const durable = await executeTaskDurably(original, {
        budget: { maxTurns: 1 },
        input: "retained",
        provider,
        runId: "run:recoverable-result",
        task: recoverableTask,
    });
    original.close();

    using reopened = new SQLiteTraceStore(databasePath);
    const recovery = readDurableTaskExecution(reopened, "run:recoverable-result");

    assert.equal(recovery.status, "committed");
    if (recovery.status === "committed") {
        assert.deepEqual(recovery.result, durable);
        assert.equal(Object.isFrozen(recovery), true);
    }

    const unrelated = reopened.append({
        append_intent_id: "intent:unrelated-cut-target",
        batch: {
            groups: [
                {
                    owner_id: "run:unrelated-cut-target",
                    records: [
                        {
                            body: { value: "unrelated" },
                            mode: "capture",
                            schema_ref: "schema:unrelated-cut-target",
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    });
    reopened.publishCut({
        cut_id: "cut:unrelated-owner-prefix",
        publisher_owner_id: "run:recoverable-result",
        target_owner_id: "run:unrelated-cut-target",
        through_record_id: unrelated.record_ids[0] ?? "",
    });
    assert.deepEqual(readDurableTaskExecution(reopened, "run:recoverable-result"), recovery);
});

test("executeTaskDurably returns committed evidence without invoking the provider again", async () => {
    const stableTask = task({
        input: schema.void(),
        instruction: "Return a stable value.",
        name: "recover-committed",
        output: schema.string(),
        version: "1.0.0",
    });
    const descriptor = {
        capabilities: { streaming: false, structuredOutput: true, tools: false },
        id: "committed-recovery",
        kind: "static" as const,
        model: "offline-v1",
    };
    const firstProvider = createStaticProvider({
        descriptor: { id: descriptor.id, model: descriptor.model },
        exchanges: [
            {
                request: {
                    input: null,
                    instruction: stableTask.instruction,
                    outputSchema: stableTask.artifact.output_schema,
                },
                response: {
                    output: "stable",
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
    let invocationCount = 0;
    const replacementProvider = {
        descriptor: () => descriptor,
        invoke: () => {
            invocationCount += 1;
            throw new Error("committed execution must not invoke");
        },
    };
    using store = new SQLiteTraceStore();
    const options = {
        budget: { maxTurns: 1 },
        input: undefined,
        runId: "run:recover-committed",
        task: stableTask,
    } as const;
    const committed = await executeTaskDurably(store, { ...options, provider: firstProvider });

    const recovered = await executeTaskDurably(store, {
        ...options,
        provider: replacementProvider,
    });

    assert.deepEqual(recovered, committed);
    assert.equal(invocationCount, 0);
});

test("created evidence requires an explicit recovery command before provider start", async () => {
    const resumableTask = task({
        input: schema.void(),
        instruction: "Return after recovery.",
        name: "resume-created",
        output: schema.string(),
        version: "1.0.0",
    });
    const provider = createStaticProvider({
        descriptor: { id: "created-recovery", model: "offline-v1" },
        exchanges: [
            {
                request: {
                    input: null,
                    instruction: resumableTask.instruction,
                    outputSchema: resumableTask.artifact.output_schema,
                },
                response: {
                    output: "recovered",
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
    const runId = "run:resume-created";
    const createdSchema = "shepherd2.execution.created.v1";
    using store = new SQLiteTraceStore();
    const created = store.append({
        append_intent_id: createRecordId({
            append_intent: { run_id: runId, schema_ref: createdSchema },
        }),
        batch: {
            groups: [
                {
                    owner_id: runId,
                    records: [
                        {
                            body: {
                                payload: {
                                    budget: { maxTurns: 1 },
                                    execution_id: runId,
                                    inputs: { value: null },
                                    parent_execution_id: null,
                                    provider: provider.descriptor(),
                                    task_artifact_lock: resumableTask.artifactLock,
                                    task_ref: resumableTask.artifactLock.artifact_digest,
                                },
                            },
                            mode: "declaration",
                            schema_ref: createdSchema,
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    });

    assert.deepEqual(readDurableTaskExecution(store, runId), {
        created_record_id: created.record_ids[0],
        run_id: runId,
        status: "created",
    });
    const execution = {
        budget: { maxTurns: 1 },
        input: undefined,
        provider,
        runId,
        task: resumableTask,
    } as const;
    await assert.rejects(
        executeTaskDurably(store, execution),
        DurableExecutionRecoveryCommandRequiredError,
    );
    const resumed = await recoverTaskDurably(store, {
        commandId: "command:recover:created-evidence",
        execution,
    });

    assert.equal(resumed.result.execution.outcome.outcome.status, "finished");
    assert.equal(store.readOwner(runId).length, 7);
});

test("executeTaskDurably fails closed for started execution without terminal evidence", async () => {
    const uncertainTask = task({
        input: schema.void(),
        instruction: "Potentially already invoked.",
        name: "recover-started",
        output: schema.void(),
        version: "1.0.0",
    });
    const descriptor = {
        capabilities: { streaming: false, structuredOutput: true, tools: false },
        id: "started-recovery",
        kind: "static" as const,
        model: "offline-v1",
    };
    let invocationCount = 0;
    const provider = {
        descriptor: () => descriptor,
        invoke: () => {
            invocationCount += 1;
            throw new Error("unsafe duplicate invocation");
        },
    };
    const runId = "run:recover-started";
    const createdSchema = "shepherd2.execution.created.v1";
    const startedSchema = "shepherd2.execution.started.v1";
    using store = new SQLiteTraceStore();
    const created = store.append({
        append_intent_id: createRecordId({
            append_intent: { run_id: runId, schema_ref: createdSchema },
        }),
        batch: {
            groups: [
                {
                    owner_id: runId,
                    records: [
                        {
                            body: {
                                payload: {
                                    budget: { maxTurns: 1 },
                                    execution_id: runId,
                                    inputs: { value: null },
                                    parent_execution_id: null,
                                    provider: descriptor,
                                    task_artifact_lock: uncertainTask.artifactLock,
                                    task_ref: uncertainTask.artifactLock.artifact_digest,
                                },
                            },
                            mode: "declaration",
                            schema_ref: createdSchema,
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    });
    const started = store.append({
        append_intent_id: createRecordId({
            append_intent: { run_id: runId, schema_ref: startedSchema },
        }),
        batch: {
            groups: [
                {
                    caused_by_record_ids: [created.record_ids[0] ?? ""],
                    owner_id: runId,
                    records: [
                        {
                            body: { payload: { execution_id: runId } },
                            mode: "capture",
                            schema_ref: startedSchema,
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    });

    assert.deepEqual(readDurableTaskExecution(store, runId), {
        created_record_id: created.record_ids[0],
        run_id: runId,
        started_record_id: started.record_ids[0],
        status: "started",
    });
    await assert.rejects(
        executeTaskDurably(store, {
            budget: { maxTurns: 1 },
            input: undefined,
            provider,
            runId,
            task: uncertainTask,
        }),
        DurableExecutionRecoveryError,
    );
    assert.equal(invocationCount, 0);
});

test("a missing terminal cut requires an explicit recovery command", async () => {
    const terminalTask = task({
        input: schema.void(),
        instruction: "Return terminal evidence.",
        name: "recover-terminal-cut",
        output: schema.string(),
        version: "1.0.0",
    });
    const descriptor = {
        capabilities: { streaming: false, structuredOutput: true, tools: false },
        id: "terminal-cut-recovery",
        kind: "static" as const,
        model: "offline-v1",
    };
    const firstProvider = createStaticProvider({
        descriptor: { id: descriptor.id, model: descriptor.model },
        exchanges: [
            {
                request: {
                    input: null,
                    instruction: terminalTask.instruction,
                    outputSchema: terminalTask.artifact.output_schema,
                },
                response: {
                    output: "terminal",
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
    let invocationCount = 0;
    const replacementProvider = {
        descriptor: () => descriptor,
        invoke: () => {
            invocationCount += 1;
            throw new Error("terminal recovery must not invoke");
        },
    };
    const runId = "run:recover-terminal-cut";
    using store = new InterruptingCutStore();

    await assert.rejects(
        executeTaskDurably(store, {
            budget: { maxTurns: 1 },
            input: undefined,
            provider: firstProvider,
            runId,
            task: terminalTask,
        }),
        /cut publication interrupted/u,
    );
    assert.equal(readDurableTaskExecution(store, runId).status, "terminal_pending_cut");

    const execution = {
        budget: { maxTurns: 1 },
        input: undefined,
        provider: replacementProvider,
        runId,
        task: terminalTask,
    } as const;
    await assert.rejects(
        executeTaskDurably(store, execution),
        DurableExecutionRecoveryCommandRequiredError,
    );
    const recovered = await recoverTaskDurably(store, {
        commandId: "command:recover:missing-terminal-cut",
        execution,
    });

    assert.equal(recovered.result.execution.outcome.outcome.status, "finished");
    assert.equal(invocationCount, 0);
    assert.equal(readDurableTaskExecution(store, runId).status, "committed");
});
