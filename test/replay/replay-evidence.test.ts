import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import {
    ReplayCompatibilityError,
    ReplayEvidenceError,
    ReplayMaterializationUncertainError,
    type ReplaySessionInspection,
    replayReplaySession,
    runReplaySession,
    SQLiteTraceStore,
    schema,
    task,
} from "../../src/index.ts";
import { foldReplaySession } from "../../src/replay/inspection.ts";
import {
    createReplayFailure,
    readReplayAdmissionBody,
    readReplayCheckpointBody,
    readReplayReason,
    readReplayRestoreBody,
    readReplaySessionBody,
    readReplayStepBody,
    readReplayTerminalBody,
} from "../../src/replay/records.ts";
import { verifyReplayWorldImage } from "../../src/replay/world-image.ts";
import type { OwnerRecord } from "../../src/store/types.ts";
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

type Body = Record<string, unknown>;

async function fixtureSessions(directory: string, store: SQLiteTraceStore) {
    const world = await emptyDirectory(directory, "world");
    const summarize = task({
        input: schema.object({ topic: schema.string() }),
        instruction: "Summarize.",
        name: "summarize",
        output: schema.object({ text: schema.string() }),
        version: "1",
    });
    const revised = task({
        input: schema.object({ topic: schema.string() }),
        instruction: "Summarize briefly.",
        name: "summarize",
        output: schema.object({ text: schema.string() }),
        version: "2",
    });
    const root = await runReplaySession(store, {
        claimId: "worker:1",
        commandId: "session:evidence",
        handlers: worldHandlers(world),
        processes: [
            {
                backend: "cooperative",
                checkpoint: async () => new Uint8Array([7]),
                probe: async () => ({ available: true }),
                processId: "process:1",
                restore: async () => undefined,
            },
        ],
        program: reviewProgram,
        programId: "program:review.v1",
        provider: reviewProvider(),
        task: { descriptor: summarize as never, input: { topic: "x" } },
        worlds: [{ name: "main", root: world }],
    });
    const failed = await runReplaySession(store, {
        claimId: "worker:1",
        commandId: "session:failed",
        handlers: worldHandlers(world),
        program: async (replayContext) => {
            await replayContext
                .invokeProvider(requestOf(5))
                .catch(() => replayContext.dispatchEffect(intentOf("effect:x", "missing", {})))
                .catch(() => undefined);
            await replayContext.checkpoint();
            throw new Error("stop");
        },
        programId: "program:failed",
        provider: providerOf("p", []),
    });
    const checkpoint = root.inspection.checkpoints[0]?.checkpoint_id as string;
    const branch = await replayReplaySession(store, {
        changes: ["task"],
        claimId: "operator",
        commandId: "replay:evidence",
        handlers: worldHandlers(await emptyDirectory(directory, "branch")),
        policy: () => ({ approved: false, reason: "refused" }),
        processes: [
            {
                backend: "cooperative",
                checkpoint: async () => new Uint8Array([7]),
                probe: async () => ({ available: true }),
                processId: "process:1",
                restore: async () => undefined,
            },
        ],
        program: reviewProgram,
        provider: providerOf("p", [exchangeOf(requestOf(1), { text: "final" })]),
        sourceSessionId: root.inspection.session_id,
        target: { checkpointId: checkpoint },
        task: { descriptor: revised as never, input: { topic: "x" } },
        worlds: [{ name: "main", root: await emptyDirectory(directory, "branch-main") }],
    });
    const boundary = await replayReplaySession(store, {
        claimId: "operator",
        commandId: "replay:boundary",
        program: async () => null,
        sourceSessionId: failed.inspection.session_id,
        target: { stepCount: 0 },
    });
    return {
        boundary: boundary.inspection,
        branch: branch.inspection,
        failed: failed.inspection,
        root: root.inspection,
    };
}

function bodies(
    store: SQLiteTraceStore,
    inspection: ReplaySessionInspection,
    schemaRef: string,
): Body[] {
    return store
        .readOwner(inspection.session_id)
        .filter((record) => record.envelope.schema_ref === schemaRef)
        .map((record) => structuredClone(record.body) as Body);
}

function rejects(read: (body: never) => unknown, body: Body, mutate: (body: Body) => void): void {
    const copy = structuredClone(body);
    mutate(copy);
    assert.throws(() => read(copy as never), ReplayEvidenceError, mutate.toString());
}

test("record readers reject malformed, forged, and incompatible replay evidence", async (context) => {
    const directory = await temporaryDirectory(context, "evidence");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const { boundary, branch, failed, root } = await fixtureSessions(directory, store);
    const [rootSession] = bodies(store, root, "shepherd.replay.session.v1") as [Body];
    const [branchSession] = bodies(store, branch, "shepherd.replay.session.v1") as [Body];
    const origin = (value: Body) => value.origin as Body;
    for (const mutate of [
        (value: Body) => {
            value.origin = origin(branchSession);
        },
        (value: Body) => {
            value.session_id = branchSession.session_id;
        },
        (value: Body) => {
            value.provider_session_adapter_id = "";
        },
        (value: Body) => {
            value.provider = { id: "x" };
        },
        (value: Body) => {
            value.worlds = ["b", "a"];
        },
        (value: Body) => {
            value.processes = [{ backend: "unknown", process_id: "p" }];
        },
        (value: Body) => {
            value.processes = [
                { backend: "cooperative", process_id: "b" },
                { backend: "cooperative", process_id: "a" },
            ];
        },
        (value: Body) => {
            value.task = { instruction: "x" };
        },
    ]) {
        rejects(readReplaySessionBody, rootSession, mutate);
    }
    for (const mutate of [
        (value: Body) => {
            origin(value).changes = ["provider", "task"];
        },
        (value: Body) => {
            origin(value).changes = [];
        },
        (value: Body) => {
            origin(value).target_checkpoint_id = "checkpoint";
        },
        (value: Body) => {
            value.mode = "root";
        },
    ]) {
        rejects(readReplaySessionBody, branchSession, mutate);
    }
    rejects(
        readReplaySessionBody,
        bodies(store, boundary, "shepherd.replay.session.v1")[0] as Body,
        (value) => {
            origin(value).replacement_task = rootSession.task;
        },
    );

    const steps = [
        ...bodies(store, root, "shepherd.replay.step.v1"),
        ...bodies(store, failed, "shepherd.replay.step.v1"),
        ...bodies(store, branch, "shepherd.replay.step.v1"),
    ];
    const provider = steps.find((step) => step.provider !== null && step.source === "live") as Body;
    const failedProvider = steps.find(
        (step) => (step.provider as Body | null)?.failure !== null && step.provider !== null,
    ) as Body;
    const materialized = steps.find(
        (step) => (step.effect as Body | null)?.disposition === "materialized",
    ) as Body;
    const failedEffect = steps.find(
        (step) => (step.effect as Body | null)?.disposition === "materialization_failed",
    ) as Body;
    const refused = steps.find(
        (step) => (step.effect as Body | null)?.disposition === "refused",
    ) as Body;
    const recorded = steps.find((step) => step.source === "recorded") as Body;
    const detail = (value: Body, key: "effect" | "provider") => value[key] as Body;
    for (const [body, mutate] of [
        [
            recorded,
            (value: Body) => {
                value.source_step_record_id = null;
            },
        ],
        [
            provider,
            (value: Body) => {
                value.source_step_record_id = recorded.source_step_record_id;
            },
        ],
        [
            provider,
            (value: Body) => {
                value.source = "unknown";
            },
        ],
        [
            provider,
            (value: Body) => {
                value.effect = materialized.effect;
            },
        ],
        [
            provider,
            (value: Body) => {
                value.step_id = materialized.step_id;
            },
        ],
        [
            provider,
            (value: Body) => {
                value.depends_on = [0, 0];
            },
        ],
        [
            provider,
            (value: Body) => {
                value.index = 4096;
            },
        ],
        [
            provider,
            (value: Body) => {
                detail(value, "provider").failure = { message: "x", name: "Error" };
            },
        ],
        [
            provider,
            (value: Body) => {
                detail(value, "provider").prompt_id = detail(failedProvider, "provider").prompt_id;
            },
        ],
        [
            provider,
            (value: Body) => {
                (detail(value, "provider").cache as Body).status = "hit";
            },
        ],
        [
            provider,
            (value: Body) => {
                (detail(value, "provider").cache as Body).identity = "";
            },
        ],
        [
            provider,
            (value: Body) => {
                (detail(value, "provider").cache as Body).prior_context_prefix_id = "prefix";
            },
        ],
        [
            failedProvider,
            (value: Body) => {
                detail(value, "provider").failure = { message: "x".repeat(4097), name: "Error" };
            },
        ],
        [
            materialized,
            (value: Body) => {
                detail(value, "effect").intent_ref = detail(failedEffect, "effect").intent_ref;
            },
        ],
        [
            materialized,
            (value: Body) => {
                detail(value, "effect").approval = {
                    approver_id: "a",
                    reason: "r",
                    rematerialization: "no",
                };
            },
        ],
        [
            materialized,
            (value: Body) => {
                detail(value, "effect").handler_id = null;
            },
        ],
        [
            materialized,
            (value: Body) => {
                detail(value, "effect").refusal_reason = "why";
            },
        ],
        [
            refused,
            (value: Body) => {
                detail(value, "effect").approval = {
                    approver_id: "a",
                    reason: "r",
                    rematerialization: false,
                };
            },
        ],
        [
            refused,
            (value: Body) => {
                detail(value, "effect").refusal_reason = "x".repeat(4097);
            },
        ],
        [
            failedEffect,
            (value: Body) => {
                detail(value, "effect").failure = null;
            },
        ],
        [
            failedEffect,
            (value: Body) => {
                detail(value, "effect").disposition = "unknown";
            },
        ],
    ] as const) {
        rejects(readReplayStepBody, body, mutate);
    }
    const [admission] = bodies(store, root, "shepherd.replay.admission.v1") as [Body];
    rejects(readReplayAdmissionBody, admission, (value) => {
        value.index = -1;
    });
    const checkpoint = bodies(store, root, "shepherd.replay.checkpoint.v1")[0] as Body;
    const zeroCheckpoint = bodies(store, failed, "shepherd.replay.checkpoint.v1")[0] as Body;
    const constituents = (value: Body) => value.constituents as Body[];
    for (const [body, mutate] of [
        [
            checkpoint,
            (value: Body) => {
                value.classification = "unavailable";
            },
        ],
        [
            checkpoint,
            (value: Body) => {
                value.checkpoint_id = zeroCheckpoint.checkpoint_id;
            },
        ],
        [
            checkpoint,
            (value: Body) => {
                value.step_count = 4097;
            },
        ],
        [
            checkpoint,
            (value: Body) => {
                value.context_prefix_id = "context";
            },
        ],
        [
            checkpoint,
            (value: Body) => {
                value.step_count = 0;
            },
        ],
        [
            checkpoint,
            (value: Body) => {
                value.constituents = [];
            },
        ],
        [
            checkpoint,
            (value: Body) => {
                value.constituents = [...constituents(value)].reverse();
            },
        ],
        [
            checkpoint,
            (value: Body) => {
                (constituents(value)[0] as Body).receipt_id = null;
            },
        ],
        [
            checkpoint,
            (value: Body) => {
                (constituents(value)[0] as Body).reason = "why";
            },
        ],
        [
            checkpoint,
            (value: Body) => {
                (constituents(value)[0] as Body).kind = "unknown";
            },
        ],
        [
            checkpoint,
            (value: Body) => {
                (constituents(value)[0] as Body).name = "";
            },
        ],
        [
            checkpoint,
            (value: Body) => {
                (constituents(value)[1] as Body).evidence = [];
            },
        ],
        [
            checkpoint,
            (value: Body) => {
                (constituents(value)[0] as Body).status = "unavailable";
                (constituents(value)[0] as Body).receipt_id = null;
            },
        ],
    ] as const) {
        rejects(readReplayCheckpointBody, body, mutate);
    }
    const [restore] = bodies(store, branch, "shepherd.replay.restore.v1") as [Body];
    for (const mutate of [
        (value: Body) => {
            value.prefix_id = "prefix";
        },
        (value: Body) => {
            value.context_prefix_id = "context";
        },
        (value: Body) => {
            value.classification = "atomic";
        },
    ]) {
        rejects(readReplayRestoreBody, restore, mutate);
    }
    const [finished] = bodies(store, root, "shepherd.replay.terminal.v1") as [Body];
    const [failedTerminal] = bodies(store, failed, "shepherd.replay.terminal.v1") as [Body];
    for (const [body, mutate] of [
        [
            finished,
            (value: Body) => {
                value.failure = { message: "x", name: "Error" };
            },
        ],
        [
            finished,
            (value: Body) => {
                value.result = { other: 1 };
            },
        ],
        [
            failedTerminal,
            (value: Body) => {
                value.result = { value: 1 };
            },
        ],
        [
            failedTerminal,
            (value: Body) => {
                value.status = "unknown";
            },
        ],
        [
            failedTerminal,
            (value: Body) => {
                value.failure = { message: 1, name: "Error" };
            },
        ],
    ] as const) {
        rejects(readReplayTerminalBody, body, mutate);
    }
    assert.throws(
        () => readReplayTerminalBody({ ...finished, replay_version: 2 } as never),
        ReplayCompatibilityError,
    );
    assert.throws(
        () =>
            readReplayStepBody({
                ...provider,
                compatibility_version: "shepherd.replay.v0",
            } as never),
        (error: unknown) =>
            error instanceof ReplayCompatibilityError &&
            error.compatibility_version === "shepherd.replay.v0",
    );
    assert.throws(() => readReplayReason("x".repeat(4097), "reason"), TypeError);
    assert.ok(
        Buffer.byteLength(createReplayFailure(new Error(`aa${"€".repeat(2000)}`)).message) <= 4096,
    );
});

test("session folds reject reordered, forged, and inconsistent record sequences", async (context) => {
    const directory = await temporaryDirectory(context, "fold");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const { boundary, branch, failed, root } = await fixtureSessions(directory, store);
    const fold =
        (inspection: ReplaySessionInspection, edit: (records: OwnerRecord[]) => OwnerRecord[]) =>
        () =>
            foldReplaySession(
                store,
                inspection.session_id,
                edit([...store.readOwner(inspection.session_id)]),
                undefined,
                Date.now(),
            );
    const withBody = (record: OwnerRecord, body: Body): OwnerRecord =>
        ({ ...record, body }) as unknown as OwnerRecord;
    const withEnvelope = (record: OwnerRecord, envelope: Body): OwnerRecord =>
        ({ ...record, envelope: { ...record.envelope, ...envelope } }) as unknown as OwnerRecord;
    const schemaIndex = (records: OwnerRecord[], schemaRef: string, occurrence = 0) =>
        records
            .map((record, index) => [record, index] as const)
            .filter(([record]) => record.envelope.schema_ref === schemaRef)[
            occurrence
        ]?.[1] as number;
    for (const [inspection, edit] of [
        [
            root,
            (records: OwnerRecord[]) => [
                withEnvelope(records[0] as OwnerRecord, { mode: "capture" }),
                ...records.slice(1),
            ],
        ],
        [
            root,
            (records: OwnerRecord[]) => [
                withEnvelope(records[0] as OwnerRecord, {
                    caused_by_record_ids: [records[1]?.envelope.record_id],
                }),
                ...records.slice(1),
            ],
        ],
        [root, (records: OwnerRecord[]) => [...records, records.at(-1) as OwnerRecord]],
        [
            root,
            (records: OwnerRecord[]) =>
                records.filter(
                    (_, index) => index !== schemaIndex(records, "shepherd.replay.step.v1", 1),
                ),
        ],
        [
            root,
            (records: OwnerRecord[]) =>
                records.filter(
                    (_, index) => index !== schemaIndex(records, "shepherd.replay.checkpoint.v1"),
                ),
        ],
        [
            root,
            (records: OwnerRecord[]) =>
                records.slice(0, schemaIndex(records, "shepherd.replay.checkpoint.v1")),
        ],
        [
            root,
            (records: OwnerRecord[]) => [
                ...records.slice(0, -1),
                withEnvelope(records.at(-1) as OwnerRecord, { schema_ref: "shepherd.unknown.v1" }),
            ],
        ],
        [
            root,
            (records: OwnerRecord[]) => {
                const index = schemaIndex(records, "shepherd.replay.admission.v1");
                const admission = records[index] as OwnerRecord;
                return [
                    ...records.slice(0, index),
                    withBody(admission, { ...admission.body, index: 9 }),
                    ...records.slice(index + 1),
                ];
            },
        ],
        [
            root,
            (records: OwnerRecord[]) => {
                const index = schemaIndex(records, "shepherd.replay.checkpoint.v1");
                return [
                    ...records.slice(0, index + 1),
                    records[index - 1] as OwnerRecord,
                    records[index] as OwnerRecord,
                    ...records.slice(index + 1),
                ];
            },
        ],
        [
            root,
            (records: OwnerRecord[]) => [
                ...records.slice(0, -1),
                withBody(records.at(-1) as OwnerRecord, {
                    ...(records.at(-1)?.body as Body),
                    step_count: 1,
                }),
            ],
        ],
        [
            root,
            (records: OwnerRecord[]) => {
                const index = schemaIndex(records, "shepherd.replay.step.v1", 1);
                const step = records[index] as OwnerRecord;
                return [
                    ...records.slice(0, index),
                    withEnvelope(step, { caused_by_record_ids: [] }),
                    ...records.slice(index + 1),
                ];
            },
        ],
        [
            branch,
            (records: OwnerRecord[]) =>
                records.filter(
                    (record) => record.envelope.schema_ref !== "shepherd.replay.restore.v1",
                ),
        ],
        [
            branch,
            (records: OwnerRecord[]) => {
                const index = schemaIndex(records, "shepherd.replay.restore.v1");
                const restore = records[index] as OwnerRecord;
                return [
                    ...records.slice(0, index),
                    withEnvelope(restore, {
                        caused_by_record_ids: [
                            records[0]?.envelope.record_id,
                            records[0]?.envelope.record_id,
                        ],
                    }),
                    ...records.slice(index + 1),
                ];
            },
        ],
        [
            branch,
            (records: OwnerRecord[]) => {
                const index = schemaIndex(records, "shepherd.replay.restore.v1");
                const restore = records[index] as OwnerRecord;
                return [
                    ...records.slice(0, index),
                    withBody(restore, { ...restore.body, prefix_id: null }),
                    ...records.slice(index + 1),
                ];
            },
        ],
        [
            branch,
            (records: OwnerRecord[]) => {
                const index = schemaIndex(records, "shepherd.replay.step.v1");
                return [
                    ...records.slice(0, index),
                    records[index + 1] as OwnerRecord,
                    ...records.slice(index),
                ];
            },
        ],
        [
            boundary,
            (records: OwnerRecord[]) =>
                records.filter(
                    (record) => record.envelope.schema_ref !== "kernel.cut.owner-prefix.v1",
                ),
        ],
        [
            failed,
            (records: OwnerRecord[]) => [
                records[0] as OwnerRecord,
                ...(store.readOwner(root.session_id).slice(1) as OwnerRecord[]),
            ],
        ],
    ] as const) {
        assert.throws(fold(inspection, edit), ReplayEvidenceError);
    }
    assert.throws(
        () =>
            foldReplaySession(
                store,
                root.session_id,
                store.readOwner(root.session_id),
                {
                    ...(store.readReplaySession(root.session_id) as object),
                    terminal: false,
                } as never,
                Date.now(),
            ),
        ReplayEvidenceError,
    );
    assert.throws(
        () =>
            foldReplaySession(
                store,
                root.session_id,
                store
                    .readOwner(root.session_id)
                    .map((record) => withBody(record, { ...record.body, replay_version: 9 })),
                undefined,
                Date.now(),
            ),
        ReplayCompatibilityError,
    );
    const manifestBlob = root.checkpoints[0]?.constituents[1]?.evidence?.manifest_blob_id as string;
    const oversized = store.putBlob(
        Buffer.from(JSON.stringify(Array.from({ length: 65_537 }, () => null))),
    );
    assert.throws(
        () =>
            verifyReplayWorldImage(
                store,
                {
                    content_id: "world-content:sha256:x",
                    entry_count: 1,
                    manifest_blob_id: oversized.blob_id,
                },
                directory,
            ),
        /incomplete or corrupt/u,
    );
    assert.throws(
        () =>
            verifyReplayWorldImage(
                store,
                {
                    content_id: "world-content:sha256:x",
                    entry_count: 1,
                    manifest_blob_id: manifestBlob,
                },
                directory,
            ),
        /incomplete or corrupt/u,
    );
});

test("reopening a session with an effect admission but no step fails as uncertain", async (context) => {
    const directory = await temporaryDirectory(context, "uncertain");
    const databasePath = path.join(directory, "trace.sqlite");
    using store = new SQLiteTraceStore(databasePath);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    const handlers = {
        dispatch: async () => {
            await gate;
            throw new Error("released");
        },
    };
    const running = runReplaySession(store, {
        claimId: "worker:1",
        commandId: "session:uncertain",
        handlers: handlers as never,
        program: async (replayContext) =>
            replayContext.dispatchEffect(intentOf("effect:1", "notify", {})),
        programId: "program:uncertain",
    });
    for (;;) {
        const records = store.readOwner(
            store.listOwnersBySchema("shepherd.replay.session.v1", 1, 0)[0] as string,
        );
        if (records.at(-1)?.envelope.schema_ref === "shepherd.replay.admission.v1") {
            break;
        }
        await new Promise((resolve) => setTimeout(resolve, 2));
    }
    await assert.rejects(
        runReplaySession(store, {
            claimId: "worker:2",
            clock: () => Date.now() + 3_600_000,
            commandId: "session:uncertain",
            handlers: handlers as never,
            program: () => null,
            programId: "program:uncertain",
        }),
        ReplayMaterializationUncertainError,
    );
    release();
    await running;
});
