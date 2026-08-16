# Complete Changeset Data Model Research

Status: Phase 3 changeset target contract; Task 5 implements the canonical copy-world core and
later inspection/adapters close the explicitly identified Gitlink and projection requirements

Research date: 2026-08-12

Pinned Shepherd shipped revision: `a8196d4c453514836d06bd2fece91a03cdc37107` (`v0.3.0`)

Pinned Shepherd development revision: `d45074e0099d9ccafeed4a233702ad68ff8a2fa6`

## Primary sources and evidence boundary

Shepherd sources:

- [v0.3.0 checked quickstart](https://docs.shepherd-agents.ai/start/)
- [v0.3.0 runs concept](https://docs.shepherd-agents.ai/concepts/runs/)
- [generated v0.3.0 CLI reference](https://docs.shepherd-agents.ai/reference/cli/)
- [pinned shipped source tree](https://github.com/shepherd-agents/shepherd/tree/a8196d4c453514836d06bd2fece91a03cdc37107)
- [pinned development source tree](https://github.com/shepherd-agents/shepherd/tree/d45074e0099d9ccafeed4a233702ad68ff8a2fa6)

Official Git specifications:

- [`diff-format`](https://git-scm.com/docs/diff-format)
- [`git-diff`](https://git-scm.com/docs/git-diff)
- [`git-diff-tree`](https://git-scm.com/docs/git-diff-tree)
- [`git-diff-files`](https://git-scm.com/docs/git-diff-files)
- [`git-status`](https://git-scm.com/docs/git-status)
- [`git-fast-import`](https://git-scm.com/docs/git-fast-import)

Local normative inputs:

- [`architecture.md`](./architecture.md), “Changesets”
- [`reference-copy-carrier-research.md`](./reference-copy-carrier-research.md)
- [`git-aware-custody-research.md`](./git-aware-custody-research.md)

Verified Shepherd behavior is deliberately narrow: a retained output exposes a read-only
changeset, `changed_paths`, and retained-file reading before settlement. The CLI has a read-only
`run changeset` command that accepts read selectors. Public docs do not publish the changeset wire
schema, identifier algorithm, directory semantics, rename policy, limits, or error taxonomy.

Git's raw diff format verifies useful vocabulary: source/destination modes and object names,
add/delete/modify/type/unmerged statuses, and optional rename/copy similarity. It also verifies that
NUL-delimited output is required for unambiguous machine path parsing. Git diff output is an
adapter input, not the canonical Shepherd changeset, because raw worktree OIDs may be zero and
rename/copy detection is configurable and heuristic.

## Design invariants

One changeset is a deeply immutable, content-addressed comparison between exactly two verified
world revisions of one binding:

```ts
type Changeset = {
  readonly schemaVersion: string;
  readonly changesetId: string;
  readonly bindingId: string;
  readonly baseRevisionId: string;
  readonly headRevisionId: string;
  readonly changes: readonly PathChange[];
};
```

The base and head revisions are ordered, not an unordered pair. Direction is an explicit caller
selection: arbitrary verified revisions for the same binding may be compared, so ancestry is not a
requirement. Both must cite the same binding and supported manifest schema. A changeset does not own
mutable custody, authorize settlement, or prove that the user's current workspace still equals the
base.

`changesetId` is the configured domain-separated canonical digest of the schema version, binding
ID, exact base/head revision IDs, and canonical `changes`. It excludes timestamps, absolute paths,
storage receipts, previews, Git similarity scores, and host-specific observations. Empty changes
remain a valid, identity-bearing comparison.

## Node model

Every preimage or postimage is absent or one closed `WorldNode`:

```ts
type WorldNode =
  | { readonly kind: "directory"; readonly mode: number }
  | {
      readonly kind: "file";
      readonly mode: number;
      readonly contentId: string;
      readonly byteLength: number;
    }
  | { readonly kind: "symlink"; readonly mode: number; readonly target: string }
  | { readonly kind: "gitlink"; readonly mode: number; readonly commitOid: string };
```

`contentId` addresses exact regular-file bytes in carrier custody. Symlink identity is its target
text and mode, never the referent. A gitlink is the superproject's external commit citation; it
does not claim custody of submodule contents. Directories have no content digest because the
ordered child paths already cover tree content.

Modes use one versioned portable semantic subset. POSIX files preserve the supported permission
bits; Git adapters preserve the meaningful Git modes (`100644`, `100755`, `120000`, `160000`) and
translate them into the same node kinds. Unsupported ACL, xattr, device, socket, FIFO, set-id, or
hard-link-topology semantics are explicit capture errors, never omitted changes.

## Path-change model

Use one primitive per canonical path:

```ts
type PathChange = {
  readonly path: string;
  readonly operation: "add" | "delete" | "modify" | "replace";
  readonly before: WorldNode | null;
  readonly after: WorldNode | null;
};
```

Validation derives the operation; callers cannot choose contradictory labels:

- `add`: `before === null`, `after !== null`;
- `delete`: `before !== null`, `after === null`;
- `modify`: both present, same `kind`, and at least one covered semantic differs;
- `replace`: both present with different `kind`.

Consequences:

- regular-file byte edits and file mode-only changes are `modify`;
- directory mode changes are `modify`;
- symlink-target or symlink-mode changes are `modify`;
- gitlink commit or mode changes are `modify`;
- file↔directory, file↔symlink, directory↔symlink, and any gitlink transition are `replace`;
- identical before/after nodes are forbidden because they are not changes.

Directories are explicit nodes so empty-directory add/delete and directory mode changes survive.
When a non-empty subtree is added/deleted, include the directory and every descendant node. For a
replace involving a directory, include the replace at that path plus the necessary descendant
adds/deletes. This makes reconstruction exact without inventing implicit tree behavior.

## Canonical paths and ordering

Paths are root-relative, non-empty, forward-slash-separated canonical strings. Reject absolute
paths, empty components, `.` / `..`, NUL, malformed Unicode, backslash as a separator, trailing
slash, duplicate paths, and the configured protected control-root component. The node at binding
root itself is outside the path list.

Order changes by the repository's canonical string ordering over `path`. Because each path appears
at most once, no operation tie-breaker is needed. Construction sorts; validation rejects an
already-serialized record that is unsorted or duplicated. Never inherit locale, directory traversal,
Git `diff.orderFile`, filesystem enumeration, or rename-detection order.

Ancestor consistency is validated over both images:

- any present descendant requires every present ancestor represented by the corresponding world
  manifest to be a directory;
- a file, symlink, or gitlink cannot have a present descendant;
- directory replacement/add/delete entries and descendants must reconstruct both cited manifests
  exactly.

The strongest validation applies the entire changeset to the verified base manifest and requires
byte-for-byte semantic equality with the verified head manifest.

## Rename and copy treatment

Rename and copy are not primitive identity. A rename is canonically one delete plus one add; a copy
is canonically an add while the source remains. This follows the architecture requirement that
rename is optional derived information and avoids dependence on Git's similarity threshold,
configuration, rename limit, diff driver, text conversion, or pair-selection algorithm.

An optional immutable presentation projection may report:

```ts
type DerivedMove = {
  readonly kind: "copy" | "rename";
  readonly sourcePath: string;
  readonly targetPath: string;
  readonly basis: "exact-content" | "git-similarity";
  readonly score: number | null;
};
```

Derived moves are excluded from `changesetId` and settlement semantics. Exact-content pairing is
deterministic but still presentation. Git similarity scores are percentages of heuristic likeness,
are optional, and must retain Git version/options provenance. Ambiguous candidates may produce no
move rather than unstable pairing.

## Target public read model (Task 5 core plus Task 7 inspection)

Task 5 exposes the deeply frozen canonical `Changeset` and `changedPaths`. Task 7 adds:

- lookup of one exact path change;
- paginated/limited iteration over changes;
- retained content access through the cited `contentId`, with byte-range or bounded text reading;
- optional derived move and safe-preview projections clearly outside semantic identity.

Never embed complete file bytes or unbounded patches in the canonical record. Content remains in
the blob store and is verified by digest. Text previews require explicit byte and line limits,
well-formed decoding behavior, binary detection, and truncation metadata. Preview generation must
not run external diff/textconv drivers or read outside retained custody.

`changedPaths` is derived from `changes`, never separately supplied. Empty changes yield an empty
frozen list. Every returned node, path change, list, preview descriptor, and derived projection is
immutable and detached from mutable caller input.

## Validation and fail-closed behavior

Accept only closed plain data objects and dense arrays with exact keys, data properties, supported
prototypes, well-formed strings, safe integer sizes/modes, configured identifier prefixes and
digest lengths, and no symbols/accessors. Validate:

- schema version and identifier recomputation;
- binding/revision existence, integrity, and ordered relationship;
- base/head binding equality;
- canonical path safety, order, uniqueness, and control-plane exclusion;
- exact operation/nullability/kind relation;
- node mode/kind compatibility, content-ID existence, byte length, and blob digest;
- symlink target encoding without dereference;
- Git OID format using the cited repository object format;
- ancestor consistency and exact reconstruction from base to head;
- configured count, path-length, metadata-size, and aggregate referenced-byte limits.

Malformed data, missing blobs, revision mismatch, custody escape, excessive size, or concurrent
revision corruption yields a stable structured error and no partial changeset. Do not “repair” an
input by dropping duplicate/no-op/unsupported entries. Creation may sort validated definitions;
reopen validates stored canonical order exactly.

## Platform semantics

Changeset semantics are logical and portable within the declared manifest version:

- `/` is the record separator on every host;
- path comparison is canonical and case-sensitive even when a host filesystem is not;
- a carrier must reject two semantic paths that cannot coexist on its target host;
- Unicode strings preserve their validated code points; no unrecorded normalization is applied;
- file content is byte exact and binary safe;
- timestamps, inode numbers, ownership, allocation/sparse layout, and storage paths are excluded;
- supported modes are explicit; unsupported Windows/POSIX metadata never silently collapses;
- symlink targets are text records, and inability to materialize them is a later platform receipt,
  not permission to convert them into files.

A changeset may be inspectable on a platform that cannot materialize it. Later settlement must
fail closed or report the exact unsupported materialization capability.

## Limits and resource safety

All limits come from versioned configuration, not source literals. Task 5 configures:

- maximum changes per changeset;
- maximum path bytes and symlink-target bytes;
- maximum canonical record bytes;
- maximum single-blob and aggregate referenced bytes.

Task 7 adds maximum preview bytes/lines, derived-move candidates, and bounded verification
concurrency for its inspection service.

Limit failure occurs before publication where possible. Streaming construction may spool and hash
under custody, but the published semantic record is one complete canonical value. Do not let
partial pagination imply a partial changeset identity.

## Task 5 versus Task 6 boundary

Task 5 owns the canonical copy-world model, construction from two carrier-verified manifests,
validation, identity, immutability, and content citations. Carrier verification reads only retained
custody, never the user workspace. The current copy-world manifest represents files, directories,
and symlink targets; it does not retain numeric symlink modes or Gitlink nodes. Those two semantics,
content read helpers, previews, and derived move projections remain required before the Phase 3
inspection exit gate. Semantic identity expansion requires a new workspace protocol version;
non-semantic Task 7 projections remain outside the immutable v5 identity.

Task 6 integrates task execution with a retained fork, observes post-execution filesystem state,
captures a verified head revision, constructs this model, and attaches it to the durable run while
proving the user's worktree remained unchanged. Task 6 must not introduce a second delta schema or
derive changes directly from provider/tool claims.

Task 7 owns rich read-only inspection, including retained-content reads, bounded previews,
rename/copy projections, and the Git-aware adapter that exposes clean Gitlinks as commit citations.

Settlement, basis compare-and-swap, and user-worktree materialization remain later tasks. The
changeset describes what differs; it does not decide whether the change may be applied.

## Required Task 5 core conformance matrix

- empty comparison and deterministic ID/reopen;
- file/directory add and delete, including empty directories;
- text/binary content edits and mode-only edits;
- symlink add/delete/target changes without dereference;
- every file/directory/symlink type transition;
- subtree add/delete/replace reconstruction;
- path spaces, Unicode, long names, prefix siblings, and platform case collisions;
- malformed paths, duplicates, unsorted records, accessors, symbols, sparse arrays, and extra keys;
- missing/corrupt blobs, wrong lengths/digests, cross-binding revisions, and ancestor conflicts;
- `.vcscore` and path-escape rejection;
- every configured Task 5 count/byte limit;
- mutation attempts against every returned object/list;

## Required Task 7 inspection/adaptor matrix

- symlink-mode presentation where the source adapter retains it;
- every Gitlink type transition and Gitlink OID change without recursive submodule capture;
- exact-content rename/copy projections versus canonical delete/add;
- Git rename detection on/off and threshold changes leave canonical ID unchanged;
- every configured preview, derived-candidate, pagination, and verification-concurrency limit;
- equal semantic manifests from copy and Git adapters yield equal canonical changesets.

## Remaining Shepherd oracle gaps

Before claiming Python `0.3.0` changeset parity, capture the pinned implementation's JSON schema,
path order, directory/mode/symlink/submodule representation, ID rules, preview/read errors, limits,
and rename behavior. Current verified compatibility is limited to a durable read-only changeset,
ordered `changed_paths` as observed by the checked quickstart, retained-content inspection, and
read-selector CLI access.
