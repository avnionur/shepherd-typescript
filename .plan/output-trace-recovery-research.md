# Output citation, trace revision, and recovery record research

Status: Phase 4 Task 8 implemented oracle record

## Pinned oracle

- Repository: `https://github.com/shepherd-agents/shepherd`
- Tag: `v0.3.0`
- Revision: `a8196d4c453514836d06bd2fece91a03cdc37107`
- Primary source:
  - `packages/dialect/src/shepherd_dialect/workspace_control/outputs.py`
  - `packages/dialect/src/shepherd_dialect/workspace_control/queries.py`
  - `packages/dialect/src/shepherd_dialect/workspace_control/schemas.py`
  - `packages/dialect/src/shepherd_dialect/trace.py`
  - `packages/dialect/src/shepherd_dialect/cli.py`
- Primary tests:
  - `packages/dialect/tests/test_workspace_control.py`
  - `packages/dialect/tests/test_workspace_control_core_loop.py`
  - `packages/dialect/tests/test_run_trace.py`
  - `packages/dialect/tests/test_run_repair.py`

This record extracts pinned behavior. It does not claim CLI or carrier-format compatibility.

## Output citations

Upstream `RunOutputCitationRef` binds output name and ID to a run trace reference, descriptor
locator, binding, store/resource identity, materialization kind, custody reference, output world,
and parent basis world. `run_output_citations` returns raw ledger citations and explicitly does not
claim that custody is present. Product output resolution is a separate fail-closed join between
the citation, trace-owned descriptor, and retained custody row. Binding filters preserve ledger
order. Exact-run mutation boundaries do not accept read aliases.

The TypeScript runtime already retains one stronger exact workspace-output object containing run,
capture, binding, base/head revision, changeset, custody, execution cut, terminal outcome, and
user-basis witnesses. `OutputCitationEntry` projects that cut-bounded object with the exact task
lock and terminal settlement citations. It is still a citation: listing it does not reopen or
verify physical carrier custody and grants no settlement authority.

## Trace revisions

Upstream trace revisions are immutable selected heads. Their payload includes runtime and identity
domains, trace owner/frontier/run identities, ordered events, causal edges, and owner paths. An
exact trace head can be read directly; run trace reads first resolve a run and then its materialized
trace head. Missing materialization is distinct from a missing run. Filtering, summaries, and
cross-run comparison are pure views over the selected revision.

The native TypeScript equivalent is an immutable published `Cut` plus `resolveCut`'s exact
graph-shaped owner-prefix `Slice`. The projection exposes complete canonical record envelopes,
payloads, paths, causality, anchors, and witnesses rather than synthesizing upstream event rows.
Canonical order is publication-record ID then cut ID, stable across reopen and native import.

## Recovery records and repair boundary

Upstream run records carry optional start/finish revision, runtime/authority operation, runtime
value, and trace-head references. Interrupted orphaned operation refs are repaired by the distinct
`shepherd run repair` command or best-effort pre-run reclaim. That command mutates bookkeeping and
belongs to the next roadmap issue, not this read projection.

TypeScript durable commands are already canonical owner records for recover, pause, resume, and
cancel. `RecoveryRecordEntry` lists those commands only within the current lifecycle bound and
shows directly caused retained effects, the validated lifecycle/recovery classification, and the
exact lifecycle head. Canonically retained claim/fence fields are reported as verified; the
private SQLite lease row is reported unavailable because native archive v1 does not carry it.
Reads never acquire a lease, append a command, invoke a provider, or repair a cut.

## Selector and conformance mapping

- exact ID wins before prefix or latest interpretation;
- unique prefixes and configured latest are read-only conveniences;
- missing and ambiguous reads use the existing stable typed selector errors;
- ordering never uses filesystem time, wall clock, SQLite row order, or mutable aliases;
- pagination, selector bytes, candidate counts, and canonical entry bytes are configured;
- terminal-pending outputs produce no citation until their exact execution cut exists;
- post-cut output, command, process, and trace records cannot enter a projection;
- duplicate/idempotent cuts collapse through the existing cut index;
- native export/import and fresh-process reopen reconstruct the same projection.

## Explicit non-claims

This slice does not implement upstream event filtering/summary/comparison, trace carrier heads,
output custody hydration, orphaned-operation repair, CLI commands, or stable CLI JSON. Those remain
separate roadmap work.
