import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import {
    createLiveProvider,
    createProviderConversation,
    type PROVIDER_KINDS,
    type ReplaySessionContext,
    replayReplaySession,
    runReplaySession,
    SQLiteTraceStore,
} from "../../src/index.ts";
import { providerProtocolConfig } from "../../src/protocol/config.ts";
import { temporaryDirectory } from "../replay/fixtures.ts";
import { liveRequest } from "./live-fixtures.ts";

/** Opt-in switch: the live test runs only when this variable is `1`. */
const SWITCH = "SHEPHERD_LIVE_PROVIDER_TEST";
const kind = (process.env.SHEPHERD_LIVE_PROVIDER_KIND ??
    Object.keys(providerProtocolConfig.live.kinds)[0]) as (typeof PROVIDER_KINDS)[number];
const model = process.env.SHEPHERD_LIVE_PROVIDER_MODEL;
const kindConfig = providerProtocolConfig.live.kinds[kind];
const credentialVariable = kindConfig?.credential.environmentVariable;
const skip =
    process.env[SWITCH] !== "1"
        ? `set ${SWITCH}=1, SHEPHERD_LIVE_PROVIDER_KIND, SHEPHERD_LIVE_PROVIDER_MODEL, and the kind's credential variable to run`
        : kindConfig === undefined
          ? `SHEPHERD_LIVE_PROVIDER_KIND ${kind} is not a configured live kind`
          : model === undefined ||
              credentialVariable === undefined ||
              process.env[credentialVariable] === undefined
            ? `SHEPHERD_LIVE_PROVIDER_MODEL and ${credentialVariable} are required`
            : false;

test("live provider: replay after rewind observes prompt-cache reads on the restored prefix", {
    skip,
    timeout: 300_000,
}, async (context) => {
    const directory = await temporaryDirectory(context, "live-provider");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const system = Array.from(
        { length: 600 },
        (_, index) =>
            `Reference clause ${index}: summaries are short, factual, and reuse the input step number.`,
    ).join("\n");
    const conversation = createProviderConversation({
        adapterId: "conversation:live",
        provider: createLiveProvider({ id: "provider:live", kind, model: model as string }),
        system,
    });
    const program = async (replayContext: ReplaySessionContext) => {
        await replayContext.invokeProvider(liveRequest(0));
        await replayContext.invokeProvider(liveRequest(1));
        await replayContext.checkpoint();
        return (await replayContext.invokeProvider(liveRequest(2))).response.output;
    };
    const { inspection: root } = await runReplaySession(store, {
        claimId: "live",
        commandId: "root:live",
        program,
        programId: "program:live",
        provider: conversation.provider,
        providerSession: conversation.session,
    });
    assert.equal(root.terminal?.status, "finished");
    const checkpoint = root.checkpoints[0];
    assert.ok(checkpoint);
    const { inspection: replayed } = await replayReplaySession(store, {
        claimId: "live",
        commandId: "replay:live",
        program,
        provider: conversation.provider,
        providerSession: conversation.session,
        sourceSessionId: root.session_id,
        target: { checkpointId: checkpoint.checkpoint_id },
    });
    assert.equal(replayed.terminal?.status, "finished");
    const cache = replayed.steps[2]?.provider?.cache;
    context.diagnostic(
        `root usage ${JSON.stringify(root.steps.map((step) => step.provider?.cache))}`,
    );
    context.diagnostic(`replayed step cache ${JSON.stringify(cache)}`);
    assert.equal(cache?.identity, root.steps[2]?.provider?.cache?.identity);
    assert.equal(cache?.status, "hit");
    assert.ok((cache?.read_input_tokens ?? 0) > 0);
});
