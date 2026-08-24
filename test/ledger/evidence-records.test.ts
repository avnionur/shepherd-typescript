import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
    EVIDENCE_RECORD_LATEST_SELECTOR,
    EVIDENCE_RECORD_LIMITS,
    LedgerSelectorAmbiguousError,
    LedgerSelectorNotFoundError,
    listOutputCitations,
    listRecoveryRecords,
    listTraceRevisions,
    ROOT_WITNESS_ID,
    resolveOutputCitationSelector,
    resolveRecoveryRecordSelector,
    resolveTraceRevisionSelector,
    SQLiteTraceStore,
} from "../../src/index.ts";
import { evidenceSchemaValidators } from "./schema-validators.ts";

test("trace revision ledger resolves immutable cut-bounded owner history", () => {
    using store = new SQLiteTraceStore();
    const first = store.append({
        append_intent_id: "append:trace-revision:first",
        batch: {
            groups: [
                {
                    owner_id: "run:trace-revision",
                    records: [
                        {
                            body: { phase: "first" },
                            mode: "capture",
                            schema_ref: "example.trace-revision.v1",
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    }).record_ids[0] as string;
    const firstCut = store.publishCut({
        cut_id: "cut:trace-revision:first",
        target_owner_id: "run:trace-revision",
        through_record_id: first,
    });
    assert.deepEqual(
        store.publishCut({
            cut_id: "cut:trace-revision:first",
            target_owner_id: "run:trace-revision",
            through_record_id: first,
        }),
        firstCut,
    );
    const second = store.append({
        append_intent_id: "append:trace-revision:second",
        batch: {
            groups: [
                {
                    owner_id: "run:trace-revision",
                    records: [
                        {
                            body: { phase: "second" },
                            caused_by_record_ids: [first],
                            mode: "capture",
                            schema_ref: "example.trace-revision.v1",
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    }).record_ids[0] as string;
    const secondCut = store.publishCut({
        cut_id: "cut:trace-revision:second",
        target_owner_id: "run:trace-revision",
        through_record_id: second,
    });
    const postCut = store.append({
        append_intent_id: "append:trace-revision:post-cut",
        batch: {
            groups: [
                {
                    owner_id: "run:trace-revision",
                    records: [
                        {
                            body: { phase: "post-cut" },
                            caused_by_record_ids: [second],
                            mode: "capture",
                            schema_ref: "example.trace-revision.v1",
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    }).record_ids[0] as string;

    const revisions = listTraceRevisions(store);
    assert.equal(revisions.length, 2);
    assert.equal(Object.isFrozen(revisions), true);
    const { traceRevision } = evidenceSchemaValidators();
    assert.equal(traceRevision(revisions[0]), true, JSON.stringify(traceRevision.errors));
    assert.equal(traceRevision({ ...revisions[0], trace_revision_version: 2 }), false);
    assert.equal(
        traceRevision({
            ...revisions[0],
            slice: { ...revisions[0]?.slice, extra: true },
        }),
        false,
    );
    assert.deepEqual(
        revisions.map(({ cut }) => `${cut.created_by_record_id}\0${cut.cut_id}`),
        [firstCut, secondCut]
            .sort((left, right) =>
                Buffer.from(`${left.created_by_record_id}\0${left.cut_id}`).compare(
                    Buffer.from(`${right.created_by_record_id}\0${right.cut_id}`),
                ),
            )
            .map((cut) => `${cut.created_by_record_id}\0${cut.cut_id}`),
    );
    const exact = resolveTraceRevisionSelector(store, secondCut.cut_id);
    assert.deepEqual(exact.cut, secondCut);
    assert.equal(exact.slice.read_address?.cut_id, secondCut.cut_id);
    assert.equal(exact.slice.visible_records_by_id[first] !== undefined, true);
    assert.equal(exact.slice.visible_records_by_id[second] !== undefined, true);
    assert.equal(exact.slice.visible_records_by_id[postCut], undefined);
    assert.deepEqual(resolveTraceRevisionSelector(store, "cut:trace-revision:s"), exact);
    assert.throws(
        () => resolveTraceRevisionSelector(store, "cut:trace-revision:"),
        LedgerSelectorAmbiguousError,
    );
    assert.deepEqual(
        resolveTraceRevisionSelector(store, EVIDENCE_RECORD_LATEST_SELECTOR),
        revisions.at(-1),
    );
    assert.deepEqual(listTraceRevisions(store, { limit: 1, offset: 1 }), [revisions[1]]);

    using imported = new SQLiteTraceStore();
    imported.importTrace(store.exportTrace());
    assert.deepEqual(listTraceRevisions(imported), revisions);
});

test("evidence record lists and selectors fail closed for empty or malformed reads", () => {
    using empty = new SQLiteTraceStore();
    assert.deepEqual(listOutputCitations(empty), []);
    assert.deepEqual(listTraceRevisions(empty), []);
    assert.deepEqual(listRecoveryRecords(empty), []);
    assert.equal(new LedgerSelectorAmbiguousError("ambiguous").code, "LEDGER_SELECTOR_AMBIGUOUS");
    assert.equal(new LedgerSelectorNotFoundError("missing").code, "LEDGER_SELECTOR_NOT_FOUND");
    for (const resolve of [
        resolveOutputCitationSelector,
        resolveTraceRevisionSelector,
        resolveRecoveryRecordSelector,
    ]) {
        assert.throws(
            () => resolve(empty, EVIDENCE_RECORD_LATEST_SELECTOR),
            LedgerSelectorNotFoundError,
        );
        assert.throws(() => resolve(empty, "evidence:missing"), LedgerSelectorNotFoundError);
        assert.throws(
            () => resolve(empty, "x".repeat(EVIDENCE_RECORD_LIMITS.maxSelectorBytes + 1)),
            TypeError,
        );
    }
    for (const list of [listOutputCitations, listTraceRevisions, listRecoveryRecords]) {
        assert.throws(() => list(empty, { extra: true } as never), TypeError);
        assert.throws(
            () => list(empty, { limit: EVIDENCE_RECORD_LIMITS.maxPageSize + 1 }),
            TypeError,
        );
    }

    const recordId = empty.append({
        append_intent_id: "append:latest-cut-collision",
        batch: {
            groups: [
                {
                    owner_id: "run:latest-cut-collision",
                    records: [
                        {
                            body: { phase: "collision" },
                            mode: "capture",
                            schema_ref: "example.trace-revision.v1",
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    }).record_ids[0] as string;
    empty.publishCut({
        cut_id: EVIDENCE_RECORD_LATEST_SELECTOR,
        target_owner_id: "run:latest-cut-collision",
        through_record_id: recordId,
    });
    assert.equal(
        resolveTraceRevisionSelector(empty, EVIDENCE_RECORD_LATEST_SELECTOR).cut.cut_id,
        EVIDENCE_RECORD_LATEST_SELECTOR,
    );
});

test("trace revisions reopen through the public API in a fresh process", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-trace-revision-fresh-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const databasePath = path.join(directory, "trace.sqlite");
    const store = new SQLiteTraceStore(databasePath);
    const recordId = store.append({
        append_intent_id: "append:fresh-trace-revision",
        batch: {
            groups: [
                {
                    owner_id: "run:fresh-trace-revision",
                    records: [
                        {
                            body: { phase: "fresh" },
                            mode: "capture",
                            schema_ref: "example.trace-revision.v1",
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    }).record_ids[0] as string;
    store.publishCut({
        cut_id: "cut:fresh-trace-revision",
        target_owner_id: "run:fresh-trace-revision",
        through_record_id: recordId,
    });
    store.close();
    const source = `
        import { listTraceRevisions, SQLiteTraceStore } from "./src/index.ts";
        using store = new SQLiteTraceStore(process.argv[1]);
        const [revision] = listTraceRevisions(store);
        process.stdout.write(JSON.stringify({
            count: listTraceRevisions(store).length,
            cutId: revision?.cut.cut_id,
            recordVisible: revision?.slice.visible_records_by_id[process.argv[2]] !== undefined,
        }));
    `;
    const output = execFileSync(
        process.execPath,
        ["--experimental-strip-types", "--input-type=module", "-e", source, databasePath, recordId],
        { cwd: path.resolve("."), encoding: "utf8" },
    );
    assert.deepEqual(JSON.parse(output), {
        count: 1,
        cutId: "cut:fresh-trace-revision",
        recordVisible: true,
    });
});
