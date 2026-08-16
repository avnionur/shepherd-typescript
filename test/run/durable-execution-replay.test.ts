import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
    AppendIntentConflictError,
    type AppendReceipt,
    createRecordId,
    createStaticProvider,
    DurableExecutionClaimFencedError,
    DurableExecutionClaimLostError,
    DurableExecutionRecoveryError,
    executeTaskDurably,
    ROOT_WITNESS_ID,
    recoverTaskDurably,
    SQLiteTraceStore,
    type StoreAppendRequest,
    schema,
    task,
} from "../../src/index.ts";

class StaleAbsentExecutionStore extends SQLiteTraceStore {
    readonly #competingStore: SQLiteTraceStore;
    #interceptCreation = true;
    readonly #runId: string;

    constructor(databasePath: string, competingStore: SQLiteTraceStore, runId: string) {
        super(databasePath);
        this.#competingStore = competingStore;
        this.#runId = runId;
    }

    override append(request: StoreAppendRequest): AppendReceipt {
        if (this.#interceptCreation) {
            this.#interceptCreation = false;
            const competingCreation = this.#competingStore.append(request);
            const createdRecordId = competingCreation.record_ids[0];
            assert.ok(createdRecordId);
            assert.equal(
                this.#competingStore.claimDurableExecutionInvocation(
                    this.#runId,
                    createdRecordId,
                    "claim:stale-absence-winner",
                    0,
                ).status,
                "acquired",
            );
        }
        return super.append(request);
    }
}

test("executeTaskDurably admits only one concurrent provider invocation across store connections", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-durable-claim-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const databasePath = path.join(directory, "trace.sqlite");
    const fixtureTask = task({
        input: schema.void(),
        instruction: "Return one claimed value.",
        name: "durable-invocation-claim",
        output: schema.string(),
        version: "1.0.0",
    });
    let invocationCount = 0;
    let releaseInvocation: (() => void) | undefined;
    const invocationReleased = new Promise<void>((resolve) => {
        releaseInvocation = resolve;
    });
    const provider = {
        descriptor: () => ({
            capabilities: { streaming: false, structuredOutput: true, tools: false },
            id: "durable-invocation-claim",
            kind: "static" as const,
            model: "offline-v1",
        }),
        invoke: async () => {
            invocationCount += 1;
            await invocationReleased;
            return {
                output: "claimed",
                usage: {
                    cacheCreationInputTokens: 0,
                    cacheReadInputTokens: 0,
                    costUsd: null,
                    inputTokens: 1,
                    outputTokens: 1,
                },
            };
        },
    };
    using firstStore = new SQLiteTraceStore(databasePath);
    using secondStore = new SQLiteTraceStore(databasePath);
    const options = {
        budget: { maxTurns: 1 },
        input: undefined,
        provider,
        runId: "run:durable-invocation-claim",
        task: fixtureTask,
    } as const;

    const first = executeTaskDurably(firstStore, options);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(invocationCount, 1);
    const createdRecordId = firstStore.readOwner(options.runId)[0]?.envelope.record_id;
    assert.ok(createdRecordId);
    const lostClaim = secondStore.claimDurableExecutionInvocation(
        options.runId,
        createdRecordId,
        "claim:loser",
    );
    assert.equal(lostClaim.status, "lost");
    assert.equal(lostClaim.run_id, options.runId);
    await assert.rejects(executeTaskDurably(secondStore, options), DurableExecutionRecoveryError);
    assert.equal(invocationCount, 1);

    releaseInvocation?.();
    const durable = await first;
    assert.equal(durable.execution.outcome.outcome.status, "finished");
    assert.equal(invocationCount, 1);
});

test("ordinary admission cannot reclaim an expired claim after a stale absent read", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-stale-absence-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const databasePath = path.join(directory, "trace.sqlite");
    const runId = "run:stale-absence";
    const fixtureTask = task({
        input: schema.void(),
        instruction: "Do not invoke after stale admission.",
        name: "stale-absence",
        output: schema.string(),
        version: "1.0.0",
    });
    let invocationCount = 0;
    const provider = {
        descriptor: () => ({
            capabilities: { streaming: false, structuredOutput: true, tools: false },
            id: "stale-absence-provider",
            kind: "static" as const,
            model: "offline-v1",
        }),
        invoke: async () => {
            invocationCount += 1;
            throw new Error("stale ordinary admission must not invoke");
        },
    };
    context.mock.method(Date, "now", () => 30_000);
    using competingStore = new SQLiteTraceStore(databasePath);
    using staleStore = new StaleAbsentExecutionStore(databasePath, competingStore, runId);

    await assert.rejects(
        executeTaskDurably(staleStore, {
            budget: { maxTurns: 1 },
            input: undefined,
            provider,
            runId,
            task: fixtureTask,
        }),
        DurableExecutionClaimLostError,
    );
    assert.equal(invocationCount, 0);
    assert.equal(staleStore.readOwner(runId).length, 1);
});

test("durable invocation claims reject malformed and conflicting creation evidence", () => {
    using store = new SQLiteTraceStore();
    const created = store.append({
        append_intent_id: "claim:creation",
        batch: {
            groups: [
                {
                    owner_id: "run:claim-validation",
                    records: [
                        {
                            body: { value: "created" },
                            mode: "declaration",
                            schema_ref: "shepherd2.execution.created.v1",
                            witness_ref: ROOT_WITNESS_ID,
                        },
                        {
                            body: { value: "other" },
                            mode: "declaration",
                            schema_ref: "shepherd2.execution.created.v1",
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
                {
                    owner_id: "run:claim-other-owner",
                    records: [
                        {
                            body: { value: "other-owner" },
                            mode: "declaration",
                            schema_ref: "shepherd2.execution.created.v1",
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
                {
                    owner_id: "run:claim-wrong-schema",
                    records: [
                        {
                            body: { value: "wrong-schema" },
                            mode: "declaration",
                            schema_ref: "example.claim.created.v1",
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    });
    const first = created.record_ids[0];
    const second = created.record_ids[1];
    const otherOwner = created.record_ids[2];
    const wrongSchema = created.record_ids[3];
    assert.ok(first && second && otherOwner && wrongSchema);
    assert.throws(
        () =>
            store.claimDurableExecutionInvocation(
                "run:claim-validation",
                otherOwner,
                "claim:wrong-owner",
            ),
        TypeError,
    );
    assert.throws(
        () =>
            store.claimDurableExecutionInvocation(
                "run:claim-wrong-schema",
                wrongSchema,
                "claim:wrong-schema",
            ),
        TypeError,
    );
    assert.equal(
        store.claimDurableExecutionInvocation("run:claim-validation", first, "claim:first").status,
        "acquired",
    );
    assert.throws(
        () => store.claimDurableExecutionInvocation("run:claim-validation", second, "claim:other"),
        TypeError,
    );
    assert.throws(
        () => store.claimDurableExecutionInvocation("", first, "claim:invalid"),
        TypeError,
    );
    assert.throws(
        () => store.claimDurableExecutionInvocation("run:claim-validation", first, ""),
        TypeError,
    );
});

test("durable invocation claims reclaim expiry and fence stale or already-started writers", () => {
    using store = new SQLiteTraceStore();
    const runId = "run:claim-fencing";
    const created = store.append({
        append_intent_id: "claim:fencing:creation",
        batch: {
            groups: [
                {
                    owner_id: runId,
                    records: [
                        {
                            body: { value: "created" },
                            mode: "declaration",
                            schema_ref: "shepherd2.execution.created.v1",
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    });
    const createdRecordId = created.record_ids[0];
    assert.ok(createdRecordId);
    const first = store.claimDurableExecutionInvocation(runId, createdRecordId, "claim:first", 100);
    assert.equal(first.status, "acquired");
    assert.equal(first.fencing_token, 1);
    assert.equal(first.lease_expires_at, 30_100);
    assert.equal(
        store.claimDurableExecutionInvocation(runId, createdRecordId, "claim:early", 30_099).status,
        "lost",
    );
    const reclaimed = store.claimDurableExecutionInvocation(
        runId,
        createdRecordId,
        "claim:reclaimed",
        30_100,
    );
    assert.equal(reclaimed.status, "acquired");
    assert.equal(reclaimed.fencing_token, 2);
    const renewed = store.claimDurableExecutionInvocation(
        runId,
        createdRecordId,
        "claim:reclaimed",
        60_100,
    );
    assert.equal(renewed.status, "acquired");
    assert.equal(renewed.fencing_token, 3);
    assert.deepEqual(store.appendDurableExecutionStart(runId, "claim:first", 1, 30_100), {
        status: "fenced",
    });
    assert.equal(
        store.appendDurableExecutionStart(runId, "claim:reclaimed", renewed.fencing_token, 60_100)
            .status,
        "committed",
    );
    assert.equal(
        store.claimDurableExecutionInvocation(runId, createdRecordId, "claim:after-start", 60_100)
            .status,
        "lost",
    );
    assert.deepEqual(
        store.appendDurableExecutionStart(runId, "claim:reclaimed", renewed.fencing_token, 60_100),
        { status: "fenced" },
    );
    assert.equal(
        store.claimDurableExecutionInvocation(runId, createdRecordId, "claim:reclaimed", 60_100)
            .status,
        "lost",
    );
    assert.throws(
        () => store.appendDurableExecutionStart(runId, "claim:reclaimed", 0, 30_100),
        TypeError,
    );
    assert.throws(
        () =>
            store.claimDurableExecutionInvocation(
                runId,
                createdRecordId,
                "claim:overflow",
                Number.MAX_SAFE_INTEGER,
            ),
        TypeError,
    );
    assert.throws(
        () =>
            store.claimDurableExecutionInvocation(runId, createdRecordId, "claim:invalid-time", -1),
        TypeError,
    );
    assert.throws(
        () =>
            store.claimDurableExecutionInvocation(
                runId,
                createdRecordId,
                "claim:invalid-takeover",
                0,
                "yes" as never,
            ),
        TypeError,
    );
});

test("expired claims fence stale writers across SQLite connections", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-durable-fencing-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const databasePath = path.join(directory, "trace.sqlite");
    using staleStore = new SQLiteTraceStore(databasePath);
    using replacementStore = new SQLiteTraceStore(databasePath);
    const runId = "run:cross-connection-fencing";
    const created = staleStore.append({
        append_intent_id: "cross-connection-fencing:creation",
        batch: {
            groups: [
                {
                    owner_id: runId,
                    records: [
                        {
                            body: { value: "created" },
                            mode: "declaration",
                            schema_ref: "shepherd2.execution.created.v1",
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    });
    const createdRecordId = created.record_ids[0];
    assert.ok(createdRecordId);
    const stale = staleStore.claimDurableExecutionInvocation(
        runId,
        createdRecordId,
        "claim:stale",
        0,
    );
    const replacement = replacementStore.claimDurableExecutionInvocation(
        runId,
        createdRecordId,
        "claim:replacement",
        30_000,
    );
    assert.equal(stale.status, "acquired");
    assert.equal(replacement.status, "acquired");
    assert.equal(replacement.fencing_token, stale.fencing_token + 1);
    assert.deepEqual(
        staleStore.appendDurableExecutionStart(runId, stale.claim_id, stale.fencing_token, 30_000),
        { status: "fenced" },
    );
    assert.equal(
        replacementStore.appendDurableExecutionStart(
            runId,
            replacement.claim_id,
            replacement.fencing_token,
            30_000,
        ).status,
        "committed",
    );
});

test("executeTaskDurably fences a claim that expires before start publication", async (context) => {
    const fixtureTask = task({
        input: schema.void(),
        instruction: "Never cross an expired claim.",
        name: "durable-expired-before-start",
        output: schema.void(),
        version: "1.0.0",
    });
    let invocationCount = 0;
    const provider = {
        descriptor: () => ({
            capabilities: { streaming: false, structuredOutput: true, tools: false },
            id: "durable-expired-before-start",
            kind: "static" as const,
            model: "offline-v1",
        }),
        invoke: async () => {
            invocationCount += 1;
            return {
                output: null,
                usage: {
                    cacheCreationInputTokens: 0,
                    cacheReadInputTokens: 0,
                    costUsd: null,
                    inputTokens: 0,
                    outputTokens: 0,
                },
            };
        },
    };
    using store = new SQLiteTraceStore();
    let nowCalls = 0;
    context.mock.method(Date, "now", () => (nowCalls++ === 0 ? 0 : 30_000));

    await assert.rejects(
        executeTaskDurably(store, {
            budget: { maxTurns: 1 },
            input: undefined,
            provider,
            runId: "run:durable-expired-before-start",
            task: fixtureTask,
        }),
        (error: unknown) => {
            assert.ok(error instanceof DurableExecutionClaimFencedError);
            assert.equal(error.code, "DURABLE_EXECUTION_CLAIM_FENCED");
            assert.equal(error.run_id, "run:durable-expired-before-start");
            assert.equal(typeof error.claim_id, "string");
            return true;
        },
    );
    assert.equal(invocationCount, 0);
});

test("durable start publication rolls back conflicts without consuming the claim", () => {
    using store = new SQLiteTraceStore();
    const runId = "run:claim-append-rollback";
    const created = store.append({
        append_intent_id: "claim:append-rollback:creation",
        batch: {
            groups: [
                {
                    owner_id: runId,
                    records: [
                        {
                            body: { value: "created" },
                            mode: "declaration",
                            schema_ref: "shepherd2.execution.created.v1",
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    });
    const createdRecordId = created.record_ids[0];
    assert.ok(createdRecordId);
    const claim = store.claimDurableExecutionInvocation(
        runId,
        createdRecordId,
        "claim:append-rollback",
        0,
    );
    assert.equal(claim.status, "acquired");
    assert.deepEqual(
        store.appendDurableExecutionStart("run:claim-missing", "claim:missing", 1, 0),
        { status: "fenced" },
    );
    store.append({
        append_intent_id: createRecordId({
            append_intent: {
                run_id: runId,
                schema_ref: "shepherd2.execution.started.v1",
            },
        }),
        batch: { groups: [] },
    });
    assert.throws(
        () => store.appendDurableExecutionStart(runId, claim.claim_id, claim.fencing_token, 0),
        AppendIntentConflictError,
    );
    assert.equal(
        store.claimDurableExecutionInvocation(runId, createdRecordId, claim.claim_id, 0).status,
        "acquired",
    );
});

test("recoverTaskDurably rejects a live preclaim then recovers it after expiry", async (context) => {
    const fixtureTask = task({
        input: schema.void(),
        instruction: "Return a claimed value.",
        name: "durable-preclaimed",
        output: schema.string(),
        version: "1.0.0",
    });
    const runId = "run:durable-preclaimed";
    let invocationCount = 0;
    const provider = {
        descriptor: () => ({
            capabilities: { streaming: false, structuredOutput: true, tools: false },
            id: "durable-preclaimed",
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
    };
    using store = new SQLiteTraceStore();
    const created = store.append({
        append_intent_id: createRecordId({
            append_intent: { run_id: runId, schema_ref: "shepherd2.execution.created.v1" },
        }),
        batch: {
            groups: [
                {
                    owner_id: runId,
                    records: [
                        {
                            body: {
                                payload: {
                                    budget: { maxTurns: 1 },
                                    execution_id: runId,
                                    inputs: { value: null },
                                    parent_execution_id: null,
                                    provider: provider.descriptor(),
                                    task_artifact_lock: fixtureTask.artifactLock,
                                    task_ref: fixtureTask.artifactLock.artifact_digest,
                                },
                            },
                            mode: "declaration",
                            schema_ref: "shepherd2.execution.created.v1",
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    });
    const createdRecordId = created.record_ids[0];
    assert.ok(createdRecordId);
    assert.equal(
        store.claimDurableExecutionInvocation(runId, createdRecordId, "claim:preclaimed", 0).status,
        "acquired",
    );
    let nowMilliseconds = 29_999;
    context.mock.method(Date, "now", () => nowMilliseconds);

    await assert.rejects(
        recoverTaskDurably(store, {
            commandId: "command:recover:preclaimed",
            execution: {
                budget: { maxTurns: 1 },
                input: undefined,
                provider,
                runId,
                task: fixtureTask,
            },
        }),
        (error: unknown) => {
            assert.ok(error instanceof DurableExecutionClaimLostError);
            assert.equal(error.code, "DURABLE_EXECUTION_CLAIM_LOST");
            assert.equal(error.claim_id, "claim:preclaimed");
            assert.equal(error.run_id, runId);
            assert.equal(error.status, "lost");
            return true;
        },
    );
    assert.equal(invocationCount, 0);
    nowMilliseconds = 30_000;
    const recovered = await recoverTaskDurably(store, {
        commandId: "command:recover:preclaimed",
        execution: {
            budget: { maxTurns: 1 },
            input: undefined,
            provider,
            runId,
            task: fixtureTask,
        },
    });
    assert.equal(recovered.result.execution.outcome.outcome.status, "finished");
    assert.equal(invocationCount, 1);
});

test("executeTaskDurably validates input before retaining lifecycle evidence", async () => {
    const typedTask = task({
        input: schema.object({ value: schema.string() }),
        instruction: "Return nothing.",
        name: "durable-invalid-input",
        output: schema.void(),
        version: "1.0.0",
    });
    const provider = createStaticProvider({
        descriptor: { id: "unused-invalid-input", model: "offline-v1" },
        exchanges: [],
    });
    using store = new SQLiteTraceStore();

    await assert.rejects(
        executeTaskDurably(store, {
            budget: { maxTurns: 1 },
            input: { value: 1 } as never,
            provider,
            runId: "run:durable-invalid-input",
            task: typedTask,
        }),
        TypeError,
    );
    assert.deepEqual(store.readOwner("run:durable-invalid-input"), []);
});

test("executeTaskDurably replays identical deterministic evidence without duplication", async () => {
    const deterministicTask = task({
        input: schema.void(),
        instruction: "Return a stable value.",
        name: "durable-replay",
        output: schema.string(),
        version: "1.0.0",
    });
    let invocationCount = 0;
    const provider = {
        descriptor: () => ({
            capabilities: { streaming: false, structuredOutput: true, tools: false },
            id: "durable-replay",
            kind: "static" as const,
            model: "offline-v1",
        }),
        invoke: async () => {
            invocationCount += 1;
            return {
                artifacts: [
                    {
                        content: { text: "stable artifact", type: "text" as const },
                        kind: "report",
                        metadata: {},
                        name: "stable.txt",
                    },
                ],
                output: "stable",
                usage: {
                    cacheCreationInputTokens: 0,
                    cacheReadInputTokens: 0,
                    costUsd: null,
                    inputTokens: 1,
                    outputTokens: 1,
                },
            };
        },
    };
    using store = new SQLiteTraceStore();
    const execute = () =>
        executeTaskDurably(store, {
            budget: { maxTurns: 1 },
            input: undefined,
            provider,
            runId: "run:durable-replay",
            task: deterministicTask,
        });

    const first = await execute();
    const firstTrace = store.exportTrace();
    const second = await execute();

    assert.deepEqual(second, first);
    assert.equal(invocationCount, 1);
    assert.deepEqual(second.ledger.artifact_record_ids, first.ledger.artifact_record_ids);
    assert.equal(store.readOwner("run:durable-replay").length, 7);
    assert.equal(store.exportTrace(), firstTrace);
});

test("executeTaskDurably rejects changed evidence for an existing run before invocation", async () => {
    const echo = task({
        input: schema.string(),
        instruction: "Return the input.",
        name: "durable-conflict",
        output: schema.string(),
        version: "1.0.0",
    });
    const firstProvider = createStaticProvider({
        descriptor: { id: "durable-conflict", model: "offline-v1" },
        exchanges: [
            {
                request: {
                    input: "first",
                    instruction: echo.instruction,
                    outputSchema: echo.artifact.output_schema,
                },
                response: {
                    output: "first",
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
    const unusedProvider = createStaticProvider({
        descriptor: { id: "durable-conflict", model: "offline-v1" },
        exchanges: [],
    });
    using store = new SQLiteTraceStore();
    await executeTaskDurably(store, {
        budget: { maxTurns: 1 },
        input: "first",
        provider: firstProvider,
        runId: "run:durable-conflict",
        task: echo,
    });

    await assert.rejects(
        executeTaskDurably(store, {
            budget: { maxTurns: 1 },
            input: "changed",
            provider: unusedProvider,
            runId: "run:durable-conflict",
            task: echo,
        }),
        AppendIntentConflictError,
    );
});
