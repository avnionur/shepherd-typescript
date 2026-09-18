import assert from "node:assert/strict";
import { test } from "node:test";

import { createApplicationAppendIntentId } from "../../src/applications/records.ts";
import {
    ApplicationEvidenceError,
    ApplicationProtocolError,
    type ApplicationWorldAdapter,
    type CodingSupervisorDecision,
    type CodingSupervisorPolicy,
    type CodingSupervisorWorkerDefinition,
    createScopeWorldAdapter,
    deriveApplicationOwnerId,
    inspectCodingSupervisorRun,
    inspectScope,
    type RecordId,
    runCodingSupervisor,
    SQLiteTraceStore,
    type StoreAppendRequest,
} from "../../src/index.ts";
import { bindingGrant } from "../scope/fork-fixtures.ts";
import { appendOwnerRecord } from "../supervision/fixtures.ts";
import {
    echoEdit,
    LEAD,
    outputPaths,
    rootParent,
    supervisionProtocol,
    temporaryDatabasePath,
    workerOf,
} from "./fixtures.ts";
import { createSupervisorWorld, writeCustodyEdit } from "./world-adapter-fixture.ts";

const NEXT = "supervisor:next";

/** Store whose next append under one intent crashes after the decision was applied. */
class CrashingStore extends SQLiteTraceStore {
    crashIntent: string | null = null;

    override appendApplicationRecord(
        applicationId: string,
        expectedHeadRecordId: RecordId | null,
        request: StoreAppendRequest,
        cutId: string | null,
    ) {
        if (request.append_intent_id === this.crashIntent) {
            this.crashIntent = null;
            throw new Error("process died before the decision record");
        }
        return super.appendApplicationRecord(applicationId, expectedHeadRecordId, request, cutId);
    }
}

/** Counts worker program executions across runs. */
function countingWorkers(): {
    readonly invoked: () => number;
    readonly workers: readonly CodingSupervisorWorkerDefinition[];
} {
    let invoked = 0;
    const program: typeof echoEdit = (context) => {
        invoked += 1;
        return echoEdit(context);
    };
    return {
        invoked: () => invoked,
        workers: [workerOf("a", program), workerOf("b", program)],
    };
}

/** Policy that returns the scripted decisions in round order and then throws. */
function interruptedAfter(decisions: readonly CodingSupervisorDecision[]): CodingSupervisorPolicy {
    return ({ round }) => {
        const decision = decisions[round - 1];
        if (decision === undefined) {
            throw new Error(`interrupted at round ${round}`);
        }
        return decision;
    };
}

/** In-memory world adapter counting forks, with deterministic custody and receipt identities. */
function countingWorld(): ApplicationWorldAdapter & { readonly calls: string[] } {
    const calls: string[] = [];
    const custodies = new Map<string, string>();
    return {
        calls,
        changedPaths: async (custodyId) => {
            calls.push(`paths ${custodies.get(custodyId)}`);
            return [`src/${custodies.get(custodyId)}.ts`];
        },
        discard: async ({ commandId }) => ({ receipt_id: `receipt:discard:${commandId}` }),
        fork: async ({ commandId, workerId }) => {
            calls.push(`fork ${workerId}`);
            custodies.set(`custody:${commandId}`, workerId);
            return {
                custody_id: `custody:${commandId}`,
                receipt_id: `receipt:fork:${commandId}`,
                root: "/dev/null",
            };
        },
        merge: async ({ commandId }) => ({ receipt_id: `receipt:merge:${commandId}` }),
    };
}

for (const [label, script] of [
    [
        "inject, handoff, restart",
        (cited: RecordId): readonly CodingSupervisorDecision[] => [
            { cited_record_ids: [cited], data: { hint: "short" }, kind: "inject", worker_id: "a" },
            { kind: "handoff", reason: "rotate", successor_supervisor_id: NEXT, worker_id: "a" },
            { kind: "discard_restart", reason: "restart a", worker_id: "a" },
        ],
    ],
    [
        "handoff, restart",
        (): readonly CodingSupervisorDecision[] => [
            { kind: "handoff", reason: null, successor_supervisor_id: NEXT, worker_id: "a" },
            { kind: "discard_restart", reason: "restart a", worker_id: "a" },
        ],
    ],
    [
        "restart, handoff, inject",
        (cited: RecordId): readonly CodingSupervisorDecision[] => [
            { kind: "discard_restart", reason: "restart a", worker_id: "a" },
            { kind: "handoff", reason: null, successor_supervisor_id: NEXT, worker_id: "a" },
            { cited_record_ids: [cited], data: { hint: "late" }, kind: "inject", worker_id: "a" },
        ],
    ],
] as const) {
    test(`an interrupted run retaining ${label} resumes without re-executing a worker`, async (context) => {
        const databasePath = await temporaryDatabasePath(context, "resume-handoff");
        using store = new SQLiteTraceStore(databasePath);
        const cited = appendOwnerRecord(store, "worker:notes", "n0") as RecordId;
        const decisions = script(cited);
        const { invoked, workers } = countingWorkers();
        const commandId = `application:resume:${label}`;
        const run = (policy: CodingSupervisorPolicy) =>
            runCodingSupervisor(store, {
                changedPaths: outputPaths,
                commandId,
                parent: rootParent(),
                policy,
                protocol: supervisionProtocol(),
                supervisorId: LEAD,
                workers,
            });
        await assert.rejects(run(interruptedAfter(decisions)), /interrupted at round/u);
        const applicationId = deriveApplicationOwnerId(commandId);
        assert.equal(
            inspectCodingSupervisorRun(store, applicationId).decisions.length,
            decisions.length,
        );
        const executed = invoked();
        const before = store.verifyIntegrity().checked_record_count;
        const rounds: number[] = [];
        const resumed = await run(({ round }) => {
            rounds.push(round);
            return { kind: "accept", worker_id: "a" };
        });
        assert.deepEqual(rounds, [decisions.length + 1]);
        assert.equal(invoked(), executed);
        assert.deepEqual(
            resumed.inspection.decisions.map((decision) => decision.decision),
            [...decisions, { kind: "accept", worker_id: "a" }],
        );
        assert.deepEqual(
            resumed.inspection.workers.map((worker) =>
                worker.attempts.map((attempt) => attempt.status),
            ),
            [["restarted", "accepted"], ["discarded"]],
        );
        assert.equal(resumed.inspection.workers[0]?.attempts[1]?.inspection.supervisor_id, NEXT);
        assert.ok(store.verifyIntegrity().checked_record_count > before);
        const repeated = await run(() => {
            throw new Error("the retained run must not consult the policy");
        });
        assert.deepEqual(repeated.manifest, resumed.manifest);
        assert.deepEqual(repeated.inspection, resumed.inspection);
        assert.equal(invoked(), executed);
        assert.equal(store.verifyIntegrity().ok, true);
    });
}

test("a refused rerun writes no record and forks no custody", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "refused-rerun");
    using store = new SQLiteTraceStore(databasePath);
    const commandId = "application:refused";
    const options = (overrides: Record<string, unknown>) => ({
        commandId,
        parent: rootParent(),
        policy: interruptedAfter([{ kind: "observe" }]),
        protocol: supervisionProtocol(),
        supervisorId: LEAD,
        workers: [workerOf("a"), workerOf("b")],
        world: countingWorld(),
        ...overrides,
    });
    await assert.rejects(runCodingSupervisor(store, options({})), /interrupted at round 2/u);
    const before = store.verifyIntegrity().checked_record_count;
    for (const [overrides, refusal] of [
        [{ workers: [workerOf("a"), workerOf("c")] }, ApplicationEvidenceError],
        [{ workers: [workerOf("b"), workerOf("a")] }, ApplicationEvidenceError],
        [{ supervisorId: NEXT }, ApplicationEvidenceError],
        [{ changedPaths: outputPaths, world: undefined }, ApplicationEvidenceError],
        [
            { protocol: supervisionProtocol({ protocolVersion: "appendix-e.v2" }) },
            ApplicationProtocolError,
        ],
    ] as const) {
        const world = countingWorld();
        await assert.rejects(runCodingSupervisor(store, options({ world, ...overrides })), refusal);
        assert.deepEqual(world.calls, []);
        assert.equal(store.verifyIntegrity().checked_record_count, before);
    }
    const resumed = await runCodingSupervisor(
        store,
        options({ policy: () => ({ kind: "accept", worker_id: "a" }) }),
    );
    assert.deepEqual(
        resumed.inspection.decisions.map((decision) => decision.decision.kind),
        ["observe", "accept"],
    );
});

for (const [label, decision, world] of [
    [
        "inject",
        (cited: RecordId): CodingSupervisorDecision => ({
            cited_record_ids: [cited],
            data: { hint: "short" },
            kind: "inject",
            worker_id: "b",
        }),
        true,
    ],
    [
        "handoff",
        (): CodingSupervisorDecision => ({
            kind: "handoff",
            reason: "rotate",
            successor_supervisor_id: NEXT,
            worker_id: "b",
        }),
        false,
    ],
    [
        "discard_restart",
        (): CodingSupervisorDecision => ({
            kind: "discard_restart",
            reason: "restart b",
            worker_id: "b",
        }),
        true,
    ],
    ["accept", (): CodingSupervisorDecision => ({ kind: "accept", worker_id: "b" }), true],
] as const) {
    test(`a crash after an applied ${label} decision recovers the same decision without the policy`, async (context) => {
        const databasePath = await temporaryDatabasePath(context, `crash-${label}`);
        const store = new CrashingStore(databasePath);
        context.after(() => store.close());
        const cited = appendOwnerRecord(store, "worker:notes", "n0") as RecordId;
        const applied = decision(cited);
        const { invoked, workers } = countingWorkers();
        const commandId = `application:crash:${label}`;
        const run = (policy: CodingSupervisorPolicy) =>
            runCodingSupervisor(store, {
                commandId,
                parent: rootParent(),
                policy,
                protocol: supervisionProtocol(),
                supervisorId: LEAD,
                workers,
                ...(world ? { world: countingWorld() } : { changedPaths: outputPaths }),
            });
        const applicationId = deriveApplicationOwnerId(commandId);
        store.crashIntent = createApplicationAppendIntentId(applicationId, "decision:2");
        await assert.rejects(
            run(({ round }) => (round === 1 ? { kind: "observe" } : applied)),
            /process died/u,
        );
        assert.equal(inspectCodingSupervisorRun(store, applicationId).decisions.length, 1);
        const executed = invoked();
        const rounds: number[] = [];
        const recovered = await run(({ round }) => {
            rounds.push(round);
            assert.notEqual(round, 2, "the applied round must not consult the policy");
            return { kind: "accept", worker_id: "b" };
        });
        assert.deepEqual(rounds, applied.kind === "accept" ? [] : [3]);
        const [, second] = recovered.inspection.decisions;
        assert.deepEqual(second?.decision, applied);
        assert.equal(second?.round, 2);
        if (world && applied.kind === "accept") {
            // Custody the round already consumed is not read again.
            assert.deepEqual(
                second?.observations.map((observation) => observation.changed_paths),
                [[], []],
            );
        }
        if (world && applied.kind === "discard_restart") {
            assert.deepEqual(
                second?.observations.map((observation) => observation.changed_paths),
                [["src/a.ts"], []],
            );
        }
        assert.equal(invoked(), executed + (applied.kind === "discard_restart" ? 1 : 0));
        const repeated = await run(() => {
            throw new Error("the retained run must not consult the policy");
        });
        assert.deepEqual(repeated.manifest, recovered.manifest);
        assert.equal(store.verifyIntegrity().ok, true);
    });
}

test("a crash between a world fork and the child's durable start reuses the retained fork", async (context) => {
    const world = await createSupervisorWorld(context, "fork-crash");
    const { store } = world;
    const workers = ["a", "b"].map((workerId) =>
        workerOf(workerId, writeCustodyEdit, {
            grant: [bindingGrant(world.source)],
            input: { path: "file.txt", text: `${workerId} edit` },
        }),
    );
    const freshAdapter = () =>
        createScopeWorldAdapter({
            binding: world.source,
            carrier: world.carrier,
            grant: [bindingGrant(world.source)],
            parent: world.parentWriter,
            store,
        });
    const forks: string[] = [];
    const crashing = (crashWorker: string | null): ApplicationWorldAdapter => {
        const adapter = freshAdapter();
        return {
            ...adapter,
            fork: async (request) => {
                const custody = await adapter.fork(request);
                forks.push(custody.receipt_id);
                if (request.workerId === crashWorker) {
                    throw new Error("process died after the fork");
                }
                return custody;
            },
        };
    };
    const options = (adapter: ApplicationWorldAdapter, policy: CodingSupervisorPolicy) => ({
        clock: () => 2_000,
        commandId: "application:fork-crash",
        parent: rootParent({ ceiling: [bindingGrant(world.source)] }),
        policy,
        protocol: supervisionProtocol(),
        supervisorId: LEAD,
        workers,
        world: adapter,
    });
    const children = () => inspectScope(store, world.parent.scope_id)?.children ?? [];
    // Crash after b's fork, before b's handle is opened.
    await assert.rejects(
        runCodingSupervisor(store, options(crashing("b"), interruptedAfter([]))),
        /died after the fork/u,
    );
    assert.equal(children().length, 2);
    const applicationId = deriveApplicationOwnerId("application:fork-crash");
    assert.equal(store.readOwner(applicationId).length, 0);
    // Crash after both handles opened, before any worker's durable start.
    await assert.rejects(
        runCodingSupervisor(store, options(crashing(null), interruptedAfter([]))),
        /interrupted at round 1/u,
    );
    assert.equal(children().length, 2);
    const started = inspectCodingSupervisorRun(store, applicationId);
    assert.deepEqual(
        started.workers.map((worker) => worker.attempts[0]?.inspection.status),
        ["ready", "ready"],
    );
    const receipt = await runCodingSupervisor(
        store,
        options(crashing(null), ({ round }) =>
            round === 1 ? { kind: "observe" } : { kind: "accept", worker_id: "a" },
        ),
    );
    assert.equal(children().length, 2);
    assert.equal(new Set(forks).size, 2);
    assert.equal(
        receipt.manifest.artifacts.filter((artifact) => artifact.role === "world_fork").length,
        2,
    );
    assert.equal(store.verifyIntegrity().ok, true);
});
