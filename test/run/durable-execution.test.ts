import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
    createStaticProvider,
    executeTaskDurably,
    type ModelRequest,
    SQLiteTraceStore,
    schema,
    task,
} from "../../src/index.ts";

test("executeTaskDurably retains a successful execution across store reopening", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-durable-execution-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const databasePath = path.join(directory, "trace.sqlite");
    const greet = task({
        input: schema.object({ name: schema.string() }),
        instruction: "Greet the supplied person.",
        name: "durable-greet",
        output: schema.object({ greeting: schema.string() }),
        version: "1.0.0",
    });
    const request = {
        input: { name: "Ada" },
        instruction: greet.instruction,
        outputSchema: greet.artifact.output_schema,
    } satisfies ModelRequest;
    const provider = createStaticProvider({
        descriptor: { id: "durable-fixture", model: "offline-v1" },
        exchanges: [
            {
                request,
                response: {
                    output: { greeting: "Hello, Ada" },
                    usage: {
                        cacheCreationInputTokens: 1,
                        cacheReadInputTokens: 2,
                        costUsd: 0.01,
                        inputTokens: 8,
                        outputTokens: 3,
                    },
                },
            },
        ],
    });
    using store = new SQLiteTraceStore(databasePath);

    const durable = await executeTaskDurably(store, {
        budget: { maxCostUsd: 0.01, maxTurns: 1 },
        input: { name: "Ada" },
        provider,
        runId: "run:durable-greet:1",
        task: greet,
    });

    assert.equal(durable.execution.outcome.outcome.status, "finished");
    assert.equal(durable.ledger.started, true);
    assert.equal(durable.ledger.usage_record_id === null, false);
    assert.equal(Object.isFrozen(durable), true);
    assert.deepEqual(
        store.readOwner("run:durable-greet:1").map((record) => record.envelope.schema_ref),
        [
            "shepherd2.execution.created.v1",
            "shepherd2.execution.started.v1",
            "https://avnionur.github.io/shepherd-typescript/schemas/run-usage-v1.schema.json",
            "https://avnionur.github.io/shepherd-typescript/schemas/run-outcome-v1.schema.json",
            "shepherd2.execution.completed.v1",
            "kernel.cut.owner-prefix.v1",
        ],
    );
    store.close();

    using reopened = new SQLiteTraceStore(databasePath);
    const projected = reopened.projectExecution(durable.ledger.cut.cut_id);
    assert.equal(projected.status, "succeeded");
    assert.equal(projected.task_ref, greet.artifactLock.artifact_digest);
    assert.deepEqual(projected.inputs, { value: { name: "Ada" } });
    assert.deepEqual(projected.outputs, { value: { greeting: "Hello, Ada" } });
    assert.equal(projected.terminal_record_id, durable.ledger.lifecycle_record_id);
});

test("executeTaskDurably does not fabricate start or usage evidence for pre-cancellation", async () => {
    const noop = task({
        input: schema.void(),
        instruction: "Return nothing.",
        name: "durable-cancelled",
        output: schema.void(),
        version: "1.0.0",
    });
    const provider = createStaticProvider({
        descriptor: { id: "unused-cancelled-fixture", model: "offline-v1" },
        exchanges: [],
    });
    const controller = new AbortController();
    controller.abort();
    using store = new SQLiteTraceStore();

    const durable = await executeTaskDurably(store, {
        budget: { maxTurns: 1 },
        input: undefined,
        provider,
        runId: "run:durable-cancelled",
        signal: controller.signal,
        task: noop,
    });

    assert.equal(durable.execution.outcome.outcome.status, "cancelled");
    assert.equal(durable.ledger.started, false);
    assert.equal(durable.ledger.started_record_id, null);
    assert.equal(durable.ledger.usage_record_id, null);
    assert.deepEqual(
        store.readOwner("run:durable-cancelled").map((record) => record.envelope.schema_ref),
        [
            "shepherd2.execution.created.v1",
            "https://avnionur.github.io/shepherd-typescript/schemas/run-outcome-v1.schema.json",
            "shepherd2.execution.failed.v1",
            "kernel.cut.owner-prefix.v1",
        ],
    );
    assert.equal(store.projectExecution(durable.ledger.cut.cut_id).status, "failed");
});

test("executeTaskDurably retains started provider failures without fabricating usage", async () => {
    const noop = task({
        input: schema.void(),
        instruction: "Fail through the provider.",
        name: "durable-provider-failure",
        output: schema.void(),
        version: "1.0.0",
    });
    const provider = {
        descriptor: () => ({
            capabilities: { streaming: false, structuredOutput: true, tools: false },
            id: "throwing-provider",
            kind: "static" as const,
            model: "offline-v1",
        }),
        invoke: () => {
            throw new Error("provider unavailable");
        },
    };
    using store = new SQLiteTraceStore();

    const durable = await executeTaskDurably(store, {
        budget: { maxTurns: 1 },
        input: undefined,
        provider,
        runId: "run:durable-provider-failure",
        task: noop,
    });

    assert.equal(durable.execution.outcome.outcome.status, "failed");
    assert.equal(durable.ledger.started, true);
    assert.equal(durable.ledger.usage_record_id, null);
    assert.deepEqual(store.readRecord(durable.ledger.outcome_record_id)?.body, {
        outcome: {
            error_type: "Error",
            message: "provider unavailable",
            retryable: null,
            status: "failed",
        },
        outcome_version: 1,
        run_id: "run:durable-provider-failure",
        task_artifact_lock: noop.artifactLock,
    });
    assert.equal(store.projectExecution(durable.ledger.cut.cut_id).error, "provider unavailable");
});

test("executeTaskDurably retains observed usage for output-validation failure", async () => {
    const stringTask = task({
        input: schema.void(),
        instruction: "Return a string.",
        name: "durable-invalid-output",
        output: schema.string(),
        version: "1.0.0",
    });
    const provider = createStaticProvider({
        descriptor: { id: "durable-invalid-output", model: "offline-v1" },
        exchanges: [
            {
                request: {
                    input: null,
                    instruction: stringTask.instruction,
                    outputSchema: stringTask.artifact.output_schema,
                },
                response: {
                    output: { invalid: true },
                    usage: {
                        cacheCreationInputTokens: 0,
                        cacheReadInputTokens: 0,
                        costUsd: null,
                        inputTokens: 2,
                        outputTokens: 1,
                    },
                },
            },
        ],
    });
    using store = new SQLiteTraceStore();

    const durable = await executeTaskDurably(store, {
        budget: { maxTurns: 1 },
        input: undefined,
        provider,
        runId: "run:durable-invalid-output",
        task: stringTask,
    });

    assert.equal(durable.execution.outcome.outcome.status, "failed");
    assert.notEqual(durable.ledger.usage_record_id, null);
    assert.deepEqual(store.readRecord(durable.ledger.usage_record_id ?? "")?.body, {
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        cost_usd: null,
        input_tokens: 2,
        output_tokens: 1,
        run_id: "run:durable-invalid-output",
        usage_version: 1,
    });
});

test("executeTaskDurably retains pre-invocation budget exhaustion", async () => {
    const noop = task({
        input: schema.void(),
        instruction: "Return nothing.",
        name: "durable-exhausted",
        output: schema.void(),
        version: "1.0.0",
    });
    const provider = createStaticProvider({
        descriptor: { id: "unused-exhausted-fixture", model: "offline-v1" },
        exchanges: [],
    });
    using store = new SQLiteTraceStore();

    const durable = await executeTaskDurably(store, {
        budget: { maxTurns: 0 },
        input: undefined,
        provider,
        runId: "run:durable-exhausted",
        task: noop,
    });

    assert.equal(durable.execution.outcome.outcome.status, "exhausted");
    assert.equal(durable.ledger.started, false);
    assert.equal(durable.ledger.usage_record_id, null);
    assert.equal(store.projectExecution(durable.ledger.cut.cut_id).status, "failed");
});
