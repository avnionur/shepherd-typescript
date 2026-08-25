# Retained-output CLI view research

Status: Phase 4 Task 13 implemented oracle record

## Pinned oracle

- Repository: `https://github.com/shepherd-agents/shepherd`
- Tag: `v0.3.0`
- Revision: `a8196d4c453514836d06bd2fece91a03cdc37107`
- CLI source: `shepherd/packages/dialect/src/shepherd_dialect/cli.py`
- Generated reference: `https://docs.shepherd-agents.ai/reference/cli/`
- Output wrapper tests: `shepherd/packages/dialect/tests/test_workspace_control_run_output_wrappers.py`
- Trace/run tests: `shepherd/packages/dialect/tests/test_run_trace.py` and
  `shepherd/packages/dialect/tests/test_nucleus_run_ledger.py`

The shipped CLI lists `run outputs`, `run changeset`, and `run vcscore` as read commands. Read
selectors accept latest and unique prefixes; exact mutation identities remain separate. Outputs
present validated retained products rather than raw citations. Changeset supports summary and a
bounded retained-file read. Vcs-core exposes the lower-level custody/revision/change citations
carried by the run record. Read-only commands offer JSON and must not settle the output.

## TypeScript mapping

The native projection addresses retained products by output ID rather than upstream run-reference
spelling. Exact output IDs, unique output-ID prefixes, and `@latest` are already the configured
public selector contract. `run outputs` therefore presents the existing cut-bounded
`OutputCitationEntry` with its exact run, task, output, world-capture, and settlement evidence.

`run changeset` resolves that citation, reopens the cited immutable base/head through the
workspace-owned reference carrier, and uses `createWorldChangesetInspection`. Summary output is a
configured page of canonical relative paths. `--read PATH` selects only a changed after-state
regular file and returns a configured bounded authenticated UTF-8 preview. Binary, missing,
deleted, non-file, corrupt, oversized, and unavailable-custody evidence fails closed. It never
reads the user workspace.

`run vcscore` exposes the full native output citation as the nearest stable counterpart to the
upstream public citation view. Native names and IDs remain unchanged; no upstream-private record
shape is synthesized.

## Persistence and security boundary

Outputs and vcs-core citations reconstruct from canonical archive/reopen evidence without private
in-memory handles. Changeset metadata remains in the citation, but content inspection also
requires the authenticated local carrier; native archive import alone cannot fabricate carrier
bytes. Every command opens SQLite read-only and invokes no provider, Git mutation, settlement,
repair, or recovery path. Human output contains only relative retained paths and exact evidence
IDs; JSON uses the configured closed result envelopes.
