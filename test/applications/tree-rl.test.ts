import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
    APPLICATION_TREE_RL_BATCH_FORMATS,
    applicationProtocolId,
    canonicalizeRecord,
    deriveApplicationOwnerId,
    exportTreeRlTrainingBatch,
    inspectApplicationManifest,
    inspectReplaySession,
    inspectTreeRlRun,
    runTreeRlRollouts,
    SQLiteTraceStore,
    selectTreeRlForkPoints,
    type TreeRlRunReceipt,
} from "../../src/index.ts";
import {
    providerFactory,
    recordSource,
    rewardOf,
    treeRlOptions,
    treeRlProtocol,
} from "./tree-rl-fixtures.ts";

async function runOnce(commandId: string): Promise<{
    readonly receipt: TreeRlRunReceipt;
    readonly store: SQLiteTraceStore;
}> {
    const store = new SQLiteTraceStore();
    const sourceSessionId = await recordSource(store);
    const receipt = await runTreeRlRollouts(store, treeRlOptions(commandId, sourceSessionId));
    return { receipt, store };
}

test("fork-point selection is a deterministic pure function of the retained session", async () => {
    using store = new SQLiteTraceStore();
    const sessionId = await recordSource(store);
    const records = store.readOwner(sessionId).length;
    const all = selectTreeRlForkPoints(store, { maxForkPoints: 32, minDependents: 0, sessionId });
    const source = inspectReplaySession(store, { sessionId });
    assert.deepEqual(
        all.map((point) => [point.step_index, point.dependents]),
        [
            [0, 3],
            [1, 2],
            [2, 1],
            [3, 0],
            [4, 0],
        ],
    );
    assert.equal(all[0]?.prefix_id, null);
    assert.equal(all[1]?.prefix_id, source.steps[0]?.prefix_id);
    assert.equal(all[4]?.prefix_id, source.steps[3]?.prefix_id);
    // The dependent-count minimum filters, and qualifying steps are taken in index order up to the
    // bound.
    const two = selectTreeRlForkPoints(store, { maxForkPoints: 32, minDependents: 2, sessionId });
    assert.deepEqual(
        two.map((point) => point.step_index),
        [0, 1],
    );
    const bounded = selectTreeRlForkPoints(store, {
        clock: () => 1,
        maxForkPoints: 2,
        minDependents: 0,
        sessionId,
    });
    assert.deepEqual(bounded, all.slice(0, 2));
    assert.deepEqual(
        selectTreeRlForkPoints(store, { maxForkPoints: 1, minDependents: 4, sessionId }),
        [],
    );
    assert.deepEqual(
        selectTreeRlForkPoints(store, { maxForkPoints: 32, minDependents: 0, sessionId }),
        all,
    );
    assert.equal(store.readOwner(sessionId).length, records);
    assert.ok(Object.isFrozen(all) && Object.isFrozen(all[0]));
});

test("branched rollouts yield exact advantages and a canonical jsonl_v1 batch", async () => {
    const { receipt, store } = await runOnce("application:tree-rl:exact");
    using _store = store;
    const { batch, inspection, manifest } = receipt;
    const applicationId = deriveApplicationOwnerId("application:tree-rl:exact");
    assert.equal(inspection.application_id, applicationId);
    assert.equal(inspection.kind, "tree_rl");
    assert.equal(inspection.protocol_id, applicationProtocolId(treeRlProtocol()));
    assert.deepEqual(
        inspection.fork_points.map((point) => [point.step_index, point.dependents]),
        [
            [0, 3],
            [1, 2],
            [2, 1],
        ],
    );
    assert.deepEqual(inspection.seeds, [3, 5]);
    assert.deepEqual(inspection.baselines, []);
    assert.equal(inspection.rollouts.length, 6);
    assert.deepEqual(
        inspection.rollouts.map((entry) => [entry.fork_point.step_index, entry.branch, entry.seed]),
        [
            [0, 0, 3],
            [0, 1, 5],
            [1, 0, 3],
            [1, 1, 5],
            [2, 0, 3],
            [2, 1, 5],
        ],
    );
    for (const entry of inspection.rollouts) {
        assert.equal(entry.record?.status, "completed");
        assert.equal(entry.record?.failure, null);
        assert.equal(entry.record?.step_count, 5);
        // Every step from the fork point on runs live under the rollout's own cassette.
        assert.equal(entry.record?.cost.provider_calls, 5 - entry.fork_point.step_index);
        const rollout = inspectReplaySession(store, { sessionId: entry.replay_session_id });
        assert.equal(rollout.origin?.target_step_count, entry.fork_point.step_index);
        assert.deepEqual(rollout.origin?.changes, ["provider"]);
        assert.equal(
            rollout.steps.filter((step) => step.source === "live").length,
            5 - entry.fork_point.step_index,
        );
        assert.deepEqual(
            (rollout.terminal?.result?.value as { answer: unknown } | undefined)?.answer,
            {
                text: `s${entry.seed}:answer`,
            },
        );
    }
    // Means over completed rollouts: fork 0 → 2, fork 1 → 6, fork 2 → 1, overall → 3.
    assert.deepEqual(
        batch.lines.map((line) => [
            line.reward,
            line.intra_branch_advantage,
            line.inter_branch_advantage,
        ]),
        [
            [1, -1, -1],
            [3, 1, -1],
            [4, -2, 3],
            [8, 2, 3],
            [0, -1, -2],
            [2, 1, -2],
        ],
    );
    assert.equal(batch.format, APPLICATION_TREE_RL_BATCH_FORMATS[0]);
    assert.equal(batch.line_count, 6);
    assert.equal(batch.baseline, null);
    const [first] = batch.lines;
    assert.deepEqual(Object.keys(first ?? {}).sort(), [
        "fork_point",
        "inter_branch_advantage",
        "intra_branch_advantage",
        "replay_session_id",
        "reward",
        "rollout_id",
        "seed",
        "session_id",
        "step_count",
    ]);
    assert.equal(first?.session_id, inspection.source_session_id);
    assert.equal(
        batch.text,
        batch.lines.map((line) => `${canonicalizeRecord(line as never)}\n`).join(""),
    );
    assert.equal(
        batch.batch_digest,
        `sha256:${createHash("sha256").update(batch.text, "utf8").digest("hex")}`,
    );
    assert.equal(inspection.batch?.batch_digest, batch.batch_digest);
    // The manifest cites the source, every rollout record, and the batch as training_batch.
    assert.deepEqual(
        manifest.artifacts.map((artifact) => artifact.role),
        ["source_session", ...Array.from({ length: 6 }, () => "rollout"), "training_batch"],
    );
    const training = manifest.artifacts.at(-1);
    assert.equal(training?.record_id, inspection.batch?.record_id);
    assert.equal(manifest.costs.provider_calls, 24);
    assert.equal(manifest.costs.cost_usd, 6);
    assert.deepEqual(inspectApplicationManifest(store, applicationId).manifest, manifest);
    assert.equal(
        inspection.manifest_record_id,
        inspectApplicationManifest(store, applicationId).record_id,
    );
    assert.equal(store.verifyIntegrity().ok, true);
});

test("selection, advantages, and the batch digest are identical across runs, stores, and archive import", async () => {
    const first = await runOnce("application:tree-rl:determinism");
    const second = await runOnce("application:tree-rl:determinism");
    using firstStore = first.store;
    using secondStore = second.store;
    assert.deepEqual(second.receipt.inspection.fork_points, first.receipt.inspection.fork_points);
    assert.deepEqual(second.receipt.batch, first.receipt.batch);
    assert.deepEqual(second.receipt.manifest, first.receipt.manifest);
    const applicationId = deriveApplicationOwnerId("application:tree-rl:determinism");
    // A repeated command returns the retained run without replaying or scoring.
    const provider = providerFactory();
    const reward = rewardOf();
    const repeated = await runTreeRlRollouts(
        firstStore,
        treeRlOptions(
            "application:tree-rl:determinism",
            first.receipt.inspection.source_session_id,
            {
                provider,
                reward,
            },
        ),
    );
    assert.deepEqual(repeated, first.receipt);
    assert.deepEqual(provider.contexts, []);
    assert.deepEqual(reward.contexts, []);
    // Imported and reopened read-only stores export an identical batch and inspection.
    using imported = new SQLiteTraceStore();
    imported.importTrace(firstStore.exportTrace());
    assert.deepEqual(exportTreeRlTrainingBatch(imported, applicationId), first.receipt.batch);
    assert.deepEqual(inspectTreeRlRun(imported, applicationId), first.receipt.inspection);
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-tree-rl-"));
    try {
        const databasePath = path.join(directory, "trace.sqlite");
        const writer = new SQLiteTraceStore(databasePath);
        writer.importTrace(secondStore.exportTrace());
        writer.close();
        using reader = new SQLiteTraceStore(databasePath, { readOnly: true });
        assert.equal(
            exportTreeRlTrainingBatch(reader, applicationId).batch_digest,
            first.receipt.batch.batch_digest,
        );
    } finally {
        await rm(directory, { force: true, recursive: true });
    }
});
