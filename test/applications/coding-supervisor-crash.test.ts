import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { type TestContext, test } from "node:test";

import {
    acknowledgeDurableTaskCancellation,
    DelegationStatusError,
    deriveApplicationOwnerId,
    inspectChildRun,
    inspectCodingSupervisorRun,
    projectChildRunResult,
    requestDurableTaskCancellation,
    runCodingSupervisor,
    SQLiteTraceStore,
} from "../../src/index.ts";
import {
    LEAD,
    outputPaths,
    rootParent,
    supervisionProtocol,
    temporaryDatabasePath,
    workerOf,
} from "./fixtures.ts";

const FIXTURE = new URL("../fixtures/applications-supervisor-process.ts", import.meta.url).pathname;

test("a supervisor killed after a worker's durable start recovers through cancellation and restart without duplicate records", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "crash");
    new SQLiteTraceStore(databasePath).close();
    const { child, line } = await runUntil(context, [databasePath], "started ");
    await kill(child);
    const [, runId, claimId, fencingToken, startedRecordId] = line.split(" ");
    assert.ok(
        runId !== undefined &&
            claimId !== undefined &&
            fencingToken !== undefined &&
            startedRecordId !== undefined,
    );
    using store = new SQLiteTraceStore(databasePath);
    const applicationId = deriveApplicationOwnerId("application:crash");
    const crashed = inspectCodingSupervisorRun(store, applicationId);
    assert.equal(crashed.manifest, null);
    assert.equal(crashed.cut_id, null);
    assert.deepEqual(
        crashed.decisions.map((decision) => decision.decision.kind),
        ["observe"],
    );
    const [a, b] = crashed.workers;
    assert.equal(a?.attempts[0]?.inspection.status, "running");
    assert.equal(a?.attempts[0]?.inspection.child_run_id, runId);
    assert.equal(a?.attempts[0]?.status, "running");
    assert.equal(b?.attempts[0]?.inspection.status, "ready");
    const countRecords = () =>
        [
            applicationId,
            ...crashed.workers.flatMap((worker) =>
                worker.attempts.flatMap((attempt) => [
                    attempt.handle_id,
                    attempt.inspection.child_run_id,
                ]),
            ),
        ]
            .map((ownerId) => store.readOwner(ownerId).length)
            .reduce((total, count) => total + count, 0);
    const before = countRecords();
    let invoked = 0;
    const workers = [
        workerOf("a", ({ input }) => {
            invoked += 1;
            return input;
        }),
        workerOf("b", ({ input }) => {
            invoked += 1;
            return input;
        }),
    ];
    const recover = (policy: Parameters<typeof runCodingSupervisor>[1]["policy"]) =>
        runCodingSupervisor(store, {
            changedPaths: outputPaths,
            commandId: "application:crash",
            parent: rootParent(),
            policy,
            protocol: supervisionProtocol(),
            supervisorId: LEAD,
            workers,
        });
    // Rerunning replays the retained round and fails closed on the running worker: no worker is
    // re-executed, no policy call is made, and no record is written.
    await assert.rejects(
        recover(() => {
            throw new Error("the retained round must not consult the policy");
        }),
        (error: unknown) => error instanceof DelegationStatusError && error.status === "running",
    );
    assert.equal(invoked, 0);
    assert.equal(countRecords(), before);
    // The documented cancellation path settles the dead worker with its retained claim authority.
    const command = requestDurableTaskCancellation(store, {
        commandId: "cancel:crashed-worker",
        expectedLifecycleRecordId: startedRecordId,
        fencingToken: Number(fencingToken),
        reason: "supervisor process died",
        runId,
    });
    const cancelled = acknowledgeDurableTaskCancellation(store, {
        cancelCommandRecordId: command.record_id,
        claimId,
        expectedLifecycleRecordId: startedRecordId,
        fencingToken: Number(fencingToken),
        runId,
    });
    assert.equal(cancelled.execution.outcome.outcome.status, "cancelled");
    assert.equal(inspectChildRun(store, a?.attempts[0]?.handle_id as string).status, "settling");
    // The restart policy discards the cancelled attempt, forks a clean successor, and accepts it.
    const recovered = await recover(({ observations, round }) => {
        if (round === 2) {
            assert.equal(observations[0]?.completion_status, "cancelled");
            assert.deepEqual(observations[0]?.changed_paths, []);
            return { kind: "discard_restart", reason: "worker process died", worker_id: "a" };
        }
        return { kind: "accept", worker_id: "a" };
    });
    assert.deepEqual(
        recovered.inspection.decisions.map((decision) => decision.decision.kind),
        ["observe", "discard_restart", "accept"],
    );
    assert.deepEqual(
        recovered.inspection.workers.map((worker) =>
            worker.attempts.map((attempt) => attempt.status),
        ),
        [["restarted", "accepted"], ["discarded"]],
    );
    assert.equal(
        recovered.inspection.workers[0]?.attempts[0]?.inspection.completion?.status,
        "cancelled",
    );
    assert.equal(
        recovered.inspection.workers[0]?.attempts[0]?.inspection.completion?.execution_kind,
        "program",
    );
    assert.equal(invoked, 2);
    assert.equal(recovered.manifest.costs.provider_calls, 3);
    assert.deepEqual(
        projectChildRunResult(
            store,
            recovered.inspection.workers[0]?.attempts[1]?.handle_id as string,
        ).value,
        { path: "greet.ts", text: "a edit" },
    );
    // The recovered run is idempotent and its evidence is consistent.
    const repeated = await recover(() => {
        throw new Error("the retained run must not consult the policy");
    });
    assert.deepEqual(repeated.manifest, recovered.manifest);
    assert.deepEqual(repeated.inspection, recovered.inspection);
    assert.equal(invoked, 2);
    assert.equal(store.verifyIntegrity().ok, true);
});

async function runUntil(
    context: TestContext,
    args: readonly string[],
    prefix: string,
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
        const line = output.split("\n").find((candidate) => candidate.startsWith(prefix));
        if (line !== undefined) {
            return { child, line };
        }
        const [chunk] = (await Promise.race([
            once(child.stdout as NonNullable<typeof child.stdout>, "data"),
            once(child, "exit").then(() => {
                throw new Error(`fixture exited before ${prefix}: ${errors}`);
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
