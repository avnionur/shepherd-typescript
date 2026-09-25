import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import {
    deriveEffectCompensationId,
    EffectCompensationHandlerNotFoundError,
    inspectEffectCompensation,
    replayReplaySession,
    rewindReplaySession,
    SQLiteTraceStore,
} from "../../src/index.ts";
import { replayProtocolConfig } from "../../src/protocol/config.ts";
import { REPLAY_SOURCE_DISPOSITIONS } from "../../src/protocol/values.generated.ts";
import {
    readRowIds,
    rowCompensation,
    rowInsertHandlers,
    rowProgram,
    runRowSession,
} from "../effect/compensation-fixtures.ts";
import { temporaryDirectory } from "./fixtures.ts";

const [COMPENSATE, RETAIN] = REPLAY_SOURCE_DISPOSITIONS;
const ROWS = [
    ["a", "compensable"],
    ["b", "compensable"],
] as const;

function compensationStatus(store: SQLiteTraceStore, recordId: string): string | null {
    try {
        return inspectEffectCompensation(store, {
            compensationId: deriveEffectCompensationId(recordId),
        }).status;
    } catch {
        return null;
    }
}

test("the configured default source disposition compensates the abandoned suffix", () => {
    assert.equal(replayProtocolConfig.branch.defaultSourceDisposition, COMPENSATE);
    assert.deepEqual(replayProtocolConfig.branch.sourceDispositions, [COMPENSATE, RETAIN]);
});

test("a retaining replay or rewind over a compensable suffix invokes no compensation handler", async (context) => {
    const directory = await temporaryDirectory(context, "source-retain");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const world = path.join(directory, "world.sqlite");
    const { inspection: source } = await runRowSession(store, world, "session:rows", ROWS);
    assert.deepEqual(readRowIds(world), ["a", "b"]);
    const calls: string[] = [];

    const { inspection: replayed } = await replayReplaySession(store, {
        claimId: "explorer",
        commandId: "replay:rows:retain",
        compensation: rowCompensation(world, calls),
        handlers: rowInsertHandlers(world),
        program: rowProgram(ROWS),
        sourceDisposition: RETAIN,
        sourceSessionId: source.session_id,
        target: { stepCount: 1 },
    });
    assert.equal(replayed.terminal?.status, "finished");
    // Without a registry a retaining branch never needs one.
    const { inspection: rewound } = await rewindReplaySession(store, {
        claimId: "explorer",
        commandId: "rewind:rows:retain",
        sourceDisposition: RETAIN,
        sourceSessionId: source.session_id,
        target: { stepCount: 0 },
    });
    assert.equal(rewound.terminal?.status, "rewound");
    assert.deepEqual(calls, []);
    assert.deepEqual(readRowIds(world), ["a", "b"]);
    for (const step of source.steps) {
        assert.equal(compensationStatus(store, step.record_id), null);
    }
});

test("an abandoning rewind still compensates the suffix the source retained", async (context) => {
    const directory = await temporaryDirectory(context, "source-compensate");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const world = path.join(directory, "world.sqlite");
    const { inspection: source } = await runRowSession(store, world, "session:rows", ROWS);
    await assert.rejects(
        rewindReplaySession(store, {
            claimId: "operator",
            commandId: "rewind:rows:missing",
            sourceSessionId: source.session_id,
            target: { stepCount: 0 },
        }),
        EffectCompensationHandlerNotFoundError,
    );
    const calls: string[] = [];
    const { inspection } = await rewindReplaySession(store, {
        claimId: "operator",
        commandId: "rewind:rows:compensate",
        compensation: rowCompensation(world, calls),
        sourceDisposition: COMPENSATE,
        sourceSessionId: source.session_id,
        target: { stepCount: 0 },
    });
    assert.equal(inspection.terminal?.status, "rewound");
    assert.deepEqual(calls, ["effect:row:b", "effect:row:a"]);
    assert.deepEqual(readRowIds(world), []);
    for (const step of source.steps) {
        assert.equal(compensationStatus(store, step.record_id), "compensated");
    }
});

test("a branch refuses an unconfigured source disposition before writing", async (context) => {
    const directory = await temporaryDirectory(context, "source-invalid");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const world = path.join(directory, "world.sqlite");
    const { inspection: source } = await runRowSession(store, world, "session:rows", ROWS);
    const before = store.readOwner(source.session_id).length;
    for (const sourceDisposition of ["abandon", 1, null]) {
        await assert.rejects(
            rewindReplaySession(store, {
                claimId: "operator",
                commandId: `rewind:rows:${String(sourceDisposition)}`,
                sourceDisposition: sourceDisposition as never,
                sourceSessionId: source.session_id,
                target: { stepCount: 0 },
            }),
            /sourceDisposition must be a configured replay source disposition/u,
        );
    }
    assert.equal(store.readOwner(source.session_id).length, before);
    assert.deepEqual(readRowIds(world), ["a", "b"]);
});
