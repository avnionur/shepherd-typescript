# Output citations, trace revisions, and recovery records

These APIs are bounded immutable read projections over existing task/run, cut, output, settlement,
command, lifecycle, and archive evidence. They do not add canonical records or authority.

## Protocol contract

`protocol.config.json` owns evidence projection version `1`, compatibility namespace
`shepherd.output-trace-recovery.v1`, exact schema destinations/IDs, the latest token, stable
selector errors, pagination/candidate limits, selector bytes, and canonical entry bytes. Generated
closed schemas cover `OutputCitationEntry`, `TraceRevisionEntry`, and `RecoveryRecordEntry`.
Existing task, run, output, cut, command, settlement, and archive identities are unchanged.

## Output citations

`listOutputCitations` and `resolveOutputCitationSelector` expose only retained outputs with a
published terminal execution cut. Each entry includes:

- exact run and durable creation identity;
- exact task artifact lock;
- base/head revisions, changeset, custody, binding, capture, and output identity;
- terminal outcome record and immutable execution cut;
- validated capture-journal evidence;
- ordered terminal settlement citations for that exact output.

A terminal-pending-cut capture has no output citation yet and is omitted without repair. Later
owner records cannot alter the output because the underlying run projection matches the exact
journal output record inside the terminal cut. This is citation evidence, not proof that carrier
bytes remain physically available; settlement APIs perform their own exact custody validation.
Pagination is applied after incomplete captures are removed. Exact output IDs use the configured
indexed JSON field lookup, while prefix/latest reads scan only the configured bounded candidate
set; an oversized candidate set fails closed instead of returning a partial page.

## Trace revisions

`listTraceRevisions` and `resolveTraceRevisionSelector` treat every published cut as an immutable
native trace revision. The entry contains the verified `Cut` and `resolveCut` result using full
payload visibility and both record modes. The slice exposes owner paths, selected record bodies and
envelopes, direct causal edges, external anchors, and witness evidence. Records appended after the
cut's inclusive owner ordinal cannot appear.

The CLI exposes the same projection through both `run trace` and the documented distinct `run
trace-revision` command. Their human list/show bytes are identical; JSON retains the invoked command
identity and returns `trace_revisions` or `trace_revision` respectively.

Canonical order is publication-record ID then cut ID. It is independent of SQLite insertion order
and survives native archive import. Equal cut publication remains idempotent and produces one
revision.

## Recovery records

`listRecoveryRecords` and `resolveRecoveryRecordSelector` project one durable run's validated
recovery/control evidence:

- current recovery classification and complete lifecycle inspection;
- exact lifecycle head bounding the read;
- ordered canonical recover, pause, resume, and cancel commands;
- direct bounded effect records caused by each command;
- verified claim/fencing evidence when those fields exist in a canonical record;
- explicit `unavailable` when claim state exists only in the private SQLite lease table.

Terminal runs include the lifecycle prefix plus the exact cut-publication record and any recovery
command it directly cites, so command-authorized missing-cut repair remains visible. Non-terminal
runs include validated commands after the current lifecycle head so a retained pause request
remains visible; each command still passes its exact kind/run/head/fence decoder. Uncited
post-terminal commands are excluded. The projection never recovers, pauses, resumes, cancels,
acquires a claim, or repairs evidence.
Command envelopes must cite the exact creation, lifecycle head, and continuation descriptor
required by their decoded kind. Verified claim/fence evidence is accepted only from the configured
running-continuation schema already validated by durable inspection; unrelated records cannot
upgrade the explicit unavailable classification.

## Read selectors and limits

All three areas accept exact IDs, unique prefixes, and the configured latest token for reads.
Exact IDs win. Missing and ambiguous selectors raise `LedgerSelectorNotFoundError` and
`LedgerSelectorAmbiguousError`. Mutation, recovery, and settlement functions continue to require
exact IDs and command authority.

List option containers are closed and accept only positive configured `limit` plus non-negative
`offset`. Selectors, candidates, returned entries, and canonical JSON bytes are bounded by the
evidence projection policy. Empty lists are valid; malformed or corrupt retained evidence fails
closed.

## Persistence and evidence

Native trace export/import retains all canonical inputs to these projections. Fresh processes
reconstruct output citations, trace revisions, and recovery records without private in-memory
handles. Private invocation-lease rows are deliberately not inferred after import.

- Public exports: [`src/index.ts`](../src/index.ts)
- Output citations: [`src/ledger/output-citations.ts`](../src/ledger/output-citations.ts)
- Trace revisions: [`src/ledger/trace-revisions.ts`](../src/ledger/trace-revisions.ts)
- Recovery records: [`src/ledger/recovery-records.ts`](../src/ledger/recovery-records.ts)
- Public trace tests: [`test/ledger/evidence-records.test.ts`](../test/ledger/evidence-records.test.ts)
- Pinned research: [`.plan/output-trace-recovery-research.md`](../.plan/output-trace-recovery-research.md)
