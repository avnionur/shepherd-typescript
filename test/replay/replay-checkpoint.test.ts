import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { link, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import {
    classifyReplayCheckpoint,
    createCooperativeProcessAdapter,
    createTransparentProcessAdapter,
    ReplayCheckpointUnavailableError,
    type ReplayProcessAdapter,
    type ReplayProviderSessionAdapter,
    ReplayRestoreError,
    replayReplaySession,
    rewindReplaySession,
    runReplaySession,
    SQLiteTraceStore,
} from "../../src/index.ts";
import { probeTransparentCheckpointing } from "../../src/replay/processes.ts";
import {
    COUNTER_WORKER,
    emptyDirectory,
    exchangeOf,
    providerOf,
    requestOf,
    temporaryDirectory,
} from "./fixtures.ts";

test("verified provider-session and cooperative process captures restore as an atomic branch", async (context) => {
    const directory = await temporaryDirectory(context, "atomic");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const world = await emptyDirectory(directory, "world");
    const sessions = new Map<string, string | null>();
    const providerSession = (adapterId: string): ReplayProviderSessionAdapter => ({
        adapterId,
        cacheIdentity: (request, contextPrefixId) =>
            `${adapterId}:${request.instruction}:${contextPrefixId ?? "origin"}`,
        checkpoint: (checkpointContext) => {
            const receiptId = `receipt:${checkpointContext.step_count}`;
            sessions.set(receiptId, checkpointContext.context_prefix_id);
            return {
                contextPrefixId: checkpointContext.context_prefix_id,
                receiptId,
                status: "verified",
            };
        },
        restore: (receiptId) => sessions.get(receiptId) ?? null,
    });
    const worker = createCooperativeProcessAdapter({
        args: [COUNTER_WORKER],
        command: process.execPath,
        processId: "counter",
    });
    context.after(() => worker.close());
    const program = async (
        replayContext: Parameters<Parameters<typeof runReplaySession>[1]["program"]>[0],
    ) => {
        await replayContext.invokeProvider(requestOf(0));
        await worker.request({ op: "increment" });
        await worker.request({ op: "increment" });
        await writeFile(path.join(world, "state.txt"), "two");
        const checkpoint = await replayContext.checkpoint();
        await worker.request({ op: "increment" });
        return checkpoint.checkpoint_id;
    };
    const { inspection } = await runReplaySession(store, {
        claimId: "worker:1",
        commandId: "session:atomic",
        processes: [worker],
        program,
        programId: "program:atomic",
        provider: providerOf("provider:1", [exchangeOf(requestOf(0), { text: "a" })]),
        providerSession: providerSession("adapter:1"),
        worlds: [{ name: "main", root: world }],
    });
    const checkpoint = inspection.checkpoints[0];
    assert.ok(checkpoint);
    assert.equal(checkpoint.classification, "atomic");
    assert.match(
        String(inspection.steps[0]?.provider?.cache?.identity),
        /adapter:1:summarize:origin/u,
    );
    assert.deepEqual(
        classifyReplayCheckpoint(checkpoint).verified.map((entry) => entry.kind),
        ["trace_cut", "world", "provider_session", "process", "irreversible_effects"],
    );
    assert.deepEqual((await worker.request({ op: "read" })) as unknown, { count: 3 });

    const restoredWorker = createCooperativeProcessAdapter({
        args: [COUNTER_WORKER],
        command: process.execPath,
        processId: "counter",
    });
    context.after(() => restoredWorker.close());
    const root = await emptyDirectory(directory, "restored");
    const { inspection: rewound } = await rewindReplaySession(store, {
        claimId: "operator",
        commandId: "rewind:atomic",
        processes: [restoredWorker],
        providerSession: providerSession("adapter:2"),
        sourceSessionId: inspection.session_id,
        target: { checkpointId: checkpoint.checkpoint_id },
        worlds: [{ name: "main", root }],
    });
    assert.equal(rewound.restore?.classification, "atomic");
    assert.equal(rewound.restore?.constituents[2]?.name, "adapter:2");
    assert.deepEqual((await restoredWorker.request({ op: "read" })) as unknown, { count: 2 });

    await assert.rejects(
        rewindReplaySession(store, {
            claimId: "operator",
            commandId: "rewind:no-adapter",
            processes: [restoredWorker],
            sourceSessionId: inspection.session_id,
            target: { checkpointId: checkpoint.checkpoint_id },
            worlds: [{ name: "main", root: await emptyDirectory(directory, "no-adapter") }],
        }),
        /requires a providerSession adapter/u,
    );
    const wrongPrefix = await replayReplaySession(store, {
        claimId: "operator",
        commandId: "replay:wrong-prefix",
        processes: [restoredWorker],
        program,
        providerSession: { ...providerSession("adapter:3"), restore: () => null },
        sourceSessionId: inspection.session_id,
        target: { checkpointId: checkpoint.checkpoint_id },
        worlds: [{ name: "main", root: await emptyDirectory(directory, "wrong-prefix") }],
    });
    assert.equal(wrongPrefix.inspection.terminal?.status, "failed");
    assert.equal(wrongPrefix.inspection.terminal?.failure?.name, "ReplayRestoreError");
    assert.equal(wrongPrefix.inspection.restore, null);
    const failingProcess = await rewindReplaySession(store, {
        claimId: "operator",
        commandId: "rewind:failing-process",
        processes: [
            {
                ...restoredWorker,
                restore: async () => {
                    throw new Error("image rejected");
                },
            },
        ],
        providerSession: providerSession("adapter:4"),
        sourceSessionId: inspection.session_id,
        target: { checkpointId: checkpoint.checkpoint_id },
        worlds: [{ name: "main", root: await emptyDirectory(directory, "failing-process") }],
    });
    assert.equal(failingProcess.inspection.terminal?.failure?.message, "image rejected");
});

test("unavailable adapters and uncapturable worlds are retained with exact reasons and refuse restoration", async (context) => {
    const directory = await temporaryDirectory(context, "unavailable");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const world = await emptyDirectory(directory, "world");
    await writeFile(path.join(world, "original"), "x");
    await link(path.join(world, "original"), path.join(world, "hard-link"));
    const process = (
        processId: string,
        overrides: Partial<ReplayProcessAdapter>,
    ): ReplayProcessAdapter => ({
        backend: "cooperative",
        checkpoint: async () => new Uint8Array([1]),
        probe: async () => ({ available: true }),
        processId,
        restore: async () => undefined,
        ...overrides,
    });
    const adapter = (checkpoint: ReplayProviderSessionAdapter["checkpoint"]) => ({
        adapterId: "adapter:x",
        checkpoint,
        restore: () => null,
    });
    const capture = async (commandId: string, extra: Record<string, unknown>) =>
        (
            await runReplaySession(store, {
                claimId: "worker:1",
                commandId,
                program: async (replayContext) => replayContext.checkpoint(),
                programId: "program:unavailable",
                ...extra,
            })
        ).inspection.checkpoints[0];
    const checkpoint = await capture("session:unavailable", {
        processes: [
            process("a:probe", {
                probe: async () => ({ available: false, reason: "no host support" }),
            }),
            process("b:large", {
                checkpoint: async () => new Uint8Array(16_777_217),
            }),
            process("c:throws", {
                checkpoint: async () => {
                    throw new Error("capture failed");
                },
            }),
            process("d:not-bytes", { checkpoint: async () => "bytes" as never }),
            createTransparentProcessAdapter({ processId: "e:transparent" }),
        ],
        providerSession: adapter(() => ({ reason: "provider refuses", status: "unavailable" })),
        worlds: [{ name: "main", root: world }],
    });
    assert.ok(checkpoint);
    const classification = classifyReplayCheckpoint(checkpoint);
    assert.equal(classification.classification, "unavailable");
    assert.deepEqual(
        classification.unavailable.map((entry) => [entry.kind, entry.name, entry.reason]),
        [
            ["world", "main", "world capture failed: WORLD_CARRIER_UNSUPPORTED_ENTRY"],
            ["provider_session", "adapter:x", "provider refuses"],
            ["process", "a:probe", "no host support"],
            ["process", "b:large", "process image exceeds the configured bound"],
            ["process", "c:throws", "checkpoint adapter failed"],
            ["process", "d:not-bytes", "checkpoint adapter failed"],
            [
                "process",
                "e:transparent",
                (
                    (await createTransparentProcessAdapter({ processId: "probe" }).probe()) as {
                        readonly reason: string;
                    }
                ).reason,
            ],
        ],
    );
    for (const [commandId, checkpointAdapter, reason] of [
        [
            "session:mismatch",
            () => ({ contextPrefixId: "other", receiptId: "r", status: "verified" }),
            "provider session holds a different context prefix",
        ],
        [
            "session:throws",
            () => {
                throw new Error("offline");
            },
            "checkpoint adapter failed",
        ],
        [
            "session:malformed",
            () => ({ receiptId: "r", status: "unknown" }),
            "checkpoint adapter failed",
        ],
    ] as const) {
        const retained = await capture(commandId, {
            provider: providerOf("provider:1", []),
            providerSession: adapter(checkpointAdapter as never),
        });
        assert.equal(retained?.constituents[1]?.reason, reason);
    }
    await assert.rejects(
        rewindReplaySession(store, {
            claimId: "operator",
            commandId: "rewind:unavailable",
            processes: [],
            sourceSessionId: checkpoint.session_id,
            target: { checkpointId: checkpoint.checkpoint_id },
        }),
        ReplayCheckpointUnavailableError,
    );
    assert.throws(() => classifyReplayCheckpoint({ constituents: [] }), TypeError);
    const imaged = await runReplaySession(store, {
        claimId: "worker:1",
        commandId: "session:image",
        processes: [process("p", {})],
        program: async (replayContext) => replayContext.checkpoint(),
        programId: "program:image",
    });
    const image = imaged.inspection.checkpoints[0]?.constituents[2];
    assert.equal(image?.status, "verified");
    const digest = String(image?.receipt_id).split(":").at(-1) as string;
    await writeFile(
        path.join(`${path.join(directory, "trace.sqlite")}.blobs`, digest.slice(0, 2), digest),
        "tampered",
    );
    await assert.rejects(
        rewindReplaySession(store, {
            claimId: "operator",
            commandId: "rewind:tampered-image",
            processes: [process("p", {})],
            sourceSessionId: imaged.inspection.session_id,
            target: { checkpointId: imaged.inspection.checkpoints[0]?.checkpoint_id as string },
        }),
        ReplayRestoreError,
    );
});

test("the cooperative protocol fails closed on errors, exits, timeouts, and malformed messages", async (context) => {
    const make = (options: Record<string, unknown> = {}) => {
        const adapter = createCooperativeProcessAdapter({
            args: [COUNTER_WORKER],
            command: process.execPath,
            processId: "counter",
            ...options,
        });
        context.after(() => adapter.close());
        return adapter;
    };
    const worker = make();
    assert.deepEqual(await worker.probe(), { available: true });
    await assert.rejects(worker.request({ op: "error" }), /worker refused/u);
    await assert.rejects(worker.request({ op: "error-without-message" }), /reported an error/u);
    await assert.rejects(worker.request({ op: "garbage" }), /malformed message/u);
    await assert.rejects(worker.request({ op: "wrong-id" }), /uncorrelated/u);
    await assert.rejects(worker.request({ op: "wrong-type" }), /unexpected message type/u);
    assert.deepEqual((await worker.request({ op: "increment" })) as unknown, { count: 1 });
    await worker.request({ op: "corrupt-next-checkpoint" });
    await assert.rejects(
        worker.checkpoint({ process_id: "counter", session_id: "s", step_count: 0 }),
        /canonical base64/u,
    );
    await worker.request({ op: "empty-next-checkpoint" });
    await assert.rejects(
        worker.checkpoint({ process_id: "counter", session_id: "s", step_count: 0 }),
        /carry base64/u,
    );
    await assert.rejects(worker.request({ op: "exit" }), /exited/u);
    const slow = make({ timeoutMilliseconds: 50 });
    await assert.rejects(slow.request({ op: "silent" }), /timed out/u);
    const huge = createCooperativeProcessAdapter({
        args: [COUNTER_WORKER],
        command: process.execPath,
        processId: "huge",
    });
    context.after(() => huge.close());
    process.env.HUGE_BYTES = String(22_369_825);
    await assert.rejects(huge.request({ op: "huge" }), /exceeds the configured bound/u);
    delete process.env.HUGE_BYTES;
    const concurrent = make();
    const pending = concurrent.request({ op: "silent" });
    await assert.rejects(concurrent.request({ op: "read" }), /not ready/u);
    await concurrent.close();
    await assert.rejects(pending, /exited/u);
    await assert.rejects(
        concurrent.restore("bytes" as never, { process_id: "c", session_id: "s", step_count: 0 }),
        /must be bytes/u,
    );
    // An oversized request to a stalled process stays queued; the timeout kills the process and the
    // queued input then fails with a closed pipe, which the channel absorbs instead of surfacing an
    // unhandled stream error in the host. The wait lets that late error arrive inside the test.
    const stalled = make({ timeoutMilliseconds: 50 });
    await assert.rejects(stalled.request({ op: "stall", pad: "x".repeat(1 << 22) }), /timed out/u);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const missing = make({ command: path.join(COUNTER_WORKER, "missing") });
    assert.deepEqual(await missing.probe(), {
        available: false,
        reason: "cooperative process could not be started",
    });
    for (const invalid of [
        { command: "" },
        { args: [1] },
        { cwd: "" },
        { timeoutMilliseconds: 0 },
        { timeoutMilliseconds: 30_001 },
    ]) {
        assert.throws(() => make(invalid), TypeError);
    }
});

test("transparent checkpointing reports platform, executable, and host-check unavailability accurately", async (context) => {
    const directory = await temporaryDirectory(context, "transparent");
    const script = (name: string, code: number) => {
        const target = path.join(directory, name);
        execFileSync("/bin/sh", [
            "-c",
            `printf '#!/bin/sh\\nexit ${code}\\n' > '${target}' && chmod 755 '${target}'`,
        ]);
        return target;
    };
    assert.deepEqual(await probeTransparentCheckpointing("darwin", "criu"), {
        available: false,
        reason: "transparent process checkpointing is unsupported on this platform: darwin",
    });
    assert.deepEqual(await probeTransparentCheckpointing("linux", path.join(directory, "absent")), {
        available: false,
        reason: "criu executable is unavailable",
    });
    assert.deepEqual(await probeTransparentCheckpointing("linux", script("failing", 1)), {
        available: false,
        reason: "criu check failed: exit 1",
    });
    assert.deepEqual(await probeTransparentCheckpointing("linux", script("passing", 0)), {
        available: false,
        reason: "transparent process image capture is not supported by replay protocol v1",
    });
    const adapter = createTransparentProcessAdapter({ processId: "tool" });
    assert.equal(adapter.backend, "transparent");
    await assert.rejects(
        adapter.checkpoint({ process_id: "tool", session_id: "s", step_count: 0 }),
        /not supported/u,
    );
    await assert.rejects(
        adapter.restore(new Uint8Array(), { process_id: "tool", session_id: "s", step_count: 0 }),
        /not supported/u,
    );
    assert.throws(() => createTransparentProcessAdapter({ processId: "" }), TypeError);
});
