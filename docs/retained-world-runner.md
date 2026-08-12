# Retained-World Runner

Implementation: [`src/workspace/retained-world-runner.ts`](../src/workspace/retained-world-runner.ts)
and [`src/workspace/retained-world-runner-types.ts`](../src/workspace/retained-world-runner-types.ts).
Tests: [`test/workspace/retained-world-runner.test.ts`](../test/workspace/retained-world-runner.test.ts).

`createRetainedWorldRunner` validates one closed runner definition and returns a frozen opaque
workspace-protocol-v7 registration handle. The public handle exposes only its stable runner
identity, configured enforcement classification, and protocol version. The executable callback
remains in a private package-owned registry. Task 6B.2 owns the first consumer of that registry and
must prove that a structurally similar caller object is rejected.

The initial configured enforcement is `advisory`. It records the truth that this in-process
adapter is not a process jail or syscall boundary. Task 6B.2 will issue the exact fenced
retained-world capability and invoke the private callback. Task 6B.3 will bind that invocation to
the durable capture journal and terminal cut. This foundation alone does not grant filesystem
access, invoke a provider, fork custody, or append trace evidence.
