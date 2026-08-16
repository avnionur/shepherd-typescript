# Retained-World Settlement Admission

Implementation:
[`src/store/retained-world-settlements.ts`](../src/store/retained-world-settlements.ts).
Authenticated coordinator:
[`src/workspace/retained-world-settlement.ts`](../src/workspace/retained-world-settlement.ts).
Public entry point: [`src/index.ts`](../src/index.ts). Production-seam tests:
[`test/store/retained-world-settlements.test.ts`](../test/store/retained-world-settlements.test.ts)
and [`test/workspace/task-world-execution.test.ts`](../test/workspace/task-world-execution.test.ts).
Public discard recovery is covered by
[`test/workspace/retained-world-discard.test.ts`](../test/workspace/retained-world-discard.test.ts).
Workspace protocol v14-v16 plan, dependency-schedule, and scheduled receipt evidence is covered by
[`test/workspace/selection-publication-codec.test.ts`](../test/workspace/selection-publication-codec.test.ts).
Reference-carrier materialization and recovery is covered by
[`test/workspace/reference-copy-selection-publication.test.ts`](../test/workspace/reference-copy-selection-publication.test.ts).
Public exact-ID selection and store-terminal repair is covered by
[`test/workspace/retained-world-select.test.ts`](../test/workspace/retained-world-select.test.ts).

## Implemented foundation

Workspace protocol v12 defines the closed `select`/`discard` vocabulary, durable settlement
states, exact request identity, version, and stable validation/conflict errors. Trace-store schema
v6 adds one durable settlement row per exact retained `output_id`, plus unique `command_id` and
content-addressed `request_id` identities.

Trace-store schema v7 extends that row with nullable operation, receipt, and cleanup-evidence
columns. Migration preserves every schema-v6 `prepared` request exactly and leaves the new columns
null. Workspace protocol v13 adds configured deterministic operation and terminal-receipt codec
versions plus the content-addressed operation identity prefix. The closed codec binds the entire
authenticated request into the operation, requires canonical persisted JSON, distinguishes
selected publication from discarded cleanup evidence, and forbids discard from changing the user
basis.

Workspace protocol v14 adds the closed language-neutral selection-publication contract used by the
next carrier slice. A deterministic plan binds the exact applying operation, request, immutable
base/head content, canonical ordered changeset, configured journaled-path atomicity, and staging
identity. Each path step binds its exact ordinal, before/after change, prior step, and applied
status. A terminal carrier receipt binds the complete step chain, immutable head content, staging
identity, and basis before/after. All three values are canonical, content-addressed, closed,
resource-bounded, generated into a published JSON Schema, and compatibility-locked. This release
does not stage or publish user files.

Workspace protocol v15 adds a separate canonical, content-addressed schedule bound to one exact
v14 plan. Canonical changes remain the changeset identity order. The schedule contains a complete
permutation of those ordinals, preserves bytewise order for unrelated paths, publishes directory
construction before descendants, and publishes descendants before removing or replacing a
directory. The v14 plan, path-step, and terminal-receipt encodings remain unchanged. This schedule
is protocol evidence only; it does not itself stage bytes or mutate user paths.

Task 9.4B2B1 implements authenticated carrier staging. The carrier reconstructs the exact plan
from its operation, canonical changeset, and verified base/head revisions, reconstructs the v15
schedule, then copies only the immutable retained head into the deterministic protected staging
identity. It flushes the staged bytes, plan, and schedule before publication, reopens equal retries
exactly after restart, rejects conflicting or corrupted custody, and never reads or changes the
user binding.

Workspace protocol v16 adds a separate dependency-scheduled step chain. Each record binds its
operation ordinal, canonical change ordinal, exact change, prior step, v14 plan, and v15 schedule.
The corresponding terminal receipt requires the complete scheduled prefix and binds the exact
schedule, operation, staging identity, immutable head, and before/after basis witnesses. Existing
v14 steps and receipts and the v15 schedule remain unchanged. This evidence layer performs no
filesystem mutation; scheduled user-path effects and durable-prefix recovery remain Task
9.4B2B2B.

Workspace protocol v17 adds terminal execution-trace settlement citations. After a selected
receipt is retained, or after discarded cleanup reaches its final receipt, the coordinator
idempotently appends a configured citation record under the durable run and publishes a
deterministic immutable cut through it. The record binds the exact command, request, operation,
terminal receipt, output, capture record, execution cut, outcome record, and terminal lifecycle
record. A crash after the append but before cut publication leaves the settlement terminal and is
repaired by an equal retry without replaying carrier effects.

`inspectDurableTaskExecution` projects these citations as frozen settlement values. It validates
canonical codecs, record causality, citation cuts, and the local journal when present. Native
trace export/import reconstructs the same result without importing the private settlement table.
Missing cuts, malformed canonical evidence, duplicate output/command authority, or journal
disagreement fail closed.

Task 9.4B2B2B implements that reference-carrier effect seam. Before the first write it requires the
package-owned observer to reproduce the admitted semantic basis. It then validates or replays the
exact retained prefix, applies only the next dependency-scheduled change from immutable staging,
flushes and verifies the exact after node, and atomically links its canonical step receipt. Exact
after state can repair a missing receipt without rewriting; any third state stops recovery. The
complete prefix retains its basis-after witness inside deterministic staging before a separate
terminal carrier receipt is published. Equal concurrent calls converge, and restart revalidates
both authorities. This internal seam does not by itself admit or terminalize settlement.

`selectRetainedWorldSettlement` is the public exact-ID selection coordinator. It revalidates the
admitted execution and immutable carrier revisions, reconstructs the canonical changeset, and
requires the current binding basis to equal the admitted base before it starts the deterministic
operation. The carrier observes the basis again before its first managed-path write, applies or
recovers the exact scheduled prefix, and publishes its content-addressed receipt. Only then does
the store retain the selected terminal receipt citing that exact publication and final basis.
Applying retries resume the carrier prefix; a carrier-complete/store-incomplete retry repairs only
the terminal store receipt; selected retries authenticate both authorities. Any third-state path
or moved final basis fails closed without overwrite.

Task 9.2B2 implements those trace-store writers. One `BEGIN IMMEDIATE` transaction derives and
retains the exact operation while moving `prepared` to `applying`; another retains the exact
action-specific terminal receipt while moving `applying` to `selected` or `discarded`. Equal
retries replay the validated journal, different receipts conflict, skipped transitions fail before
mutation, and every restart read validates the complete nullable-column combination. Selection
keeps discard cleanup evidence null; discard retains its explicit cleanup-progress boolean. These
internal transitions also advance a discarded receipt from cleanup-pending to cleanup-complete
without changing its logical terminal state. They perform no carrier or user-filesystem operation.

`discardRetainedWorldSettlement` is the public exact-ID discard seam. It revalidates the admitted
execution and authentic carrier revisions, retains the deterministic operation, and publishes the
logical `discarded` receipt with cleanup pending before invoking the carrier's idempotent custody
discard. Cleanup completion is retained afterward. A crash after physical deletion therefore
reopens as cleanup pending, repeats only the exact carrier cleanup, and converges without reopening
admission or making the output selectable. Discard never reads or changes the user binding.

`SQLiteTraceStore.admitRetainedWorldSettlement` is the internal store-level compare-and-swap. One
`BEGIN IMMEDIATE` transaction either inserts the configured `prepared` decision, replays the exact
same request, or rejects a different command/request that already names the output or command.
`readRetainedWorldSettlement` verifies and returns the frozen prepared decision after restart.

The exact request binds action, protocol version, run, output, capture record, execution cut,
binding, base/head revisions, changeset, custody, user-basis witness, and caller command. Its
content-addressed ID uses the configured workspace digest and settlement prefix.

`prepareRetainedWorldSettlement` is the public authenticated admission seam. Before invoking the
store compare-and-swap, it reconstructs the committed durable execution, validates the exact
terminal cut and capture journal, authenticates the package-created binding and carrier, reopens
and verifies both immutable revisions, recomputes the canonical changeset, and verifies that the
cited mutable custody still contains the captured head. Any disagreement fails with the stable
configured invalid-settlement error before admission.

`inspectRetainedWorldSettlement` is the public restart-safe read seam. It returns `undefined` for
an exact output with no admission. For a retained decision it verifies the closed settlement row,
reconstructs the committed durable execution, and requires the cited cut, capture record, run,
binding, revisions, changeset, custody, and basis witness to agree. It performs no carrier or user
filesystem operation.

## Current boundary

The store primitive deliberately remains internal and trusts only the authenticated coordinator.
Preparation reads retained evidence and mutates only the durable settlement-admission row; it does
not mutate user files or physical custody. Public `select` and `discard` now compose this authority
with the effect journal and publish terminal trace citations only after the relevant terminal
receipt is durable. Carrier-level selection publication and `discard(custodyId)` remain internal
physical primitives and cannot create or bypass a settlement decision by themselves.
