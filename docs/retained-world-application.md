# Retained-World Application

Implementation: [`src/workspace/retained-world-application.ts`](../src/workspace/retained-world-application.ts),
[`src/workspace/retained-world-settlement.ts`](../src/workspace/retained-world-settlement.ts), and
[`src/store/retained-world-application-codec.ts`](../src/store/retained-world-application-codec.ts).
Public entry point: [`src/index.ts`](../src/index.ts). Production-seam evidence:
[`test/workspace/retained-world-apply.test.ts`](../test/workspace/retained-world-apply.test.ts) and
[`test/workspace/retained-world-application-schema.test.ts`](../test/workspace/retained-world-application-schema.test.ts).

`applyRetainedWorldSettlement` settles one exact retained candidate onto the current user world
when the candidate delta and current delta from their shared immutable base are path-disjoint. An
unchanged current parent is a degenerate application of the candidate. An advanced current parent
creates a fresh immutable merged revision by applying the candidate changes to a protected copy of
the current revision. The user tree is published only from that authenticated merged revision.

## Conflict contract

`inspectRetainedWorldApplicationConflicts` is a pure public classifier. Inputs are closed, dense,
unique arrays of canonical world paths. Comparison normalizes each path with configured NFC and
case folding. Equal paths, portable aliases, and ancestor/descendant relationships conflict; no
content weaving or rename inference is attempted. Evidence is canonical, content-addressed,
sorted, and bounded by configuration. `prepareRetainedWorldSettlement({ action: "apply", ... })`
performs this check before consume-once admission, so overlap leaves the output available for a
later exact `select` or `discard` decision.

For Git repository bindings, preparation and application revalidate the exact repository
authority. Candidate paths that name Git administrative metadata are refused. Materialization
changes only managed world paths and preserves the user's HEAD, index, sparse state, dirty files,
untracked files, ignored files, and unrelated current edits.

## Durable planning and recovery

Workspace protocol v24 adds closed application conflict, plan, and receipt schemas. The
content-addressed plan binds the request, compatibility version, base/current/candidate/merged
revisions and content, both input changesets and path sets, publication changeset, deterministic
application custody, configured reason, and status. `inspectRetainedWorldApplicationPlan` returns
that authenticated plan after durable planning without reading user or carrier files.

The settlement journal moves `prepared` to `applying` only after the merged revision and exact plan
exist. Publication reuses the dependency-scheduled selection carrier and its two semantic-basis
checks. A retry authenticates the same plan, immutable revisions, scheduled carrier prefix,
terminal receipt, and citation. Concurrent callers and fresh processes converge on one result;
third-state paths, moved bases, altered plans, corrupt evidence, or another consume-once action fail
closed. The protected application custody is discarded only after terminal settlement and citation
publication; the immutable merged revision remains available as evidence.

## Boundary

Application is strictly path-disjoint. It does not perform textual conflict resolution, rename
detection, directory synthesis beyond the canonical changeset, Git commit/index mutation, or an
upstream `release` custody transition. `release`, repair commands, and CLI settlement commands
remain separate Phase 4 work.
