import assert from "node:assert/strict";
import { realpathSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import { createRecordId } from "../../src/canonical/canonical-record.ts";
import {
    createCooperativeProcessAdapter,
    deriveReplaySessionId,
    type ModelProvider,
    ReplayCheckpointUnavailableError,
    ReplayEvidenceError,
    ReplayLeaseFencedError,
    ReplayPrefixMismatchError,
    ReplayRestoreError,
    type ReplaySessionContext,
    replayReplaySession,
    rewindReplaySession,
    runReplaySession,
    SQLiteTraceStore,
    schema,
    task,
} from "../../src/index.ts";
import { readReplayStepBody } from "../../src/replay/records.ts";
import { appendRequest } from "../../src/replay/session.ts";
import {
    captureReplayWorldImage,
    restoreReplayWorldImage,
    verifyReplayWorldImage,
} from "../../src/replay/world-image.ts";
import { readReferenceCopyManifest } from "../../src/workspace/reference-copy-carrier.ts";
import {
    emptyDirectory,
    exchangeOf,
    intentOf,
    providerOf,
    requestOf,
    reviewProvider,
    temporaryDirectory,
    worldHandlers,
} from "./fixtures.ts";

const usage = {
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    costUsd: null,
    inputTokens: 1,
    outputTokens: 1,
};

test("session store transactions fence stale writers, detect moved heads, and bound lease clocks", async (context) => {
    const directory = await temporaryDirectory(context, "store");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const { inspection } = await runReplaySession(store, {
        claimId: "worker:1",
        commandId: "session:store",
        program: () => null,
        programId: "program:store",
    });
    const sessionId = inspection.session_id;
    const request = appendRequest(
        "session:store",
        "forged",
        sessionId,
        { forged: true },
        "shepherd.replay.step.v1",
        "capture",
        [],
    );
    assert.throws(
        () =>
            store.appendReplaySessionRecord(
                sessionId,
                { claimId: "worker:1", fencingToken: 1 },
                0,
                {
                    cut: null,
                    expectedHeadRecordId: inspection.head_record_id,
                    request: () => request,
                    terminal: false,
                },
            ),
        ReplayLeaseFencedError,
    );
    assert.throws(
        () =>
            store.openReplaySession(sessionId, "worker:2", 0, {
                ...request,
                append_intent_id: createRecordId({ other: true }),
            }),
        (error: unknown) =>
            error instanceof ReplayEvidenceError && /already retains/u.test(String(error)),
    );
    assert.throws(
        () =>
            store.openReplaySession(
                deriveReplaySessionId("session:overflow"),
                "worker:1",
                Number.MAX_SAFE_INTEGER,
                request,
            ),
        /safe integer/u,
    );

    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    const running = runReplaySession(store, {
        claimId: "worker:9",
        commandId: "session:moved",
        program: async (replayContext) => {
            await gate;
            await replayContext.checkpoint();
        },
        programId: "program:store",
    });
    const movedId = deriveReplaySessionId("session:moved");
    const head = store.readOwner(movedId)[0]?.envelope.record_id as string;
    const forged = store.appendReplaySessionRecord(
        movedId,
        { claimId: "worker:9", fencingToken: 1 },
        Date.now(),
        {
            cut: null,
            expectedHeadRecordId: head,
            request: () =>
                appendRequest("session:moved", "forged", movedId, { x: 1 }, "x.v1", "capture", [
                    head,
                ]),
            terminal: false,
        },
    );
    assert.equal(forged.status, "appended");
    assert.equal(
        store.appendReplaySessionRecord(
            movedId,
            { claimId: "worker:9", fencingToken: 1 },
            Date.now(),
            {
                cut: null,
                expectedHeadRecordId: head,
                request: () => request,
                terminal: false,
            },
        ).status,
        "head_moved",
    );
    release();
    await assert.rejects(running, (error: unknown) => error instanceof ReplayEvidenceError);
});

test("step and dependency bounds, verdict shapes, adapters, and poisoned contexts fail closed", async (context) => {
    using store = new SQLiteTraceStore();
    const echo: ModelProvider = {
        descriptor: () => reviewProvider().descriptor(),
        invoke: async () => ({ output: { ok: true }, usage }),
    };
    const bounded = await runReplaySession(store, {
        claimId: "worker:1",
        commandId: "session:bounds",
        program: async (replayContext) => {
            assert.equal(replayContext.session_id, deriveReplaySessionId("session:bounds"));
            const handles = [];
            for (let index = 0; index < 4096; index += 1) {
                const step = await replayContext.invokeProvider(requestOf(index), {
                    dependsOn: [],
                });
                if (index < 65) {
                    handles.push(step.handle);
                }
            }
            await assert.rejects(replayContext.invokeProvider(requestOf(0)), RangeError);
            return handles;
        },
        programId: "program:bounds",
        provider: echo,
    });
    assert.equal(bounded.inspection.steps.length, 4096);
    const dependencies = await runReplaySession(store, {
        claimId: "worker:1",
        commandId: "session:dependencies",
        program: async (replayContext) => {
            const handles = [];
            for (let index = 0; index < 65; index += 1) {
                handles.push((await replayContext.invokeProvider(requestOf(index))).handle);
            }
            await assert.rejects(
                replayContext.invokeProvider(requestOf(99), { dependsOn: handles }),
                RangeError,
            );
            return "bounded";
        },
        programId: "program:dependencies",
        provider: echo,
    });
    assert.equal(dependencies.inspection.terminal?.status, "finished");
    await assert.rejects(
        runReplaySession(store, {
            claimId: "worker:1",
            commandId: "session:null-adapter",
            processes: [null as never],
            program: () => null,
            programId: "program:adapter",
        }),
        /adapter object/u,
    );

    const source = await runReplaySession(store, {
        claimId: "worker:1",
        commandId: "session:verdict",
        handlers: worldHandlers(await temporaryDirectory(context, "verdict")),
        program: async (replayContext) => {
            await replayContext.invokeProvider(requestOf(0));
            await replayContext.dispatchEffect(intentOf("effect:1", "notify", {}, "irreversible"));
        },
        programId: "program:verdict",
        provider: providerOf("p", [exchangeOf(requestOf(0), { text: "a" })]),
    });
    const branch = (commandId: string, extra: Record<string, unknown>) =>
        replayReplaySession(store, {
            claimId: "operator",
            commandId,
            handlers: worldHandlers(path.join(path.sep, "unused")),
            program: async (replayContext: ReplaySessionContext) => {
                await replayContext.invokeProvider(requestOf(0));
                await replayContext.dispatchEffect(
                    intentOf("effect:1", "notify", {}, "irreversible"),
                );
            },
            provider: echo,
            sourceSessionId: source.inspection.session_id,
            target: { stepCount: 1 },
            ...extra,
        } as never);
    const malformed = await branch("replay:verdict", {
        policy: () => ({ approved: "yes", reason: "maybe" }),
    });
    assert.equal(malformed.inspection.steps[1]?.effect?.refusal_reason, "replay policy failed");
    const poisoned = await branch("replay:poisoned", {
        program: async (replayContext: ReplaySessionContext) => {
            const mismatch = await replayContext
                .invokeProvider(requestOf(7))
                .catch((error: unknown) => error);
            assert.ok(mismatch instanceof ReplayPrefixMismatchError);
            await assert.rejects(replayContext.checkpoint(), ReplayPrefixMismatchError);
            return "ignored";
        },
    });
    assert.equal(poisoned.inspection.terminal?.failure?.name, "ReplayPrefixMismatchError");
    const summarize = task({
        input: schema.object({ topic: schema.string() }),
        instruction: "Summarize.",
        name: "summarize",
        output: schema.object({ text: schema.string() }),
        version: "1",
    });
    await assert.rejects(
        branch("replay:undeclared-task", {
            task: { descriptor: summarize as never, input: { topic: "x" } },
        }),
        /declared task change/u,
    );
});

test("step-boundary targets report unavailable processes and world images fail closed", async (context) => {
    const directory = await temporaryDirectory(context, "images");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const adapter = {
        backend: "cooperative" as const,
        checkpoint: async () => new Uint8Array([1]),
        probe: async () => ({ available: true as const }),
        processId: "process:1",
        restore: async () => undefined,
    };
    const withProcess = await runReplaySession(store, {
        claimId: "worker:1",
        commandId: "session:process",
        processes: [adapter],
        program: () => null,
        programId: "program:process",
    });
    await assert.rejects(
        rewindReplaySession(store, {
            claimId: "operator",
            commandId: "rewind:process",
            processes: [adapter],
            sourceSessionId: withProcess.inspection.session_id,
            target: { stepCount: 0 },
        }),
        (error: unknown) =>
            error instanceof ReplayCheckpointUnavailableError &&
            error.unavailable[0]?.kind === "process",
    );

    const world = realpathSync(await emptyDirectory(directory, "world"));
    await writeFile(path.join(world, "a.txt"), "a");
    let changed = false;
    const changing = new Proxy(store, {
        get(target, property) {
            if (property === "putBlob") {
                return (bytes: Uint8Array) => {
                    const receipt = target.putBlob(bytes);
                    if (!changed) {
                        changed = true;
                        writeFileSync(path.join(world, "late.txt"), "late");
                    }
                    return receipt;
                };
            }
            return Reflect.get(target, property, target);
        },
    });
    assert.throws(() => captureReplayWorldImage(changing, world), /changed during image capture/u);
    const image = captureReplayWorldImage(store, world);
    const missingManifest = {
        content_id: image.content_id,
        entry_count: image.entry_count,
        manifest_blob_id: `sha256:${"0".repeat(64)}`,
    };
    assert.throws(() => verifyReplayWorldImage(store, missingManifest, world), ReplayRestoreError);
    const forgedManifest = store.putBlob(
        Buffer.from(
            JSON.stringify([
                {
                    blob_id: `blob:sha256:${"1".repeat(64)}`,
                    kind: "file",
                    mode: 420,
                    path: "ghost.txt",
                    size: 1,
                    symlink_target: null,
                },
            ]),
        ),
    );
    assert.throws(
        () =>
            verifyReplayWorldImage(
                store,
                { content_id: "x", entry_count: 1, manifest_blob_id: forgedManifest.blob_id },
                world,
            ),
        ReplayRestoreError,
    );
    const manifest = verifyReplayWorldImage(store, image, world);
    assert.throws(() => restoreReplayWorldImage(store, manifest, world), ReplayRestoreError);
});

test("an expired lease discovered while the program waits fences the session", async () => {
    using store = new SQLiteTraceStore();
    let now = 1_000;
    await assert.rejects(
        runReplaySession(store, {
            claimId: "worker:1",
            clock: () => now,
            commandId: "session:interval",
            program: async (replayContext) => {
                now += 3_600_000;
                await new Promise((_resolve, reject) => {
                    replayContext.signal.addEventListener(
                        "abort",
                        () => reject(replayContext.signal.reason),
                        {
                            once: true,
                        },
                    );
                });
            },
            programId: "program:interval",
        }),
        ReplayLeaseFencedError,
    );
});

test("residual boundaries: frontiers at step targets, new suffix intents, adapters without arguments", async (context) => {
    const directory = await temporaryDirectory(context, "residual");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const notify = (effectId: string) => intentOf(effectId, "notify", {}, "irreversible");
    const { inspection: source } = await runReplaySession(store, {
        claimId: "worker:1",
        commandId: "session:frontier",
        handlers: worldHandlers(directory),
        program: async (replayContext) => {
            await replayContext.dispatchEffect(notify("effect:first"));
        },
        programId: "program:frontier",
    });
    const rewound = await rewindReplaySession(store, {
        claimId: "operator",
        commandId: "rewind:frontier",
        sourceSessionId: source.session_id,
        target: { stepCount: 1 },
    });
    assert.deepEqual(rewound.inspection.restore?.constituents.at(-1)?.evidence, {
        step_indices: [0],
    });
    const nested = await rewindReplaySession(store, {
        claimId: "operator",
        commandId: "rewind:nested",
        sourceSessionId: rewound.inspection.session_id,
        target: { stepCount: 0 },
    });
    assert.equal(nested.inspection.terminal?.status, "rewound");
    const calls: string[] = [];
    const replayed = await replayReplaySession(store, {
        changes: ["handlers"],
        claimId: "operator",
        commandId: "replay:new-intent",
        handlers: worldHandlers(directory, calls),
        policy: () => ({ approved: true, approverId: "reviewer", reason: "new effect" }),
        program: async (replayContext) => {
            await replayContext.dispatchEffect(notify("effect:first"));
            await replayContext.dispatchEffect(notify("effect:second"), { dependsOn: [] });
        },
        sourceSessionId: source.session_id,
        target: { stepCount: 1 },
    });
    assert.deepEqual(calls, ["notify:effect:second"]);
    assert.equal(replayed.inspection.steps[1]?.effect?.approval?.rematerialization, false);
    const echo = createCooperativeProcessAdapter({ command: "/bin/cat", processId: "echo" });
    context.after(() => echo.close());
    await assert.rejects(
        echo.checkpoint({ process_id: "echo", session_id: "s", step_count: 0 }),
        /malformed message/u,
    );
    const missing = createCooperativeProcessAdapter({
        command: path.join(directory, "absent-executable"),
        processId: "missing",
    });
    assert.equal((await missing.probe()).available, false);
    assert.equal((await missing.probe()).available, false);
    await missing.close();
    const unnamed = new ReplayCheckpointUnavailableError([
        { kind: "trace_cut", name: null, reason: "synthetic" },
    ]);
    assert.match(unnamed.message, /trace_cut$/u);
    const step = store
        .readOwner(replayed.inspection.session_id)
        .filter((record) => record.envelope.schema_ref === "shepherd.replay.step.v1")[1];
    assert.throws(
        () =>
            readReplayStepBody({
                ...(step?.body as Record<string, unknown>),
                depends_on: [0, 0],
            } as never),
        ReplayEvidenceError,
    );
    const world = realpathSync(await emptyDirectory(directory, "ghost-world"));
    const forged = [
        {
            blob_id: `blob:sha256:${"1".repeat(64)}`,
            kind: "file",
            mode: 420,
            path: "ghost.txt",
            size: 1,
            symlink_target: null,
        },
    ];
    const blob = store.putBlob(Buffer.from(JSON.stringify(forged)));
    assert.throws(
        () =>
            verifyReplayWorldImage(
                store,
                {
                    content_id: readReferenceCopyManifest(world, forged).content_id,
                    entry_count: 1,
                    manifest_blob_id: blob.blob_id,
                },
                world,
            ),
        (error: unknown) =>
            error instanceof ReplayRestoreError &&
            /world file blob is absent/u.test(String((error.cause as Error).message)),
    );
});
