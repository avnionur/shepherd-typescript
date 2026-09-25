import assert from "node:assert/strict";
import { test } from "node:test";

import {
    ApplicationEvidenceError,
    deriveApplicationOwnerId,
    inspectCounterfactualOptimization,
    REPLAY_LEASE_LIMITS,
    ReplaySessionInterruptedError,
    type RunCounterfactualOptimizationOptions,
    runCounterfactualOptimization,
    SQLiteTraceStore,
} from "../../src/index.ts";
import {
    counterfactualProtocolWith,
    labelMetric,
    optimizerOptions,
    providerEdit,
    providerRegistry,
    reflection,
    scriptedProposer,
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

function twoEdits(
    commandId: string,
    overrides: Partial<RunCounterfactualOptimizationOptions>,
    registry = providerRegistry(),
): RunCounterfactualOptimizationOptions {
    return optimizerOptions(
        commandId,
        {
            metric: labelMetric({ first: { "dev-1": 1, "dev-2": 1, "train-1": 1 } }),
            proposer: scriptedProposer([
                [
                    {
                        edits: [
                            providerEdit("first", 0, "first"),
                            providerEdit("later", 3, "later"),
                        ],
                        parent: null,
                        reflection: reflection(null),
                    },
                ],
            ]),
            protocol: counterfactualProtocolWith({ iterations: 1 }),
            ...overrides,
        },
        registry,
    );
}

test("a process death inside a candidate branch is retained as an evidence failure once its lease expires", async () => {
    // Terminals 1-6 are the baseline example sessions; 7 is the first branch, 8 its full replay.
    for (const [label, dieAtTerminal, baselines] of [
        ["branch", 7, []],
        ["full-replay", 8, ["full_replay"]],
    ] as const) {
        using store = new DyingStore();
        const commandId = `application:cro:interrupted:${label}`;
        const lease = leaseClock();
        const registry = providerRegistry();
        const options = twoEdits(commandId, { baselines, clock: lease.clock }, registry);
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
        const inspection = inspectCounterfactualOptimization(
            store,
            deriveApplicationOwnerId(commandId),
        );
        const [dies] = inspection.candidates;
        assert.equal(inspection.candidates.length, 1, label);
        assert.equal(dies?.status, "rejected");
        assert.equal(dies?.failure?.code, "APPLICATION_EVIDENCE_INVALID");
        assert.deepEqual(dies?.targeted, []);
        assert.equal(dies?.cost.provider_calls, 4);
        assert.equal(inspection.selection, null);
        // Later reruns re-raise the retained failure without replaying or writing.
        const calls = registry.get("first").calls.length;
        const retained = ownerCount(store, commandId);
        await assert.rejects(
            runCounterfactualOptimization(store, options),
            ApplicationEvidenceError,
        );
        assert.equal(ownerCount(store, commandId), retained);
        assert.equal(registry.get("first").calls.length, calls);
        assert.deepEqual(registry.get("later").calls, []);
        assert.equal(store.verifyIntegrity().ok, true);
    }
});

test("a process death inside a baseline session leaves no application record and recovers under a new command", async () => {
    using store = new DyingStore();
    const lease = leaseClock();
    const options = twoEdits("application:cro:baseline-death", { clock: lease.clock });
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
    assert.equal(inspection.candidates[0]?.status, "promoted");
});

test("a crash at the opened, proposal, outcome, or selection append converges on rerun", async () => {
    const commandId = "application:cro:append-crash";
    using clean = new SQLiteTraceStore();
    const cleanRegistry = providerRegistry();
    const expected = await runCounterfactualOptimization(
        clean,
        twoEdits(commandId, { baselines: ["full_replay"], clock: () => 5_000 }, cleanRegistry),
    );
    const callsOf = (registry: ReturnType<typeof providerRegistry>) =>
        [...registry.providers.entries()].map(([label, provider]) => [
            label,
            provider.calls.length,
        ]);
    // Application appends: opened (1), proposal (2), outcomes (3, 4), selection (5).
    for (const [label, append] of [
        ["opened", 1],
        ["proposal", 2],
        ["outcome", 4],
        ["selection", 5],
    ] as const) {
        using store = new DyingStore();
        const registry = providerRegistry();
        const options = twoEdits(
            commandId,
            { baselines: ["full_replay"], clock: () => 5_000 },
            registry,
        );
        store.dieAtApplicationAppend = append;
        await assert.rejects(runCounterfactualOptimization(store, options), /process death/u);
        const { inspection, manifest } = await runCounterfactualOptimization(store, options);
        assert.deepEqual(callsOf(registry), callsOf(cleanRegistry), label);
        assert.deepEqual(inspection, expected.inspection, label);
        assert.deepEqual(manifest, expected.manifest, label);
        assert.equal(store.verifyIntegrity().ok, true);
    }
});
