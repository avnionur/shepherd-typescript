import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
    createLiveProvider,
    createProviderConversation,
    executeTaskDurably,
    replayReplaySession,
    runReplaySession,
    SQLiteTraceStore,
    schema,
    task,
} from "../../src/index.ts";
import { providerProtocolConfig } from "../../src/protocol/config.ts";
import { temporaryDirectory } from "../replay/fixtures.ts";
import { anthropicReply, liveRequest, openAiReply, scriptedTransport } from "./live-fixtures.ts";

const KEY = "sk-ant-secret-scan-credential-Zx8Qm2Lp9Rt4Vw7Yb3Nc6";
const anthropic = providerProtocolConfig.live.kinds.anthropic;
const openai = providerProtocolConfig.live.kinds.openai;

function filesUnder(directory: string): string[] {
    return readdirSync(directory).flatMap((name) => {
        const file = path.join(directory, name);
        return statSync(file).isDirectory() ? filesUnder(file) : [file];
    });
}

test("provider-backed tasks and replay sessions retain no credential in any record, blob, or trace file", async (context) => {
    const directory = await temporaryDirectory(context, "secret-scan");
    const databasePath = path.join(directory, "trace.sqlite");
    const store = new SQLiteTraceStore(databasePath);
    const greet = task({
        input: schema.object({ name: schema.string() }),
        instruction: "Greet the supplied person.",
        name: "live-greet",
        output: schema.object({ greeting: schema.string() }),
        version: "1.0.0",
    });
    const echo = JSON.stringify({
        error: { message: `invalid credential ${KEY}`, type: "authentication_error" },
    });
    const taskTransport = scriptedTransport([
        anthropicReply('{"greeting":"Hello, Ada"}', {
            cache_creation_input_tokens: 12,
            cache_read_input_tokens: 30,
            input_tokens: 8,
            output_tokens: 4,
        }),
        { body: echo, status: 401 },
    ]);
    const provider = createLiveProvider({
        environment: { [anthropic?.credential.environmentVariable ?? ""]: KEY },
        id: "provider:claude",
        kind: "anthropic",
        model: "fixture-model",
        transport: taskTransport.transport,
    });
    const finished = await executeTaskDurably(store, {
        budget: { maxTurns: 1 },
        input: { name: "Ada" },
        provider,
        runId: "run:live:finished",
        task: greet,
    });
    assert.equal(finished.execution.outcome.outcome.status, "finished");
    assert.equal(finished.execution.usage?.cache_read_input_tokens, 30);
    assert.equal(finished.execution.usage?.cache_creation_input_tokens, 12);
    const failed = await executeTaskDurably(store, {
        budget: { maxTurns: 1 },
        input: { name: "Grace" },
        provider,
        runId: "run:live:failed",
        task: greet,
    });
    assert.equal(failed.execution.outcome.outcome.status, "failed");
    assert.match(JSON.stringify(failed.execution.outcome), /\[redacted\]/u);
    assert.equal(
        taskTransport.calls.every(
            (call) => call.headers[anthropic?.credential.header ?? ""] === KEY,
        ),
        true,
    );

    const sessionTransport = scriptedTransport([
        openAiReply('{"text":"a"}'),
        { body: echo, status: 403 },
        openAiReply('{"text":"c"}'),
        openAiReply('{"text":"c"}'),
    ]);
    const conversation = createProviderConversation({
        adapterId: "conversation:secret-scan",
        provider: createLiveProvider({
            environment: { [openai?.credential.environmentVariable ?? ""]: KEY },
            id: "provider:gpt",
            kind: "openai",
            model: "fixture-model",
            transport: sessionTransport.transport,
        }),
    });
    const program = async (
        replayContext: Parameters<Parameters<typeof runReplaySession>[1]["program"]>[0],
    ) => {
        await replayContext.invokeProvider(liveRequest(0));
        await replayContext.invokeProvider(liveRequest(1)).catch(() => null);
        await replayContext.checkpoint();
        return (await replayContext.invokeProvider(liveRequest(2))).response.output;
    };
    const { inspection } = await runReplaySession(store, {
        claimId: "worker",
        commandId: "root:secret-scan",
        program,
        programId: "program:secret-scan",
        provider: conversation.provider,
        providerSession: conversation.session,
    });
    assert.match(String(inspection.steps[1]?.provider?.failure?.message), /\[redacted\]/u);
    const checkpoint = inspection.checkpoints[0];
    assert.ok(checkpoint);
    const replayed = await replayReplaySession(store, {
        claimId: "operator",
        commandId: "replay:secret-scan",
        program,
        provider: conversation.provider,
        providerSession: conversation.session,
        sourceSessionId: inspection.session_id,
        target: { checkpointId: checkpoint.checkpoint_id },
    });
    assert.equal(replayed.inspection.terminal?.status, "finished");

    const archive = store.exportTrace();
    assert.equal(archive.includes(KEY), false);
    const blobs =
        (JSON.parse(archive) as { readonly blobs?: readonly Record<string, unknown>[] }).blobs ??
        [];
    for (const blob of blobs) {
        for (const value of Object.values(blob)) {
            if (typeof value === "string") {
                assert.equal(Buffer.from(value, "base64").includes(KEY), false);
            }
        }
    }
    store.close();
    const files = filesUnder(directory);
    assert.ok(files.includes(databasePath));
    for (const file of files) {
        assert.equal(readFileSync(file).includes(KEY), false, `${file} retains the credential`);
    }
    const encoded = Buffer.from(KEY, "utf8");
    for (const file of files) {
        assert.equal(readFileSync(file).indexOf(encoded), -1);
    }
});
