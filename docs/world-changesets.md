# World Changesets

Implementation: [`src/workspace/changesets.ts`](../src/workspace/changesets.ts). Public entry point:
[`src/index.ts`](../src/index.ts). Tests:
[`test/workspace/changesets.test.ts`](../test/workspace/changesets.test.ts).

`await createWorldChangeset({ baseRevision, carrier, headRevision })` constructs workspace protocol
v5's immutable comparison of two exact copy-world revisions. It verifies both revisions through
their authentic reference carrier, reads only retained custody, changes no custody or user files,
and requires both revisions to cite the same workspace binding.

## Canonical model

Each changed path occurs once, ordered by its UTF-8 bytes. An `add` has only an after-image, a
`delete` only a before-image, a `modify` has the same entry kind on both sides, and a `replace`
changes entry kind. Before/after nodes preserve regular-file content IDs and lengths, directory
and file modes, and symlink target text without dereferencing it. Explicit directory entries make
empty directories and subtree reconstruction unambiguous.

The changeset ID hashes its configured schema version, binding ID, ordered base/head revision IDs,
and complete canonical changes. `changed_paths` is derived from the frozen change list and is not
an independent input. Empty comparisons still have deterministic identities. Rename and copy are
presentation projections over canonical delete/add records and do not affect identity.

## Validation and limits

Construction independently recomputes both world-content and revision identities, reopens and
verifies the retained bytes through the carrier, validates
closed dense manifests, canonical paths and ordering, ancestor-directory consistency, entry
semantics, and the protected control-root exclusion. Configured path, symlink, blob, aggregate,
change-count, and canonical-record bounds fail with `WorldChangesetError`; malformed or
cross-binding evidence fails closed with a distinct configured code.

This Task 5 module describes retained copy-world differences only. The current carrier records
symlink targets but no independent numeric symlink mode. Task 6 owns post-execution capture away
from user files. Read helpers, previews, optional rename/copy projections, and Gitlink citations
from the Git-aware adapter belong to Task 7; selection and settlement remain later tasks.
