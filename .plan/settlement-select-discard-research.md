# Exact-ID Select and Discard Research

Status: Phase 3, Task 8 contract input. This document records verified upstream behavior and the
TypeScript-owned settlement policy needed before implementation. It is not an implemented API.

## Question

What exact identity, admission, durability, workspace-mutation, and cleanup rules must govern
`select` and `discard` for a retained task-world output?

The immediate planning question is whether exact-ID verbs can ship before the roadmap's separate
consume-once compare-and-swap task. They cannot: consume-once is part of the meaning of both
verbs, not a later optimization.

## Sources and authority

Primary upstream sources were read at pinned Shepherd commit
`d45074e0099d9ccafeed4a233702ad68ff8a2fa6`:

- [official CLI reference](https://docs.shepherd-agents.ai/reference/cli/);
- [official quickstart](https://docs.shepherd-agents.ai/start/);
- [project README at the pinned commit](https://github.com/shepherd-agents/shepherd/blob/d45074e0099d9ccafeed4a233702ad68ff8a2fa6/README.md);
- [`_retained_output_settlement.py`](https://github.com/shepherd-agents/shepherd/blob/d45074e0099d9ccafeed4a233702ad68ff8a2fa6/vcs-core/packages/core/src/vcs_core/_retained_output_settlement.py);
- [`_retained_output_settlement_ops.py`](https://github.com/shepherd-agents/shepherd/blob/d45074e0099d9ccafeed4a233702ad68ff8a2fa6/vcs-core/packages/core/src/vcs_core/_retained_output_settlement_ops.py);
- [`_retained_output_selection.py`](https://github.com/shepherd-agents/shepherd/blob/d45074e0099d9ccafeed4a233702ad68ff8a2fa6/vcs-core/packages/core/src/vcs_core/_retained_output_selection.py).

Local authority comes from:

- [`decisions-and-risks.md`](./decisions-and-risks.md), especially D-009;
- [`testing-and-release.md`](./testing-and-release.md), especially settlement properties;
- [`git-aware-custody-research.md`](./git-aware-custody-research.md), especially basis movement;
- [`task-world-capture-research.md`](./task-world-capture-research.md), especially custody and
  capture identity;
- the local `Agent-Runtime-Architecture.md` discussion output. It does not define retained-output
  settlement, so this contract extends it without attributing unverified settlement semantics to
  that document.

## Verified upstream behavior

The following behavior is verified from published documentation and pinned source:

1. A retained output is inspected before it is settled.
2. `select`, `apply`, `release`, and `discard` are terminal settlement verbs.
3. A retained output is settled exactly once. A later different verb refuses instead of creating
   another terminal result.
4. Mutating CLI settlement commands require exact run/output identity rather than ergonomic read
   selectors.
5. `select` publishes the retained candidate into the parent only when the parent binding still
   matches the candidate's fork basis.
6. `discard` is receipt-only with respect to the parent world: its before and after parent-world
   identities are equal.
7. Settlement receipts bind the retained candidate, binding, parent, custody/handoff, output world,
   operation, action, and parent world before/after.
8. Selection has recovery logic for a world published before its terminal receipt. Receipt-only
   verbs probe for such interrupted publication and refuse a second settlement.
9. A lost acknowledgment does not authorize a different result. Recovery completes or returns the
   already-published operation identified by the same retained output and deterministic operation.

The upstream implementation serializes settlement within its manager and uses deterministic refs,
operation identities, publication recovery, and a terminal settlement receipt. These are semantic
requirements for compatibility; its Git-ref storage mechanics are not a required TypeScript
implementation technique.

## Not verified upstream

Published upstream sources do not define a portable TypeScript contract for:

- SQLite record schemas or transaction boundaries;
- atomic replacement of an arbitrary non-Git user directory;
- Windows settlement behavior;
- crash recovery across a SQLite transaction and ordinary filesystem rename;
- whether immutable output bytes may be deleted after terminal discard;
- the exact CLI spelling of a future TypeScript output locator;
- optimized-carrier settlement mechanics.

These remain TypeScript-owned policy and must not be described as upstream parity unless pinned
oracle fixtures later prove them.

## Identity model

Settlement accepts one closed exact request. It must bind at least:

- settlement protocol version;
- caller-assigned command ID for idempotent retry;
- action (`selected` or `discarded`);
- exact `run_id`;
- exact retained `output_id`;
- exact `capture_record_id` and `execution_cut`;
- exact `binding_id`;
- exact `base_revision_id`, `head_revision_id`, `changeset_id`, and `custody_id`;
- expected adopted/basis identity;
- store and carrier authority identities where the implementation exposes more than one authority.

The request is rejected before mutation if any supplied citation disagrees with recovered terminal
execution evidence, carrier evidence, binding identity, or Git-aware custody evidence. No field is
resolved through `latest`, a partial prefix, a name selector, current HEAD, or a directory scan.

`command_id` is idempotent for this entire closed request. Reusing it with any different field is a
conflict even when the run and output are unchanged.

## Settlement state and consume-once rule

The durable state machine is:

```text
unconsumed
  -> prepared(action, exact request, expected basis)
  -> applying(action, operation receipt)
  -> selected | discarded
```

Only one transition out of `unconsumed` may win. Admission is an atomic compare-and-swap in the
durable store, not a read followed by an append. A retry of the exact winning command returns or
repairs that command's state. A different command or action receives an already-settled/conflict
result and performs no carrier or user-workspace mutation.

`prepared` and `applying` are recovery states, not permission for another verb. Every public read
must validate the closed prefix and fail closed on duplicate, reordered, unknown, or inconsistent
settlement evidence.

This consume-once admission must ship with the first public `select` or `discard`. Therefore the
old roadmap split—Task 8 public verbs followed by Task 9 consume-once CAS—was unsafe. Task 8 owns
the exact identity/admission foundation; Task 9 completes and exposes the two verbs with the shared
CAS and recovery protocol.

## Select contract

`select` is fast-forward settlement of one retained head into its exact user binding.

Before the first user-workspace write it must:

1. authenticate and reopen the exact durable retained output;
2. verify the execution cut and capture evidence;
3. verify immutable base/head revisions and every required blob/object receipt;
4. revalidate the canonical binding and protected control boundary;
5. recapture the current basis using the same adoption-mode semantics as capture;
6. require exact equality with the retained output's adopted basis;
7. acquire the consume-once settlement decision and exclusive mutation authority;
8. verify writer quiescence at the supported advisory boundary.

Selection materializes the retained head, including additions, removals, file bytes, directories,
symlink targets, and supported modes, without reading content from the mutable custody after the
head has been captured. It must never copy `.vcscore` into the user tree.

The basis is checked again at the final mutation boundary. Movement before that point refuses
without consuming the output. Movement or interruption after mutation begins is recovery-required:
the implementation must not report success, allow a second settlement, or guess from current
filesystem content.

Git-aware settlement must preserve the adopted mode's semantics. It must not silently commit,
checkout, reset, stash, mutate unrelated refs/config, or widen the managed world. The exact
materialization and Git publication algorithm belongs to Task 9 implementation and its fault
harness.

## Discard contract

Public settlement `discard` is distinct from `ReferenceCopyCarrier.discard(custodyId)`:

- settlement discard makes the retained output terminally consumed;
- carrier discard is exact physical cleanup of mutable custody;
- settlement authority is durable trace/store evidence;
- physical cleanup is a recoverable consequence and may be retried after the terminal decision.

Discard never mutates the user binding, parent revision, base revision, captured head, execution
records, or terminal cut. It authenticates the same exact output citations as select, wins the same
consume-once admission, records `discarded`, and then performs idempotent exact-custody cleanup.

A cleanup failure leaves a terminal discarded settlement plus a pending cleanup condition; it does
not make the output selectable again. A cleanup success must not delete immutable revisions or
blobs still cited by the execution trace unless a future independently authorized garbage
collector proves they are unreachable.

## Cross-resource crash model

SQLite and the user filesystem do not provide one shared transaction. The implementation must use
a durable operation journal and deterministic receipts rather than claim atomicity it cannot
provide.

- Before filesystem mutation: failure may roll back/refuse admission when no external effect was
  published.
- After `prepared`: recovery uses the exact request and observed receipts; another command cannot
  take over.
- During select materialization: recovery verifies staged and target evidence and either completes
  the same operation or reports recovery-required. It never starts discard.
- After target publication but before terminal receipt: recovery recognizes the exact selected
  target and writes the missing terminal receipt.
- After terminal discard but before custody cleanup: recovery retries cleanup only.

Publication must use same-filesystem staging and atomic rename where the host supports the required
semantics. Multi-path tree replacement still needs an explicit journal and fault-injection proof;
individual atomic renames do not make the whole tree atomic.

## Error classes

Stable configured errors must distinguish at least:

- invalid/forged exact request;
- output absent or not terminally retained;
- malformed retained evidence;
- already settled by the same command;
- already settled by a different command/action;
- basis moved;
- binding/control-path authority changed;
- settlement busy/fenced;
- unsupported filesystem semantics;
- select recovery required;
- physical discard cleanup pending or corrupt.

Do not collapse basis movement, contention, corruption, and unsupported platform behavior into one
generic invalid-output error.

## Required conformance matrix

### Exact identity and consume once

- forged run/output/capture/cut/binding/revision/changeset/custody citation fails before mutation;
- selector-like or partial identities are not accepted by the public mutation API;
- same command and exact request is idempotent after lost acknowledgment;
- same command with changed request conflicts;
- concurrent select/select, select/discard, and discard/discard produce one winner;
- restart returns or repairs the original decision and never settles another output.

### Select

- unchanged basis selects the exact captured head;
- moved HEAD/index/worktree/sparse/ignore/submodule evidence refuses as applicable to adoption mode;
- additions, deletions, replacements, empty directories, symlinks, modes, binary files, and unusual
  names materialize exactly;
- protected control paths and unmanaged content are not overwritten;
- source/custody corruption and movement fail before user mutation;
- crash points before staging, during staging, before publication, after publication, and before the
  terminal receipt recover deterministically;
- user Git refs, config, and unrelated state remain unchanged.

### Discard

- user workspace and immutable parent/base/head are byte-for-byte unchanged;
- exact mutable custody cleanup is idempotent and symlink-safe;
- terminal decision survives cleanup failure and restart;
- later select/apply/release/discard refuses after discard;
- repeated same-command discard returns the original decision.

### Preservation

- read-only changeset inspection remains non-mutating before and after settlement;
- ordinary carrier cleanup retains its existing low-level behavior;
- durable task recovery/cancellation cannot create or bypass settlement evidence;
- legacy retained outputs without settlement evidence remain classified as unconsumed only when
  their protocol version is explicitly supported.

## Implementation sequence

### Phase 3, Task 8 — exact settlement identity and admission foundation

- configure and generate the settlement vocabulary, schemas, limits, and stable errors;
- define closed public exact-request and read-only settlement-state types;
- authenticate retained output citations through the recovery and carrier seams;
- add the durable consume-once compare-and-swap and exact-command replay rules;
- implement fail-closed inspection for unconsumed/prepared/applying/terminal evidence;
- keep user-workspace mutation and public terminal verbs private until Task 9.

### Phase 3, Task 9 — public select/discard effects and recovery

- implement fast-forward select staging, final basis revalidation, publication, and restart repair;
- implement terminal discard plus idempotent physical custody cleanup;
- expose public exact-ID `select` and `discard` only after concurrent CAS and crash recovery pass;
- record settlement citations in the execution trace/projection;
- close the relevant platform/fault matrix or document unsupported cases with repeatable gates.

### Phase 3, Task 10 — control-plane protection and exit hardening

- complete control-plane path protection at every materialization seam;
- close remaining carrier/Git platform and process-interruption gates;
- run the Phase 3 exit audit and update parity claims.
