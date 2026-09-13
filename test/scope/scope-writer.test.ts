import assert from "node:assert/strict";
import { test } from "node:test";

import {
    claimScopeWriter,
    claimScopeWriters,
    emitScopeRecord,
    releaseScopeWriter,
    ScopeEvidenceError,
    ScopeWriterConflictError,
    ScopeWriterFencedError,
    SQLiteTraceStore,
} from "../../src/index.ts";
import { registerFixtureRoot, temporaryDatabasePath } from "./fixtures.ts";

test("scope writer claims are exclusive, monotonic, releasable, and expiry-replaceable", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "writer");
    const store = new SQLiteTraceStore(databasePath);
    const root = registerFixtureRoot(store);
    const first = claimScopeWriter(store, {
        claimId: "claim:one",
        nowMilliseconds: 1_000,
        scopeId: root.scope_id,
    });
    assert.deepEqual(first, {
        claim_id: "claim:one",
        fencing_token: 1,
        lease_expires_at: 31_000,
        scope_id: root.scope_id,
    });
    assert.equal(Object.isFrozen(first), true);

    // The exact unexpired claim is returned again; another identity loses.
    assert.deepEqual(
        claimScopeWriter(store, {
            claimId: "claim:one",
            nowMilliseconds: 2_000,
            scopeId: root.scope_id,
        }),
        first,
    );
    assert.throws(
        () =>
            claimScopeWriter(store, {
                claimId: "claim:two",
                nowMilliseconds: 2_000,
                scopeId: root.scope_id,
            }),
        (error: unknown) =>
            error instanceof ScopeWriterConflictError &&
            error.claim_id === "claim:one" &&
            error.scope_id === root.scope_id,
    );

    // Expiry permits takeover with the next token; the stale holder is fenced afterwards.
    const second = claimScopeWriter(store, {
        claimId: "claim:two",
        nowMilliseconds: 31_000,
        scopeId: root.scope_id,
    });
    assert.equal(second.fencing_token, 2);
    assert.equal(second.lease_expires_at, 61_000);
    assert.throws(
        () =>
            emitScopeRecord(store, {
                commandId: "scope-command:stale",
                data: { note: "stale" },
                expectedHeadRecordId: root.head.record_id,
                nowMilliseconds: 32_000,
                writer: first,
            }),
        ScopeWriterFencedError,
    );
    assert.throws(() => releaseScopeWriter(store, { writer: first }), ScopeWriterFencedError);

    // An expired but not superseded holder is also fenced.
    assert.throws(
        () =>
            emitScopeRecord(store, {
                commandId: "scope-command:expired",
                data: { note: "expired" },
                expectedHeadRecordId: root.head.record_id,
                nowMilliseconds: 61_000,
                writer: second,
            }),
        ScopeWriterFencedError,
    );

    // Release is idempotent and admits the next claimant immediately.
    const released = releaseScopeWriter(store, { writer: second });
    assert.deepEqual(released, {
        claim_id: "claim:two",
        fencing_token: 2,
        scope_id: root.scope_id,
    });
    assert.deepEqual(releaseScopeWriter(store, { writer: second }), released);
    // A released claim identity is not renewed; the next claim receives a new token.
    const renewed = claimScopeWriter(store, {
        claimId: "claim:two",
        nowMilliseconds: 40_000,
        scopeId: root.scope_id,
    });
    assert.equal(renewed.fencing_token, 3);
    assert.notDeepEqual(renewed, second);
    store.close();

    using reopened = new SQLiteTraceStore(databasePath);
    assert.throws(
        () =>
            claimScopeWriter(reopened, {
                claimId: "claim:three",
                nowMilliseconds: 40_000,
                scopeId: root.scope_id,
            }),
        ScopeWriterConflictError,
    );
    const third = claimScopeWriter(reopened, {
        claimId: "claim:three",
        nowMilliseconds: 70_000,
        scopeId: root.scope_id,
    });
    assert.equal(third.fencing_token, 4);
    assert.throws(
        () =>
            claimScopeWriter(reopened, {
                claimId: "claim:two",
                nowMilliseconds: 70_000,
                scopeId: root.scope_id,
            }),
        ScopeWriterConflictError,
    );
});

test("scope writer claims require a live open registration and closed options", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "writer-options");
    using store = new SQLiteTraceStore(databasePath);
    const root = registerFixtureRoot(store);
    assert.throws(
        () =>
            claimScopeWriter(store, {
                claimId: "claim:x",
                scopeId: `scope:sha256:${"a".repeat(64)}`,
            }),
        ScopeEvidenceError,
    );
    const writer = claimScopeWriter(store, {
        claimId: "claim:default-now",
        scopeId: root.scope_id,
    });
    assert.equal(writer.lease_expires_at > Date.now() - 1, true);
    // Claim identities are scoped per registration, so one worker identity may hold two scopes.
    const other = registerFixtureRoot(store, "scope-command:other-root");
    assert.equal(
        claimScopeWriter(store, { claimId: "claim:default-now", scopeId: other.scope_id }).scope_id,
        other.scope_id,
    );
    assert.throws(
        () =>
            claimScopeWriter(store, {
                claimId: "claim:overflow",
                nowMilliseconds: Number.MAX_SAFE_INTEGER,
                scopeId: root.scope_id,
            }),
        TypeError,
    );
    assert.throws(() => store.claimScopeWriter(root.scope_id, "claim:negative", -1), TypeError);
    assert.throws(
        () =>
            store.emitScopeRecord(
                root.scope_id,
                { claimId: writer.claim_id, fencingToken: writer.fencing_token },
                root.head.record_id,
                [],
                -1,
                { append_intent_id: "intent:negative", batch: { groups: [] } },
            ),
        TypeError,
    );
    for (const options of [
        { claimId: "claim:x" },
        { claimId: "claim:x", scopeId: 5 },
        { claimId: "", scopeId: root.scope_id },
        { claimId: "claim:x", scopeId: "scope:sha256:short" },
        { claimId: "claim:x", scopeId: root.scope_id, nowMilliseconds: 1.5 },
        { claimId: "claim:x", scopeId: root.scope_id, extra: true },
    ]) {
        assert.throws(() => claimScopeWriter(store, options as never), TypeError);
    }
    for (const options of [{}, { writer: { ...writer } }, { writer, extra: true }]) {
        assert.throws(() => releaseScopeWriter(store, options as never), TypeError);
    }
});

test("multi-scope writer claims are canonical-ordered, all-or-nothing, and closed", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "multi-claims");
    using store = new SQLiteTraceStore(databasePath);
    const scopes = ["scope-command:a", "scope-command:b", "scope-command:c"]
        .map((commandId) => registerFixtureRoot(store, commandId).scope_id)
        .sort();
    const [first, middle, last] = scopes as [string, string, string];

    // Handles return in request order regardless of acquisition order.
    const [lastWriter, firstWriter] = claimScopeWriters(store, {
        claims: [
            { claimId: "claim:last", scopeId: last },
            { claimId: "claim:first", scopeId: first },
        ],
        nowMilliseconds: 1_000,
    });
    assert.equal(lastWriter?.scope_id, last);
    assert.equal(firstWriter?.scope_id, first);
    releaseScopeWriter(store, { writer: firstWriter as never });

    // The canonically earlier scope is admitted first, then rolled back when a later one conflicts.
    for (const [index, claims] of [
        [
            { claimId: "claim:other-last", scopeId: last },
            { claimId: "claim:other-first", scopeId: first },
        ],
        [
            { claimId: "claim:other-first", scopeId: first },
            { claimId: "claim:other-last", scopeId: last },
        ],
    ].entries()) {
        assert.throws(
            () => claimScopeWriters(store, { claims, nowMilliseconds: 1_500 }),
            (error: unknown) =>
                error instanceof ScopeWriterConflictError && error.scope_id === last,
        );
        const released = claimScopeWriter(store, {
            claimId: "claim:probe",
            nowMilliseconds: 1_500,
            scopeId: first,
        });
        // Only the probe advanced the token; the rolled-back attempt left no claim behind.
        assert.equal(released.fencing_token, index + 2);
        releaseScopeWriter(store, { writer: released });
    }

    // With two conflicts, the canonically first scope reports the refusal in either request order.
    claimScopeWriter(store, {
        claimId: "claim:hold-first",
        nowMilliseconds: 1_500,
        scopeId: first,
    });
    for (const claims of [
        [
            { claimId: "claim:x-last", scopeId: last },
            { claimId: "claim:x-first", scopeId: first },
        ],
        [
            { claimId: "claim:x-first", scopeId: first },
            { claimId: "claim:x-last", scopeId: last },
        ],
    ]) {
        assert.throws(
            () => claimScopeWriters(store, { claims, nowMilliseconds: 1_500 }),
            (error: unknown) =>
                error instanceof ScopeWriterConflictError && error.scope_id === first,
        );
    }
    assert.equal(
        claimScopeWriter(store, {
            claimId: "claim:middle",
            nowMilliseconds: 1_500,
            scopeId: middle,
        }).fencing_token,
        1,
    );
    const valid = { claimId: "claim:valid", scopeId: middle };
    for (const options of [
        { claims: [] },
        { claims: [valid, valid] },
        { claims: [{ claimId: "", scopeId: middle }] },
        { claims: [{ claimId: "claim:x" }] },
        { claims: "all" },
        { claims: [valid], extra: true },
        { claims: [valid], nowMilliseconds: -1 },
    ]) {
        assert.throws(() => claimScopeWriters(store, options as never), TypeError);
    }
    assert.throws(
        () =>
            store.claimScopeWriters(
                [{ claimId: "claim:overflow", scopeId: middle }],
                Number.MAX_SAFE_INTEGER,
            ),
        TypeError,
    );
});
