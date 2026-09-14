import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
    createCooperativeProcessAdapter,
    deriveReplaySessionId,
    inspectReplaySession,
    ReplayEvidenceError,
    type ReplaySessionContext,
    replayReplaySession,
    runReplaySession,
    SQLiteTraceStore,
    schema,
    task,
} from "../../src/index.ts";
import { foldReplaySession } from "../../src/replay/inspection.ts";
import { verifyReplayWorldImage } from "../../src/replay/world-image.ts";
import type { OwnerRecord } from "../../src/store/types.ts";
import { readReferenceCopyManifest } from "../../src/workspace/reference-copy-carrier.ts";
import {
    COUNTER_WORKER,
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

type Body = Record<string, unknown>;

test("an effect admitted without a step in the source is gated as possibly materialized", async (context) => {
    using store = new SQLiteTraceStore();
    let now = 1_000;
    await assert.rejects(
        runReplaySession(store, {
            claimId: "worker:1",
            clock: () => now,
            commandId: "session:uncertain-source",
            handlers: {
                dispatch: async () => {
                    now += 3_600_000;
                    return { handlerId: "handler", outcome: null };
                },
            } as never,
            program: async (replayContext) => {
                await replayContext.checkpoint();
                await replayContext.dispatchEffect(intentOf("effect:charge", "notify", {}));
            },
            programId: "program:uncertain",
        }),
    );
    const sourceId = deriveReplaySessionId("session:uncertain-source");
    const source = inspectReplaySession(store, { clock: () => now, sessionId: sourceId });
    assert.equal(source.classification, "materialization_uncertain");
    const calls: string[] = [];
    const program = async (replayContext: ReplaySessionContext) =>
        replayContext.dispatchEffect(intentOf("effect:charge", "notify", {}));
    const refused = await replayReplaySession(store, {
        claimId: "operator",
        commandId: "replay:uncertain-refused",
        handlers: worldHandlers(await temporaryDirectory(context, "uncertain"), calls),
        program,
        sourceSessionId: sourceId,
        target: { stepCount: 0 },
    });
    assert.equal(refused.inspection.steps[0]?.effect?.disposition, "refused");
    assert.deepEqual(calls, []);
    const requests: unknown[] = [];
    const approved = await replayReplaySession(store, {
        claimId: "operator",
        commandId: "replay:uncertain-approved",
        handlers: worldHandlers(await temporaryDirectory(context, "uncertain-approved"), calls),
        policy: (request) => {
            requests.push(request.source_materialized_step_index);
            return { approved: true, approverId: "reviewer", reason: "verified externally" };
        },
        program,
        sourceSessionId: sourceId,
        target: { stepCount: 0 },
    });
    assert.deepEqual(requests, [0]);
    assert.equal(approved.inspection.steps[0]?.effect?.approval?.rematerialization, true);
    assert.deepEqual(calls, ["notify:effect:charge"]);
});

test("a cooperative process that closes its input fails the request without crashing the host", async (context) => {
    const closed = createCooperativeProcessAdapter({
        args: ["-c", "exec 0<&-; sleep 3"],
        command: "/bin/sh",
        processId: "closed",
    });
    context.after(() => closed.close());
    await assert.rejects(closed.request({ op: "read" }), /input closed|exited/u);
    const huge = createCooperativeProcessAdapter({
        args: [
            "-e",
            "process.stdin.once('data', () => process.stdout.write('x'.repeat(22369825) + '\\n'))",
        ],
        command: process.execPath,
        processId: "huge-line",
    });
    context.after(() => huge.close());
    await assert.rejects(huge.request({ op: "read" }), /exceeds the configured bound/u);
    const healthy = createCooperativeProcessAdapter({
        args: [COUNTER_WORKER],
        command: process.execPath,
        processId: "ok",
    });
    context.after(() => healthy.close());
    assert.equal((await healthy.probe()).available, true);
});

test("inspection binds checkpoint constituents, restores, approvals, and recorded steps to their evidence", async (context) => {
    const directory = await temporaryDirectory(context, "bindings");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const world = await emptyDirectory(directory, "world");
    const { inspection: source } = await runReplaySession(store, {
        claimId: "worker:1",
        commandId: "session:bindings",
        handlers: worldHandlers(world),
        processes: [
            {
                backend: "cooperative",
                checkpoint: async () => new Uint8Array([1]),
                probe: async () => ({ available: true }),
                processId: "process:1",
                restore: async () => undefined,
            },
        ],
        program: reviewProgram,
        programId: "program:review.v1",
        provider: reviewProvider(),
        worlds: [{ name: "main", root: world }],
    });
    const { inspection: branch } = await replayReplaySession(store, {
        claimId: "operator",
        commandId: "replay:bindings",
        handlers: worldHandlers(await emptyDirectory(directory, "branch")),
        policy: () => ({ approved: true, approverId: "reviewer", reason: "ok" }),
        processes: [
            {
                backend: "cooperative",
                checkpoint: async () => new Uint8Array([1]),
                probe: async () => ({ available: true }),
                processId: "process:1",
                restore: async () => undefined,
            },
        ],
        program: reviewProgram,
        provider: providerOf("p", [exchangeOf(requestOf(1), { text: "final" })]),
        sourceSessionId: source.session_id,
        target: { checkpointId: source.checkpoints[0]?.checkpoint_id as string },
        worlds: [{ name: "main", root: await emptyDirectory(directory, "branch-main") }],
    });
    const tamper =
        (sessionId: string, schemaRef: string, occurrence: number, edit: (body: Body) => void) =>
        () => {
            let seen = -1;
            const records = store.readOwner(sessionId).map((record) => {
                if (record.envelope.schema_ref !== schemaRef || ++seen !== occurrence) {
                    return record;
                }
                const body = structuredClone(record.body) as Body;
                edit(body);
                return { ...record, body } as unknown as OwnerRecord;
            });
            return foldReplaySession(store, sessionId, records, undefined, Date.now());
        };
    const constituent = (body: Body, kind: string) =>
        (body.constituents as Body[]).find((entry) => entry.kind === kind) as Body;
    const checkpointEdits: ((body: Body) => void)[] = [
        (body) => {
            Object.assign(constituent(body, "provider_session"), { status: "not_applicable" });
            body.classification = "atomic";
            Object.assign(constituent(body, "world"), {});
        },
        (body) => {
            Object.assign(constituent(body, "world"), {
                evidence: null,
                receipt_id: null,
                status: "not_applicable",
            });
        },
        (body) => {
            Object.assign(constituent(body, "world"), {
                evidence: { entry_count: -1, manifest_blob_id: "x" },
            });
        },
        (body) => {
            (constituent(body, "process").evidence as Body).backend = "transparent";
        },
        (body) => {
            constituent(body, "irreversible_effects").evidence = { step_indices: [] };
        },
        (body) => {
            constituent(body, "trace_cut").evidence = { extra: true };
        },
    ];
    for (const edit of checkpointEdits) {
        assert.throws(
            tamper(source.session_id, "shepherd.replay.checkpoint.v1", 0, edit),
            ReplayEvidenceError,
        );
    }
    const restoreEdits: ((body: Body) => void)[] = [
        (body) => {
            constituent(body, "world").receipt_id = "world-content:sha256:forged";
        },
        (body) => {
            body.context_prefix_id = null;
        },
    ];
    for (const edit of restoreEdits) {
        assert.throws(
            tamper(branch.session_id, "shepherd.replay.restore.v1", 0, edit),
            ReplayEvidenceError,
        );
    }
    for (const [sessionId, occurrence, edit] of [
        [
            branch.session_id,
            5,
            (body: Body) => {
                (body.effect as Body).approval = null;
            },
        ],
        [
            branch.session_id,
            5,
            (body: Body) => {
                ((body.effect as Body).approval as Body).rematerialization = false;
            },
        ],
        [
            source.session_id,
            1,
            (body: Body) => {
                (body.effect as Body).approval = {
                    approver_id: "a",
                    reason: "r",
                    rematerialization: false,
                };
            },
        ],
        [
            branch.session_id,
            2,
            (body: Body) => {
                (body.effect as Body).approval = {
                    approver_id: "forged",
                    reason: "r",
                    rematerialization: false,
                };
            },
        ],
    ] as const) {
        assert.throws(
            tamper(sessionId, "shepherd.replay.step.v1", occurrence, edit),
            ReplayEvidenceError,
        );
    }
});

test("nested replays resolve the task in force through branch ancestry", async () => {
    using store = new SQLiteTraceStore();
    const make = (version: string, instruction: string) =>
        task({
            input: schema.object({ topic: schema.string() }),
            instruction,
            name: "summarize",
            output: schema.object({ text: schema.string() }),
            version,
        });
    const first = make("1", "Summarize.");
    const second = make("2", "Summarize briefly.");
    const third = make("3", "Summarize in one word.");
    const requestFor = (descriptor: typeof first) => ({
        input: { topic: "replay" },
        instruction: descriptor.instruction,
        outputSchema: descriptor.artifact.output_schema,
    });
    const program = async (replayContext: ReplaySessionContext) => {
        await replayContext.invokeTask({ dependsOn: [] });
        await replayContext.invokeTask({ dependsOn: [] });
        return (await replayContext.invokeTask({ dependsOn: [] })).response.output;
    };
    const exchanges = (descriptor: typeof first, count: number) =>
        Array.from({ length: count }, () =>
            exchangeOf(requestFor(descriptor), { text: descriptor.instruction }),
        );
    const { inspection: a } = await runReplaySession(store, {
        claimId: "worker:1",
        commandId: "session:nested-a",
        program,
        programId: "program:nested",
        provider: providerOf("p", exchanges(first, 3)),
        task: { descriptor: first as never, input: { topic: "replay" } },
    });
    const { inspection: b } = await replayReplaySession(store, {
        changes: ["task"],
        claimId: "operator",
        commandId: "replay:nested-b",
        program,
        provider: providerOf("p", exchanges(second, 2)),
        sourceSessionId: a.session_id,
        target: { stepCount: 1 },
        task: { descriptor: second as never, input: { topic: "replay" } },
    });
    assert.equal(b.terminal?.status, "finished");
    const { inspection: c } = await replayReplaySession(store, {
        claimId: "operator",
        commandId: "replay:nested-c",
        program,
        provider: providerOf("p", exchanges(second, 1)),
        sourceSessionId: b.session_id,
        target: { stepCount: 2 },
    });
    assert.equal(c.terminal?.status, "finished", JSON.stringify(c.terminal));
    assert.deepEqual(c.terminal?.result, { value: { text: second.instruction } });
    const { inspection: d } = await replayReplaySession(store, {
        changes: ["task"],
        claimId: "operator",
        commandId: "replay:nested-d",
        program,
        provider: providerOf("p", exchanges(third, 1)),
        sourceSessionId: c.session_id,
        target: { stepCount: 2 },
        task: { descriptor: third as never, input: { topic: "replay" } },
    });
    assert.deepEqual(d.terminal?.result, { value: { text: third.instruction } });
    await assert.rejects(
        replayReplaySession(store, {
            changes: ["task"],
            claimId: "operator",
            commandId: "replay:nested-same",
            program,
            sourceSessionId: b.session_id,
            target: { stepCount: 2 },
            task: { descriptor: second as never, input: { topic: "replay" } },
        }),
        /must replace the source task/u,
    );
});

test("live writers classify as running, imported terminals replay receipts, and manifests refuse protected names", async (context) => {
    using store = new SQLiteTraceStore();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    const running = runReplaySession(store, {
        claimId: "worker:1",
        commandId: "session:inside-handler",
        handlers: {
            dispatch: async () => {
                await gate;
                throw new Error("released");
            },
        } as never,
        program: async (replayContext) =>
            replayContext.dispatchEffect(intentOf("effect:1", "notify", {})).catch(() => null),
        programId: "program:inside",
    });
    const sessionId = deriveReplaySessionId("session:inside-handler");
    while (
        store.readOwner(sessionId).at(-1)?.envelope.schema_ref !== "shepherd.replay.admission.v1"
    ) {
        await new Promise((resolve) => setTimeout(resolve, 2));
    }
    assert.equal(inspectReplaySession(store, { sessionId }).classification, "running");
    release();
    await running;

    const options = {
        claimId: "w",
        commandId: "session:imported",
        program: () => 1,
        programId: "p",
    };
    await runReplaySession(store, options);
    using imported = new SQLiteTraceStore();
    imported.importTrace(store.exportTrace());
    assert.equal(
        (await runReplaySession(imported, options)).inspection.terminal?.status,
        "finished",
    );

    const root = realpathSync(await temporaryDirectory(context, "manifest"));
    const entry = (overrides: Record<string, unknown>) => ({
        blob_id: null,
        kind: "directory",
        mode: 0o755,
        path: "safe",
        size: null,
        symlink_target: null,
        ...overrides,
    });
    const notArray = imported.putBlob(Buffer.from("{}"));
    assert.throws(
        () =>
            verifyReplayWorldImage(
                imported,
                { content_id: "x", entry_count: 0, manifest_blob_id: notArray.blob_id },
                root,
            ),
        /incomplete or corrupt/u,
    );
    assert.throws(() => readReferenceCopyManifest(root, [entry({ path: ".vcscore" })]));
    assert.throws(() => readReferenceCopyManifest(root, [entry({ mode: 0o000 })]));
    assert.equal(readReferenceCopyManifest(root, [entry({})]).manifest.length, 1);
});
