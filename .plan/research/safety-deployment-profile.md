# Safety Deployment Profile

Status: research note, not normative

Research date: 2026-09-25

Tracking: [#218](https://github.com/avnionur/shepherd-typescript/issues/218) (epic
[#202](https://github.com/avnionur/shepherd-typescript/issues/202))

Index: [research notes](./README.md)

## Paper reference

[Shepherd v3](https://arxiv.org/html/2605.10913v3), Appendix A.2 "Reversible sandboxes as a safety
property" and §6.

Summary: every effect carries a reversibility tier (§3.2): reversible filesystem mutations,
compensable side effects, and irreversible external calls, each with a different rollback contract.
This makes the substrate a candidate for safety-critical deployments: "an external override can
preempt the materialisation of any irreversible effect, downstream checks can fire a rollback up to
the last materialisation point", and the trace gives auditors a content-addressed record of what
happened rather than what the agent reported. The paper states the substrate does not solve
alignment but makes the halt-and-inspect loop implementable against a stable interface. §6 lists
"safely gate irreversible actions".

## Problem statement

Define a deployment profile: a declared configuration plus an operator procedure under which (1) no
irreversible effect materializes without an external verdict, (2) an external check can halt a
running agent and restore the world to the last point before any unverified materialization, and
(3) the audit record is sufficient to show which effects materialized, were compensated, or were
refused.

## What the repository provides now

- **Reversibility tiers.** Every effect intent declares `reversible`, `compensable`, or
  `irreversible` ([effect records](../../docs/effect-records.md)).
- **Irreversible approval frontier.** `dispatchSupervisedEffect` requires an approved verdict for
  tiers in `supervision.approval.requiredTiers` (`irreversible` by default); expiry resolves
  `rejected` and never fails open; interceptors on `failOpenForbiddenTiers` always fail closed; a
  `replace` cannot weaken the tier ([supervised effects](../../docs/supervised-effects.md#approval-frontier),
  [approval gates](../../docs/supervision-control.md)). Handlers are an ordered exact-kind stack
  ([effect handlers](../../docs/effect-handlers.md)).
- **Replay gating.** In a branch suffix an approval-required effect runs only when `policy`
  approves; a recorded prefix never invokes a handler
  ([irreversible effects](../../docs/rewind-and-replay.md#irreversible-effects)).
- **Rollback.** Rewind or replay to a checkpoint restores worlds byte-equivalently and compensates
  compensable effects past the target once, in reverse order; `discardScope` compensates cited
  effects ([effect compensation](../../docs/compensation.md),
  [`compensation.ts`](../../src/effect/compensation.ts)); automatic checkpoints make boundaries
  restorable ([automatic checkpoints](../../docs/coupled-checkpoints.md#automatic-checkpoints)).
- **Live override of running workers.** The runtime supervisor observes worker streams each tick
  and can `inject`, `handoff`, or `discard` a running attempt
  ([runtime supervisor](../../docs/runtime-supervisor.md),
  [`runtime-supervisor.ts`](../../src/applications/runtime-supervisor.ts)); cancellation resolves a
  pending dispatch `cancelled` before admission.
- **Audit and claim honesty.** Content-addressed records, `verifyIntegrity`, archive export, and
  proof envelopes that report production surfaces as `runtime_only`
  ([formal assurance](../../docs/formal-assurance.md)).

## Gaps

- The pieces are not assembled into a named profile: nothing checks that a deployment routes every
  tool call through supervised dispatch rather than `createHandlerToolLoopEffects`, which retains no
  evidence and applies no frontier.
- "Last materialization point" is undefined as an operation. Candidates: the latest checkpoint at or
  before the first effect whose verdict is unverified, or before the first irreversible
  materialization. No function computes it from records.
- There is no "downstream check" trigger that, on a failed verdict, halts the run and opens the
  rewind in one command; today an operator composes cancellation, inspection, and rewind.
- Irreversible effects that already materialized cannot be rolled back; the profile can only prove
  they were approved. Compensation has no waiver record for permanently failing handlers.
- Runtime supervisor recovery re-sends a turn in flight, so tool effects may reach custody at least
  once; the profile must state this.

## Research question

Can a declared profile (configuration keys only) plus one read-only function "rollback target for
session S under verdict V" express the halt-and-inspect loop over existing APIs, and can a fault
test show no irreversible effect materializes without a verdict under crash and timeout?

## Minimal experiment design

1. Fixture: a tool loop over supervised effects with three tools, one per tier, against a
   node:sqlite fixture world (as in the compensation SIGKILL suite), with `checkpointPolicy:
   effect_step`.
2. An external approver process rejects the irreversible call; a downstream check fails after two
   compensable calls.
3. Compute the rollback target from records (latest checkpoint before the first effect after the
   last passing check), rewind to it, and verify world bytes and compensation records.
4. Kill the process at each record boundary (fault harness) and verify: no irreversible
   materialization without an approved verdict, compensation exactly once, rewind idempotent.
5. Export the archive and confirm an auditor can re-derive the same classification offline.

## Success and falsification criteria

- Success: across all kill points, zero irreversible materializations without a retained approved
  verdict, one `compensated` outcome per rolled-back compensable effect, and an identical rollback
  target computed on writing, reopened, and imported stores.
- Falsified if any path (for example, a handler-stack loop or a process-bound effect outside
  supervised dispatch) materializes an irreversible effect without passing the frontier while the
  profile's configuration is in force.

## Risks

- The substrate gates only effects that pass through it; effects performed by handler code outside
  intents are invisible. A profile must say so, not imply containment.
- Tier declarations are caller-supplied; a mis-tiered effect bypasses the frontier.
- Approval latency and timeouts affect availability; the profile trades liveness for safety.
- Safety claims for real deployments need threat-model review
  ([threat model](../../docs/threat-model.md)); this note makes none.

## Next step

No implementation issue is filed until this note is reviewed.
