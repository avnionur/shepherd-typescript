# Fenced task-world execution

Implementation: [`src/workspace/task-world-execution.ts`](../src/workspace/task-world-execution.ts).
Public types: [`src/workspace/task-world-execution-types.ts`](../src/workspace/task-world-execution-types.ts).
Journal inspection: [`src/workspace/task-world-journal.ts`](../src/workspace/task-world-journal.ts).
Tests: [`test/workspace/task-world-execution.test.ts`](../test/workspace/task-world-execution.test.ts).

`captureTaskWorldDurably` authenticates package-created runner, binding, and reference-carrier
handles before any durable execution evidence is retained. It verifies an exact immutable base,
observes the user binding, forks isolated custody, and invokes the registered callback with a
frozen capability tied to the durable invocation claim and fencing token.

The current advisory capability reads and replaces existing regular UTF-8 files beneath custody.
Paths are binding-relative; absolute paths, traversal, control-directory access, symbolic links,
non-files, malformed UTF-8, and configured size-limit violations fail closed. The claim is checked
before each operation and again after opening the file. A capability retained after callback
settlement is stale. Advisory enforcement is an in-process package contract, not a process jail or
syscall boundary.

Before runner admission, the runtime appends configured `prepared` and `forked` journal evidence
that binds the capture identity, runner, exact base, binding, observed user basis, and isolated
custody. Claim-guarded `executing` and `captured` transitions then bind the start fence and verified
head/changeset. Every transition is immutable, content addressed, strictly ordered, and validated
as part of ordinary durable recovery.

On the successful path, the carrier captures one immutable child, Task 5 produces its canonical
changeset, and the user binding is observed again without being supplied as runner authority. The
world record, ordinary outcome, and lifecycle terminal commit atomically under the same invocation
fence. The subsequently published immutable cut includes that complete terminal group; a lost cut
publication remains the existing terminal-pending-cut recovery state. Durable recovery validates
the capture record and its causal position while continuing to reconstruct the ordinary task
result. `inspectTaskWorldCaptureJournal` exposes the validated ordered prefix without invoking the
runner or carrier and reconstructs the same retained projection after the SQLite store reopens.
World records created under protocol v8 remain readable without journal transitions and are
therefore legacy retained evidence; protocol v9 capture attempts carry the ordered journal.

`recoverTaskWorldDurably` validates the exact original task, provider, budget, binding, base,
runner, capture, and configured limits before recovery. An explicit globally idempotent command
may resume `prepared`, reopen `forked`, repair terminal-pending-cut publication, or replay the exact
committed result. A live competing recovery loses the invocation claim and does not invoke the
runner. An `executing` journal remains uncertain and is refused because external work may already
have occurred.

Workspace protocol v10 assigns deterministic custody identity to the run/capture pair. Recovery
therefore converges after process interruption between custody publication and the `forked`
journal append without scanning carrier directories. Existing v9 `forked` evidence remains
recoverable by reopening its recorded custody identity. Missing, substituted, corrupt, or
cross-base custody and output evidence fails closed.

A runner that returns after cooperative cancellation is quiescent at the callback boundary; its
verified partial custody is retained beside the cancelled outcome while the user binding remains
unchanged. Process-jail enforcement, external-process termination proof, create/delete authority,
and phase-specific administrative discard remain later runtime/settlement work. No uncertain
writer is captured or retried automatically.
