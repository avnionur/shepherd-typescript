import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import {
    analyzeReplayDependencies,
    analyzeReplayDivergence,
    classifyReplayCheckpoint,
    createCooperativeProcessAdapter,
    createEffectHandlerStack,
    createTransparentProcessAdapter,
    ReplayCheckpointUnavailableError,
    type ReplayProviderSessionAdapter,
    type ReplaySessionContext,
    replayReplaySession,
    rewindReplaySession,
    runReplaySession,
    SQLiteTraceStore,
} from "../../src/index.ts";
import {
    COUNTER_WORKER,
    emptyDirectory,
    exchangeOf,
    intentOf,
    providerOf,
    readTree,
    requestOf,
    temporaryDirectory,
    worldHandlers,
} from "./fixtures.ts";

test("coupled replay conformance: atomic multi-resource checkpoint, imported rewind, and intended-suffix replay", async (context) => {
    const directory = await temporaryDirectory(context, "conformance");
    const main = await emptyDirectory(directory, "main");
    const assets = await emptyDirectory(directory, "assets");
    await writeFile(path.join(assets, "logo.bin"), Buffer.from([1, 2, 3]));
    const receipts = new Map<string, string | null>();
    const providerSession = (adapterId: string): ReplayProviderSessionAdapter => ({
        adapterId,
        checkpoint: (checkpointContext) => {
            receipts.set(
                `receipt:${checkpointContext.step_count}`,
                checkpointContext.context_prefix_id,
            );
            return {
                contextPrefixId: checkpointContext.context_prefix_id,
                receiptId: `receipt:${checkpointContext.step_count}`,
                status: "verified",
            };
        },
        restore: (receiptId) => receipts.get(receiptId) ?? null,
    });
    const counter = (processId = "counter") => {
        const adapter = createCooperativeProcessAdapter({
            args: [COUNTER_WORKER],
            command: process.execPath,
            processId,
        });
        context.after(() => adapter.close());
        return adapter;
    };
    const handlersFor = (
        root: string,
        worker: ReturnType<typeof counter>,
        calls: string[] = [],
    ) => {
        const files = worldHandlers(root, calls);
        return createEffectHandlerStack([
            {
                handle: async () => {
                    calls.push("counter:increment");
                    return {
                        ok: true,
                        value: (await worker.request({ op: "increment" })) as never,
                    };
                },
                handlerId: "handler:counter",
                kind: "counter.increment",
            },
            {
                handle: async (intent) => (await files.dispatch(intent)).outcome.result as never,
                handlerId: "handler:files",
                kind: "file.write",
            },
            {
                handle: async (intent) => (await files.dispatch(intent)).outcome.result as never,
                handlerId: "handler:notify",
                kind: "notify",
            },
        ]);
    };
    const makeProgram =
        (republish = false) =>
        async (replayContext: ReplaySessionContext) => {
            const plan = await replayContext.invokeProvider(requestOf(0));
            await replayContext.dispatchEffect(intentOf("effect:count", "counter.increment", {}), {
                dependsOn: [],
            });
            await replayContext.dispatchEffect(
                intentOf("effect:draft", "file.write", { name: "draft.txt", text: "draft" }),
                { dependsOn: [plan.handle] },
            );
            await replayContext.dispatchEffect(
                intentOf("effect:publish", "notify", { stage: "draft" }, "irreversible"),
                { dependsOn: [] },
            );
            await replayContext.checkpoint();
            if (republish) {
                return replayContext.dispatchEffect(
                    intentOf("effect:publish", "notify", { stage: "draft" }, "irreversible"),
                    { dependsOn: [] },
                );
            }
            const final = await replayContext.invokeProvider(requestOf(1), {
                dependsOn: [plan.handle],
            });
            const text = (final.response.output as { readonly text: string }).text;
            await replayContext.dispatchEffect(
                intentOf("effect:final", "file.write", { name: "final.txt", text }),
                { dependsOn: [final.handle] },
            );
            await replayContext.dispatchEffect(
                intentOf("effect:audit", "file.write", { name: "audit.txt", text: "audit" }),
                { dependsOn: [] },
            );
            return text;
        };
    let archive: string;
    let sourceId: string;
    let checkpointId: string;
    let expectedMain: Record<string, string>;
    let expectedAssets: Record<string, string>;
    {
        using store = new SQLiteTraceStore(path.join(directory, "source.sqlite"));
        const worker = counter();
        const { inspection } = await runReplaySession(store, {
            claimId: "worker:1",
            commandId: "session:conformance",
            handlers: handlersFor(main, worker),
            processes: [worker],
            program: makeProgram(),
            programId: "program:conformance.v1",
            provider: providerOf("provider:source", [
                exchangeOf(requestOf(0), { text: "plan" }),
                exchangeOf(requestOf(1), { text: "final" }, 12),
            ]),
            providerSession: providerSession("adapter:source"),
            worlds: [
                { name: "main", root: main },
                { name: "assets", root: assets },
            ],
        });
        assert.equal(inspection.terminal?.status, "finished");
        const checkpoint = inspection.checkpoints[0];
        assert.ok(checkpoint);
        // A checkpoint is accepted as atomic only when every claimed constituent is verified.
        assert.equal(classifyReplayCheckpoint(checkpoint).classification, "atomic");
        assert.equal(inspection.steps[4]?.provider?.cache?.status, "hit");
        sourceId = inspection.session_id;
        checkpointId = checkpoint.checkpoint_id;
        archive = store.exportTrace();
        expectedAssets = await readTree(assets);
        const final = await readTree(main);
        expectedMain = { ...final };
        delete expectedMain["final.txt"];
        delete expectedMain["audit.txt"];
    }

    // Replay of an imported, version-compatible archive in a fresh store.
    using imported = new SQLiteTraceStore(path.join(directory, "imported.sqlite"));
    imported.importTrace(archive);
    const rewoundMain = await emptyDirectory(directory, "rewound-main");
    const rewoundAssets = await emptyDirectory(directory, "rewound-assets");
    const restoredWorker = counter();
    const rewind = await rewindReplaySession(imported, {
        claimId: "operator",
        commandId: "rewind:conformance",
        processes: [restoredWorker],
        providerSession: providerSession("adapter:restored"),
        sourceSessionId: sourceId,
        target: { checkpointId },
        worlds: [
            { name: "main", root: rewoundMain },
            { name: "assets", root: rewoundAssets },
        ],
    });
    // The restored managed filesystem is byte-equivalent to the recorded cut.
    assert.deepEqual(await readTree(rewoundMain), expectedMain);
    assert.deepEqual(await readTree(rewoundAssets), expectedAssets);
    assert.equal(rewind.inspection.restore?.classification, "atomic");
    assert.deepEqual((await restoredWorker.request({ op: "read" })) as unknown, { count: 1 });

    const replayMain = await emptyDirectory(directory, "replay-main");
    const calls: string[] = [];
    const suffixProvider = providerOf("provider:alternate", [
        exchangeOf(requestOf(1), { text: "alternate" }, 12),
    ]);
    const replayWorker = counter();
    const replay = await replayReplaySession(imported, {
        changes: ["provider"],
        claimId: "operator",
        commandId: "replay:conformance",
        handlers: handlersFor(replayMain, replayWorker, calls),
        processes: [replayWorker],
        program: makeProgram(),
        provider: suffixProvider,
        providerSession: providerSession("adapter:replay"),
        sourceSessionId: sourceId,
        target: { checkpointId },
        worlds: [
            { name: "main", root: replayMain },
            { name: "assets", root: await emptyDirectory(directory, "replay-assets") },
        ],
    });
    assert.equal(replay.inspection.terminal?.status, "finished");
    // The recorded prefix never re-materializes effects; only suffix handlers ran.
    assert.deepEqual(calls, ["write:final.txt", "write:audit.txt"]);
    const divergence = analyzeReplayDivergence(imported, {
        replaySessionId: replay.inspection.session_id,
        sourceSessionId: sourceId,
    });
    // Only the intended suffix diverges: the changed provider step and its declared dependents.
    const affected = new Set(
        analyzeReplayDependencies(imported, { sessionId: sourceId, stepIndex: 4 }).dependents,
    ).add(4);
    assert.deepEqual(divergence.unexplained, []);
    assert.equal(divergence.first_divergence_index, 4);
    assert.ok(
        divergence.steps
            .filter((step) => step.status !== "identical")
            .every((step) => affected.has(step.index)),
    );
    assert.equal(divergence.steps[6]?.status, "identical");
    // Provider context prefix identity is verified, not assumed.
    assert.equal(
        replay.inspection.steps[4]?.provider?.cache?.prior_context_prefix_id,
        rewind.inspection.restore?.context_prefix_id,
    );

    const denied = await replayReplaySession(imported, {
        claimId: "operator",
        commandId: "replay:no-policy",
        handlers: worldHandlers(await emptyDirectory(directory, "denied"), calls),
        program: makeProgram(true),
        sourceSessionId: sourceId,
        target: { checkpointId },
        processes: [counter()],
        providerSession: providerSession("adapter:denied"),
        worlds: [
            { name: "main", root: await emptyDirectory(directory, "denied-main") },
            { name: "assets", root: await emptyDirectory(directory, "denied-assets") },
        ],
    });
    // Replay never re-materializes an irreversible effect without policy approval.
    assert.equal(denied.inspection.steps.at(-1)?.effect?.disposition, "refused");
    assert.equal(calls.includes("notify:effect:publish"), false);

    // Unsupported process checkpointing is reported accurately and refuses restoration.
    const { inspection: unsupported } = await runReplaySession(imported, {
        claimId: "worker:1",
        commandId: "session:transparent",
        processes: [createTransparentProcessAdapter({ processId: "tool" })],
        program: async (replayContext) => replayContext.checkpoint(),
        programId: "program:transparent",
    });
    const unavailable = classifyReplayCheckpoint(unsupported.checkpoints[0] as never).unavailable;
    assert.equal(unavailable.length, 1);
    assert.match(
        unavailable[0]?.reason ?? "",
        /transparent process checkpointing is unsupported|criu/u,
    );
    await assert.rejects(
        rewindReplaySession(imported, {
            claimId: "operator",
            commandId: "rewind:transparent",
            processes: [createTransparentProcessAdapter({ processId: "tool" })],
            sourceSessionId: unsupported.session_id,
            target: { checkpointId: unsupported.checkpoints[0]?.checkpoint_id as string },
        }),
        ReplayCheckpointUnavailableError,
    );
    assert.equal(imported.verifyIntegrity().ok, true);
});
