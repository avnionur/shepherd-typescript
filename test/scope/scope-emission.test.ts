import assert from "node:assert/strict";
import { test } from "node:test";

import {
    AppendIntentConflictError,
    claimScopeWriter,
    emitScopeRecord,
    inspectScope,
    readScopeCommandReceipt,
    releaseScopeWriter,
    SCOPE_COMPATIBILITY_VERSION,
    SCOPE_RECORD_VERSION,
    ScopeEvidenceError,
    ScopeHeadConflictError,
    ScopeWriterFencedError,
    SQLiteTraceStore,
} from "../../src/index.ts";
import { appendUnrelatedRecord, registerAndClaim, temporaryDatabasePath } from "./fixtures.ts";

test("emission extends only the scope path, cites retained records, and replays exactly", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "emission");
    const store = new SQLiteTraceStore(databasePath);
    const { root, writer } = registerAndClaim(store);
    const cited = appendUnrelatedRecord(store, "cited");
    const first = emitScopeRecord(store, {
        citedRecordIds: [cited],
        commandId: "scope-command:emit-1",
        data: { note: "first", values: [1, 2, 3] },
        expectedHeadRecordId: root.head.record_id,
        nowMilliseconds: 1_500,
        writer,
    });
    assert.deepEqual(first, {
        command_id: "scope-command:emit-1",
        head: { owner_ordinal: 1, record_id: first.head.record_id },
        previous_head_record_id: root.head.record_id,
        scope_id: root.scope_id,
    });
    const retained = store.readRecord(first.head.record_id);
    assert.ok(retained);
    assert.equal(retained.envelope.schema_ref, "shepherd.scope.emission.v1");
    assert.deepEqual(retained.envelope.caused_by_record_ids, [root.head.record_id, cited]);
    assert.deepEqual(retained.body, {
        cited_record_ids: [cited],
        command_id: "scope-command:emit-1",
        compatibility_version: SCOPE_COMPATIBILITY_VERSION,
        data: { note: "first", values: [1, 2, 3] },
        expected_head_record_id: root.head.record_id,
        scope_id: root.scope_id,
        scope_version: SCOPE_RECORD_VERSION,
    });
    assert.deepEqual(
        retained.views.map((view) => view.owner_id),
        [root.scope_id],
    );
    assert.equal(store.readOwner("run:cited").length, 1);

    const second = emitScopeRecord(store, {
        commandId: "scope-command:emit-2",
        data: { note: "second" },
        expectedHeadRecordId: first.head.record_id,
        nowMilliseconds: 1_500,
        writer,
    });
    assert.equal(second.head.owner_ordinal, 2);

    // Exact replay after the head advanced, after release, and across reopen.
    const replayOptions = {
        citedRecordIds: [cited],
        commandId: "scope-command:emit-1",
        data: { values: [1, 2, 3], note: "first" },
        expectedHeadRecordId: root.head.record_id,
        nowMilliseconds: 99_000,
        writer,
    };
    assert.deepEqual(emitScopeRecord(store, replayOptions), first);
    releaseScopeWriter(store, { writer });
    assert.deepEqual(emitScopeRecord(store, replayOptions), first);
    assert.throws(
        () => emitScopeRecord(store, { ...replayOptions, data: { note: "changed" } }),
        AppendIntentConflictError,
    );
    assert.throws(
        () => emitScopeRecord(store, { ...replayOptions, commandId: "scope-command:emit-2" }),
        AppendIntentConflictError,
    );
    store.close();

    using reopened = new SQLiteTraceStore(databasePath);
    // A handle from another store instance is refused; a fresh fence replays the same receipt.
    assert.throws(() => emitScopeRecord(reopened, replayOptions), TypeError);
    assert.deepEqual(
        emitScopeRecord(reopened, {
            ...replayOptions,
            writer: claimScopeWriter(reopened, {
                claimId: "claim:reopened",
                nowMilliseconds: 99_000,
                scopeId: root.scope_id,
            }),
        }),
        first,
    );
    assert.deepEqual(readScopeCommandReceipt(reopened, "scope-command:emit-1"), {
        command: "emit",
        receipt: first,
    });
    const inspection = inspectScope(reopened, root.scope_id);
    assert.deepEqual(inspection?.head, second.head);
    assert.deepEqual(
        inspection?.history.map((entry) => entry.kind),
        ["registration", "emission", "emission"],
    );
});

test("emission requires a current fence, exact head, and retained citations", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "emission-admission");
    using store = new SQLiteTraceStore(databasePath);
    const { root, writer } = registerAndClaim(store);
    const base = {
        data: { note: "x" },
        expectedHeadRecordId: root.head.record_id,
        nowMilliseconds: 1_500,
        writer,
    };
    assert.throws(
        () =>
            emitScopeRecord(store, {
                ...base,
                citedRecordIds: [`sha256:${"b".repeat(64)}`],
                commandId: "scope-command:unknown-citation",
            }),
        ScopeEvidenceError,
    );
    assert.throws(
        () =>
            emitScopeRecord(store, {
                ...base,
                commandId: "scope-command:stale-head",
                expectedHeadRecordId: `sha256:${"c".repeat(64)}`,
            }),
        ScopeHeadConflictError,
    );
    const emitted = emitScopeRecord(store, { ...base, commandId: "scope-command:ok" });
    assert.throws(
        () => emitScopeRecord(store, { ...base, commandId: "scope-command:behind" }),
        ScopeHeadConflictError,
    );
    const taker = claimScopeWriter(store, {
        claimId: "claim:taker",
        nowMilliseconds: 40_000,
        scopeId: root.scope_id,
    });
    assert.throws(
        () =>
            emitScopeRecord(store, {
                ...base,
                commandId: "scope-command:superseded",
                expectedHeadRecordId: emitted.head.record_id,
                nowMilliseconds: 40_000,
            }),
        ScopeWriterFencedError,
    );
    assert.equal(
        emitScopeRecord(store, {
            ...base,
            commandId: "scope-command:taker",
            expectedHeadRecordId: emitted.head.record_id,
            nowMilliseconds: 40_000,
            writer: taker,
        }).head.owner_ordinal,
        2,
    );
    assert.equal(inspectScope(store, root.scope_id)?.history.length, 3);
});

test("emission rejects forged writers, non-canonical or oversized data, and malformed options", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "emission-options");
    using store = new SQLiteTraceStore(databasePath);
    const { root, writer } = registerAndClaim(store);
    const valid = {
        commandId: "scope-command:valid",
        data: { note: "x" },
        expectedHeadRecordId: root.head.record_id,
        nowMilliseconds: 1_500,
        writer,
    };
    const cases: unknown[] = [
        { ...valid, writer: { ...writer } },
        { ...valid, data: null },
        { ...valid, data: [] },
        { ...valid, data: { nested: new Date() } },
        { ...valid, data: { big: "x".repeat(65_536) } },
        { ...valid, citedRecordIds: [root.head.record_id] },
        { ...valid, citedRecordIds: ["not-a-record"] },
        { ...valid, citedRecordIds: [`sha256:${"a".repeat(64)}`, `sha256:${"a".repeat(64)}`] },
        {
            ...valid,
            citedRecordIds: Array.from(
                { length: 65 },
                (_, index) => `sha256:${index.toString(16).padStart(64, "0")}`,
            ),
        },
        { ...valid, citedRecordIds: { length: 0 } },
        { ...valid, commandId: 1 },
        { ...valid, nowMilliseconds: "now" },
        { ...valid, extra: true },
        { commandId: "scope-command:missing", data: {}, writer },
    ];
    for (const options of cases) {
        assert.throws(() => emitScopeRecord(store, options as never), TypeError);
    }
    assert.equal(inspectScope(store, root.scope_id)?.history.length, 1);
    const defaultNow = emitScopeRecord(store, {
        commandId: "scope-command:default-now",
        data: { note: "default" },
        expectedHeadRecordId: root.head.record_id,
        writer: claimScopeWriter(store, { claimId: "claim:now", scopeId: root.scope_id }),
    });
    assert.equal(defaultNow.head.owner_ordinal, 1);
});
