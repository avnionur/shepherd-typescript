import assert from "node:assert/strict";
import { test } from "node:test";

import {
    ApplicationEvidenceError,
    deriveApplicationOwnerId,
    exportTreeRlTrainingBatch,
    inspectTreeRlRun,
    type ModelProvider,
    REPLAY_LEASE_LIMITS,
    ReplaySessionInterruptedError,
    runTreeRlRollouts,
    SQLiteTraceStore,
    type TreeRlProviderContext,
} from "../../src/index.ts";
import {
    cassette,
    type RootLabels,
    recordRoots,
    rewardOf,
    treeRlOptions,
} from "./tree-rl-fixtures.ts";

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

/** Provider factory counting every live invocation across the rollouts it builds. */
function countingFactory(labels: RootLabels): ((
    context: TreeRlProviderContext,
) => ModelProvider) & {
    calls: number;
} {
    const factory = Object.assign(
        (context: TreeRlProviderContext): ModelProvider => {
            const root = labels.get(context.root_session_id) as string;
            const built = cassette(
                `s${context.seed}`,
                context.fork_point.step_index,
                `${root}:s${context.seed}`,
                root,
                context.tool_call,
            );
            return Object.freeze({
                descriptor: built.descriptor,
                invoke: (...args: Parameters<ModelProvider["invoke"]>) => {
                    factory.calls += 1;
                    return built.invoke(...args);
                },
            });
        },
        { calls: 0 },
    );
    return factory;
}

test("a crash at the opened, a root, a rollout, the batch, or the manifest append converges on rerun", async () => {
    const commandId = "application:tree-rl:append-crash";
    using clean = new SQLiteTraceStore();
    const cleanLabels = await recordRoots(clean);
    const cleanFactory = countingFactory(cleanLabels);
    const expected = await runTreeRlRollouts(
        clean,
        treeRlOptions(commandId, cleanLabels, {
            clock: () => 5_000,
            concurrency: 1,
            provider: cleanFactory,
            reward: rewardOf(cleanLabels),
        }),
    );
    assert.equal(cleanFactory.calls, 16);
    // Application appends: opened (1), roots (2-3), rollouts (4-7), batch (8), manifest (9).
    for (const [label, append, rewardCalls] of [
        ["opened", 1, 6],
        ["first root", 2, 7],
        ["second root", 3, 7],
        ["first rollout", 4, 7],
        ["later rollout", 6, 7],
        ["batch", 8, 6],
        ["manifest", 9, 6],
    ] as const) {
        using store = new DyingStore();
        const labels = await recordRoots(store);
        const factory = countingFactory(labels);
        const reward = rewardOf(labels);
        const options = treeRlOptions(commandId, labels, {
            clock: () => 5_000,
            concurrency: 1,
            provider: factory,
            reward,
        });
        store.dieAtApplicationAppend = append;
        await assert.rejects(runTreeRlRollouts(store, options), /process death/u, label);
        const receipt = await runTreeRlRollouts(store, options);
        // No rollout session re-executed: the live calls equal the clean run's.
        assert.equal(factory.calls, cleanFactory.calls, label);
        // The reward is re-invoked only for a root or rollout whose record was never retained.
        assert.equal(reward.contexts.length, rewardCalls, label);
        assert.deepEqual(receipt, expected, label);
        assert.deepEqual(
            exportTreeRlTrainingBatch(store, deriveApplicationOwnerId(commandId)),
            expected.batch,
            label,
        );
        assert.equal(store.verifyIntegrity().ok, true, label);
    }
});

test("a crash while rollouts run concurrently converges on the serial run's evidence", async () => {
    const commandId = "application:tree-rl:concurrent-crash";
    using clean = new SQLiteTraceStore();
    const cleanLabels = await recordRoots(clean);
    const expected = await runTreeRlRollouts(
        clean,
        treeRlOptions(commandId, cleanLabels, { clock: () => 5_000, concurrency: 1 }),
    );
    for (const append of [3, 5, 7]) {
        using store = new DyingStore();
        const labels = await recordRoots(store);
        const factory = countingFactory(labels);
        const options = treeRlOptions(commandId, labels, {
            clock: () => 5_000,
            concurrency: 4,
            provider: factory,
            reward: rewardOf(labels),
        });
        store.dieAtApplicationAppend = append;
        await assert.rejects(runTreeRlRollouts(store, options), /process death/u);
        assert.deepEqual(await runTreeRlRollouts(store, options), expected, String(append));
        // Terminal rollout sessions are reused: every rollout ran live exactly once.
        assert.equal(factory.calls, 16, String(append));
    }
});

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

test("a process death inside a rollout session refuses while its lease is live and is retained as failed once it expires", async () => {
    using store = new DyingStore();
    const lease = leaseClock();
    const commandId = "application:tree-rl:interrupted";
    const labels = await recordRoots(store);
    const factory = countingFactory(labels);
    const reward = rewardOf(labels);
    const options = treeRlOptions(commandId, labels, {
        clock: lease.clock,
        concurrency: 1,
        provider: factory,
        reward,
    });
    // Terminal appends: the roots (already recorded) are not counted; rollout 3 dies.
    store.terminals = 0;
    store.dieAtTerminal = 3;
    await assert.rejects(runTreeRlRollouts(store, options), /process death/u);
    const applicationId = deriveApplicationOwnerId(commandId);
    const records = store.readOwner(applicationId).length;
    assert.equal(records, 5);
    // While the dead writer's lease is live nothing is written.
    await assert.rejects(
        runTreeRlRollouts(store, options),
        (error: unknown) =>
            error instanceof ReplaySessionInterruptedError && error.classification === "running",
    );
    assert.equal(store.readOwner(applicationId).length, records);
    lease.expire();
    const { batch, inspection } = await runTreeRlRollouts(store, options);
    const interrupted = inspection.rollouts[2]?.record;
    assert.equal(interrupted?.status, "failed");
    assert.equal(interrupted?.failure?.code, "APPLICATION_EVIDENCE_INVALID");
    assert.equal(
        interrupted?.failure?.reason,
        "the rollout session was interrupted before its terminal record",
    );
    assert.equal(interrupted?.reward, null);
    assert.equal(interrupted?.cost.provider_calls, 4);
    assert.equal(
        inspection.rollouts.filter((entry) => entry.record?.status === "completed").length,
        3,
    );
    assert.equal(batch.line_count, 5);
    assert.equal(
        batch.lines.some((line) => line.rollout_id === inspection.rollouts[2]?.rollout_id),
        false,
    );
    // Later reruns return the retained run without replaying or scoring.
    const calls = factory.calls;
    const scored = reward.contexts.length;
    const repeated = await runTreeRlRollouts(store, options);
    assert.deepEqual(repeated.inspection, inspection);
    assert.equal(factory.calls, calls);
    assert.equal(reward.contexts.length, scored);
    assert.equal(store.verifyIntegrity().ok, true);
});

test("inspection and export refuse an unretained application or a run without a batch", async () => {
    using store = new DyingStore();
    const labels = await recordRoots(store);
    const commandId = "application:tree-rl:partial";
    store.dieAtApplicationAppend = 3;
    await assert.rejects(
        runTreeRlRollouts(store, treeRlOptions(commandId, labels, { concurrency: 1 })),
        /process death/u,
    );
    const applicationId = deriveApplicationOwnerId(commandId);
    const partial = inspectTreeRlRun(store, applicationId);
    assert.equal(partial.batch, null);
    assert.equal(partial.manifest, null);
    assert.equal(partial.cut_id, null);
    assert.equal(partial.manifest_record_id, null);
    // One root is retained; rollouts are planned only once every root is.
    assert.equal(partial.roots.length, 1);
    assert.equal(partial.roots[0]?.status, "completed");
    assert.deepEqual(partial.rollouts, []);
    assert.throws(() => exportTreeRlTrainingBatch(store, applicationId), ApplicationEvidenceError);
    assert.throws(
        () => inspectTreeRlRun(store, deriveApplicationOwnerId("application:tree-rl:none")),
        ApplicationEvidenceError,
    );
    assert.throws(() => inspectTreeRlRun(store, "application:sha256:bad"), TypeError);
});
