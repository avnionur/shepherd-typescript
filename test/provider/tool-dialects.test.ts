import assert from "node:assert/strict";
import { test } from "node:test";

import {
    createLiveProvider,
    createProgramConversationProvider,
    LiveProviderError,
    type ModelConversationRequest,
    type PROVIDER_KINDS,
} from "../../src/index.ts";
import { providerProtocolConfig } from "../../src/protocol/config.ts";
import { scriptedTransport } from "./live-fixtures.ts";

const KEY = "sk-tool-fixture-credential-0123456789abcdef";
const live = providerProtocolConfig.live;
const signal = () => new AbortController().signal;

const tools = [
    {
        description: "Observe one worker session.",
        inputSchema: {
            properties: { session_id: { type: "string" } },
            required: ["session_id"],
            type: "object",
        },
        name: "observe",
    },
];

/** A two-turn conversation: a tool call and its result. */
const conversation: ModelConversationRequest = {
    cachePrefixMessages: 3,
    messages: [
        { content: [{ text: "Check the worker.", type: "text" }], role: "user" },
        {
            content: [
                { text: "Observing.", type: "text" },
                { id: "call_1", input: { session_id: "s1" }, name: "observe", type: "tool_use" },
            ],
            role: "assistant",
        },
        {
            content: [
                {
                    content: '{"ok":false}',
                    isError: true,
                    toolUseId: "call_1",
                    type: "tool_result",
                },
                { text: "Guidance: revert.", type: "text" },
            ],
            role: "user",
        },
    ],
    outputSchema: null,
    system: "You supervise workers.",
    tools,
};

function provider(
    kind: (typeof PROVIDER_KINDS)[number],
    transport: ReturnType<typeof scriptedTransport>["transport"],
) {
    return createLiveProvider({
        credential: KEY,
        id: `provider:${kind}`,
        kind,
        model: "m",
        transport,
    });
}

test("live kinds declare tool capabilities and configured tool wire settings", () => {
    for (const kind of Object.values(live.kinds)) {
        assert.equal(kind.capabilities.tools, true);
        assert.ok(kind.toolUse.stopReasons.length > 0);
        assert.equal(
            kind.toolUse.stopReasons.some((reason) => kind.completeStopReasons.includes(reason)),
            false,
        );
    }
});

test("anthropic dialect maps tools, tool_use, and tool_result blocks and decodes tool calls", async () => {
    const kind = live.kinds.anthropic as (typeof live.kinds)[string];
    const { calls, transport } = scriptedTransport([
        {
            body: JSON.stringify({
                content: [
                    { text: "Reverting.", type: "text" },
                    {
                        id: "call_2",
                        input: { session_id: "s1", step_count: 1 },
                        name: "rewind",
                        type: "tool_use",
                    },
                ],
                stop_reason: kind.toolUse.stopReasons[0],
                usage: { input_tokens: 7, output_tokens: 3 },
            }),
            status: 200,
        },
    ]);
    const response = await provider("anthropic", transport).converse(conversation, signal());
    const body = calls[0]?.parsed as Record<string, unknown>;
    assert.deepEqual(body[kind.toolUse.requestField], [
        {
            description: tools[0]?.description,
            input_schema: tools[0]?.inputSchema,
            name: "observe",
        },
    ]);
    const messages = body.messages as Record<string, unknown>[];
    assert.deepEqual(messages[1]?.content, [
        { text: "Observing.", type: "text" },
        { id: "call_1", input: { session_id: "s1" }, name: "observe", type: "tool_use" },
    ]);
    assert.deepEqual(messages[2]?.content, [
        { content: '{"ok":false}', is_error: true, tool_use_id: "call_1", type: "tool_result" },
        { cache_control: kind.cacheControl, text: "Guidance: revert.", type: "text" },
    ]);
    assert.equal(Object.keys(body).at(-1), "messages");
    assert.equal(response.output, null);
    assert.equal(response.stopReason, kind.toolUse.stopReasons[0]);
    assert.deepEqual(response.message, {
        content: [
            { text: "Reverting.", type: "text" },
            {
                id: "call_2",
                input: { session_id: "s1", step_count: 1 },
                name: "rewind",
                type: "tool_use",
            },
        ],
        role: "assistant",
    });
});

test("openai dialect maps tools, tool_calls, and tool-role results and decodes tool calls", async () => {
    const kind = live.kinds.openai as (typeof live.kinds)[string];
    const { calls, transport } = scriptedTransport([
        {
            body: JSON.stringify({
                choices: [
                    {
                        finish_reason: kind.toolUse.stopReasons[0],
                        message: {
                            content: null,
                            role: "assistant",
                            tool_calls: [
                                {
                                    function: { arguments: '{"session_id":"s1"}', name: "observe" },
                                    id: "call_3",
                                    type: "function",
                                },
                            ],
                        },
                    },
                ],
                usage: { completion_tokens: 2, prompt_tokens: 9 },
            }),
            status: 200,
        },
    ]);
    const response = await provider("openai", transport).converse(conversation, signal());
    const body = calls[0]?.parsed as Record<string, unknown>;
    assert.deepEqual(body[kind.toolUse.requestField], [
        {
            function: {
                description: tools[0]?.description,
                name: "observe",
                parameters: tools[0]?.inputSchema,
            },
            type: "function",
        },
    ]);
    assert.deepEqual(body.messages, [
        { content: "You supervise workers.", role: "system" },
        { content: "Check the worker.", role: "user" },
        {
            content: "Observing.",
            role: "assistant",
            tool_calls: [
                {
                    function: { arguments: '{"session_id":"s1"}', name: "observe" },
                    id: "call_1",
                    type: "function",
                },
            ],
        },
        { content: '{"ok":false}', role: "tool", tool_call_id: "call_1" },
        { content: "Guidance: revert.", role: "user" },
    ]);
    assert.equal(response.output, null);
    assert.deepEqual(response.message.content, [
        { id: "call_3", input: { session_id: "s1" }, name: "observe", type: "tool_use" },
    ]);
    const resultsOnly = scriptedTransport([
        {
            body: JSON.stringify({
                choices: [
                    { finish_reason: kind.completeStopReasons[0], message: { content: "ok" } },
                ],
                usage: { completion_tokens: 1, prompt_tokens: 1 },
            }),
            status: 200,
        },
    ]);
    await provider("openai", resultsOnly.transport).converse(
        {
            ...conversation,
            messages: [
                conversation.messages[0] as ModelConversationRequest["messages"][number],
                {
                    // An assistant turn of tool calls only carries null text content.
                    content: [
                        {
                            id: "call_1",
                            input: { session_id: "s1" },
                            name: "observe",
                            type: "tool_use",
                        },
                    ],
                    role: "assistant",
                },
                {
                    content: [
                        { content: "{}", isError: false, toolUseId: "call_1", type: "tool_result" },
                    ],
                    role: "user",
                },
            ],
        },
        signal(),
    );
    assert.deepEqual((resultsOnly.calls[0]?.parsed.messages as unknown[] | undefined)?.slice(-2), [
        {
            content: null,
            role: "assistant",
            tool_calls: [
                {
                    function: { arguments: '{"session_id":"s1"}', name: "observe" },
                    id: "call_1",
                    type: "function",
                },
            ],
        },
        { content: "{}", role: "tool", tool_call_id: "call_1" },
    ]);
});

test("an openai-compatible cache marker lands on the last tool result of a results-only prefix", async () => {
    const kind = live.kinds.openrouter as (typeof live.kinds)[string];
    assert.notEqual(kind.cacheControl, null);
    const reply = {
        body: JSON.stringify({
            choices: [{ finish_reason: kind.completeStopReasons[0], message: { content: "ok" } }],
            usage: { completion_tokens: 1, prompt_tokens: 1 },
        }),
        status: 200,
    };
    const { calls, transport } = scriptedTransport([reply, reply]);
    const results: ModelConversationRequest["messages"][number] = {
        content: [
            { content: "{}", isError: false, toolUseId: "call_1", type: "tool_result" },
            { content: "[]", isError: false, toolUseId: "call_2", type: "tool_result" },
        ],
        role: "user",
    };
    const request: ModelConversationRequest = {
        ...conversation,
        messages: [...conversation.messages.slice(0, 2), results],
    };
    await provider("openrouter", transport).converse(request, signal());
    assert.deepEqual((calls[0]?.parsed.messages as unknown[] | undefined)?.slice(-2), [
        { content: "{}", role: "tool", tool_call_id: "call_1" },
        {
            content: [{ cache_control: kind.cacheControl, text: "[]", type: "text" }],
            role: "tool",
            tool_call_id: "call_2",
        },
    ]);
    // Outside the prefix, tool results keep their plain string content and carry no marker.
    await provider("openrouter", transport).converse(
        { ...request, cachePrefixMessages: 1 },
        signal(),
    );
    const unmarked = calls[1]?.parsed.messages as Record<string, unknown>[];
    assert.deepEqual(unmarked.slice(-2), [
        { content: "{}", role: "tool", tool_call_id: "call_1" },
        { content: "[]", role: "tool", tool_call_id: "call_2" },
    ]);
    assert.deepEqual(unmarked[1]?.content, [
        { cache_control: kind.cacheControl, text: "Check the worker.", type: "text" },
    ]);
});

test("requests without tools keep their wire bodies free of tool fields", async () => {
    for (const kind of ["anthropic", "openai"] as const) {
        const config = live.kinds[kind] as (typeof live.kinds)[string];
        const { calls, transport } = scriptedTransport([
            kind === "anthropic"
                ? {
                      body: JSON.stringify({
                          content: [{ text: "done", type: "text" }],
                          stop_reason: config.completeStopReasons[0],
                          usage: { input_tokens: 1, output_tokens: 1 },
                      }),
                      status: 200,
                  }
                : {
                      body: JSON.stringify({
                          choices: [
                              {
                                  finish_reason: config.completeStopReasons[0],
                                  message: { content: "done" },
                              },
                          ],
                          usage: { completion_tokens: 1, prompt_tokens: 1 },
                      }),
                      status: 200,
                  },
        ]);
        const response = await provider(kind, transport).converse(
            {
                cachePrefixMessages: 1,
                messages: [{ content: [{ text: "hi", type: "text" }], role: "user" }],
                outputSchema: null,
                system: null,
            },
            signal(),
        );
        assert.equal(response.output, "done");
        assert.equal(Object.hasOwn(calls[0]?.parsed ?? {}, config.toolUse.requestField), false);
    }
});

test("malformed or inconsistent tool responses are refused", async () => {
    const kind = live.kinds.anthropic as (typeof live.kinds)[string];
    const reply = (content: unknown[], stopReason: string) => ({
        body: JSON.stringify({
            content,
            stop_reason: stopReason,
            usage: { input_tokens: 1, output_tokens: 1 },
        }),
        status: 200,
    });
    const cases = [
        reply([{ text: "no calls", type: "text" }], kind.toolUse.stopReasons[0] as string),
        reply(
            [{ id: "c", input: "not-an-object", name: "observe", type: "tool_use" }],
            kind.toolUse.stopReasons[0] as string,
        ),
        reply(
            [
                { text: "done", type: "text" },
                { id: "c", input: {}, name: "observe", type: "tool_use" },
            ],
            kind.completeStopReasons[0] as string,
        ),
    ];
    for (const response of cases) {
        const { transport } = scriptedTransport([response]);
        await assert.rejects(
            provider("anthropic", transport).converse(conversation, signal()),
            (error: unknown) => {
                assert.ok(error instanceof LiveProviderError);
                assert.equal(error.reason, "response");
                return true;
            },
        );
    }
    const openai = live.kinds.openai as (typeof live.kinds)[string];
    const { transport } = scriptedTransport([
        {
            body: JSON.stringify({
                choices: [
                    {
                        finish_reason: openai.toolUse.stopReasons[0],
                        message: {
                            tool_calls: [
                                {
                                    function: { arguments: "[1]", name: "observe" },
                                    id: "c",
                                    type: "function",
                                },
                            ],
                        },
                    },
                ],
                usage: { completion_tokens: 1, prompt_tokens: 1 },
            }),
            status: 200,
        },
    ]);
    await assert.rejects(
        provider("openai", transport).converse(conversation, signal()),
        LiveProviderError,
    );
});

test("request validation places tool blocks only in their roles and requires unique tool names", async () => {
    const program = createProgramConversationProvider({
        id: "program:echo",
        respond: () => ({
            message: { content: [{ text: "ok", type: "text" }], role: "assistant" },
            output: "ok",
            stopReason: "end",
            usage: {
                cacheCreationInputTokens: 0,
                cacheReadInputTokens: 0,
                costUsd: null,
                inputTokens: 0,
                outputTokens: 0,
            },
        }),
    });
    assert.equal(program.descriptor().kind, providerProtocolConfig.program.kind);
    assert.deepEqual(
        program.descriptor().capabilities,
        providerProtocolConfig.program.conversationCapabilities,
    );
    assert.equal((await program.converse(conversation, signal())).output, "ok");
    const refusals: ModelConversationRequest[] = [
        {
            ...conversation,
            messages: [
                {
                    content: [
                        { content: "x", isError: false, toolUseId: "c", type: "tool_result" },
                    ],
                    role: "user",
                },
                {
                    content: [{ id: "c", input: {}, name: "observe", type: "tool_use" }],
                    role: "user",
                },
            ],
        },
        {
            ...conversation,
            messages: [
                { content: [{ text: "hi", type: "text" }], role: "user" },
                {
                    content: [
                        { content: "x", isError: false, toolUseId: "c", type: "tool_result" },
                    ],
                    role: "assistant",
                },
            ],
        },
        { ...conversation, tools: [...tools, ...tools] },
        { ...conversation, tools: [{ ...tools[0], name: "bad name" } as (typeof tools)[number]] },
    ];
    for (const request of refusals) {
        await assert.rejects(program.converse(request, signal()), TypeError);
    }
});
