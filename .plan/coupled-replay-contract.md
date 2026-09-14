# Coupled checkpoints, rewind, and replay contract

Status: TypeScript contract, Phase 8 task 1 (#155), 2.10.2. It is implemented by
[replay sessions](../docs/replay-sessions.md) (#156, 2.11.0),
[coupled checkpoints](../docs/coupled-checkpoints.md) (#157, 2.12.0; process backends #159, 2.14.0),
and [rewind and replay](../docs/rewind-and-replay.md) (#158, 2.13.0; divergence and dependency
analysis #160, 2.15.0). Conformance and the exit audit are #161 (2.15.1). Normative behavior lives in
`docs/`; this page records the reviewed design constraints and deliberate non-claims.

## Evidence

Pinned release source: `a8196d4c453514836d06bd2fece91a03cdc37107`
([upstream.lock.json](../upstream.lock.json)).

- The paper (§3.3, §3.4, §5.2) describes rewind to historical states, suffix replay with changed
  inputs, prompt-prefix cache reuse, and coupled agent/environment forks. It gives no record
  format, verification rule, or classification of what a replayed state actually restored.
- The pinned release has no public rewind or replay API.

These are source-level observations, not executed Python conformance. The TypeScript design keeps
the paper's model and adds what it does not specify: a durable step journal, verified prefix
identity, explicit constituent classification, and approval rules for irreversible effects.

Existing TypeScript authorities stay normative: [canonical records and cuts](../docs/trace-queries.md),
[native interchange](../docs/trace-interchange.md), [effect records](../docs/effect-records.md),
[handler stacks](../docs/effect-handlers.md), [the provider contract](../docs/static-provider.md),
[the reference copy carrier](../docs/reference-copy-carrier.md), and the Phase 6
[scope checkpoint classification](../docs/scope-fork.md#start-classification). Coordinated
multi-resource world checkpoints, reassigned from Phase 6, are owned here.

## Replay sessions

A replay session runs one caller-supplied deterministic **session program** and retains every
interaction with the outside world as an ordered **step** on the session's own owner path, derived
from its command identity.

- The program receives a session context and may only reach the world through it: provider
  invocations, effect dispatches, task-derived requests, and checkpoints. Everything else it
  computes must be a deterministic function of prior step results.
- A **provider step** retains the canonical request, its prompt identity (request digest), the
  canonical response output and its digest, observed usage, and cache evidence.
- An **effect step** retains the canonical intent, its reference digest, the disposition, and the
  correlated outcome only when the effect materialized. An admission record is retained before a
  handler is invoked.
- Every step declares the earlier steps it depends on. When omitted, a step depends on its
  immediate predecessor. Declared dependencies must name existing earlier steps.
- Each step carries a chained **prefix identity** over all step identities, and each provider step
  carries a chained **context prefix identity** over provider exchanges only. Neither includes
  usage, timestamps, or delivery order.
- One fenced renewable lease admits a single session writer; every append compares the fence and
  the exact owner head atomically. A terminal record ends the session with `finished`, `failed`,
  `cancelled`, or `rewound`.

Repeating a terminal session's command returns the retained receipt without running the program.
A non-terminal session is never resumed in place: its classification is `running` while its lease
is live, `interrupted` after expiry, or `materialization_uncertain` when an admission has no step.
Recovery is replay from a retained checkpoint or step boundary.

## Provider identity and cache evidence

- Prompt identity is the digest of the canonical request. Response identity is the digest of the
  canonical output. Both are computed by the runtime, never accepted from a provider.
- Cache evidence records the context prefix identity before the request, the provider-reported
  cache read and creation token counts, an optional cache identity declared by a provider-session
  adapter, and `hit` only when cache read tokens were observed. Usage never enters identity.
- During prefix reconstruction the provider is not invoked. The program's request must equal the
  recorded request byte for byte; the recomputed prefix and context prefix identities must equal
  the retained values. Any difference fails the replay with a prefix-mismatch error.

## Coupled checkpoints

A checkpoint is taken by the program at a step boundary and retains, atomically under the session
fence, a published trace cut through the last step and one descriptor with every constituent:

| Constituent | Verified when | Otherwise |
| --- | --- | --- |
| `trace_cut` | The cut is published and resolves to the exact step prefix | Never absent |
| `world` (one per bound world) | Every regular file is a content-addressed trace-store blob and the manifest content identity equals a double-scanned capture | `unavailable` with the capture failure reason |
| `provider_session` | A provider-session adapter returns a receipt whose context prefix identity equals the session's | `reconstructive` when no adapter is bound (context is rebuilt from recorded exchanges); `unavailable` when the adapter reports a reason |
| `process` (one per bound process) | A process adapter probe succeeds and its image is retained as a verified blob | `unavailable` with the probe or capture reason |
| `irreversible_effects` | The frontier of materialized irreversible effects in the prefix is retained with its digest | Never absent |

Classification is derived from constituents: `atomic` when every constituent is verified,
`reconstructive` when some constituent is reconstructive and none is unavailable, and `unavailable`
otherwise. All worlds of a session are captured at the same quiescent step boundary under one fence,
which is the coordinated multi-resource checkpoint. The session program's in-memory state is never
captured: every branch re-executes the program over the verified recorded prefix, so `atomic`
describes external constituents restored from verified captures rather than re-derived.

## Rewind and replay

A rewind or replay opens a **branch session** whose opening record cites the source session, the
target (a retained checkpoint, or a step boundary for which the branch publishes a cut of the source
prefix), the replay mode, and which of task, provider, and handlers changed.

1. Restore: every constituent claimed verified is re-verified before use. Worlds are materialized
   from blobs into caller-selected empty roots and re-captured; the content identity must equal the
   checkpoint's, so the restored managed filesystem is byte-equivalent to the recorded cut. Process
   images are verified and handed to their adapters; provider-session receipts are handed to the
   provider-session adapter, which must report the recorded context prefix identity.
2. A step-boundary target without a checkpoint is admissible only for sessions without bound worlds
   or processes; the provider session is reconstructive.
3. A restore record retains the classification and every restored constituent. An `unavailable`
   classification refuses the branch before any world is written.
4. `rewind` copies the verified source prefix as `recorded` steps and ends with terminal status
   `rewound`.
5. `replay` re-executes the program: steps before the target are served from the source journal
   as `recorded` steps citing their source records, with no provider or handler invocation; steps
   after it run live with the replacement task, provider, or handler stack.

## Irreversible effects during replay

- A recorded prefix never invokes a handler, so no prefix effect is re-materialized.
- An intent the source admitted without a step may have materialized, so a branch suffix gates it
  like an approval-required effect regardless of tier.
- In a branch suffix, an effective intent whose tier is configured as approval-required
  (irreversible by default) is admitted only when the caller's replay policy returns an approval.
  The approval, the approver identity, and whether the same intent materialized in the source are
  retained on the step. Without a policy, or when the policy refuses, the step is retained as
  `refused` and no handler runs.
- Root sessions are ordinary executions and are not gated here; live interception remains the
  Phase 7 supervised dispatch.

## Process checkpoint backends

- A process adapter declares a configured backend kind, a probe, image capture, and restore.
- The `cooperative` backend drives a child process through a narrow structured checkpoint protocol
  and restores the image into a fresh process. It is available wherever the child can be spawned.
- The `transparent` backend probes CRIU on configured platforms. It reports the exact reason when the
  platform, executable, or `criu check` fails, and in protocol v1 it reports image capture as
  unsupported even when the probe passes. No transparent process image is claimed.

## Divergence and dependency analysis

- Divergence analysis aligns a source and a branch session by step index and classifies each step as
  `identical`, `diverged`, `source_only`, or `replay_only`, with the first divergence and the common
  prefix identity.
- A diverged step is `root` when its declared dependencies are identical and its kind matches a
  declared change, `propagated` when a declared dependency diverged, and `unexplained` otherwise.
  Deterministic tests require no unexplained divergence.
- Dependency analysis of one session returns the transitive dependents of a step (the suffix a change
  there can affect) and the independent steps.

## Failure and recovery

| Failure | Required behavior |
| --- | --- |
| Session writer crashes between steps | `interrupted` after lease expiry; replay from a checkpoint or step boundary |
| Writer crashes after an effect admission | `materialization_uncertain`; the effect is never re-invoked or used as a replay target |
| Stale writer returns | Every append is fenced and refused |
| Program issues a different request or intent in the prefix | Prefix mismatch; the branch fails with retained evidence |
| Checkpoint blob missing or corrupt | Verification fails before restoration writes anything |
| Target world root is not empty | Refused before materialization |
| Process or provider adapter cannot restore | Branch fails; classification is never silently weakened |
| Imported store | Sessions are inspection and replay sources; new branches are admitted in the importing store |

## Non-claims

- No in-place resumption of interrupted sessions and no automatic repair of uncertain effects.
- No capture of program memory, no transparent process images, and no container checkpoints.
- No live provider adapters; provider-session verification requires a caller-supplied adapter.
- Declared dependencies are trusted program declarations: analysis can report divergences that the
  declarations do not explain, but cannot prove the program used no undeclared data.
- World images cover the reference copy carrier's portable manifest; unsupported filesystem objects
  fail closed at capture.
