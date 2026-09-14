import assert from "node:assert/strict";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import {
    createEffectHandlerStack,
    deriveReplaySessionId,
    inspectReplaySession,
    type ModelProvider,
    ReplayEvidenceError,
    ReplayLeaseConflictError,
    ReplayLeaseFencedError,
    ReplaySessionInterruptedError,
    ReplayStepFailureError,
    ROOT_WITNESS_ID,
    runReplaySession,
    SQLiteTraceStore,
    schema,
    TraceStoreError,
    task,
} from "../../src/index.ts";
import {
    emptyDirectory,
    exchangeOf,
    intentOf,
    providerOf,
    requestOf,
    reviewProgram,
    reviewProvider,
    temporaryDirectory,
    worldHandlers,
} from "./fixtures.ts";

test("root sessions retain provider and effect steps with chained identities and cache evidence", async (context) => {
    const directory = await temporaryDirectory(context, "session");
    const world = await emptyDirectory(directory, "world");
    const databasePath = path.join(directory, "trace.sqlite");
    using store = new SQLiteTraceStore(databasePath);
    const calls: string[] = [];
    let programRuns = 0;
    const options = {
        claimId: "worker:1",
        commandId: "session:review",
        handlers: worldHandlers(world, calls),
        program: async (replayContext: Parameters<typeof reviewProgram>[0]) => {
            programRuns += 1;
            assert.equal(replayContext.mode, "root");
            assert.equal(replayContext.task, null);
            assert.equal(replayContext.signal.aborted, false);
            return reviewProgram(replayContext);
        },
        programId: "program:review.v1",
        provider: reviewProvider("final", 7),
        worlds: [{ name: "main", root: world }],
    };
    const { inspection } = await runReplaySession(store, options);
    assert.equal(programRuns, 1);
    assert.deepEqual(calls, [
        "write:draft.txt",
        "notify:effect:notify:1",
        "write:final.txt",
        "notify:effect:notify:2",
    ]);
    assert.equal(inspection.classification, "terminal");
    assert.equal(inspection.mode, "root");
    assert.equal(inspection.live, true);
    assert.equal(inspection.origin, null);
    assert.equal(inspection.restore, null);
    assert.deepEqual(inspection.terminal?.result, { value: { text: "final" } });
    assert.deepEqual(
        inspection.steps.map((step) => [step.index, step.kind, step.source, step.depends_on]),
        [
            [0, "provider", "live", []],
            [1, "effect", "live", [0]],
            [2, "effect", "live", []],
            [3, "provider", "live", [0]],
            [4, "effect", "live", [3]],
            [5, "effect", "live", []],
        ],
    );
    const [plan, draft, , final] = inspection.steps;
    assert.equal(plan?.provider?.cache?.status, "not_observed");
    assert.equal(plan?.provider?.cache?.prior_context_prefix_id, null);
    assert.equal(final?.provider?.cache?.status, "hit");
    assert.equal(final?.provider?.cache?.read_input_tokens, 7);
    assert.equal(
        final?.provider?.cache?.prior_context_prefix_id,
        plan?.provider?.context_prefix_id,
    );
    assert.equal(draft?.effect?.disposition, "materialized");
    assert.notEqual(draft?.effect?.admission_record_id, null);
    assert.equal(inspection.terminal?.prefix_id, inspection.steps[5]?.prefix_id);
    assert.equal(inspection.checkpoints.length, 1);
    assert.equal(store.verifyIntegrity().ok, true);

    const replayed = await runReplaySession(store, options);
    assert.equal(programRuns, 1);
    assert.deepEqual(replayed.inspection, inspection);

    const archive = store.exportTrace();
    using imported = new SQLiteTraceStore(path.join(directory, "imported.sqlite"));
    imported.importTrace(archive);
    const importedInspection = inspectReplaySession(imported, { sessionId: inspection.session_id });
    assert.deepEqual(importedInspection, { ...inspection, live: false });
    store.close();
    using reopened = new SQLiteTraceStore(databasePath, { readOnly: true });
    assert.deepEqual(
        inspectReplaySession(reopened, { sessionId: inspection.session_id }),
        inspection,
    );
});

test("provider and handler failures are retained and raised identically to the program", async (context) => {
    const directory = await temporaryDirectory(context, "failures");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const failing: ModelProvider = {
        descriptor: () => reviewProvider().descriptor(),
        invoke: async (request) => {
            if ((request.input as { readonly step: number }).step === 0) {
                throw new RangeError("provider unavailable");
            }
            return { output: { text: "ok" }, usage: { bad: true } } as never;
        },
    };
    const handlers = createEffectHandlerStack([
        {
            handle: () => {
                throw new Error("disk full");
            },
            handlerId: "handler:fail",
            kind: "file.write",
        },
    ]);
    const failures: ReplayStepFailureError[] = [];
    const { inspection } = await runReplaySession(store, {
        claimId: "worker:1",
        commandId: "session:failures",
        handlers,
        program: async (replayContext) => {
            for (const attempt of [
                () => replayContext.invokeProvider(requestOf(0)),
                () => replayContext.invokeProvider(requestOf(1)),
                () =>
                    replayContext.dispatchEffect(
                        intentOf("effect:1", "file.write", { name: "a", text: "b" }),
                    ),
            ]) {
                try {
                    await attempt();
                } catch (error) {
                    assert.ok(error instanceof ReplayStepFailureError);
                    failures.push(error);
                }
            }
            throw new SyntaxError("program gave up");
        },
        programId: "program:failures",
        provider: failing,
    });
    assert.deepEqual(
        failures.map((failure) => [failure.step_index, failure.failure_name, failure.code]),
        [
            [0, "RangeError", "REPLAY_STEP_FAILED"],
            [1, "TypeError", "REPLAY_STEP_FAILED"],
            [2, "Error", "REPLAY_STEP_FAILED"],
        ],
    );
    assert.equal(inspection.steps[0]?.provider?.response, null);
    assert.equal(inspection.steps[0]?.provider?.cache, null);
    assert.equal(inspection.steps[2]?.effect?.disposition, "materialization_failed");
    assert.equal(inspection.steps[2]?.effect?.outcome, null);
    assert.deepEqual(inspection.terminal?.failure, {
        message: "program gave up",
        name: "SyntaxError",
    });
    assert.equal(inspection.terminal?.status, "failed");
});

test("program results, thrown values, and malformed handler dispatches fail closed", async (context) => {
    const directory = await temporaryDirectory(context, "results");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const run = (commandId: string, program: Parameters<typeof runReplaySession>[1]["program"]) =>
        runReplaySession(store, {
            claimId: "worker:1",
            commandId,
            handlers: { dispatch: async () => ({ handlerId: "", outcome: null }) } as never,
            program,
            programId: "program:results",
        });
    assert.deepEqual((await run("session:void", () => undefined)).inspection.terminal?.result, {
        value: null,
    });
    const invalid = await run("session:invalid", () => 10n);
    assert.equal(invalid.inspection.terminal?.status, "failed");
    assert.equal(invalid.inspection.terminal?.failure?.name, "TypeError");
    const thrown = await run("session:thrown", () => {
        throw "plain failure";
    });
    assert.deepEqual(thrown.inspection.terminal?.failure, {
        message: "plain failure",
        name: "Error",
    });
    const long = await run("session:long", () => {
        throw new Error("é".repeat(5000));
    });
    assert.ok(Buffer.byteLength(long.inspection.terminal?.failure?.message ?? "") <= 4096);
    const malformed = await run("session:malformed", async (replayContext) => {
        await replayContext.dispatchEffect(
            intentOf("effect:1", "file.write", { name: "a", text: "b" }),
        );
    });
    assert.equal(malformed.inspection.steps[0]?.effect?.disposition, "materialization_failed");
});

test("tasks derive provider requests and context operations enforce session capabilities", async (context) => {
    const directory = await temporaryDirectory(context, "task");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const summarize = task({
        input: schema.object({ topic: schema.string() }),
        instruction: "Summarize the topic.",
        name: "summarize",
        output: schema.object({ text: schema.string() }),
        version: "1",
    });
    const derived = {
        input: { topic: "replay" },
        instruction: "Summarize the topic.",
        outputSchema: summarize.artifact.output_schema,
    };
    const errors: unknown[] = [];
    const { inspection } = await runReplaySession(store, {
        claimId: "worker:1",
        commandId: "session:task",
        program: async (replayContext) => {
            assert.equal(replayContext.task?.instruction, "Summarize the topic.");
            const result = await replayContext.invokeTask();
            assert.equal(replayContext.step_count, 1);
            for (const operation of [
                () => replayContext.dispatchEffect(intentOf("effect:1", "notify", {})),
                () => replayContext.invokeProvider(requestOf(9)),
                () => replayContext.invokeProvider({ instruction: "" } as never),
                () =>
                    replayContext.invokeProvider(requestOf(9), {
                        dependsOn: [{ index: 0, record_id: "x" }],
                    }),
                () => replayContext.invokeProvider(requestOf(9), { extra: true } as never),
            ]) {
                await operation().catch((error: unknown) => errors.push(error));
            }
            const first = replayContext.invokeTask();
            await assert.rejects(replayContext.checkpoint(), /sequential/u);
            await first.catch((error: unknown) => errors.push(error));
            return result.response.output;
        },
        programId: "program:task",
        provider: providerOf("provider:task", [exchangeOf(derived, { text: "done" })]),
        task: { descriptor: summarize as never, input: { topic: "replay" } },
    });
    assert.equal(inspection.terminal?.status, "finished");
    assert.deepEqual(inspection.task?.input, { topic: "replay" });
    assert.equal(errors.length, 6);
    assert.match(String(errors[0]), /no effect handler stack/u);
    assert.match(String(errors[5]), /REPLAY_STEP_FAILED|exhausted/u);

    const noTask = await runReplaySession(store, {
        claimId: "worker:1",
        commandId: "session:no-task",
        program: async (replayContext) => {
            await assert.rejects(replayContext.invokeTask(), /no task/u);
            await assert.rejects(replayContext.invokeProvider(requestOf(0)), /no provider/u);
            return "ok";
        },
        programId: "program:no-task",
    });
    assert.equal(noTask.inspection.terminal?.status, "finished");

    let escaped: Parameters<typeof reviewProgram>[0] | undefined;
    await runReplaySession(store, {
        claimId: "worker:1",
        commandId: "session:escaped",
        program: (replayContext) => {
            escaped = replayContext;
        },
        programId: "program:escaped",
    });
    await assert.rejects(
        (escaped as Parameters<typeof reviewProgram>[0]).checkpoint(),
        /sequential/u,
    );
});

test("caller cancellation retains a cancelled terminal without recording the interrupted step", async (context) => {
    const directory = await temporaryDirectory(context, "cancel");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const controller = new AbortController();
    const hanging: ModelProvider = {
        descriptor: () => reviewProvider().descriptor(),
        invoke: (_request, signal) =>
            new Promise((_resolve, reject) => {
                signal.addEventListener("abort", () => reject(signal.reason), { once: true });
                controller.abort(new Error("operator stop"));
            }),
    };
    const cancelled = await runReplaySession(store, {
        claimId: "worker:1",
        commandId: "session:cancel",
        program: async (replayContext) => replayContext.invokeProvider(requestOf(0)),
        programId: "program:cancel",
        provider: hanging,
        signal: controller.signal,
    });
    assert.equal(cancelled.inspection.terminal?.status, "cancelled");
    assert.equal(cancelled.inspection.steps.length, 0);
    const aborted = AbortSignal.abort();
    const early = await runReplaySession(store, {
        claimId: "worker:1",
        commandId: "session:pre-aborted",
        program: async (replayContext) => replayContext.checkpoint(),
        programId: "program:cancel",
        signal: aborted,
    });
    assert.equal(early.inspection.terminal?.status, "cancelled");
});

test("session leases admit one writer, fence expired writers, and classify non-terminal sessions", async (context) => {
    const directory = await temporaryDirectory(context, "lease");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    const running = runReplaySession(store, {
        claimId: "worker:1",
        commandId: "session:lease",
        program: async () => {
            await gate;
            return "done";
        },
        programId: "program:lease",
    });
    const sessionId = deriveReplaySessionId("session:lease");
    await assert.rejects(
        runReplaySession(store, {
            claimId: "worker:2",
            commandId: "session:lease",
            program: () => "never",
            programId: "program:lease",
        }),
        ReplayLeaseConflictError,
    );
    await assert.rejects(
        runReplaySession(store, {
            claimId: "worker:1",
            commandId: "session:lease",
            program: () => "never",
            programId: "program:lease",
        }),
        (error: unknown) =>
            error instanceof ReplaySessionInterruptedError && error.classification === "running",
    );
    const future = Date.now() + 3_600_000;
    assert.equal(
        inspectReplaySession(store, { clock: () => future, sessionId }).classification,
        "interrupted",
    );
    await assert.rejects(
        runReplaySession(store, {
            claimId: "worker:2",
            clock: () => future,
            commandId: "session:lease",
            program: () => "never",
            programId: "program:lease",
        }),
        (error: unknown) =>
            error instanceof ReplaySessionInterruptedError &&
            error.classification === "interrupted",
    );
    release();
    assert.equal((await running).inspection.terminal?.status, "finished");

    let now = 1_000;
    const renewals = await runReplaySession(store, {
        claimId: "worker:1",
        clock: () => {
            now += 10_000;
            return now;
        },
        commandId: "session:renewed",
        program: async (replayContext) => {
            await replayContext.checkpoint();
            return "renewed";
        },
        programId: "program:lease",
    });
    assert.equal(renewals.inspection.terminal?.status, "finished");

    let expired = 1_000;
    await assert.rejects(
        runReplaySession(store, {
            claimId: "worker:1",
            clock: () => expired,
            commandId: "session:fenced",
            program: async (replayContext) => {
                expired += 60_000;
                await replayContext.checkpoint();
            },
            programId: "program:lease",
        }),
        ReplayLeaseFencedError,
    );
});

test("session owner paths are reserved and live rows are checked by integrity scans", async (context) => {
    const directory = await temporaryDirectory(context, "reserved");
    const databasePath = path.join(directory, "trace.sqlite");
    let sessionId: string;
    {
        using store = new SQLiteTraceStore(databasePath);
        const { inspection } = await runReplaySession(store, {
            claimId: "worker:1",
            commandId: "session:reserved",
            program: () => "ok",
            programId: "program:reserved",
        });
        sessionId = inspection.session_id;
        assert.throws(
            () =>
                store.append({
                    append_intent_id: "intent:forged",
                    batch: {
                        groups: [
                            {
                                owner_id: sessionId,
                                records: [
                                    {
                                        body: { forged: true },
                                        mode: "capture",
                                        schema_ref: "shepherd.replay.step.v1",
                                        witness_ref: ROOT_WITNESS_ID,
                                    },
                                ],
                            },
                        ],
                    },
                }),
            (error: unknown) => error instanceof TraceStoreError && /reserved/u.test(String(error)),
        );
        assert.throws(
            () =>
                store.publishCut({
                    cut_id: "cut:forged",
                    target_owner_id: sessionId,
                    through_record_id: inspection.session_record_id,
                }),
            /reserved for replay sessions/u,
        );
        assert.throws(() => store.publishCut(null as never), TypeError);
    }
    const database = new DatabaseSync(databasePath);
    database.prepare("UPDATE replay_sessions SET terminal = 0 WHERE session_id = ?").run(sessionId);
    database.close();
    using tampered = new SQLiteTraceStore(databasePath);
    assert.deepEqual(
        tampered.verifyIntegrity().issues.map((issue) => issue.kind),
        ["replay_session_mismatch"],
    );
    assert.throws(() => inspectReplaySession(tampered, { sessionId }), ReplayEvidenceError);
    assert.throws(
        () => inspectReplaySession(tampered, { sessionId: "replay-session:sha256:missing" }),
        /not retained/u,
    );
});

test("session options are validated before any record is retained", async (context) => {
    const directory = await temporaryDirectory(context, "options");
    const world = await emptyDirectory(directory, "world");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const base = {
        claimId: "worker:1",
        commandId: "session:options",
        program: () => null,
        programId: "program:options",
    };
    const adapter = {
        backend: "cooperative",
        checkpoint: async () => new Uint8Array(),
        probe: async () => ({ available: true }),
        processId: "process:1",
        restore: async () => undefined,
    };
    for (const invalid of [
        { ...base, claimId: "" },
        { ...base, clock: 1 },
        { ...base, signal: {} },
        { ...base, handlers: {} },
        { ...base, provider: {} },
        { ...base, program: 1 },
        { ...base, programId: "" },
        { ...base, extra: true },
        { ...base, task: { descriptor: {}, input: null } },
        { ...base, worlds: [{ name: "main", root: "relative" }] },
        { ...base, worlds: [{ name: "main", root: path.join(directory, "absent") }] },
        {
            ...base,
            worlds: [
                { name: "a", root: world },
                { name: "b", root: world },
            ],
        },
        { ...base, processes: [{ ...adapter, backend: "unknown" }] },
        { ...base, processes: [adapter, adapter] },
        { ...base, providerSession: { adapterId: "a", checkpoint: 1, restore: () => null } },
        {
            ...base,
            providerSession: {
                adapterId: "a",
                cacheIdentity: 1,
                checkpoint: () => null,
                restore: () => null,
            },
        },
    ]) {
        await assert.rejects(runReplaySession(store, invalid as never), TypeError);
    }
    assert.throws(
        () => inspectReplaySession(store, { clock: 1, sessionId: "x" } as never),
        TypeError,
    );
    assert.deepEqual(store.readOwner("replay-session:none"), []);
    const badClock = await runReplaySession(store, {
        ...base,
        clock: () => -1,
    }).catch((error: unknown) => error);
    assert.ok(badClock instanceof TypeError);
});
