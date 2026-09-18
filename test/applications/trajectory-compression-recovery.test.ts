import assert from "node:assert/strict";
import { test } from "node:test";

import {
    ApplicationBudgetError,
    ApplicationEvidenceError,
    ApplicationVerificationError,
    acknowledgeDurableTaskCancellation,
    createStaticProvider,
    DelegationCommandConflictError,
    DelegationStatusError,
    deriveApplicationOwnerId,
    inspectReplaySession,
    inspectTrajectoryCompression,
    type ModelRequest,
    REPLAY_LEASE_LIMITS,
    type ReplaySessionContext,
    ReplaySessionInterruptedError,
    type RunTrajectoryCompressionOptions,
    requestDurableTaskCancellation,
    runTrajectoryCompression,
    SQLiteTraceStore,
    type TrajectoryCompressionProgram,
    type TrajectoryVerifierContext,
} from "../../src/index.ts";
import {
    compressionOptions,
    compressionProtocolWithBudgets,
    compressorOf,
    exploreWorkflow,
    forkAt,
    notifyHandlers,
    type StageProvider,
    sameResult,
    stageProvider,
    verifierOf,
} from "./compression-fixtures.ts";

const SESSION_SCHEMA = "shepherd.replay.session.v1";

function ownerCount(store: SQLiteTraceStore, commandId: string): number {
    return store.readOwner(deriveApplicationOwnerId(commandId)).length;
}

/** Controllable lease clock: `expire()` moves past every lease opened so far. */
function leaseClock(): { readonly clock: () => number; readonly expire: () => void } {
    let now = 1_000_000;
    return {
        clock: () => now,
        expire: () => {
            now += REPLAY_LEASE_LIMITS.leaseMilliseconds + 1;
        },
    };
}

type DurableStart = {
    readonly claimId: string;
    readonly fencingToken: number;
    readonly recordId: string;
    readonly runId: string;
};

/**
 * Store simulating process death: it throws once on the Nth replay-session terminal append
 * (leaving that session non-terminal under its lease), on the Nth durable child terminal append
 * (leaving that child running), or on the first application append matching a predicate. It
 * reports every durable child start with its claim authority.
 */
class DyingStore extends SQLiteTraceStore {
    childTerminals = 0;
    crashWhen: ((body: Record<string, unknown>) => boolean) | null = null;
    dieAtChildTerminal = 0;
    dieAtTerminal = 0;
    readonly starts: DurableStart[] = [];
    terminals = 0;

    override appendReplaySessionRecord(
        ...args: Parameters<SQLiteTraceStore["appendReplaySessionRecord"]>
    ): ReturnType<SQLiteTraceStore["appendReplaySessionRecord"]> {
        if (args[3].terminal) {
            this.terminals += 1;
            if (this.terminals === this.dieAtTerminal) {
                throw new Error("simulated process death");
            }
        }
        return super.appendReplaySessionRecord(...args);
    }

    override appendDurableExecutionStart(
        ...args: Parameters<SQLiteTraceStore["appendDurableExecutionStart"]>
    ): ReturnType<SQLiteTraceStore["appendDurableExecutionStart"]> {
        const appended = super.appendDurableExecutionStart(...args);
        if (appended.status === "committed") {
            const [runId, claimId, fencingToken] = args;
            this.starts.push({
                claimId,
                fencingToken,
                recordId: appended.receipt.record_ids[0] as string,
                runId,
            });
        }
        return appended;
    }

    override appendDurableExecutionTerminal(
        ...args: Parameters<SQLiteTraceStore["appendDurableExecutionTerminal"]>
    ): ReturnType<SQLiteTraceStore["appendDurableExecutionTerminal"]> {
        this.childTerminals += 1;
        if (this.childTerminals === this.dieAtChildTerminal) {
            throw new Error("simulated process death");
        }
        return super.appendDurableExecutionTerminal(...args);
    }

    override appendApplicationRecord(
        ...args: Parameters<SQLiteTraceStore["appendApplicationRecord"]>
    ): ReturnType<SQLiteTraceStore["appendApplicationRecord"]> {
        const body = args[2].batch.groups[0]?.records[0]?.body as Record<string, unknown>;
        if (this.crashWhen?.(body)) {
            this.crashWhen = null;
            throw new Error("simulated process death");
        }
        return super.appendApplicationRecord(...args);
    }
}

/** Settles a dead child through the documented cancellation path with its claim authority. */
function cancelChild(store: DyingStore, start: DurableStart): void {
    const command = requestDurableTaskCancellation(store, {
        commandId: `cancel:${start.runId}`,
        expectedLifecycleRecordId: start.recordId,
        fencingToken: start.fencingToken,
        reason: "compression process died",
        runId: start.runId,
    });
    const cancelled = acknowledgeDurableTaskCancellation(store, {
        cancelCommandRecordId: command.record_id,
        claimId: start.claimId,
        expectedLifecycleRecordId: start.recordId,
        fencingToken: start.fencingToken,
        runId: start.runId,
    });
    assert.equal(cancelled.execution.outcome.outcome.status, "cancelled");
}

test("a rerun under another supervisor is refused by the delegation seam without a record", async () => {
    using store = new DyingStore();
    const commandId = "application:compression:other-supervisor";
    const options = compressionOptions(commandId);
    store.crashWhen = (body) => body.status === "proposed";
    await assert.rejects(runTrajectoryCompression(store, options), /simulated process death/u);
    const records = ownerCount(store, commandId);
    assert.equal(records, 1);
    for (let attempt = 0; attempt < 2; attempt += 1) {
        await assert.rejects(
            runTrajectoryCompression(store, { ...options, supervisorId: "supervisor:intruder" }),
            DelegationCommandConflictError,
        );
        assert.equal(ownerCount(store, commandId), records);
    }
    // The original supervisor still converges on the retained compressor child.
    const { inspection } = await runTrajectoryCompression(store, options);
    assert.equal(inspection.compression.outcome?.outcome, "pruned");
    assert.equal(store.verifyIntegrity().ok, true);
});

test("a child left running by a dead process fails closed until cancellation settles it", async () => {
    for (const [label, dieAt, before, ErrorClass, code] of [
        ["compressor", 1, 1, ApplicationEvidenceError, "APPLICATION_EVIDENCE_INVALID"],
        ["verifier", 2, 3, ApplicationVerificationError, "APPLICATION_VERIFICATION_FAILED"],
    ] as const) {
        using store = new DyingStore();
        const commandId = `application:compression:dead-${label}`;
        const verifierContexts: TrajectoryVerifierContext[] = [];
        const options = compressionOptions(commandId, {
            verifier: verifierOf(sameResult, verifierContexts),
        });
        store.dieAtChildTerminal = dieAt;
        // The death inside the child is not a child failure: nothing is retained for it.
        await assert.rejects(runTrajectoryCompression(store, options), /process death/u, label);
        assert.equal(ownerCount(store, commandId), before, label);
        for (let attempt = 0; attempt < 2; attempt += 1) {
            await assert.rejects(
                runTrajectoryCompression(store, options),
                (error: unknown) =>
                    error instanceof DelegationStatusError && error.status === "running",
                label,
            );
            assert.equal(ownerCount(store, commandId), before, label);
        }
        const contexts = verifierContexts.length;
        cancelChild(store, store.starts[dieAt - 1] as DurableStart);
        // A child the cancellation path settled has terminally failed: its candidate is rejected.
        await assert.rejects(
            runTrajectoryCompression(store, options),
            (error: unknown) =>
                error instanceof ErrorClass &&
                error.code === code &&
                /ended cancelled/u.test(String((error.cause as Error).message)),
            label,
        );
        const inspection = inspectTrajectoryCompression(store, deriveApplicationOwnerId(commandId));
        assert.equal(inspection.compression.outcome?.status, "rejected", label);
        assert.equal(inspection.compression.outcome?.failure?.code, code, label);
        assert.equal(verifierContexts.length, contexts, label);
        const records = ownerCount(store, commandId);
        await assert.rejects(runTrajectoryCompression(store, options), ErrorClass, label);
        assert.equal(ownerCount(store, commandId), records, label);
        assert.equal(store.verifyIntegrity().ok, true);
    }
});

test("a source over the provider-call budget is refused before the opened record and reused", async () => {
    const run = async (store: SQLiteTraceStore, base: StageProvider, budget?: number) =>
        runTrajectoryCompression(
            store,
            compressionOptions("application:compression:source-budget", {
                ...(budget === undefined
                    ? {}
                    : { protocol: compressionProtocolWithBudgets({ maxProviderCalls: budget }) }),
                workflow: {
                    handlers: notifyHandlers,
                    program: exploreWorkflow(),
                    programId: "workflow:explore-answer.v1",
                    provider: base,
                },
            }),
        );
    using clean = new SQLiteTraceStore();
    const cleanBase = stageProvider("base");
    const expected = await run(clean, cleanBase);
    using store = new SQLiteTraceStore();
    const base = stageProvider("base");
    // The source makes four live provider calls: a budget of three refuses it once measured.
    await assert.rejects(
        run(store, base, 3),
        (error: unknown) =>
            error instanceof ApplicationBudgetError &&
            error.code === "APPLICATION_BUDGET_EXCEEDED" &&
            /4 measured live provider call\(s\)/u.test(error.message),
    );
    assert.equal(ownerCount(store, "application:compression:source-budget"), 0);
    assert.equal(base.calls.length, 4);
    // A corrected budget reuses the retained source: the total calls equal a clean run's.
    const { inspection } = await run(store, base);
    assert.equal(inspection.source_session_id, expected.inspection.source_session_id);
    assert.deepEqual(base.calls, cleanBase.calls);
    assert.equal(inspection.outcome?.outcome, "pruned");
});

test("an interrupted compressed session under an expired lease is restored as not admissible", async () => {
    using store = new DyingStore();
    const commandId = "application:compression:interrupted-compressed";
    const lease = leaseClock();
    const verifierContexts: TrajectoryVerifierContext[] = [];
    const options = compressionOptions(commandId, {
        clock: lease.clock,
        protocol: compressionProtocolWithBudgets({ bestOfN: 0 }),
        verifier: verifierOf(sameResult, verifierContexts),
    });
    // Replay terminals: source (1), rewind (2), compressed suffix (3).
    store.dieAtTerminal = 3;
    await assert.rejects(runTrajectoryCompression(store, options), /process death/u);
    const records = ownerCount(store, commandId);
    await assert.rejects(
        runTrajectoryCompression(store, options),
        (error: unknown) =>
            error instanceof ReplaySessionInterruptedError && error.classification === "running",
    );
    assert.equal(ownerCount(store, commandId), records);
    lease.expire();
    const { inspection, manifest } = await runTrajectoryCompression(store, options);
    const settled = inspection.compression.outcome;
    assert.equal(settled?.outcome, "restored");
    assert.equal(
        settled?.reason,
        "the compressed session did not finish with strictly fewer steps than the original",
    );
    assert.equal(settled?.verdict, null);
    assert.equal(settled?.verifier_handle_id, null);
    assert.deepEqual(verifierContexts, []);
    const compressed = inspectReplaySession(store, {
        clock: lease.clock,
        sessionId: settled?.session_id as string,
    });
    assert.equal(compressed.terminal, null);
    assert.equal(compressed.classification, "interrupted");
    assert.equal(settled?.step_count, compressed.steps.length);
    assert.equal(inspection.outcome?.result_session_id, settled?.restoration_session_id);
    assert.equal(inspection.outcome?.step_count_ratio, 1);
    assert.equal(
        manifest.artifacts.find((artifact) => artifact.role === "compressed_session")?.record_id,
        compressed.head_record_id,
    );
    const repeated = await runTrajectoryCompression(store, options);
    assert.deepEqual(repeated.manifest, manifest);
    assert.equal(store.verifyIntegrity().ok, true);
});

test("an interrupted restoration or control session under an expired lease rejects its candidate", async () => {
    for (const [label, dieAt, bestOfN, verdict] of [
        ["restoration", 4, 0, "rejected"],
        ["control", 4, 1, "accepted"],
    ] as const) {
        using store = new DyingStore();
        const commandId = `application:compression:interrupted-${label}`;
        const lease = leaseClock();
        const options = compressionOptions(commandId, {
            clock: lease.clock,
            protocol: compressionProtocolWithBudgets({ bestOfN }),
            verifier: verifierOf((context) => ({ ...sameResult(context), verdict })),
        });
        store.dieAtTerminal = dieAt;
        await assert.rejects(runTrajectoryCompression(store, options), /process death/u, label);
        const records = ownerCount(store, commandId);
        await assert.rejects(
            runTrajectoryCompression(store, options),
            ReplaySessionInterruptedError,
            label,
        );
        assert.equal(ownerCount(store, commandId), records, label);
        lease.expire();
        await assert.rejects(
            runTrajectoryCompression(store, options),
            (error: unknown) =>
                error instanceof ApplicationEvidenceError &&
                error.cause instanceof ReplaySessionInterruptedError &&
                /was interrupted before its terminal record/u.test(error.message),
            label,
        );
        const inspection = inspectTrajectoryCompression(store, deriveApplicationOwnerId(commandId));
        const rejected =
            label === "control" ? inspection.controls[0]?.outcome : inspection.compression.outcome;
        assert.equal(rejected?.status, "rejected", label);
        assert.equal(rejected?.failure?.code, "APPLICATION_EVIDENCE_INVALID", label);
        assert.equal(inspection.outcome, null, label);
        const retained = ownerCount(store, commandId);
        await assert.rejects(runTrajectoryCompression(store, options), ApplicationEvidenceError);
        assert.equal(ownerCount(store, commandId), retained, label);
        assert.equal(store.verifyIntegrity().ok, true);
    }
});

test("a session whose measured calls overrun its projection is refused right after it", async () => {
    const cases: readonly [
        string,
        Partial<RunTrajectoryCompressionOptions>,
        number,
        (inspection: ReturnType<typeof inspectTrajectoryCompression>) => void,
    ][] = [
        [
            // Source 2, compressor 1, and a guided suffix projected at 1 but measured at 4.
            "compressed",
            {
                compressor: compressorOf(citing(1, [0])),
                protocol: compressionProtocolWithBudgets({ bestOfN: 0, maxProviderCalls: 4 }),
            },
            7,
            (inspection) => {
                assert.equal(inspection.compression.rewound?.status, "rewound");
                assert.equal(inspection.compression.outcome, null);
            },
        ],
        [
            // An inadmissible suffix (1) restored through a suffix projected at 1 but measured at 4.
            "restoration",
            {
                compressor: compressorOf(forkAt(1, null)),
                protocol: compressionProtocolWithBudgets({ bestOfN: 0, maxProviderCalls: 5 }),
                workflow: overrunOptions(countingProvider(3)),
            },
            8,
            (inspection) => assert.equal(inspection.compression.outcome, null),
        ],
        [
            // A control rerun projected at 2 but measured at 5.
            "control",
            {
                compressor: compressorOf(forkAt(1, null)),
                controlProvider: () => stageProvider("more"),
                protocol: compressionProtocolWithBudgets({ bestOfN: 1, maxProviderCalls: 7 }),
            },
            10,
            (inspection) => {
                assert.equal(inspection.compression.outcome?.outcome, "restored");
                assert.equal(inspection.controls[0]?.outcome, null);
            },
        ],
    ];
    for (const [label, overrides, spent, check] of cases) {
        using store = new SQLiteTraceStore();
        const commandId = `application:compression:overrun-${label}`;
        const options = compressionOptions(commandId, {
            workflow: overrunOptions(stageProvider("base")),
            ...overrides,
        });
        const measured = (error: unknown) =>
            error instanceof ApplicationBudgetError &&
            new RegExp(`: ${spent} measured live provider call\\(s\\) through session`, "u").test(
                error.message,
            );
        await assert.rejects(runTrajectoryCompression(store, options), measured, label);
        const sessions = store.listOwnersBySchema(SESSION_SCHEMA, 32, 0).length;
        const records = ownerCount(store, commandId);
        check(inspectTrajectoryCompression(store, deriveApplicationOwnerId(commandId)));
        // Every rerun re-measures the retained session and refuses the same way.
        await assert.rejects(runTrajectoryCompression(store, options), measured, label);
        assert.equal(ownerCount(store, commandId), records, label);
        assert.equal(store.listOwnersBySchema(SESSION_SCHEMA, 32, 0).length, sessions, label);
    }
});

/** Proposal forking at a boundary with a hint citing the given steps. */
function citing(stepIndex: number, cited: readonly number[]) {
    return (context: Parameters<ReturnType<typeof forkAt>>[0]) => ({
        ...forkAt(stepIndex)(context),
        hint: { cited_step_indices: cited, text: "answer after one step" },
    });
}

function request(stage: string): ModelRequest {
    return {
        input: { prior: null, stage },
        instruction: `perform ${stage}`,
        outputSchema: { type: "object" },
    };
}

/**
 * Two-step workflow (a, b) that issues three extra provider calls when guided by a hint, or when
 * unguided and step b answered with a `more` text.
 */
function overrunWorkflow(): TrajectoryCompressionProgram {
    return (guidance) => async (context: ReplaySessionContext) => {
        const a = await context.invokeProvider(request("a"));
        const b = await context.invokeProvider(request("b"), { dependsOn: [a.handle] });
        const more = (b.response.output as { readonly text: string }).text.startsWith("more");
        const extras = (guidance === null ? more : guidance.hint !== null) ? 3 : 0;
        for (let index = 0; index < extras; index += 1) {
            await context.invokeProvider(request(`extra-${index}`), { dependsOn: [] });
        }
        return b.response.output;
    };
}

function overrunOptions(provider: StageProvider): RunTrajectoryCompressionOptions["workflow"] {
    return { program: overrunWorkflow(), programId: "workflow:overrun.v1", provider };
}

/** Provider answering `more:<stage>` from its Nth invocation (zero-based) onward. */
function countingProvider(moreFrom: number): StageProvider {
    const { descriptor } = createStaticProvider({
        descriptor: { id: "provider:counting", model: "fixture-v1" },
        exchanges: [],
    });
    const calls: string[] = [];
    return Object.freeze({
        calls,
        descriptor,
        invoke: async (modelRequest: ModelRequest) => {
            const stage = (modelRequest.input as { readonly stage: string }).stage;
            const label = calls.length >= moreFrom ? "more" : "base";
            calls.push(stage);
            return {
                output: { text: `${label}:${stage}` },
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
}
