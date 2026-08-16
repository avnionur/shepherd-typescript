import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
    acknowledgeDurableTaskCancellation,
    acknowledgeDurableTaskSuspension,
    acknowledgeDurableTaskWaiting,
    type Cut,
    type CutSpec,
    cancelDurableTask,
    captureRunContinuationCheckpoints,
    createStaticProvider,
    DurableExecutionClaimFencedError,
    DurableExecutionRecoveryAbsentError,
    DurableExecutionRecoveryError,
    executeTaskDurably,
    inspectDurableTaskExecution,
    type ModelProvider,
    type OwnerRecord,
    type RecordId,
    type RetainedRecord,
    ROOT_WITNESS_ID,
    type RunContinuationCheckpointEvidence,
    readDurableTaskExecution,
    recoverTaskDurably,
    requestDurableTaskCancellation,
    requestDurableTaskPause,
    resumeDurableTask,
    SQLiteTraceStore,
    schema,
    TraceStoreError,
    task,
} from "../../src/index.ts";
import { runProtocolConfig } from "../../src/protocol/config.ts";
import { createRecordEnvelope } from "../../src/record/envelope.ts";
import {
    createDurableCancellationCommand,
    createDurablePauseCommand,
    createDurableResumeCommand,
} from "../../src/run/durable-execution-control-codec.ts";
import { appendDurableExecutionResume } from "../../src/store/durable-execution-control.ts";

type StoredRecordRow = Readonly<Record<string, unknown>>;
type AppendBody = Parameters<
    SQLiteTraceStore["append"]
>[0]["batch"]["groups"][number]["records"][number]["body"];

function createStoredRecordRow(
    body: AppendBody,
    schemaRef: string,
    causedByRecordIds: readonly string[],
): StoredRecordRow {
    const envelope = createRecordEnvelope({
        body,
        caused_by_record_ids: causedByRecordIds,
        mode: "capture",
        schema_ref: schemaRef,
        witness_ref: ROOT_WITNESS_ID,
    });
    return {
        body_json: JSON.stringify(body),
        caused_by_json: JSON.stringify(envelope.caused_by_record_ids),
        digest: envelope.digest,
        mode: envelope.mode,
        record_id: envelope.record_id,
        schema_ref: envelope.schema_ref,
        witness_ref: envelope.witness_ref,
    };
}

function createResumeReplayDatabase(
    recordIds: readonly string[],
    rows: ReadonlyMap<string, StoredRecordRow>,
): DatabaseSync {
    const database = {
        exec: (_sql: string): void => {},
        prepare: (sql: string) => ({
            all: (...parameters: readonly unknown[]): readonly StoredRecordRow[] => {
                if (sql.includes("WHERE view.append_intent_id")) {
                    return recordIds.map((recordId) => ({ record_id: recordId }));
                }
                const recordId = String(parameters[0]);
                return rows.has(recordId)
                    ? [
                          {
                              append_intent_id: "append:resume:scripted",
                              owner_id: "run:resume:scripted",
                              owner_ordinal: 1,
                          },
                      ]
                    : [];
            },
            get: (...parameters: readonly unknown[]): StoredRecordRow | undefined => {
                return rows.get(String(parameters[0]));
            },
            run: (..._parameters: readonly unknown[]): void => {},
        }),
    };
    return database as unknown as DatabaseSync;
}

function appendSyntheticSuspension(
    store: SQLiteTraceStore,
    runId: string,
    startedRecordId: string,
    pauseCommandRecordId: string,
    traceCutCreatedRecordId: string,
    descriptorBody: Readonly<Record<string, unknown>>,
    intentId: string,
): { readonly descriptorRecordId: string; readonly suspensionRecordId: string } {
    const descriptorEnvelope = createRecordEnvelope({
        body: descriptorBody as AppendBody,
        caused_by_record_ids: [traceCutCreatedRecordId],
        mode: "capture",
        schema_ref: runProtocolConfig.schemas.continuationDescriptorId,
        witness_ref: ROOT_WITNESS_ID,
    });
    const receipt = store.append({
        append_intent_id: intentId,
        batch: {
            groups: [
                {
                    owner_id: runId,
                    records: [
                        {
                            append_local_id: "descriptor",
                            body: descriptorBody as AppendBody,
                            caused_by_record_ids: [traceCutCreatedRecordId],
                            mode: "capture",
                            schema_ref: runProtocolConfig.schemas.continuationDescriptorId,
                            witness_ref: ROOT_WITNESS_ID,
                        },
                        {
                            body: {
                                continuation_descriptor_id: descriptorEnvelope.record_id,
                                execution_id: runId,
                                lifecycle_version: runProtocolConfig.execution.lifecycleVersion,
                                pause_command_id: pauseCommandRecordId,
                                status: runProtocolConfig.execution.lifecycleSuspendedStatus,
                            },
                            caused_by_record_ids: [startedRecordId, pauseCommandRecordId],
                            caused_by_local_refs: ["descriptor"],
                            mode: "capture",
                            schema_ref: runProtocolConfig.schemas.suspendedLifecycleId,
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    });
    return {
        descriptorRecordId: receipt.record_ids[0] as string,
        suspensionRecordId: receipt.record_ids[1] as string,
    };
}

class InterruptingStartStore extends SQLiteTraceStore {
    #interrupt = true;
    claimId: string | null = null;
    fencingToken: number | null = null;

    interruptNextStart(): void {
        this.#interrupt = true;
    }

    override appendDurableExecutionStart(
        runId: string,
        claimId: string,
        fencingToken: number,
        nowMilliseconds = Date.now(),
        recoveryCommandRecordId: string | null = null,
    ) {
        if (this.#interrupt) {
            this.#interrupt = false;
            this.claimId = claimId;
            this.fencingToken = fencingToken;
            throw new Error("start publication interrupted");
        }
        return super.appendDurableExecutionStart(
            runId,
            claimId,
            fencingToken,
            nowMilliseconds,
            recoveryCommandRecordId,
        );
    }
}

test("created cancellation atomically terminalizes and fences pre-start authority", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-created-cancellation-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const databasePath = path.join(directory, "trace.sqlite");
    const store = new InterruptingStartStore(databasePath);
    const runId = "run:cancellation-created-public";
    assert.throws(
        () =>
            cancelDurableTask(store, {
                commandId: "command:cancel:absent-public",
                expectedLifecycleRecordId: ROOT_WITNESS_ID,
                reason: "cannot cancel absent execution",
                runId,
            }),
        TraceStoreError,
    );
    await assert.rejects(
        executeTaskDurably(store, {
            budget: { maxTurns: 1 },
            input: undefined,
            provider: createStaticProvider({
                descriptor: { id: "created-cancellation-provider", model: "offline-v1" },
                exchanges: [],
            }),
            runId,
            task: task({
                input: schema.void(),
                instruction: "Cancel before provider start.",
                name: "created-cancellation",
                output: schema.string(),
                version: "1.0.0",
            }),
        }),
        /start publication interrupted/,
    );
    const recovery = readDurableTaskExecution(store, runId);
    assert.equal(recovery.status, "created");
    if (recovery.status !== "created") {
        throw new Error("expected created recovery state");
    }
    const options = {
        commandId: "command:cancel:created-public",
        expectedLifecycleRecordId: recovery.created_record_id,
        reason: "operator cancellation before start",
        runId,
    } as const;
    const cancelled = cancelDurableTask(store, options);
    assert.equal(cancelled.execution.outcome.outcome.status, "cancelled");
    assert.equal(cancelled.ledger.started, false);
    assert.equal(inspectDurableTaskExecution(store, runId).status, "committed");
    assert.throws(
        () =>
            cancelDurableTask(store, {
                ...options,
                commandId: "command:cancel:stale-created-public",
            }),
        TraceStoreError,
    );
    assert.ok(store.claimId && store.fencingToken);
    assert.deepEqual(
        store.appendDurableExecutionStart(runId, store.claimId, store.fencingToken, Date.now()),
        { status: "fenced" },
    );
    store.close();
    const reopened = new SQLiteTraceStore(databasePath);
    assert.deepEqual(cancelDurableTask(reopened, options), cancelled);
    assert.throws(
        () => cancelDurableTask(reopened, { ...options, reason: "different reason" }),
        TraceStoreError,
    );
    reopened.close();
});

test("suspended cancellation terminalizes from the exact quiescent head", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-suspended-cancellation-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const databasePath = path.join(directory, "trace.sqlite");
    const store = new ObservingStartStore(databasePath);
    const runId = "run:cancellation-suspended-public";
    let releaseProvider: (() => void) | undefined;
    const providerRelease = new Promise<void>((resolve) => {
        releaseProvider = resolve;
    });
    let suspensionOptions: Parameters<typeof acknowledgeDurableTaskSuspension>[1] | undefined;
    let suspension: ReturnType<typeof acknowledgeDurableTaskSuspension> | undefined;
    const running = executeTaskDurably(store, {
        budget: { maxTurns: 1 },
        input: undefined,
        provider: {
            descriptor: () => ({
                capabilities: { streaming: false, structuredOutput: true, tools: false },
                id: "suspended-cancellation-provider",
                kind: "static" as const,
                model: "offline-v1",
            }),
            invoke: async () => {
                await providerRelease;
                const options = suspensionOptions;
                assert.ok(options);
                suspension = acknowledgeDurableTaskSuspension(store, options);
                return {
                    output: "must be fenced",
                    usage: {
                        cacheCreationInputTokens: 0,
                        cacheReadInputTokens: 0,
                        costUsd: null,
                        inputTokens: 1,
                        outputTokens: 1,
                    },
                };
            },
        },
        runId,
        task: task({
            input: schema.void(),
            instruction: "Suspend before direct cancellation.",
            name: "suspended-cancellation",
            output: schema.string(),
            version: "1.0.0",
        }),
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const startedRecordId = inspectDurableTaskExecution(store, runId).lifecycle.started_record_id;
    assert.ok(startedRecordId && store.claimId && store.fencingToken);
    assert.throws(
        () =>
            cancelDurableTask(store, {
                commandId: "command:cancel:running-via-inactive-api",
                expectedLifecycleRecordId: startedRecordId,
                reason: "running execution requires fenced cancellation",
                runId,
            }),
        TraceStoreError,
    );
    const pause = requestDurableTaskPause(store, {
        commandId: "command:pause:before-direct-cancel",
        expectedLifecycleRecordId: startedRecordId,
        fencingToken: store.fencingToken,
        reason: "suspend before cancellation",
        runId,
    });
    const cut = store.publishCut({
        cut_id: "cut:suspended-direct-cancel",
        target_owner_id: runId,
        through_record_id: startedRecordId,
    });
    suspensionOptions = {
        constituents: runProtocolConfig.execution.continuationConstituentKinds.map((kind) => ({
            kind,
            status: "not_required",
        })) as Parameters<typeof acknowledgeDurableTaskSuspension>[1]["constituents"],
        expectedLifecycleRecordId: startedRecordId,
        fencingToken: store.fencingToken,
        pauseCommandRecordId: pause.record_id,
        runId,
        traceCutId: cut.cut_id,
    };
    releaseProvider?.();
    await assert.rejects(running, DurableExecutionClaimFencedError);
    const retainedSuspension = suspension;
    assert.ok(retainedSuspension);
    const options = {
        commandId: "command:cancel:suspended-public",
        expectedLifecycleRecordId: retainedSuspension.acknowledgement_record_id,
        reason: "operator cancels suspended run",
        runId,
    } as const;
    using malformedPreCancellationStore = new OwnerProjectionStore(
        runId,
        store
            .readOwner(runId)
            .map((record) =>
                record.envelope.record_id === retainedSuspension.acknowledgement_record_id
                    ? { ...record, body: { ...record.body, status: "invalid" } }
                    : record,
            ),
        store,
    );
    assert.throws(() => cancelDurableTask(malformedPreCancellationStore, options), TraceStoreError);
    const cancelled = cancelDurableTask(store, options);
    assert.equal(cancelled.execution.outcome.outcome.status, "cancelled");
    assert.equal(cancelled.ledger.started, true);
    const inspection = inspectDurableTaskExecution(store, runId);
    assert.equal(inspection.status, "committed");
    assert.equal(inspection.outcome?.outcome.outcome.status, "cancelled");
    const retainedRecords = store.readOwner(runId);
    const terminalPrefixRecords = retainedRecords.filter(
        (record) => record.envelope.record_id !== cancelled.ledger.cut.created_by_record_id,
    );
    const descriptorRecordId = retainedSuspension.continuation_descriptor_record_id;
    const suspensionRecordId = retainedSuspension.acknowledgement_record_id;
    const malformedTerminalPrefixes: readonly (readonly OwnerRecord[])[] = [
        terminalPrefixRecords.map((record) =>
            record.envelope.record_id === suspensionRecordId
                ? { ...record, body: { ...record.body, status: "invalid" } }
                : record,
        ),
        terminalPrefixRecords.map((record) =>
            record.envelope.record_id === suspensionRecordId
                ? {
                      ...record,
                      envelope: {
                          ...record.envelope,
                          schema_ref: runProtocolConfig.schemas.runningLifecycleId,
                      },
                  }
                : record,
        ),
        terminalPrefixRecords.map((record) =>
            record.envelope.record_id === suspensionRecordId
                ? { ...record, body: { ...record.body, continuation_descriptor_id: 1 } }
                : record,
        ),
        terminalPrefixRecords.filter((record) => record.envelope.record_id !== descriptorRecordId),
        terminalPrefixRecords.map((record) =>
            record.envelope.record_id === descriptorRecordId
                ? {
                      ...record,
                      envelope: {
                          ...record.envelope,
                          schema_ref: runProtocolConfig.execution.controlCommandSchemaId,
                      },
                  }
                : record,
        ),
        ...[
            { execution_id: "run:other" },
            { continuation_version: -1 },
            { trace_cut_id: 1 },
            { constituents: null },
            { constituents: [] },
        ].map((body) =>
            terminalPrefixRecords.map((record) =>
                record.envelope.record_id === descriptorRecordId
                    ? { ...record, body: { ...record.body, ...body } as AppendBody }
                    : record,
            ),
        ),
        terminalPrefixRecords.map((record) =>
            record.envelope.record_id === suspensionRecordId
                ? {
                      ...record,
                      view: { ...record.view, append_intent_id: "append:non-atomic" },
                  }
                : record,
        ),
        terminalPrefixRecords.map((record) =>
            record.envelope.record_id === suspensionRecordId
                ? { ...record, body: { ...record.body, pause_command_id: 1 } }
                : record,
        ),
        terminalPrefixRecords.filter((record) => record.envelope.record_id !== pause.record_id),
        terminalPrefixRecords.map((record) =>
            record.envelope.record_id === pause.record_id
                ? {
                      ...record,
                      envelope: {
                          ...record.envelope,
                          schema_ref: runProtocolConfig.schemas.artifactId,
                      },
                  }
                : record,
        ),
        terminalPrefixRecords.map((record) =>
            record.envelope.record_id === pause.record_id
                ? {
                      ...record,
                      body: { ...record.body, expected_lifecycle_record_id: ROOT_WITNESS_ID },
                  }
                : record,
        ),
        ...[
            { kind: "invalid" },
            { status: "invalid" },
            { status: "unavailable" },
            { status: "verified" },
            { receipt_id: "receipt:unexpected" },
        ].map((constituent) =>
            terminalPrefixRecords.map((record) =>
                record.envelope.record_id === descriptorRecordId
                    ? {
                          ...record,
                          body: {
                              ...record.body,
                              constituents: [
                                  {
                                      ...(
                                          record.body.constituents as readonly Record<
                                              string,
                                              unknown
                                          >[]
                                      )[0],
                                      ...constituent,
                                  },
                                  ...(
                                      record.body.constituents as readonly Record<string, unknown>[]
                                  ).slice(1),
                              ],
                          } as AppendBody,
                      }
                    : record,
            ),
        ),
    ];
    for (const records of malformedTerminalPrefixes) {
        using malformedHeadStore = new OwnerProjectionStore(runId, records, store);
        assert.throws(() => readDurableTaskExecution(malformedHeadStore, runId), TraceStoreError);
    }
    using wrongCutOwnerStore = new OwnerProjectionStore(
        runId,
        terminalPrefixRecords,
        store,
        (cutEvidence) => ({ ...cutEvidence, target_owner_id: "run:other" }),
    );
    assert.throws(() => readDurableTaskExecution(wrongCutOwnerStore, runId), TraceStoreError);
    assert.throws(
        () =>
            resumeDurableTask(store, {
                commandId: "command:resume:after-direct-cancel",
                continuationDescriptorRecordId:
                    retainedSuspension.continuation_descriptor_record_id,
                expectedLifecycleRecordId: retainedSuspension.acknowledgement_record_id,
                runId,
            }),
        TraceStoreError,
    );
    store.close();
    const reopened = new SQLiteTraceStore(databasePath);
    assert.deepEqual(cancelDurableTask(reopened, options), cancelled);
    reopened.close();
});

test("waiting cancellation terminalizes from retained prerequisite evidence", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-waiting-cancellation-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const databasePath = path.join(directory, "trace.sqlite");
    const store = new ObservingStartStore(databasePath);
    const runId = "run:cancellation-waiting-public";
    let releaseProvider: (() => void) | undefined;
    const providerRelease = new Promise<void>((resolve) => {
        releaseProvider = resolve;
    });
    const running = executeTaskDurably(store, {
        budget: { maxTurns: 1 },
        input: undefined,
        provider: {
            descriptor: () => ({
                capabilities: { streaming: false, structuredOutput: true, tools: false },
                id: "waiting-cancellation-provider",
                kind: "static" as const,
                model: "offline-v1",
            }),
            invoke: async () => {
                await providerRelease;
                return {
                    output: "must be fenced",
                    usage: {
                        cacheCreationInputTokens: 0,
                        cacheReadInputTokens: 0,
                        costUsd: null,
                        inputTokens: 1,
                        outputTokens: 1,
                    },
                };
            },
        },
        runId,
        task: task({
            input: schema.void(),
            instruction: "Wait for a prerequisite before direct cancellation.",
            name: "waiting-cancellation",
            output: schema.string(),
            version: "1.0.0",
        }),
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const startedRecordId = inspectDurableTaskExecution(store, runId).lifecycle.started_record_id;
    assert.ok(startedRecordId && store.claimId && store.fencingToken);
    const cut = store.publishCut({
        cut_id: "cut:waiting-direct-cancel",
        target_owner_id: runId,
        through_record_id: startedRecordId,
    });
    const descriptorBody = {
        constituents: runProtocolConfig.execution.continuationConstituentKinds.map((kind) => ({
            kind,
            status: "not_required",
        })),
        continuation_version: runProtocolConfig.execution.continuationVersion,
        execution_id: runId,
        trace_cut_id: cut.cut_id,
    };
    const descriptorLocalId = "waiting-descriptor";
    const descriptorRecordId = createRecordEnvelope({
        body: descriptorBody,
        caused_by_record_ids: [cut.created_by_record_id],
        mode: "capture",
        schema_ref: runProtocolConfig.schemas.continuationDescriptorId,
        witness_ref: ROOT_WITNESS_ID,
    }).record_id;
    const waitingReceipt = store.append({
        append_intent_id: "append:waiting-before-direct-cancel",
        batch: {
            groups: [
                {
                    owner_id: runId,
                    records: [
                        {
                            append_local_id: descriptorLocalId,
                            body: descriptorBody,
                            caused_by_record_ids: [cut.created_by_record_id],
                            mode: "capture",
                            schema_ref: runProtocolConfig.schemas.continuationDescriptorId,
                            witness_ref: ROOT_WITNESS_ID,
                        },
                        {
                            body: {
                                continuation_descriptor_id: descriptorRecordId,
                                execution_id: runId,
                                lifecycle_version: runProtocolConfig.execution.lifecycleVersion,
                                prerequisite: {
                                    kind: "external",
                                    prerequisite_id: "prerequisite:waiting-cancel",
                                },
                                status: runProtocolConfig.execution.lifecycleWaitingStatus,
                            },
                            caused_by_record_ids: [startedRecordId],
                            caused_by_local_refs: [descriptorLocalId],
                            mode: "capture",
                            schema_ref: runProtocolConfig.schemas.waitingLifecycleId,
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    });
    const waitingRecordId = waitingReceipt.record_ids[1] as RecordId;
    assert.throws(
        () =>
            cancelDurableTask(store, {
                commandId: "command:cancel:waiting-active-worker",
                expectedLifecycleRecordId: waitingRecordId,
                reason: "worker has not released authority",
                runId,
            }),
        TraceStoreError,
    );
    using database = new DatabaseSync(databasePath);
    database
        .prepare(
            "UPDATE durable_execution_claims SET lease_expires_at = 0, started = 0 WHERE run_id = ?",
        )
        .run(runId);
    assert.equal(inspectDurableTaskExecution(store, runId).lifecycle.quiescent?.status, "waiting");
    const options = {
        commandId: "command:cancel:waiting-public",
        expectedLifecycleRecordId: waitingRecordId,
        reason: "operator cancels waiting run",
        runId,
    } as const;
    const cancelled = cancelDurableTask(store, options);
    releaseProvider?.();
    await assert.rejects(running, DurableExecutionClaimFencedError);
    assert.equal(cancelled.execution.outcome.outcome.status, "cancelled");
    assert.equal(cancelled.ledger.started, true);
    assert.equal(inspectDurableTaskExecution(store, runId).status, "committed");
    const malformedWaitingRecords = store
        .readOwner(runId)
        .filter((record) => record.envelope.record_id !== cancelled.ledger.cut.created_by_record_id)
        .map((record) =>
            record.envelope.record_id === waitingRecordId
                ? {
                      ...record,
                      body: {
                          ...record.body,
                          prerequisite: {
                              ...(record.body.prerequisite as Readonly<Record<string, unknown>>),
                              kind: 1,
                          },
                      },
                  }
                : record,
        );
    using malformedWaitingStore = new OwnerProjectionStore(runId, malformedWaitingRecords, store);
    assert.throws(() => readDurableTaskExecution(malformedWaitingStore, runId), TraceStoreError);
    store.close();
    const reopened = new SQLiteTraceStore(databasePath);
    assert.deepEqual(cancelDurableTask(reopened, options), cancelled);
    reopened.close();
});

test("waiting acknowledgement atomically releases the worker at a prerequisite boundary", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-waiting-acknowledgement-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const databasePath = path.join(directory, "trace.sqlite");
    const store = new ObservingStartStore(databasePath);
    const runId = "run:waiting-acknowledgement-public";
    let reachSafeBoundary: (() => void) | undefined;
    const safeBoundary = new Promise<void>((resolve) => {
        reachSafeBoundary = resolve;
    });
    let waitingOptions: Parameters<typeof acknowledgeDurableTaskWaiting>[1] | undefined;
    let waitingReceipt: ReturnType<typeof acknowledgeDurableTaskWaiting> | undefined;
    const running = executeTaskDurably(store, {
        budget: { maxTurns: 1 },
        input: undefined,
        provider: {
            descriptor: () => ({
                capabilities: { streaming: false, structuredOutput: true, tools: false },
                id: "waiting-acknowledgement-provider",
                kind: "static" as const,
                model: "offline-v1",
            }),
            invoke: async () => {
                await safeBoundary;
                assert.ok(waitingOptions);
                waitingReceipt = acknowledgeDurableTaskWaiting(store, waitingOptions);
                return {
                    output: "must be fenced",
                    usage: {
                        cacheCreationInputTokens: 0,
                        cacheReadInputTokens: 0,
                        costUsd: null,
                        inputTokens: 1,
                        outputTokens: 1,
                    },
                };
            },
        },
        runId,
        task: task({
            input: schema.void(),
            instruction: "Wait for explicit approval.",
            name: "waiting-acknowledgement",
            output: schema.string(),
            version: "1.0.0",
        }),
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const startedRecordId = inspectDurableTaskExecution(store, runId).lifecycle.started_record_id;
    const fencingToken = store.fencingToken;
    assert.ok(startedRecordId && fencingToken);
    const prerequisiteId = "approval:waiting-acknowledgement";
    const traceCutId = "cut:waiting-acknowledgement";
    const constituents = runProtocolConfig.execution.continuationConstituentKinds.map(
        (configuredKind): RunContinuationCheckpointEvidence => ({
            kind: configuredKind as RunContinuationCheckpointEvidence["kind"],
            status: "not_required",
        }),
    );
    assert.throws(
        () =>
            acknowledgeDurableTaskWaiting(store, {
                constituents,
                expectedLifecycleRecordId: startedRecordId,
                fencingToken: 0,
                prerequisite: { kind: "approval", prerequisiteId },
                runId,
                traceCutId,
            }),
        TypeError,
    );
    assert.throws(
        () =>
            acknowledgeDurableTaskWaiting(store, {
                constituents: [],
                expectedLifecycleRecordId: startedRecordId,
                fencingToken,
                prerequisite: { kind: "approval", prerequisiteId },
                runId,
                traceCutId,
            }),
        TypeError,
    );
    assert.throws(
        () =>
            acknowledgeDurableTaskWaiting(store, {
                constituents: constituents.map((evidence, index) =>
                    index === 0 ? { kind: evidence.kind, status: "unavailable" } : evidence,
                ),
                expectedLifecycleRecordId: startedRecordId,
                fencingToken,
                prerequisite: { kind: "approval", prerequisiteId },
                runId,
                traceCutId,
            }),
        TypeError,
    );
    const waitingProbe = {
        append_intent_id: "append:waiting-probe",
        batch: { groups: [] },
    } as const;
    assert.throws(
        () =>
            store.appendDurableExecutionWaiting(
                runId,
                startedRecordId,
                0,
                traceCutId,
                waitingProbe,
            ),
        TypeError,
    );
    store.publishCut({
        cut_id: traceCutId,
        target_owner_id: runId,
        through_record_id: startedRecordId,
    });
    assert.throws(
        () =>
            store.appendDurableExecutionWaiting(
                runId,
                startedRecordId,
                fencingToken + 1,
                traceCutId,
                waitingProbe,
            ),
        TraceStoreError,
    );
    const createdRecordId = inspectDurableTaskExecution(store, runId).lifecycle.created_record_id;
    assert.ok(createdRecordId);
    const wrongCut = store.publishCut({
        cut_id: "cut:waiting-wrong-head",
        target_owner_id: runId,
        through_record_id: createdRecordId,
    });
    assert.throws(
        () =>
            store.appendDurableExecutionWaiting(
                runId,
                startedRecordId,
                fencingToken,
                wrongCut.cut_id,
                waitingProbe,
            ),
        TraceStoreError,
    );
    assert.throws(
        () =>
            store.appendDurableExecutionWaiting(
                runId,
                createdRecordId,
                fencingToken,
                wrongCut.cut_id,
                waitingProbe,
            ),
        TraceStoreError,
    );
    waitingOptions = {
        constituents,
        expectedLifecycleRecordId: startedRecordId,
        fencingToken,
        prerequisite: { kind: "approval", prerequisiteId },
        runId,
        traceCutId,
    };
    reachSafeBoundary?.();
    await assert.rejects(running, DurableExecutionClaimFencedError);
    assert.ok(waitingReceipt);
    const inspection = inspectDurableTaskExecution(store, runId);
    assert.equal(inspection.lifecycle.quiescent?.status, "waiting");
    assert.deepEqual(inspection.lifecycle.quiescent?.prerequisite, {
        kind: "approval",
        prerequisite_id: prerequisiteId,
    });
    const retainedWaitingOptions = waitingOptions;
    assert.ok(retainedWaitingOptions);
    store.close();
    using reopened = new SQLiteTraceStore(databasePath);
    assert.deepEqual(
        acknowledgeDurableTaskWaiting(reopened, retainedWaitingOptions),
        waitingReceipt,
    );
    assert.equal(
        inspectDurableTaskExecution(reopened, runId).lifecycle.quiescent?.status,
        "waiting",
    );
    const resumeBase = {
        commandId: "command:resume:waiting-acknowledgement",
        continuationDescriptorRecordId: waitingReceipt.continuation_descriptor_record_id,
        expectedLifecycleRecordId: waitingReceipt.acknowledgement_record_id,
        runId,
    } as const;
    assert.throws(() => resumeDurableTask(reopened, resumeBase), TraceStoreError);
    assert.throws(
        () =>
            resumeDurableTask(reopened, {
                ...resumeBase,
                commandId: "command:resume:waiting-mismatched-prerequisite",
                prerequisiteSatisfaction: {
                    kind: "approval",
                    prerequisiteId: "approval:other",
                    receiptId: "receipt:approval:other",
                },
            }),
        TraceStoreError,
    );
    const resumeOptions = {
        ...resumeBase,
        prerequisiteSatisfaction: {
            kind: "approval",
            prerequisiteId,
            receiptId: "receipt:approval:waiting-acknowledgement",
        },
    } as const;
    assert.throws(
        () =>
            resumeDurableTask(reopened, {
                ...resumeOptions,
                commandId: "command:resume:waiting-empty-receipt",
                prerequisiteSatisfaction: {
                    ...resumeOptions.prerequisiteSatisfaction,
                    receiptId: "",
                },
            }),
        TypeError,
    );
    const resumed = resumeDurableTask(reopened, resumeOptions);
    assert.equal(resumed.fencing_token, fencingToken + 1);
    assert.equal(
        inspectDurableTaskExecution(reopened, runId).lifecycle.running_continuation_record_id,
        resumed.running_record_id,
    );
    assert.throws(
        () =>
            reopened.appendDurableExecutionWaiting(
                runId,
                startedRecordId,
                resumed.fencing_token,
                traceCutId,
                {
                    append_intent_id: "append:waiting-stale-running-head",
                    batch: { groups: [] },
                },
            ),
        TraceStoreError,
    );
    const resumedRecords = reopened.readOwner(runId);
    const resumeCommand = resumedRecords.find(
        (record) => record.envelope.record_id === resumed.command_record_id,
    );
    assert.ok(resumeCommand);
    for (const prerequisite_satisfaction of [
        undefined,
        {
            kind: "approval",
            prerequisite_id: "approval:other",
            receipt_id: "receipt:approval:waiting-acknowledgement",
        },
    ]) {
        using malformedResumeStore = new OwnerProjectionStore(
            runId,
            resumedRecords.map((record) =>
                record.envelope.record_id === resumed.command_record_id
                    ? {
                          ...record,
                          body: {
                              ...record.body,
                              prerequisite_satisfaction,
                          },
                      }
                    : record,
            ),
        );
        assert.throws(
            () => inspectDurableTaskExecution(malformedResumeStore, runId),
            TraceStoreError,
        );
    }
    using competing = new SQLiteTraceStore(databasePath);
    assert.deepEqual(resumeDurableTask(competing, resumeOptions), resumed);
    assert.throws(
        () =>
            resumeDurableTask(competing, {
                ...resumeOptions,
                prerequisiteSatisfaction: {
                    ...resumeOptions.prerequisiteSatisfaction,
                    receiptId: "receipt:approval:changed",
                },
            }),
        TraceStoreError,
    );
});

class InterruptingCutStore extends SQLiteTraceStore {
    #interrupt = true;

    override publishCut(spec: CutSpec): Cut {
        if (this.#interrupt) {
            this.#interrupt = false;
            throw new Error("cut publication interrupted");
        }
        return super.publishCut(spec);
    }
}

class ObservingStartStore extends SQLiteTraceStore {
    claimId: string | null = null;
    fencingToken: number | null = null;

    override appendDurableExecutionStart(
        runId: string,
        claimId: string,
        fencingToken: number,
        nowMilliseconds = Date.now(),
        recoveryCommandRecordId: string | null = null,
    ) {
        const appended = super.appendDurableExecutionStart(
            runId,
            claimId,
            fencingToken,
            nowMilliseconds,
            recoveryCommandRecordId,
        );
        this.claimId = claimId;
        this.fencingToken = fencingToken;
        return appended;
    }
}

class InterruptingCancellationStore extends ObservingStartStore {
    #interrupt = true;

    override publishCut(spec: CutSpec): Cut {
        if (this.#interrupt) {
            this.#interrupt = false;
            throw new Error("cancellation cut publication interrupted");
        }
        return super.publishCut(spec);
    }
}

class LostSuspensionReceiptStore extends ObservingStartStore {
    #loseReceipt = true;

    override appendDurableExecutionSuspension(
        runId: string,
        expectedLifecycleRecordId: RecordId,
        fencingToken: number,
        pauseCommandRecordId: RecordId,
        traceCutId: string,
        request: Parameters<SQLiteTraceStore["appendDurableExecutionSuspension"]>[5],
    ) {
        const receipt = super.appendDurableExecutionSuspension(
            runId,
            expectedLifecycleRecordId,
            fencingToken,
            pauseCommandRecordId,
            traceCutId,
            request,
        );
        if (this.#loseReceipt) {
            this.#loseReceipt = false;
            throw new Error("suspension receipt lost after commit");
        }
        return receipt;
    }
}

class NonPublishingCutStore extends SQLiteTraceStore {
    override publishCut(spec: CutSpec): Cut {
        return {
            created_by_record_id: ROOT_WITNESS_ID,
            cut_id: spec.cut_id,
            publisher_owner_id: spec.publisher_owner_id ?? spec.target_owner_id,
            target_owner_id: spec.target_owner_id,
            through_owner_ordinal: 0,
            through_record_id: spec.through_record_id,
        };
    }
}

class HidingRecordStore extends SQLiteTraceStore {
    hiddenRecordId: RecordId | null = null;

    override readRecord(recordId: RecordId): RetainedRecord | undefined {
        return recordId === this.hiddenRecordId ? undefined : super.readRecord(recordId);
    }
}

class OwnerProjectionStore extends SQLiteTraceStore {
    readonly #cutTransform: ((cut: Cut) => Cut) | undefined;
    readonly #records: readonly OwnerRecord[];
    readonly #runId: string;
    readonly #source: SQLiteTraceStore | undefined;

    constructor(
        runId: string,
        records: readonly OwnerRecord[],
        source?: SQLiteTraceStore,
        cutTransform?: (cut: Cut) => Cut,
    ) {
        super();
        this.#cutTransform = cutTransform;
        this.#records = records;
        this.#runId = runId;
        this.#source = source;
    }

    override readOwner(ownerId: string): readonly OwnerRecord[] {
        return ownerId === this.#runId ? this.#records : [];
    }

    override readRecord(recordId: RecordId): RetainedRecord | undefined {
        const record = this.#records.find((candidate) => candidate.envelope.record_id === recordId);
        return record === undefined
            ? undefined
            : { body: record.body, envelope: record.envelope, views: [record.view] };
    }

    override readCut(cutId: string): Cut {
        const cut = this.#source?.readCut(cutId) ?? super.readCut(cutId);
        return this.#cutTransform?.(cut) ?? cut;
    }
}

test("durable resume replay fails closed for incomplete or malformed retained evidence", () => {
    const runId = "run:resume:scripted";
    const commandId = "command:resume:scripted";
    const claimId = "claim:resume:scripted";
    const commandBody = createDurableResumeCommand(
        runId,
        commandId,
        ROOT_WITNESS_ID,
        ROOT_WITNESS_ID,
    );
    const commandRow = createStoredRecordRow(
        commandBody,
        runProtocolConfig.execution.controlCommandSchemaId,
        [ROOT_WITNESS_ID, ROOT_WITNESS_ID],
    );
    const commandRecordId = String(commandRow.record_id);
    const validRunningBody = {
        claim_id: claimId,
        continuation_descriptor_id: ROOT_WITNESS_ID,
        execution_id: runId,
        fencing_token: 2,
        lease_expires_at: 10,
        lifecycle_version: runProtocolConfig.execution.lifecycleVersion,
        resume_command_id: commandRecordId,
        status: runProtocolConfig.execution.lifecycleRunningStatus,
    };
    const call = (database: DatabaseSync): void => {
        appendDurableExecutionResume(
            database,
            runId,
            commandId,
            ROOT_WITNESS_ID,
            ROOT_WITNESS_ID,
            claimId,
            0,
            1,
        );
    };
    assert.throws(
        () => call(createResumeReplayDatabase([commandRecordId], new Map())),
        TraceStoreError,
    );
    assert.throws(
        () =>
            call(
                createResumeReplayDatabase(
                    [commandRecordId, ROOT_WITNESS_ID],
                    new Map([[commandRecordId, commandRow]]),
                ),
            ),
        TraceStoreError,
    );
    for (const body of [
        { ...validRunningBody, status: "invalid" },
        { ...validRunningBody, execution_id: "run:other" },
        { ...validRunningBody, lifecycle_version: 2 },
        { ...validRunningBody, claim_id: 1 },
        { ...validRunningBody, fencing_token: "2" },
        { ...validRunningBody, lease_expires_at: "10" },
        { ...validRunningBody, extra: true },
    ]) {
        const semanticBody = body as AppendBody;
        const runningRow = createStoredRecordRow(
            semanticBody,
            runProtocolConfig.schemas.runningLifecycleId,
            [ROOT_WITNESS_ID, ROOT_WITNESS_ID, commandRecordId],
        );
        const runningRecordId = String(runningRow.record_id);
        assert.throws(
            () =>
                call(
                    createResumeReplayDatabase(
                        [commandRecordId, runningRecordId],
                        new Map([
                            [commandRecordId, commandRow],
                            [runningRecordId, runningRow],
                        ]),
                    ),
                ),
            Error,
        );
    }
});

test("requestDurableTaskPause retains one exact command without changing lifecycle", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-pause-command-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const databasePath = path.join(directory, "trace.sqlite");
    let releaseInvocation: (() => void) | undefined;
    const released = new Promise<void>((resolve) => {
        releaseInvocation = resolve;
    });
    const fixtureTask = task({
        input: schema.void(),
        instruction: "Remain running while pause is requested.",
        name: "pause-command",
        output: schema.string(),
        version: "1.0.0",
    });
    let invocationCount = 0;
    const store = new ObservingStartStore(databasePath);
    const runId = "run:pause-command";
    const running = executeTaskDurably(store, {
        budget: { maxTurns: 1 },
        input: undefined,
        provider: {
            descriptor: () => ({
                capabilities: { streaming: false, structuredOutput: true, tools: false },
                id: "pause-command-provider",
                kind: "static" as const,
                model: "offline-v1",
            }),
            invoke: async () => {
                invocationCount += 1;
                await released;
                return {
                    output: "complete",
                    usage: {
                        cacheCreationInputTokens: 0,
                        cacheReadInputTokens: 0,
                        costUsd: null,
                        inputTokens: 1,
                        outputTokens: 1,
                    },
                };
            },
        },
        runId,
        task: fixtureTask,
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const before = inspectDurableTaskExecution(store, runId);
    const expectedLifecycleRecordId = before.lifecycle.started_record_id;
    const fencingToken = store.fencingToken;
    assert.ok(expectedLifecycleRecordId && fencingToken);
    const options = {
        commandId: "command:pause:one",
        expectedLifecycleRecordId,
        fencingToken,
        reason: "operator requested maintenance",
        runId,
    } as const;

    const retained = requestDurableTaskPause(store, options);
    const commandRecord = store.readRecord(retained.record_id);
    assert.deepEqual(commandRecord?.body, {
        command_id: options.commandId,
        command_kind: "pause",
        execution_id: runId,
        expected_lifecycle_record_id: expectedLifecycleRecordId,
        fencing_token: fencingToken,
        reason: options.reason,
    });
    assert.deepEqual(commandRecord?.envelope.caused_by_record_ids, [expectedLifecycleRecordId]);
    assert.equal(readDurableTaskExecution(store, runId).status, "started");
    assert.equal(inspectDurableTaskExecution(store, runId).lifecycle.quiescent, null);

    using reopened = new SQLiteTraceStore(databasePath);
    assert.deepEqual(requestDurableTaskPause(reopened, options), retained);
    assert.throws(
        () => requestDurableTaskPause(reopened, { ...options, reason: "conflicting reason" }),
        TraceStoreError,
    );
    assert.throws(
        () =>
            requestDurableTaskPause(reopened, {
                ...options,
                commandId: "command:pause:stale-token",
                fencingToken: fencingToken + 1,
            }),
        TraceStoreError,
    );
    assert.throws(
        () =>
            requestDurableTaskPause(reopened, {
                ...options,
                commandId: "command:pause:stale-head",
                expectedLifecycleRecordId: before.lifecycle.created_record_id as string,
            }),
        TraceStoreError,
    );

    releaseInvocation?.();
    await running;
    assert.deepEqual(requestDurableTaskPause(reopened, options), retained);
    assert.throws(
        () =>
            requestDurableTaskPause(reopened, {
                ...options,
                commandId: "command:pause:after-terminal",
            }),
        TraceStoreError,
    );
    assert.equal(invocationCount, 1);
    store.close();
});

test("safe-boundary cancellation publishes a command-bound terminal and fences the worker", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-cancellation-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const databasePath = path.join(directory, "trace.sqlite");
    const store = new InterruptingCancellationStore(databasePath);
    const runId = "run:cancellation";
    let reachSafeBoundary: (() => void) | undefined;
    const safeBoundary = new Promise<void>((resolve) => {
        reachSafeBoundary = resolve;
    });
    let acknowledgement: ReturnType<typeof acknowledgeDurableTaskCancellation> | undefined;
    let cancellationOptions: Parameters<typeof acknowledgeDurableTaskCancellation>[1] | undefined;
    const running = executeTaskDurably(store, {
        budget: { maxTurns: 1 },
        input: undefined,
        provider: {
            descriptor: () => ({
                capabilities: { streaming: false, structuredOutput: true, tools: false },
                id: "cancellation-provider",
                kind: "static" as const,
                model: "offline-v1",
            }),
            invoke: async () => {
                await safeBoundary;
                const options = cancellationOptions;
                assert.ok(options);
                assert.throws(
                    () => acknowledgeDurableTaskCancellation(store, options),
                    /cancellation cut publication interrupted/,
                );
                const nonPublishing = new NonPublishingCutStore(databasePath);
                assert.throws(
                    () => acknowledgeDurableTaskCancellation(nonPublishing, options),
                    TraceStoreError,
                );
                nonPublishing.close();
                acknowledgement = acknowledgeDurableTaskCancellation(store, options);
                return {
                    output: "must be fenced",
                    usage: {
                        cacheCreationInputTokens: 0,
                        cacheReadInputTokens: 0,
                        costUsd: null,
                        inputTokens: 1,
                        outputTokens: 1,
                    },
                };
            },
        },
        runId,
        task: task({
            input: schema.void(),
            instruction: "Acknowledge cancellation at a safe boundary.",
            name: "cancellation",
            output: schema.string(),
            version: "1.0.0",
        }),
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const expectedLifecycleRecordId = inspectDurableTaskExecution(store, runId).lifecycle
        .started_record_id;
    const fencingToken = store.fencingToken;
    const claimId = store.claimId;
    assert.ok(expectedLifecycleRecordId && fencingToken && claimId);
    const command = requestDurableTaskCancellation(store, {
        commandId: "command:cancel:running",
        expectedLifecycleRecordId,
        fencingToken,
        reason: "operator cancellation",
        runId,
    });
    const competingStore = new SQLiteTraceStore(databasePath);
    const competingCommand = requestDurableTaskCancellation(competingStore, {
        commandId: "command:cancel:competing",
        expectedLifecycleRecordId,
        fencingToken,
        reason: "competing operator cancellation",
        runId,
    });
    assert.throws(
        () =>
            requestDurableTaskCancellation(store, {
                commandId: "command:cancel:invalid-token",
                expectedLifecycleRecordId,
                fencingToken: 0,
                reason: "operator cancellation",
                runId,
            }),
        TypeError,
    );
    assert.deepEqual(
        requestDurableTaskCancellation(store, {
            commandId: "command:cancel:running",
            expectedLifecycleRecordId,
            fencingToken,
            reason: "operator cancellation",
            runId,
        }),
        command,
    );
    assert.throws(
        () =>
            requestDurableTaskCancellation(store, {
                commandId: "command:cancel:running",
                expectedLifecycleRecordId,
                fencingToken,
                reason: "different cancellation",
                runId,
            }),
        TraceStoreError,
    );
    assert.equal(inspectDurableTaskExecution(store, runId).status, "started");
    cancellationOptions = {
        cancelCommandRecordId: command.record_id,
        claimId,
        expectedLifecycleRecordId,
        fencingToken,
        runId,
    };
    assert.throws(
        () =>
            acknowledgeDurableTaskCancellation(store, {
                ...cancellationOptions,
                cancelCommandRecordId: ROOT_WITNESS_ID,
            }),
        TraceStoreError,
    );
    assert.throws(
        () =>
            acknowledgeDurableTaskCancellation(store, {
                ...cancellationOptions,
                fencingToken: fencingToken + 1,
            }),
        TraceStoreError,
    );
    assert.throws(
        () =>
            acknowledgeDurableTaskCancellation(store, {
                ...cancellationOptions,
                fencingToken: 0,
            }),
        TypeError,
    );
    const hidingCreation = new HidingRecordStore(databasePath);
    hidingCreation.hiddenRecordId = inspectDurableTaskExecution(
        store,
        runId,
    ).lifecycle.created_record_id;
    assert.throws(
        () => acknowledgeDurableTaskCancellation(hidingCreation, cancellationOptions),
        TraceStoreError,
    );
    hidingCreation.close();
    reachSafeBoundary?.();
    await assert.rejects(running, DurableExecutionClaimFencedError);
    const retainedAcknowledgement = acknowledgement;
    assert.ok(retainedAcknowledgement);
    assert.equal(retainedAcknowledgement.execution.outcome.outcome.status, "cancelled");
    assert.equal(
        retainedAcknowledgement.execution.outcome.outcome.reason,
        runProtocolConfig.control.cancellationReason,
    );
    assert.deepEqual(
        acknowledgeDurableTaskCancellation(store, cancellationOptions),
        retainedAcknowledgement,
    );
    assert.throws(
        () =>
            acknowledgeDurableTaskCancellation(competingStore, {
                ...cancellationOptions,
                cancelCommandRecordId: competingCommand.record_id,
            }),
        TraceStoreError,
    );
    competingStore.close();
    const inspection = inspectDurableTaskExecution(store, runId);
    assert.equal(inspection.status, "committed");
    assert.equal(inspection.outcome?.outcome.outcome.status, "cancelled");
    const retainedRecords = store.readOwner(runId);
    const retainedCommand = retainedRecords.find(
        (record) => record.envelope.record_id === command.record_id,
    );
    assert.ok(retainedCommand);
    const mismatchedCommandRecords = retainedRecords.map((record) =>
        record.envelope.record_id === command.record_id
            ? {
                  ...record,
                  body: {
                      ...record.body,
                      expected_lifecycle_record_id: ROOT_WITNESS_ID,
                  },
              }
            : record,
    );
    using mismatchedCommandStore = new OwnerProjectionStore(runId, mismatchedCommandRecords);
    assert.throws(() => readDurableTaskExecution(mismatchedCommandStore, runId), TraceStoreError);

    const secondCommandBody = createDurableCancellationCommand(
        runId,
        "command:cancel:ambiguous",
        expectedLifecycleRecordId,
        fencingToken,
        "second cancellation",
    );
    const secondCommandEnvelope = createRecordEnvelope({
        body: secondCommandBody,
        caused_by_record_ids: [expectedLifecycleRecordId],
        mode: "capture",
        schema_ref: runProtocolConfig.execution.controlCommandSchemaId,
        witness_ref: ROOT_WITNESS_ID,
    });
    const ambiguousRecords = retainedRecords.flatMap((record) => {
        if (record.envelope.record_id === retainedAcknowledgement.ledger.outcome_record_id) {
            return [
                {
                    body: secondCommandBody,
                    envelope: secondCommandEnvelope,
                    view: retainedCommand.view,
                },
                {
                    ...record,
                    envelope: {
                        ...record.envelope,
                        caused_by_record_ids: [
                            expectedLifecycleRecordId,
                            command.record_id,
                            secondCommandEnvelope.record_id,
                        ],
                    },
                },
            ];
        }
        if (record.envelope.record_id === retainedAcknowledgement.ledger.lifecycle_record_id) {
            return [
                {
                    ...record,
                    envelope: {
                        ...record.envelope,
                        caused_by_record_ids: [
                            expectedLifecycleRecordId,
                            command.record_id,
                            secondCommandEnvelope.record_id,
                            retainedAcknowledgement.ledger.outcome_record_id,
                        ],
                    },
                },
            ];
        }
        return [record];
    });
    using ambiguousCommandStore = new OwnerProjectionStore(runId, ambiguousRecords);
    assert.throws(() => readDurableTaskExecution(ambiguousCommandStore, runId), TraceStoreError);
    store.close();
    const hidingOutcome = new HidingRecordStore(databasePath);
    hidingOutcome.hiddenRecordId = retainedAcknowledgement.ledger.outcome_record_id;
    assert.throws(
        () => acknowledgeDurableTaskCancellation(hidingOutcome, cancellationOptions),
        TraceStoreError,
    );
    hidingOutcome.close();
    const reopened = new SQLiteTraceStore(databasePath);
    assert.deepEqual(
        requestDurableTaskCancellation(reopened, {
            commandId: "command:cancel:running",
            expectedLifecycleRecordId,
            fencingToken,
            reason: "operator cancellation",
            runId,
        }),
        command,
    );
    assert.deepEqual(
        acknowledgeDurableTaskCancellation(reopened, cancellationOptions),
        retainedAcknowledgement,
    );
    reopened.close();
});

test("cancellation acknowledgement rejects created and non-command terminal evidence", async () => {
    const createdStore = new InterruptingStartStore();
    const createdRunId = "run:cancellation-created";
    await assert.rejects(
        executeTaskDurably(createdStore, {
            budget: { maxTurns: 1 },
            input: undefined,
            provider: createStaticProvider({
                descriptor: { id: "cancellation-created-provider", model: "offline-v1" },
                exchanges: [],
            }),
            runId: createdRunId,
            task: task({
                input: schema.void(),
                instruction: "Retain creation before cancellation validation.",
                name: "cancellation-created",
                output: schema.string(),
                version: "1.0.0",
            }),
        }),
        /start publication interrupted/,
    );
    const created = readDurableTaskExecution(createdStore, createdRunId);
    assert.equal(created.status, "created");
    if (created.status !== "created") {
        throw new Error("expected created recovery evidence");
    }
    const createdCommand = createdStore.append({
        append_intent_id: "intent:cancel-created",
        batch: {
            groups: [
                {
                    caused_by_record_ids: [created.created_record_id],
                    owner_id: createdRunId,
                    records: [
                        {
                            body: createDurableCancellationCommand(
                                createdRunId,
                                "command:cancel-created",
                                created.created_record_id,
                                1,
                                "operator cancellation",
                            ),
                            mode: "capture",
                            schema_ref: runProtocolConfig.execution.controlCommandSchemaId,
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    });
    assert.throws(
        () =>
            acknowledgeDurableTaskCancellation(createdStore, {
                cancelCommandRecordId: createdCommand.record_ids[0] as RecordId,
                claimId: "claim:created",
                expectedLifecycleRecordId: created.created_record_id,
                fencingToken: 1,
                runId: createdRunId,
            }),
        TraceStoreError,
    );
    createdStore.close();

    const terminalStore = new ObservingStartStore();
    const terminalRunId = "run:cancellation-non-command-terminal";
    let releaseProvider: (() => void) | undefined;
    const providerRelease = new Promise<void>((resolve) => {
        releaseProvider = resolve;
    });
    const terminalExecution = executeTaskDurably(terminalStore, {
        budget: { maxTurns: 1 },
        input: undefined,
        provider: {
            descriptor: () => ({
                capabilities: { streaming: false, structuredOutput: true, tools: false },
                id: "cancellation-terminal-provider",
                kind: "static" as const,
                model: "offline-v1",
            }),
            invoke: async () => {
                await providerRelease;
                return {
                    output: "finished",
                    usage: {
                        cacheCreationInputTokens: 0,
                        cacheReadInputTokens: 0,
                        costUsd: null,
                        inputTokens: 1,
                        outputTokens: 1,
                    },
                };
            },
        },
        runId: terminalRunId,
        task: task({
            input: schema.void(),
            instruction: "Finish without acknowledging cancellation.",
            name: "cancellation-non-command-terminal",
            output: schema.string(),
            version: "1.0.0",
        }),
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const terminalHead = inspectDurableTaskExecution(terminalStore, terminalRunId).lifecycle
        .started_record_id;
    assert.ok(terminalHead && terminalStore.claimId && terminalStore.fencingToken);
    const ignoredCommand = requestDurableTaskCancellation(terminalStore, {
        commandId: "command:cancel-ignored",
        expectedLifecycleRecordId: terminalHead,
        fencingToken: terminalStore.fencingToken,
        reason: "operator cancellation",
        runId: terminalRunId,
    });
    releaseProvider?.();
    await terminalExecution;
    assert.throws(
        () =>
            acknowledgeDurableTaskCancellation(terminalStore, {
                cancelCommandRecordId: ignoredCommand.record_id,
                claimId: terminalStore.claimId as string,
                expectedLifecycleRecordId: terminalHead,
                fencingToken: terminalStore.fencingToken as number,
                runId: terminalRunId,
            }),
        TraceStoreError,
    );
    terminalStore.close();
});

test("safe-boundary suspension publishes exact checkpoint evidence and fences the worker", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-suspension-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const databasePath = path.join(directory, "trace.sqlite");
    const store = new LostSuspensionReceiptStore(databasePath);
    const runId = "run:suspension";
    const fixtureTask = task({
        input: schema.void(),
        instruction: "Acknowledge suspension at the provider safe boundary.",
        name: "suspension",
        output: schema.string(),
        version: "1.0.0",
    });
    let enterSafeBoundary: (() => void) | undefined;
    const safeBoundary = new Promise<void>((resolve) => {
        enterSafeBoundary = resolve;
    });
    let suspensionOptions: Parameters<typeof acknowledgeDurableTaskSuspension>[1] | undefined;
    let suspensionReceipt: ReturnType<typeof acknowledgeDurableTaskSuspension> | undefined;
    const running = executeTaskDurably(store, {
        budget: { maxTurns: 1 },
        input: undefined,
        provider: {
            descriptor: () => ({
                capabilities: { streaming: false, structuredOutput: true, tools: false },
                id: "suspension-provider",
                kind: "static" as const,
                model: "offline-v1",
            }),
            invoke: async () => {
                await safeBoundary;
                const options = suspensionOptions;
                assert.ok(options);
                assert.throws(
                    () => acknowledgeDurableTaskSuspension(store, options),
                    /suspension receipt lost after commit/,
                );
                const retryStore = new SQLiteTraceStore(databasePath);
                suspensionReceipt = acknowledgeDurableTaskSuspension(retryStore, options);
                retryStore.close();
                return {
                    output: "must be fenced",
                    usage: {
                        cacheCreationInputTokens: 0,
                        cacheReadInputTokens: 0,
                        costUsd: null,
                        inputTokens: 1,
                        outputTokens: 1,
                    },
                };
            },
        },
        runId,
        task: fixtureTask,
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const expectedLifecycleRecordId = inspectDurableTaskExecution(store, runId).lifecycle
        .started_record_id;
    const fencingToken = store.fencingToken;
    const claimId = store.claimId;
    assert.ok(expectedLifecycleRecordId && fencingToken && claimId);
    const pause = requestDurableTaskPause(store, {
        commandId: "command:pause:suspension",
        expectedLifecycleRecordId,
        fencingToken,
        reason: "checkpoint now",
        runId,
    });
    const traceCutId = "cut:suspension:safe-boundary";
    store.publishCut({
        cut_id: traceCutId,
        target_owner_id: runId,
        through_record_id: expectedLifecycleRecordId,
    });
    assert.throws(
        () =>
            store.appendDurableExecutionTerminal(runId, claimId, 0, {
                append_intent_id: "invalid",
                batch: { groups: [] },
            }),
        TypeError,
    );
    assert.equal(
        store.appendDurableExecutionTerminal("run:missing", claimId, fencingToken, {
            append_intent_id: "append:missing-terminal",
            batch: { groups: [] },
        }).status,
        "fenced",
    );
    assert.equal(
        store.appendDurableExecutionTerminal(runId, "claim:stale", fencingToken, {
            append_intent_id: "append:stale-terminal",
            batch: { groups: [] },
        }).status,
        "fenced",
    );
    assert.equal(
        store.appendDurableExecutionTerminal(runId, claimId, fencingToken + 1, {
            append_intent_id: "append:wrong-token-terminal",
            batch: { groups: [] },
        }).status,
        "fenced",
    );
    assert.throws(
        () =>
            store.appendDurableExecutionTerminal(runId, claimId, fencingToken, {
                append_intent_id: "",
                batch: { groups: [] },
            }),
        TypeError,
    );
    const suspensionProbe = {
        append_intent_id: "append:suspension-probe",
        batch: { groups: [] },
    } as const;
    assert.throws(
        () =>
            store.appendDurableExecutionSuspension(
                runId,
                expectedLifecycleRecordId,
                0,
                pause.record_id,
                traceCutId,
                suspensionProbe,
            ),
        TypeError,
    );
    assert.throws(
        () =>
            store.appendDurableExecutionSuspension(
                runId,
                expectedLifecycleRecordId,
                fencingToken + 1,
                pause.record_id,
                traceCutId,
                suspensionProbe,
            ),
        TraceStoreError,
    );
    assert.throws(
        () =>
            store.appendDurableExecutionSuspension(
                runId,
                expectedLifecycleRecordId,
                fencingToken,
                ROOT_WITNESS_ID,
                traceCutId,
                suspensionProbe,
            ),
        TraceStoreError,
    );
    const wrongCut = store.publishCut({
        cut_id: "cut:suspension:wrong-boundary",
        target_owner_id: runId,
        through_record_id: pause.record_id,
    });
    assert.throws(
        () =>
            store.appendDurableExecutionSuspension(
                runId,
                expectedLifecycleRecordId,
                fencingToken,
                pause.record_id,
                wrongCut.cut_id,
                suspensionProbe,
            ),
        TraceStoreError,
    );
    const observedContexts: unknown[] = [];
    const constituents = await captureRunContinuationCheckpoints({
        adapters: [
            {
                checkpoint: async (checkpointContext) => {
                    observedContexts.push(checkpointContext);
                    return { kind: "world", receipt_id: "receipt:world", status: "verified" };
                },
                kind: "world",
            },
            {
                checkpoint: async (checkpointContext) => {
                    observedContexts.push(checkpointContext);
                    return { kind: "provider_session", status: "not_required" };
                },
                kind: "provider_session",
            },
            {
                checkpoint: async (checkpointContext) => {
                    observedContexts.push(checkpointContext);
                    return { kind: "process", receipt_id: "receipt:process", status: "verified" };
                },
                kind: "process",
            },
            {
                checkpoint: async (checkpointContext) => {
                    observedContexts.push(checkpointContext);
                    return { kind: "prerequisite", status: "not_required" };
                },
                kind: "prerequisite",
            },
        ],
        expectedLifecycleRecordId,
        runId,
        traceCutId,
    });
    assert.equal(observedContexts.length, 4);
    assert.ok(observedContexts.every((value) => value === observedContexts[0]));
    suspensionOptions = {
        constituents,
        expectedLifecycleRecordId,
        fencingToken,
        pauseCommandRecordId: pause.record_id,
        runId,
        traceCutId,
    };
    enterSafeBoundary?.();
    await assert.rejects(running, DurableExecutionClaimFencedError);
    const retainedSuspension = suspensionReceipt;
    assert.ok(retainedSuspension);
    const inspection = inspectDurableTaskExecution(store, runId);
    assert.equal(inspection.status, "started");
    assert.equal(inspection.lifecycle.quiescent?.status, "suspended");
    assert.deepEqual(inspection.lifecycle.quiescent?.continuation.constituents, [
        { kind: "world", receipt_id: "receipt:world", status: "verified" },
        { kind: "provider_session", receipt_id: null, status: "not_required" },
        { kind: "process", receipt_id: "receipt:process", status: "verified" },
        { kind: "prerequisite", receipt_id: null, status: "not_required" },
    ]);
    using reopened = new SQLiteTraceStore(databasePath);
    assert.deepEqual(
        acknowledgeDurableTaskSuspension(reopened, suspensionOptions),
        retainedSuspension,
    );
    assert.equal(
        inspectDurableTaskExecution(reopened, runId).lifecycle.quiescent?.status,
        "suspended",
    );
    assert.throws(
        () =>
            reopened.appendDurableExecutionResume(
                runId,
                "command:resume:invalid-time",
                retainedSuspension.acknowledgement_record_id,
                retainedSuspension.continuation_descriptor_record_id,
                "claim:resume:invalid-time",
                -1,
            ),
        TypeError,
    );
    using validationDatabase = new DatabaseSync(databasePath);
    assert.throws(
        () =>
            appendDurableExecutionResume(
                validationDatabase,
                runId,
                "command:resume:invalid-lease",
                retainedSuspension.acknowledgement_record_id,
                retainedSuspension.continuation_descriptor_record_id,
                "claim:resume:invalid-lease",
                0,
                0,
            ),
        TypeError,
    );
    assert.throws(
        () =>
            resumeDurableTask(reopened, {
                commandId: "command:resume:unowned-descriptor",
                continuationDescriptorRecordId: ROOT_WITNESS_ID,
                expectedLifecycleRecordId: retainedSuspension.acknowledgement_record_id,
                runId,
            }),
        TraceStoreError,
    );
    assert.throws(
        () =>
            resumeDurableTask(reopened, {
                commandId: "command:resume:wrong-schema",
                continuationDescriptorRecordId: pause.record_id,
                expectedLifecycleRecordId: retainedSuspension.acknowledgement_record_id,
                runId,
            }),
        TraceStoreError,
    );
    const resumeOptions = {
        commandId: "command:resume:suspension",
        continuationDescriptorRecordId: retainedSuspension.continuation_descriptor_record_id,
        expectedLifecycleRecordId: retainedSuspension.acknowledgement_record_id,
        runId,
    } as const;
    assert.throws(
        () =>
            resumeDurableTask(reopened, {
                ...resumeOptions,
                commandId: "command:resume:suspension-with-prerequisite",
                prerequisiteSatisfaction: {
                    kind: "approval",
                    prerequisiteId: "approval:not-applicable",
                    receiptId: "receipt:approval:not-applicable",
                },
            }),
        TraceStoreError,
    );
    const resumed = resumeDurableTask(reopened, resumeOptions);
    assert.equal(resumed.fencing_token, fencingToken + 1);
    assert.ok(resumed.claim_id.length > 0);
    const resumedInspection = inspectDurableTaskExecution(reopened, runId);
    assert.equal(resumedInspection.status, "started");
    assert.equal(resumedInspection.lifecycle.quiescent, null);
    assert.equal(
        resumedInspection.lifecycle.running_continuation_record_id,
        resumed.running_record_id,
    );
    assert.throws(
        () =>
            requestDurableTaskPause(reopened, {
                commandId: "command:pause:stale-worker-after-resume",
                expectedLifecycleRecordId,
                fencingToken,
                reason: "stale worker",
                runId,
            }),
        TraceStoreError,
    );
    assert.throws(
        () =>
            requestDurableTaskCancellation(reopened, {
                commandId: "command:cancel:stale-worker-after-resume",
                expectedLifecycleRecordId,
                fencingToken,
                reason: "stale worker",
                runId,
            }),
        TraceStoreError,
    );
    const resumedRecords = reopened.readOwner(runId);
    const runningIndex = resumedRecords.findIndex(
        (record) => record.envelope.record_id === resumed.running_record_id,
    );
    const commandIndex = resumedRecords.findIndex(
        (record) => record.envelope.record_id === resumed.command_record_id,
    );
    assert.notEqual(runningIndex, -1);
    assert.notEqual(commandIndex, -1);
    const runningRecord = resumedRecords[runningIndex] as OwnerRecord;
    const commandRecord = resumedRecords[commandIndex] as OwnerRecord;
    const expectMalformedInspection = (records: readonly OwnerRecord[]): void => {
        using projected = new OwnerProjectionStore(runId, records);
        assert.throws(() => inspectDurableTaskExecution(projected, runId), TraceStoreError);
    };
    expectMalformedInspection(
        resumedRecords.map((record, index) =>
            index === runningIndex
                ? {
                      ...runningRecord,
                      body: { ...runningRecord.body, status: "invalid" },
                  }
                : record,
        ),
    );
    expectMalformedInspection(
        resumedRecords.map((record, index) =>
            index === commandIndex
                ? {
                      ...commandRecord,
                      body: {
                          ...commandRecord.body,
                          prerequisite_satisfaction: {
                              kind: "approval",
                              prerequisite_id: "approval:not-applicable",
                              receipt_id: "receipt:approval:not-applicable",
                          },
                      },
                  }
                : record,
        ),
    );
    expectMalformedInspection(
        resumedRecords.filter(
            (record) =>
                record.envelope.record_id !== retainedSuspension.continuation_descriptor_record_id,
        ),
    );
    expectMalformedInspection(
        resumedRecords.map((record, index) =>
            index === commandIndex
                ? {
                      ...commandRecord,
                      body: {
                          ...commandRecord.body,
                          continuation_descriptor_id: ROOT_WITNESS_ID,
                      },
                  }
                : record,
        ),
    );
    using competing = new SQLiteTraceStore(databasePath);
    assert.deepEqual(resumeDurableTask(competing, resumeOptions), resumed);
    assert.throws(
        () =>
            resumeDurableTask(competing, {
                ...resumeOptions,
                commandId: "command:resume:stale-head",
            }),
        TraceStoreError,
    );
    assert.throws(
        () =>
            resumeDurableTask(competing, {
                ...resumeOptions,
                continuationDescriptorRecordId: ROOT_WITNESS_ID,
            }),
        TraceStoreError,
    );
    const resumableConstituents = runProtocolConfig.execution.continuationConstituentKinds.map(
        (kind) => ({ kind, status: "not_required" }),
    );
    const descriptorBase = {
        constituents: resumableConstituents,
        continuation_version: runProtocolConfig.execution.continuationVersion,
        execution_id: runId,
        trace_cut_id: traceCutId,
    };
    const traceCutCreatedRecordId = reopened.readCut(traceCutId).created_by_record_id;
    const unrelatedDescriptor = reopened.append({
        append_intent_id: "append:resume:unrelated-descriptor",
        batch: {
            groups: [
                {
                    owner_id: runId,
                    records: [
                        {
                            body: descriptorBase,
                            caused_by_record_ids: [expectedLifecycleRecordId],
                            mode: "capture",
                            schema_ref: runProtocolConfig.schemas.continuationDescriptorId,
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    }).record_ids[0] as string;
    assert.throws(
        () =>
            resumeDurableTask(reopened, {
                commandId: "command:resume:mismatched-suspension",
                continuationDescriptorRecordId: unrelatedDescriptor,
                expectedLifecycleRecordId: retainedSuspension.acknowledgement_record_id,
                runId,
            }),
        TraceStoreError,
    );
    for (const [suffix, descriptorBody] of [
        ["invalid-version", { ...descriptorBase, continuation_version: 2 }],
        [
            "unavailable",
            {
                ...descriptorBase,
                constituents: resumableConstituents.map((value, index) =>
                    index === 0 ? { ...value, status: "unavailable" } : value,
                ),
            },
        ],
        [
            "verified-missing-receipt",
            {
                ...descriptorBase,
                constituents: resumableConstituents.map((value, index) =>
                    index === 0 ? { ...value, status: "verified" } : value,
                ),
            },
        ],
        [
            "malformed-constituent",
            { ...descriptorBase, constituents: [null, ...resumableConstituents.slice(1)] },
        ],
    ] as const) {
        const synthetic = appendSyntheticSuspension(
            reopened,
            runId,
            expectedLifecycleRecordId,
            pause.record_id,
            traceCutCreatedRecordId,
            descriptorBody,
            `append:resume:${suffix}`,
        );
        assert.throws(
            () =>
                resumeDurableTask(reopened, {
                    commandId: `command:resume:${suffix}`,
                    continuationDescriptorRecordId: synthetic.descriptorRecordId,
                    expectedLifecycleRecordId: synthetic.suspensionRecordId,
                    runId,
                }),
            TraceStoreError,
        );
    }
    const otherRunId = "run:resume:other-cut";
    const otherThroughRecordId = reopened.append({
        append_intent_id: "append:resume:other-cut-boundary",
        batch: {
            groups: [
                {
                    owner_id: otherRunId,
                    records: [
                        {
                            body: { boundary: true },
                            mode: "capture",
                            schema_ref: runProtocolConfig.schemas.continuationDescriptorId,
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    }).record_ids[0] as string;
    const otherCut = reopened.publishCut({
        cut_id: "cut:resume:other-run",
        target_owner_id: otherRunId,
        through_record_id: otherThroughRecordId,
    });
    const otherCutSynthetic = appendSyntheticSuspension(
        reopened,
        runId,
        expectedLifecycleRecordId,
        pause.record_id,
        otherCut.created_by_record_id,
        { ...descriptorBase, trace_cut_id: otherCut.cut_id },
        "append:resume:other-cut",
    );
    assert.throws(
        () =>
            resumeDurableTask(reopened, {
                commandId: "command:resume:other-cut",
                continuationDescriptorRecordId: otherCutSynthetic.descriptorRecordId,
                expectedLifecycleRecordId: otherCutSynthetic.suspensionRecordId,
                runId,
            }),
        TraceStoreError,
    );
    const wrongPauseSynthetic = appendSyntheticSuspension(
        reopened,
        runId,
        expectedLifecycleRecordId,
        unrelatedDescriptor,
        traceCutCreatedRecordId,
        descriptorBase,
        "append:resume:wrong-pause-schema",
    );
    assert.throws(
        () =>
            resumeDurableTask(reopened, {
                commandId: "command:resume:wrong-pause-schema",
                continuationDescriptorRecordId: wrongPauseSynthetic.descriptorRecordId,
                expectedLifecycleRecordId: wrongPauseSynthetic.suspensionRecordId,
                runId,
            }),
        TraceStoreError,
    );
    const wrongBoundaryPauseId = reopened.append({
        append_intent_id: "append:resume:wrong-pause-boundary",
        batch: {
            groups: [
                {
                    owner_id: runId,
                    records: [
                        {
                            body: createDurablePauseCommand(
                                runId,
                                "command:pause:wrong-boundary",
                                ROOT_WITNESS_ID,
                                fencingToken,
                                "wrong boundary",
                            ),
                            caused_by_record_ids: [expectedLifecycleRecordId],
                            mode: "capture",
                            schema_ref: runProtocolConfig.execution.controlCommandSchemaId,
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    }).record_ids[0] as string;
    const wrongBoundarySynthetic = appendSyntheticSuspension(
        reopened,
        runId,
        expectedLifecycleRecordId,
        wrongBoundaryPauseId,
        traceCutCreatedRecordId,
        descriptorBase,
        "append:resume:wrong-pause-boundary-suspension",
    );
    assert.throws(
        () =>
            resumeDurableTask(reopened, {
                commandId: "command:resume:wrong-pause-boundary",
                continuationDescriptorRecordId: wrongBoundarySynthetic.descriptorRecordId,
                expectedLifecycleRecordId: wrongBoundarySynthetic.suspensionRecordId,
                runId,
            }),
        TraceStoreError,
    );
    const validSynthetic = appendSyntheticSuspension(
        reopened,
        runId,
        expectedLifecycleRecordId,
        pause.record_id,
        traceCutCreatedRecordId,
        {
            ...descriptorBase,
            constituents: resumableConstituents.map((value, index) =>
                index === 0
                    ? { kind: value.kind, receipt_id: "receipt:synthetic", status: "verified" }
                    : value,
            ),
        },
        "append:resume:started-claim",
    );
    const overflowOptions = {
        commandId: "command:resume:overflow",
        continuationDescriptorRecordId: validSynthetic.descriptorRecordId,
        expectedLifecycleRecordId: validSynthetic.suspensionRecordId,
        runId,
    } as const;
    assert.throws(() => resumeDurableTask(reopened, overflowOptions), TraceStoreError);
    validationDatabase
        .prepare(
            "UPDATE durable_execution_claims SET fencing_token = ?, started = 0 WHERE run_id = ?",
        )
        .run(Number.MAX_SAFE_INTEGER, runId);
    assert.throws(() => resumeDurableTask(reopened, overflowOptions), TraceStoreError);
    const splitIntent = reopened
        .readRecord(unrelatedDescriptor)
        ?.views.find((view) => view.owner_id === runId)?.append_intent_id;
    assert.ok(splitIntent);
    validationDatabase
        .prepare(
            "UPDATE record_views SET append_intent_id = ? WHERE record_id = ? AND owner_id = ?",
        )
        .run(splitIntent, validSynthetic.suspensionRecordId, runId);
    assert.throws(
        () =>
            resumeDurableTask(reopened, { ...overflowOptions, commandId: "command:resume:split" }),
        TraceStoreError,
    );
    store.close();
});

test("checkpoint collection and suspension acknowledgement reject unavailable or malformed evidence", async () => {
    const expectedLifecycleRecordId = ROOT_WITNESS_ID;
    const baseAdapters = [
        {
            checkpoint: async () => ({
                kind: "world" as const,
                status: "not_required" as const,
            }),
            kind: "world" as const,
        },
        {
            checkpoint: async () => ({
                kind: "provider_session" as const,
                status: "not_required" as const,
            }),
            kind: "provider_session" as const,
        },
        {
            checkpoint: async () => ({
                kind: "process" as const,
                status: "not_required" as const,
            }),
            kind: "process" as const,
        },
        {
            checkpoint: async () => ({
                kind: "prerequisite" as const,
                status: "not_required" as const,
            }),
            kind: "prerequisite" as const,
        },
    ] as const;
    const baseCheckpoint = {
        adapters: baseAdapters,
        expectedLifecycleRecordId,
        runId: "run:checkpoint-validation",
        traceCutId: "cut:checkpoint-validation",
    } as const;
    await assert.rejects(
        captureRunContinuationCheckpoints({ ...baseCheckpoint, adapters: [] }),
        TypeError,
    );
    await assert.rejects(
        captureRunContinuationCheckpoints({
            ...baseCheckpoint,
            adapters: [{ ...baseAdapters[0], kind: "process" }, ...baseAdapters.slice(1)] as never,
        }),
        TypeError,
    );
    await assert.rejects(
        captureRunContinuationCheckpoints({
            ...baseCheckpoint,
            adapters: [{ checkpoint: null, kind: "world" }, ...baseAdapters.slice(1)] as never,
        }),
        TypeError,
    );
    await assert.rejects(
        captureRunContinuationCheckpoints({
            ...baseCheckpoint,
            adapters: [
                {
                    checkpoint: async () => ({ kind: "process", status: "not_required" }),
                    kind: "world",
                },
                ...baseAdapters.slice(1),
            ] as never,
        }),
        TypeError,
    );
    await assert.rejects(
        captureRunContinuationCheckpoints({
            ...baseCheckpoint,
            adapters: [
                {
                    checkpoint: async () => ({
                        kind: "world",
                        receipt_id: "unexpected",
                        status: "not_required",
                    }),
                    kind: "world",
                },
                ...baseAdapters.slice(1),
            ] as never,
        }),
        TypeError,
    );
    await assert.rejects(
        captureRunContinuationCheckpoints({
            ...baseCheckpoint,
            adapters: [
                {
                    checkpoint: async () => ({ kind: "world", status: "verified" }),
                    kind: "world",
                },
                ...baseAdapters.slice(1),
            ] as never,
        }),
        TypeError,
    );
    const constituents = await captureRunContinuationCheckpoints(baseCheckpoint);
    using store = new SQLiteTraceStore();
    const baseSuspension = {
        constituents,
        expectedLifecycleRecordId,
        fencingToken: 1,
        pauseCommandRecordId: ROOT_WITNESS_ID,
        runId: baseCheckpoint.runId,
        traceCutId: baseCheckpoint.traceCutId,
    } as const;
    assert.throws(
        () => acknowledgeDurableTaskSuspension(store, { ...baseSuspension, fencingToken: 0 }),
        TypeError,
    );
    assert.throws(
        () => acknowledgeDurableTaskSuspension(store, { ...baseSuspension, constituents: [] }),
        TypeError,
    );
    assert.throws(
        () =>
            acknowledgeDurableTaskSuspension(store, {
                ...baseSuspension,
                constituents: [{ kind: "world", status: "unavailable" }, ...constituents.slice(1)],
            }),
        TypeError,
    );
});

test("suspension acknowledgement rejects a running head superseded before commit", async () => {
    let releaseInvocation: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
        releaseInvocation = resolve;
    });
    const store = new ObservingStartStore();
    const runId = "run:suspension-stale-head";
    const fixtureTask = task({
        input: schema.void(),
        instruction: "Remain active while a stale lifecycle head is tested.",
        name: "suspension-stale-head",
        output: schema.string(),
        version: "1.0.0",
    });
    const running = executeTaskDurably(store, {
        budget: { maxTurns: 1 },
        input: undefined,
        provider: {
            descriptor: () => ({
                capabilities: { streaming: false, structuredOutput: true, tools: false },
                id: "suspension-stale-head-provider",
                kind: "static" as const,
                model: "offline-v1",
            }),
            invoke: async () => {
                await held;
                return {
                    output: "complete",
                    usage: {
                        cacheCreationInputTokens: 0,
                        cacheReadInputTokens: 0,
                        costUsd: null,
                        inputTokens: 1,
                        outputTokens: 1,
                    },
                };
            },
        },
        runId,
        task: fixtureTask,
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const expectedLifecycleRecordId = inspectDurableTaskExecution(store, runId).lifecycle
        .started_record_id;
    const fencingToken = store.fencingToken;
    assert.ok(expectedLifecycleRecordId && fencingToken);
    const pause = requestDurableTaskPause(store, {
        commandId: "command:pause:stale-head",
        expectedLifecycleRecordId,
        fencingToken,
        reason: "stale head test",
        runId,
    });
    const cut = store.publishCut({
        cut_id: "cut:suspension:stale-head",
        target_owner_id: runId,
        through_record_id: expectedLifecycleRecordId,
    });
    store.append({
        append_intent_id: "append:synthetic-later-lifecycle",
        batch: {
            groups: [
                {
                    caused_by_record_ids: [expectedLifecycleRecordId],
                    owner_id: runId,
                    records: [
                        {
                            body: { synthetic: true },
                            mode: "capture",
                            schema_ref: runProtocolConfig.schemas.suspendedLifecycleId,
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    });
    assert.throws(
        () =>
            store.appendDurableExecutionSuspension(
                runId,
                expectedLifecycleRecordId,
                fencingToken,
                pause.record_id,
                cut.cut_id,
                {
                    append_intent_id: "append:stale-suspension-probe",
                    batch: { groups: [] },
                },
            ),
        TraceStoreError,
    );
    releaseInvocation?.();
    await running;
    store.close();
});

test("requestDurableTaskPause rejects malformed options and non-running authority", async () => {
    using absentStore = new SQLiteTraceStore();
    for (const value of [
        null,
        [],
        {},
        {
            commandId: "command:pause:extra",
            expectedLifecycleRecordId: ROOT_WITNESS_ID,
            fencingToken: 1,
            reason: "pause",
            runId: "run:pause:extra",
            extra: true,
        },
        {
            commandId: "",
            expectedLifecycleRecordId: ROOT_WITNESS_ID,
            fencingToken: 1,
            reason: "pause",
            runId: "run:pause:empty-command",
        },
        {
            commandId: "command:pause:bad-head",
            expectedLifecycleRecordId: "invalid",
            fencingToken: 1,
            reason: "pause",
            runId: "run:pause:bad-head",
        },
        {
            commandId: "command:pause:bad-token",
            expectedLifecycleRecordId: ROOT_WITNESS_ID,
            fencingToken: 0,
            reason: "pause",
            runId: "run:pause:bad-token",
        },
        {
            commandId: "command:pause:bad-token-type",
            expectedLifecycleRecordId: ROOT_WITNESS_ID,
            fencingToken: "1",
            reason: "pause",
            runId: "run:pause:bad-token-type",
        },
        {
            commandId: "command:pause:empty-reason",
            expectedLifecycleRecordId: ROOT_WITNESS_ID,
            fencingToken: 1,
            reason: "",
            runId: "run:pause:empty-reason",
        },
        {
            commandId: "command:pause:empty-run",
            expectedLifecycleRecordId: ROOT_WITNESS_ID,
            fencingToken: 1,
            reason: "pause",
            runId: "",
        },
    ]) {
        assert.throws(() => requestDurableTaskPause(absentStore, value as never), TypeError);
    }
    assert.throws(
        () =>
            requestDurableTaskPause(
                absentStore,
                Object.assign(Object.create(null), {
                    commandId: "command:pause:null-prototype",
                    expectedLifecycleRecordId: ROOT_WITNESS_ID,
                    fencingToken: 1,
                    reason: "pause",
                    runId: "run:pause:null-prototype",
                }),
            ),
        TraceStoreError,
    );
    const validAbsent = {
        commandId: "command:pause:absent",
        expectedLifecycleRecordId: ROOT_WITNESS_ID,
        fencingToken: 1,
        reason: "pause",
        runId: "run:pause:absent",
    } as const;
    assert.throws(() => requestDurableTaskPause(absentStore, validAbsent), TraceStoreError);
    assert.throws(
        () =>
            absentStore.appendDurableExecutionRunningControlCommand(
                validAbsent.runId,
                validAbsent.expectedLifecycleRecordId,
                0,
                {
                    append_intent_id: "pause:invalid-low-level-token",
                    batch: { groups: [] },
                },
            ),
        TypeError,
    );

    using unstartedStore = new InterruptingStartStore();
    const fixtureTask = task({
        input: schema.void(),
        instruction: "Retain creation without starting.",
        name: "pause-before-start",
        output: schema.string(),
        version: "1.0.0",
    });
    const runId = "run:pause:before-start";
    await assert.rejects(
        executeTaskDurably(unstartedStore, {
            budget: { maxTurns: 1 },
            input: undefined,
            provider: createStaticProvider({
                descriptor: { id: "pause-before-start-provider", model: "offline-v1" },
                exchanges: [],
            }),
            runId,
            task: fixtureTask,
        }),
        /start publication interrupted/u,
    );
    const createdRecordId = unstartedStore.readOwner(runId)[0]?.envelope.record_id;
    assert.ok(createdRecordId);
    assert.throws(
        () =>
            requestDurableTaskPause(unstartedStore, {
                commandId: "command:pause:before-start",
                expectedLifecycleRecordId: createdRecordId,
                fencingToken: 1,
                reason: "pause",
                runId,
            }),
        TraceStoreError,
    );
});

test("recoverTaskDurably idempotently resumes created evidence under a stable command identity", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-control-recovery-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const databasePath = path.join(directory, "trace.sqlite");
    let nowMilliseconds = 0;
    context.mock.method(Date, "now", () => nowMilliseconds);
    const fixtureTask = task({
        input: schema.void(),
        instruction: "Return one recovery result.",
        name: "control-recovery",
        output: schema.string(),
        version: "1.0.0",
    });
    let invocationCount = 0;
    const provider = {
        descriptor: () => ({
            capabilities: { streaming: false, structuredOutput: true, tools: false },
            id: "control-recovery-provider",
            kind: "static" as const,
            model: "offline-v1",
        }),
        invoke: async () => {
            invocationCount += 1;
            return {
                output: "recovered",
                usage: {
                    cacheCreationInputTokens: 0,
                    cacheReadInputTokens: 0,
                    costUsd: null,
                    inputTokens: 1,
                    outputTokens: 1,
                },
            };
        },
    } satisfies ModelProvider;
    const execution = {
        budget: { maxTurns: 1 },
        input: undefined,
        provider,
        runId: "run:control-recovery",
        task: fixtureTask,
    } as const;

    const interrupted = new InterruptingStartStore(databasePath);
    await assert.rejects(
        executeTaskDurably(interrupted, execution),
        /start publication interrupted/u,
    );
    interrupted.close();
    nowMilliseconds = 30_000;
    const recoveredStore = new SQLiteTraceStore(databasePath);
    const recovered = await recoverTaskDurably(recoveredStore, {
        commandId: "command:recover:control-recovery",
        execution,
    });
    const commandRecord = recoveredStore.readRecord(recovered.command.record_id);
    const startRecord = recoveredStore.readRecord(recovered.result.ledger.started_record_id ?? "");
    recoveredStore.close();
    using replayStore = new SQLiteTraceStore(databasePath);
    const replayed = await recoverTaskDurably(replayStore, {
        commandId: "command:recover:control-recovery",
        execution,
    });

    assert.deepEqual(replayed, recovered);
    assert.equal(recovered.command.command_id, "command:recover:control-recovery");
    assert.equal(recovered.result.execution.outcome.outcome.status, "finished");
    assert.equal(invocationCount, 1);
    assert.deepEqual(commandRecord?.body, {
        command_id: "command:recover:control-recovery",
        command_kind: "recover",
        execution_id: "run:control-recovery",
    });
    assert.deepEqual(startRecord?.envelope.caused_by_record_ids, [
        recovered.result.ledger.created_record_id,
        recovered.command.record_id,
    ]);
});

test("recoverTaskDurably rejects reuse of one command identity for another run", async (context) => {
    let nowMilliseconds = 0;
    context.mock.method(Date, "now", () => nowMilliseconds);
    const fixtureTask = task({
        input: schema.void(),
        instruction: "Return one command identity result.",
        name: "command-identity-conflict",
        output: schema.string(),
        version: "1.0.0",
    });
    const invocationCounts = new Map<string, number>();
    const provider = (id: string): ModelProvider => ({
        descriptor: () => ({
            capabilities: { streaming: false, structuredOutput: true, tools: false },
            id,
            kind: "static",
            model: "offline-v1",
        }),
        invoke: async () => {
            invocationCounts.set(id, (invocationCounts.get(id) ?? 0) + 1);
            return {
                output: "complete",
                usage: {
                    cacheCreationInputTokens: 0,
                    cacheReadInputTokens: 0,
                    costUsd: null,
                    inputTokens: 1,
                    outputTokens: 1,
                },
            };
        },
    });
    using store = new InterruptingStartStore();
    const first = {
        budget: { maxTurns: 1 },
        input: undefined,
        provider: provider("command-provider:first"),
        runId: "run:command-identity:first",
        task: fixtureTask,
    } as const;
    const second = {
        ...first,
        provider: provider("command-provider:second"),
        runId: "run:command-identity:second",
    } as const;
    await assert.rejects(executeTaskDurably(store, first), /start publication interrupted/u);
    store.interruptNextStart();
    await assert.rejects(executeTaskDurably(store, second), /start publication interrupted/u);
    nowMilliseconds = 30_000;

    await recoverTaskDurably(store, { commandId: "command:global-recovery", execution: first });
    await assert.rejects(
        recoverTaskDurably(store, {
            commandId: "command:global-recovery",
            execution: second,
        }),
        TraceStoreError,
    );
    assert.equal(invocationCounts.get("command-provider:first"), 1);
    assert.equal(invocationCounts.get("command-provider:second") ?? 0, 0);
});

test("recoverTaskDurably binds command identity to the exact execution contract", async (context) => {
    let nowMilliseconds = 0;
    context.mock.method(Date, "now", () => nowMilliseconds);
    const fixtureTask = task({
        input: schema.void(),
        instruction: "Return an exact recovery result.",
        name: "exact-command-contract",
        output: schema.string(),
        version: "1.0.0",
    });
    const provider = createStaticProvider({
        descriptor: { id: "exact-command-provider", model: "offline-v1" },
        exchanges: [
            {
                request: {
                    input: null,
                    instruction: fixtureTask.instruction,
                    outputSchema: fixtureTask.artifact.output_schema,
                },
                response: {
                    output: "exact",
                    usage: {
                        cacheCreationInputTokens: 0,
                        cacheReadInputTokens: 0,
                        costUsd: null,
                        inputTokens: 1,
                        outputTokens: 1,
                    },
                },
            },
        ],
    });
    const execution = {
        budget: { maxTurns: 1 },
        input: undefined,
        provider,
        runId: "run:exact-command-contract",
        task: fixtureTask,
    } as const;
    using store = new InterruptingStartStore();
    await assert.rejects(executeTaskDurably(store, execution), /start publication interrupted/u);
    nowMilliseconds = 30_000;

    await assert.rejects(
        recoverTaskDurably(store, {
            commandId: "command:recover:exact-contract",
            execution: { ...execution, budget: { maxTurns: 2 } },
        }),
        TraceStoreError,
    );
    assert.equal(store.readOwner(execution.runId).length, 1);

    const recovered = await recoverTaskDurably(store, {
        commandId: "command:recover:exact-contract",
        execution,
    });
    assert.equal(recovered.result.execution.outcome.outcome.status, "finished");
});

test("recoverTaskDurably idempotently repairs a missing terminal cut without provider replay", async () => {
    const fixtureTask = task({
        input: schema.void(),
        instruction: "Return one terminal recovery result.",
        name: "terminal-control-recovery",
        output: schema.string(),
        version: "1.0.0",
    });
    let invocationCount = 0;
    const provider = {
        descriptor: () => ({
            capabilities: { streaming: false, structuredOutput: true, tools: false },
            id: "terminal-control-provider",
            kind: "static" as const,
            model: "offline-v1",
        }),
        invoke: async () => {
            invocationCount += 1;
            return {
                output: "complete",
                usage: {
                    cacheCreationInputTokens: 0,
                    cacheReadInputTokens: 0,
                    costUsd: null,
                    inputTokens: 1,
                    outputTokens: 1,
                },
            };
        },
    } satisfies ModelProvider;
    const execution = {
        budget: { maxTurns: 1 },
        input: undefined,
        provider,
        runId: "run:terminal-control-recovery",
        task: fixtureTask,
    } as const;
    using store = new InterruptingCutStore();
    await assert.rejects(executeTaskDurably(store, execution), /cut publication interrupted/u);

    const recovered = await recoverTaskDurably(store, {
        commandId: "command:recover:terminal-cut",
        execution,
    });
    const replayed = await recoverTaskDurably(store, {
        commandId: "command:recover:terminal-cut",
        execution,
    });

    assert.deepEqual(replayed, recovered);
    assert.equal(invocationCount, 1);
    const cutRecord = store.readRecord(recovered.result.ledger.cut.created_by_record_id);
    assert.deepEqual(cutRecord?.envelope.caused_by_record_ids, [
        recovered.result.ledger.lifecycle_record_id,
        recovered.command.record_id,
    ]);
});

test("recoverTaskDurably rejects absent and uncertain started executions", async () => {
    using absentStore = new SQLiteTraceStore();
    const fixtureTask = task({
        input: schema.void(),
        instruction: "Return one unsafe recovery result.",
        name: "unsafe-control-recovery",
        output: schema.string(),
        version: "1.0.0",
    });
    let releaseInvocation: (() => void) | undefined;
    const released = new Promise<void>((resolve) => {
        releaseInvocation = resolve;
    });
    let invocationCount = 0;
    const provider = {
        descriptor: () => ({
            capabilities: { streaming: false, structuredOutput: true, tools: false },
            id: "unsafe-control-provider",
            kind: "static" as const,
            model: "offline-v1",
        }),
        invoke: async () => {
            invocationCount += 1;
            await released;
            return {
                output: "complete",
                usage: {
                    cacheCreationInputTokens: 0,
                    cacheReadInputTokens: 0,
                    costUsd: null,
                    inputTokens: 1,
                    outputTokens: 1,
                },
            };
        },
    } satisfies ModelProvider;
    const execution = {
        budget: { maxTurns: 1 },
        input: undefined,
        provider,
        runId: "run:unsafe-control-recovery",
        task: fixtureTask,
    } as const;
    await assert.rejects(
        recoverTaskDurably(absentStore, {
            commandId: "command:recover:absent",
            execution,
        }),
        DurableExecutionRecoveryAbsentError,
    );
    assert.deepEqual(absentStore.readOwner(execution.runId), []);

    const running = executeTaskDurably(absentStore, execution);
    await new Promise<void>((resolve) => setImmediate(resolve));
    await assert.rejects(
        recoverTaskDurably(absentStore, {
            commandId: "command:recover:started",
            execution,
        }),
        DurableExecutionRecoveryError,
    );
    assert.equal(invocationCount, 1);
    releaseInvocation?.();
    await running;
});

test("recoverTaskDurably rejects malformed command options before retaining evidence", async () => {
    using store = new SQLiteTraceStore();
    for (const value of [
        null,
        [],
        {},
        { commandId: "command:missing-execution" },
        { execution: {} },
        { commandId: "command:extra", execution: {}, extra: true },
        Object.assign(Object.create(null), { commandId: "command:null", execution: {} }),
        { commandId: "", execution: {} },
    ]) {
        await assert.rejects(recoverTaskDurably(store, value as never), TypeError);
    }
    assert.deepEqual(store.readOwner("run:malformed-recovery"), []);
});

test("durable recovery fails closed for unowned or wrong-schema command evidence", async (context) => {
    let nowMilliseconds = 0;
    context.mock.method(Date, "now", () => nowMilliseconds);
    const fixtureTask = task({
        input: schema.void(),
        instruction: "Return one command corruption result.",
        name: "command-evidence-corruption",
        output: schema.string(),
        version: "1.0.0",
    });
    const provider = {
        descriptor: () => ({
            capabilities: { streaming: false, structuredOutput: true, tools: false },
            id: "command-corruption-provider",
            kind: "static" as const,
            model: "offline-v1",
        }),
        invoke: async () => ({
            output: "complete",
            usage: {
                cacheCreationInputTokens: 0,
                cacheReadInputTokens: 0,
                costUsd: null,
                inputTokens: 1,
                outputTokens: 1,
            },
        }),
    } satisfies ModelProvider;
    using store = new InterruptingStartStore();
    const executionFor = (runId: string) => ({
        budget: { maxTurns: 1 } as const,
        input: undefined,
        provider,
        runId,
        task: fixtureTask,
    });
    const templateExecution = executionFor("run:command-corruption:template");
    await assert.rejects(
        executeTaskDurably(store, templateExecution),
        /start publication interrupted/u,
    );
    nowMilliseconds = 30_000;
    const template = await recoverTaskDurably(store, {
        commandId: "command:corruption:template",
        execution: templateExecution,
    });
    const commandTemplate = store.readRecord(template.command.record_id);
    const startTemplate = store.readRecord(template.result.ledger.started_record_id ?? "");
    assert.ok(commandTemplate && startTemplate);

    for (const [runId, commandOwner, commandSchema] of [
        [
            "run:command-corruption:unowned",
            "run:command-corruption:other-owner",
            commandTemplate.envelope.schema_ref,
        ],
        [
            "run:command-corruption:wrong-schema",
            "run:command-corruption:wrong-schema",
            `${commandTemplate.envelope.schema_ref}.wrong`,
        ],
        [
            "run:command-corruption:wrong-intent",
            "run:command-corruption:wrong-intent",
            commandTemplate.envelope.schema_ref,
        ],
    ] as const) {
        store.interruptNextStart();
        const execution = executionFor(runId);
        await assert.rejects(
            executeTaskDurably(store, execution),
            /start publication interrupted/u,
        );
        const createdRecordId = store.readOwner(runId)[0]?.envelope.record_id;
        assert.ok(createdRecordId);
        const command = store.append({
            append_intent_id: `command:corruption:${runId}`,
            batch: {
                groups: [
                    {
                        caused_by_record_ids: [createdRecordId],
                        owner_id: commandOwner,
                        records: [
                            {
                                body: { ...commandTemplate.body, execution_id: runId },
                                mode: commandTemplate.envelope.mode,
                                schema_ref: commandSchema,
                                witness_ref: commandTemplate.envelope.witness_ref,
                            },
                        ],
                    },
                ],
            },
        });
        const commandRecordId = command.record_ids[0];
        assert.ok(commandRecordId);
        store.append({
            append_intent_id: `start:corruption:${runId}`,
            batch: {
                groups: [
                    {
                        caused_by_record_ids: [createdRecordId, commandRecordId],
                        owner_id: runId,
                        records: [
                            {
                                body: { payload: { execution_id: runId } },
                                mode: startTemplate.envelope.mode,
                                schema_ref: startTemplate.envelope.schema_ref,
                                witness_ref: startTemplate.envelope.witness_ref,
                            },
                        ],
                    },
                ],
            },
        });
        assert.throws(() => readDurableTaskExecution(store, runId), TraceStoreError);
    }
});
