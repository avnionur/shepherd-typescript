import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
    createLiveProvider,
    LiveProviderError,
    type LiveProviderTransport,
    type ModelConversationRequest,
    PROVIDER_KINDS,
} from "../../src/index.ts";
import { providerProtocolConfig } from "../../src/protocol/config.ts";
import { anthropicReply, liveRequest, openAiReply, scriptedTransport } from "./live-fixtures.ts";

const KEY = "sk-ant-fixture-credential-0123456789abcdef";
const live = providerProtocolConfig.live;
const anthropic = live.kinds.anthropic as (typeof live.kinds)[string];
const openai = live.kinds.openai as (typeof live.kinds)[string];
const openrouter = live.kinds.openrouter as (typeof live.kinds)[string];
const signal = () => new AbortController().signal;

test("provider kinds resolve from configuration and every live kind is constructible", () => {
    assert.deepEqual(PROVIDER_KINDS, providerProtocolConfig.kinds);
    for (const kind of Object.keys(live.kinds)) {
        const provider = createLiveProvider({
            environment: {
                [(live.kinds[kind] as typeof anthropic).credential.environmentVariable]: KEY,
            },
            id: `provider:${kind}`,
            kind: kind as (typeof PROVIDER_KINDS)[number],
            model: "fixture-model",
        });
        assert.deepEqual(provider.descriptor(), {
            capabilities: (live.kinds[kind] as typeof anthropic).capabilities,
            id: `provider:${kind}`,
            kind,
            model: "fixture-model",
        });
        assert.equal(JSON.stringify(provider.descriptor()).includes(KEY), false);
    }
});

test("anthropic adapter sends a configured request and marks the last prefix message for caching", async () => {
    const { calls, transport } = scriptedTransport([
        anthropicReply('{"text":"one"}', {
            cache_creation_input_tokens: 40,
            cache_read_input_tokens: null,
            input_tokens: 12,
            output_tokens: 3,
        }),
        anthropicReply('{"text":"two"}', {
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 40,
            input_tokens: 4,
            output_tokens: 3,
        }),
    ]);
    const provider = createLiveProvider({
        environment: { [anthropic.credential.environmentVariable]: KEY },
        id: "claude",
        kind: "anthropic",
        maxOutputTokens: 256,
        model: "fixture-model",
        transport,
    });
    const first = await provider.invoke(liveRequest(0), signal());
    assert.deepEqual(first, {
        output: { text: "one" },
        usage: {
            cacheCreationInputTokens: 40,
            cacheReadInputTokens: 0,
            costUsd: null,
            inputTokens: 12,
            outputTokens: 3,
        },
    });
    const call = calls[0];
    assert.ok(call);
    assert.equal(call.url, anthropic.endpoint);
    assert.deepEqual(call.headers, {
        ...anthropic.headers,
        [anthropic.credential.header]: KEY,
    });
    assert.deepEqual(Object.keys(call.parsed), [
        "model",
        anthropic.maxTokensField,
        "output_config",
        "messages",
    ]);
    assert.equal(call.parsed[anthropic.maxTokensField], 256);
    assert.deepEqual(call.parsed.output_config, {
        format: { schema: liveRequest(0).outputSchema, type: "json_schema" },
    });
    assert.deepEqual(call.parsed.messages, [
        {
            content: [
                {
                    cache_control: anthropic.cacheControl,
                    text: JSON.stringify({
                        input: { step: 0 },
                        instruction: "Summarize the step.",
                        output_schema: liveRequest(0).outputSchema,
                    }),
                    type: "text",
                },
            ],
            role: "user",
        },
    ]);

    const conversation: ModelConversationRequest = {
        cachePrefixMessages: 2,
        messages: [
            { content: [{ text: "u1", type: "text" }], role: "user" },
            {
                content: [
                    { text: "a1", type: "text" },
                    { text: "a2", type: "text" },
                ],
                role: "assistant",
            },
            { content: [{ text: "u2", type: "text" }], role: "user" },
        ],
        outputSchema: { type: "object" },
        system: "Stable system prompt.",
    };
    const second = await provider.converse(conversation, signal());
    assert.deepEqual(second.message, {
        content: [{ text: '{"text":"two"}', type: "text" }],
        role: "assistant",
    });
    assert.equal(second.stopReason, "end_turn");
    assert.equal(second.usage.cacheReadInputTokens, 40);
    const parsed = calls[1]?.parsed as {
        readonly messages: readonly { readonly content: readonly Record<string, unknown>[] }[];
        readonly system: unknown;
    };
    assert.deepEqual(parsed.system, [{ text: "Stable system prompt.", type: "text" }]);
    assert.deepEqual(
        parsed.messages.map((message) =>
            message.content.map((block) => block.cache_control ?? null),
        ),
        [[null], [null, anthropic.cacheControl], [null]],
    );
    const unmarked = scriptedTransport([anthropicReply("plain text")]);
    const text = await createLiveProvider({
        credential: KEY,
        id: "claude",
        kind: "anthropic",
        model: "fixture-model",
        transport: unmarked.transport,
    }).converse(
        { ...conversation, cachePrefixMessages: 0, outputSchema: null, system: null },
        signal(),
    );
    assert.equal(text.output, "plain text");
    assert.equal(unmarked.calls[0]?.parsed[anthropic.maxTokensField], anthropic.maxOutputTokens);
    assert.equal(JSON.stringify(unmarked.calls[0]?.parsed).includes("cache_control"), false);
    assert.equal("system" in (unmarked.calls[0]?.parsed ?? {}), false);
});

test("openai-compatible adapters cover OpenAI and OpenRouter behind the same contract", async () => {
    const openAiTransport = scriptedTransport([
        openAiReply('{"text":"one"}', {
            completion_tokens: 3,
            prompt_tokens: 50,
            prompt_tokens_details: { cached_tokens: 32 },
        }),
    ]);
    const provider = createLiveProvider({
        environment: { [openai.credential.environmentVariable]: KEY },
        id: "gpt",
        kind: "openai",
        model: "fixture-model",
        transport: openAiTransport.transport,
    });
    assert.deepEqual(await provider.invoke(liveRequest(0), signal()), {
        output: { text: "one" },
        usage: {
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 32,
            costUsd: null,
            inputTokens: 18,
            outputTokens: 3,
        },
    });
    const call = openAiTransport.calls[0];
    assert.equal(call?.url, openai.endpoint);
    assert.equal(call?.headers[openai.credential.header], `${openai.credential.scheme} ${KEY}`);
    assert.equal(call?.parsed[openai.maxTokensField], openai.maxOutputTokens);
    assert.deepEqual(call?.parsed.response_format, {
        json_schema: {
            name: openai.outputFormat?.name,
            schema: liveRequest(0).outputSchema,
            strict: openai.outputFormat?.strict,
        },
        type: "json_schema",
    });
    const openAiMessages = (call?.parsed.messages ?? []) as readonly { content: unknown }[];
    assert.equal(typeof openAiMessages[0]?.content, "string");

    const routerTransport = scriptedTransport([
        openAiReply("free text", { completion_tokens: 1, prompt_tokens: 7 }),
    ]);
    const router = createLiveProvider({
        environment: { [openrouter.credential.environmentVariable]: KEY },
        id: "router",
        kind: "openrouter",
        model: "vendor/fixture-model",
        transport: routerTransport.transport,
    });
    const reply = await router.converse(
        {
            cachePrefixMessages: 1,
            messages: [
                { content: [{ text: "u1", type: "text" }], role: "user" },
                { content: [{ text: "a1", type: "text" }], role: "assistant" },
                { content: [{ text: "u2", type: "text" }], role: "user" },
            ],
            outputSchema: null,
            system: "System.",
        },
        signal(),
    );
    assert.equal(reply.output, "free text");
    assert.deepEqual(reply.usage, {
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        costUsd: null,
        inputTokens: 7,
        outputTokens: 1,
    });
    const routed = routerTransport.calls[0];
    assert.equal(routed?.url, openrouter.endpoint);
    assert.equal(routed?.parsed.response_format, undefined);
    assert.deepEqual(routed?.parsed.messages, [
        { content: "System.", role: "system" },
        {
            content: [{ cache_control: openrouter.cacheControl, text: "u1", type: "text" }],
            role: "user",
        },
        { content: [{ text: "a1", type: "text" }], role: "assistant" },
        { content: [{ text: "u2", type: "text" }], role: "user" },
    ]);
});

test("adapters honor an AbortSignal while the request is pending", async () => {
    const listening: LiveProviderTransport = (_request, transportSignal) =>
        new Promise((_resolve, reject) => {
            transportSignal.addEventListener("abort", () => reject(new Error("socket closed")), {
                once: true,
            });
        });
    const ignoring: LiveProviderTransport = () => new Promise(() => undefined);
    for (const transport of [listening, ignoring]) {
        const provider = createLiveProvider({
            credential: KEY,
            id: "claude",
            kind: "anthropic",
            model: "fixture-model",
            transport,
        });
        const controller = new AbortController();
        const pending = provider.invoke(liveRequest(0), controller.signal);
        const reason = new Error("caller cancelled");
        setImmediate(() => controller.abort(reason));
        await assert.rejects(pending, (error) => error === reason);
    }
    let called = false;
    const provider = createLiveProvider({
        credential: KEY,
        id: "claude",
        kind: "anthropic",
        model: "fixture-model",
        transport: async () => {
            called = true;
            return anthropicReply("{}");
        },
    });
    const aborted = AbortSignal.abort(new Error("already"));
    await assert.rejects(provider.invoke(liveRequest(0), aborted), /already/u);
    await assert.rejects(
        provider.converse(
            {
                cachePrefixMessages: 0,
                messages: [{ content: [{ text: "u", type: "text" }], role: "user" }],
                outputSchema: null,
                system: null,
            },
            aborted,
        ),
        /already/u,
    );
    assert.equal(called, false);
    const late = new AbortController();
    const settled = createLiveProvider({
        credential: KEY,
        id: "claude",
        kind: "anthropic",
        model: "fixture-model",
        transport: async () => {
            late.abort(new Error("late abort"));
            return anthropicReply("{}");
        },
    });
    await assert.rejects(settled.invoke(liveRequest(0), late.signal), /late abort/u);
});

test("credentials come only from configuration or the environment and never reach errors", async () => {
    assert.throws(
        () => createLiveProvider({ environment: {}, id: "claude", kind: "anthropic", model: "m" }),
        (error) =>
            error instanceof LiveProviderError &&
            error.code === live.errors.credentialCode &&
            error.reason === "credential" &&
            error.message.includes(anthropic.credential.environmentVariable),
    );
    assert.throws(
        () =>
            createLiveProvider({
                environment: { [anthropic.credential.environmentVariable]: "  " },
                id: "claude",
                kind: "anthropic",
                model: "m",
            }),
        LiveProviderError,
    );
    const previous = process.env[anthropic.credential.environmentVariable];
    process.env[anthropic.credential.environmentVariable] = KEY;
    try {
        const fromProcess = scriptedTransport([anthropicReply("{}")]);
        await createLiveProvider({
            id: "claude",
            kind: "anthropic",
            model: "m",
            transport: fromProcess.transport,
        }).invoke(liveRequest(0), signal());
        assert.equal(fromProcess.calls[0]?.headers[anthropic.credential.header], KEY);
    } finally {
        if (previous === undefined) {
            delete process.env[anthropic.credential.environmentVariable];
        } else {
            process.env[anthropic.credential.environmentVariable] = previous;
        }
    }

    const failures = scriptedTransport([
        {
            body: JSON.stringify({
                error: { message: `invalid x-api-key ${KEY}`, type: "authentication_error" },
                type: "error",
            }),
            status: 401,
        },
        { body: JSON.stringify({ error: `rate limited ${"x".repeat(2000)}` }), status: 429 },
        { body: "<html>bad gateway</html>", status: 502 },
        { body: JSON.stringify({ error: null }), status: 500 },
        anthropicReply('{"text":"cut"}', { input_tokens: 1, output_tokens: 1 }, "max_tokens"),
        { body: "not json", status: 200 },
        { body: JSON.stringify({ content: "text" }), status: 200 },
        { body: JSON.stringify({ content: [], usage: {} }), status: 200 },
        anthropicReply("{}", { input_tokens: -1, output_tokens: 1 }),
        anthropicReply("{}", { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 1.5 }),
        anthropicReply("", { input_tokens: 1, output_tokens: 1 }),
        anthropicReply("not json", { input_tokens: 1, output_tokens: 1 }),
        { body: "", status: Number.NaN },
    ]);
    const provider = createLiveProvider({
        credential: KEY,
        id: "claude",
        kind: "anthropic",
        model: "m",
        transport: failures.transport,
    });
    const expectations: readonly [string, number | null, RegExp][] = [
        [live.errors.httpCode, 401, /401 authentication_error invalid x-api-key \[redacted\]/u],
        [live.errors.httpCode, 429, /429 rate limited x+$/u],
        [live.errors.httpCode, 502, /502$/u],
        [live.errors.httpCode, 500, /500$/u],
        [live.errors.responseCode, null, /incomplete stop reason max_tokens/u],
        [live.errors.responseCode, null, /not JSON/u],
        [live.errors.responseCode, null, /no content array/u],
        [live.errors.responseCode, null, /no stop reason or usage/u],
        [live.errors.responseCode, null, /usage is malformed/u],
        [live.errors.responseCode, null, /usage is malformed/u],
        [live.errors.responseCode, null, /no text content/u],
        [live.errors.responseCode, null, /structured output is not canonical JSON/u],
        [live.errors.transportCode, null, new RegExp(`^${live.errors.transportMessage}$`, "u")],
    ];
    for (const [code, status, message] of expectations) {
        await assert.rejects(provider.invoke(liveRequest(0), signal()), (error) => {
            assert.ok(error instanceof LiveProviderError);
            assert.equal(error.code, code);
            assert.equal(error.status, status);
            assert.match(error.message, message);
            assert.equal(error.message.includes(KEY), false);
            assert.ok(
                Buffer.byteLength(error.message) <=
                    live.errors.httpMessage.length + 2 + live.limits.maxErrorDetailBytes,
            );
            return true;
        });
    }
    const thrown = createLiveProvider({
        credential: KEY,
        id: "claude",
        kind: "anthropic",
        model: "m",
        transport: async () => {
            throw new Error(`connect failed with ${KEY}`);
        },
    });
    await assert.rejects(thrown.invoke(liveRequest(0), signal()), (error) => {
        assert.ok(error instanceof LiveProviderError);
        assert.equal(error.reason, "transport");
        assert.equal(error.message.includes(KEY), false);
        return true;
    });

    const openAiFailures = scriptedTransport([
        { body: "null", status: 200 },
        { body: "{}", status: 200 },
        { body: JSON.stringify({ choices: [] }), status: 200 },
        { body: JSON.stringify({ choices: [{ message: {} }] }), status: 200 },
        openAiReply("{}", {
            completion_tokens: 1,
            prompt_tokens: 1,
            prompt_tokens_details: { cached_tokens: 2 },
        }),
        openAiReply(null),
    ]);
    const gpt = createLiveProvider({
        credential: KEY,
        id: "gpt",
        kind: "openai",
        model: "m",
        transport: openAiFailures.transport,
    });
    for (const message of [
        /no first choice message/u,
        /no first choice message/u,
        /no first choice message/u,
        /no finish reason or usage/u,
        /usage is malformed/u,
        /no text content/u,
    ]) {
        await assert.rejects(gpt.invoke(liveRequest(0), signal()), message);
    }
});

test("definitions and conversation requests are validated", async () => {
    const valid = { credential: KEY, id: "claude", kind: "anthropic", model: "m" } as const;
    for (const definition of [
        null,
        [],
        { ...valid, extra: true },
        { ...valid, kind: "static" },
        { ...valid, kind: "unknown" },
        { ...valid, id: "" },
        { ...valid, model: "\uD800" },
        { ...valid, credential: "" },
        { ...valid, credential: 7 },
        { ...valid, endpoint: "not a url" },
        { ...valid, maxOutputTokens: 0 },
        { ...valid, maxOutputTokens: 1.5 },
        { ...valid, transport: "fetch" },
        { ...valid, environment: null },
        { ...valid, environment: "env" },
    ]) {
        assert.throws(() => createLiveProvider(definition as never), TypeError);
    }
    const provider = createLiveProvider({
        ...valid,
        transport: async () => anthropicReply("{}"),
    });
    const message = { content: [{ text: "u", type: "text" }], role: "user" };
    const base = { cachePrefixMessages: 0, messages: [message], outputSchema: null, system: null };
    for (const request of [
        null,
        [],
        new Map(),
        { ...base, extra: 1 },
        { cachePrefixMessages: 0, messages: [message], outputSchema: null, prompt: null },
        { ...base, messages: [] },
        { ...base, messages: "u" },
        { ...base, messages: [{ ...message, role: "assistant" }] },
        { ...base, messages: [{ ...message, role: "tool" }] },
        { ...base, messages: [{ ...message, content: [] }] },
        { ...base, messages: [{ ...message, content: [{ text: "u", type: "image" }] }] },
        { ...base, messages: [{ ...message, content: [{ text: "", type: "text" }] }] },
        { ...base, cachePrefixMessages: 2 },
        { ...base, cachePrefixMessages: -1 },
        { ...base, outputSchema: [] },
        { ...base, outputSchema: "schema" },
        { ...base, system: "" },
    ]) {
        await assert.rejects(provider.converse(request as never, signal()), TypeError);
    }
    await assert.rejects(provider.converse(base as never, "signal" as never), TypeError);
});

test("the default transport posts the serialized request with fetch", async (context) => {
    const received: { body: string; headers: Record<string, unknown>; method: string }[] = [];
    const server = createServer((request, response) => {
        let body = "";
        request.on("data", (chunk: Buffer) => {
            body += chunk.toString("utf8");
        });
        request.on("end", () => {
            received.push({ body, headers: request.headers, method: request.method ?? "" });
            response.writeHead(200, { "content-type": "application/json" });
            response.end(anthropicReply('{"text":"local"}').body);
        });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    context.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
    const { port } = server.address() as AddressInfo;
    const provider = createLiveProvider({
        credential: KEY,
        endpoint: `http://127.0.0.1:${port}/v1/messages`,
        id: "claude",
        kind: "anthropic",
        model: "m",
    });
    assert.deepEqual((await provider.invoke(liveRequest(0), signal())).output, { text: "local" });
    assert.equal(received[0]?.method, "POST");
    assert.equal(received[0]?.headers[anthropic.credential.header], KEY);
    assert.equal(JSON.parse(received[0]?.body ?? "{}").model, "m");
});

test("runtime source contains no provider-specific literals", () => {
    const leaves = new Set<string>();
    for (const kind of Object.values(live.kinds)) {
        leaves.add(kind.endpoint);
        leaves.add(new URL(kind.endpoint).host);
        leaves.add(kind.credential.environmentVariable);
        leaves.add(kind.credential.header);
        leaves.add(kind.maxTokensField);
        for (const [name, value] of Object.entries(kind.headers)) {
            leaves.add(name);
            leaves.add(value);
        }
        for (const value of Object.values(kind.cacheControl ?? {})) {
            leaves.add(String(value));
        }
        for (const reason of kind.completeStopReasons) {
            leaves.add(reason);
        }
        if (kind.outputFormat !== null) {
            leaves.add(kind.outputFormat.name);
        }
    }
    const root = fileURLToPath(new URL("../../src/", import.meta.url));
    const derived = new Set([
        "protocol/compatibility-constants.ts",
        "protocol/values.generated.ts",
    ]);
    const files = (readdirSync(root, { recursive: true }) as string[]).filter(
        (file) => file.endsWith(".ts") && !derived.has(file.split(path.sep).join("/")),
    );
    assert.ok(files.length > 100);
    for (const file of files) {
        const source = readFileSync(path.join(root, file), "utf8");
        for (const leaf of leaves) {
            assert.equal(source.includes(`"${leaf}"`), false, `${file} hard-codes ${leaf}`);
            assert.equal(
                source.includes(leaf) && leaf.includes("."),
                false,
                `${file} hard-codes ${leaf}`,
            );
        }
    }
});
