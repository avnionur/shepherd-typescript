import assert from "node:assert/strict";
import { test } from "node:test";

import {
    ApplicationEvidenceError,
    ApplicationProtocolError,
    createModelRuntimeSupervisorPolicy,
    createProgramConversationProvider,
    deriveApplicationOwnerId,
    inspectRuntimeSupervisorRun,
    type RecordId,
    type RunRuntimeSupervisorOptions,
    readApplicationProtocol,
    runRuntimeSupervisor,
    SQLiteTraceStore,
    type StoreAppendRequest,
} from "../../src/index.ts";
import { researchApplications } from "./fixtures.ts";
import { reopenSupervisorWorld } from "./runtime-supervisor-crash-fixtures.ts";
import {
    gate,
    runtimeProtocol,
    runtimeWorker,
    say,
    scriptedPolicy,
    scriptedWorker,
    TURN_USAGE,
    ticker,
    until,
    use,
} from "./runtime-supervisor-fixtures.ts";
import { createSupervisorWorld } from "./world-adapter-fixture.ts";

const base = (researchApplications as unknown as Record<string, Record<string, unknown>>)
    .runtimeSupervision as Record<string, unknown> & {
    readonly budgets: Record<string, number>;
    readonly surfaces: readonly Record<string, unknown>[];
};

function quickWorkers() {
    const { system: _system, ...b } = runtimeWorker(
        "b",
        scriptedWorker("model:b", [[() => [say("b done")]]]).model,
    );
    return [runtimeWorker("a", scriptedWorker("model:a", [[() => [say("a done")]]]).model), b];
}

test("runtime supervision protocols, options, and workers are validated before any record", async (context) => {
    const world = await createSupervisorWorld(context, "runtime-options");
    const { store } = world;
    const model = createProgramConversationProvider({
        id: "model:meta",
        respond: () => ({
            message: { content: [say("{}")], role: "assistant" },
            output: "{}",
            stopReason: "end_turn",
            usage: TURN_USAGE,
        }),
    });
    const protocols: readonly Record<string, unknown>[] = [
        { ...base, kind: "tree_rl" },
        { ...base, surfaces: base.surfaces.filter((surface) => surface.role !== "action") },
        {
            ...base,
            surfaces: base.surfaces.map((surface) =>
                surface.kind === "prompt" && surface.role === "action"
                    ? { ...surface, content: { text: "not text" } }
                    : surface,
            ),
        },
        { ...base, budgets: { ...base.budgets, maxTicks: undefined } },
        { ...base, budgets: { ...base.budgets, maxTicks: 0 } },
        { ...base, budgets: { ...base.budgets, maxTicks: 1_000_000 } },
        { ...base, budgets: { ...base.budgets, maxTurnsPerWorker: 65 } },
    ];
    for (const protocol of protocols) {
        const budgets = JSON.parse(JSON.stringify(protocol.budgets)) as Record<string, number>;
        assert.throws(
            () =>
                createModelRuntimeSupervisorPolicy({
                    model,
                    protocol: { ...protocol, budgets } as never,
                }),
            ApplicationProtocolError,
        );
    }
    const options: RunRuntimeSupervisorOptions = {
        clock: () => 3_000,
        commandId: "application:runtime:options",
        policy: scriptedPolicy([]),
        protocol: runtimeProtocol(),
        supervisorId: "supervisor:runtime",
        workers: quickWorkers(),
        world: world.adapter,
    };
    const [workerA, workerB] = options.workers as [
        (typeof options.workers)[number],
        (typeof options.workers)[number],
    ];
    const malformed: readonly Record<string, unknown>[] = [
        { ...options, policy: "policy" },
        { ...options, signal: {} },
        { ...options, world: null },
        { ...options, world: { ...world.adapter, merge: 1 } },
        { ...options, workers: [workerA] },
        { ...options, workers: [workerA, workerA] },
        { ...options, workers: [workerA, { ...workerB, model: {} }] },
        { ...options, workers: [workerA, { ...workerB, tools: {} }] },
        { ...options, workers: [workerA, { ...workerB, system: "" }] },
        { ...options, workers: [workerA, { ...workerB, effects: {} }] },
    ];
    for (const value of malformed) {
        await assert.rejects(runRuntimeSupervisor(store, value as never), TypeError);
    }
    assert.throws(
        () => inspectRuntimeSupervisorRun(store, deriveApplicationOwnerId(options.commandId)),
        ApplicationEvidenceError,
    );
    // An effect factory without dispatch fails its attempt; the run still settles.
    const receipt = await runRuntimeSupervisor(store, {
        ...options,
        protocol: runtimeProtocol({ tickIntervalMilliseconds: 1 }),
        workers: [workerA, { ...workerB, effects: () => ({}) as never }],
    });
    assert.deepEqual(
        receipt.inspection.settlement?.workers.map((worker) => worker.status),
        ["completed", "failed"],
    );
    assert.match(
        receipt.inspection.workers[1]?.attempts[0]?.completion?.error ?? "",
        /must provide dispatch/u,
    );
});

test("a protocol with a looser decision schema cannot admit malformed decisions past the record schema", async (context) => {
    const world = await createSupervisorWorld(context, "runtime-loose-schema");
    const loose = readApplicationProtocol({
        ...base,
        surfaces: base.surfaces.map((surface) =>
            surface.kind === "schema" && surface.role === "action"
                ? {
                      ...surface,
                      content: {
                          $schema: "https://json-schema.org/draft/2020-12/schema",
                          type: "object",
                      },
                  }
                : surface,
        ),
    });
    const outputs: readonly unknown[] = [
        { decisions: "all" },
        { decisions: [{ action: "none", agent: 1 }] },
        { decisions: [{ action: "explode", agent: "a", reason: "r" }] },
        { verdict: "none" },
    ];
    const policy = scriptedPolicy(outputs);
    const hold = gate();
    const a = scriptedWorker("model:a", [
        [
            async (_request, signal) => {
                await hold.wait(signal);
                return [say("a done")];
            },
        ],
    ]);
    const clock = ticker();
    clock.release();
    const running = runRuntimeSupervisor(world.store, {
        clock: () => 3_000,
        commandId: "application:runtime:loose-schema",
        policy,
        protocol: loose,
        supervisorId: "supervisor:runtime",
        wait: clock.wait,
        workers: [runtimeWorker("a", a.model), quickWorkers()[1] as never],
        world: world.adapter,
    });
    await until(() => policy.contexts.length >= outputs.length, "every scripted tick");
    hold.open();
    const receipt = await running;
    const ticks = receipt.inspection.ticks.slice(0, outputs.length);
    // Each malformed batch is retained as a refusal instead of crashing the run.
    assert.deepEqual(
        ticks.map((tick) => [tick.decisions.length, tick.refusal === null]),
        outputs.map(() => [0, false]),
    );
    assert.match(ticks[0]?.refusal?.issues.join(" ") ?? "", /\$\.decisions/u);
    assert.match(ticks[1]?.refusal?.issues.join(" ") ?? "", /\$\.decisions\[0\]/u);
    assert.match(ticks[2]?.refusal?.issues.join(" ") ?? "", /action/u);
    assert.match(ticks[3]?.refusal?.issues.join(" ") ?? "", /decisions/u);
    assert.deepEqual(
        receipt.inspection.workers.map((worker) => worker.attempts.length),
        [1, 1],
    );
});

test("a caller abort while a discard awaits the aborted attempt never starts the replacement", async (context) => {
    const world = await createSupervisorWorld(context, "runtime-abort-discard");
    const controller = new AbortController();
    const release = gate();
    const a = scriptedWorker("model:a", [
        [
            () => [use("a1", "write_file", { path: "a.txt", text: "a1" })],
            (_request, signal) =>
                new Promise((_resolve, reject) => {
                    signal.addEventListener(
                        "abort",
                        () => {
                            // The caller stops the run while the discard awaits this attempt.
                            controller.abort(new Error("caller stopped"));
                            void release
                                .wait(new AbortController().signal)
                                .then(() => reject(signal.reason));
                        },
                        { once: true },
                    );
                }),
        ],
        [() => [say("replacement ran")]],
    ]);
    const b = scriptedWorker("model:b", [
        [
            async (_request, signal) => {
                await gate().wait(signal);
                return [say("never")];
            },
        ],
    ]);
    const clock = ticker();
    const running = runRuntimeSupervisor(world.store, {
        clock: () => 3_000,
        commandId: "application:runtime:abort-discard",
        policy: scriptedPolicy([
            { decisions: [{ action: "discard", agent: "a", reason: "restart" }] },
        ]),
        protocol: runtimeProtocol(),
        signal: controller.signal,
        supervisorId: "supervisor:runtime",
        wait: clock.wait,
        workers: [runtimeWorker("a", a.model), runtimeWorker("b", b.model)],
        world: world.adapter,
    });
    await until(() => a.requests.length === 2 && b.requests.length === 1, "both in flight");
    await clock.advance();
    await until(() => controller.signal.aborted, "caller abort");
    release.open();
    await assert.rejects(running, /caller stopped/u);
    // The replacement attempt never ran a model turn after the run was stopped.
    assert.equal(a.requests.length, 2);
    const inspection = inspectRuntimeSupervisorRun(
        world.store,
        deriveApplicationOwnerId("application:runtime:abort-discard"),
    );
    const [first, second] = inspection.workers[0]?.attempts ?? [];
    assert.equal(first?.completion?.status, "aborted");
    assert.ok(second === undefined || second.completion === null);
    assert.equal(inspection.workers[1]?.attempts[0]?.completion, null);
});

test("a caller abort while the replacement's fork is created aborts the new attempt at once", async (context) => {
    const world = await createSupervisorWorld(context, "runtime-abort-fork");
    const controller = new AbortController();
    let forks = 0;
    const adapter = {
        ...world.adapter,
        fork: async (request: Parameters<typeof world.adapter.fork>[0]) => {
            forks += 1;
            if (forks === 3) {
                // The caller stops the run after the old attempt wound down, during this fork.
                controller.abort(new Error("caller stopped"));
            }
            return world.adapter.fork(request);
        },
    };
    const a = scriptedWorker("model:a", [
        [
            async (_request, signal) => {
                await gate().wait(signal);
                return [say("never")];
            },
        ],
        [() => [say("replacement ran")]],
    ]);
    const b = scriptedWorker("model:b", [
        [
            async (_request, signal) => {
                await gate().wait(signal);
                return [say("never")];
            },
        ],
    ]);
    const clock = ticker();
    const running = runRuntimeSupervisor(world.store, {
        clock: () => 3_000,
        commandId: "application:runtime:abort-fork",
        policy: scriptedPolicy([
            { decisions: [{ action: "discard", agent: "a", reason: "restart" }] },
        ]),
        protocol: runtimeProtocol(),
        signal: controller.signal,
        supervisorId: "supervisor:runtime",
        wait: clock.wait,
        workers: [runtimeWorker("a", a.model), runtimeWorker("b", b.model)],
        world: adapter,
    });
    await until(() => a.requests.length === 1 && b.requests.length === 1, "both in flight");
    await clock.advance();
    await assert.rejects(running, /caller stopped/u);
    assert.equal(forks, 3);
    // The replacement attempt was created but never ran a model turn.
    assert.equal(a.requests.length, 1);
    const inspection = inspectRuntimeSupervisorRun(
        world.store,
        deriveApplicationOwnerId("application:runtime:abort-fork"),
    );
    const [first, second] = inspection.workers[0]?.attempts ?? [];
    assert.equal(first?.completion?.status, "aborted");
    assert.equal(second?.completion, null);
});

test("a structured model output is used as the decision object", async (context) => {
    const world = await createSupervisorWorld(context, "runtime-structured");
    const meta = createProgramConversationProvider({
        id: "model:meta",
        respond: () => ({
            message: { content: [say("structured")], role: "assistant" },
            output: { decisions: [{ action: "none", agent: "a", reason: "fine" }] },
            stopReason: "end_turn",
            usage: TURN_USAGE,
        }),
    });
    const protocol = runtimeProtocol({ tickIntervalMilliseconds: 1 });
    const receipt = await runRuntimeSupervisor(world.store, {
        clock: () => 3_000,
        commandId: "application:runtime:structured",
        policy: createModelRuntimeSupervisorPolicy({ model: meta, protocol }),
        protocol,
        supervisorId: "supervisor:runtime",
        workers: quickWorkers(),
        world: world.adapter,
    });
    assert.deepEqual(receipt.inspection.ticks.at(-1)?.decisions, [
        { action: "none", agent: "a", reason: "fine" },
    ]);
});

test("a snapshot the protocol refuses stops the run and leaves running workers resumable", async (context) => {
    const world = await createSupervisorWorld(context, "runtime-snapshot");
    const hold = gate();
    const a = scriptedWorker("model:a", [
        [
            async (_request, signal) => {
                await hold.wait(signal);
                return [say("never")];
            },
        ],
    ]);
    const protocol = runtimeProtocol();
    const refusing = {
        ...protocol,
        surfaces: protocol.surfaces.map((surface) =>
            surface.kind === "schema" && surface.role === "observation"
                ? { ...surface, content: { required: ["never"], type: "object" } }
                : surface,
        ),
    };
    const commandId = "application:runtime:snapshot";
    const clock = ticker();
    clock.release();
    await assert.rejects(
        runRuntimeSupervisor(world.store, {
            clock: () => 3_000,
            commandId,
            policy: scriptedPolicy([]),
            protocol: refusing,
            supervisorId: "supervisor:runtime",
            wait: clock.wait,
            workers: [runtimeWorker("a", a.model), quickWorkers()[1] as never],
            world: world.adapter,
        }),
        (error: unknown) =>
            error instanceof ApplicationProtocolError && /schema surface/u.test(error.message),
    );
    const inspection = inspectRuntimeSupervisorRun(
        world.store,
        deriveApplicationOwnerId(commandId),
    );
    assert.equal(inspection.ticks.length, 0);
    assert.equal(inspection.workers[0]?.attempts[0]?.completion, null);
});

test("the caller's signal stops every worker and rejects the run", async (context) => {
    const world = await createSupervisorWorld(context, "runtime-signal");
    const a = scriptedWorker("model:a", [
        [
            async (_request, signal) => {
                await gate().wait(signal);
                return [say("never")];
            },
        ],
    ]);
    const controller = new AbortController();
    const running = runRuntimeSupervisor(world.store, {
        clock: () => 3_000,
        commandId: "application:runtime:signal",
        policy: scriptedPolicy([]),
        protocol: runtimeProtocol(),
        signal: controller.signal,
        supervisorId: "supervisor:runtime",
        workers: [runtimeWorker("a", a.model), quickWorkers()[1] as never],
        world: world.adapter,
    });
    await until(() => a.requests.length === 1, "worker a in flight");
    controller.abort(new Error("caller stopped"));
    await assert.rejects(running, /caller stopped/u);
    const cancelled = new AbortController();
    cancelled.abort(new Error("already stopped"));
    await assert.rejects(
        runRuntimeSupervisor(world.store, {
            clock: () => 3_000,
            commandId: "application:runtime:signal-early",
            policy: scriptedPolicy([]),
            protocol: runtimeProtocol(),
            signal: cancelled.signal,
            supervisorId: "supervisor:runtime",
            workers: quickWorkers(),
            world: world.adapter,
        }),
        /already stopped/u,
    );
});

/** Store whose next completion of worker a or next manifest append dies once, and that can report a moved head once. */
class CompletionCrashStore extends SQLiteTraceStore {
    crashCompletion = false;
    crashManifest = false;
    moveHead = false;

    override appendApplicationRecord(
        applicationId: string,
        expectedHeadRecordId: RecordId | null,
        request: StoreAppendRequest,
        cutId: string | null,
    ) {
        const body = request.batch.groups[0]?.records[0]?.body as {
            readonly phase?: string;
            readonly worker_id?: string;
        };
        if (this.crashCompletion && body.phase === "completed" && body.worker_id === "a") {
            this.crashCompletion = false;
            throw new Error("process died before the completion record");
        }
        if (
            this.crashManifest &&
            request.batch.groups[0]?.records[0]?.schema_ref === "shepherd.application.manifest.v1"
        ) {
            this.crashManifest = false;
            throw new Error("process died before the manifest");
        }
        if (this.moveHead) {
            this.moveHead = false;
            return { status: "head_moved" as const };
        }
        return super.appendApplicationRecord(applicationId, expectedHeadRecordId, request, cutId);
    }
}

test("an attempt whose last retained turn was final or hit the turn bound completes on recovery", async (context) => {
    const world = await createSupervisorWorld(context, "runtime-completion");
    world.store.close();
    using store = new CompletionCrashStore(world.databasePath);
    const adapter = reopenSupervisorWorld(world.workspaceRoot, store, world.parent.scope_id);
    const run = (commandId: string, protocol = runtimeProtocol()) => {
        const clock = ticker();
        clock.release();
        return runRuntimeSupervisor(store, {
            clock: () => 3_000,
            commandId,
            policy: scriptedPolicy([]),
            protocol,
            supervisorId: "supervisor:runtime",
            wait: clock.wait,
            workers: [
                runtimeWorker(
                    "a",
                    scriptedWorker("model:a", [
                        [
                            () => [use("a1", "write_file", { path: "a.txt", text: "a" })],
                            () => [say("a done")],
                        ],
                    ]).model,
                ),
                quickWorkers()[1] as never,
            ],
            world: adapter,
        });
    };
    for (const [commandId, protocol, status] of [
        ["application:runtime:final", runtimeProtocol(), "completed"],
        ["application:runtime:bound", runtimeProtocol({ maxTurnsPerWorker: 1 }), "turn_limit"],
    ] as const) {
        store.crashCompletion = true;
        await assert.rejects(run(commandId, protocol), /completion record/u);
        const receipt = await run(commandId, protocol);
        assert.equal(receipt.inspection.workers[0]?.attempts[0]?.completion?.status, status);
    }
    // A run that died after its settlement record retains the manifest on rerun.
    store.crashManifest = true;
    await assert.rejects(run("application:runtime:manifest"), /before the manifest/u);
    const settledOnly = inspectRuntimeSupervisorRun(
        store,
        deriveApplicationOwnerId("application:runtime:manifest"),
    );
    assert.notEqual(settledOnly.settlement, null);
    assert.equal(settledOnly.manifest, null);
    const completed = await run("application:runtime:manifest");
    assert.equal(completed.inspection.settlement?.record_id, settledOnly.settlement?.record_id);
    assert.notEqual(completed.manifest, null);
    // A moved head refuses the append with evidence of a concurrent writer.
    store.moveHead = true;
    await assert.rejects(run("application:runtime:moved"), ApplicationEvidenceError);
    // Forged evidence on the application path is refused by inspection.
    const applicationId = deriveApplicationOwnerId("application:runtime:final");
    const [opened] = store.readOwner(applicationId);
    const forged = store.appendApplicationRecord(
        applicationId,
        store.readOwner(applicationId).at(-1)?.envelope.record_id as RecordId,
        {
            append_intent_id: "forged:runtime",
            batch: {
                groups: [
                    {
                        owner_id: applicationId,
                        records: [
                            {
                                body: opened?.body as never,
                                caused_by_record_ids: [],
                                mode: "capture",
                                schema_ref: opened?.envelope.schema_ref as string,
                                witness_ref: opened?.envelope.witness_ref as string,
                            },
                        ],
                    },
                ],
            },
        },
        null,
    );
    assert.equal(forged.status, "appended");
    assert.throws(
        () => inspectRuntimeSupervisorRun(store, applicationId),
        ApplicationEvidenceError,
    );
});

test("a rerun whose world resolves other custody for a retained attempt is refused", async (context) => {
    const world = await createSupervisorWorld(context, "runtime-other-custody");
    const commandId = "application:runtime:other-custody";
    const options = {
        clock: () => 3_000,
        commandId,
        protocol: runtimeProtocol(),
        supervisorId: "supervisor:runtime",
        wait: async () => {},
        workers: quickWorkers(),
    };
    await assert.rejects(
        runRuntimeSupervisor(world.store, {
            ...options,
            policy: () => {
                throw new Error("policy unavailable");
            },
            world: world.adapter,
        }),
        /policy unavailable/u,
    );
    await assert.rejects(
        runRuntimeSupervisor(world.store, {
            ...options,
            policy: scriptedPolicy([]),
            world: {
                ...world.adapter,
                fork: async (request) => ({
                    ...(await world.adapter.fork(request)),
                    receipt_id: "receipt:other",
                }),
            },
        }),
        (error: unknown) =>
            error instanceof ApplicationEvidenceError && /other custody/u.test(error.message),
    );
});
