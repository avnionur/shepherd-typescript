# Changeset Inspection

Implementations: [`src/workspace/changeset-inspection.ts`](../src/workspace/changeset-inspection.ts)
and [`src/workspace/git-changeset-inspection.ts`](../src/workspace/git-changeset-inspection.ts).
Public entry point: [`src/index.ts`](../src/index.ts). Tests:
[`test/workspace/changeset-inspection.test.ts`](../test/workspace/changeset-inspection.test.ts)
and
[`test/workspace/git-changeset-inspection.test.ts`](../test/workspace/git-changeset-inspection.test.ts).

Workspace protocol v11 adds authenticated read-only inspection without changing workspace
protocol v5 changeset identity. `createWorldChangesetInspection` reopens and verifies the exact
retained base/head revisions through their package-authenticated reference carrier. It then
exposes frozen exact-path lookup, configured bounded pagination, content reads, text previews, and
derived move projections. These operations never consult or mutate the user workspace.

## Retained content and previews

Content reads accept only a regular-file content ID cited by the canonical changeset. Every read
revalidates the retained revision, manifest citation, byte length, and blob digest, then returns a
defensive byte copy limited by the configured offset/length contract. Missing, malformed,
uncited, corrupted, or out-of-range evidence fails with `WorldChangesetError`.

Text previews authenticate the complete blob before classifying it. A NUL byte or ill-formed
configured UTF-8 sequence produces an explicit binary result with no decoded text. Valid text is
bounded independently by configured source-byte and decoded-line limits and reports truncation.
Preview generation invokes no external diff driver, text converter, or user-workspace read.

## Derived moves

`derivedMoves()` compares exact regular-file content identities. One deleted source paired with
one added target is presented as a rename; an unchanged source paired with an added target is a
copy. Ambiguous duplicate-content sources or multiple rename targets produce no unstable pairing.
Candidate count is configured and bounded. These projections never enter `changeset_id`; the
canonical representation remains delete/add.

## Git-aware presentation

`createGitChangesetInspection` accepts two exact Git-aware custody IDs under one initialized
workspace. It authenticates both retained Git descriptors with bounded verification concurrency,
composes the ordinary world inspection, and projects clean stage-zero Gitlink index entries as
external commit citations. Gitlink add, delete, commit modification, and file/Gitlink replacement
are presentation changes only. Changed symbolic links expose retained Git mode evidence where an
authenticated worktree index exists. Git-head custody has no index projection and remains fully
inspectable through its canonical world changeset.

Gitlink contents are never recursively captured or read. Similarity-based Git rename settings do
not participate in canonical identity or exact-content move derivation.

Selection, settlement, and user-worktree materialization remain separate public capabilities; an
inspection value cannot itself authorize or perform a user-workspace mutation.
