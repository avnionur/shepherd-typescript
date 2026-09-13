import assert from "node:assert/strict";
import { test } from "node:test";

import {
    claimScopeWriter,
    forkScope,
    inspectScope,
    type OwnerRecord,
    ROOT_WITNESS_ID,
    readScopeCommandReceipt,
    registerChildScope,
    registerRootScope,
    ScopeEvidenceError,
    SQLiteTraceStore,
} from "../../src/index.ts";
import { readScopeCheckpoint, readScopeForkRecord } from "../../src/scope/records.ts";
import { readScopeWorld } from "../../src/scope/world.ts";
import { createForkWorkspace, type ForkWorkspace, forkOptions } from "./fork-fixtures.ts";

test("fork journal and checkpoint codecs fail closed on malformed persisted evidence", async (context) => {
    const { fork, prepared, completed } = await completedFork(
        await createForkWorkspace(context, "codec"),
    );
    const checkpoint = completed.body.checkpoint as {
        readonly constituents: readonly Record<string, unknown>[];
    };
    const constituents = checkpoint.constituents;
    const withConstituent = (index: number, value: unknown) => ({
        ...checkpoint,
        constituents: constituents.map((entry, position) => (position === index ? value : entry)),
    });

    assert.throws(
        () => readScopeForkRecord({ ...prepared.body, phase: "other" }),
        ScopeEvidenceError,
    );
    for (const body of [
        { ...prepared.body, world_capability: "trace_only" },
        { ...prepared.body, capture_kind: "atomic" },
        { ...prepared.body, resource_kind: "network" },
    ]) {
        assert.throws(() => readScopeForkRecord(body), ScopeEvidenceError);
    }
    for (const value of [
        { ...checkpoint, capture_kind: "atomic" },
        { ...checkpoint, checkpoint_version: 2 },
        { ...checkpoint, constituents: constituents.slice(1) },
        withConstituent(0, { kind: "execution", receipt_id: "x", status: "verified" }),
        withConstituent(9, { kind: "process", reason: "x", status: "unavailable" }),
        withConstituent(1, { kind: "budget", status: "not_applicable" }),
        withConstituent(1, { kind: "execution", status: "restored" }),
        withConstituent(1, null),
    ]) {
        assert.throws(() => readScopeCheckpoint(value), TypeError);
    }
    assert.deepEqual(
        readScopeCheckpoint(withConstituent(1, { kind: "execution", status: "reconstructive" }))
            .constituents[1],
        { kind: "execution", status: "reconstructive" },
    );

    // Journal occurrences must agree with their command, scope, phase, intent, and causality.
    const scopeId = fork.scope_id;
    const commandId = fork.command_id;
    assert.deepEqual(readScopeWorld(prepared, completed, scopeId, commandId), fork.world);
    for (const record of [
        completed,
        mutate(prepared, {
            body: { ...prepared.body, custody_id: completed.body.custody_id.replace(/.$/u, "0") },
        }),
        mutate(prepared, { view: { ...prepared.view, append_intent_id: "intent:other" } }),
    ]) {
        assert.throws(() => readScopeWorld(record, null, scopeId, commandId), ScopeEvidenceError);
    }
    assert.throws(
        () => readScopeWorld(prepared, null, `scope:sha256:${"0".repeat(64)}`, commandId),
        ScopeEvidenceError,
    );
    for (const record of [
        prepared,
        mutate(completed, {
            envelope: {
                ...completed.envelope,
                caused_by_record_ids: [fork.registration_record_id],
            },
        }),
        mutate(completed, { view: { ...completed.view, append_intent_id: "intent:other" } }),
    ]) {
        assert.throws(
            () => readScopeWorld(prepared, record, scopeId, commandId),
            ScopeEvidenceError,
        );
    }
});

test("inspection and replay fail closed on incomplete or inconsistent fork evidence", async (context) => {
    const workspace = await createForkWorkspace(context, "inspection-evidence");
    const { fork } = await completedFork(workspace);
    const plain = registerChildScope(workspace.store, {
        commandId: "scope-command:plain",
        expectedHeadRecordId: fork.parent_head.record_id,
        grant: [],
        nowMilliseconds: 1_500,
        parent: workspace.rootWriter,
    });
    const other = registerChildScope(workspace.store, {
        commandId: "scope-command:other-plain",
        expectedHeadRecordId: plain.parent_head.record_id,
        grant: [],
        nowMilliseconds: 1_500,
        parent: workspace.rootWriter,
    });
    const rootRegistration = workspace.store.readRecord(workspace.root.registration_record_id);
    assert.ok(rootRegistration);
    // A root registration cannot declare a reference-copy world.
    const referenceRoot = `scope:sha256:${"8".repeat(64)}`;
    workspace.store.append({
        append_intent_id: "intent:reference-root",
        batch: {
            groups: [
                {
                    owner_id: referenceRoot,
                    records: [
                        {
                            body: {
                                ...rootRegistration.body,
                                scope_id: referenceRoot,
                                world_capability: "reference_copy",
                            },
                            mode: "capture",
                            schema_ref: "shepherd.scope.registration.v1",
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    });
    assert.throws(() => inspectScope(workspace.store, referenceRoot), ScopeEvidenceError);
    // A raw fork record on a trace-only scope is refused.
    const rawFork = (ownerId: string, causedBy: string, intent: string) =>
        workspace.store.append({
            append_intent_id: intent,
            batch: {
                groups: [
                    {
                        owner_id: ownerId,
                        records: [
                            {
                                body:
                                    workspace.store.readRecord(fork.prepared_record_id)?.body ?? {},
                                caused_by_record_ids: [causedBy],
                                mode: "capture",
                                schema_ref: "shepherd.scope.fork.v1",
                                witness_ref: ROOT_WITNESS_ID,
                            },
                        ],
                    },
                ],
            },
        });
    rawFork(plain.scope_id, plain.head.record_id, "intent:raw-fork-plain");
    assert.throws(() => inspectScope(workspace.store, plain.scope_id), ScopeEvidenceError);
    // A second fork journal record after completion is refused.
    rawFork(fork.scope_id, fork.head.record_id, "intent:raw-fork-after-completion");
    assert.throws(() => inspectScope(workspace.store, fork.scope_id), ScopeEvidenceError);
    workspace.store.close();

    class HiddenForkJournalStore extends SQLiteTraceStore {
        override readOwner(ownerId: string): readonly OwnerRecord[] {
            const records = super.readOwner(ownerId);
            return ownerId === fork.scope_id ? records.slice(0, 2) : records;
        }
    }
    using hidden = new HiddenForkJournalStore(workspace.databasePath);
    assert.throws(() => inspectScope(hidden, fork.scope_id), ScopeEvidenceError);
    hidden.close();

    class SwappedRegistrationStore extends SQLiteTraceStore {
        override readAppendIntentRecords(appendIntentId: string): readonly OwnerRecord[] {
            const records = super.readAppendIntentRecords(appendIntentId);
            if (records[1]?.envelope.record_id !== plain.registration_record_id) {
                return records;
            }
            return [records[0] as OwnerRecord, super.readOwner(other.scope_id)[0] as OwnerRecord];
        }
    }
    using swapped = new SwappedRegistrationStore(workspace.databasePath);
    assert.throws(
        () => readScopeCommandReceipt(swapped, "scope-command:plain"),
        ScopeEvidenceError,
    );
    swapped.close();

    class ForeignPublisherStore extends SQLiteTraceStore {
        override readCut(cutId: string) {
            const cut = super.readCut(cutId);
            return cut.cut_id === plain.origin.origin_cut_id
                ? { ...cut, publisher_owner_id: other.scope_id }
                : cut;
        }
    }
    using foreign = new ForeignPublisherStore(workspace.databasePath);
    assert.throws(
        () => readScopeCommandReceipt(foreign, "scope-command:plain"),
        ScopeEvidenceError,
    );
    foreign.close();

    // A concurrent completion replays through the store when the caller's read raced ahead.
    let hideCompletion = true;
    class RacingCompletionStore extends SQLiteTraceStore {
        override readScopeForkBoundary(
            ...parameters: Parameters<SQLiteTraceStore["readScopeForkBoundary"]>
        ): "completed" | "ready" {
            const status = super.readScopeForkBoundary(...parameters);
            if (hideCompletion && status === "completed") {
                hideCompletion = false;
                return "ready";
            }
            return status;
        }
    }
    using racing = new RacingCompletionStore(workspace.databasePath);
    const parent = claimScopeWriter(racing, {
        claimId: "claim:racing-root",
        nowMilliseconds: 40_000,
        scopeId: workspace.root.scope_id,
    });
    assert.deepEqual(
        await forkScope(racing, {
            ...forkOptions(workspace, fork.world.base_revision_id),
            nowMilliseconds: 40_000,
            parent,
        }),
        fork,
    );
    assert.equal(hideCompletion, false);

    // The store refuses to complete a fork under a scope that does not own the child.
    const stranger = registerRootScope(racing, {
        authority: { ceiling: [], grant: [] },
        commandId: "scope-command:stranger",
    });
    const strangerWriter = claimScopeWriter(racing, {
        claimId: "claim:stranger",
        nowMilliseconds: 40_000,
        scopeId: stranger.scope_id,
    });
    assert.throws(
        () =>
            racing.completeScopeFork({
                childScopeId: plain.scope_id,
                nowMilliseconds: 40_000,
                parentFence: {
                    claimId: strangerWriter.claim_id,
                    fencingToken: strangerWriter.fencing_token,
                },
                parentScopeId: stranger.scope_id,
                preparedRecordId: plain.head.record_id,
                request: { append_intent_id: "intent:stranger-completion", batch: { groups: [] } },
            }),
        ScopeEvidenceError,
    );
});

async function completedFork(workspace: ForkWorkspace) {
    const origin = await workspace.carrier.snapshot(workspace.source);
    const fork = await forkScope(workspace.store, forkOptions(workspace, origin.revision_id));
    const path = workspace.store.readOwner(fork.scope_id);
    return {
        completed: path[3] as OwnerRecord & { body: { custody_id: string; checkpoint: unknown } },
        fork,
        prepared: path[2] as OwnerRecord,
    };
}

function mutate(record: OwnerRecord, patch: Partial<OwnerRecord>): OwnerRecord {
    return { ...record, ...patch };
}
