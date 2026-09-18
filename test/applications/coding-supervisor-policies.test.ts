import assert from "node:assert/strict";
import { test } from "node:test";

import {
    createApplicationAppendIntentId,
    createApplicationAppendRequest,
} from "../../src/applications/records.ts";
import {
    APPLICATION_LIMITS,
    ApplicationBudgetError,
    ApplicationEvidenceError,
    ApplicationProtocolError,
    type ApplicationWorldAdapter,
    type ChildRunProvenanceDeclaration,
    type CodingSupervisorDecision,
    type CodingSupervisorPolicy,
    createStaticProvider,
    DelegationStatusError,
    deriveApplicationOwnerId,
    inspectCodingSupervisorRun,
    isPublicError,
    type RecordBody,
    type RecordId,
    ROOT_WITNESS_ID,
    runCodingSupervisor,
    SQLiteTraceStore,
    type StoreAppendRequest,
    taskValueOf,
} from "../../src/index.ts";
import { applicationsProtocolConfig, kernelProtocolConfig } from "../../src/protocol/config.ts";
import { appendOwnerRecord } from "../supervision/fixtures.ts";
import {
    acceptAfterObserve,
    editTask,
    LEAD,
    outputPaths,
    rawSupervisionProtocol,
    rootParent,
    scripted,
    supervisionProtocol,
    temporaryDatabasePath,
    workerOf,
} from "./fixtures.ts";

const config = applicationsProtocolConfig;
const NEXT = "supervisor:next";

class MovedHeadStore extends SQLiteTraceStore {
    failAfter = Number.POSITIVE_INFINITY;
    calls = 0;

    override appendApplicationRecord(
        applicationId: string,
        expectedHeadRecordId: RecordId | null,
        request: StoreAppendRequest,
        cutId: string | null,
    ) {
        this.calls += 1;
        if (this.calls > this.failAfter) {
            return Object.freeze({ status: "head_moved" as const });
        }
        return super.appendApplicationRecord(applicationId, expectedHeadRecordId, request, cutId);
    }
}

/** In-memory world adapter whose changed paths are declared per worker. */
function fakeWorld(
    changed: Readonly<Record<string, readonly string[]>>,
    overrides: Partial<ApplicationWorldAdapter> = {},
): ApplicationWorldAdapter & { readonly calls: string[] } {
    const calls: string[] = [];
    const custodies = new Map<string, string>();
    return {
        calls,
        changedPaths: async (custodyId) => changed[custodies.get(custodyId) as string] ?? [],
        discard: async ({ commandId, custodyId }) => {
            calls.push(`discard ${custodies.get(custodyId)}`);
            return { receipt_id: `receipt:discard:${commandId.slice(-8)}` };
        },
        fork: async ({ commandId, workerId }) => {
            calls.push(`fork ${workerId}`);
            const custodyId = `custody:${commandId.slice(-8)}`;
            custodies.set(custodyId, workerId);
            return {
                custody_id: custodyId,
                receipt_id: `receipt:fork:${commandId.slice(-8)}`,
                root: "/dev/null",
            };
        },
        merge: async ({ commandId, custodyId }) => {
            calls.push(`merge ${custodies.get(custodyId)}`);
            return { receipt_id: `receipt:merge:${commandId.slice(-8)}` };
        },
        ...overrides,
    };
}

function options(
    commandId: string,
    policy: CodingSupervisorPolicy,
    overrides: Record<string, unknown> = {},
) {
    return {
        changedPaths: outputPaths,
        commandId,
        parent: rootParent(),
        policy,
        protocol: supervisionProtocol(),
        supervisorId: LEAD,
        workers: [workerOf("a"), workerOf("b")],
        ...overrides,
    };
}

test("each policy kind is applied alone on the trace-only path with retained evidence", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "policies");
    using store = new SQLiteTraceStore(databasePath);
    const cited = appendOwnerRecord(store, "worker:notes", "n0") as RecordId;
    // Inject before start: the consumption record lists exactly the injection.
    const injected = await runCodingSupervisor(
        store,
        options(
            "application:inject",
            scripted(
                [
                    {
                        cited_record_ids: [cited],
                        data: { hint: "short" },
                        kind: "inject",
                        worker_id: "a",
                    },
                ],
                "a",
            ),
        ),
    );
    const injection = injected.inspection.decisions[0]?.evidence as {
        readonly injection_record_id: RecordId;
    };
    const aAttempt = injected.inspection.workers[0]?.attempts[0]?.inspection;
    assert.deepEqual(aAttempt?.consumed_context?.consumed_record_ids, [
        injection.injection_record_id,
    ]);
    assert.deepEqual(aAttempt?.injections[0]?.cited_record_ids, [cited]);
    assert.equal(injected.inspection.decisions[1]?.decision.kind, "accept");
    assert.equal(injected.inspection.world, false);
    assert.ok(
        injected.inspection.decisions[0]?.observations.every(
            (observation) => observation.custody_id === null,
        ),
    );
    assert.deepEqual(injected.inspection.decisions[1]?.conflict, {
        kind: "path_overlap",
        paths: ["greet.ts"],
        worker_ids: ["a", "b"],
    });
    assert.deepEqual(injected.manifest.artifacts.map((artifact) => artifact.role).sort(), [
        "decision",
        "decision",
        "worker",
        "worker",
    ]);
    assert.equal(injected.manifest.costs.provider_calls, 2);
    // Handoff with a reason: the application names the successor for later commands.
    const handed = await runCodingSupervisor(
        store,
        options(
            "application:handoff",
            scripted(
                [
                    {
                        kind: "handoff",
                        reason: "review",
                        successor_supervisor_id: NEXT,
                        worker_id: "b",
                    },
                ],
                "b",
            ),
        ),
    );
    assert.equal(handed.inspection.decisions[1]?.observations[1]?.worker_status, "handed_off");
    assert.equal(
        handed.inspection.workers[1]?.attempts[0]?.inspection.decision?.supervisor_id,
        NEXT,
    );
    assert.equal(
        handed.inspection.workers[1]?.attempts[0]?.inspection.handoffs[0]?.reason,
        "review",
    );
    // Discard and restart before the first run: attempt one never started.
    const restarted = await runCodingSupervisor(
        store,
        options(
            "application:restart",
            scripted([{ kind: "discard_restart", reason: "fresh start", worker_id: "a" }], "a"),
        ),
    );
    const lineage = restarted.inspection.workers[0];
    assert.deepEqual(
        lineage?.attempts.map((attempt) => [
            attempt.attempt,
            attempt.status,
            attempt.inspection.child,
        ]),
        [
            [1, "restarted", null],
            [2, "accepted", lineage?.attempts[1]?.inspection.child],
        ],
    );
    assert.equal(restarted.manifest.costs.provider_calls, 2);
    const restartEvidence = restarted.inspection.decisions[0]?.evidence as {
        readonly discard_receipt_id: string | null;
        readonly fork_receipt_id: string | null;
    };
    assert.deepEqual(
        [restartEvidence.discard_receipt_id, restartEvidence.fork_receipt_id],
        [null, null],
    );
    assert.equal(store.verifyIntegrity().ok, true);
});

test("failed, provider-serviced, and task-value workers are observed honestly and manifest digests are stable", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "workers");
    using store = new SQLiteTraceStore(databasePath);
    const failing = workerOf("b", () => {
        throw new Error("worker b failed");
    });
    const failed = await runCodingSupervisor(
        store,
        options("application:failed", acceptAfterObserve("a"), {
            workers: [workerOf("a"), failing],
        }),
    );
    const observed = failed.inspection.decisions[1]?.observations[1];
    assert.equal(observed?.completion_status, "failed");
    assert.deepEqual(observed?.changed_paths, []);
    assert.deepEqual(failed.inspection.decisions[1]?.conflict.kind, "none");
    assert.equal(failed.manifest.costs.provider_calls, 2);
    const [file] = supervisionProtocol().dataset.items;
    const input = { path: file as string, text: "provider edit" };
    const provider = createStaticProvider({
        descriptor: { id: "provider:worker", model: "fixture-v1" },
        exchanges: [
            {
                request: {
                    input,
                    instruction: editTask.instruction,
                    outputSchema: editTask.artifact.output_schema,
                },
                response: {
                    output: input,
                    usage: {
                        cacheCreationInputTokens: 1,
                        cacheReadInputTokens: 2,
                        costUsd: 0.25,
                        inputTokens: 3,
                        outputTokens: 4,
                    },
                },
            },
        ],
    });
    const provenance: ChildRunProvenanceDeclaration = { kind: "declared" };
    const mixed = await runCodingSupervisor(
        store,
        options("application:provider", acceptAfterObserve("a"), {
            workers: [
                workerOf("a", undefined, { input, program: undefined, provider }),
                workerOf("b", undefined, { provenance, task: taskValueOf(editTask) }),
            ],
        }),
    );
    assert.equal(
        mixed.inspection.workers[0]?.attempts[0]?.inspection.completion?.execution_kind,
        "provider",
    );
    assert.equal(
        mixed.inspection.workers[1]?.attempts[0]?.inspection.completion?.execution_kind,
        "program",
    );
    assert.deepEqual(mixed.manifest.costs, {
        cache_creation_input_tokens: 1,
        cache_read_input_tokens: 2,
        cost_usd: null,
        input_tokens: 3,
        output_tokens: 4,
        provider_calls: 2,
    });
    // Two independent runs with the same seeds and protocol produce the same manifest identity.
    using other = new SQLiteTraceStore();
    const first = await runCodingSupervisor(
        store,
        options("application:stable", acceptAfterObserve("a")),
    );
    const second = await runCodingSupervisor(
        other,
        options("application:stable", acceptAfterObserve("a")),
    );
    assert.equal(first.manifest.manifest_id, second.manifest.manifest_id);
    assert.deepEqual(first.inspection, second.inspection);
    assert.deepEqual(first.manifest.seeds, supervisionProtocol().seeds);
    // Repeating the command returns the retained manifest without running any worker.
    let invoked = 0;
    const repeated = await runCodingSupervisor(
        store,
        options(
            "application:stable",
            () => {
                throw new Error("policy must not run");
            },
            {
                workers: [
                    workerOf("a", () => {
                        invoked += 1;
                        return "never";
                    }),
                    workerOf("b"),
                ],
            },
        ),
    );
    assert.equal(invoked, 0);
    assert.deepEqual(repeated.manifest, first.manifest);
});

test("world adapters supply custody, changed paths, and receipts on the trace-free fake world", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "fake-world");
    using store = new SQLiteTraceStore(databasePath);
    const world = fakeWorld({ a: ["src/a.ts"], b: ["src/b.ts"] });
    const receipt = await runCodingSupervisor(
        store,
        options(
            "application:fake",
            scripted([{ kind: "discard_restart", reason: "restart b", worker_id: "b" }], "a"),
            { changedPaths: undefined, world },
        ),
    );
    assert.deepEqual(world.calls, [
        "fork a",
        "fork b",
        "discard b",
        "fork b",
        "merge a",
        "discard b",
    ]);
    assert.deepEqual(receipt.inspection.decisions[1]?.conflict, {
        kind: "none",
        paths: [],
        worker_ids: [],
    });
    assert.deepEqual(
        receipt.inspection.decisions[0]?.observations.map(
            (observation) => observation.changed_paths,
        ),
        [["src/a.ts"], ["src/b.ts"]],
    );
    assert.deepEqual(receipt.manifest.artifacts.map((artifact) => artifact.role).sort(), [
        "decision",
        "decision",
        "worker",
        "worker",
        "worker",
        "world_discard",
        "world_discard",
        "world_fork",
        "world_fork",
        "world_fork",
        "world_merge",
    ]);
    assert.equal(receipt.inspection.world, true);
    for (const [label, overrides] of [
        ["custody", { fork: async () => ({ custody_id: "" }) }],
        ["paths", { changedPaths: async () => ["a", "a"] }],
        ["merge", { merge: async () => ({ receipt_id: 1 }) }],
        ["discard", { discard: async () => null }],
    ] as const) {
        await assert.rejects(
            runCodingSupervisor(
                store,
                options(
                    `application:fake-${label}`,
                    scripted(
                        [{ kind: "discard_restart", reason: "restart b", worker_id: "b" }],
                        "a",
                    ),
                    {
                        changedPaths: undefined,
                        world: fakeWorld({}, overrides as Partial<ApplicationWorldAdapter>),
                    },
                ),
            ),
            TypeError,
        );
    }
});

test("malformed options, workers, adapters, and decisions are refused before any worker runs", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "refusals");
    using store = new SQLiteTraceStore(databasePath);
    let invoked = 0;
    const counting = (workerId: string) =>
        workerOf(workerId, () => {
            invoked += 1;
            return "never";
        });
    const base = options("application:refused", acceptAfterObserve("a"), {
        workers: [counting("a"), counting("b")],
    });
    for (const mutation of [
        null,
        { ...base, extra: true },
        { ...base, commandId: "" },
        { ...base, supervisorId: "" },
        { ...base, clock: 5 },
        { ...base, policy: null },
        { ...base, changedPaths: undefined },
        { ...base, world: fakeWorld({}) },
        { ...base, world: { fork: () => null } },
        { ...base, workers: [counting("a")] },
        {
            ...base,
            workers: Array.from({ length: APPLICATION_LIMITS.maxWorkers + 1 }, (_, index) =>
                counting(`w${index}`),
            ),
        },
        { ...base, workers: [counting("a"), counting("a")] },
        { ...base, workers: [counting("a"), { ...counting("b"), workerId: 1 }] },
        { ...base, workers: [counting("a"), { ...counting("b"), program: undefined }] },
        {
            ...base,
            workers: [
                counting("a"),
                { ...counting("b"), provider: { descriptor: () => null, invoke: () => null } },
            ],
        },
        {
            ...base,
            workers: [
                counting("a"),
                { ...counting("b"), program: undefined, provider: { descriptor: 1 } },
            ],
        },
        { ...base, workers: [counting("a"), { ...counting("b"), program: "not a function" }] },
        { ...base, workers: [counting("a"), { ...counting("b"), budget: null }] },
    ]) {
        await assert.rejects(runCodingSupervisor(store, mutation as never), TypeError);
    }
    for (const decision of [
        { kind: "unknown" },
        { kind: "inject", worker_id: "a" },
        { kind: "accept", worker_id: "c" },
        null,
    ]) {
        await assert.rejects(
            runCodingSupervisor(
                store,
                options("application:bad-decision", () => decision as never),
            ),
            TypeError,
        );
    }
    assert.equal(invoked, 0);
    // Budgets: a worker over the protocol bound, a worker omitting the bounded metric, exhausted
    // rounds, and exhausted worker starts.
    for (const budget of [{ maxTurns: 3 }, { maxInputTokens: 1 }]) {
        await assert.rejects(
            runCodingSupervisor(store, {
                ...base,
                workers: [counting("a"), { ...counting("b"), budget }],
            }),
            (error: unknown) =>
                error instanceof ApplicationBudgetError &&
                isPublicError(error) &&
                error.code === config.errors.budgetCode,
        );
    }
    await assert.rejects(
        runCodingSupervisor(
            store,
            options("application:rounds", () => ({ kind: "observe" }), {
                protocol: supervisionProtocol({
                    budgets: { maxProviderCalls: 6, maxRounds: 2, maxTurnsPerWorker: 2 },
                }),
            }),
        ),
        (error: unknown) =>
            error instanceof ApplicationBudgetError && /maxRounds/u.test(error.message),
    );
    await assert.rejects(
        runCodingSupervisor(
            store,
            options(
                "application:starts",
                () => ({ kind: "discard_restart", reason: "again", worker_id: "a" }),
                {
                    protocol: supervisionProtocol({
                        budgets: { maxProviderCalls: 2, maxRounds: 8, maxTurnsPerWorker: 2 },
                    }),
                },
            ),
        ),
        (error: unknown) =>
            error instanceof ApplicationBudgetError && /maxProviderCalls/u.test(error.message),
    );
    // A protocol without a worker metric bound accepts any declared worker budget.
    const unbounded = await runCodingSupervisor(
        store,
        options("application:unbounded", acceptAfterObserve("a"), {
            protocol: supervisionProtocol({ budgets: { maxProviderCalls: 6, maxRounds: 8 } }),
            workers: [workerOf("a", undefined, { budget: { maxTurns: 4 } }), workerOf("b")],
        }),
    );
    assert.equal(unbounded.inspection.decisions.length, 2);
    // Accepting a worker that has not finished is refused by the delegation seam.
    await assert.rejects(
        runCodingSupervisor(
            store,
            options("application:early-accept", () => ({ kind: "accept", worker_id: "a" })),
        ),
        DelegationStatusError,
    );
});

test("protocol definitions that do not describe a coding supervisor are refused", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "protocol");
    using store = new SQLiteTraceStore(databasePath);
    const raw = rawSupervisionProtocol();
    const surfaces = raw.surfaces as readonly { readonly kind: string; readonly role: string }[];
    for (const protocol of [
        null,
        { ...raw, kind: "tree_rl" },
        {
            ...raw,
            surfaces: surfaces.filter(
                (surface) => !(surface.kind === "schema" && surface.role === "observation"),
            ),
        },
        {
            ...raw,
            surfaces: surfaces.filter(
                (surface) => !(surface.kind === "prompt" && surface.role === "action"),
            ),
        },
        { ...raw, surfaces: surfaces.filter((surface) => surface.kind !== "tool") },
        { ...raw, budgets: { maxRounds: 2 } },
        { ...raw, budgets: { maxProviderCalls: 2 } },
        { ...raw, budgets: { maxProviderCalls: 2, maxRounds: APPLICATION_LIMITS.maxRounds + 1 } },
    ]) {
        await assert.rejects(
            runCodingSupervisor(
                store,
                options("application:protocol", acceptAfterObserve("a"), { protocol }),
            ),
            (error: unknown) =>
                error instanceof ApplicationProtocolError &&
                error.code === config.errors.protocolCode,
        );
    }
    // A rerun under another protocol is refused before and after the manifest.
    await assert.rejects(
        runCodingSupervisor(
            store,
            options("application:reopen", () => {
                throw new Error("interrupted before any decision");
            }),
        ),
        /interrupted/u,
    );
    const applicationId = deriveApplicationOwnerId("application:reopen");
    assert.equal(inspectCodingSupervisorRun(store, applicationId).decisions.length, 0);
    await assert.rejects(
        runCodingSupervisor(
            store,
            options("application:reopen", acceptAfterObserve("a"), {
                protocol: supervisionProtocol({ protocolVersion: "appendix-e.v2" }),
            }),
        ),
        (error: unknown) =>
            error instanceof ApplicationProtocolError && /another protocol/u.test(error.message),
    );
    await assert.rejects(
        runCodingSupervisor(
            store,
            options("application:reopen", acceptAfterObserve("a"), {
                workers: [workerOf("a"), workerOf("c")],
            }),
        ),
        (error: unknown) =>
            error instanceof ApplicationEvidenceError && /different workers/u.test(error.message),
    );
    const resumed = await runCodingSupervisor(
        store,
        options("application:reopen", acceptAfterObserve("a")),
    );
    assert.equal(resumed.inspection.decisions.length, 2);
    await assert.rejects(
        runCodingSupervisor(
            store,
            options("application:reopen", acceptAfterObserve("a"), {
                protocol: supervisionProtocol({ protocolVersion: "appendix-e.v2" }),
            }),
        ),
        (error: unknown) =>
            error instanceof ApplicationProtocolError &&
            /manifest under another protocol/u.test(error.message),
    );
});

test("moved application heads and forged application evidence are refused", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "evidence");
    const store = new MovedHeadStore(databasePath);
    context.after(() => store.close());
    for (const failAfter of [0, 1]) {
        store.calls = 0;
        store.failAfter = failAfter;
        await assert.rejects(
            runCodingSupervisor(
                store,
                options(`application:moved-${failAfter}`, acceptAfterObserve("a")),
            ),
            (error: unknown) =>
                error instanceof ApplicationEvidenceError && /head moved/u.test(error.message),
        );
    }
    store.failAfter = Number.POSITIVE_INFINITY;
    const completed = await runCodingSupervisor(
        store,
        options("application:complete", acceptAfterObserve("a")),
    );
    const applicationId = deriveApplicationOwnerId("application:complete");
    assert.throws(() => inspectCodingSupervisorRun(store, "application:x"), TypeError);
    assert.throws(
        () => inspectCodingSupervisorRun(store, deriveApplicationOwnerId("application:absent")),
        (error: unknown) =>
            error instanceof ApplicationEvidenceError && /not retained/u.test(error.message),
    );
    const forge = (
        ownerId: string,
        step: string,
        body: RecordBody,
        schemaRef: string,
        causes: readonly RecordId[] = [],
    ): void => {
        const head = store.readOwner(ownerId).at(-1)?.envelope.record_id ?? null;
        const appended = store.appendApplicationRecord(
            ownerId,
            head,
            createApplicationAppendRequest(
                createApplicationAppendIntentId(ownerId, step),
                ownerId,
                body,
                schemaRef,
                causes,
            ),
            null,
        );
        assert.equal(appended.status, "appended");
    };
    const openedRecord = store.readRecord(completed.inspection.opened_record_id);
    const decisionRecord = store.readRecord(
        completed.inspection.decisions[0]?.record_id as RecordId,
    );
    const cutRecordId = store.readOwner(applicationId).at(-1)?.envelope.record_id as RecordId;
    // A record after the terminal cut.
    forge(applicationId, "late", { late: true }, config.traceSchemas.supervision, [cutRecordId]);
    assert.throws(
        () => inspectCodingSupervisorRun(store, applicationId),
        (error: unknown) =>
            error instanceof ApplicationEvidenceError &&
            /after its terminal cut/u.test(error.message),
    );
    // A first record that is not an opened supervision record, an opened record naming another
    // application, a decision out of round order, an unsupported record, and a manifest record
    // that does not follow the head.
    const wrongFirst = deriveApplicationOwnerId("application:wrong-first");
    forge(wrongFirst, "first", { forged: true }, "example.forged.v1");
    assert.throws(
        () => inspectCodingSupervisorRun(store, wrongFirst),
        (error: unknown) =>
            error instanceof ApplicationEvidenceError && /unexpected schema/u.test(error.message),
    );
    const foreign = deriveApplicationOwnerId("application:foreign");
    forge(foreign, "opened", { ...openedRecord?.body }, config.traceSchemas.supervision);
    assert.throws(
        () => inspectCodingSupervisorRun(store, foreign),
        (error: unknown) =>
            error instanceof ApplicationEvidenceError && /another application/u.test(error.message),
    );
    const outOfOrder = deriveApplicationOwnerId("application:out-of-order");
    forge(
        outOfOrder,
        "opened",
        {
            ...openedRecord?.body,
            application_id: outOfOrder,
            command_id: "application:out-of-order",
        },
        config.traceSchemas.supervision,
    );
    forge(
        outOfOrder,
        "decision",
        { ...decisionRecord?.body, application_id: outOfOrder, round: 2 },
        config.traceSchemas.supervision,
        [store.readOwner(outOfOrder)[0]?.envelope.record_id as RecordId],
    );
    assert.throws(
        () => inspectCodingSupervisorRun(store, outOfOrder),
        (error: unknown) =>
            error instanceof ApplicationEvidenceError && /round order/u.test(error.message),
    );
    const unsupported = deriveApplicationOwnerId("application:unsupported");
    forge(
        unsupported,
        "opened",
        {
            ...openedRecord?.body,
            application_id: unsupported,
            command_id: "application:unsupported",
        },
        config.traceSchemas.supervision,
    );
    forge(unsupported, "cut", { cut_id: "cut:forged" }, kernelProtocolConfig.queries.cutSchemaRef, [
        store.readOwner(unsupported)[0]?.envelope.record_id as RecordId,
    ]);
    assert.throws(
        () => inspectCodingSupervisorRun(store, unsupported),
        (error: unknown) =>
            error instanceof ApplicationEvidenceError && /unsupported record/u.test(error.message),
    );
    const detached = deriveApplicationOwnerId("application:detached");
    forge(
        detached,
        "opened",
        { ...openedRecord?.body, application_id: detached, command_id: "application:detached" },
        config.traceSchemas.supervision,
    );
    // An opened record that claims worker handles another application opened.
    assert.throws(
        () => inspectCodingSupervisorRun(store, detached),
        (error: unknown) =>
            error instanceof ApplicationEvidenceError && /did not open/u.test(error.message),
    );
    const malformedDecision = deriveApplicationOwnerId("application:malformed-decision");
    forge(
        malformedDecision,
        "opened",
        {
            ...openedRecord?.body,
            application_id: malformedDecision,
            command_id: "application:malformed-decision",
        },
        config.traceSchemas.supervision,
    );
    forge(
        malformedDecision,
        "decision",
        {
            ...decisionRecord?.body,
            application_id: malformedDecision,
            evidence: { kind: "inject", injection_record_id: cutRecordId },
        },
        config.traceSchemas.supervision,
        [store.readOwner(malformedDecision)[0]?.envelope.record_id as RecordId],
    );
    assert.throws(
        () => inspectCodingSupervisorRun(store, malformedDecision),
        (error: unknown) =>
            error instanceof ApplicationEvidenceError &&
            /decision evidence is malformed/u.test(error.message),
    );
    const witness = store.readRecord(ROOT_WITNESS_ID as RecordId);
    assert.notEqual(witness, undefined);
    assert.equal(store.verifyIntegrity().ok, true);
});

test("policy decisions and observations round-trip through the supervision record codec", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "codec");
    using store = new SQLiteTraceStore(databasePath);
    const cited = appendOwnerRecord(store, "worker:notes", "n0") as RecordId;
    const decisions: readonly CodingSupervisorDecision[] = [
        { kind: "observe" },
        { cited_record_ids: [cited], data: { hint: "again" }, kind: "inject", worker_id: "b" },
    ];
    // An injection after the worker started stays pending and is not consumed.
    const receipt = await runCodingSupervisor(
        store,
        options("application:codec", scripted(decisions, "a")),
    );
    const b = receipt.inspection.workers[1]?.attempts[0]?.inspection;
    assert.equal(b?.injections[0]?.consumed, false);
    assert.equal(b?.consumed_context, null);
    assert.deepEqual(
        receipt.inspection.decisions.map((decision) => decision.decision),
        [...decisions, { kind: "accept", worker_id: "a" }],
    );
    assert.ok(receipt.inspection.decisions.every((decision) => decision.supervisor_id === LEAD));
    assert.ok(
        receipt.inspection.decisions[1]?.observations.every(
            (observation) => observation.delivered_cursor.positions.length === 2,
        ),
    );
});
