import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import {
    backupTraceStore,
    compensateEffects,
    createEffectCompensationRegistry,
    deriveEffectCompensationId,
    deriveReplaySessionId,
    inspectEffectCompensation,
    inspectEffectCompensationOwnership,
    inspectReplaySession,
    SQLiteTraceStore,
    TraceStoreBackupError,
    verifyTraceStoreBackup,
} from "../../src/index.ts";
import {
    ROW_INSERT_KIND,
    readCompensationLog,
    readRowIds,
    rowCompensation,
} from "../effect/compensation-fixtures.ts";
import {
    appendRequestFor,
    blobContentFor,
    blobIdOf,
    COMPENSATION_SESSION_COMMAND,
    compensationCommandFor,
    completedIndices,
    cutIdFor,
    type FaultEvent,
    type FaultProcessArguments,
    inspectHealth,
    startedIndices,
} from "./workload.ts";

/**
 * Outcome of one attempted operation after a kill: `complete` (durably done before or during the
 * kill), `retryable` (absent without residue that blocks a retry, and the retry succeeded), or
 * `refused` (a partial artifact that every verifier refuses, such as a backup without a manifest).
 */
export type RecoveryOutcome = "complete" | "refused" | "retryable";

/** Outcome counts for one recovery. */
export type RecoveryCounts = Record<RecoveryOutcome, number>;

/** Empty outcome counts. */
export function emptyCounts(): RecoveryCounts {
    return { complete: 0, refused: 0, retryable: 0 };
}

/** Adds counts into a total. */
export function addCounts(total: RecoveryCounts, counts: RecoveryCounts): void {
    total.complete += counts.complete;
    total.refused += counts.refused;
    total.retryable += counts.retryable;
}

/**
 * Reopens the store a killed child wrote, asserts every restart invariant, classifies each
 * operation the child started, and retries every retryable one. Throws on any unclassifiable
 * state: a failed integrity, blob, or quick check, an intent that needs manual recovery, a
 * completed operation that is not durable, or a partial artifact a verifier accepts.
 */
export async function recoverAfterKill(
    args: FaultProcessArguments,
    events: readonly FaultEvent[],
): Promise<RecoveryCounts> {
    const counts = emptyCounts();
    const store = new SQLiteTraceStore(args.databasePath);
    try {
        const health = inspectHealth(store);
        assert.deepEqual(health.issues, [], `store unhealthy after kill during ${args.operation}`);
        const done = completedIndices(events);
        const started = startedIndices(events);
        for (const index of started) {
            const outcome = await recoverOne(store, args, index, done.has(index), started);
            counts[outcome] += 1;
        }
        const after = inspectHealth(store);
        assert.deepEqual(after.issues, [], `store unhealthy after retries of ${args.operation}`);
        store.exportTrace();
    } finally {
        store.close();
    }
    return counts;
}

function recoverAppend(
    store: SQLiteTraceStore,
    seed: number,
    label: string,
    index: number,
    completed: boolean,
): { readonly outcome: RecoveryOutcome; readonly recordIds: readonly string[] } {
    const request = appendRequestFor(seed, label, index);
    const diagnosis = store.diagnoseAppend(request.append_intent_id);
    assert.notEqual(diagnosis.status, "manual_recovery_required", JSON.stringify(diagnosis));
    if (completed) assert.equal(diagnosis.status, "committed", request.append_intent_id);
    const receipt = store.append(request);
    assert.equal(store.diagnoseAppend(request.append_intent_id).status, "committed");
    return {
        outcome: diagnosis.status === "committed" ? "complete" : "retryable",
        recordIds: receipt.record_ids,
    };
}

async function recoverOne(
    store: SQLiteTraceStore,
    args: FaultProcessArguments,
    index: number,
    completed: boolean,
    started: readonly number[],
): Promise<RecoveryOutcome> {
    const { label, seed } = args;
    switch (args.operation) {
        case "append":
            return recoverAppend(store, seed, label, index, completed).outcome;
        case "vacuum": {
            recoverAppend(store, seed, `${label}:vacuum`, index, completed);
            assert.equal(store.maintain({ mode: "vacuum" }).vacuumed, true);
            return completed ? "complete" : "retryable";
        }
        case "blob": {
            const content = blobContentFor(seed, label, index);
            const blobId = blobIdOf(content);
            const retained = store.readBlob(blobId);
            if (completed) assert.deepEqual(retained, content, blobId);
            if (retained !== undefined) {
                assert.deepEqual(retained, content);
                return "complete";
            }
            // An unregistered object may only be bytes this child started to put.
            const startedIds = new Set(
                started.map((position) => blobIdOf(blobContentFor(seed, label, position))),
            );
            for (const orphan of store.collectBlobOrphans().orphan_blob_ids) {
                assert.ok(startedIds.has(orphan), `unexpected orphan ${orphan}`);
            }
            assert.equal(store.putBlob(content).blob_id, blobId);
            assert.deepEqual(store.readBlob(blobId), content);
            return "retryable";
        }
        case "cut": {
            const request = appendRequestFor(seed, `${label}:cut`, index);
            const append = recoverAppend(store, seed, `${label}:cut`, index, completed);
            const cutId = cutIdFor(label, index);
            const existing = store.readOptionalCut(cutId);
            if (completed) assert.notEqual(existing, undefined, cutId);
            const cut = store.publishCut({
                cut_id: cutId,
                target_owner_id: request.batch.groups[0]?.owner_id as string,
                through_record_id: append.recordIds.at(-1) as string,
            });
            assert.equal(cut.through_record_id, append.recordIds.at(-1));
            assert.deepEqual(store.readCut(cutId), cut);
            if (existing !== undefined) assert.deepEqual(existing, cut);
            return existing === undefined ? "retryable" : append.outcome;
        }
        case "import":
            return recoverImport(args, index, completed);
        case "backup":
            return recoverBackup(store, args, index, completed);
        case "compensation":
            return recoverCompensation(store, args, index, completed);
    }
}

/**
 * Recovers one compensation the child started. A compensation retained as compensated is never
 * invoked again; any other state (absent, pending, or an uncertain attempt that may already have
 * changed the world) is retried with the same idempotent handler. Either way the world changed
 * exactly once: the row is gone and the log records one world-changing deletion under the key.
 */
async function recoverCompensation(
    store: SQLiteTraceStore,
    args: FaultProcessArguments,
    index: number,
    completed: boolean,
): Promise<RecoveryOutcome> {
    const world = args.worldPath as string;
    const step = inspectReplaySession(store, {
        sessionId: deriveReplaySessionId(COMPENSATION_SESSION_COMMAND),
    }).steps[index];
    if (step === undefined) {
        return "complete";
    }
    const compensationId = deriveEffectCompensationId(step.record_id);
    const before =
        store.readOwner(compensationId).length === 0
            ? "absent"
            : inspectEffectCompensation(store, { compensationId }).status;
    if (completed) assert.equal(before, "compensated", compensationId);
    let invoked = 0;
    const registry =
        before === "compensated"
            ? createEffectCompensationRegistry([
                  {
                      compensate: () => {
                          invoked += 1;
                          throw new Error("a compensated effect must not be compensated again");
                      },
                      handlerId: "compensation:forbidden",
                      kind: ROW_INSERT_KIND,
                  },
              ])
            : rowCompensation(world);
    await waitForCompensationExpiry(store, compensationId);
    await compensateEffects(store, {
        commandId: compensationCommandFor(args.label, index),
        effectRecordIds: [step.record_id],
        registry,
    });
    assert.equal(invoked, 0);
    const after = inspectEffectCompensation(store, { compensationId });
    assert.equal(after.status, "compensated");
    assert.equal(
        after.attempts.filter((attempt) => attempt.outcome?.status === "compensated").length,
        1,
    );
    const payload = step.effect?.intent.payload as { readonly id: string };
    assert.equal(readRowIds(world).includes(payload.id), false, payload.id);
    const log = readCompensationLog(world).get(compensationId);
    assert.equal(log?.deleted, 1, `${compensationId} changed the world ${log?.deleted} times`);
    // An attempt killed before its handler committed leaves no log entry, so invocations that
    // changed the log never exceed the retained attempts.
    assert.ok((log?.invocations ?? 0) >= 1 && (log?.invocations ?? 0) <= after.attempts.length);
    return before === "compensated" ? "complete" : "retryable";
}

function recoverImport(
    args: FaultProcessArguments,
    index: number,
    completed: boolean,
): RecoveryOutcome {
    const target = path.join(args.importRoot as string, `${args.label}-${index}.sqlite`);
    const archive = readFileSync(args.archivePath as string, "utf8");
    if (!existsSync(target)) {
        assert.equal(completed, false);
        return "retryable";
    }
    const imported = new SQLiteTraceStore(target);
    try {
        assert.deepEqual(inspectHealth(imported).issues, [], `import target ${target}`);
        if (imported.exportTrace() === archive) return "complete";
        assert.equal(completed, false, `completed import ${target} is not durable`);
        imported.importTrace(archive);
        assert.equal(imported.exportTrace(), archive);
        assert.deepEqual(inspectHealth(imported).issues, []);
        return "retryable";
    } finally {
        imported.close();
    }
}

async function recoverBackup(
    store: SQLiteTraceStore,
    args: FaultProcessArguments,
    index: number,
    completed: boolean,
): Promise<RecoveryOutcome> {
    recoverAppend(store, args.seed, `${args.label}:backup`, index, completed);
    const destination = path.join(args.backupRoot as string, `${args.label}-${index}`);
    let outcome: RecoveryOutcome = "retryable";
    if (existsSync(destination)) {
        try {
            await verifyTraceStoreBackup(destination);
            outcome = "complete";
        } catch (error) {
            assert.equal(completed, false, `completed backup ${destination} does not verify`);
            assert.ok(error instanceof TraceStoreBackupError, String(error));
            assert.equal(error.reason, "manifest-missing", `${destination}: ${error.message}`);
            outcome = "refused";
        }
    } else {
        assert.equal(completed, false);
    }
    if (outcome !== "complete") {
        const retry = `${destination}-retry`;
        const manifest = await backupTraceStore(store, { destination: retry });
        const verified = await verifyTraceStoreBackup(retry);
        assert.equal(verified.manifest.manifest_id, manifest.manifest_id);
    }
    return outcome;
}

/** Waits for an actually killed writer's durable lease to expire before retrying its stable key. */
export async function waitForCompensationExpiry(
    store: SQLiteTraceStore,
    compensationId: string,
): Promise<void> {
    if (store.readOwner(compensationId).length === 0) return;
    const { ownership } = inspectEffectCompensationOwnership(store, { compensationId });
    if (ownership.status === "active")
        await delay(Math.max(0, (ownership.lease_expires_at as number) - Date.now() + 1));
}
