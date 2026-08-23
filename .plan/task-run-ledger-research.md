# Task/run ledger and selector research

Status: Phase 4 Task 7 implemented oracle record

## Pinned oracle

- Repository: `https://github.com/shepherd-agents/shepherd`
- Revision: `a8196d4`
- Release surface: Shepherd `0.3.0`
- Primary files:
  - `packages/dialect/src/shepherd_dialect/workspace_control/queries.py`
  - `packages/dialect/src/shepherd_dialect/workspace_control/run_ledger.py`
  - `packages/dialect/src/shepherd_dialect/workspace_control/identities.py`
  - `packages/dialect/tests/test_nucleus_run_ledger.py`

This record extracts behavior from pinned source. It does not claim CLI compatibility.

## Extracted behavior

The upstream task ledger lists task versions in retained ledger order and optionally filters by
status and task-ID prefix. Exact `task_id@version` resolves one version. An unversioned task ID
selects its sole active version and is ambiguous when multiple active versions exist.

The upstream run ledger exposes task identity, status, start time, inputs/arguments, outputs,
trace, and workspace-control projections. Run records sort by `(started_at or "", run_ref)`.
Exact run IDs resolve first; otherwise a string is an unambiguous run-ID prefix. `@latest` uses the
selected manifest's retained `latest_run_ref`, with the last selected record as legacy fallback.
Missing selectors return `None`; ambiguous prefixes raise `ValueError`.

Typed upstream `RunRef` values are exact-only. `_validate_exact_run_ref` explicitly rejects
`@latest`, keeping read aliases out of mutation authority. This distinction is normative here.

## TypeScript contract and deliberate differences

The TypeScript trace store retains no import-stable cross-owner publication sequence or upstream
manifest alias. Its disposable run projection therefore sorts by canonical creation-record ID and
exact run ID bytes. Task entries sort by task-ID and version bytes. `@latest` means the final entry
in those documented canonical orders. This is deterministic across reopen and native archive
import and never consults clocks, filesystem metadata, SQLite row order, or a mutable alias.

Missing and ambiguous reads use stable typed errors instead of `None`/`ValueError`. Task and run
entries compose existing exact locks and retained inspection evidence without redefining any
canonical record. Task repository-grant companion evidence is accepted only as a package-created
authenticated handle because the v1 task registry does not persist companion grants. Durable
run journals retain grant plans, placement, jail, output, and settlement evidence directly.

The public TypeScript slice intentionally excludes CLI rendering, task status mutation, upstream
timestamp ordering, output-only commands, repair aliases, and mutation selectors. Those remain
separate roadmap work.

Existing native run IDs remain backward-compatible: if an exact run ID equals the configured
latest token, exact identity wins and no alias interpretation occurs.

## Conformance requirements

- exact ID beats prefix matching;
- empty, whitespace, oversized, malformed, and open option containers fail closed;
- ambiguous prefixes and empty-ledger latest fail with stable typed errors;
- pagination and canonical entry JSON are configuration-bounded;
- incomplete durable states are projected without repair;
- duplicate/corrupt creation evidence fails closed;
- ordering and latest survive store reopen and native trace export/import;
- task resolution, recovery, and settlement mutations retain exact-ID contracts.
