# Retained-World Selection Publication Contract

Status: Phase 3, Task 9.4A implementation input. This document fixes the reference-carrier
publication and crash-repair boundary required before public retained-world `select` is exposed.
It does not describe an implemented API.

## Problem

The consume-once settlement row and deterministic effect journal already authorize exactly one
selection operation. They do not make a user-workspace tree update atomic with SQLite. The user
binding may also contain protected control state, Git administration, ignored files, or other
unmanaged content that selection must not replace.

Task 9.4 therefore needs a carrier-owned publication protocol. It must prove what was staged, what
was observed immediately before the first user-file write, which path effects completed, and what
exact tree was present before a selected terminal receipt is retained. Current target bytes alone
are never sufficient evidence that Shepherd published them.

## Authority and preservation boundary

Selection consumes only the exact authenticated request admitted by Task 8 and transitioned to
the exact deterministic `applying` operation by Task 9.2. It additionally requires:

- the package-authenticated workspace binding and reference carrier used during preparation;
- the immutable base and captured head revisions and their verified manifests;
- the canonical changeset named by the request;
- the configured adoption-mode basis witness;
- the protected workspace control root and the settlement operation ID.

No selector, current directory scan, inferred output, alternate command, or newly captured custody
may replace those citations. The public coordinator owns settlement admission; the carrier owns
filesystem staging and publication evidence. Neither layer may independently declare selection
terminal.

Selection changes only canonical managed paths described by the authenticated changeset. It must
preserve:

- the exact `.vcscore` control tree;
- Git administrative state, refs, configuration, index, and object stores;
- ignored or otherwise unmanaged user content;
- unrelated initialized bindings;
- immutable base/head revisions and retained content blobs;
- the existing consume-once result under retry and restart.

## Why whole-root rename is not the reference algorithm

The binding root itself can contain protected and unmanaged state. Replacing that directory with a
staged retained head would delete or relocate state outside the managed world. Renaming individual
files is atomic only per path and does not make the complete tree atomically visible.

The Task 9.4 reference implementation must therefore report a configured journaled-path-set
atomicity classification. It may use same-filesystem atomic rename for an individual staged node,
but it must not claim atomic whole-tree publication. A future carrier may advertise an atomic tree
exchange only behind a separately versioned capability with equivalent receipts and tests.

## Versioned publication plan

Before the first user-workspace write, the carrier retains one closed publication plan beneath the
protected control root. Its semantic evidence binds at least:

- selection-publication protocol version and configured publication kind;
- operation, request, command, run, output, and binding identities;
- immutable base/head revision, base/head content, and changeset identities;
- exact user-basis witness observed at admission;
- canonical ordered path operations with full before and after nodes;
- a verified same-filesystem staging-tree identity;
- a verified immutable rollback/before-tree citation;
- configured atomicity classification and path-operation limit;
- deterministic publication ID derived from all semantic fields.

Absolute staging paths, inode numbers, timestamps, random temporary names, and process IDs are
operational custody, not semantic identity. A closed carrier descriptor may retain the paths needed
to reopen owned staging, but restart must revalidate their containment and type before use.

The plan is immutable after publication. Progress is an ordered, durable, append-only chain of
closed step receipts under the same carrier authority. Each step binds the publication ID, its
ordinal, canonical path, expected before node, intended after node, previous step receipt, and
observed result. Unknown, duplicated, skipped, reordered, or conflicting steps fail closed.

## Staging and materialization

Staging reads bytes only from the verified immutable head revision and its authenticated blob
custody. It never copies from mutable task custody or from the current user workspace for intended
after content.

The carrier constructs a private tree on the same filesystem as its control root, then verifies:

1. every changed path is canonical, contained by the binding, and outside protected control and
   Git-administration paths;
2. every staged file digest, size, and supported mode equals the cited head node;
3. every directory and symlink target equals the cited head manifest;
4. the complete staged projection reconstructs the changeset's after nodes exactly;
5. no unsupported object, escaping link, alias, or path collision is present;
6. the staging descriptor and bytes are flushed before the plan is considered durable.

The immutable base revision is the authoritative expected-before tree. User bytes observed during
publication are validation inputs only; they never become retained source content.

## Two user-basis checks

Selection performs two independent checks with the same adoption-mode semantics used by capture:

1. **Admission check:** before staging or operation publication, recapture the current semantic
   basis and require equality with the request's basis witness.
2. **Publication-boundary check:** after staging and durable plan publication, immediately before
   the first managed-path mutation, recapture the basis again and require the same equality.

Movement before the second check produces the configured basis-moved result and no user-path
write. The consume-once request remains owned by the same command and may only be retried according
to its exact journal state.

The coordinator must not implement a read-then-write admission gap: another settlement cannot take
over once the operation is applying. Binding authority and control-root containment are also
revalidated at both checks.

## Journaled path publication

Operations are applied in the configured canonical order. For each path, recovery or first
execution compares the current managed node to the authenticated before and after nodes:

- exact before: apply the recorded operation from staged immutable content, flush it, verify exact
  after, then append the step receipt;
- exact after with the matching prior step prefix: verify it and append or replay the missing step
  receipt without rewriting the path;
- neither before nor after: stop with recovery-required and do not overwrite the third state.

Directory creation/removal ordering must respect the canonical reconstructive changeset. File and
symlink replacement uses owned same-directory staging and atomic rename where supported. Deletion
validates the exact before node before removal. Parent directories are never recursively removed
unless the plan proves they are managed, empty, and named by the changeset.

Every mutation is followed by descriptor-safe verification and the durability flushes supported by
the host. Unsupported rename, link, mode, or flush semantics fail before the affected mutation when
possible and otherwise leave the exact operation recovery-required.

The advisory in-process settlement fence does not exclude an external writer. Therefore a final
whole-basis and managed-head verification is mandatory. Concurrent movement detected after the
first mutation never reports success and is never repaired by overwriting unrecognized state.

## Publication completion and selected receipt

A carrier publication is complete only when:

- the full ordered step chain is valid;
- every changed path equals its authenticated after node;
- the complete managed world equals the immutable head content identity;
- protected and unmanaged evidence required by the adoption mode remains valid;
- the current semantic user basis is captured as the exact after witness;
- the carrier appends a closed published receipt and flushes its authority.

The published receipt binds the publication ID, operation ID, staging-tree identity, immutable head
content, basis before and after, final step receipt, and atomicity classification. The settlement
store's selected terminal receipt cites this exact carrier receipt. It does not recreate a
publication ID from current bytes.

Workspace protocol v13 remains immutable. Task 9.4B must introduce a new configured protocol
version for the expanded selection receipt and retain explicit decoding of any supported earlier
row. The trace-store schema may retain the new canonical receipt in its existing receipt columns
only if compatibility validation proves the nullable/state constraints remain unchanged; otherwise
it requires a new migrated schema version.

## Crash and restart classification

Recovery opens only the exact applying operation and its deterministic carrier publication ID.
Directory scans may locate that exact closed descriptor but may not choose a different candidate.

- **No plan:** no user write was authorized. Rebuild and publish the same deterministic plan.
- **Staged plan, no path steps:** revalidate staging and the second basis check, then begin or
  refuse on movement.
- **Partial step chain:** validate the complete prefix and every affected current node; continue
  only across exact before/after states.
- **All steps, no published receipt:** verify the complete managed head and basis-after evidence,
  then append the carrier receipt.
- **Published carrier receipt, no selected store receipt:** authenticate the carrier receipt and
  retain the missing exact selected terminal receipt.
- **Selected store receipt:** return the original result after validating both authorities.
- **Third-state path, malformed plan, missing staged bytes, or conflicting receipt:** return
  recovery-required without further user mutation.

Rollback is not automatic after publication begins. Restoring the before tree could overwrite a
concurrent user's third state and would create a second externally visible effect. A future
explicit repair command may choose completion or rollback under separately recorded authority.

## Failure and cleanup rules

Private staging that was never named by a durable plan may be removed as orphan temporary data.
Staging named by an applying operation remains recoverable authority and must not be garbage
collected. After selected terminal validation, redundant staging may be cleaned idempotently only
when the published receipt and immutable head remain independently verifiable.

Disk-full, permission, rename, fsync, process-interruption, and carrier-corruption failures retain
the last flushed prefix. An error response must distinguish basis movement, unsupported filesystem
semantics, contention, malformed evidence, and recovery-required partial publication.

## Required Task 9.4B production-seam evidence

### Authority and preservation

- forged binding, basis, revision, changeset, operation, staging, or publication identity fails;
- `.vcscore`, Git state, unmanaged/ignored content, other bindings, and immutable custody remain
  unchanged;
- mutable task custody is never used as publication source;
- public select cannot bypass prepared/applying consume-once authority.

### Basis and materialization

- movement before admission and between the two checks causes zero user-path writes;
- additions, edits, deletions, replacements, empty directories, binary files, unusual names,
  symlinks, and supported modes reconstruct the exact immutable head;
- changed-path third states refuse without overwrite;
- post-publication basis/head verification detects an external writer and never reports success.

### Crash and replay

- interruption before plan, after staging, after each path-effect class, after the final step,
  after carrier publication, and before store terminal retention reopens deterministically;
- exact retry returns the same operation, publication, and selected receipt identities;
- conflicting command/action cannot recover or replace an applying selection;
- missing/corrupt staging or progress evidence fails closed;
- no test infers publication solely from a target tree that happens to equal the head.

### Platform boundary

- Linux and macOS exercise the journaled reference algorithm;
- Windows support is claimed only after native rename, link, mode, and durability behavior passes
  the same matrix;
- unsupported host semantics return the configured error before mutation where the host can be
  classified in advance;
- deterministic fault injection covers permission, disk-full, rename, flush, and process-kill
  boundaries before Phase 3 exit.

## Task boundary

Task 9.4A owns this contract only. Task 9.4B1 implements the versioned plan, ordered step, terminal
publication codecs, schema, and compatibility lock without filesystem effects. Task 9.4B2
implements the authenticated reference-carrier staging and journaled publication seam. Task 9.4B3
then composes the expanded selected receipt, public exact-ID select coordinator, two basis checks,
restart repair, and focused fault tests. Task 9.5 attaches settlement citations to the execution
projection and closes the remaining cross-command concurrency and Phase 3 settlement fault matrix.
