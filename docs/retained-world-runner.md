# Retained-World Runner

Implementation: [`src/workspace/retained-world-runner.ts`](../src/workspace/retained-world-runner.ts)
and [`src/workspace/retained-world-runner-types.ts`](../src/workspace/retained-world-runner-types.ts).
Tests: [`test/workspace/retained-world-runner.test.ts`](../test/workspace/retained-world-runner.test.ts).

`createRetainedWorldRunner` validates one closed runner definition and returns a frozen opaque
workspace-protocol-v7 registration handle. The public handle exposes only its stable runner
identity, configured enforcement classification, and protocol version. The executable callback
remains in a private package-owned registry. `captureTaskWorldDurably` is the authenticated
consumer of that registry and rejects a structurally similar caller object before forking custody
or retaining execution evidence.

The initial configured enforcement is `advisory`. It records the truth that this in-process
adapter is not a process jail or syscall boundary. Task 6B.2 issues an exact invocation-fenced
capability for existing regular UTF-8 files in isolated custody and attaches successful captured
world evidence to the terminal cut. Task 6B.3 adds the durable pre-invocation capture journal and
restart contract required beyond this successful path.
