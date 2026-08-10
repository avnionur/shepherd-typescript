import assert from "node:assert/strict";
import { test } from "node:test";

import {
    AppendIntentConflictError,
    createStaticProvider,
    executeTaskDurably,
    SQLiteTraceStore,
    schema,
    task,
} from "../../src/index.ts";

test("executeTaskDurably validates input before retaining lifecycle evidence", async () => {
    const typedTask = task({
        input: schema.object({ value: schema.string() }),
        instruction: "Return nothing.",
        name: "durable-invalid-input",
        output: schema.void(),
        version: "1.0.0",
    });
    const provider = createStaticProvider({
        descriptor: { id: "unused-invalid-input", model: "offline-v1" },
        exchanges: [],
    });
    using store = new SQLiteTraceStore();

    await assert.rejects(
        executeTaskDurably(store, {
            budget: { maxTurns: 1 },
            input: { value: 1 } as never,
            provider,
            runId: "run:durable-invalid-input",
            task: typedTask,
        }),
        TypeError,
    );
    assert.deepEqual(store.readOwner("run:durable-invalid-input"), []);
});

test("executeTaskDurably replays identical deterministic evidence without duplication", async () => {
    const deterministicTask = task({
        input: schema.void(),
        instruction: "Return a stable value.",
        name: "durable-replay",
        output: schema.string(),
        version: "1.0.0",
    });
    const createProvider = () =>
        createStaticProvider({
            descriptor: { id: "durable-replay", model: "offline-v1" },
            exchanges: [
                {
                    request: {
                        input: null,
                        instruction: deterministicTask.instruction,
                        outputSchema: deterministicTask.artifact.output_schema,
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
    using store = new SQLiteTraceStore();
    const execute = (provider: ReturnType<typeof createProvider>) =>
        executeTaskDurably(store, {
            budget: { maxTurns: 1 },
            input: undefined,
            provider,
            runId: "run:durable-replay",
            task: deterministicTask,
        });

    const first = await execute(createProvider());
    const second = await execute(createProvider());

    assert.deepEqual(second, first);
    assert.equal(store.readOwner("run:durable-replay").length, 6);
});

test("executeTaskDurably rejects changed evidence for an existing run before invocation", async () => {
    const echo = task({
        input: schema.string(),
        instruction: "Return the input.",
        name: "durable-conflict",
        output: schema.string(),
        version: "1.0.0",
    });
    const firstProvider = createStaticProvider({
        descriptor: { id: "durable-conflict", model: "offline-v1" },
        exchanges: [
            {
                request: {
                    input: "first",
                    instruction: echo.instruction,
                    outputSchema: echo.artifact.output_schema,
                },
                response: {
                    output: "first",
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
    const unusedProvider = createStaticProvider({
        descriptor: { id: "durable-conflict", model: "offline-v1" },
        exchanges: [],
    });
    using store = new SQLiteTraceStore();
    await executeTaskDurably(store, {
        budget: { maxTurns: 1 },
        input: "first",
        provider: firstProvider,
        runId: "run:durable-conflict",
        task: echo,
    });

    await assert.rejects(
        executeTaskDurably(store, {
            budget: { maxTurns: 1 },
            input: "changed",
            provider: unusedProvider,
            runId: "run:durable-conflict",
            task: echo,
        }),
        AppendIntentConflictError,
    );
});
