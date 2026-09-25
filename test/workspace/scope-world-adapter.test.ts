import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import {
    claimScopeWriter,
    createScopeWorldAdapter,
    inspectScope,
    registerRootScope,
    releaseScopeWriter,
    ScopeMergeConflictError,
    ScopeWriterConflictError,
    SQLiteTraceStore,
} from "../../src/index.ts";
import { workspaceProtocolConfig } from "../../src/protocol/config.ts";
import { createSupervisorWorld, readParentFile } from "../applications/world-adapter-fixture.ts";
import { registerAndClaim, temporaryDatabasePath } from "../scope/fixtures.ts";
import { bindingGrant, createForkWorkspace } from "../scope/fork-fixtures.ts";

test("the scope world adapter forks, merges, discards, and replays retained receipts", async (context) => {
    const world = await createSupervisorWorld(context, "adapter");
    const { adapter, store } = world;
    const fork = { commandId: "scope-command:adapter-fork", nowMilliseconds: 2_000, workerId: "a" };
    const custody = await adapter.fork(fork);
    assert.ok(custody.custody_id.startsWith(workspaceProtocolConfig.carrier.custodyIdPrefix));
    assert.deepEqual(await adapter.fork(fork), custody);
    assert.deepEqual(await adapter.changedPaths(custody.custody_id), []);
    // A fresh adapter, as after a crash between the fork and the child's start, replays the
    // retained fork receipt without a second fork and resolves the same custody.
    const restarted = createScopeWorldAdapter({
        binding: world.source,
        carrier: world.carrier,
        grant: [bindingGrant(world.source)],
        parent: world.parentWriter,
        store,
    });
    assert.deepEqual(await restarted.fork(fork), custody);
    assert.deepEqual(await restarted.changedPaths(custody.custody_id), []);
    assert.equal(inspectScope(store, world.parent.scope_id)?.children.length, 1);
    const other = await adapter.fork({
        ...fork,
        commandId: "scope-command:adapter-fork-b",
        workerId: "b",
    });
    const merge = {
        commandId: "scope-command:adapter-merge",
        custodyId: custody.custody_id,
        nowMilliseconds: 2_100,
        workerId: "a",
    };
    const merged = await adapter.merge(merge);
    assert.deepEqual(await adapter.merge(merge), merged);
    const discard = {
        commandId: "scope-command:adapter-discard",
        custodyId: other.custody_id,
        nowMilliseconds: 2_200,
        workerId: "b",
    };
    const discarded = await adapter.discard(discard);
    assert.deepEqual(await adapter.discard(discard), discarded);
    assert.deepEqual(
        (inspectScope(store, world.parent.scope_id)?.children ?? []).map(
            (scopeId) => inspectScope(store, scopeId)?.state,
        ),
        ["merged", "discarded"],
    );
    for (const request of [
        { ...fork, commandId: "" },
        { ...fork, workerId: 1 },
        { ...fork, nowMilliseconds: -1 },
        { ...fork, custodyId: "x" },
        null,
    ]) {
        await assert.rejects(adapter.fork(request as never), TypeError);
    }
    for (const request of [
        { ...merge, custodyId: "custody:unknown" },
        { ...merge, custodyId: 1 },
    ]) {
        await assert.rejects(adapter.merge(request as never), TypeError);
        await assert.rejects(adapter.discard(request as never), TypeError);
    }
    await assert.rejects(adapter.changedPaths("custody:unknown"), TypeError);
    const forgedParent = { ...world.parentWriter };
    assert.throws(
        () =>
            createScopeWorldAdapter({
                binding: world.source,
                carrier: world.carrier,
                grant: [bindingGrant(world.source)],
                parent: forgedParent,
                store,
            }),
        TypeError,
    );
    assert.throws(() => createScopeWorldAdapter({} as never), TypeError);
});

test("the scope world adapter requires a parent scope holding world custody", async (context) => {
    const workspace = await createForkWorkspace(context, "adapter-trace-only");
    assert.throws(
        () =>
            createScopeWorldAdapter({
                binding: workspace.source,
                carrier: workspace.carrier,
                grant: [bindingGrant(workspace.source)],
                parent: workspace.rootWriter,
                store: workspace.store,
            }),
        (error: unknown) => error instanceof TypeError && /world custody/u.test(error.message),
    );
    const databasePath = await temporaryDatabasePath(context, "adapter-unregistered");
    using store = new SQLiteTraceStore(databasePath);
    const { writer } = registerAndClaim(store);
    registerRootScope(store, {
        authority: { ceiling: [], grant: [] },
        commandId: "scope-command:other",
    });
    assert.throws(
        () =>
            createScopeWorldAdapter({
                binding: workspace.source,
                carrier: workspace.carrier,
                grant: [bindingGrant(workspace.source)],
                parent: writer,
                store,
            }),
        TypeError,
    );
});

test("the scope world adapter forks a source custody's current tree as a nested scope", async (context) => {
    const world = await createSupervisorWorld(context, "adapter-nested");
    const { adapter, store } = world;
    const leader = await adapter.fork({
        commandId: "scope-command:nested-leader",
        nowMilliseconds: 2_000,
        workerId: "a",
    });
    await writeFile(path.join(leader.root, "lead.txt"), "leader\n");
    const followerFork = {
        commandId: "scope-command:nested-follower",
        nowMilliseconds: 2_100,
        sourceCustodyId: leader.custody_id,
        workerId: "b",
    };
    const follower = await adapter.fork(followerFork);
    assert.equal(await readFile(path.join(follower.root, "lead.txt"), "utf8"), "leader\n");
    assert.equal(await readFile(path.join(follower.root, "file.txt"), "utf8"), "source\n");
    // Changed paths are relative to the parent world the lineage was first forked from.
    assert.deepEqual(await adapter.changedPaths(follower.custody_id), ["lead.txt"]);
    const leaderScope = inspectScope(store, world.parent.scope_id)?.children[0] as string;
    assert.equal(inspectScope(store, leaderScope)?.children.length, 1);
    // A fresh process re-issues the forks in creation order and resolves the same custody.
    const restarted = createScopeWorldAdapter({
        binding: world.source,
        carrier: world.carrier,
        grant: [bindingGrant(world.source)],
        parent: world.parentWriter,
        store,
    });
    await assert.rejects(restarted.fork(followerFork), TypeError);
    assert.deepEqual(
        await restarted.fork({
            commandId: "scope-command:nested-leader",
            nowMilliseconds: 2_000,
            workerId: "a",
        }),
        leader,
    );
    assert.deepEqual(await restarted.fork(followerFork), follower);
    assert.equal(inspectScope(store, leaderScope)?.children.length, 1);
    // A second follower is discarded beneath the leader; the completed discard replays in a
    // process that never re-issued its fork, and refuses to name other custody.
    const second = await adapter.fork({
        ...followerFork,
        commandId: "scope-command:nested-second",
    });
    const discard = {
        commandId: "scope-command:nested-discard",
        custodyId: second.custody_id,
        nowMilliseconds: 2_200,
        workerId: "b",
    };
    const discarded = await adapter.discard(discard);
    const fresh = createScopeWorldAdapter({
        binding: world.source,
        carrier: world.carrier,
        grant: [bindingGrant(world.source)],
        parent: world.parentWriter,
        store,
    });
    assert.deepEqual(await fresh.discard(discard), discarded);
    await assert.rejects(fresh.discard({ ...discard, custodyId: follower.custody_id }), TypeError);
    // The follower lands in the parent world against its lineage base: it carries what it
    // inherited from the leader and its own writes, never the leader's writes after the fork.
    await writeFile(path.join(leader.root, "post.txt"), "leader after the fork\n");
    await writeFile(path.join(follower.root, "follow.txt"), "follower\n");
    const merge = {
        commandId: "scope-command:nested-merge",
        custodyId: follower.custody_id,
        nowMilliseconds: 2_300,
        workerId: "b",
    };
    const merged = await adapter.merge(merge);
    assert.equal(await readParentFile(world, "follow.txt"), "follower\n");
    assert.equal(await readParentFile(world, "lead.txt"), "leader\n");
    assert.equal(await readParentFile(world, "file.txt"), "source\n");
    await assert.rejects(readParentFile(world, "post.txt"), { code: "ENOENT" });
    assert.equal(existsSync(path.join(leader.root, "follow.txt")), false);
    assert.equal(existsSync(path.join(world.workspaceRoot, "source", "follow.txt")), false);
    // The follower is sealed beneath the leader and a fresh fork of the parent world merged.
    assert.equal(inspectScope(store, followerScopeOf(store, leaderScope, 0))?.state, "discarded");
    assert.deepEqual(
        (inspectScope(store, world.parent.scope_id)?.children ?? []).map(
            (scopeId) => inspectScope(store, scopeId)?.state,
        ),
        ["open", "merged"],
    );
    assert.deepEqual(await adapter.merge(merge), merged);
    assert.deepEqual(await fresh.merge(merge), merged);
    await assert.rejects(fresh.merge({ ...merge, custodyId: leader.custody_id }), TypeError);
    // A nested custody whose lineage changes overlap the parent world's changes since the lineage
    // base is refused before anything is retained.
    const third = await adapter.fork({ ...followerFork, commandId: "scope-command:nested-third" });
    await writeFile(path.join(third.root, "follow.txt"), "conflicting\n");
    const children = inspectScope(store, world.parent.scope_id)?.children.length;
    await assert.rejects(
        adapter.merge({
            ...merge,
            commandId: "scope-command:nested-conflict",
            custodyId: third.custody_id,
        }),
        (error: unknown) => error instanceof ScopeMergeConflictError,
    );
    assert.equal(inspectScope(store, world.parent.scope_id)?.children.length, children);
    // With the follower sealed, the leader's lineage can still be discarded as a whole.
    await adapter.discard({
        commandId: "scope-command:nested-leader-discard",
        custodyId: leader.custody_id,
        nowMilliseconds: 2_400,
        workerId: "a",
    });
    assert.equal(inspectScope(store, leaderScope)?.state, "discarded");
});

test("an interrupted nested merge converges on retry after its rebase fork and after its seal", async (context) => {
    const world = await createSupervisorWorld(context, "adapter-nested-retry");
    const { adapter, store } = world;
    const leader = await adapter.fork({
        commandId: "scope-command:retry-leader",
        nowMilliseconds: 2_000,
        workerId: "a",
    });
    await writeFile(path.join(leader.root, "lead.txt"), "leader\n");
    const follower = await adapter.fork({
        commandId: "scope-command:retry-follower",
        nowMilliseconds: 2_100,
        sourceCustodyId: leader.custody_id,
        workerId: "b",
    });
    await writeFile(path.join(follower.root, "follow.txt"), "follower\n");
    const leaderScope = inspectScope(store, world.parent.scope_id)?.children[0] as string;
    const followerScope = followerScopeOf(store, leaderScope, 0);
    const merge = {
        commandId: "scope-command:retry-merge",
        custodyId: follower.custody_id,
        nowMilliseconds: 2_300,
        workerId: "b",
    };
    // A foreign writer on the follower stops the merge after the rebase fork, before the seal.
    const foreign = claimScopeWriter(store, {
        claimId: "claim:foreign-follower",
        nowMilliseconds: 2_300,
        scopeId: followerScope,
    });
    await assert.rejects(adapter.merge(merge), ScopeWriterConflictError);
    releaseScopeWriter(store, { writer: foreign });
    const children = inspectScope(store, world.parent.scope_id)?.children ?? [];
    assert.equal(children.length, 2);
    const rebasedScope = children[1] as string;
    assert.equal(inspectScope(store, followerScope)?.state, "open");
    // A foreign writer on the rebase fork stops the retry after the seal, before the merge.
    const landing = claimScopeWriter(store, {
        claimId: "claim:foreign-landing",
        nowMilliseconds: 2_300,
        scopeId: rebasedScope,
    });
    await assert.rejects(adapter.merge(merge), ScopeWriterConflictError);
    releaseScopeWriter(store, { writer: landing });
    assert.equal(inspectScope(store, followerScope)?.state, "discarded");
    assert.equal(inspectScope(store, rebasedScope)?.state, "open");
    // A fresh process completes the merge from the retained seal without the custody's fork.
    const fresh = createScopeWorldAdapter({
        binding: world.source,
        carrier: world.carrier,
        grant: [bindingGrant(world.source)],
        parent: world.parentWriter,
        store,
    });
    const merged = await fresh.merge(merge);
    assert.equal(inspectScope(store, rebasedScope)?.state, "merged");
    assert.equal(await readParentFile(world, "follow.txt"), "follower\n");
    assert.equal(await readParentFile(world, "lead.txt"), "leader\n");
    assert.deepEqual(await adapter.merge(merge), merged);
    assert.equal(inspectScope(store, world.parent.scope_id)?.children.length, 2);
});

test("a nested merge whose reserved seal command names a plain discard is refused", async (context) => {
    const world = await createSupervisorWorld(context, "adapter-nested-forged-seal");
    const { adapter } = world;
    const leader = await adapter.fork({
        commandId: "scope-command:forged-leader",
        nowMilliseconds: 2_000,
        workerId: "a",
    });
    const follower = await adapter.fork({
        commandId: "scope-command:forged-follower",
        nowMilliseconds: 2_100,
        sourceCustodyId: leader.custody_id,
        workerId: "b",
    });
    // The follower was discarded under the merge's seal command, but no rebase fork was retained.
    await adapter.discard({
        commandId: "scope-command:forged-merge:rebase-seal",
        custodyId: follower.custody_id,
        nowMilliseconds: 2_200,
        workerId: "b",
    });
    await assert.rejects(
        adapter.merge({
            commandId: "scope-command:forged-merge",
            custodyId: follower.custody_id,
            nowMilliseconds: 2_300,
            workerId: "b",
        }),
        (error: unknown) =>
            error instanceof TypeError && /retains no rebase fork/u.test(error.message),
    );
});

function followerScopeOf(store: SQLiteTraceStore, leaderScope: string, index: number): string {
    return inspectScope(store, leaderScope)?.children[index] as string;
}
