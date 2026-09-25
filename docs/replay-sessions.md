# Replay Sessions

Implementation: [`src/replay/session.ts`](../src/replay/session.ts),
[`src/replay/records.ts`](../src/replay/records.ts),
[`src/replay/inspection.ts`](../src/replay/inspection.ts), and
[`src/store/replay-sessions.ts`](../src/store/replay-sessions.ts). Public entry point:
[`src/facades/replay.ts`](../src/facades/replay.ts) (`./replay`), with root exports from
[`src/index.ts`](../src/index.ts). Tests:
[`replay-session.test.ts`](../test/replay/replay-session.test.ts),
[`replay-evidence.test.ts`](../test/replay/replay-evidence.test.ts),
[`replay-boundaries.test.ts`](../test/replay/replay-boundaries.test.ts), and
[`replay-crash.test.ts`](../test/replay/replay-crash.test.ts). Design constraints:
[coupled replay contract](../.plan/coupled-replay-contract.md).

## Contract

`runReplaySession(store, options)` runs one deterministic session program and retains every
interaction with the outside world on the session's own owner path. The session identity is
derived from the command identity (`deriveReplaySessionId`). The program receives a
`ReplaySessionContext` and reaches the world only through it:

| Operation | Retained evidence |
| --- | --- |
| `invokeProvider(request, { dependsOn })` | Provider step: canonical request, prompt identity, output identity, observed usage, context prefix identity, cache evidence |
| `invokeTask({ dependsOn })` | Provider step whose request is derived from the task in force: `{ input, instruction, outputSchema }` |
| `dispatchEffect(intent, { dependsOn })` | Admission record before the handler, then an effect step with the disposition and the correlated outcome only when materialized |
| `checkpoint()` | A published cut and a coupled checkpoint descriptor; see [coupled checkpoints](./coupled-checkpoints.md) |

Everything else the program computes must be a deterministic function of prior step results.
Context operations are sequential: overlapping calls and calls after the program returned throw
`TypeError`. The session record retains the program identity, provider descriptor, task lock and
input, bound world names, bound process identities and backends, and the provider-session adapter
identity. Session bodies conform to the generated
[`replay-session-v1`](../spec/schemas/replay-session-v1.schema.json),
[`replay-step-v1`](../spec/schemas/replay-step-v1.schema.json),
[`replay-admission-v1`](../spec/schemas/replay-admission-v1.schema.json), and
[`replay-terminal-v1`](../spec/schemas/replay-terminal-v1.schema.json) schemas.

## Steps and identities

Every step has a zero-based index and declared dependencies. `dependsOn` names retained step
handles; when omitted, the step depends on its immediate predecessor. Dependencies are strictly
ascending, bounded, and earlier than the step; their records, the current head, and for recorded
steps the source step record are the step's causal parents.

Identities are runtime-derived digests with configured prefixes, never provider-supplied:

- prompt identity: the canonical request;
- response identity: the canonical output, or the retained failure;
- step identity: the provider prompt and response identities, or the effect intent reference,
  disposition, outcome, and failure;
- prefix identity: chained over every step identity;
- context prefix identity: chained over provider exchanges only.

Usage, timestamps, and delivery order never enter identity. Cache evidence records the context
prefix identity before the request, provider-reported cache read and creation token counts, an
optional cache identity declared by the provider-session adapter, and `hit` only when cache read
tokens were observed.

## Failures and terminal records

A provider invocation that throws or returns a malformed response is retained as a provider step
with a bounded failure and no cache evidence. A handler that throws or returns a malformed dispatch
is retained as `materialization_failed` without an outcome. Both raise `ReplayStepFailureError` to
the program, both when they first happen and whenever the step is later served from a recorded
prefix, so program control flow is identical.

The terminal record ends the session:

| Status | Meaning |
| --- | --- |
| `finished` | The program returned canonical semantic data, retained as `{ value }` |
| `failed` | The program threw or returned non-canonical data; the bounded failure is retained |
| `cancelled` | The caller's signal aborted; an interrupted provider call is not retained as a step |
| `rewound` | A rewind branch ended after restoration; see [rewind and replay](./rewind-and-replay.md) |

Failure names use the error's `name`, or its class name when the name is the default `Error`, and
messages are truncated to the configured UTF-8 bound on a character boundary.

## Leases and recovery

Store schema v12 adds `replay_sessions`, one row per session with the claim, monotonic fencing
token, lease expiry, and terminal and released flags. Opening a new session inserts the row with
the session record in one transaction. Every later append compares the fence, the unexpired lease,
and the exact owner head atomically; a terminal append releases the lease. A running writer renews
its lease when the renewal interval has elapsed, before appends and on a background timer while the
program awaits. A writer whose lease expired is fenced: the session context aborts and
`runReplaySession` throws `ReplayLeaseFencedError` without a terminal record.

Repeating a terminal command returns the retained receipt without running the program. A
non-terminal session is never resumed in place:

| Classification | Condition | Command behavior |
| --- | --- | --- |
| `terminal` | Terminal record retained | Receipt returned |
| `running` | Live row with an unexpired, unreleased lease, including a writer inside a handler | Another claim: `ReplayLeaseConflictError`; the same claim: `ReplaySessionInterruptedError` |
| `materialization_uncertain` | No live lease and an admission is not followed by its step | `ReplayMaterializationUncertainError`; the handler is never re-invoked |
| `interrupted` | No terminal record and no live lease, including imported sessions | `ReplaySessionInterruptedError` |

Recovery is a rewind or replay from a retained checkpoint or step boundary before the interruption.
Process tests kill a writer between steps and after an admission and recover through rewind.

## Inspection and reserved owners

`inspectReplaySession(store, { sessionId, clock?, lowerProof? })` folds every record on the session owner path
and validates versions, schemas, modes, witnesses, causal parents, step order and dependencies,
chained identities, cache evidence, admission before materialization, recorded steps against their
source steps, checkpoint cuts and constituents, restore evidence, terminal consistency, and the live
row. For a branch it also folds the source session and binds the restore record to the cited
checkpoint or step boundary, each recorded step to the exact source step content, and every live
suffix effect to the replay approval rule. It appends nothing and works on read-only, reopened, and
imported stores; imported sessions
have `live: false`. Unsupported record versions raise `ReplayCompatibilityError`; every other
inconsistency raises `ReplayEvidenceError`.

### Proof envelope

Every session inspection carries `proof`: `runtime_only` for a root session and the configured
`extension` profile for a branch session, whose rewind (`fork`) and replay (`replay`) are
publication controls. With `lowerProof: true`, an eligible static root session is lowered into
Core-A records and classified by the executable reference machine (`reference_core_a` /
`reference_validated`, never proof-backed); an ineligible session keeps its envelope and reports
`metadata.lowering_ineligible`. Receipts returned by session commands carry the unlowered envelope.
Normative rules: [inspection envelopes](./formal-assurance.md#inspection-envelopes). Tests:
[`test/formal/inspection-proof-envelope.test.ts`](../test/formal/inspection-proof-envelope.test.ts).

`SQLiteTraceStore.append` refuses groups on replay session owner paths, and `publishCut` refuses a
replay session as the publishing owner, so only fenced session transactions write session evidence.
Whole-store integrity scans verify each row against its first and last records
(`replay_session_mismatch`). Session rows are bookkeeping outside the record graph and are never
exported.
