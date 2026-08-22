# Retained-World Application Research

Status: implemented in `1.41.0` as workspace protocol v24.

## Pinned oracle

The behavioral comparison used the Shepherd source pinned by `upstream.lock.json`, revision
`a8196d4`, including `examples/apply_onto_moved_workspace.py`, dialect application public/E2E
tests, `vcs_core/_retained_output_application.py`, and settlement operations.

Observed oracle behavior:

- application degenerates to the candidate when the current parent did not move;
- otherwise base-to-current and base-to-candidate paths must be equal/prefix/portable-alias
  disjoint after Unicode normalization and case folding;
- application preserves the complete current world and adds only the candidate delta;
- overlap refuses before consuming the output, leaving selection or discard available;
- no content weaving or rename detection is part of the contract;
- non-degenerate application creates a fresh merged revision;
- published application recovery competes consume-once with selection and discard.

## TypeScript contract

The TypeScript slice represents that behavior with configured conflict vocabulary, bounded
content-addressed conflict evidence, an exact durable three-way plan, a protected deterministic
merge custody, and the existing dependency-scheduled publication journal. The plan records both
input changesets and the exact current-to-merged publication changeset. Public inspection exposes
conflicts before admission and the retained plan after planning.

The implementation deliberately preserves repository state outside managed world paths. Git HEAD,
index, sparse, untracked, ignored, and unrelated dirty state are evidence/preservation concerns,
not inputs to a Git merge. Git administrative candidate paths fail before admission.

## Explicit non-claims

This slice does not claim byte-for-byte identity with private upstream record encodings, textual
merge behavior, rename intelligence, Git history mutation, `release`, repair CLI behavior, or full
`0.3.0` compatibility. Upstream Python remains a behavioral oracle and is not a runtime dependency.
