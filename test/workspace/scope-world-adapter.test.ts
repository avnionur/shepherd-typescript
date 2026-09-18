import assert from "node:assert/strict";
import { test } from "node:test";

import {
    createScopeWorldAdapter,
    inspectScope,
    registerRootScope,
    SQLiteTraceStore,
} from "../../src/index.ts";
import { workspaceProtocolConfig } from "../../src/protocol/config.ts";
import { createSupervisorWorld } from "../applications/world-adapter-fixture.ts";
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
