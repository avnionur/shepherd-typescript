import assert from "node:assert/strict";
import { test } from "node:test";

import {
    createRunArtifact,
    createStaticProvider,
    executeTask,
    type ModelProvider,
    type ModelRequest,
    SQLiteTraceStore,
    schema,
    task,
} from "../../src/index.ts";

test("executeTask assigns ordered run artifacts from a provider response", async () => {
    const fixtureTask = task({
        input: schema.void(),
        instruction: "Return a result and its artifacts.",
        name: "artifact-result",
        output: schema.string(),
        version: "1.0.0",
    });
    using artifactStore = new SQLiteTraceStore();
    const receipt = artifactStore.putBlob(Uint8Array.of(7, 8, 9));
    const provider = {
        descriptor: () => ({
            capabilities: { streaming: false, structuredOutput: true, tools: false },
            id: "artifact-provider",
            kind: "static" as const,
            model: "offline-v1",
        }),
        invoke: async () => ({
            artifacts: [
                {
                    content: { text: "artifact text", type: "text" as const },
                    kind: "report",
                    metadata: { media_type: "text/plain" },
                    name: "report.txt",
                },
                {
                    content: { receipt, type: "blob" as const },
                    kind: "binary",
                    metadata: {},
                    name: "data.bin",
                },
            ],
            output: "complete",
            usage: {
                cacheCreationInputTokens: 0,
                cacheReadInputTokens: 0,
                costUsd: null,
                inputTokens: 1,
                outputTokens: 1,
            },
        }),
    };

    const execution = await executeTask({
        budget: { maxTurns: 1 },
        input: undefined,
        provider,
        runId: "run:artifact-result",
        task: fixtureTask,
    });

    assert.deepEqual(execution.artifacts, [
        createRunArtifact({
            artifactOrdinal: 0,
            content: { text: "artifact text", type: "text" },
            kind: "report",
            metadata: { media_type: "text/plain" },
            name: "report.txt",
            runId: "run:artifact-result",
        }),
        createRunArtifact({
            artifactOrdinal: 1,
            content: { receipt, type: "blob" },
            kind: "binary",
            metadata: {},
            name: "data.bin",
            runId: "run:artifact-result",
        }),
    ]);
});

test("executeTask completes a validated bodyless task through a provider", async () => {
    const greet = task({
        input: schema.object({ name: schema.string() }),
        instruction: "Greet the supplied person.",
        name: "greet",
        output: schema.object({ greeting: schema.string() }),
        version: "1.0.0",
    });
    const request = {
        input: { name: "Ada" },
        instruction: greet.instruction,
        outputSchema: greet.artifact.output_schema,
    } satisfies ModelRequest;
    const provider = createStaticProvider({
        descriptor: { id: "executor-fixture", model: "offline-v1" },
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

    const execution = await executeTask({
        budget: {
            maxCostUsd: 0.01,
            maxInputTokens: 8,
            maxOutputTokens: 3,
            maxTurns: 1,
        },
        input: { name: "Ada" },
        provider,
        runId: "run:greet:1",
        task: greet,
    });

    assert.deepEqual(execution.outcome, {
        outcome_version: 1,
        outcome: { status: "finished", value: { greeting: "Hello, Ada" } },
        run_id: "run:greet:1",
        task_artifact_lock: greet.artifactLock,
    });
    assert.deepEqual(execution.usage, {
        cache_creation_input_tokens: 1,
        cache_read_input_tokens: 2,
        cost_usd: 0.01,
        input_tokens: 8,
        output_tokens: 3,
        run_id: "run:greet:1",
        usage_version: 1,
    });
    assert.deepEqual(execution.provider, provider.descriptor());
    assert.deepEqual(execution.control, {
        consumed: {
            costUsd: 0.01,
            effects: 0,
            inputTokens: 8,
            outputTokens: 3,
            turns: 1,
        },
        reason: null,
        status: "active",
    });
    assert.equal(Object.isFrozen(execution), true);
});

test("executeTask records invalid provider output as a failed outcome with observed usage", async () => {
    const stringTask = task({
        input: schema.void(),
        instruction: "Return a string.",
        name: "string-output",
        output: schema.string(),
        version: "1.0.0",
    });
    const provider = createStaticProvider({
        descriptor: { id: "invalid-output-fixture", model: "offline-v1" },
        exchanges: [
            {
                request: {
                    input: null,
                    instruction: stringTask.instruction,
                    outputSchema: stringTask.artifact.output_schema,
                },
                response: {
                    output: { unexpected: true },
                    usage: {
                        cacheCreationInputTokens: 0,
                        cacheReadInputTokens: 0,
                        costUsd: 0.02,
                        inputTokens: 4,
                        outputTokens: 2,
                    },
                },
            },
        ],
    });

    const execution = await executeTask({
        budget: { maxTurns: 1 },
        input: undefined,
        provider,
        runId: "run:invalid-output",
        task: stringTask,
    });

    assert.deepEqual(execution.outcome.outcome, {
        error_type: "TaskOutputValidationError",
        message: "$ must be a well-formed string",
        retryable: false,
        status: "failed",
    });
    assert.equal(execution.usage?.cost_usd, 0.02);
    assert.equal(execution.control.consumed.turns, 1);
});

test("executeTask classifies provider invocation errors without fabricating usage", async () => {
    const readyTask = task({
        input: schema.void(),
        instruction: "Return ready.",
        name: "ready",
        output: schema.string(),
        version: "1.0.0",
    });
    const provider = createStaticProvider({
        descriptor: { id: "mismatch-fixture", model: "offline-v1" },
        exchanges: [
            {
                request: {
                    input: null,
                    instruction: "A different instruction.",
                    outputSchema: readyTask.artifact.output_schema,
                },
                response: {
                    output: "ready",
                    usage: {
                        cacheCreationInputTokens: 0,
                        cacheReadInputTokens: 0,
                        costUsd: 0,
                        inputTokens: 1,
                        outputTokens: 1,
                    },
                },
            },
        ],
    });

    const execution = await executeTask({
        budget: { maxTurns: 1 },
        input: undefined,
        provider,
        runId: "run:provider-failure",
        task: readyTask,
    });

    assert.deepEqual(execution.outcome.outcome, {
        error_type: "StaticProviderRequestMismatchError",
        message: "static provider request does not match the next exchange",
        retryable: null,
        status: "failed",
    });
    assert.equal(execution.usage, null);
    assert.equal(execution.control.consumed.turns, 1);
});

test("executeTask refuses an over-budget turn before consuming a provider exchange", async () => {
    const readyTask = task({
        input: schema.void(),
        instruction: "Return ready.",
        name: "budgeted-ready",
        output: schema.string(),
        version: "1.0.0",
    });
    const provider = createStaticProvider({
        descriptor: { id: "budget-fixture", model: "offline-v1" },
        exchanges: [
            {
                request: {
                    input: null,
                    instruction: readyTask.instruction,
                    outputSchema: readyTask.artifact.output_schema,
                },
                response: {
                    output: "ready",
                    usage: {
                        cacheCreationInputTokens: 0,
                        cacheReadInputTokens: 0,
                        costUsd: 0,
                        inputTokens: 1,
                        outputTokens: 1,
                    },
                },
            },
        ],
    });

    const exhausted = await executeTask({
        budget: { maxTurns: 0 },
        input: undefined,
        provider,
        runId: "run:no-turns",
        task: readyTask,
    });
    assert.deepEqual(exhausted.outcome.outcome, {
        reason: "run budget exceeded: turns 1 > 0",
        status: "exhausted",
    });
    assert.equal(exhausted.usage, null);
    assert.equal(exhausted.control.status, "exhausted");

    const completed = await executeTask({
        budget: { maxTurns: 1 },
        input: undefined,
        provider,
        runId: "run:one-turn",
        task: readyTask,
    });
    assert.equal(completed.outcome.outcome.status, "finished");
});

test("executeTask preserves provider usage when measured tokens exhaust the budget", async () => {
    const tokenTask = task({
        input: schema.void(),
        instruction: "Return the token result.",
        name: "token-result",
        output: schema.string(),
        version: "1.0.0",
    });
    const provider = createStaticProvider({
        descriptor: { id: "token-budget-fixture", model: "offline-v1" },
        exchanges: [
            {
                request: {
                    input: null,
                    instruction: tokenTask.instruction,
                    outputSchema: tokenTask.artifact.output_schema,
                },
                response: {
                    output: "complete",
                    usage: {
                        cacheCreationInputTokens: 0,
                        cacheReadInputTokens: 0,
                        costUsd: 0,
                        inputTokens: 6,
                        outputTokens: 2,
                    },
                },
            },
        ],
    });

    const execution = await executeTask({
        budget: { maxInputTokens: 5, maxTurns: 1 },
        input: undefined,
        provider,
        runId: "run:token-budget",
        task: tokenTask,
    });

    assert.deepEqual(execution.outcome.outcome, {
        reason: "run budget exceeded: input_tokens 6 > 5",
        status: "exhausted",
    });
    assert.equal(execution.usage?.input_tokens, 6);
    assert.equal(execution.control.status, "exhausted");
});

test("executeTask records caller cancellation without consuming a provider exchange", async () => {
    const cancelledTask = task({
        input: schema.void(),
        instruction: "Return after cancellation.",
        name: "cancelled",
        output: schema.string(),
        version: "1.0.0",
    });
    const provider = createStaticProvider({
        descriptor: { id: "cancelled-fixture", model: "offline-v1" },
        exchanges: [
            {
                request: {
                    input: null,
                    instruction: cancelledTask.instruction,
                    outputSchema: cancelledTask.artifact.output_schema,
                },
                response: {
                    output: "complete",
                    usage: {
                        cacheCreationInputTokens: 0,
                        cacheReadInputTokens: 0,
                        costUsd: 0,
                        inputTokens: 1,
                        outputTokens: 1,
                    },
                },
            },
        ],
    });
    const caller = new AbortController();
    caller.abort(new Error("stop"));

    const cancelled = await executeTask({
        budget: { maxTurns: 1 },
        input: undefined,
        provider,
        runId: "run:cancelled",
        signal: caller.signal,
        task: cancelledTask,
    });
    assert.deepEqual(cancelled.outcome.outcome, {
        reason: "run cancelled by caller",
        status: "cancelled",
    });
    assert.equal(cancelled.usage, null);
    assert.equal(cancelled.control.status, "cancelled");

    const completed = await executeTask({
        budget: { maxTurns: 1 },
        input: undefined,
        provider,
        runId: "run:not-cancelled",
        task: cancelledTask,
    });
    assert.equal(completed.outcome.outcome.status, "finished");
});

test("executeTask fails closed when configured cost cannot be measured", async () => {
    const costTask = task({
        input: schema.void(),
        instruction: "Return without measured cost.",
        name: "unmeasured-cost",
        output: schema.string(),
        version: "1.0.0",
    });
    const provider = createStaticProvider({
        descriptor: { id: "unmeasured-cost-fixture", model: "offline-v1" },
        exchanges: [
            {
                request: {
                    input: null,
                    instruction: costTask.instruction,
                    outputSchema: costTask.artifact.output_schema,
                },
                response: {
                    output: "complete",
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

    const execution = await executeTask({
        budget: { maxCostUsd: 1, maxTurns: 1 },
        input: undefined,
        provider,
        runId: "run:unmeasured-cost",
        task: costTask,
    });

    assert.deepEqual(execution.outcome.outcome, {
        error_type: "RunCostUnavailableError",
        message: "provider cost is unavailable for a configured cost budget",
        retryable: false,
        status: "failed",
    });
    assert.equal(execution.usage?.cost_usd, null);
    assert.equal(execution.control.status, "active");
});

test("executeTask normalizes void task input and output to canonical null", async () => {
    const voidTask = task({
        input: schema.void(),
        instruction: "Complete without a value.",
        name: "void-task",
        output: schema.void(),
        version: "1.0.0",
    });
    const provider = createStaticProvider({
        descriptor: { id: "void-fixture", model: "offline-v1" },
        exchanges: [
            {
                request: {
                    input: null,
                    instruction: voidTask.instruction,
                    outputSchema: voidTask.artifact.output_schema,
                },
                response: {
                    output: null,
                    usage: {
                        cacheCreationInputTokens: 0,
                        cacheReadInputTokens: 0,
                        costUsd: 0,
                        inputTokens: 1,
                        outputTokens: 0,
                    },
                },
            },
        ],
    });

    const execution = await executeTask({
        budget: { maxTurns: 1 },
        input: undefined,
        provider,
        runId: "run:void",
        task: voidTask,
    });

    assert.deepEqual(execution.outcome.outcome, { status: "finished", value: null });
});

test("executeTask validates run identity before invoking the provider", async () => {
    const identityTask = task({
        input: schema.void(),
        instruction: "Return identity result.",
        name: "identity-task",
        output: schema.string(),
        version: "1.0.0",
    });
    const provider = createStaticProvider({
        descriptor: { id: "identity-fixture", model: "offline-v1" },
        exchanges: [
            {
                request: {
                    input: null,
                    instruction: identityTask.instruction,
                    outputSchema: identityTask.artifact.output_schema,
                },
                response: {
                    output: "complete",
                    usage: {
                        cacheCreationInputTokens: 0,
                        cacheReadInputTokens: 0,
                        costUsd: 0,
                        inputTokens: 1,
                        outputTokens: 1,
                    },
                },
            },
        ],
    });

    await assert.rejects(
        executeTask({
            budget: { maxTurns: 1 },
            input: undefined,
            provider,
            runId: "",
            task: identityTask,
        }),
        TypeError,
    );
    const completed = await executeTask({
        budget: { maxTurns: 1 },
        input: undefined,
        provider,
        runId: "run:identity",
        task: identityTask,
    });
    assert.equal(completed.outcome.outcome.status, "finished");
});

test("executeTask rejects malformed task input without consuming a provider exchange", async () => {
    const inputTask = task({
        input: schema.object({ name: schema.string() }),
        instruction: "Return after input validation.",
        name: "input-validation",
        output: schema.string(),
        version: "1.0.0",
    });
    const provider = createStaticProvider({
        descriptor: { id: "input-validation-fixture", model: "offline-v1" },
        exchanges: [
            {
                request: {
                    input: { name: "Ada" },
                    instruction: inputTask.instruction,
                    outputSchema: inputTask.artifact.output_schema,
                },
                response: {
                    output: "complete",
                    usage: {
                        cacheCreationInputTokens: 0,
                        cacheReadInputTokens: 0,
                        costUsd: 0,
                        inputTokens: 1,
                        outputTokens: 1,
                    },
                },
            },
        ],
    });

    await assert.rejects(
        executeTask({
            budget: { maxTurns: 1 },
            input: { name: 42 } as unknown as { readonly name: string },
            provider,
            runId: "run:invalid-input",
            task: inputTask,
        }),
        TypeError,
    );
    const completed = await executeTask({
        budget: { maxTurns: 1 },
        input: { name: "Ada" },
        provider,
        runId: "run:valid-input",
        task: inputTask,
    });
    assert.equal(completed.outcome.outcome.status, "finished");
});

test("executeTask preserves cancellation that occurs inside provider invocation", async () => {
    const caller = new AbortController();
    const cancellationTask = task({
        input: schema.void(),
        instruction: "Wait for cancellation.",
        name: "in-flight-cancellation",
        output: schema.string(),
        version: "1.0.0",
    });
    const provider = {
        descriptor: () => ({
            capabilities: { streaming: false, structuredOutput: true, tools: false },
            id: "in-flight-cancellation-fixture",
            kind: "static",
            model: "offline-v1",
        }),
        invoke: async (_request, signal) => {
            caller.abort("stop in flight");
            signal.throwIfAborted();
            throw new Error("unreachable");
        },
    } satisfies ModelProvider;

    const execution = await executeTask({
        budget: { maxTurns: 1 },
        input: undefined,
        provider,
        runId: "run:in-flight-cancellation",
        signal: caller.signal,
        task: cancellationTask,
    });

    assert.deepEqual(execution.outcome.outcome, {
        reason: "run cancelled by caller",
        status: "cancelled",
    });
    assert.equal(execution.usage, null);
});

test("executeTask retains usage when an abort-ignoring provider resolves after cancellation", async () => {
    const caller = new AbortController();
    const lateTask = task({
        input: schema.void(),
        instruction: "Resolve after cancellation.",
        name: "late-cancellation",
        output: schema.string(),
        version: "1.0.0",
    });
    const provider = {
        descriptor: () => ({
            capabilities: { streaming: false, structuredOutput: true, tools: false },
            id: "late-cancellation-fixture",
            kind: "static",
            model: "offline-v1",
        }),
        invoke: async () => {
            caller.abort("stop before response");
            return {
                output: "late",
                usage: {
                    cacheCreationInputTokens: 0,
                    cacheReadInputTokens: 0,
                    costUsd: 0.01,
                    inputTokens: 3,
                    outputTokens: 1,
                },
            };
        },
    } satisfies ModelProvider;

    const execution = await executeTask({
        budget: { maxTurns: 1 },
        input: undefined,
        provider,
        runId: "run:late-cancellation",
        signal: caller.signal,
        task: lateTask,
    });

    assert.deepEqual(execution.outcome.outcome, {
        reason: "run cancelled by caller",
        status: "cancelled",
    });
    assert.equal(execution.usage?.input_tokens, 3);
    assert.equal(execution.control.consumed.turns, 1);
    assert.equal(execution.control.consumed.inputTokens, 0);
    assert.equal(execution.control.consumed.outputTokens, 0);
    assert.equal(execution.control.consumed.costUsd, 0);
});

test("executeTask uses configured fallbacks for opaque provider failures", async () => {
    const failureTask = task({
        input: schema.void(),
        instruction: "Fail opaquely.",
        name: "opaque-provider-failure",
        output: schema.string(),
        version: "1.0.0",
    });
    const provider = {
        descriptor: () => ({
            capabilities: { streaming: false, structuredOutput: true, tools: false },
            id: "opaque-failure-fixture",
            kind: "static",
            model: "offline-v1",
        }),
        invoke: async () => Promise.reject("opaque failure"),
    } satisfies ModelProvider;

    const execution = await executeTask({
        budget: { maxTurns: 1 },
        input: undefined,
        provider,
        runId: "run:opaque-failure",
        task: failureTask,
    });

    assert.deepEqual(execution.outcome.outcome, {
        error_type: "ProviderInvocationError",
        message: "provider invocation failed",
        retryable: null,
        status: "failed",
    });

    const emptyError = new Error("");
    emptyError.name = "";
    const emptyErrorProvider = {
        ...provider,
        invoke: async () => Promise.reject(emptyError),
    } satisfies ModelProvider;
    const emptyErrorExecution = await executeTask({
        budget: { maxTurns: 1 },
        input: undefined,
        provider: emptyErrorProvider,
        runId: "run:empty-provider-error",
        task: failureTask,
    });
    assert.deepEqual(emptyErrorExecution.outcome.outcome, execution.outcome.outcome);

    const malformedError = new Error("\uD800");
    malformedError.name = "\uDFFF";
    const malformedErrorExecution = await executeTask({
        budget: { maxTurns: 1 },
        input: undefined,
        provider: { ...provider, invoke: async () => Promise.reject(malformedError) },
        runId: "run:malformed-provider-error",
        task: failureTask,
    });
    assert.deepEqual(malformedErrorExecution.outcome.outcome, execution.outcome.outcome);

    const accessorError = new Error("ignored");
    Object.defineProperty(accessorError, "name", {
        get: () => {
            throw new Error("name getter escaped");
        },
    });
    Object.defineProperty(accessorError, "message", { value: 42 });
    const accessorErrorExecution = await executeTask({
        budget: { maxTurns: 1 },
        input: undefined,
        provider: { ...provider, invoke: async () => Promise.reject(accessorError) },
        runId: "run:accessor-provider-error",
        task: failureTask,
    });
    assert.deepEqual(accessorErrorExecution.outcome.outcome, execution.outcome.outcome);
});

test("executeTask rejects forged structural task descriptors without consuming the provider", async () => {
    const baseTask = task({
        input: schema.void(),
        instruction: "Validate opaquely.",
        name: "opaque-output-failure",
        output: schema.string(),
        version: "1.0.0",
    });
    const opaqueTask = Object.freeze({
        ...baseTask,
        parseOutput: () => {
            throw "opaque validation failure";
        },
    }) satisfies typeof baseTask;
    const provider = createStaticProvider({
        descriptor: { id: "opaque-output-fixture", model: "offline-v1" },
        exchanges: [
            {
                request: {
                    input: null,
                    instruction: opaqueTask.instruction,
                    outputSchema: opaqueTask.artifact.output_schema,
                },
                response: {
                    output: "complete",
                    usage: {
                        cacheCreationInputTokens: 0,
                        cacheReadInputTokens: 0,
                        costUsd: 0,
                        inputTokens: 1,
                        outputTokens: 1,
                    },
                },
            },
        ],
    });

    await assert.rejects(
        executeTask({
            budget: { maxTurns: 1 },
            input: undefined,
            provider,
            runId: "run:forged-task",
            task: opaqueTask,
        }),
        TypeError,
    );
    const completed = await executeTask({
        budget: { maxTurns: 1 },
        input: undefined,
        provider,
        runId: "run:authenticated-task",
        task: baseTask,
    });
    assert.equal(completed.outcome.outcome.status, "finished");
});

test("executeTask classifies malformed custom-provider responses before accounting", async () => {
    const responseTask = task({
        input: schema.void(),
        instruction: "Return a validated response.",
        name: "response-validation",
        output: schema.string(),
        version: "1.0.0",
    });
    const provider = {
        descriptor: () => ({
            capabilities: { streaming: false, structuredOutput: true, tools: false },
            id: "malformed-response-fixture",
            kind: "static",
            model: "offline-v1",
        }),
        invoke: async () =>
            ({ output: "complete", usage: null }) as unknown as Awaited<
                ReturnType<ModelProvider["invoke"]>
            >,
    } satisfies ModelProvider;

    const execution = await executeTask({
        budget: { maxTurns: 1 },
        input: undefined,
        provider,
        runId: "run:malformed-response",
        task: responseTask,
    });

    assert.deepEqual(execution.outcome.outcome, {
        error_type: "TypeError",
        message: "model response usage must be a plain data object",
        retryable: null,
        status: "failed",
    });
    assert.equal(execution.usage, null);
});

test("executeTask rejects malformed provider artifact collections before accounting", async () => {
    const responseTask = task({
        input: schema.void(),
        instruction: "Return validated artifacts.",
        name: "artifact-response-validation",
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
    const artifact = {
        content: { text: "evidence", type: "text" },
        kind: "report",
        metadata: {},
        name: "report.txt",
    };
    const accessorResponse = { output: "complete", usage };
    Object.defineProperty(accessorResponse, "artifacts", { get: () => [artifact] });
    const malformedResponses: readonly unknown[] = [
        { artifacts: null, output: "complete", usage },
        { artifacts: [{ ...artifact, extra: true }], output: "complete", usage },
        { artifacts: [{ ...artifact, name: "" }], output: "complete", usage },
        {
            artifacts: [{ ...artifact, content: { receipt: {}, type: "blob" } }],
            output: "complete",
            usage,
        },
        {
            artifacts: [{ ...artifact, metadata: { invalid: Symbol("invalid") } }],
            output: "complete",
            usage,
        },
        accessorResponse,
    ];

    for (const [index, response] of malformedResponses.entries()) {
        const provider = {
            descriptor: () => ({
                capabilities: { streaming: false, structuredOutput: true, tools: false },
                id: `malformed-artifact-provider-${index}`,
                kind: "static" as const,
                model: "offline-v1",
            }),
            invoke: async () => response as Awaited<ReturnType<ModelProvider["invoke"]>>,
        } satisfies ModelProvider;
        const execution = await executeTask({
            budget: { maxTurns: 1 },
            input: undefined,
            provider,
            runId: `run:malformed-artifact-response:${index}`,
            task: responseTask,
        });

        assert.equal(
            execution.outcome.outcome.status,
            "failed",
            `malformed artifact response ${index}`,
        );
        assert.deepEqual(execution.artifacts, []);
        assert.equal(execution.usage, null);
    }
});

test("executeTask rejects open and accessor option containers before invocation", async () => {
    const optionsTask = task({
        input: schema.void(),
        instruction: "Return after option validation.",
        name: "option-validation",
        output: schema.string(),
        version: "1.0.0",
    });
    const provider = createStaticProvider({
        descriptor: { id: "option-validation-fixture", model: "offline-v1" },
        exchanges: [
            {
                request: {
                    input: null,
                    instruction: optionsTask.instruction,
                    outputSchema: optionsTask.artifact.output_schema,
                },
                response: {
                    output: "complete",
                    usage: {
                        cacheCreationInputTokens: 0,
                        cacheReadInputTokens: 0,
                        costUsd: 0,
                        inputTokens: 1,
                        outputTokens: 1,
                    },
                },
            },
        ],
    });
    const base = {
        budget: { maxTurns: 1 },
        input: undefined,
        provider,
        runId: "run:options",
        task: optionsTask,
    };
    const accessor = { ...base };
    Object.defineProperty(accessor, "runId", { get: () => "run:accessor" });

    for (const value of [{ ...base, extra: true }, accessor]) {
        await assert.rejects(executeTask(value as Parameters<typeof executeTask>[0]), TypeError);
    }
    const completed = await executeTask(base);
    assert.equal(completed.outcome.outcome.status, "finished");
});

test("executeTask snapshots and validates custom provider descriptors before invocation", async () => {
    const descriptorTask = task({
        input: schema.void(),
        instruction: "Return after descriptor validation.",
        name: "descriptor-validation",
        output: schema.string(),
        version: "1.0.0",
    });
    const descriptor = {
        capabilities: { streaming: false, structuredOutput: true, tools: false },
        id: "descriptor-fixture",
        kind: "static" as const,
        model: "offline-v1" as string | null,
    };
    let invocations = 0;
    const provider = {
        descriptor: () => descriptor,
        invoke: async () => {
            invocations += 1;
            return {
                output: "complete",
                usage: {
                    cacheCreationInputTokens: 0,
                    cacheReadInputTokens: 0,
                    costUsd: 0,
                    inputTokens: 1,
                    outputTokens: 1,
                },
            };
        },
    } satisfies ModelProvider;

    for (const invalidDescriptor of [
        { ...descriptor, capabilities: { ...descriptor.capabilities, tools: "false" } },
        { ...descriptor, kind: "unknown" },
        { ...descriptor, extra: true },
    ]) {
        const invalidProvider = {
            ...provider,
            descriptor: () =>
                invalidDescriptor as unknown as ReturnType<ModelProvider["descriptor"]>,
        } satisfies ModelProvider;
        await assert.rejects(
            executeTask({
                budget: { maxTurns: 1 },
                input: undefined,
                provider: invalidProvider,
                runId: "run:invalid-descriptor",
                task: descriptorTask,
            }),
            TypeError,
        );
    }
    assert.equal(invocations, 0);

    const execution = await executeTask({
        budget: { maxTurns: 1 },
        input: undefined,
        provider,
        runId: "run:descriptor",
        task: descriptorTask,
    });
    descriptor.id = "changed";

    assert.equal(execution.provider.id, "descriptor-fixture");
    assert.equal(Object.isFrozen(execution.provider), true);
    assert.equal(Object.isFrozen(execution.provider.capabilities), true);

    descriptor.id = "descriptor-fixture";
    descriptor.model = null;
    const nullModelExecution = await executeTask({
        budget: { maxTurns: 1 },
        input: undefined,
        provider,
        runId: "run:null-model-descriptor",
        task: descriptorTask,
    });
    assert.equal(nullModelExecution.provider.model, null);
    assert.equal(invocations, 2);
});

test("executeTask snapshots validated options before awaiting the provider", async () => {
    const snapshotTask = task({
        input: schema.void(),
        instruction: "Return after mutating caller options.",
        name: "option-snapshot",
        output: schema.string(),
        version: "1.0.0",
    });
    const mutableBudget: { maxCostUsd?: number; maxTurns: number } = {
        maxCostUsd: 1,
        maxTurns: 1,
    };
    const mutableOptions = {
        budget: mutableBudget,
        input: undefined,
        provider: undefined as unknown as ModelProvider,
        runId: "run:option-snapshot",
        task: snapshotTask,
    };
    mutableOptions.provider = {
        descriptor: () => ({
            capabilities: { streaming: false, structuredOutput: true, tools: false },
            id: "option-snapshot-fixture",
            kind: "static",
            model: "offline-v1",
        }),
        invoke: async () => {
            mutableOptions.runId = "run:mutated";
            delete mutableBudget.maxCostUsd;
            return {
                output: "complete",
                usage: {
                    cacheCreationInputTokens: 0,
                    cacheReadInputTokens: 0,
                    costUsd: null,
                    inputTokens: 1,
                    outputTokens: 1,
                },
            };
        },
    };

    const execution = await executeTask(mutableOptions);

    assert.equal(execution.outcome.run_id, "run:option-snapshot");
    assert.equal(execution.outcome.outcome.status, "failed");
    if (execution.outcome.outcome.status === "failed") {
        assert.equal(execution.outcome.outcome.error_type, "RunCostUnavailableError");
    }
});
