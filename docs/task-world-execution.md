# Fenced task-world execution

Implementation: [`src/workspace/task-world-execution.ts`](../src/workspace/task-world-execution.ts).
Public types: [`src/workspace/task-world-execution-types.ts`](../src/workspace/task-world-execution-types.ts).
Journal inspection: [`src/workspace/task-world-journal.ts`](../src/workspace/task-world-journal.ts).
Tests: [`test/workspace/task-world-execution.test.ts`](../test/workspace/task-world-execution.test.ts).

`captureTaskWorldDurably` authenticates package-created runner, binding, and reference-carrier
handles before any durable execution evidence is retained. It verifies an exact immutable base,
observes the user binding, forks isolated custody, and invokes the registered callback with a
frozen capability tied to the durable invocation claim and fencing token.

`captureGrantedTaskWorldDurably` adds the workspace-protocol-v21 explicit repository grant seam.
It authenticates the complete exact-resource plan, task artifact, active repository binding, and
current Git evidence before runner/provider invocation. `readText` and `writeText` then require the
configured operation atoms respectively. The prepared journal records the complete exact grant
plan and its ID; `recoverGrantedTaskWorldDurably` refuses a changed task grant, ceiling, or
resource. The v2 schema carries journal v10 while the unchanged v1 schema and journal v9 remain
readable. See
[`repository-grants.md`](./repository-grants.md).

`capturePlacedGrantedTaskWorldDurably` composes granted execution with an authenticated placement
resolution. The complete requested/resolved placement is present in prepared journal evidence
before runner/provider invocation and is returned with the task-world result. New attempts use
journal v11/v3; unchanged v9/v1 and v10/v2 evidence remains readable. See
[`placement-resolution.md`](./placement-resolution.md).

`captureJailedGrantedTaskWorldDurably` composes the exact grant plan with an authenticated native
jail resolution and structured judged-process command. Native attempts use journal v12/v4 and
retain the complete backend/probe/command/resolution plus confinement plan, process start, bounded
output, terminal receipt, and quiescence evidence. Provider execution and custody capture continue
only after exit code zero and proven process-group quiescence. See
[`native-jail-execution.md`](./native-jail-execution.md).

The current advisory capability reads and replaces existing regular UTF-8 files beneath custody.
Paths are binding-relative; absolute paths, traversal, Shepherd control-directory access, symbolic
links, non-files, malformed UTF-8, and configured size-limit violations fail closed. Granted Git
repository capture additionally denies Git administrative paths; legacy ordinary capture retains
its prior treatment of an ordinary `.git`-named directory. The
claim is checked before each operation and again after opening the file. A capability retained after
callback settlement is stale. Advisory enforcement is an in-process package contract, not a process jail or
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
therefore legacy retained evidence. Ordinary capture writes journal v9/v1, unplaced granted capture
writes v10/v2, advisory placed granted capture writes v11/v3, and native jailed granted capture
writes v12/v4. All four exact pairs remain readable.

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
unchanged. Native jailed execution separately requires terminal process and process-group
quiescence evidence before capture. A launch intent without terminal evidence remains uncertain
and is never replayed automatically. Create/delete capability methods, simultaneous multi-world
custody, and an explicit `release` transition remain later runtime/settlement work. Captured
outputs can use the separate path-disjoint application coordinator described in
[`retained-world-application.md`](./retained-world-application.md).
