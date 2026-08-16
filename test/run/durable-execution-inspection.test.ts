import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
    type Cut,
    type CutSpec,
    createRecordEnvelope,
    executeTaskDurably,
    inspectDurableTaskExecution,
    type ModelProvider,
    type OwnerRecord,
    type RecordId,
    type RetainedRecord,
    ROOT_WITNESS_ID,
    requestDurableTaskPause,
    SQLiteTraceStore,
    schema,
    TraceStoreError,
    task,
} from "../../src/index.ts";
import { runProtocolConfig } from "../../src/protocol/config.ts";

class InterruptingStartStore extends SQLiteTraceStore {
    override appendDurableExecutionStart(
        _runId: string,
        _claimId: string,
        _fencingToken: number,
    ): never {
        throw new Error("start publication interrupted");
    }
}

class InterruptingCutStore extends SQLiteTraceStore {
    override publishCut(_spec: CutSpec): Cut {
        throw new Error("cut publication interrupted");
    }
}

class QuiescentStartStore extends SQLiteTraceStore {
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
        this.fencingToken = fencingToken;
        return appended;
    }
}

class MissingInspectionRecordStore extends SQLiteTraceStore {
    override readRecord(_recordId: string): undefined {
        return undefined;
    }
}

class QuiescentProjectionStore extends SQLiteTraceStore {
    readonly #cut: Cut;
    readonly #failCut: boolean;
    readonly #records: readonly OwnerRecord[];
    readonly #runId: string;

    constructor(runId: string, records: readonly OwnerRecord[], cut: Cut, failCut = false) {
        super();
        this.#cut = cut;
        this.#failCut = failCut;
        this.#records = records;
        this.#runId = runId;
    }

    override readCut(_cutId: string): Cut {
        if (this.#failCut) {
            throw new TraceStoreError("test cut unavailable");
        }
        return this.#cut;
    }

    override readOwner(ownerId: string): readonly OwnerRecord[] {
        return ownerId === this.#runId ? this.#records : [];
    }

    override readRecord(recordId: RecordId): RetainedRecord | undefined {
        const record = this.#records.find((candidate) => candidate.envelope.record_id === recordId);
        return record === undefined
            ? undefined
            : {
                  body: record.body,
                  envelope: record.envelope,
                  views: [record.view],
              };
    }
}

test("inspectDurableTaskExecution projects exact committed evidence after reopening", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-execution-inspection-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const databasePath = path.join(directory, "trace.sqlite");
    const fixtureTask = task({
        input: schema.void(),
        instruction: "Return inspectable evidence.",
        name: "inspectable-evidence",
        output: schema.string(),
        version: "1.0.0",
    });
    const store = new SQLiteTraceStore(databasePath);
    const receipt = store.putBlob(Uint8Array.of(1, 3, 5));
    let invocationCount = 0;
    const provider = {
        descriptor: () => ({
            capabilities: { streaming: false, structuredOutput: true, tools: false },
            id: "inspection-provider",
            kind: "static" as const,
            model: "offline-v1",
        }),
        invoke: async () => {
            invocationCount += 1;
            return {
                artifacts: [
                    {
                        content: { text: "inspection text", type: "text" as const },
                        kind: "report",
                        metadata: {},
                        name: "inspection.txt",
                    },
                    {
                        content: { receipt, type: "blob" as const },
                        kind: "binary",
                        metadata: {},
                        name: "inspection.bin",
                    },
                ],
                output: "complete",
                usage: {
                    cacheCreationInputTokens: 0,
                    cacheReadInputTokens: 0,
                    costUsd: 0.01,
                    inputTokens: 2,
                    outputTokens: 1,
                },
            };
        },
    } satisfies ModelProvider;
    const runId = "run:inspection:committed";
    const durable = await executeTaskDurably(store, {
        budget: { maxTurns: 1 },
        input: undefined,
        provider,
        runId,
        task: fixtureTask,
    });
    store.close();

    using reopened = new SQLiteTraceStore(databasePath);
    const inspection = inspectDurableTaskExecution(reopened, runId);
    const [firstArtifactId, secondArtifactId] = durable.ledger.artifact_record_ids;
    const startedId = durable.ledger.started_record_id;
    const usageId = durable.ledger.usage_record_id;
    assert.ok(firstArtifactId && secondArtifactId && startedId && usageId);

    assert.equal(invocationCount, 1);
    assert.equal(inspection.status, "committed");
    assert.equal(inspection.run_id, runId);
    assert.deepEqual(inspection.artifacts, [
        { artifact: durable.execution.artifacts[0], record_id: firstArtifactId },
        { artifact: durable.execution.artifacts[1], record_id: secondArtifactId },
    ]);
    assert.deepEqual(inspection.usage, {
        record_id: usageId,
        usage: durable.execution.usage,
    });
    assert.deepEqual(inspection.outcome, {
        outcome: durable.execution.outcome,
        record_id: durable.ledger.outcome_record_id,
    });
    assert.deepEqual(inspection.lifecycle, {
        created_record_id: durable.ledger.created_record_id,
        quiescent: null,
        running_continuation_record_id: null,
        started_record_id: startedId,
        terminal_record_id: durable.ledger.lifecycle_record_id,
        terminal_schema_ref: reopened.readRecord(durable.ledger.lifecycle_record_id)?.envelope
            .schema_ref,
    });
    assert.deepEqual(inspection.cut, durable.ledger.cut);
    assert.deepEqual(inspection.causal_edges, [
        [durable.ledger.created_record_id, startedId],
        [startedId, firstArtifactId],
        [startedId, secondArtifactId],
        [firstArtifactId, secondArtifactId],
        [startedId, usageId],
        [startedId, durable.ledger.outcome_record_id],
        [firstArtifactId, durable.ledger.outcome_record_id],
        [secondArtifactId, durable.ledger.outcome_record_id],
        [usageId, durable.ledger.outcome_record_id],
        [startedId, durable.ledger.lifecycle_record_id],
        [durable.ledger.outcome_record_id, durable.ledger.lifecycle_record_id],
        [durable.ledger.lifecycle_record_id, durable.ledger.cut.created_by_record_id],
    ]);
    assert.equal(Object.isFrozen(inspection), true);
    assert.equal(Object.isFrozen(inspection.causal_edges[0]), true);

    const laterRecordIds = [
        durable.ledger.created_record_id,
        startedId,
        firstArtifactId,
        usageId,
        durable.ledger.outcome_record_id,
        durable.ledger.lifecycle_record_id,
        durable.ledger.cut.created_by_record_id,
    ];
    const laterRecords = laterRecordIds.map((recordId) => {
        const record = reopened.readRecord(recordId);
        assert.ok(record);
        return record;
    });
    reopened.append({
        append_intent_id: "inspection:later-execution-evidence",
        batch: {
            groups: [
                {
                    owner_id: runId,
                    records: laterRecords.map((record) => ({
                        body: record.body,
                        caused_by_record_ids: record.envelope.caused_by_record_ids,
                        mode: record.envelope.mode,
                        schema_ref: record.envelope.schema_ref,
                        witness_ref: record.envelope.witness_ref,
                    })),
                },
            ],
        },
    });
    assert.deepEqual(inspectDurableTaskExecution(reopened, runId), inspection);
    using missingRecordStore = new MissingInspectionRecordStore(databasePath);
    assert.throws(() => inspectDurableTaskExecution(missingRecordStore, runId), TraceStoreError);
});

test("inspectDurableTaskExecution projects every incomplete recovery state", async () => {
    const fixtureTask = task({
        input: schema.void(),
        instruction: "Return lifecycle evidence.",
        name: "inspection-lifecycle",
        output: schema.string(),
        version: "1.0.0",
    });
    const descriptor = () => ({
        capabilities: { streaming: false, structuredOutput: true, tools: false },
        id: "inspection-lifecycle-provider",
        kind: "static" as const,
        model: "offline-v1",
    });

    using absentStore = new SQLiteTraceStore();
    assert.deepEqual(inspectDurableTaskExecution(absentStore, "run:inspection:absent"), {
        artifacts: [],
        causal_edges: [],
        cut: null,
        lifecycle: {
            created_record_id: null,
            quiescent: null,
            running_continuation_record_id: null,
            started_record_id: null,
            terminal_record_id: null,
            terminal_schema_ref: null,
        },
        outcome: null,
        run_id: "run:inspection:absent",
        settlements: [],
        status: "absent",
        usage: null,
    });

    using createdStore = new InterruptingStartStore();
    await assert.rejects(
        executeTaskDurably(createdStore, {
            budget: { maxTurns: 1 },
            input: undefined,
            provider: {
                descriptor,
                invoke: async () => {
                    throw new Error("provider must not be reached");
                },
            },
            runId: "run:inspection:created",
            task: fixtureTask,
        }),
        /start publication interrupted/u,
    );
    const created = inspectDurableTaskExecution(createdStore, "run:inspection:created");
    assert.equal(created.status, "created");
    assert.notEqual(created.lifecycle.created_record_id, null);
    assert.deepEqual(created.causal_edges, []);

    let releaseInvocation: (() => void) | undefined;
    const released = new Promise<void>((resolve) => {
        releaseInvocation = resolve;
    });
    using startedStore = new SQLiteTraceStore();
    const running = executeTaskDurably(startedStore, {
        budget: { maxTurns: 1 },
        input: undefined,
        provider: {
            descriptor,
            invoke: async () => {
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
        runId: "run:inspection:started",
        task: fixtureTask,
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const started = inspectDurableTaskExecution(startedStore, "run:inspection:started");
    assert.equal(started.status, "started");
    assert.deepEqual(started.causal_edges, [
        [started.lifecycle.created_record_id, started.lifecycle.started_record_id],
    ]);
    releaseInvocation?.();
    await running;

    using pendingCutStore = new InterruptingCutStore();
    await assert.rejects(
        executeTaskDurably(pendingCutStore, {
            budget: { maxTurns: 1 },
            input: undefined,
            provider: {
                descriptor,
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
            },
            runId: "run:inspection:pending-cut",
            task: fixtureTask,
        }),
        /cut publication interrupted/u,
    );
    const pending = inspectDurableTaskExecution(pendingCutStore, "run:inspection:pending-cut");
    assert.equal(pending.status, "terminal_pending_cut");
    assert.equal(pending.cut, null);
    assert.notEqual(pending.lifecycle.terminal_record_id, null);
    assert.notEqual(pending.outcome, null);
    assert.notEqual(pending.usage, null);

    using exhaustedStore = new SQLiteTraceStore();
    let exhaustedInvocationCount = 0;
    await executeTaskDurably(exhaustedStore, {
        budget: { maxTurns: 0 },
        input: undefined,
        provider: {
            descriptor,
            invoke: async () => {
                exhaustedInvocationCount += 1;
                throw new Error("provider must not be reached");
            },
        },
        runId: "run:inspection:pre-exhausted",
        task: fixtureTask,
    });
    const exhausted = inspectDurableTaskExecution(exhaustedStore, "run:inspection:pre-exhausted");
    assert.equal(exhausted.status, "committed");
    assert.equal(exhausted.lifecycle.started_record_id, null);
    assert.equal(exhausted.usage, null);
    assert.deepEqual(exhausted.artifacts, []);
    assert.equal(exhaustedInvocationCount, 0);
});

test("inspectDurableTaskExecution recognizes cut-bound waiting and suspended evidence without mutation", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-quiescent-inspection-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const fixtureTask = task({
        input: schema.void(),
        instruction: "Remain inspectable at a quiescent boundary.",
        name: "inspectable-quiescence",
        output: schema.string(),
        version: "1.0.0",
    });

    for (const status of ["waiting", "suspended"] as const) {
        let releaseInvocation: (() => void) | undefined;
        const released = new Promise<void>((resolve) => {
            releaseInvocation = resolve;
        });
        using store = new QuiescentStartStore(path.join(directory, `${status}.sqlite`));
        const runId = `run:inspection:${status}`;
        const running = executeTaskDurably(store, {
            budget: { maxTurns: 1 },
            input: undefined,
            provider: {
                descriptor: () => ({
                    capabilities: { streaming: false, structuredOutput: true, tools: false },
                    id: "inspection-quiescence-provider",
                    kind: "static" as const,
                    model: "offline-v1",
                }),
                invoke: async () => {
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
        const started = inspectDurableTaskExecution(store, runId);
        const startedRecordId = started.lifecycle.started_record_id;
        assert.ok(startedRecordId);
        const cut = store.publishCut({
            cut_id: `cut:inspection:${status}`,
            target_owner_id: runId,
            through_record_id: startedRecordId,
        });
        const pauseCommandRecordId =
            status === "suspended"
                ? requestDurableTaskPause(store, {
                      commandId: `pause:${runId}`,
                      expectedLifecycleRecordId: startedRecordId,
                      fencingToken: store.fencingToken as number,
                      reason: "inspection suspension fixture",
                      runId,
                  }).record_id
                : null;
        const descriptorBody = {
            continuation_version: runProtocolConfig.execution.continuationVersion,
            execution_id: runId,
            trace_cut_id: cut.cut_id,
            constituents: runProtocolConfig.execution.continuationConstituentKinds.map(
                (kind, index) =>
                    index === runProtocolConfig.execution.continuationConstituentKinds.length - 1
                        ? {
                              kind,
                              receipt_id: `receipt:${runId}`,
                              status: runProtocolConfig.execution.continuationVerifiedStatus,
                          }
                        : {
                              kind,
                              status: runProtocolConfig.execution.continuationEvidenceStatuses.find(
                                  (candidate) =>
                                      candidate !==
                                      runProtocolConfig.execution.continuationVerifiedStatus,
                              ) as string,
                          },
            ),
        };
        const descriptorEnvelope = createRecordEnvelope({
            body: descriptorBody,
            caused_by_record_ids: [cut.created_by_record_id],
            mode: "capture",
            schema_ref: runProtocolConfig.schemas.continuationDescriptorId,
            witness_ref: ROOT_WITNESS_ID,
        });
        const acknowledgementBody =
            status === "waiting"
                ? {
                      continuation_descriptor_id: descriptorEnvelope.record_id,
                      execution_id: runId,
                      lifecycle_version: runProtocolConfig.execution.lifecycleVersion,
                      prerequisite: { kind: "approval", prerequisite_id: `approval:${runId}` },
                      status,
                  }
                : {
                      continuation_descriptor_id: descriptorEnvelope.record_id,
                      execution_id: runId,
                      lifecycle_version: runProtocolConfig.execution.lifecycleVersion,
                      pause_command_id: pauseCommandRecordId as string,
                      status,
                  };
        const acknowledgementSchema =
            status === "waiting"
                ? runProtocolConfig.schemas.waitingLifecycleId
                : runProtocolConfig.schemas.suspendedLifecycleId;
        const receipt = store.append({
            append_intent_id: `inspection:${status}:acknowledgement`,
            batch: {
                groups: [
                    {
                        owner_id: runId,
                        records: [
                            {
                                append_local_id: "descriptor",
                                body: descriptorBody,
                                caused_by_record_ids: [cut.created_by_record_id],
                                mode: "capture",
                                schema_ref: runProtocolConfig.schemas.continuationDescriptorId,
                                witness_ref: ROOT_WITNESS_ID,
                            },
                            {
                                body: acknowledgementBody,
                                caused_by_record_ids: [
                                    startedRecordId,
                                    ...(pauseCommandRecordId === null
                                        ? []
                                        : [pauseCommandRecordId]),
                                ],
                                caused_by_local_refs: ["descriptor"],
                                mode: "capture",
                                schema_ref: acknowledgementSchema,
                                witness_ref: ROOT_WITNESS_ID,
                            },
                        ],
                    },
                ],
            },
        });
        const ownerCount = store.readOwner(runId).length;
        using reopened = new SQLiteTraceStore(path.join(directory, `${status}.sqlite`));
        const inspection = inspectDurableTaskExecution(reopened, runId);
        assert.equal(store.readOwner(runId).length, ownerCount);
        assert.equal(reopened.readOwner(runId).length, ownerCount);
        assert.deepEqual((inspection.lifecycle as Record<string, unknown>).quiescent, {
            acknowledgement_record_id: receipt.record_ids[1],
            acknowledgement_schema_ref: acknowledgementSchema,
            continuation: {
                constituents: descriptorBody.constituents.map((constituent) =>
                    Object.hasOwn(constituent, "receipt_id")
                        ? constituent
                        : { ...constituent, receipt_id: null },
                ),
                record_id: receipt.record_ids[0],
                trace_cut: cut,
            },
            pause_command_record_id: pauseCommandRecordId,
            prerequisite:
                status === "waiting"
                    ? { kind: "approval", prerequisite_id: `approval:${runId}` }
                    : null,
            status,
        });
        releaseInvocation?.();
        await running;
    }
});

test("inspectDurableTaskExecution rejects malformed quiescent evidence", async () => {
    let releaseInvocation: (() => void) | undefined;
    const released = new Promise<void>((resolve) => {
        releaseInvocation = resolve;
    });
    const runId = "run:inspection:quiescent-corruption";
    using source = new SQLiteTraceStore();
    const running = executeTaskDurably(source, {
        budget: { maxTurns: 1 },
        input: undefined,
        provider: {
            descriptor: () => ({
                capabilities: { streaming: false, structuredOutput: true, tools: false },
                id: "inspection-corruption-provider",
                kind: "static" as const,
                model: "offline-v1",
            }),
            invoke: async () => {
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
        task: task({
            input: schema.void(),
            instruction: "Expose malformed quiescent evidence.",
            name: "quiescent-corruption",
            output: schema.string(),
            version: "1.0.0",
        }),
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const startedRecordId = inspectDurableTaskExecution(source, runId).lifecycle.started_record_id;
    assert.ok(startedRecordId);
    const cut = source.publishCut({
        cut_id: "cut:inspection:quiescent-corruption",
        target_owner_id: runId,
        through_record_id: startedRecordId,
    });
    const pauseCommandRecordId = requestDurableTaskPause(source, {
        commandId: "command:pause:quiescent-corruption",
        expectedLifecycleRecordId: startedRecordId,
        fencingToken: 1,
        reason: "corruption fixture",
        runId,
    }).record_id;
    const descriptorBody = {
        continuation_version: runProtocolConfig.execution.continuationVersion,
        execution_id: runId,
        trace_cut_id: cut.cut_id,
        constituents: runProtocolConfig.execution.continuationConstituentKinds.map((kind) => ({
            kind,
            status: runProtocolConfig.execution.continuationEvidenceStatuses.find(
                (candidate) => candidate !== runProtocolConfig.execution.continuationVerifiedStatus,
            ) as string,
        })),
    };
    const descriptorEnvelope = createRecordEnvelope({
        body: descriptorBody,
        caused_by_record_ids: [cut.created_by_record_id],
        mode: "capture",
        schema_ref: runProtocolConfig.schemas.continuationDescriptorId,
        witness_ref: ROOT_WITNESS_ID,
    });
    source.append({
        append_intent_id: "inspection:quiescent-corruption:acknowledgement",
        batch: {
            groups: [
                {
                    owner_id: runId,
                    records: [
                        {
                            append_local_id: "descriptor",
                            body: descriptorBody,
                            caused_by_record_ids: [cut.created_by_record_id],
                            mode: "capture",
                            schema_ref: runProtocolConfig.schemas.continuationDescriptorId,
                            witness_ref: ROOT_WITNESS_ID,
                        },
                        {
                            body: {
                                continuation_descriptor_id: descriptorEnvelope.record_id,
                                execution_id: runId,
                                lifecycle_version: runProtocolConfig.execution.lifecycleVersion,
                                prerequisite: {
                                    kind: "approval",
                                    prerequisite_id: "approval:corruption",
                                },
                                status: runProtocolConfig.execution.lifecycleWaitingStatus,
                            },
                            caused_by_record_ids: [startedRecordId],
                            caused_by_local_refs: ["descriptor"],
                            mode: "capture",
                            schema_ref: runProtocolConfig.schemas.waitingLifecycleId,
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    });
    const records = source.readOwner(runId);
    const descriptorIndex = records.findIndex(
        (record) =>
            record.envelope.schema_ref === runProtocolConfig.schemas.continuationDescriptorId,
    );
    const acknowledgementIndex = records.findIndex(
        (record) => record.envelope.schema_ref === runProtocolConfig.schemas.waitingLifecycleId,
    );
    const startedIndex = records.findIndex(
        (record) => record.envelope.record_id === startedRecordId,
    );
    const pauseCommandIndex = records.findIndex(
        (record) => record.envelope.record_id === pauseCommandRecordId,
    );
    assert.notEqual(descriptorIndex, -1);
    assert.notEqual(acknowledgementIndex, -1);
    assert.notEqual(startedIndex, -1);
    assert.notEqual(pauseCommandIndex, -1);
    const descriptor = records[descriptorIndex] as OwnerRecord;
    const acknowledgement = records[acknowledgementIndex] as OwnerRecord;
    const pauseCommand = records[pauseCommandIndex] as OwnerRecord;

    const replace = (
        index: number,
        record: OwnerRecord,
        replacements: Partial<OwnerRecord>,
    ): readonly OwnerRecord[] => {
        return records.map((candidate, candidateIndex) =>
            candidateIndex === index ? { ...record, ...replacements } : candidate,
        );
    };
    const replaceBody = (
        index: number,
        record: OwnerRecord,
        body: Record<string, unknown>,
    ): readonly OwnerRecord[] => replace(index, record, { body: body as OwnerRecord["body"] });
    const expectMalformed = (
        candidateRecords: readonly OwnerRecord[],
        candidateCut: Cut = cut,
        failCut = false,
    ): void => {
        using projected = new QuiescentProjectionStore(
            runId,
            candidateRecords,
            candidateCut,
            failCut,
        );
        assert.throws(() => inspectDurableTaskExecution(projected, runId), TraceStoreError);
    };

    expectMalformed(records.filter((_, index) => index !== startedIndex));
    expectMalformed(records.filter((_, index) => index !== acknowledgementIndex));
    expectMalformed(records.filter((_, index) => index !== descriptorIndex));
    expectMalformed([...records, acknowledgement]);
    expectMalformed([...records, descriptor]);

    const acknowledgementFields = acknowledgement.body as Record<string, unknown>;
    for (const body of [
        { ...acknowledgementFields, lifecycle_version: 2 },
        { ...acknowledgementFields, execution_id: "run:other" },
        { ...acknowledgementFields, status: "unknown" },
        { ...acknowledgementFields, continuation_descriptor_id: ROOT_WITNESS_ID },
    ]) {
        expectMalformed(replaceBody(acknowledgementIndex, acknowledgement, body));
    }
    expectMalformed(
        replace(acknowledgementIndex, acknowledgement, {
            view: { ...acknowledgement.view, append_intent_id: "different-intent" },
        }),
    );
    expectMalformed(
        replace(acknowledgementIndex, acknowledgement, {
            view: { owner_id: acknowledgement.view.owner_id, owner_ordinal: 0 },
        }),
    );

    const descriptorFields = descriptor.body as Record<string, unknown>;
    expectMalformed(
        replaceBody(descriptorIndex, descriptor, { ...descriptorFields, continuation_version: 2 }),
    );
    expectMalformed(
        replaceBody(descriptorIndex, descriptor, {
            ...descriptorFields,
            execution_id: "run:other",
        }),
    );
    expectMalformed(records, cut, true);
    expectMalformed(records, { ...cut, target_owner_id: "run:other" });
    expectMalformed(records, { ...cut, through_record_id: ROOT_WITNESS_ID });

    const constituents = descriptorFields.constituents as readonly Record<string, unknown>[];
    for (const invalidConstituents of [
        null,
        constituents.slice(0, -1),
        constituents.map((value, index) => (index === 0 ? { ...value, kind: "unknown" } : value)),
        constituents.map((value, index) => (index === 0 ? { ...value, status: null } : value)),
        constituents.map((value, index) => (index === 0 ? { ...value, status: "unknown" } : value)),
        constituents.map((value, index) =>
            index === 0 ? { ...value, receipt_id: "unexpected" } : value,
        ),
        constituents.map((value, index) =>
            index === 0
                ? {
                      kind: value.kind,
                      status: runProtocolConfig.execution.continuationVerifiedStatus,
                  }
                : value,
        ),
    ]) {
        expectMalformed(
            replaceBody(descriptorIndex, descriptor, {
                ...descriptorFields,
                constituents: invalidConstituents,
            }),
        );
    }

    expectMalformed(
        replaceBody(acknowledgementIndex, acknowledgement, {
            continuation_descriptor_id: descriptor.envelope.record_id,
            execution_id: runId,
            lifecycle_version: runProtocolConfig.execution.lifecycleVersion,
            pause_command_id: ROOT_WITNESS_ID,
            status: runProtocolConfig.execution.lifecycleSuspendedStatus,
        }).map((record, index) =>
            index === acknowledgementIndex
                ? {
                      ...record,
                      envelope: {
                          ...record.envelope,
                          schema_ref: runProtocolConfig.schemas.suspendedLifecycleId,
                      },
                  }
                : record,
        ),
    );

    const suspendedAcknowledgement = {
        ...acknowledgement,
        body: {
            continuation_descriptor_id: descriptor.envelope.record_id,
            execution_id: runId,
            lifecycle_version: runProtocolConfig.execution.lifecycleVersion,
            pause_command_id: pauseCommandRecordId,
            status: runProtocolConfig.execution.lifecycleSuspendedStatus,
        },
        envelope: {
            ...acknowledgement.envelope,
            caused_by_record_ids: [
                startedRecordId,
                pauseCommandRecordId,
                descriptor.envelope.record_id,
            ],
            schema_ref: runProtocolConfig.schemas.suspendedLifecycleId,
        },
    } as OwnerRecord;
    const suspendedRecords = records.map((record, index) =>
        index === acknowledgementIndex ? suspendedAcknowledgement : record,
    );
    using validSuspension = new QuiescentProjectionStore(runId, suspendedRecords, cut);
    assert.equal(
        inspectDurableTaskExecution(validSuspension, runId).lifecycle.quiescent?.status,
        runProtocolConfig.execution.lifecycleSuspendedStatus,
    );
    expectMalformed(
        suspendedRecords.map((record, index) =>
            index === pauseCommandIndex
                ? {
                      ...record,
                      envelope: { ...record.envelope, schema_ref: "wrong.pause.schema" },
                  }
                : record,
        ),
    );
    expectMalformed(
        suspendedRecords.map((record, index) =>
            index === pauseCommandIndex
                ? {
                      ...record,
                      body: {
                          ...(pauseCommand.body as Record<string, unknown>),
                          expected_lifecycle_record_id: ROOT_WITNESS_ID,
                      } as OwnerRecord["body"],
                  }
                : record,
        ),
    );

    releaseInvocation?.();
    await running;
});
