import assert from "node:assert/strict";
import { test } from "node:test";

import {
    ApplicationEvidenceError,
    deriveApplicationOwnerId,
    inspectCounterfactualOptimization,
    inspectReplaySession,
    REPLAY_LEASE_LIMITS,
    ReplaySessionInterruptedError,
    type RunCounterfactualOptimizationOptions,
    runCounterfactualOptimization,
    SQLiteTraceStore,
} from "../../src/index.ts";
import {
    type KeyedProvider,
    keyedProvider,
    optimizerOptions,
    pass,
    providerCandidate,
    scriptedEvaluator,
} from "./counterfactual-fixtures.ts";

/**
 * Store that simulates process death: it throws on the Nth replay-session terminal append (leaving
 * that session without a terminal record and under its lease) or on the Nth application append.
 */
class DyingStore extends SQLiteTraceStore {
    applicationAppends = 0;
    dieAtApplicationAppend = 0;
    dieAtTerminal = 0;
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

    override appendApplicationRecord(
        ...args: Parameters<SQLiteTraceStore["appendApplicationRecord"]>
    ): ReturnType<SQLiteTraceStore["appendApplicationRecord"]> {
        this.applicationAppends += 1;
        if (this.applicationAppends === this.dieAtApplicationAppend) {
            throw new Error("simulated process death");
        }
        return super.appendApplicationRecord(...args);
    }
}

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

test("a process death inside a candidate branch is retained as an evidence failure once its lease expires", async () => {
    for (const [label, dieAtTerminal, baselines] of [
        ["branch", 2, []],
        ["full-replay", 3, ["full_replay"]],
    ] as const) {
        using store = new DyingStore();
        const commandId = `application:cro:interrupted:${label}`;
        const lease = leaseClock();
        const alt = keyedProvider("alt");
        const later = keyedProvider("later");
        const options = optimizerOptions(commandId, {
            baselines,
            candidates: [providerCandidate("dies", 0, alt), providerCandidate("later", 2, later)],
            clock: lease.clock,
        });
        store.dieAtTerminal = dieAtTerminal;
        await assert.rejects(runCounterfactualOptimization(store, options), /process death/u);
        const records = ownerCount(store, commandId);
        // While the dead writer's lease is live the session may still be held: nothing is retained.
        await assert.rejects(
            runCounterfactualOptimization(store, options),
            (error: unknown) =>
                error instanceof ReplaySessionInterruptedError &&
                error.classification === "running",
        );
        assert.equal(ownerCount(store, commandId), records);
        lease.expire();
        await assert.rejects(
            runCounterfactualOptimization(store, options),
            (error: unknown) =>
                error instanceof ApplicationEvidenceError &&
                error.code === "APPLICATION_EVIDENCE_INVALID" &&
                error.cause instanceof ReplaySessionInterruptedError &&
                /was interrupted before its terminal record/u.test(error.message),
        );
        const applicationId = deriveApplicationOwnerId(commandId);
        const inspection = inspectCounterfactualOptimization(store, applicationId);
        const [dies, unreached] = inspection.candidates;
        assert.equal(dies?.outcome?.status, "rejected", label);
        assert.equal(dies?.outcome?.failure?.code, "APPLICATION_EVIDENCE_INVALID");
        assert.equal(dies?.outcome?.evaluation, null);
        assert.equal(dies?.outcome?.baseline, null);
        assert.equal(dies?.outcome?.cost?.provider_calls, 2);
        assert.equal(
            inspectReplaySession(store, {
                clock: lease.clock,
                sessionId: dies?.outcome?.branch_session_id as string,
            }).terminal === null,
            label === "branch",
        );
        assert.equal(unreached?.proposed, null);
        assert.equal(inspection.promotion, null);
        // Later reruns re-raise the retained failure without replaying or writing.
        const calls = alt.calls.length;
        const retained = ownerCount(store, commandId);
        await assert.rejects(
            runCounterfactualOptimization(store, options),
            ApplicationEvidenceError,
        );
        assert.equal(ownerCount(store, commandId), retained);
        assert.equal(alt.calls.length, calls);
        assert.deepEqual(later.calls, []);
        assert.equal(store.verifyIntegrity().ok, true);
    }
});

test("a process death inside the baseline leaves no application record and recovers under a new command", async () => {
    using store = new DyingStore();
    const lease = leaseClock();
    const options = optimizerOptions("application:cro:baseline-death", {
        candidates: [providerCandidate("x", 0, keyedProvider("alt"))],
        clock: lease.clock,
    });
    store.dieAtTerminal = 1;
    await assert.rejects(runCounterfactualOptimization(store, options), /process death/u);
    lease.expire();
    await assert.rejects(
        runCounterfactualOptimization(store, options),
        (error: unknown) =>
            error instanceof ReplaySessionInterruptedError &&
            error.classification === "interrupted",
    );
    assert.equal(ownerCount(store, "application:cro:baseline-death"), 0);
    const { inspection } = await runCounterfactualOptimization(store, {
        ...options,
        commandId: "application:cro:baseline-death:2",
    });
    assert.equal(inspection.candidates[0]?.outcome?.status, "evaluated");
});

function crashOptions(
    commandId: string,
    providers: readonly KeyedProvider[],
): RunCounterfactualOptimizationOptions {
    const [base, first, second] = providers as [KeyedProvider, KeyedProvider, KeyedProvider];
    return optimizerOptions(commandId, {
        baseline: {
            program: optimizerOptions("unused").baseline.program,
            programId: "workflow:plan-draft-review.v1",
            provider: base,
        },
        baselines: ["full_replay"],
        candidates: [providerCandidate("first", 0, first), providerCandidate("second", 2, second)],
        clock: () => 5_000,
        evaluate: scriptedEvaluator({ first: pass(2), second: pass(1) }),
    });
}

test("a crash at the opened, a proposed, or the promotion append converges on rerun", async () => {
    const providers = () => ["base", "first", "second"].map((label) => keyedProvider(label));
    using clean = new SQLiteTraceStore();
    const cleanProviders = providers();
    const expected = await runCounterfactualOptimization(
        clean,
        crashOptions("application:cro:append-crash", cleanProviders),
    );
    const expectedCalls = cleanProviders.map((provider) => provider.calls.length);
    // Application appends: opened (1), proposed/outcome per candidate (2-5), promotion (6).
    for (const [label, append] of [
        ["opened", 1],
        ["proposed", 4],
        ["promotion", 6],
    ] as const) {
        using store = new DyingStore();
        const crashProviders = providers();
        const options = crashOptions("application:cro:append-crash", crashProviders);
        store.dieAtApplicationAppend = append;
        await assert.rejects(runCounterfactualOptimization(store, options), /process death/u);
        const { inspection, manifest } = await runCounterfactualOptimization(store, options);
        assert.deepEqual(
            crashProviders.map((provider) => provider.calls.length),
            expectedCalls,
            label,
        );
        assert.deepEqual(inspection, expected.inspection, label);
        assert.deepEqual(manifest, expected.manifest, label);
        assert.equal(
            store
                .readOwner(deriveApplicationOwnerId("application:cro:append-crash"))
                .filter((record) => (record.body as { status?: string }).status === "promoted")
                .length,
            1,
        );
        assert.equal(store.verifyIntegrity().ok, true);
    }
});
