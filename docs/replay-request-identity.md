# Replay branch request identity

Replay protocol v4 (13.0.0, #237) adds the separately versioned
[`replay-branch-request-v1`](../spec/schemas/replay-branch-request-v1.schema.json) journal.
Implementation: [`branch-request.ts`](../src/replay/branch-request.ts),
[`branch.ts`](../src/replay/branch.ts), and transactional admission in
[`replay-sessions.ts`](../src/store/replay-sessions.ts). Public entry:
[`./replay`](../src/facades/replay.ts), also exported from the root. Tests:
[`replay-request-identity.test.ts`](../test/replay/replay-request-identity.test.ts),
[`replay-branch.test.ts`](../test/replay/replay-branch.test.ts), and
[`replay-source-disposition.test.ts`](../test/replay/replay-source-disposition.test.ts).
Configuration: `replay.branch.request` in [`protocol.config.json`](../protocol.config.json).

## Normalized identity

Every rewind or replay command retains one immutable request record on a reserved owner beneath
its derived session identity. Its record ID is the content-addressed request identity. The body
contains the complete session declaration plus normalized source disposition and checkpoint policy:

| Bound semantic input | Normalization |
| --- | --- |
| Mode | Rewind and replay are distinct; root-session reuse is refused |
| Source | Exact session ID and source session record |
| Target | Exact checkpoint identity and resolved step boundary, or exact trace-only step count; derived source cut |
| Source disposition | Omitted option becomes the configured default |
| Declared changes | Omitted list becomes empty; supplied values retain the existing canonical-order validation |
| Replacement task | Artifact lock, instruction, validated input and output schema; null without a task change |
| Checkpoint policy | Null for rewind; configured default or normalized kind/interval for replay |
| Session declarations | Source program identity, initial task, provider descriptor, provider-session adapter identity, sorted world names and process identity/backend pairs |

Claim IDs, clocks, abort signals, restoration filesystem paths, compensation registry objects,
program callbacks, handler-stack objects and approval callbacks are operational bindings, not
serializable request identity. Changing callback behavior under the same declared identity does
not create a new command: callers must choose a new command for new behavior. Changing an output
root on a completed retry does not restore into that root; the original retained receipt is returned.
The provider descriptor is bound, but transport credentials and provider object identity are not.

## Admission and recovery

Options and logical target evidence are validated before reading a retained receipt. A changed
valid request raises `AppendIntentConflictError`; malformed options retain their validation errors.
No conflicting request invokes compensation, restores a world/process/provider session, or returns
the old receipt. New requests verify restoration prerequisites and compensation handlers before
reservation, preserving refusal before writes for unavailable targets and missing handlers.

A synchronous SQLite transaction then binds the append intent to the normalized request before
any compensation starts. Conflicting concurrent requests are refused; a root session cannot take
the same identity while a branch is reserved. Exact concurrent attempts retain existing lease or
compensation conflict behavior; retry after the winning attempt completes returns its receipt.
Compensation attempt ownership across triggers is still #240: handlers must remain idempotent.

If compensation throws before a branch session opens, the request journal remains. Reopening or
importing the trace and repeating the exact request can retry under the existing compensation
rules. A changed request stays refused. Session interruption after opening retains the existing
fail-closed recovery classification. New branch session records causally cite the request, and
session inspection validates the declaration against it.

`inspectReplayBranchRequest(store, commandId)` returns `{ record_id, request }`, including a
request-only interrupted attempt, or null when no journal exists. It appends nothing, validates
schema/version/provenance and works with read-only and imported traces. Unsupported request
versions raise `ReplayCompatibilityError`; malformed retained evidence raises `ReplayEvidenceError`.

## Older records

The existing session/step/checkpoint record schemas remain readable. Branches written before this
journal do not contain enough evidence to recover source disposition or checkpoint policy. Their
completed command cannot be safely retried through rewind/replay and raises
`ReplayCompatibilityError` without mutation. Inspection and archive export remain available.
There is no guessed migration or backfill. Inspect the existing result and effects first; create a
new command only when deliberately authorizing a new branch. The legacy fixture was exported by
the 12.0.2 build at PR #271, using an empty root and a retaining rewind.
