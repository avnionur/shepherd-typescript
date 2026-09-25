import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { canonicalizeSemanticValue } from "../../src/canonical/canonical-record.ts";

import {
    ApplicationBudgetError,
    ApplicationEvidenceError,
    ApplicationProtocolError,
    compileJSONSchema,
    deriveApplicationOwnerId,
    inspectRuntimeSupervisorRun,
    type ModelMessage,
    type RuntimeSupervisorDecision,
    runRuntimeSupervisor,
    type SemanticValue,
} from "../../src/index.ts";
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
import { createSupervisorWorld, readParentFile } from "./world-adapter-fixture.ts";

const LEAD = "supervisor:runtime";

function bytes(messages: readonly ModelMessage[]): string {
    return canonicalizeSemanticValue(messages as unknown as SemanticValue);
}

function streamLength(store: { readOwner: (owner: string) => readonly unknown[] }, id: string) {
    return store.readOwner(id).length;
}

test("workers run concurrently and an inject reaches a running worker between turns without breaking its prefix", async (context) => {
    const world = await createSupervisorWorld(context, "runtime-inject");
    const { store } = world;
    const bothStarted = { a: false, b: false };
    const release = gate();
    const barrier = async (self: "a" | "b", signal: AbortSignal) => {
        bothStarted[self] = true;
        // Deadlocks, and times out, unless the other worker is running at the same time.
        await until(() => bothStarted.a && bothStarted.b, "both workers in flight");
        signal.throwIfAborted();
    };
    const a = scriptedWorker("model:a", [
        [
            async (_request, signal) => {
                await barrier("a", signal);
                return [use("a1", "write_file", { path: "a.txt", text: "a1" })];
            },
            async (_request, signal) => {
                await release.wait(signal);
                return [use("a2", "write_file", { path: "a.txt", text: "a2" })];
            },
            () => [say("a done")],
        ],
    ]);
    const b = scriptedWorker("model:b", [
        [
            async (_request, signal) => {
                await barrier("b", signal);
                return [use("b1", "write_file", { path: "b.txt", text: "b1" })];
            },
            () => [say("b done")],
        ],
    ]);
    const inject: RuntimeSupervisorDecision = {
        action: "inject",
        agent: "a",
        guidance: "Agent b owns b.txt; keep your edits in a.txt.",
        reason: "prevent overlap",
    };
    const policy = scriptedPolicy([{ decisions: [inject] }]);
    const clock = ticker();
    const protocol = runtimeProtocol({ tickIntervalMilliseconds: 250 });
    const applicationId = deriveApplicationOwnerId("application:runtime:inject");
    const running = runRuntimeSupervisor(store, {
        clock: () => 3_000,
        commandId: "application:runtime:inject",
        policy,
        protocol,
        supervisorId: LEAD,
        wait: clock.wait,
        workers: [runtimeWorker("a", a.model), runtimeWorker("b", b.model)],
        world: world.adapter,
    });
    // Tick 1 fires once both workers retained their first turn and worker a is mid-turn.
    await until(() => a.requests.length === 2 && b.requests.length === 2, "second requests");
    await clock.advance();
    await until(() => policy.contexts.length === 1, "tick 1");
    const [first] = policy.contexts;
    assert.equal(first?.tick, 1);
    assert.deepEqual(
        first?.snapshot.agents.map((agent) => [agent.agent, agent.attempt, agent.events]),
        [
            ["a", 1, 1],
            ["b", 1, 1],
        ],
    );
    assert.equal(first?.snapshot.agents[0]?.status, "running");
    assert.deepEqual(first?.snapshot.agents[0]?.trailing_tool_calls, [
        { error: null, status: "materialized", target: "a.txt", tool: "write_file" },
    ]);
    assert.deepEqual(first?.snapshot.agents[0]?.modified_files, ["a.txt"]);
    // The worker is still running its second turn: the guidance joins its next user message.
    release.open();
    await until(() => a.requests.length === 3 && b.requests.length === 2, "third request of a");
    await until(
        () =>
            inspectRuntimeSupervisorRun(store, applicationId).workers.every(
                (worker) => worker.attempts[0]?.completion !== null,
            ),
        "both workers complete",
    );
    clock.release();
    const receipt = await running;
    assert.deepEqual(clock.cadences.slice(0, 2), [250, 250]);
    const [, second, third] = a.requests as [
        unknown,
        NonNullable<(typeof a.requests)[1]>,
        NonNullable<(typeof a.requests)[2]>,
    ];
    // Prefix identity: the third request extends the second byte for byte.
    const prefix = [...second.messages, third.messages[second.messages.length] as ModelMessage];
    assert.equal(bytes(third.messages.slice(0, prefix.length)), bytes(prefix));
    assert.equal(third.cachePrefixMessages, third.messages.length);
    assert.equal(third.system, second.system);
    const last = third.messages.at(-1) as ModelMessage;
    assert.deepEqual(last.content.at(-1), { text: inject.guidance, type: "text" });
    assert.equal(last.content[0]?.type, "tool_result");
    const inspection = receipt.inspection;
    const turns = inspection.workers[0]?.attempts[0]?.turns ?? [];
    assert.deepEqual(
        turns.map((turn) => turn.guidance_ticks),
        [[], [1], []],
    );
    assert.equal(turns[1]?.results?.content.at(-1)?.type, "text");
    assert.equal(inspection.ticks[0]?.refusal, null);
    assert.deepEqual(inspection.ticks[0]?.decisions, [inject]);
    assert.equal(inspection.settlement?.undelivered.length, 0);
    assert.deepEqual(
        inspection.settlement?.workers.map((worker) => [worker.worker_id, worker.status]),
        [
            ["a", "completed"],
            ["b", "completed"],
        ],
    );
    assert.equal(receipt.manifest.kind, "coding_supervisor");
    assert.equal(receipt.manifest.costs.provider_calls, 5);
    assert.equal(
        readFileSync(path.join(receipt.custody[0]?.custody.root as string, "a.txt"), "utf8"),
        "a2",
    );
    assert.equal(store.verifyIntegrity().ok, true);
    // Every retained record satisfies the published runtime supervision record schema.
    const {
        $id: _id,
        $schema: _dialect,
        ...published
    } = JSON.parse(
        readFileSync(
            new URL(
                "../../spec/schemas/application-runtime-supervision-v1.schema.json",
                import.meta.url,
            ),
            "utf8",
        ),
    ) as Record<string, unknown>;
    const recordSchema = compileJSONSchema(published);
    const owners = [applicationId, ...inspection.workers.map((worker) => worker.stream_id)];
    const retained = owners.flatMap((owner) =>
        store
            .readOwner(owner)
            .filter(
                (record) =>
                    record.envelope.schema_ref === "shepherd.application.runtime_supervision.v1",
            ),
    );
    assert.equal(retained.length, 1 + 2 + 1 + 5 + 2 + 2);
    for (const record of retained) {
        assert.deepEqual(recordSchema.validate(record.body), []);
    }
    // A repeat returns the retained manifest without consulting the policy or any worker.
    const repeated = await runRuntimeSupervisor(store, {
        clock: () => 3_000,
        commandId: "application:runtime:inject",
        policy: () => {
            throw new Error("the settled run must not consult the policy");
        },
        protocol,
        supervisorId: LEAD,
        workers: [runtimeWorker("a", a.model), runtimeWorker("b", b.model)],
        world: world.adapter,
    });
    assert.deepEqual(repeated.manifest, receipt.manifest);
    assert.equal(a.requests.length, 3);
    assert.equal(
        streamLength(store, inspection.workers[0]?.stream_id as string),
        streamLength(store, inspection.workers[0]?.stream_id as string),
    );
    await assert.rejects(
        runRuntimeSupervisor(store, {
            commandId: "application:runtime:inject",
            policy,
            protocol,
            supervisorId: "supervisor:other",
            workers: [runtimeWorker("a", a.model), runtimeWorker("b", b.model)],
            world: world.adapter,
        }),
        ApplicationEvidenceError,
    );
    await assert.rejects(
        runRuntimeSupervisor(store, {
            commandId: "application:runtime:inject",
            policy,
            protocol: runtimeProtocol({ maxTicks: 9 }),
            supervisorId: LEAD,
            workers: [runtimeWorker("a", a.model), runtimeWorker("b", b.model)],
            world: world.adapter,
        }),
        ApplicationProtocolError,
    );
});

test("a cross-agent handoff forks the leader's custody as the follower's new root and restarts it with guidance", async (context) => {
    const world = await createSupervisorWorld(context, "runtime-handoff");
    const { store } = world;
    const leaderGate = gate();
    const a = scriptedWorker("model:a", [
        [
            () => [use("a1", "write_file", { path: "lead.txt", text: "leader tree" })],
            async (_request, signal) => {
                await leaderGate.wait(signal);
                return [say("a done")];
            },
        ],
    ]);
    const stuck = gate();
    const b = scriptedWorker("model:b", [
        [
            () => [use("b1", "write_file", { path: "b.txt", text: "stale" })],
            async (_request, signal) => {
                await stuck.wait(signal);
                return [say("never")];
            },
        ],
        [
            (request) => {
                assert.equal(request.messages.length, 1);
                return [use("b2", "read_file", { path: "lead.txt" })];
            },
            () => [use("b3", "write_file", { path: "follow.txt", text: "built on lead" })],
            () => [say("b done")],
        ],
    ]);
    const handoff: RuntimeSupervisorDecision = {
        action: "handoff",
        agent: "b",
        guidance: "Restart from a's tree and build on lead.txt.",
        leader: "a",
        reason: "b is stuck",
    };
    const policy = scriptedPolicy([{ decisions: [handoff] }]);
    const clock = ticker();
    const applicationId = deriveApplicationOwnerId("application:runtime:handoff");
    const running = runRuntimeSupervisor(store, {
        clock: () => 3_000,
        commandId: "application:runtime:handoff",
        policy,
        protocol: runtimeProtocol(),
        supervisorId: LEAD,
        wait: clock.wait,
        workers: [runtimeWorker("a", a.model), runtimeWorker("b", b.model)],
        world: world.adapter,
    });
    await until(() => a.requests.length === 2 && b.requests.length === 2, "both mid-turn");
    await clock.advance();
    await until(() => b.requests.length === 5, "restarted follower finishes");
    const [restart] = b.requests.slice(2);
    assert.deepEqual(restart?.messages, [
        {
            content: [
                { text: "Implement feature b.", type: "text" },
                { text: handoff.guidance, type: "text" },
            ],
            role: "user",
        },
    ]);
    // The follower read the leader's file from its new root.
    const readResult = firstToolResult(b.requests[3]);
    assert.equal(readResult.result.value, "leader tree");
    // Tick 2 observes the follower's second attempt and the action it took one tick ago.
    await clock.advance();
    await until(() => policy.contexts.length === 2, "tick 2");
    const follower = policy.contexts[1]?.snapshot.agents[1];
    assert.equal(follower?.attempt, 2);
    assert.deepEqual(follower?.last_action, { action: "handoff", ticks_ago: 1 });
    assert.deepEqual(follower?.modified_files, ["follow.txt", "lead.txt"]);
    leaderGate.open();
    await until(
        () =>
            inspectRuntimeSupervisorRun(store, applicationId).workers[0]?.attempts[0]
                ?.completion !== null,
        "leader completes",
    );
    clock.release();
    const receipt = await running;
    const [leader, followed] = receipt.inspection.workers;
    const [stale, restarted] = followed?.attempts ?? [];
    assert.equal(stale?.completion?.status, "aborted");
    assert.deepEqual(stale?.completion?.cause, { action: "handoff", tick: 1 });
    assert.equal(restarted?.cause, "handoff");
    assert.equal(restarted?.leader, "a");
    assert.equal(restarted?.tick, 1);
    assert.equal(restarted?.guidance, handoff.guidance);
    assert.equal(restarted?.custody.source_custody_id, leader?.attempts[0]?.custody.custody_id);
    const root = receipt.custody[1]?.custody.root as string;
    assert.equal(readFileSync(path.join(root, "lead.txt"), "utf8"), "leader tree");
    assert.equal(readFileSync(path.join(root, "follow.txt"), "utf8"), "built on lead");
    assert.equal(existsSync(path.join(root, "b.txt")), false);
    // The follower's abandoned custody is discarded; the leader's is kept as the new root's origin.
    assert.deepEqual(receipt.inspection.settlement?.discard_custody_ids, [
        stale?.custody.custody_id,
    ]);
    assert.equal(
        receipt.manifest.artifacts.filter((artifact) => artifact.role === "world_discard").length,
        1,
    );
    assert.equal(store.verifyIntegrity().ok, true);
});

test("a follower's final custody lands in the parent world without the leader's discarded post-fork writes", async (context) => {
    const world = await createSupervisorWorld(context, "runtime-follower-landing");
    const { store } = world;
    const afterFork = gate();
    const a = scriptedWorker("model:a", [
        [
            () => [use("a1", "write_file", { path: "lead.txt", text: "leader tree" })],
            async (_request, signal) => {
                await afterFork.wait(signal);
                return [use("a2", "write_file", { path: "post.txt", text: "leader after fork" })];
            },
            async (_request, signal) => {
                await gate().wait(signal);
                return [say("never")];
            },
        ],
        [() => [say("a restarted")]],
    ]);
    const b = scriptedWorker("model:b", [
        [
            () => [use("b1", "write_file", { path: "b.txt", text: "stale" })],
            async (_request, signal) => {
                await gate().wait(signal);
                return [say("never")];
            },
        ],
        [
            () => [use("b2", "write_file", { path: "follow.txt", text: "built on lead" })],
            () => [say("b done")],
        ],
    ]);
    const policy = scriptedPolicy([
        {
            decisions: [
                {
                    action: "handoff",
                    agent: "b",
                    guidance: "Restart from a's tree.",
                    leader: "a",
                    reason: "b is stuck",
                },
            ],
        },
        { decisions: [{ action: "discard", agent: "a", reason: "a corrupted its tree" }] },
    ]);
    const clock = ticker();
    const running = runRuntimeSupervisor(store, {
        clock: () => 3_000,
        commandId: "application:runtime:follower-landing",
        policy,
        protocol: runtimeProtocol(),
        supervisorId: LEAD,
        wait: clock.wait,
        workers: [runtimeWorker("a", a.model), runtimeWorker("b", b.model)],
        world: world.adapter,
    });
    await until(() => a.requests.length === 2 && b.requests.length === 2, "both mid-turn");
    await clock.advance();
    await until(() => b.requests.length === 4, "restarted follower finishes");
    afterFork.open();
    await until(() => a.requests.length === 3, "leader wrote after the fork");
    await clock.advance();
    await until(() => a.requests.length === 4, "leader restarted");
    clock.release();
    const receipt = await running;
    const [leader, follower] = receipt.inspection.workers;
    const leaderRoot = leader?.attempts[0]?.custody.custody_id;
    // The leader's first custody stays open only as the follower's origin.
    assert.equal(follower?.attempts[1]?.custody.source_custody_id, leaderRoot);
    assert.equal(
        receipt.inspection.settlement?.discard_custody_ids.includes(leaderRoot as string),
        false,
    );
    const final = receipt.custody[1]?.custody as { readonly custody_id: string };
    await world.adapter.merge({
        commandId: "application:runtime:follower-landing:merge",
        custodyId: final.custody_id,
        nowMilliseconds: 4_000,
        workerId: "b",
    });
    assert.equal(await readParentFile(world, "lead.txt"), "leader tree");
    assert.equal(await readParentFile(world, "follow.txt"), "built on lead");
    await assert.rejects(readParentFile(world, "post.txt"), { code: "ENOENT" });
    await assert.rejects(readParentFile(world, "b.txt"), { code: "ENOENT" });
    // The abandoned leader lineage is then discarded as a whole.
    await world.adapter.discard({
        commandId: "application:runtime:follower-landing:discard",
        custodyId: leaderRoot as string,
        nowMilliseconds: 4_100,
        workerId: "a",
    });
    assert.equal(store.verifyIntegrity().ok, true);
});

test("discard restarts from a clean fork and a handoff without a leader keeps the custody", async (context) => {
    const world = await createSupervisorWorld(context, "runtime-discard");
    const { store } = world;
    const hold = { a: gate(), b: gate() };
    const a = scriptedWorker("model:a", [
        [
            () => [use("a1", "write_file", { path: "broken.txt", text: "garbage" })],
            async (_request, signal) => {
                await hold.a.wait(signal);
                return [say("never")];
            },
        ],
        [
            (request) => {
                assert.equal(request.messages.length, 1);
                return [use("a2", "read_file", { path: "broken.txt" })];
            },
            () => [say("a done")],
        ],
    ]);
    const b = scriptedWorker("model:b", [
        [
            () => [use("b1", "write_file", { path: "kept.txt", text: "kept" })],
            async (_request, signal) => {
                await hold.b.wait(signal);
                return [say("never")];
            },
        ],
        [() => [use("b2", "read_file", { path: "kept.txt" })], () => [say("b done")]],
    ]);
    const policy = scriptedPolicy([
        {
            decisions: [
                { action: "discard", agent: "a", reason: "corrupted the repository" },
                {
                    action: "handoff",
                    agent: "b",
                    guidance: "Re-read the task and finish.",
                    reason: "confused",
                },
            ],
        },
    ]);
    const clock = ticker();
    const running = runRuntimeSupervisor(store, {
        clock: () => 3_000,
        commandId: "application:runtime:discard",
        policy,
        protocol: runtimeProtocol(),
        supervisorId: LEAD,
        wait: clock.wait,
        workers: [runtimeWorker("a", a.model), runtimeWorker("b", b.model)],
        world: world.adapter,
    });
    await until(() => a.requests.length === 2 && b.requests.length === 2, "both mid-turn");
    await clock.advance();
    await until(() => a.requests.length === 4 && b.requests.length === 4, "both restarted");
    clock.release();
    const receipt = await running;
    const readOf = firstToolResult;
    // Discard rolled worker a back to the pre-run world; the handoff kept worker b's files.
    assert.equal(readOf(a.requests[3]).result.ok, false);
    assert.equal(readOf(b.requests[3]).result.ok, true);
    const [first, second] = receipt.inspection.workers;
    assert.equal(first?.attempts[1]?.cause, "discard");
    assert.notEqual(first?.attempts[1]?.custody.custody_id, first?.attempts[0]?.custody.custody_id);
    assert.equal(first?.attempts[1]?.custody.source_custody_id, null);
    assert.equal(second?.attempts[1]?.cause, "handoff");
    assert.equal(second?.attempts[1]?.custody.custody_id, second?.attempts[0]?.custody.custody_id);
    assert.deepEqual(receipt.inspection.settlement?.discard_custody_ids, [
        first?.attempts[0]?.custody.custody_id,
    ]);
    // A repeat re-derives the kept handoff custody and skips the discarded one.
    const repeated = await runRuntimeSupervisor(store, {
        clock: () => 3_000,
        commandId: "application:runtime:discard",
        policy: () => {
            throw new Error("the settled run must not consult the policy");
        },
        protocol: runtimeProtocol(),
        supervisorId: LEAD,
        workers: [runtimeWorker("a", a.model), runtimeWorker("b", b.model)],
        world: world.adapter,
    });
    assert.deepEqual(repeated.custody, receipt.custody);
});

test("per-agent batched decisions are validated against the Appendix E schema and refused as a whole", async (context) => {
    const world = await createSupervisorWorld(context, "runtime-refusal");
    const { store } = world;
    const hold = gate();
    const long = "word ".repeat(61).trim();
    const outputs: readonly unknown[] = [
        { decisions: [{ action: "none", agent: "z", reason: "unknown agent" }] },
        { decisions: [{ action: "inject", agent: "a" }] },
        { decisions: [{ action: "discard", agent: "a", guidance: "no", reason: "r" }] },
        { decisions: [{ action: "inject", agent: "a", reason: "missing guidance" }] },
        { decisions: [{ action: "inject", agent: "a", guidance: long, reason: "long" }] },
        {
            decisions: [
                { action: "none", agent: "a", reason: "first" },
                { action: "none", agent: "a", reason: "again" },
            ],
        },
        { decisions: [{ action: "inject", agent: "a", guidance: "g", leader: "b", reason: "r" }] },
        {
            decisions: [
                { action: "handoff", agent: "a", leader: "b", reason: "follow b" },
                { action: "discard", agent: "b", reason: "and discard the leader" },
            ],
        },
        "not json",
        { decisions: [{ action: "handoff", agent: "a", leader: "a", reason: "self" }] },
        { decisions: [{ action: "none", agent: "b", reason: "fine" }], extra: true },
        { decisions: [{ action: "none", agent: "b", reason: "word ".repeat(21).trim() }] },
        { decisions: [Number.NaN] },
        { decisions: [{ action: "inject", agent: "b", guidance: "too late", reason: "done" }] },
    ];
    const policy = scriptedPolicy(outputs);
    const a = scriptedWorker("model:a", [
        [
            () => [
                use("a1", "read_file", { path: "missing-1.txt" }),
                use("a2", "read_file", { path: "missing-2.txt" }),
                use("a3", "write_file", { path: "", text: "invalid input" }),
            ],
            async (_request, signal) => {
                await hold.wait(signal);
                return [say("a done")];
            },
        ],
    ]);
    const b = scriptedWorker("model:b", [[() => [say("b done")]]]);
    const clock = ticker();
    const running = runRuntimeSupervisor(store, {
        clock: () => 3_000,
        commandId: "application:runtime:refusal",
        policy,
        protocol: runtimeProtocol({ maxFeatureCharacters: 12, maxToolCallSummaryBytes: 90 }),
        supervisorId: LEAD,
        wait: clock.wait,
        workers: [
            runtimeWorker("a", a.model, "Implement the whole feature a with care."),
            runtimeWorker("b", b.model),
        ],
        world: world.adapter,
    });
    await until(() => a.requests.length === 2 && b.requests.length === 1, "first turns");
    await until(
        () =>
            inspectRuntimeSupervisorRun(
                store,
                deriveApplicationOwnerId("application:runtime:refusal"),
            ).workers[1]?.attempts[0]?.completion !== null,
        "worker b completes",
    );
    clock.release();
    await until(() => policy.contexts.length >= outputs.length, "every scripted tick");
    hold.open();
    const receipt = await running;
    const ticks = receipt.inspection.ticks.slice(0, outputs.length);
    assert.deepEqual(
        ticks.map((tick) => [tick.decisions.length, tick.refusal === null]),
        [...Array.from({ length: outputs.length - 1 }, () => [0, false]), [1, true]],
    );
    assert.match(ticks[0]?.refusal?.issues[0] ?? "", /names no worker/u);
    assert.match(ticks[1]?.refusal?.issues.join(" ") ?? "", /reason/u);
    assert.match(ticks[2]?.refusal?.issues[0] ?? "", /allowed only for inject and handoff/u);
    assert.match(ticks[3]?.refusal?.issues[0] ?? "", /required for inject/u);
    assert.match(ticks[4]?.refusal?.issues[0] ?? "", /exceeds 60 words/u);
    assert.match(ticks[5]?.refusal?.issues[0] ?? "", /already decided/u);
    assert.match(ticks[6]?.refusal?.issues[0] ?? "", /allowed only for handoff/u);
    assert.match(ticks[7]?.refusal?.issues[0] ?? "", /itself handed off or discarded/u);
    assert.equal(ticks[8]?.output, "not json");
    assert.match(ticks[9]?.refusal?.issues[0] ?? "", /another worker/u);
    assert.match(ticks[10]?.refusal?.issues[0] ?? "", /extra/u);
    assert.match(ticks[11]?.refusal?.issues[0] ?? "", /exceeds 20 words/u);
    assert.equal(ticks[12]?.output, null);
    assert.match(ticks[12]?.refusal?.issues[0] ?? "", /not canonical JSON/u);
    // An inject naming a worker that already finished is admitted but never delivered.
    assert.deepEqual(receipt.inspection.settlement?.undelivered, [
        { tick: outputs.length, worker_id: "b" },
    ]);
    // No refused decision was applied: both workers kept their first attempt.
    assert.deepEqual(
        receipt.inspection.workers.map((worker) => worker.attempts.length),
        [1, 1],
    );
    // The snapshot carries the paper's per-agent fields, bounded by the protocol.
    const agent = policy.contexts[0]?.snapshot.agents[0];
    assert.equal(agent?.feature, "Implement...");
    assert.equal(agent?.events, 3);
    assert.equal(agent?.consecutive_errors, 3);
    assert.deepEqual(
        agent?.trailing_tool_calls.map((call) => [call.tool, call.status, call.target]),
        [
            ["read_file", "materialized", "missing-1.txt"],
            ["read_file", "materialized", "missing-2.txt"],
            ["write_file", "invalid", null],
        ],
    );
    for (const call of agent?.trailing_tool_calls ?? []) {
        assert.ok(Buffer.byteLength(canonicalizeSemanticValue(call as never)) <= 90);
    }
    assert.match(agent?.trailing_tool_calls[0]?.error ?? "", /^\{"r.*\.\.\.$/u);
    assert.equal(agent?.last_action, null);
    assert.equal(policy.contexts[0]?.snapshot.agents[1]?.status, "completed");
});

test("tick and provider-call budgets fail closed after aborting every running worker", async (context) => {
    const world = await createSupervisorWorld(context, "runtime-budget");
    const { store } = world;
    const hold = gate();
    const forever = scriptedWorker("model:forever", [
        [
            () => [use("f1", "write_file", { path: "f.txt", text: "f" })],
            async (_request, signal) => {
                await hold.wait(signal);
                return [say("never")];
            },
        ],
    ]);
    const quick = scriptedWorker("model:quick", [[() => [say("done")]]]);
    const clock = ticker();
    clock.release();
    const commandId = "application:runtime:budget";
    await assert.rejects(
        runRuntimeSupervisor(store, {
            clock: () => 3_000,
            commandId,
            policy: scriptedPolicy([]),
            protocol: runtimeProtocol({ maxTicks: 3 }),
            supervisorId: LEAD,
            wait: clock.wait,
            workers: [runtimeWorker("a", forever.model), runtimeWorker("b", quick.model)],
            world: world.adapter,
        }),
        ApplicationBudgetError,
    );
    const inspection = inspectRuntimeSupervisorRun(store, deriveApplicationOwnerId(commandId));
    assert.equal(inspection.ticks.length, 3);
    assert.equal(inspection.manifest, null);
    // The aborted worker is left open, exactly as after a crash, so a rerun can resume it.
    assert.equal(inspection.workers[0]?.attempts[0]?.completion, null);
    const calls = scriptedWorker("model:calls", [
        [
            () => [use("c1", "write_file", { path: "c.txt", text: "1" })],
            () => [use("c2", "write_file", { path: "c.txt", text: "2" })],
            () => [say("done")],
        ],
    ]);
    await assert.rejects(
        runRuntimeSupervisor(store, {
            clock: () => 3_000,
            commandId: "application:runtime:calls",
            policy: scriptedPolicy([]),
            protocol: runtimeProtocol({ maxProviderCalls: 2 }),
            supervisorId: LEAD,
            wait: clock.wait,
            workers: [runtimeWorker("a", calls.model), runtimeWorker("b", quick.model)],
            world: world.adapter,
        }),
        ApplicationBudgetError,
    );
    // A worker whose own provider call exhausts the budget is aborted with the run, not failed:
    // its attempt stays open for a rerun, exactly like the tick budget above.
    const exhausted = inspectRuntimeSupervisorRun(
        store,
        deriveApplicationOwnerId("application:runtime:calls"),
    );
    assert.equal(exhausted.manifest, null);
    assert.equal(exhausted.workers[0]?.attempts[0]?.completion, null);
});
