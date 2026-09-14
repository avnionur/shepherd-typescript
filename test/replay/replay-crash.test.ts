import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { type TestContext, test } from "node:test";

import {
    deriveReplaySessionId,
    inspectReplaySession,
    REPLAY_LEASE_LIMITS,
    ReplayCheckpointUnavailableError,
    ReplayMaterializationUncertainError,
    ReplaySessionInterruptedError,
    rewindReplaySession,
    runReplaySession,
    SQLiteTraceStore,
} from "../../src/index.ts";
import { emptyDirectory, reviewProvider, temporaryDirectory } from "./fixtures.ts";

const FIXTURE = new URL("../fixtures/replay-process.ts", import.meta.url).pathname;
const afterLease = () => Date.now() + REPLAY_LEASE_LIMITS.leaseMilliseconds + 1;

test("a session writer killed between steps is interrupted and recovers by rewinding its checkpoint", async (context) => {
    const directory = await temporaryDirectory(context, "crash-between");
    const databasePath = path.join(directory, "trace.sqlite");
    const world = await emptyDirectory(directory, "world");
    new SQLiteTraceStore(databasePath).close();
    await kill(await runUntil(context, ["between", databasePath, world], "checkpointed"));
    using store = new SQLiteTraceStore(databasePath);
    const sessionId = deriveReplaySessionId("session:between");
    assert.equal(inspectReplaySession(store, { sessionId }).classification, "running");
    const crashed = inspectReplaySession(store, { clock: afterLease, sessionId });
    assert.equal(crashed.classification, "interrupted");
    assert.equal(crashed.steps.length, 2);
    await assert.rejects(
        runReplaySession(store, {
            claimId: "worker:replacement",
            clock: afterLease,
            commandId: "session:between",
            program: () => null,
            programId: "program:crash",
            provider: reviewProvider(),
            worlds: [{ name: "main", root: world }],
        }),
        (error: unknown) =>
            error instanceof ReplaySessionInterruptedError &&
            error.classification === "interrupted",
    );
    const restored = await emptyDirectory(directory, "restored");
    const { inspection } = await rewindReplaySession(store, {
        claimId: "operator",
        commandId: "rewind:between",
        sourceSessionId: sessionId,
        target: { checkpointId: crashed.checkpoints[0]?.checkpoint_id as string },
        worlds: [{ name: "main", root: restored }],
    });
    assert.equal(inspection.terminal?.status, "rewound");
    assert.equal(await readFile(path.join(restored, "draft.txt"), "utf8"), "draft");
    assert.equal(store.verifyIntegrity().ok, true);
});

test("a session writer killed after an effect admission is materialization-uncertain and never re-invoked", async (context) => {
    const directory = await temporaryDirectory(context, "crash-admitted");
    const databasePath = path.join(directory, "trace.sqlite");
    const world = await emptyDirectory(directory, "world");
    new SQLiteTraceStore(databasePath).close();
    await kill(await runUntil(context, ["admitted", databasePath, world], "materializing"));
    using store = new SQLiteTraceStore(databasePath);
    const sessionId = deriveReplaySessionId("session:admitted");
    const crashed = inspectReplaySession(store, { clock: afterLease, sessionId });
    assert.equal(crashed.classification, "materialization_uncertain");
    assert.notEqual(crashed.pending_admission_record_id, null);
    let invoked = false;
    await assert.rejects(
        runReplaySession(store, {
            claimId: "worker:replacement",
            clock: afterLease,
            commandId: "session:admitted",
            handlers: {
                dispatch: async () => {
                    invoked = true;
                    throw new Error("must not run");
                },
            },
            program: () => null,
            programId: "program:crash",
            provider: reviewProvider(),
            worlds: [{ name: "main", root: world }],
        }),
        ReplayMaterializationUncertainError,
    );
    assert.equal(invoked, false);
    await assert.rejects(
        rewindReplaySession(store, {
            claimId: "operator",
            commandId: "rewind:admitted-boundary",
            sourceSessionId: sessionId,
            target: { stepCount: 2 },
        }),
        ReplayCheckpointUnavailableError,
    );
    const restored = await emptyDirectory(directory, "restored");
    const { inspection } = await rewindReplaySession(store, {
        claimId: "operator",
        commandId: "rewind:admitted",
        sourceSessionId: sessionId,
        target: { checkpointId: crashed.checkpoints[0]?.checkpoint_id as string },
        worlds: [{ name: "main", root: restored }],
    });
    assert.equal(inspection.steps.length, 2);
    assert.equal(store.verifyIntegrity().ok, true);
});

async function runUntil(
    context: TestContext,
    args: readonly string[],
    line: string,
): Promise<ChildProcess> {
    const child = spawn(process.execPath, [FIXTURE, ...args], {
        stdio: ["ignore", "pipe", "pipe"],
    });
    context.after(() => {
        if (child.exitCode === null && child.signalCode === null) {
            child.kill("SIGKILL");
        }
    });
    let output = "";
    let errors = "";
    child.stderr?.on("data", (chunk: Buffer) => {
        errors += chunk.toString();
    });
    while (!output.split("\n").includes(line)) {
        const [chunk] = (await Promise.race([
            once(child.stdout as NonNullable<typeof child.stdout>, "data"),
            once(child, "exit").then(() => {
                throw new Error(`fixture exited before ${line}: ${errors}`);
            }),
        ])) as [Buffer];
        output += chunk.toString();
    }
    return child;
}

async function kill(child: ChildProcess): Promise<void> {
    const exit = once(child, "exit");
    assert.equal(child.kill("SIGKILL"), true);
    const [, signal] = (await exit) as [number | null, NodeJS.Signals | null];
    assert.equal(signal, "SIGKILL");
}
