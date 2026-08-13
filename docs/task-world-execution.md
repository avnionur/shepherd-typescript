# Fenced task-world execution

Implementation: [`src/workspace/task-world-execution.ts`](../src/workspace/task-world-execution.ts).
Public types: [`src/workspace/task-world-execution-types.ts`](../src/workspace/task-world-execution-types.ts).
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

On the successful path, the carrier captures one immutable child, Task 5 produces its canonical
changeset, and the user binding is observed again without being supplied as runner authority. The
world record, ordinary outcome, and lifecycle terminal commit atomically under the same invocation
fence. The subsequently published immutable cut includes that complete terminal group; a lost cut
publication remains the existing terminal-pending-cut recovery state. Durable recovery validates
the capture record and its causal position while continuing to reconstruct the ordinary task
result.

This Task 6B.2 slice does not yet append the pre-invocation capture journal needed for restart or
retry. It also does not recover uncertain writers, create/delete paths, expose captured output via
a dedicated restart read model, or define cancellation cleanup. Those are Task 6B.3–6B.4. A
failure after start therefore remains recovery-required and must not be retried as if no external
work occurred.
