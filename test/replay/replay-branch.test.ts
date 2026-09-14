import assert from "node:assert/strict";
import { chmod, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import {
    analyzeReplayDivergence,
    createEffectHandlerStack,
    inspectReplaySession,
    ReplayCheckpointUnavailableError,
    ReplayEffectRefusedError,
    ReplayEvidenceError,
    ReplayRestoreError,
    replayReplaySession,
    rewindReplaySession,
    runReplaySession,
    SQLiteTraceStore,
    schema,
    task,
} from "../../src/index.ts";
import {
    emptyDirectory,
    exchangeOf,
    intentOf,
    providerOf,
    readTree,
    requestOf,
    reviewProgram,
    reviewProvider,
    temporaryDirectory,
    worldHandlers,
} from "./fixtures.ts";

async function recordReview(directory: string, store: SQLiteTraceStore) {
    const world = await emptyDirectory(directory, "world");
    const assets = await emptyDirectory(directory, "assets");
    await mkdir(path.join(world, "nested/empty"), { recursive: true });
    await writeFile(path.join(world, "nested/script.sh"), "#!/bin/sh\n");
    await chmod(path.join(world, "nested/script.sh"), 0o755);
    await symlink("script.sh", path.join(world, "nested/link"));
    await writeFile(path.join(assets, "logo.bin"), Buffer.from([0, 1, 2, 255]));
    const calls: string[] = [];
    const { inspection } = await runReplaySession(store, {
        claimId: "worker:1",
        commandId: "session:source",
        handlers: worldHandlers(world, calls),
        program: reviewProgram,
        programId: "program:review.v1",
        provider: reviewProvider(),
        worlds: [
            { name: "main", root: world },
            { name: "assets", root: assets },
        ],
    });
    const checkpoint = inspection.checkpoints[0];
    assert.ok(checkpoint);
    return { assets, calls, checkpoint, inspection, world };
}

test("rewind restores every world byte-equivalently and copies the verified prefix", async (context) => {
    const directory = await temporaryDirectory(context, "rewind");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const source = await recordReview(directory, store);
    assert.equal(source.checkpoint.step_count, 3);
    assert.equal(source.checkpoint.classification, "reconstructive");
    assert.deepEqual(
        source.checkpoint.constituents.map((constituent) => [
            constituent.kind,
            constituent.name,
            constituent.status,
        ]),
        [
            ["trace_cut", null, "verified"],
            ["world", "assets", "verified"],
            ["world", "main", "verified"],
            ["provider_session", null, "reconstructive"],
            ["irreversible_effects", null, "verified"],
        ],
    );
    const expectedMain = await readTree(source.world);
    await writeFile(path.join(source.world, "draft.txt"), "changed after the source finished");
    const main = await emptyDirectory(directory, "rewound-main");
    const assets = await emptyDirectory(directory, "rewound-assets");
    const options = {
        claimId: "operator",
        commandId: "rewind:checkpoint",
        sourceSessionId: source.inspection.session_id,
        target: { checkpointId: source.checkpoint.checkpoint_id },
        worlds: [
            { name: "main", root: main },
            { name: "assets", root: assets },
        ],
    };
    const { inspection } = await rewindReplaySession(store, options);
    assert.equal(inspection.mode, "rewind");
    assert.equal(inspection.terminal?.status, "rewound");
    assert.equal(inspection.restore?.classification, "reconstructive");
    assert.equal(inspection.restore?.prefix_id, source.checkpoint.prefix_id);
    assert.deepEqual(
        inspection.steps.map((step) => [step.source, step.step_id]),
        source.inspection.steps.slice(0, 3).map((step) => ["recorded", step.step_id]),
    );
    const restoredMain = await readTree(main);
    assert.deepEqual(
        { ...restoredMain, "final.txt": undefined },
        { ...expectedMain, "final.txt": undefined },
    );
    assert.equal(restoredMain["final.txt"], undefined);
    assert.equal(await readFile(path.join(main, "draft.txt"), "utf8"), "draft");
    assert.deepEqual(await readTree(assets), await readTree(source.assets));
    assert.equal(store.verifyIntegrity().ok, true);
    assert.deepEqual((await rewindReplaySession(store, options)).inspection, inspection);
    assert.equal(
        analyzeReplayDivergence(store, {
            replaySessionId: inspection.session_id,
            sourceSessionId: source.inspection.session_id,
        }).first_divergence_index,
        3,
    );
});

test("rewind refuses unavailable, inconsistent, and unverifiable targets before writing", async (context) => {
    const directory = await temporaryDirectory(context, "refusals");
    const databasePath = path.join(directory, "trace.sqlite");
    using store = new SQLiteTraceStore(databasePath);
    const source = await recordReview(directory, store);
    const main = await emptyDirectory(directory, "main");
    const assets = await emptyDirectory(directory, "assets-restore");
    const worlds = [
        { name: "main", root: main },
        { name: "assets", root: assets },
    ];
    const base = {
        claimId: "operator",
        sourceSessionId: source.inspection.session_id,
        target: { checkpointId: source.checkpoint.checkpoint_id },
        worlds,
    };
    await assert.rejects(
        rewindReplaySession(store, {
            ...base,
            commandId: "rewind:boundary",
            target: { stepCount: 3 },
        }),
        (error: unknown) =>
            error instanceof ReplayCheckpointUnavailableError &&
            error.unavailable.length === 2 &&
            error.unavailable[0]?.reason === "step boundary has no retained checkpoint",
    );
    await writeFile(path.join(main, "occupied"), "x");
    await assert.rejects(
        rewindReplaySession(store, { ...base, commandId: "rewind:occupied" }),
        /not empty/u,
    );
    await rm(path.join(main, "occupied"));
    for (const invalid of [
        { ...base, commandId: "rewind:names", worlds: [worlds[0]] },
        { ...base, commandId: "rewind:target", target: {} },
        { ...base, commandId: "rewind:both", target: { checkpointId: "x", stepCount: 1 } },
        { ...base, commandId: "rewind:count", target: { stepCount: 99 } },
        { ...base, commandId: "rewind:source", sourceSessionId: "" },
    ]) {
        await assert.rejects(rewindReplaySession(store, invalid as never), TypeError);
    }
    await assert.rejects(
        rewindReplaySession(store, {
            ...base,
            commandId: "rewind:unknown",
            target: { checkpointId: "replay-checkpoint:sha256:unknown" },
        }),
        ReplayEvidenceError,
    );
    const world = source.checkpoint.constituents.find((entry) => entry.name === "main");
    const digest = String(world?.evidence?.manifest_blob_id).split(":").at(-1) as string;
    await writeFile(
        path.join(`${databasePath}.blobs`, digest.slice(0, 2), digest),
        "corrupted manifest",
    );
    await assert.rejects(
        rewindReplaySession(store, { ...base, commandId: "rewind:missing-blob" }),
        ReplayRestoreError,
    );
    assert.deepEqual(await readTree(main), {});
    assert.equal(store.listOwnersBySchema("shepherd.replay.session.v1", 100, 0).length, 1);
});

test("replay reconstructs the prefix without invocation and diverges only in the intended suffix", async (context) => {
    const directory = await temporaryDirectory(context, "replay");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const source = await recordReview(directory, store);
    const main = await emptyDirectory(directory, "replay-main");
    const assets = await emptyDirectory(directory, "replay-assets");
    const calls: string[] = [];
    const invocations: number[] = [];
    const approvals: unknown[] = [];
    const { inspection } = await replayReplaySession(store, {
        changes: ["provider"],
        claimId: "operator",
        commandId: "replay:provider",
        handlers: worldHandlers(main, calls),
        policy: (request) => {
            approvals.push(request);
            return { approved: true, approverId: "reviewer", reason: "notify again" };
        },
        program: reviewProgram,
        provider: {
            descriptor: () => reviewProvider().descriptor(),
            invoke: async (request) => {
                const step = (request.input as { readonly step: number }).step;
                invocations.push(step);
                assert.equal(step, 1, "the recorded prefix must never reach the provider");
                return {
                    output: { text: "revised" },
                    usage: {
                        cacheCreationInputTokens: 0,
                        cacheReadInputTokens: 9,
                        costUsd: null,
                        inputTokens: 10,
                        outputTokens: 2,
                    },
                };
            },
        },
        sourceSessionId: source.inspection.session_id,
        target: { checkpointId: source.checkpoint.checkpoint_id },
        worlds: [
            { name: "main", root: main },
            { name: "assets", root: assets },
        ],
    });
    assert.equal(inspection.terminal?.status, "finished", JSON.stringify(inspection.terminal));
    assert.deepEqual(invocations, [1]);
    assert.deepEqual(calls, ["write:final.txt", "notify:effect:notify:2"]);
    assert.equal(await readFile(path.join(main, "final.txt"), "utf8"), "revised");
    assert.deepEqual(
        inspection.steps.map((step) => step.source),
        ["recorded", "recorded", "recorded", "live", "live", "live"],
    );
    assert.equal(inspection.steps[3]?.provider?.cache?.status, "hit");
    assert.equal(
        inspection.steps[3]?.provider?.prompt_id,
        source.inspection.steps[3]?.provider?.prompt_id,
    );
    assert.equal(
        inspection.steps[3]?.provider?.cache?.prior_context_prefix_id,
        source.inspection.steps[3]?.provider?.cache?.prior_context_prefix_id,
    );
    assert.deepEqual(inspection.steps[5]?.effect?.approval, {
        approver_id: "reviewer",
        reason: "notify again",
        rematerialization: true,
    });
    assert.equal(approvals.length, 1);
    assert.equal(inspection.checkpoints.length, 1);
    assert.equal(inspection.checkpoints[0]?.step_count, 3);
    const divergence = analyzeReplayDivergence(store, {
        replaySessionId: inspection.session_id,
        sourceSessionId: source.inspection.session_id,
    });
    assert.deepEqual(
        divergence.steps.map((step) => [step.status, step.cause]),
        [
            ["identical", null],
            ["identical", null],
            ["identical", null],
            ["diverged", "root"],
            ["diverged", "propagated"],
            ["identical", null],
        ],
    );
    assert.deepEqual(divergence.unexplained, []);
    assert.equal(divergence.common_prefix_id, source.checkpoint.prefix_id);
    assert.equal(store.verifyIntegrity().ok, true);
});

test("replay refuses unapproved irreversible suffix effects and detects prefix mismatches", async (context) => {
    const directory = await temporaryDirectory(context, "policy");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const source = await recordReview(directory, store);
    const branch = async (commandId: string, extra: Record<string, unknown>) => {
        const main = await emptyDirectory(directory, `${commandId}-main`);
        const assets = await emptyDirectory(directory, `${commandId}-assets`);
        const calls: string[] = [];
        const result = await replayReplaySession(store, {
            claimId: "operator",
            commandId,
            handlers: worldHandlers(main, calls),
            program: reviewProgram,
            provider: providerOf("provider:review", [exchangeOf(requestOf(1), { text: "final" })]),
            sourceSessionId: source.inspection.session_id,
            target: { checkpointId: source.checkpoint.checkpoint_id },
            worlds: [
                { name: "main", root: main },
                { name: "assets", root: assets },
            ],
            ...extra,
        } as never);
        return { calls, inspection: result.inspection };
    };
    const refused: unknown[] = [];
    const program = async (replayContext: Parameters<typeof reviewProgram>[0]) => {
        try {
            return await reviewProgram(replayContext);
        } catch (error) {
            refused.push(error);
            throw error;
        }
    };
    const missing = await branch("replay:no-policy", { program });
    assert.equal(missing.inspection.steps[5]?.effect?.disposition, "refused");
    assert.equal(
        missing.inspection.steps[5]?.effect?.refusal_reason,
        "no replay policy approves this effect",
    );
    assert.deepEqual(missing.calls, ["write:final.txt"]);
    assert.ok(refused[0] instanceof ReplayEffectRefusedError);
    assert.equal(missing.inspection.terminal?.failure?.name, "ReplayEffectRefusedError");
    const denied = await branch("replay:denied", {
        policy: () => ({ approved: false, reason: "no second notification" }),
    });
    assert.equal(denied.inspection.steps[5]?.effect?.refusal_reason, "no second notification");
    const broken = await branch("replay:broken-policy", {
        policy: () => ({ approved: "yes" }),
    });
    assert.equal(broken.inspection.steps[5]?.effect?.refusal_reason, "replay policy failed");
    const throwing = await branch("replay:throwing-policy", {
        policy: () => {
            throw new Error("policy offline");
        },
    });
    assert.equal(throwing.inspection.steps[5]?.effect?.refusal_reason, "replay policy failed");
    const analysis = analyzeReplayDivergence(store, {
        replaySessionId: denied.inspection.session_id,
        sourceSessionId: source.inspection.session_id,
    });
    assert.deepEqual(analysis.steps[5], {
        cause: "root",
        index: 5,
        replay_step_id: denied.inspection.steps[5]?.step_id,
        source_step_id: source.inspection.steps[5]?.step_id,
        status: "diverged",
    });

    const mismatched = await branch("replay:mismatch", {
        program: async (replayContext: Parameters<typeof reviewProgram>[0]) => {
            await replayContext.invokeProvider(requestOf(0, "different instruction"));
        },
    });
    assert.equal(mismatched.inspection.terminal?.failure?.name, "ReplayPrefixMismatchError");
    assert.equal(mismatched.inspection.steps.length, 0);
    const shortened = await branch("replay:short", { program: () => "stopped early" });
    assert.match(shortened.inspection.terminal?.failure?.message ?? "", /ended before/u);
    const reordered = await branch("replay:reordered", {
        program: async (replayContext: Parameters<typeof reviewProgram>[0]) => {
            const plan = await replayContext.invokeProvider(requestOf(0));
            await replayContext.dispatchEffect(
                intentOf("effect:notify:1", "notify", { stage: "draft" }, "irreversible"),
                { dependsOn: [plan.handle] },
            );
        },
    });
    assert.equal(reordered.inspection.steps.length, 1);
    assert.equal(reordered.inspection.terminal?.failure?.name, "ReplayPrefixMismatchError");
    const noCheckpoint = await branch("replay:skipped-checkpoint", {
        program: async (replayContext: Parameters<typeof reviewProgram>[0]) => {
            await replayContext.checkpoint();
        },
    });
    assert.equal(noCheckpoint.inspection.terminal?.failure?.name, "ReplayPrefixMismatchError");
    await assert.rejects(
        branch("replay:not-a-change", { task: { descriptor: {}, input: null } }),
        TypeError,
    );
    await assert.rejects(branch("replay:policy-type", { policy: 1 }), TypeError);
    await assert.rejects(branch("replay:changes", { changes: ["provider", "task"] }), TypeError);
});

test("replay serves recorded failures and checkpoints and replays trace-only step boundaries", async (context) => {
    const directory = await temporaryDirectory(context, "trace-only");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const summarize = task({
        input: schema.object({ topic: schema.string() }),
        instruction: "Summarize the topic.",
        name: "summarize",
        output: schema.object({ text: schema.string() }),
        version: "1",
    });
    const revised = task({
        input: schema.object({ topic: schema.string() }),
        instruction: "Summarize the topic briefly.",
        name: "summarize",
        output: schema.object({ text: schema.string() }),
        version: "2",
    });
    const requestFor = (descriptor: typeof summarize) => ({
        input: { topic: "replay" },
        instruction: descriptor.instruction,
        outputSchema: descriptor.artifact.output_schema,
    });
    const handlers = createEffectHandlerStack([
        {
            handle: () => {
                throw new Error("tool crashed");
            },
            handlerId: "handler:tool",
            kind: "tool",
        },
    ]);
    const program = async (replayContext: Parameters<typeof reviewProgram>[0]) => {
        await replayContext.checkpoint();
        const failed = await replayContext
            .dispatchEffect(intentOf("effect:tool", "tool", { run: true }))
            .catch((error: unknown) => error);
        assert.equal((failed as Error).name, "ReplayStepFailureError");
        await replayContext.checkpoint();
        await replayContext.checkpoint();
        const summary = await replayContext.invokeTask({ dependsOn: [] });
        return summary.response.output;
    };
    const { inspection: source } = await runReplaySession(store, {
        claimId: "worker:1",
        commandId: "session:task",
        handlers,
        program,
        programId: "program:task",
        provider: providerOf("provider:1", [exchangeOf(requestFor(summarize), { text: "long" })]),
        task: { descriptor: summarize as never, input: { topic: "replay" } },
    });
    assert.equal(source.terminal?.status, "finished");
    assert.equal(source.checkpoints.length, 2);
    const rewound = await rewindReplaySession(store, {
        claimId: "operator",
        commandId: "rewind:boundary",
        sourceSessionId: source.session_id,
        target: { stepCount: 1 },
    });
    assert.equal(rewound.inspection.restore?.classification, "reconstructive");
    assert.deepEqual(
        rewound.inspection.restore?.constituents.map((entry) => entry.kind),
        ["trace_cut", "provider_session", "irreversible_effects"],
    );
    const replay = await replayReplaySession(store, {
        changes: ["task"],
        claimId: "operator",
        commandId: "replay:task",
        handlers,
        program,
        provider: providerOf("provider:1", [exchangeOf(requestFor(revised), { text: "short" })]),
        sourceSessionId: source.session_id,
        target: { stepCount: 1 },
        task: { descriptor: revised as never, input: { topic: "replay" } },
    });
    assert.deepEqual(replay.inspection.terminal?.result, { value: { text: "short" } });
    assert.equal(replay.inspection.origin?.replacement_task?.instruction, revised.instruction);
    assert.equal(replay.inspection.steps[0]?.effect?.disposition, "materialization_failed");
    assert.equal(replay.inspection.checkpoints[0]?.step_count, 1);
    await assert.rejects(
        replayReplaySession(store, {
            changes: ["task"],
            claimId: "operator",
            commandId: "replay:same-task",
            program,
            sourceSessionId: source.session_id,
            target: { stepCount: 0 },
            task: { descriptor: summarize as never, input: { topic: "replay" } },
        }),
        /must replace the source task/u,
    );
    const noProvider = await rewindReplaySession(store, {
        claimId: "operator",
        commandId: "rewind:origin",
        sourceSessionId: (
            await runReplaySession(store, {
                claimId: "worker:1",
                commandId: "session:empty",
                program: () => null,
                programId: "program:empty",
            })
        ).inspection.session_id,
        target: { stepCount: 0 },
    });
    assert.equal(noProvider.inspection.restore?.constituents[1]?.status, "not_applicable");
    assert.equal(noProvider.inspection.restore?.classification, "atomic");
});

test("branches from interrupted sources and imported archives replay with verified identities", async (context) => {
    const directory = await temporaryDirectory(context, "imported");
    const sourcePath = path.join(directory, "source.sqlite");
    let archive: string;
    let sourceId: string;
    let checkpointId: string;
    {
        using store = new SQLiteTraceStore(sourcePath);
        const source = await recordReview(directory, store);
        archive = store.exportTrace();
        sourceId = source.inspection.session_id;
        checkpointId = source.checkpoint.checkpoint_id;
    }
    using imported = new SQLiteTraceStore(path.join(directory, "imported.sqlite"));
    imported.importTrace(archive);
    assert.equal(inspectReplaySession(imported, { sessionId: sourceId }).live, false);
    const main = await emptyDirectory(directory, "imported-main");
    const assets = await emptyDirectory(directory, "imported-assets");
    const calls: string[] = [];
    const { inspection } = await replayReplaySession(imported, {
        claimId: "operator",
        commandId: "replay:imported",
        handlers: worldHandlers(main, calls),
        policy: () => ({ approved: true, approverId: "reviewer", reason: "fixture" }),
        program: reviewProgram,
        provider: providerOf("provider:review", [exchangeOf(requestOf(1), { text: "final" })]),
        sourceSessionId: sourceId,
        target: { checkpointId },
        worlds: [
            { name: "main", root: main },
            { name: "assets", root: assets },
        ],
    });
    assert.equal(inspection.terminal?.status, "finished");
    assert.equal(await readFile(path.join(main, "draft.txt"), "utf8"), "draft");
    const divergence = analyzeReplayDivergence(imported, {
        replaySessionId: inspection.session_id,
        sourceSessionId: sourceId,
    });
    assert.equal(divergence.first_divergence_index, null);
    assert.deepEqual(divergence.unexplained, []);
    assert.equal(imported.verifyIntegrity().ok, true);

    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    const running = runReplaySession(imported, {
        claimId: "worker:crashed",
        commandId: "session:interrupted",
        handlers: worldHandlers(main, []),
        program: async (replayContext) => {
            await replayContext.invokeProvider(requestOf(0));
            await gate;
        },
        programId: "program:review.v1",
        provider: reviewProvider(),
    });
    const interruptedId = await inspectRunning(imported);
    const partial = await rewindReplaySession(imported, {
        claimId: "operator",
        commandId: "rewind:interrupted",
        sourceSessionId: interruptedId,
        target: { stepCount: 1 },
    });
    assert.equal(partial.inspection.steps.length, 1);
    release();
    await running;
});

async function inspectRunning(store: SQLiteTraceStore): Promise<string> {
    for (;;) {
        for (const owner of store.listOwnersBySchema("shepherd.replay.session.v1", 100, 0)) {
            const inspection = inspectReplaySession(store, { sessionId: owner });
            if (inspection.classification === "running" && inspection.steps.length === 1) {
                return owner;
            }
        }
        await new Promise((resolve) => setTimeout(resolve, 2));
    }
}
