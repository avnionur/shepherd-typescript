import assert from "node:assert/strict";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import {
    AppendIntentConflictError,
    claimScopeWriter,
    emitScopeRecord,
    forkScope,
    inspectScope,
    readScopeCommandReceipt,
    registerChildScope,
    registerRootScope,
    releaseScopeWriter,
    SCOPE_COMPATIBILITY_VERSION,
    SCOPE_RECORD_VERSION,
    ScopeAuthorityError,
    ScopeEvidenceError,
    ScopeHeadConflictError,
    ScopeWriterFencedError,
    SQLiteTraceStore,
} from "../../src/index.ts";
import { appendExecutionCreation } from "./fixtures.ts";
import { bindingGrant, createForkWorkspace, createRepositoryBinding } from "./fork-fixtures.ts";

test("fork publishes isolated reference-copy custody with an honest checkpoint and exact replay", async (context) => {
    const workspace = await createForkWorkspace(context, "basic");
    const { carrier, root, rootWriter, source, store, workspaceRoot } = workspace;
    const origin = await carrier.snapshot(source);
    const options = {
        binding: source,
        carrier,
        commandId: "scope-command:fork",
        expectedHeadRecordId: root.head.record_id,
        grant: [bindingGrant(source)],
        nowMilliseconds: 1_500,
        originRevisionId: origin.revision_id,
        parent: rootWriter,
    };
    const fork = await forkScope(store, options);

    assert.equal(fork.kind, "child");
    assert.equal(fork.origin.scope_id, root.scope_id);
    assert.equal(fork.origin.origin_record_id, root.head.record_id);
    assert.deepEqual(fork.head, { owner_ordinal: 3, record_id: fork.completed_record_id });
    assert.deepEqual(fork.authority.effective, [bindingGrant(source)]);
    assert.equal(Object.isFrozen(fork), true);
    assert.deepEqual(fork.world, {
        base_content_id: origin.content_id,
        base_revision_id: origin.revision_id,
        binding_id: source.binding_id,
        capture_kind: "verified-copy",
        checkpoint: {
            capture_kind: "verified-copy",
            checkpoint_version: 1,
            constituents: [
                { kind: "trace_cut", receipt_id: fork.origin.origin_cut_id, status: "verified" },
                { kind: "execution", status: "not_applicable" },
                { kind: "binding", receipt_id: origin.revision_id, status: "verified" },
                { kind: "world", receipt_id: fork.world.custody_id, status: "verified" },
                { kind: "grants", receipt_id: fork.registration_record_id, status: "verified" },
                {
                    kind: "child_frontier",
                    receipt_id: fork.origin.child_registered_record_id,
                    status: "verified",
                },
                { kind: "budget", status: "not_applicable" },
                { kind: "provider_session", status: "not_applicable" },
                { kind: "process", status: "not_applicable" },
                {
                    kind: "irreversible_effects",
                    reason: "external irreversible effects are not tracked by reference-copy forks",
                    status: "unavailable",
                },
            ],
        },
        completed_record_id: fork.completed_record_id,
        custody_id: fork.world.custody_id,
        prepared_record_id: fork.prepared_record_id,
        resource: { resource_id: source.binding_id, resource_kind: "workspace_binding" },
        status: "completed",
    });
    assert.match(fork.world.custody_id, /^world-custody:[0-9a-f]{64}$/u);

    // Retained journal shape on the child and parent paths.
    const childPath = store.readOwner(fork.scope_id);
    assert.deepEqual(
        childPath.map((record) => record.envelope.schema_ref),
        [
            "shepherd.scope.registration.v1",
            "kernel.cut.owner-prefix.v1",
            "shepherd.scope.fork.v1",
            "shepherd.scope.fork.v1",
        ],
    );
    assert.deepEqual(childPath[0]?.body.world_capability, "reference_copy");
    assert.deepEqual(childPath[2]?.envelope.caused_by_record_ids, [
        childPath[1]?.envelope.record_id,
    ]);
    assert.deepEqual(childPath[3]?.envelope.caused_by_record_ids, [fork.prepared_record_id]);
    assert.deepEqual(childPath[2]?.body, {
        base_content_id: origin.content_id,
        base_revision_id: origin.revision_id,
        binding_id: source.binding_id,
        capture_kind: "verified-copy",
        command_id: "scope-command:fork",
        compatibility_version: SCOPE_COMPATIBILITY_VERSION,
        custody_id: fork.world.custody_id,
        phase: "prepared",
        resource_id: source.binding_id,
        resource_kind: "workspace_binding",
        scope_id: fork.scope_id,
        scope_version: SCOPE_RECORD_VERSION,
        world_capability: "reference_copy",
    });
    assert.deepEqual(
        store.readOwner(root.scope_id).map((record) => record.envelope.schema_ref),
        ["shepherd.scope.registration.v1", "shepherd.scope.child_registered.v1"],
    );

    // Custody is a verified copy of the origin, isolated from the user binding and origin.
    const custody = await carrier.openCustody(fork.world.custody_id);
    assert.equal(custody.base_revision_id, origin.revision_id);
    assert.equal(await readFile(path.join(custody.path, "file.txt"), "utf8"), "source\n");
    const childWriter = claimScopeWriter(store, {
        claimId: "claim:child",
        nowMilliseconds: 1_500,
        scopeId: fork.scope_id,
    });
    await writeFile(path.join(custody.path, "file.txt"), "child\n");
    assert.equal((await carrier.verifyCustody(custody.custody_id)).modified, true);
    assert.equal(
        await readFile(path.join(workspaceRoot, "source", "file.txt"), "utf8"),
        "source\n",
    );
    assert.equal((await carrier.verifyRevision(origin.revision_id)).modified, false);
    const emitted = emitScopeRecord(store, {
        commandId: "scope-command:child-emit",
        data: { note: "after fork" },
        expectedHeadRecordId: fork.head.record_id,
        nowMilliseconds: 1_500,
        writer: childWriter,
    });
    assert.equal(emitted.head.owner_ordinal, 4);

    // Inspection and receipt replay reconstruct the same world.
    const inspection = inspectScope(store, fork.scope_id);
    assert.deepEqual(inspection?.world, fork.world);
    assert.deepEqual(
        inspection?.history.map((entry) => entry.kind),
        ["registration", "origin_cut", "fork_prepared", "fork_completed", "emission"],
    );
    assert.deepEqual(readScopeCommandReceipt(store, "scope-command:fork"), {
        command: "fork",
        receipt: fork,
    });

    // Exact replay performs no carrier work, even after the parent fence is released and the
    // child custody changed; changed requests conflict.
    const custodiesRoot = path.dirname(path.dirname(custody.path));
    const custodiesBefore = await readdir(custodiesRoot);
    releaseScopeWriter(store, { writer: rootWriter });
    assert.deepEqual(await forkScope(store, options), fork);
    assert.deepEqual(await readdir(custodiesRoot), custodiesBefore);
    const otherOrigin = await carrier.snapshot(workspace.docs);
    await assert.rejects(
        forkScope(store, { ...options, originRevisionId: otherOrigin.revision_id }),
        AppendIntentConflictError,
    );
    await assert.rejects(
        forkScope(store, { ...options, grant: [bindingGrant(source, ["read"])] }),
        AppendIntentConflictError,
    );
    store.close();

    using reopened = new SQLiteTraceStore(workspace.databasePath);
    const reopenedParent = claimScopeWriter(reopened, {
        claimId: "claim:root-reopened",
        nowMilliseconds: 50_000,
        scopeId: root.scope_id,
    });
    assert.deepEqual(
        await forkScope(reopened, { ...options, nowMilliseconds: 50_000, parent: reopenedParent }),
        fork,
    );
    assert.deepEqual(inspectScope(reopened, fork.scope_id)?.world, fork.world);
});

test("sibling and nested forks stay isolated, attenuated, and bound to the parent world", async (context) => {
    const { carrier, docs, root, rootWriter, source, store } = await createForkWorkspace(
        context,
        "nested",
    );
    const origin = await carrier.snapshot(source);
    const first = await forkScope(store, {
        binding: source,
        carrier,
        commandId: "scope-command:first",
        expectedHeadRecordId: root.head.record_id,
        grant: [bindingGrant(source), bindingGrant(docs)],
        nowMilliseconds: 1_500,
        originRevisionId: origin.revision_id,
        parent: rootWriter,
    });
    const sibling = await forkScope(store, {
        binding: source,
        carrier,
        commandId: "scope-command:sibling",
        expectedHeadRecordId: first.parent_head.record_id,
        grant: [bindingGrant(source, ["read"])],
        nowMilliseconds: 1_500,
        originRevisionId: origin.revision_id,
        parent: rootWriter,
    });
    assert.notEqual(sibling.world.custody_id, first.world.custody_id);
    assert.deepEqual(sibling.authority.effective, [bindingGrant(source, ["read"])]);

    const firstCustody = await carrier.openCustody(first.world.custody_id);
    const siblingCustody = await carrier.openCustody(sibling.world.custody_id);
    await writeFile(path.join(firstCustody.path, "file.txt"), "first\n");
    await writeFile(path.join(firstCustody.path, "added.txt"), "added\n");
    assert.equal((await carrier.verifyCustody(sibling.world.custody_id)).modified, false);
    assert.equal(await readFile(path.join(siblingCustody.path, "file.txt"), "utf8"), "source\n");

    // A nested fork must originate from a capture of the parent world's current custody.
    const firstWriter = claimScopeWriter(store, {
        claimId: "claim:first",
        nowMilliseconds: 1_500,
        scopeId: first.scope_id,
    });
    const captured = await carrier.captureCustody(first.world.custody_id);
    const nestedOptions = {
        binding: source,
        carrier,
        commandId: "scope-command:nested",
        expectedHeadRecordId: first.head.record_id,
        grant: [bindingGrant(source)],
        nowMilliseconds: 1_500,
        originRevisionId: captured.revision_id,
        parent: firstWriter,
    };
    await assert.rejects(
        forkScope(store, { ...nestedOptions, originRevisionId: origin.revision_id }),
        ScopeEvidenceError,
    );
    const nested = await forkScope(store, nestedOptions);
    assert.equal(nested.world.base_revision_id, captured.revision_id);
    // The nested fork leaves the parent world's custody content unchanged.
    assert.equal(
        (await carrier.verifyCustody(first.world.custody_id)).content_id,
        captured.content_id,
    );
    const nestedCustody = await carrier.openCustody(nested.world.custody_id);
    assert.equal(await readFile(path.join(nestedCustody.path, "added.txt"), "utf8"), "added\n");
    const nestedWriter = claimScopeWriter(store, {
        claimId: "claim:nested",
        nowMilliseconds: 1_500,
        scopeId: nested.scope_id,
    });
    assert.equal(nestedWriter.scope_id, nested.scope_id);
    await writeFile(path.join(nestedCustody.path, "nested.txt"), "nested\n");
    assert.equal(
        (await carrier.verifyCustody(first.world.custody_id)).content_id,
        captured.content_id,
    );
    await writeFile(path.join(firstCustody.path, "file.txt"), "first again\n");
    assert.equal(
        (await carrier.verifyCustody(nested.world.custody_id)).content_id,
        (await carrier.verifyCustody(nested.world.custody_id)).content_id,
    );
    assert.equal(await readFile(path.join(nestedCustody.path, "file.txt"), "utf8"), "first\n");

    // A stale capture no longer matches the parent world; a different binding is refused.
    await assert.rejects(
        forkScope(store, {
            ...nestedOptions,
            commandId: "scope-command:stale",
            expectedHeadRecordId: nested.parent_head.record_id,
        }),
        ScopeEvidenceError,
    );
    const docsOrigin = await carrier.snapshot(docs);
    await assert.rejects(
        forkScope(store, {
            ...nestedOptions,
            binding: docs,
            commandId: "scope-command:docs-nested",
            expectedHeadRecordId: nested.parent_head.record_id,
            grant: [bindingGrant(docs)],
            originRevisionId: docsOrigin.revision_id,
        }),
        ScopeEvidenceError,
    );

    // A trace-only parent must fork from a binding snapshot of the same binding.
    await assert.rejects(
        forkScope(store, {
            binding: source,
            carrier,
            commandId: "scope-command:captured-origin",
            expectedHeadRecordId: sibling.parent_head.record_id,
            grant: [bindingGrant(source)],
            nowMilliseconds: 1_500,
            originRevisionId: captured.revision_id,
            parent: rootWriter,
        }),
        ScopeEvidenceError,
    );
    await assert.rejects(
        forkScope(store, {
            binding: source,
            carrier,
            commandId: "scope-command:other-binding-origin",
            expectedHeadRecordId: sibling.parent_head.record_id,
            grant: [bindingGrant(source)],
            nowMilliseconds: 1_500,
            originRevisionId: docsOrigin.revision_id,
            parent: rootWriter,
        }),
        ScopeEvidenceError,
    );

    // Nested attenuation: the read-only sibling cannot grant write, and fork requires read.
    const siblingWriter = claimScopeWriter(store, {
        claimId: "claim:sibling",
        nowMilliseconds: 1_500,
        scopeId: sibling.scope_id,
    });
    const siblingCapture = await carrier.captureCustody(sibling.world.custody_id);
    const attenuated = await forkScope(store, {
        binding: source,
        carrier,
        commandId: "scope-command:attenuated",
        expectedHeadRecordId: sibling.head.record_id,
        grant: [bindingGrant(source)],
        nowMilliseconds: 1_500,
        originRevisionId: siblingCapture.revision_id,
        parent: siblingWriter,
    });
    assert.deepEqual(attenuated.authority.effective, [bindingGrant(source, ["read"])]);
    for (const grant of [[], [bindingGrant(source, ["write"])], [bindingGrant(docs)]]) {
        await assert.rejects(
            forkScope(store, {
                binding: source,
                carrier,
                commandId: `scope-command:no-read-${grant.length}-${grant[0]?.resource_id ?? "none"}`,
                expectedHeadRecordId: attenuated.parent_head.record_id,
                grant,
                nowMilliseconds: 1_500,
                originRevisionId: siblingCapture.revision_id,
                parent: siblingWriter,
            }),
            ScopeAuthorityError,
        );
    }
    assert.deepEqual(inspectScope(store, root.scope_id)?.children, [
        first.scope_id,
        sibling.scope_id,
    ]);
    assert.deepEqual(inspectScope(store, first.scope_id)?.children, [nested.scope_id]);
});

test("fork binds repository resources and records execution-associated unavailability", async (context) => {
    const workspace = await createForkWorkspace(context, "repository");
    const { carrier, store } = workspace;
    const repository = await createRepositoryBinding(workspace.workspaceRoot, "repository");
    const repositoryResource = {
        atoms: ["read", "write"] as const,
        resource_id: (repository as unknown as { resource_id: string }).resource_id,
        resource_kind: "repository_binding" as const,
    };
    appendExecutionCreation(store, "run:forked");
    const root = registerRootScope(store, {
        authority: { ceiling: [repositoryResource], grant: [repositoryResource] },
        commandId: "scope-command:repository-root",
    });
    const writer = claimScopeWriter(store, {
        claimId: "claim:repository-root",
        nowMilliseconds: 1_000,
        scopeId: root.scope_id,
    });
    const origin = await carrier.snapshot(repository);
    const fork = await forkScope(store, {
        binding: repository,
        carrier,
        commandId: "scope-command:repository-fork",
        executionId: "run:forked",
        expectedHeadRecordId: root.head.record_id,
        grant: [repositoryResource],
        nowMilliseconds: 1_500,
        originRevisionId: origin.revision_id,
        parent: writer,
    });
    assert.deepEqual(fork.world.resource, {
        resource_id: repositoryResource.resource_id,
        resource_kind: "repository_binding",
    });
    const constituents = fork.world.checkpoint?.constituents ?? [];
    assert.deepEqual(constituents[1], {
        kind: "execution",
        receipt_id: store.readOwner("run:forked")[0]?.envelope.record_id,
        status: "verified",
    });
    assert.deepEqual(
        constituents.slice(6).map((constituent) => constituent.status),
        ["unavailable", "unavailable", "unavailable", "unavailable"],
    );
    assert.equal(inspectScope(store, fork.scope_id)?.execution_id, "run:forked");
});

test("fork refuses forged handles, malformed options, stale heads, and reused identities", async (context) => {
    const { carrier, root, rootWriter, source, store } = await createForkWorkspace(
        context,
        "refusals",
    );
    const origin = await carrier.snapshot(source);
    const valid = {
        binding: source,
        carrier,
        commandId: "scope-command:valid",
        expectedHeadRecordId: root.head.record_id,
        grant: [bindingGrant(source)],
        nowMilliseconds: 1_500,
        originRevisionId: origin.revision_id,
        parent: rootWriter,
    };
    for (const options of [
        { ...valid, carrier: { ...carrier } },
        { ...valid, binding: { ...source } },
        { ...valid, parent: { ...rootWriter } },
        { ...valid, originRevisionId: "world-revision:bad" },
        { ...valid, extra: true },
        { ...valid, commandId: "" },
    ]) {
        await assert.rejects(forkScope(store, options as never), TypeError);
    }
    await assert.rejects(
        forkScope(store, { ...valid, expectedHeadRecordId: `sha256:${"e".repeat(64)}` }),
        ScopeHeadConflictError,
    );
    await assert.rejects(
        forkScope(store, { ...valid, nowMilliseconds: 40_000 }),
        ScopeWriterFencedError,
    );
    // A plain trace-only child reusing the fork command identity conflicts.
    const plain = registerChildScope(store, {
        commandId: "scope-command:plain",
        expectedHeadRecordId: root.head.record_id,
        grant: [],
        nowMilliseconds: 1_500,
        parent: rootWriter,
    });
    await assert.rejects(
        forkScope(store, {
            ...valid,
            commandId: "scope-command:plain",
        }),
        AppendIntentConflictError,
    );
    assert.equal(inspectScope(store, plain.scope_id)?.world, null);
    assert.equal(inspectScope(store, root.scope_id)?.children.length, 1);
});
