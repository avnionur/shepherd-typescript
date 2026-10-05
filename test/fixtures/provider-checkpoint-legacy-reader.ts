import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import * as current from "../../src/index.ts";
import {
    compensateRow,
    ROW_INSERT_KIND,
    readRowIds,
    rowInsertHandlers,
    rowIntent,
} from "../effect/compensation-fixtures.ts";
import { anthropicReply, liveRequest } from "../provider/live-fixtures.ts";

// Manual N-1 drill: build 0e4a232 separately and pass its absolute dist directory.
const legacyDist = process.argv[2];
assert.ok(
    legacyDist,
    "usage: node test/fixtures/provider-checkpoint-legacy-reader.ts <legacy-dist>",
);
const legacy = createRequire(import.meta.url)(
    path.join(path.resolve(legacyDist), "src/index.js"),
) as typeof current;
const directory = mkdtempSync(path.join(tmpdir(), "shepherd-provider-checkpoint-legacy-"));
const database = path.join(directory, "trace.sqlite");
const world = path.join(directory, "world.sqlite");
using store = new current.SQLiteTraceStore(database);
const providerOptions: current.LiveProviderDefinition = {
    id: "provider",
    kind: "anthropic",
    model: "fixture",
    credential: "fixture",
    transport: async () => anthropicReply("{}"),
};
const definition = { adapterId: "session", system: "private-system-checkpoint-content-only" };
const conversation = current.createProviderConversation({
    ...definition,
    provider: current.createLiveProvider(providerOptions),
    checkpointStore: store,
});
const source = await current.runReplaySession(store, {
    commandId: "source",
    claimId: "source",
    programId: "source",
    provider: conversation.provider,
    providerSession: conversation.session,
    handlers: rowInsertHandlers(world),
    program: async (context) => {
        await context.invokeProvider(liveRequest(0));
        await context.checkpoint();
        await context.dispatchEffect(rowIntent("a"));
        return null;
    },
});
assert.equal(source.inspection.terminal?.status, "finished");
const checkpoint = source.inspection.checkpoints[0];
assert.ok(checkpoint);
using old = new legacy.SQLiteTraceStore(database);
using imported = new legacy.SQLiteTraceStore();
imported.importTrace(store.exportTrace());
let calls = 0;
for (const target of [old, imported]) {
    const before = target.exportTrace();
    const oldConversation = legacy.createProviderConversation({
        ...definition,
        provider: legacy.createLiveProvider(providerOptions),
    });
    await assert.rejects(
        legacy.rewindReplaySession(target, {
            commandId: "old-rewind",
            claimId: "old",
            sourceSessionId: source.inspection.session_id,
            target: { checkpointId: checkpoint.checkpoint_id },
            providerSession: oldConversation.session,
            compensation: legacy.createEffectCompensationRegistry([
                {
                    handlerId: "delete",
                    kind: ROW_INSERT_KIND,
                    compensate: (request) => {
                        calls++;
                        return { ok: true, value: compensateRow(world, request) };
                    },
                },
            ]),
        }),
        legacy.ReplayEvidenceError,
    );
    assert.equal(calls, 0);
    assert.deepEqual(readRowIds(world), ["a"]);
    assert.equal(target.exportTrace(), before);
    assert.equal(legacy.exportRedactedTraceArchive(target).includes(definition.system), false);
}
console.log(
    JSON.stringify({
        directory,
        legacyCompensatorCalls: calls,
        remainingRows: readRowIds(world),
        redactedAfterReopenAndImport: true,
    }),
);
