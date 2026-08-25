# Retained-output publication CLI research

Status: Phase 4 Task 15 implemented oracle record

## Pinned oracle

- Repository: `https://github.com/shepherd-agents/shepherd`
- Tag: `v0.3.0`
- Revision: `a8196d4c453514836d06bd2fece91a03cdc37107`
- CLI source: `shepherd/packages/dialect/src/shepherd_dialect/cli.py`

The shipped `run publish-retained-workspace-output RUN_REF` command activates the workspace and
calls `workspace.runs.publish_retained_workspace_output(run_ref)`, emitting JSON. Its purpose is to
publish or repair the retained workspace-output citation for one run.

## Native mapping

The TypeScript retained output is already an exact record inside the immutable committed execution
cut. `OutputCitationEntry` reconstructs that run/output/capture/cut citation deterministically, so
a committed native output needs no redundant publication record. The compatibility command requires
the exact run ID and returns the same citation idempotently.

A terminal-pending-cut run cannot be repaired safely from a raw run ID. Native recovery requires
the original task, provider, runner, binding, carrier, capture ID, base revision, budget, and a
command identity. The CLI therefore returns a configured unavailable remedy instead of inferring
authority. Prefix/latest aliases are also refused because this is a publication-shaped command,
not an ergonomic read selector.

Successful compatibility verification opens SQLite read-only and appends nothing. Archive imports
can verify portable committed citations but do not gain local recovery authority.
