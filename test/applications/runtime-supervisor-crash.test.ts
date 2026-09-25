import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { type TestContext, test } from "node:test";

import {
    deriveApplicationOwnerId,
    inspectRuntimeSupervisorRun,
    inspectScope,
    type RecordId,
    runRuntimeSupervisor,
    SQLiteTraceStore,
    type StoreAppendRequest,
} from "../../src/index.ts";
import {
    CRASH_CLOCK,
    CRASH_COMMAND,
    CRASH_DECISIONS,
    CRASH_SUPERVISOR,
    crashWorkers,
    discardWorkers,
    reopenSupervisorWorld,
    SETTLEMENT_COMMAND,
} from "./runtime-supervisor-crash-fixtures.ts";
import {
    firstToolResult,
    gate,
    runtimeProtocol,
    runtimeWorker,
    say,
    scriptedPolicy,
    scriptedWorker,
    ticker,
    until,
    use,
} from "./runtime-supervisor-fixtures.ts";
import { createSupervisorWorld } from "./world-adapter-fixture.ts";

const FIXTURE = new URL("../fixtures/applications-runtime-supervisor-process.ts", import.meta.url)
    .pathname;

test("a supervisor killed after retaining an inject and a cross-agent handoff recovers both mid-run interventions", async (context) => {
    const world = await createSupervisorWorld(context, "runtime-crash");
    const parentScopeId = world.parent.scope_id;
    world.store.close();
    const { child, line } = await runUntil(
        context,
        [world.workspaceRoot, world.databasePath, parentScopeId],
        "tick ",
    );
    await kill(child);
    const inFlightDigest = line.slice("tick ".length);
    using store = new SQLiteTraceStore(world.databasePath);
    const applicationId = deriveApplicationOwnerId(CRASH_COMMAND);
    const crashed = inspectRuntimeSupervisorRun(store, applicationId);
    // Tick 1 was retained with its snapshot before any decision took effect.
    assert.deepEqual(crashed.ticks[0]?.decisions, CRASH_DECISIONS);
    assert.deepEqual(
        crashed.workers.map((worker) =>
            worker.attempts.map((attempt) => [attempt.turns.length, attempt.completion]),
        ),
        [[[1, null]], [[1, null]]],
    );
    const scenario = crashWorkers(false);
    const world2 = reopenSupervisorWorld(world.workspaceRoot, store, parentScopeId);
    const clock = ticker();
    clock.release();
    const recovered = await runRuntimeSupervisor(store, {
        clock: CRASH_CLOCK,
        commandId: CRASH_COMMAND,
        policy: ({ tick }) => {
            assert.notEqual(tick, 1, "a retained tick must not consult the policy");
            return { output: { decisions: [] }, usage: null };
        },
        protocol: runtimeProtocol(),
        supervisorId: CRASH_SUPERVISOR,
        wait: clock.wait,
        workers: scenario.workers,
        world: world2,
    });
    const [leader, follower] = recovered.inspection.workers;
    // Worker a resumed from its retained conversation: the resent request is byte-identical to
    // the one in flight when the process died, and the injected guidance joined the next turn.
    const leaderTurns = leader?.attempts[0]?.turns ?? [];
    assert.equal(leaderTurns[1]?.request_digest, inFlightDigest);
    assert.deepEqual(
        leaderTurns.map((turn) => turn.guidance_ticks),
        [[], [1], []],
    );
    assert.deepEqual(
        scenario.requests.a[1]?.messages.at(-1)?.content.at(-1),
        say(CRASH_DECISIONS[0]?.guidance as string),
    );
    // Worker b was aborted, re-rooted on a's custody, and restarted with guidance.
    const [stale, restarted] = follower?.attempts ?? [];
    assert.equal(stale?.completion?.status, "aborted");
    assert.deepEqual(stale?.completion?.cause, { action: "handoff", tick: 1 });
    assert.equal(restarted?.custody.source_custody_id, leader?.attempts[0]?.custody.custody_id);
    assert.equal(firstToolResult(scenario.requests.b[1]).result.value, "leader tree");
    assert.equal(
        readFileSync(path.join(recovered.custody[0]?.custody.root as string, "lead.txt"), "utf8"),
        "leader tree v2",
    );
    assert.equal(recovered.inspection.settlement?.undelivered.length, 0);
    assert.equal(store.verifyIntegrity().ok, true);
    const repeated = await runRuntimeSupervisor(store, {
        clock: CRASH_CLOCK,
        commandId: CRASH_COMMAND,
        policy: () => {
            throw new Error("the settled run must not consult the policy");
        },
        protocol: runtimeProtocol(),
        supervisorId: CRASH_SUPERVISOR,
        workers: crashWorkers(false).workers,
        world: reopenSupervisorWorld(world.workspaceRoot, store, parentScopeId),
    });
    assert.deepEqual(repeated.manifest, recovered.manifest);
    assert.deepEqual(repeated.inspection, recovered.inspection);
});

test("a supervisor killed between two settlement discards completes the settlement on rerun", async (context) => {
    const world = await createSupervisorWorld(context, "runtime-settlement-crash");
    const parentScopeId = world.parent.scope_id;
    world.store.close();
    const { child, line } = await runUntil(
        context,
        [world.workspaceRoot, world.databasePath, parentScopeId, "settlement"],
        "discarded ",
    );
    await kill(child);
    using store = new SQLiteTraceStore(world.databasePath);
    const applicationId = deriveApplicationOwnerId(SETTLEMENT_COMMAND);
    const crashed = inspectRuntimeSupervisorRun(store, applicationId);
    const planned = crashed.settlement?.discard_custody_ids ?? [];
    assert.equal(planned.length, 2);
    assert.equal(line.slice("discarded ".length), planned[0]);
    assert.equal(crashed.manifest, null);
    const states = () =>
        (inspectScope(store, parentScopeId)?.children ?? [])
            .map((scopeId) => inspectScope(store, scopeId)?.state)
            .sort();
    assert.deepEqual(states(), ["discarded", "open", "open", "open"]);
    const rerun = () =>
        runRuntimeSupervisor(store, {
            clock: CRASH_CLOCK,
            commandId: SETTLEMENT_COMMAND,
            policy: () => {
                throw new Error("the settled run must not consult the policy");
            },
            protocol: runtimeProtocol(),
            supervisorId: CRASH_SUPERVISOR,
            workers: discardWorkers().workers,
            world: reopenSupervisorWorld(world.workspaceRoot, store, parentScopeId),
        });
    const recovered = await rerun();
    // The completed discard replayed and the interrupted one ran: both abandoned custodies are
    // discarded exactly once, the final custodies stay open, and the manifest cites both receipts.
    assert.deepEqual(states(), ["discarded", "discarded", "open", "open"]);
    assert.equal(
        recovered.manifest.artifacts.filter((artifact) => artifact.role === "world_discard").length,
        1,
    );
    for (const { custody } of recovered.custody) {
        assert.equal(planned.includes(custody.custody_id), false);
        assert.equal(existsSync(custody.root), true);
    }
    assert.equal(store.verifyIntegrity().ok, true);
    const repeated = await rerun();
    assert.deepEqual(repeated.manifest, recovered.manifest);
});

test("a run interrupted by a policy error after an inject resumes its workers and delivers the guidance", async (context) => {
    const world = await createSupervisorWorld(context, "runtime-interrupted");
    const { store } = world;
    const commandId = "application:runtime:interrupted";
    const guidance = "Keep your edits in a.txt.";
    const first = scriptedWorker("model:a", [
        [
            () => [use("a1", "write_file", { path: "a.txt", text: "a1" })],
            async (_request, signal) => {
                await gate().wait(signal);
                return [say("never")];
            },
        ],
    ]);
    const b = scriptedWorker("model:b", [
        [
            () => [use("b1", "write_file", { path: "b.txt", text: "b1" })],
            async (_request, signal) => {
                await gate().wait(signal);
                return [say("never")];
            },
        ],
    ]);
    const clock = ticker();
    const failing = runRuntimeSupervisor(store, {
        clock: () => 3_000,
        commandId,
        policy: ({ tick }) => {
            if (tick === 2) {
                throw new Error("policy crashed");
            }
            return {
                output: { decisions: [{ action: "inject", agent: "a", guidance, reason: "r" }] },
                usage: null,
            };
        },
        protocol: runtimeProtocol(),
        supervisorId: "supervisor:runtime",
        wait: clock.wait,
        workers: [runtimeWorker("a", first.model), runtimeWorker("b", b.model)],
        world: world.adapter,
    });
    await until(() => first.requests.length === 2 && b.requests.length === 2, "both mid-turn");
    await clock.advance();
    await clock.advance();
    await assert.rejects(failing, /policy crashed/u);
    const applicationId = deriveApplicationOwnerId(commandId);
    const interrupted = inspectRuntimeSupervisorRun(store, applicationId);
    assert.equal(interrupted.ticks.length, 1);
    assert.deepEqual(
        interrupted.workers.map((worker) => worker.attempts[0]?.completion),
        [null, null],
    );
    const resumedA = scriptedWorker("model:a", [
        [
            () => [say("unused")],
            () => [use("a2", "write_file", { path: "a.txt", text: "a2" })],
            () => [say("a done")],
        ],
    ]);
    const resumedB = scriptedWorker("model:b", [[() => [say("unused")], () => [say("b done")]]]);
    const policy = scriptedPolicy([]);
    const rerun = ticker();
    rerun.release();
    const receipt = await runRuntimeSupervisor(store, {
        clock: () => 3_000,
        commandId,
        policy,
        protocol: runtimeProtocol(),
        supervisorId: "supervisor:runtime",
        wait: rerun.wait,
        workers: [runtimeWorker("a", resumedA.model), runtimeWorker("b", resumedB.model)],
        world: world.adapter,
    });
    assert.ok(policy.contexts.every((tick) => tick.tick > 1));
    // The resumed request is exactly the request the interrupted run sent.
    assert.deepEqual(resumedA.requests[0], first.requests[1]);
    assert.deepEqual(resumedA.requests[1]?.messages.at(-1)?.content.at(-1), say(guidance));
    assert.deepEqual(
        receipt.inspection.workers[0]?.attempts[0]?.turns.map((turn) => turn.guidance_ticks),
        [[], [1], []],
    );
});

/** Store whose append of one worker's second attempt record dies once. */
class AttemptCrashStore extends SQLiteTraceStore {
    armed = true;

    override appendApplicationRecord(
        applicationId: string,
        expectedHeadRecordId: RecordId | null,
        request: StoreAppendRequest,
        cutId: string | null,
    ) {
        const body = request.batch.groups[0]?.records[0]?.body as {
            readonly attempt?: number;
            readonly phase?: string;
        };
        if (this.armed && body.phase === "attempt" && body.attempt === 2) {
            this.armed = false;
            throw new Error("process died before the attempt record");
        }
        return super.appendApplicationRecord(applicationId, expectedHeadRecordId, request, cutId);
    }
}

test("a handoff interrupted after its fork re-derives the same fork and restarts the follower", async (context) => {
    const world = await createSupervisorWorld(context, "runtime-attempt-crash");
    world.store.close();
    using store = new AttemptCrashStore(world.databasePath);
    const adapter = reopenSupervisorWorld(world.workspaceRoot, store, world.parent.scope_id);
    const scenario = crashWorkers(false);
    const commandId = "application:runtime:attempt-crash";
    const hold = gate();
    const workers = scenario.workers.map((worker) =>
        worker.workerId === "a"
            ? {
                  ...worker,
                  model: {
                      converse: async (
                          ...args: Parameters<typeof worker.model.converse>
                      ): ReturnType<typeof worker.model.converse> => {
                          if (scenario.requests.a.length === 1) {
                              await hold.wait(args[1]);
                          }
                          return worker.model.converse(...args);
                      },
                  },
              }
            : worker,
    );
    const clock = ticker();
    const options = {
        clock: () => 3_000,
        commandId,
        policy: scriptedPolicy([{ decisions: [CRASH_DECISIONS[1]] }]),
        protocol: runtimeProtocol(),
        supervisorId: "supervisor:runtime",
        wait: clock.wait,
        workers,
        world: adapter,
    };
    const running = runRuntimeSupervisor(store, options);
    await until(
        () => scenario.requests.a.length === 1 && scenario.requests.b.length === 2,
        "both mid-turn",
    );
    await clock.advance();
    await assert.rejects(running, /process died before the attempt record/u);
    const applicationId = deriveApplicationOwnerId(commandId);
    const leaderScope = () =>
        inspectScope(store, world.parent.scope_id)?.children.map((scopeId) => [
            scopeId,
            inspectScope(store, scopeId)?.children.length,
        ]);
    const forkedBefore = leaderScope();
    assert.equal(inspectRuntimeSupervisorRun(store, applicationId).workers[1]?.attempts.length, 1);
    hold.open();
    clock.release();
    const receipt = await runRuntimeSupervisor(store, {
        ...options,
        policy: ({ tick }) => {
            assert.notEqual(tick, 1);
            return { output: { decisions: [] }, usage: null };
        },
    });
    // The retained fork was replayed: no second nested fork exists under the leader's scope.
    assert.deepEqual(leaderScope(), forkedBefore);
    const [, follower] = receipt.inspection.workers;
    assert.equal(follower?.attempts[1]?.cause, "handoff");
    assert.equal(follower?.attempts[0]?.completion?.status, "aborted");
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
        if (line !== undefined && output.includes(`${line}\n`)) {
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
