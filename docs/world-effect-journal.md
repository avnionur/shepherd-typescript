# Retained-world operation journal

From 13.1.0 (#238), the supplied retained-world capability automatically records every admitted
`readText` and `writeText` invocation. This is independent of final changesets: overwritten writes,
read results, and writes subsequently restored to the original content remain visible.

Public entry: [`./workspace`](../src/facades/workspace.ts) and the root export,
`inspectTaskWorldEffects(store, runId)`. Implementation:
[`world-effect-journal.ts`](../src/workspace/world-effect-journal.ts),
[`world-effect-records.ts`](../src/workspace/world-effect-records.ts), and
[`task-world-execution.ts`](../src/workspace/task-world-execution.ts). Types:
[`world-effect-types.ts`](../src/workspace/world-effect-types.ts). Configuration:
`workspaces.worldTaskCapture.operationJournal` in [`protocol.config.json`](../protocol.config.json),
locked by workspace protocol v28. The new
[`world-effect-journal-v1`](../spec/schemas/world-effect-journal-v1.schema.json) is separate from
existing capture-journal versions; their records remain readable.

Tests: [operation histories, grants, privacy, cancellation and publication failures](
../test/workspace/world-effect-journal.test.ts), [process interruption](
../test/workspace/world-effect-crash.test.ts), [evidence validation](
../test/workspace/world-effect-evidence.test.ts), and [configuration](
../test/workspace/world-effect-config.test.ts).

## Record sequence

All records are on the enclosing run owner, inside its retained terminal prefix. Their causal
chain begins at the invocation-fenced `executing` capture transition. Every append checks the
same claim and fencing token as the original capability. General `store.append` cannot forge
records under this operation schema.

| Phase | Retained evidence | Physical operation |
| --- | --- | --- |
| `opened` | Exact binding, base, custody, claim, fence, enforcement, effective authority and optional repository grant/resource identities | None; capability issuance |
| `intent` | Runtime-derived effect ID, required authority atom, bounded path/content evidence and authority-record citation | None |
| `admitted` | Exact intent's effect ID and operation index | Committed immediately before opening the file for value access or mutation |
| `outcome` | Standard `EffectOutcome`, correlated to the complete `EffectIntent`; success, refusal, failure or cancellation | Already completed, refused, or failed |

Authority/path/text checks can refuse an intent without an admission record or physical value
access. Filesystem metadata checks used for path validation precede admission. The existing
post-open inode, containment and fence checks remain in force. Successful writes retain an
acknowledgement; successful reads retain evidence of the returned text. Failure outcomes report
`failed` but do not promise an unchanged filesystem: an admitted operation may have partially
materialized before an error. Cancellation before admission records `cancelled` without I/O.

Indices identify occurrences, so identical calls remain separate operations. The operation journal
uses the existing typed intent/outcome correlation rules and marks managed filesystem actions
reversible by world restoration. It does not implement arbitrary callback compensation.

## Content and authority boundaries

Paths and supplied/returned text are represented by byte length, a configured digest, and validity
and bound flags. Plaintext paths, file contents, exception messages and cancellation reasons are
not copied into this journal. Invalid or over-bound text retains no digest. Path evidence uses the
configured path bound; content evidence uses the capability's existing text bound. Digests describe
supplied path strings and supplied/returned text, not an additional file snapshot, and reveal
equality and length. Other task/provider/tool records retain their own secret-retention policies.
The store's secret-scanning policy still applies to journal appends.

Grant denial is recorded while the invocation still has append authority. A stale capability after
callback settlement, or a caller that cannot establish the current fence, cannot append a diagnostic
record or mutate the world. Preserving that fence takes precedence over logging unauthorized calls.
Journal publication failure stops the operation or leaves inspectable uncertainty and prevents
further I/O through that capability. Even a caller that catches the error cannot settle a capture
with an uncertain journal.

These are records of the supplied capability methods. Direct filesystem calls, internal carrier
work, and native process syscalls are not represented as individual capability operations. Native
process execution retains its separate launch/quiescence evidence. An enclosing tool-loop effect
and an inner capability operation are distinct records; they do not execute the physical work twice.

## Inspection and recovery

`inspectTaskWorldEffects` appends nothing and reads no world files. It validates the enclosing run
and capture journal, exact authority, phase order, operation IDs, admissions, correlation, content
bounds and capture closure. The immutable projection is identical after reopen and native archive
import. A concurrent owner change refuses inspection so the caller can retry.

| Evidence state | Meaning |
| --- | --- |
| `absent` | No operation journal is retained; legacy data does not prove that no operations occurred |
| `recording` | An opened stream has no pending operation and no captured-world closure; this does not assert a live writer |
| `not_materialized` | The tail has an intent but no admission; value access/mutation was not entered |
| `uncertain` | The tail has an admission but no outcome; work may have happened |
| `settled` | The capture is closed and every operation has an outcome; individual operations also use this state when their outcome is retained |

The separate `recovery_status` is the enclosing durable run classification. An operation known not
to have materialized does not authorize repeating an arbitrary runner: an `executing` capture still
uses the existing fail-closed recovery policy. No operation or callback is automatically replayed.

The process test kills a real writer after its intent and after its file write but before outcome
publication, reopens/imports the trace, compares custody and untouched user bytes, and verifies
recovery refuses to invoke the runner again. Lost admission and outcome acknowledgement fixtures
also prove that no synthetic outcome bypasses a retained admission and no subsequent unlogged
operation runs. No additional host, live-provider or performance measurement is claimed.
