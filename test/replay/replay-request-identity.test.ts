import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { Ajv2020, type AnySchemaObject } from "ajv/dist/2020.js";

import {
    AppendIntentConflictError,
    deriveReplaySessionId,
    inspectReplayBranchRequest,
    inspectReplaySession,
    type RecordBody,
    ReplayCompatibilityError,
    ReplayEvidenceError,
    ReplayLeaseConflictError,
    replayReplaySession,
    rewindReplaySession,
    runReplaySession,
    SQLiteTraceStore,
    schema,
    task,
} from "../../src/index.ts";
import { replayProtocolConfig } from "../../src/protocol/config.ts";
import { ROOT_WITNESS_ID } from "../../src/record/root-witness.ts";
import { createReplayAppendIntentId } from "../../src/replay/records.ts";
import {
    readCompensationLog,
    readRowIds,
    rowCompensation,
    runRowSession,
} from "../effect/compensation-fixtures.ts";
import { temporaryDirectory } from "./fixtures.ts";

test("a completed retaining branch refuses a changed or malformed disposition before returning its receipt", async (context) => {
    const directory = await temporaryDirectory(context, "branch-request");
    const database = path.join(directory, "trace.sqlite");
    const world = path.join(directory, "world.sqlite");
    const calls: string[] = [];
    let sourceSessionId: string;
    {
        using store = new SQLiteTraceStore(database);
        const source = await runRowSession(store, world, "session:request-source", [
            ["a", "compensable"],
        ]);
        sourceSessionId = source.inspection.session_id;
        await rewindReplaySession(store, {
            claimId: "operator",
            commandId: "branch:request",
            sourceSessionId,
            sourceDisposition: "retain",
            target: { stepCount: 0 },
        });
    }
    using reopened = new SQLiteTraceStore(database);
    for (const sourceDisposition of ["compensate", "unknown", null]) {
        await assert.rejects(
            rewindReplaySession(reopened, {
                claimId: "another-operator",
                commandId: "branch:request",
                sourceSessionId,
                compensation: rowCompensation(world, calls),
                sourceDisposition: sourceDisposition as never,
                target: { stepCount: 0 },
            }),
        );
    }
    assert.deepEqual(calls, []);
    assert.deepEqual(readRowIds(world), ["a"]);
});

test("exact retries normalize defaults and survive reopen and import without new records", async (context) => {
    const directory = await temporaryDirectory(context, "request-retries");
    const database = path.join(directory, "trace.sqlite");
    const world = path.join(directory, "world.sqlite");
    let sourceSessionId: string;
    let receipt: Awaited<ReturnType<typeof rewindReplaySession>>;
    let archive: string;
    const calls: string[] = [];
    {
        using store = new SQLiteTraceStore(database);
        const source = await runRowSession(store, world, "session:retry", [["a", "compensable"]]);
        sourceSessionId = source.inspection.session_id;
        receipt = await rewindReplaySession(store, {
            claimId: "operator",
            commandId: "branch:retry",
            sourceSessionId,
            compensation: rowCompensation(world, calls),
            target: { stepCount: 0 },
        });
        archive = store.exportTrace();
        assert.deepEqual(calls, ["effect:row:a"]);
    }
    using reopened = new SQLiteTraceStore(database);
    using imported = new SQLiteTraceStore(path.join(directory, "import.sqlite"));
    imported.importTrace(archive);
    for (const store of [reopened, imported]) {
        const before = store.exportTrace();
        assert.deepEqual(
            await rewindReplaySession(store, {
                claimId: "replacement-operator",
                commandId: "branch:retry",
                sourceSessionId,
                sourceDisposition: "compensate",
                target: { stepCount: 0 },
            }),
            { inspection: { ...receipt.inspection, live: store === reopened } },
        );
        assert.equal(store.exportTrace(), before);
    }
    assert.deepEqual(readRowIds(world), []);
});

test("completed replay commands bind mode, source, target, declared changes, task and checkpoint policy", async (context) => {
    const directory = await temporaryDirectory(context, "request-fields");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const world = path.join(directory, "world.sqlite");
    const source = await runRowSession(store, world, "session:fields", [["a", "compensable"]]);
    const other = await runRowSession(store, world, "session:other", [["b", "compensable"]]);
    const options = {
        claimId: "operator",
        commandId: "branch:fields",
        sourceSessionId: source.inspection.session_id,
        sourceDisposition: "retain" as const,
        target: { stepCount: 0 },
        program: async () => null,
    };
    const receipt = await replayReplaySession(store, options);
    assert.deepEqual(
        await replayReplaySession(store, {
            ...options,
            claimId: "another",
            changes: [],
            checkpointPolicy: { kind: "none" },
        }),
        receipt,
    );
    const descriptor = task({
        name: "replacement",
        version: "1.0.0",
        instruction: "Return a value",
        input: schema.string(),
        output: schema.string(),
    });
    const before = store.exportTrace();
    for (const changed of [
        { sourceSessionId: other.inspection.session_id },
        { target: { stepCount: 1 } },
        { changes: ["handlers"] as const },
        { changes: ["task"] as const, task: { descriptor, input: "replacement" } },
        { checkpointPolicy: { kind: "effect_step" as const } },
        { checkpointPolicy: { kind: "every_n_steps" as const, interval: 2 } },
    ]) {
        await assert.rejects(
            replayReplaySession(store, { ...options, ...changed }),
            AppendIntentConflictError,
        );
    }
    await assert.rejects(
        rewindReplaySession(store, {
            claimId: "operator",
            commandId: options.commandId,
            sourceSessionId: options.sourceSessionId,
            target: options.target,
            sourceDisposition: "retain",
        }),
        AppendIntentConflictError,
    );
    assert.equal(store.exportTrace(), before);
});

test("a conflicting request is refused while the original command is compensating", async (context) => {
    const directory = await temporaryDirectory(context, "request-race");
    const database = path.join(directory, "trace.sqlite");
    using first = new SQLiteTraceStore(database);
    using second = new SQLiteTraceStore(database);
    const world = path.join(directory, "world.sqlite");
    const source = await runRowSession(first, world, "session:race", [["a", "compensable"]]);
    let release = () => {};
    let notify = () => {};
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    const entered = new Promise<void>((resolve) => {
        notify = resolve;
    });
    const calls: string[] = [];
    const options = {
        claimId: "operator",
        commandId: "branch:race",
        sourceSessionId: source.inspection.session_id,
        target: { stepCount: 0 },
    };
    const running = rewindReplaySession(first, {
        ...options,
        compensation: rowCompensation(world, calls, async () => {
            notify();
            await gate;
        }),
    });
    await entered;
    try {
        await assert.rejects(
            rewindReplaySession(second, { ...options, sourceDisposition: "retain" }),
            AppendIntentConflictError,
        );
        await assert.rejects(
            runReplaySession(second, {
                claimId: "root",
                commandId: options.commandId,
                programId: "root",
                program: async () => null,
            }),
            AppendIntentConflictError,
        );
    } finally {
        release();
    }
    const receipt = await running;
    assert.deepEqual(await rewindReplaySession(second, options), receipt);
    assert.deepEqual(calls, ["effect:row:a"]);
    assert.deepEqual(readRowIds(world), []);
});

test("concurrent identical requests converge on the retained receipt without repeating a completed compensation", async (context) => {
    const directory = await temporaryDirectory(context, "request-identical");
    const database = path.join(directory, "trace.sqlite");
    using first = new SQLiteTraceStore(database);
    using second = new SQLiteTraceStore(database);
    const world = path.join(directory, "world.sqlite");
    const source = await runRowSession(first, world, "session:identical", [["a", "compensable"]]);
    const options = {
        claimId: "operator",
        commandId: "branch:identical",
        sourceSessionId: source.inspection.session_id,
        target: { stepCount: 0 },
        compensation: rowCompensation(world),
    };
    const results = await Promise.allSettled([
        rewindReplaySession(first, options),
        rewindReplaySession(second, options),
    ]);
    assert.ok(results.some((result) => result.status === "fulfilled"));
    const before = readCompensationLog(world);
    const receipt = await rewindReplaySession(second, options);
    for (const result of results)
        if (result.status === "fulfilled") assert.deepEqual(result.value, receipt);
    assert.deepEqual(readCompensationLog(world), before);
    assert.deepEqual(
        [...before.values()].map((entry) => entry.deleted),
        [1],
    );
});

test("request inspection and its versioned schema survive import, while legacy branches refuse retry", async (context) => {
    const directory = await temporaryDirectory(context, "request-inspection");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const source = await runReplaySession(store, {
        claimId: "worker",
        commandId: "inspect-source",
        programId: "inspect-program",
        program: async () => null,
    });
    const options = {
        claimId: "operator",
        commandId: "inspect-branch",
        sourceSessionId: source.inspection.session_id,
        target: { stepCount: 0 },
        sourceDisposition: "retain" as const,
    };
    assert.equal(inspectReplayBranchRequest(store, options.commandId), null);
    await rewindReplaySession(store, options);
    const inspection = inspectReplayBranchRequest(store, options.commandId);
    assert.ok(inspection);
    assert.equal(inspection.request.source_disposition, "retain");
    assert.equal(inspection.request.checkpoint_policy, null);
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    ajv.addKeyword("x-shepherd-max-utf8-bytes");
    const validate = ajv.compile(
        JSON.parse(
            readFileSync(
                new URL("../../spec/schemas/replay-branch-request-v1.schema.json", import.meta.url),
                "utf8",
            ),
        ) as AnySchemaObject,
    );
    assert.equal(validate(inspection.request), true, JSON.stringify(validate.errors));
    for (const changed of [
        { request_version: 0 },
        { source_disposition: "unknown" },
        { extra: true },
        { checkpoint_policy: { kind: "none", interval: null } },
    ]) {
        assert.equal(validate({ ...inspection.request, ...changed }), false);
    }
    using imported = new SQLiteTraceStore(path.join(directory, "import.sqlite"));
    imported.importTrace(store.exportTrace());
    assert.deepEqual(inspectReplayBranchRequest(imported, options.commandId), inspection);
    const replayOptions = {
        ...options,
        commandId: "inspect-replay",
        checkpointPolicy: { kind: "every_n_steps" as const, interval: 2 },
        program: async () => null,
    };
    await replayReplaySession(store, replayOptions);
    const replayed = inspectReplayBranchRequest(store, replayOptions.commandId);
    assert.ok(replayed);
    assert.equal(validate(replayed.request), true, JSON.stringify(validate.errors));
    assert.deepEqual(replayed.request.checkpoint_policy, { kind: "every_n_steps", interval: 2 });
    using legacy = new SQLiteTraceStore(path.join(directory, "legacy.sqlite"));
    legacy.importTrace(
        readFileSync(new URL("../fixtures/replay-legacy-branch-v3.json", import.meta.url), "utf8"),
    );
    assert.equal(inspectReplayBranchRequest(legacy, "legacy-branch"), null);
    const before = legacy.exportTrace();
    await assert.rejects(
        rewindReplaySession(legacy, {
            claimId: "operator",
            commandId: "legacy-branch",
            sourceSessionId: deriveReplaySessionId("legacy-source"),
            target: { stepCount: 0 },
            sourceDisposition: "retain",
        }),
        ReplayCompatibilityError,
    );
    assert.equal(legacy.exportTrace(), before);
});

test("malformed retained request bodies and provenance fail through public inspection", async (context) => {
    const directory = await temporaryDirectory(context, "request-corrupt");
    using sourceStore = new SQLiteTraceStore(path.join(directory, "source.sqlite"));
    const source = await runReplaySession(sourceStore, {
        claimId: "worker",
        commandId: "corrupt-source",
        programId: "corrupt-program",
        program: async () => null,
    });
    const sourceArchive = sourceStore.exportTrace();
    const commandId = "corrupt-branch";
    await rewindReplaySession(sourceStore, {
        claimId: "operator",
        commandId,
        sourceSessionId: source.inspection.session_id,
        sourceDisposition: "retain",
        target: { stepCount: 0 },
    });
    const valid = inspectReplayBranchRequest(sourceStore, commandId);
    assert.ok(valid);
    const requestConfig = replayProtocolConfig.branch.request;
    let index = 0;
    for (const [mutate, expected] of [
        [
            (body: Record<string, unknown>) => {
                body.source_disposition = "unknown";
            },
            ReplayEvidenceError,
        ],
        [
            (body: Record<string, unknown>) => {
                body.extra = true;
            },
            ReplayEvidenceError,
        ],
        [
            (body: Record<string, unknown>) => {
                body.request_version = 0;
            },
            ReplayCompatibilityError,
        ],
        [
            (body: Record<string, unknown>) => {
                body.checkpoint_policy = { kind: "none", interval: null };
            },
            ReplayEvidenceError,
        ],
        [
            (body: Record<string, unknown>) => {
                const session = body.session as Record<string, unknown>;
                session.mode = "root";
                session.origin = null;
            },
            ReplayEvidenceError,
        ],
        [
            (body: Record<string, unknown>) => {
                body.session = { ...(body.session as Record<string, unknown>), program_id: null };
            },
            ReplayEvidenceError,
        ],
    ] as const) {
        using store = new SQLiteTraceStore(path.join(directory, `bad-${index++}.sqlite`));
        store.importTrace(sourceArchive);
        const body = structuredClone(valid.request) as Record<string, unknown>;
        mutate(body);
        store.appendReplayBranchRequest(deriveReplaySessionId(commandId), {
            append_intent_id: "fixture-request",
            batch: {
                groups: [
                    {
                        owner_id: deriveReplaySessionId(commandId) + requestConfig.ownerSuffix,
                        records: [
                            {
                                body: body as RecordBody,
                                caused_by_record_ids: [source.inspection.session_record_id],
                                mode: "declaration",
                                schema_ref: requestConfig.schemaRef,
                                witness_ref: ROOT_WITNESS_ID,
                            },
                        ],
                    },
                ],
            },
        });
        assert.throws(() => inspectReplayBranchRequest(store, commandId), expected);
    }
    using invalidCause = new SQLiteTraceStore(path.join(directory, "cause.sqlite"));
    invalidCause.importTrace(sourceArchive);
    invalidCause.appendReplayBranchRequest(deriveReplaySessionId(commandId), {
        append_intent_id: "fixture-cause",
        batch: {
            groups: [
                {
                    owner_id: deriveReplaySessionId(commandId) + requestConfig.ownerSuffix,
                    records: [
                        {
                            body: valid.request,
                            caused_by_record_ids: [],
                            mode: "declaration",
                            schema_ref: requestConfig.schemaRef,
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    });
    assert.throws(() => inspectReplayBranchRequest(invalidCause, commandId), ReplayEvidenceError);
});

test("request-only recovery preserves identity after an uncertain compensation and import", async (context) => {
    const directory = await temporaryDirectory(context, "request-recovery");
    const world = path.join(directory, "world.sqlite");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const source = await runRowSession(store, world, "session:uncertain", [["a", "compensable"]]);
    const options = {
        claimId: "operator",
        commandId: "branch:uncertain",
        sourceSessionId: source.inspection.session_id,
        target: { stepCount: 0 },
    };
    await assert.rejects(
        rewindReplaySession(store, {
            ...options,
            compensation: rowCompensation(world, [], () => {
                throw new Error("interrupted after deletion");
            }),
        }),
        /interrupted after deletion/u,
    );
    const request = inspectReplayBranchRequest(store, options.commandId);
    assert.ok(request);
    assert.deepEqual(store.readOwner(deriveReplaySessionId(options.commandId)), []);
    using imported = new SQLiteTraceStore(path.join(directory, "import.sqlite"));
    imported.importTrace(store.exportTrace());
    await assert.rejects(
        rewindReplaySession(imported, { ...options, sourceDisposition: "retain" }),
        AppendIntentConflictError,
    );
    const result = await rewindReplaySession(imported, {
        ...options,
        compensation: rowCompensation(world),
    });
    assert.equal(result.inspection.terminal?.status, "rewound");
    assert.deepEqual(inspectReplayBranchRequest(imported, options.commandId), request);
    assert.deepEqual([...readCompensationLog(world).values()], [{ deleted: 1, invocations: 2 }]);
});

test("a root command cannot be reused for a branch", async (context) => {
    const directory = await temporaryDirectory(context, "root-command-conflict");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const source = await runReplaySession(store, {
        claimId: "worker",
        commandId: "root-source",
        programId: "root-program",
        program: async () => null,
    });
    await runReplaySession(store, {
        claimId: "worker",
        commandId: "root-owned",
        programId: "root-program",
        program: async () => null,
    });
    const before = store.exportTrace();
    await assert.rejects(
        rewindReplaySession(store, {
            claimId: "operator",
            commandId: "root-owned",
            sourceSessionId: source.inspection.session_id,
            target: { stepCount: 0 },
            sourceDisposition: "retain",
        }),
        AppendIntentConflictError,
    );
    assert.equal(store.exportTrace(), before);
});

test("transaction admission rechecks a root or identical branch that wins after the initial read", async (context) => {
    const directory = await temporaryDirectory(context, "request-transaction-races");
    for (const competingMode of ["root", "branch", "legacy"] as const) {
        const database = path.join(directory, `${competingMode}.sqlite`);
        using first = new SQLiteTraceStore(database);
        using second = new SQLiteTraceStore(database);
        const source = await runReplaySession(first, {
            claimId: "worker",
            commandId: "transaction-source",
            programId: "transaction-program",
            program: async () => null,
        });
        const options = {
            claimId: "first",
            commandId: "transaction-branch",
            sourceSessionId: source.inspection.session_id,
            target: { stepCount: 0 },
            sourceDisposition: "retain" as const,
        };
        const append = first.appendReplayBranchRequest.bind(first);
        let contender: ReturnType<typeof runReplaySession> | undefined;
        // Deterministically interleave two real connections immediately before the transaction.
        // The contender's public API opens its session synchronously before its first await.
        first.appendReplayBranchRequest = (sessionId, request) => {
            if (competingMode === "legacy") {
                // Reproduce the pre-journal writer admission that can race a new-version caller.
                second.openReplaySession(sessionId, "legacy", Date.now(), {
                    append_intent_id: createReplayAppendIntentId(options.commandId, "session"),
                    batch: {
                        groups: [
                            {
                                owner_id: sessionId,
                                records: [
                                    {
                                        body: request.batch.groups[0]?.records[0]?.body
                                            .session as RecordBody,
                                        caused_by_record_ids: [source.inspection.session_record_id],
                                        mode: "declaration",
                                        schema_ref: replayProtocolConfig.traceSchemas.session,
                                        witness_ref: ROOT_WITNESS_ID,
                                    },
                                ],
                            },
                        ],
                    },
                });
                contender = Promise.resolve({
                    inspection: inspectReplaySession(second, { sessionId }),
                });
                return append(sessionId, request);
            }
            contender =
                competingMode === "root"
                    ? runReplaySession(second, {
                          claimId: "second",
                          commandId: options.commandId,
                          programId: "competing-root",
                          program: async () => null,
                      })
                    : rewindReplaySession(second, { ...options, claimId: "second" });
            return append(sessionId, request);
        };
        await assert.rejects(
            rewindReplaySession(first, options),
            competingMode === "root"
                ? AppendIntentConflictError
                : competingMode === "legacy"
                  ? ReplayCompatibilityError
                  : ReplayLeaseConflictError,
        );
        assert.ok(contender);
        const winner = await contender;
        if (competingMode !== "branch") {
            assert.equal(inspectReplayBranchRequest(first, options.commandId), null);
        } else {
            assert.deepEqual(await rewindReplaySession(first, options), winner);
            assert.equal(
                first.readOwner(
                    deriveReplaySessionId(options.commandId) +
                        replayProtocolConfig.branch.request.ownerSuffix,
                ).length,
                1,
            );
        }
        assert.equal(first.verifyIntegrity().ok, true);
    }
});

test("replacement task contents and checkpoint intervals each independently bind command identity", async (context) => {
    const directory = await temporaryDirectory(context, "request-task-policy");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const source = await runReplaySession(store, {
        claimId: "worker",
        commandId: "task-policy-source",
        programId: "task-policy-program",
        program: async () => null,
    });
    const descriptor = task({
        name: "bound-task",
        version: "1.0.0",
        instruction: "Return text",
        input: schema.string(),
        output: schema.string(),
    });
    const options = {
        claimId: "operator",
        commandId: "task-policy-branch",
        sourceSessionId: source.inspection.session_id,
        target: { stepCount: 0 },
        sourceDisposition: "retain" as const,
        changes: ["task"] as const,
        task: { descriptor, input: "original" },
        checkpointPolicy: { kind: "every_n_steps" as const, interval: 2 },
        program: async () => null,
    };
    await replayReplaySession(store, options);
    const before = store.exportTrace();
    await assert.rejects(
        replayReplaySession(store, { ...options, task: { descriptor, input: "changed" } }),
        AppendIntentConflictError,
    );
    await assert.rejects(
        replayReplaySession(store, {
            ...options,
            checkpointPolicy: { kind: "every_n_steps", interval: 3 },
        }),
        AppendIntentConflictError,
    );
    assert.equal(store.exportTrace(), before);
});
