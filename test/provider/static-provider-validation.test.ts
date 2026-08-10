import assert from "node:assert/strict";
import { test } from "node:test";

import {
    createStaticProvider,
    type ModelRequest,
    type StaticProviderDefinition,
} from "../../src/index.ts";

const REQUEST = {
    input: { name: "Ada" },
    instruction: "Return the greeting.",
    outputSchema: { type: "string" },
} satisfies ModelRequest;

function validDefinition(): StaticProviderDefinition {
    return {
        descriptor: { id: "validation-fixture", model: "offline-v1" },
        exchanges: [
            {
                request: REQUEST,
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
    };
}

test("static provider rejects open or malformed definitions and invocation requests", async () => {
    const invalidDefinitions: unknown[] = [
        null,
        "definition",
        [],
        new Date(),
        {},
        { ...validDefinition(), extra: true },
        { ...validDefinition(), descriptor: { id: "", model: "offline-v1" } },
        { ...validDefinition(), descriptor: { id: "\uD800", model: "offline-v1" } },
        { ...validDefinition(), descriptor: { id: "fixture", model: "" } },
        {
            ...validDefinition(),
            exchanges: [
                {
                    ...validDefinition().exchanges[0],
                    request: { ...REQUEST, outputSchema: null },
                },
            ],
        },
        {
            ...validDefinition(),
            exchanges: [
                {
                    ...validDefinition().exchanges[0],
                    request: { ...REQUEST, outputSchema: "string" },
                },
            ],
        },
        {
            ...validDefinition(),
            exchanges: [
                {
                    ...validDefinition().exchanges[0],
                    request: { ...REQUEST, outputSchema: [] },
                },
            ],
        },
        {
            ...validDefinition(),
            exchanges: [
                {
                    ...validDefinition().exchanges[0],
                    request: { ...REQUEST, input: undefined },
                },
            ],
        },
        {
            ...validDefinition(),
            exchanges: [
                {
                    ...validDefinition().exchanges[0],
                    extra: true,
                },
            ],
        },
        {
            ...validDefinition(),
            exchanges: [
                {
                    ...validDefinition().exchanges[0],
                    response: {
                        output: "Hello",
                        usage: {
                            cacheCreationInputTokens: 0,
                            cacheReadInputTokens: 0,
                            costUsd: null,
                            inputTokens: -1,
                            outputTokens: 1,
                        },
                    },
                },
            ],
        },
    ];
    for (const costUsd of [-1, Number.POSITIVE_INFINITY, "free"]) {
        const definition = structuredClone(validDefinition()) as Record<string, unknown>;
        const exchanges = definition.exchanges as Record<string, unknown>[];
        const response = exchanges[0]?.response as Record<string, unknown>;
        const usage = response.usage as Record<string, unknown>;
        usage.costUsd = costUsd;
        invalidDefinitions.push(definition);
    }
    const accessorDefinition = validDefinition();
    Object.defineProperty(accessorDefinition, "exchanges", { get: () => [] });
    invalidDefinitions.push(accessorDefinition);
    const symbolDefinition = validDefinition();
    Object.defineProperty(symbolDefinition, Symbol("invalid"), { value: true });
    invalidDefinitions.push(symbolDefinition);
    const symbolExchanges = [...validDefinition().exchanges];
    Object.defineProperty(symbolExchanges, Symbol("invalid"), { value: true });
    invalidDefinitions.push({ ...validDefinition(), exchanges: symbolExchanges });
    invalidDefinitions.push({ ...validDefinition(), exchanges: new Array(1) });
    const accessorExchanges: unknown[] = [];
    Object.defineProperty(accessorExchanges, "0", {
        enumerable: true,
        get: () => validDefinition().exchanges[0],
    });
    accessorExchanges.length = 1;
    invalidDefinitions.push({ ...validDefinition(), exchanges: accessorExchanges });
    const customExchanges = [...validDefinition().exchanges] as unknown[] & { note?: string };
    customExchanges.note = "invalid";
    invalidDefinitions.push({ ...validDefinition(), exchanges: customExchanges });
    const cyclicInput: Record<string, unknown> = {};
    cyclicInput.self = cyclicInput;
    invalidDefinitions.push({
        ...validDefinition(),
        exchanges: [
            {
                ...validDefinition().exchanges[0],
                request: { ...REQUEST, input: cyclicInput as never },
            },
        ],
    });

    for (const [index, definition] of invalidDefinitions.entries()) {
        assert.throws(
            () => createStaticProvider(definition as StaticProviderDefinition),
            TypeError,
            `invalid definition ${index}`,
        );
    }

    const provider = createStaticProvider(validDefinition());
    await assert.rejects(
        provider.invoke({ ...REQUEST, extra: true } as ModelRequest, new AbortController().signal),
        TypeError,
    );
    await assert.rejects(provider.invoke(REQUEST, {} as AbortSignal), TypeError);
});

test("static provider owns immutable definition and response snapshots", async () => {
    const mutableInput = { name: "Ada" };
    const mutableOutput = { greeting: "Hello" };
    const definition = {
        descriptor: { id: "snapshot-fixture", model: "offline-v1" },
        exchanges: [
            {
                request: { ...REQUEST, input: mutableInput },
                response: {
                    output: mutableOutput,
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
    };
    const provider = createStaticProvider(definition);
    mutableInput.name = "Changed";
    mutableOutput.greeting = "Changed";

    const descriptor = provider.descriptor();
    const response = await provider.invoke(
        { ...REQUEST, input: { name: "Ada" } },
        new AbortController().signal,
    );
    assert.equal(Object.isFrozen(descriptor), true);
    assert.equal(Object.isFrozen(descriptor.capabilities), true);
    assert.deepEqual(response.output, { greeting: "Hello" });
    assert.equal(Object.isFrozen(response.output), true);
});
