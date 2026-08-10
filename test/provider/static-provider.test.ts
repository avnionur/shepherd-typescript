import assert from "node:assert/strict";
import { test } from "node:test";

import {
    createStaticProvider,
    type ModelRequest,
    StaticProviderExhaustedError,
    StaticProviderRequestMismatchError,
} from "../../src/index.ts";

test("static provider returns the configured response for an exact request", async () => {
    const expectedRequest = {
        input: { name: "Ada" },
        instruction: "Return the greeting.",
        outputSchema: { type: "string" },
    } satisfies ModelRequest;
    const provider = createStaticProvider({
        descriptor: { id: "docs-fixture", model: "offline-v1" },
        exchanges: [
            {
                request: expectedRequest,
                response: {
                    output: "Hello, Ada",
                    usage: {
                        cacheCreationInputTokens: 0,
                        cacheReadInputTokens: 0,
                        costUsd: 0,
                        inputTokens: 8,
                        outputTokens: 3,
                    },
                },
            },
        ],
    });

    assert.deepEqual(provider.descriptor(), {
        capabilities: {
            streaming: false,
            structuredOutput: true,
            tools: false,
        },
        id: "docs-fixture",
        kind: "static",
        model: "offline-v1",
    });
    const response = await provider.invoke(
        {
            input: { name: "Ada" },
            instruction: "Return the greeting.",
            outputSchema: { type: "string" },
        },
        new AbortController().signal,
    );
    assert.deepEqual(response, {
        output: "Hello, Ada",
        usage: {
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 0,
            costUsd: 0,
            inputTokens: 8,
            outputTokens: 3,
        },
    });
    assert.equal(Object.isFrozen(response), true);
    assert.equal(Object.isFrozen(response.usage), true);
});

test("static provider fails closed without consuming a mismatched exchange", async () => {
    const request = {
        input: { name: "Ada" },
        instruction: "Return the greeting.",
        outputSchema: { type: "string" },
    } satisfies ModelRequest;
    const provider = createStaticProvider({
        descriptor: { id: "failure-fixture", model: "offline-v1" },
        exchanges: [
            {
                request,
                response: {
                    output: "Hello, Ada",
                    usage: {
                        cacheCreationInputTokens: 0,
                        cacheReadInputTokens: 0,
                        costUsd: null,
                        inputTokens: 8,
                        outputTokens: 3,
                    },
                },
            },
        ],
    });
    const signal = new AbortController().signal;

    await assert.rejects(
        provider.invoke({ ...request, input: { name: "Grace" } }, signal),
        (error: unknown) => {
            assert.equal(error instanceof StaticProviderRequestMismatchError, true);
            if (error instanceof StaticProviderRequestMismatchError) {
                assert.equal(error.code, "STATIC_PROVIDER_REQUEST_MISMATCH");
                assert.equal(error.position, 0);
            }
            return true;
        },
    );
    assert.equal((await provider.invoke(request, signal)).output, "Hello, Ada");
    await assert.rejects(provider.invoke(request, signal), (error: unknown) => {
        assert.equal(error instanceof StaticProviderExhaustedError, true);
        if (error instanceof StaticProviderExhaustedError) {
            assert.equal(error.code, "STATIC_PROVIDER_EXHAUSTED");
            assert.equal(error.position, 1);
        }
        return true;
    });
});

test("static provider preserves pre-abort reasons without consuming an exchange", async () => {
    const request = {
        input: null,
        instruction: "Return ready.",
        outputSchema: { type: "string" },
    } satisfies ModelRequest;
    const provider = createStaticProvider({
        descriptor: { id: "cancel-fixture", model: "offline-v1" },
        exchanges: [
            {
                request,
                response: {
                    output: "ready",
                    usage: {
                        cacheCreationInputTokens: 0,
                        cacheReadInputTokens: 0,
                        costUsd: 0,
                        inputTokens: 2,
                        outputTokens: 1,
                    },
                },
            },
        ],
    });
    const caller = new AbortController();
    const reason = new Error("caller stopped");
    caller.abort(reason);

    await assert.rejects(provider.invoke(request, caller.signal), (error: unknown) => {
        assert.equal(error, reason);
        return true;
    });
    assert.equal((await provider.invoke(request, new AbortController().signal)).output, "ready");
});
