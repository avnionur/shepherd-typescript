import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { type TestContext, test } from "node:test";

import {
    ApplicationEvidenceError,
    deriveApplicationOwnerId,
    inspectCounterfactualOptimization,
    inspectReplaySession,
    inspectTreeRlRun,
    REPLAY_LEASE_LIMITS,
    ReplaySessionInterruptedError,
    runCounterfactualOptimization,
    runTreeRlRollouts,
    SQLiteTraceStore,
} from "../../src/index.ts";
import { temporaryDatabasePath } from "./fixtures.ts";
import { CRASH_CLOCK_MILLISECONDS, replayCrashOptions } from "./replay-crash-fixtures.ts";

const FIXTURE = new URL("../fixtures/applications-replay-process.ts", import.meta.url).pathname;
const EXPIRED = CRASH_CLOCK_MILLISECONDS + REPLAY_LEASE_LIMITS.leaseMilliseconds + 1;
const live = () => CRASH_CLOCK_MILLISECONDS;
const expired = () => EXPIRED;

test("a process killed inside a Tree-RL rollout session is refused under its live lease and retained as a failed rollout once it expires", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "tree-rl-crash");
    const commandId = "application:tree-rl:killed";
    new SQLiteTraceStore(databasePath).close();
    // Terminal 1 is the source session; terminal 4 is the third rollout's.
    const { child, line } = await runUntil(context, [databasePath, "tree_rl", commandId, "4"]);
    await kill(child);
    const [, sessionId] = line.split(" ") as [string, string];
    using store = new SQLiteTraceStore(databasePath);
    const applicationId = deriveApplicationOwnerId(commandId);
    const crashed = inspectTreeRlRun(store, applicationId);
    assert.deepEqual(
        crashed.rollouts.map((rollout) => rollout.record?.status ?? null),
        ["completed", "completed", null, null, null, null],
    );
    assert.equal(crashed.rollouts[2]?.replay_session_id, sessionId);
    assert.equal(inspectReplaySession(store, { clock: live, sessionId }).terminal, null);
    assert.equal(crashed.manifest, null);
    const records = store.readOwner(applicationId).length;
    const sessionRecords = store.readOwner(sessionId).length;
    // While the dead writer's lease is live the rollout may still be held: nothing is written.
    await assert.rejects(
        runTreeRlRollouts(store, (await treeRlCrashOptions(store, commandId, live)).options),
        (error: unknown) =>
            error instanceof ReplaySessionInterruptedError &&
            error.session_id === sessionId &&
            error.classification === "running",
    );
    assert.equal(store.readOwner(applicationId).length, records);
    // Once the lease expired the interrupted rollout is retained as failed, excluded from the batch,
    // and the run completes; its session is never resumed.
    const options = (await treeRlCrashOptions(store, commandId, expired)).options;
    const { batch, inspection, manifest } = await runTreeRlRollouts(store, options);
    const interrupted = inspection.rollouts[2]?.record;
    assert.equal(interrupted?.status, "failed");
    assert.equal(interrupted?.failure?.code, "APPLICATION_EVIDENCE_INVALID");
    assert.equal(interrupted?.reward, null);
    assert.equal(store.readOwner(sessionId).length, sessionRecords);
    assert.equal(
        inspection.rollouts.filter((rollout) => rollout.record?.status === "completed").length,
        5,
    );
    assert.equal(batch.line_count, 5);
    assert.equal(
        batch.lines.some((entry) => entry.replay_session_id === sessionId),
        false,
    );
    const repeated = await runTreeRlRollouts(store, options);
    assert.deepEqual(repeated.manifest, manifest);
    assert.deepEqual(repeated.inspection, inspection);
    assert.equal(store.verifyIntegrity().ok, true);
});

test("a process killed inside a counterfactual candidate branch is refused under its live lease and retained as a rejected candidate once it expires", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "cro-crash");
    const commandId = "application:cro:killed";
    new SQLiteTraceStore(databasePath).close();
    // Terminal 1 is the recorded baseline session; terminal 2 is the first candidate branch's.
    const { child, line } = await runUntil(context, [
        databasePath,
        "counterfactual_optimization",
        commandId,
        "2",
    ]);
    await kill(child);
    const [, sessionId] = line.split(" ") as [string, string];
    using store = new SQLiteTraceStore(databasePath);
    const applicationId = deriveApplicationOwnerId(commandId);
    const crashed = inspectCounterfactualOptimization(store, applicationId);
    assert.equal(crashed.candidates[0]?.outcome, null);
    assert.equal(crashed.candidates[0]?.proposed?.branch_session_id, sessionId);
    assert.equal(inspectReplaySession(store, { clock: live, sessionId }).terminal, null);
    const records = store.readOwner(applicationId).length;
    await assert.rejects(
        runCounterfactualOptimization(
            store,
            (await croCrashOptions(store, commandId, live)).options,
        ),
        (error: unknown) =>
            error instanceof ReplaySessionInterruptedError &&
            error.session_id === sessionId &&
            error.classification === "running",
    );
    assert.equal(store.readOwner(applicationId).length, records);
    // Once the lease expired the candidate is retained as rejected and the run stops; later reruns
    // re-raise the retained failure without writing.
    const options = (await croCrashOptions(store, commandId, expired)).options;
    await assert.rejects(
        runCounterfactualOptimization(store, options),
        (error: unknown) =>
            error instanceof ApplicationEvidenceError &&
            error.cause instanceof ReplaySessionInterruptedError,
    );
    const inspection = inspectCounterfactualOptimization(store, applicationId);
    const [dies, later] = inspection.candidates;
    assert.equal(dies?.outcome?.status, "rejected");
    assert.equal(dies?.outcome?.failure?.code, "APPLICATION_EVIDENCE_INVALID");
    assert.equal(dies?.outcome?.branch_session_id, sessionId);
    assert.equal(later?.proposed, null);
    assert.equal(inspection.promotion, null);
    const retained = store.readOwner(applicationId).length;
    await assert.rejects(runCounterfactualOptimization(store, options), ApplicationEvidenceError);
    assert.equal(store.readOwner(applicationId).length, retained);
    assert.equal(store.verifyIntegrity().ok, true);
});

async function treeRlCrashOptions(store: SQLiteTraceStore, commandId: string, clock: () => number) {
    const built = await replayCrashOptions(store, "tree_rl", commandId, clock);
    if (built.kind !== "tree_rl") {
        throw new TypeError("expected Tree-RL options");
    }
    return built;
}

async function croCrashOptions(store: SQLiteTraceStore, commandId: string, clock: () => number) {
    const built = await replayCrashOptions(store, "counterfactual_optimization", commandId, clock);
    if (built.kind !== "counterfactual_optimization") {
        throw new TypeError("expected optimizer options");
    }
    return built;
}

async function runUntil(
    context: TestContext,
    args: readonly string[],
): Promise<{ readonly child: ChildProcess; readonly line: string }> {
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
    for (;;) {
        const line = output.split("\n").find((candidate) => candidate.startsWith("halted "));
        if (line !== undefined) {
            return { child, line };
        }
        const [chunk] = (await Promise.race([
            once(child.stdout as NonNullable<typeof child.stdout>, "data"),
            once(child, "exit").then(() => {
                throw new Error(`fixture exited before halting: ${errors}`);
            }),
        ])) as [Buffer];
        output += chunk.toString();
    }
}

async function kill(child: ChildProcess): Promise<void> {
    const exit = once(child, "exit");
    assert.equal(child.kill("SIGKILL"), true);
    const [, signal] = (await exit) as [number | null, NodeJS.Signals | null];
    assert.equal(signal, "SIGKILL");
}
