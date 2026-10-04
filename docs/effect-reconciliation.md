# Effect reconciliation

Status: normative from 13.5.0 (#241). Public entry points are
[`./effects`](../src/facades/effects.ts) and the root API:
`createEffectReconciliationAuthority`, `inspectEffectReconciliation`, and `reconcileEffect`.
Implementation: [controller](../src/effect/reconciliation.ts),
[audit inspection](../src/effect/reconciliation-inspection.ts),
[atomic publication](../src/store/effect-reconciliations.ts).
The configured `effects.compensation.reconciliation` contract owns the vocabulary, identities,
text/evidence/decision bounds and [audit schema](../spec/schemas/effect-reconciliation-v1.schema.json).

## Decisions and factual outcomes

An operator can reconcile a permanently failing compensation or an uncertain effect without
forging a successful handler result. The exact replay effect step/admission or supervised dispatch
resolution/admission identifies the incident. Recorded replay copies normalize to their original
materialization; the requested record identity remains bound into the command. A completed admission
resolves to its outcome record. Pending replay admissions expose an intent digest only: their full
intent and outcome remain null. No recovery decision invents successful materialization.

| Disposition | Behavior |
| --- | --- |
| `retry` | Records authorization for a later existing safe retry path; does not invoke a handler or materializer. A successful compensable materialization is still required by `compensateEffects`. |
| `externally_verified_completion` | Requires separate host verification of external completion; suppresses later automatic compensation. The original failed or uncertain outcome remains factual. |
| `accepted_unresolved` | Records explicit acceptance of external risk and suppresses automatic compensation. Never becomes `compensated`. |

`inspectEffectCompensation` retains `pending`, `uncertain`, `failed`, or `compensated` and adds
optional `reconciliation` metadata. A guard alone does not create a compensation intent;
`inspectEffectReconciliation.compensation` stays null until factual compensation evidence exists.
A later ordinary trigger can retain a genuine intent from its validated materialization, then
honor the disposition without invoking a handler. Already compensated effects reject new decisions.

`inspectScope`, `inspectReplaySession`, and `inspectDurableTaskExecution` expose optional
`residual_risks` with exact receipts. Relevant causal effects, descendant scopes, execution-associated
scopes, and source replay lineage are followed, including abandoned suffixes after rewind.
Unrelated audit volume or malformed unrelated audits do not prevent inspection. Configured limits
bound returned unresolved targets. Exact incident inspection remains available if an aggregate view
exceeds that limit. A retry decision alone does not clear accepted risk; actual compensation or
verified external completion does. `run show`, `replay show`, and `scope show` include these risks
in JSON and escaped human output. The CLI has no unauthenticated reconciliation mutation command.

## Host authority and exact commands

The host authenticates the operator and creates an immutable authority handle with `actorId`,
`policyId`, `authorize`, and `verifyCompletion`. Object copies are refused. `authorize` receives
an immutable exact decision and resolved target; the host must check its actual access policy.
`verifyCompletion` independently checks external evidence for the completion disposition. A true
callback result is a host assertion, not an identity-provider or cryptographic proof.

```ts
import {
    createEffectReconciliationAuthority,
    inspectEffectReconciliation,
    reconcileEffect,
} from "@avnionur/shepherd-typescript/effects";

// These values/callbacks come from the host's authenticated incident workflow.
const authority = createEffectReconciliationAuthority({
    actorId, policyId, authorize, verifyCompletion,
});
const incident = inspectEffectReconciliation(store, { effectRecordId });
const receipt = await reconcileEffect(store, {
    authority,
    effectRecordId,
    basisId: incident.basis_id,
    commandId,
    disposition: "accepted_unresolved",
    reason,
    evidenceRecordIds,
});
```

Keep nonempty evidence records in the trace before deciding. Commands bind actor, policy, requested
record, disposition, reason, ordered evidence IDs, and the inspected basis. The basis binds exact
source, compensation, and prior audit heads. Equal commands reauthorize and return the original
receipt after restart, even after a later decision. Replays never re-run completion verification.
Changed command content conflicts. A new decision requires a new command and a freshly inspected
basis; stale heads refuse before publication. Denied policy, absent evidence, invalid fields and
failed verification publish nothing.

One SQLite transaction compares all heads and excludes active compensation/source leases, then
publishes the same audit on the target owner, global command owner, and compensation owner. It
persistently releases expired holders so a backwards clock cannot revive them. Compensation
admission checks the exact audit head in its own transaction. Imported stores carry no operational
leases; copies do not coordinate access to one external world. Stop external work and establish
resource ownership independently before reconciling imported evidence.

## Migration and older readers

Store schema 15 is a reader boundary with no record rewrite or new table. Writable opens migrate
historical stores; read-only opens require the current schema. Take a verified pre-upgrade backup.
Older runtimes refuse schema 15. Native archive format 1 remains readable as canonical evidence,
but the mandatory audit guard on each affected compensation owner makes a v1-only compensation
reader refuse before invoking a handler. Removing guards or audit occurrences invalidates incident
inspection. Restore a pre-upgrade backup into a separate path for rollback; never delete migration
rows or strip guards to force an older runtime to run.

Existing v1 compensation records retain their bytes, statuses, keys and handler contract. A guard
cites the exact previous compensation head; a subsequent record chains through it. When guards
precede the first factual intent, that intent cites both its materialization and the guard head.
Native exports retain all three audit occurrences. Imported audit bodies are retained assertions
under the trusted-import boundary; they are not fresh authentication or cross-store fencing.

## Verification

[Decision and trigger tests](../test/effect/reconciliation.test.ts),
[authority and external completion](../test/effect/reconciliation-authority.test.ts),
[malformed evidence](../test/effect/reconciliation-evidence.test.ts),
[fresh-process crash and concurrent publication](../test/effect/reconciliation-process.test.ts),
[uncertain materialization](../test/effect/reconciliation-uncertain.test.ts), and
[unrelated audit isolation](../test/effect/reconciliation-isolation.test.ts) exercise public seams.
The existing compensation, scope-discard, replay, and SIGKILL suites preserve ordinary behavior.
The [incident runbook](./incident-response.md#runbook-compensation-or-materialization-uncertainty)
owns operational recovery.

A repeatable N-1 binary drill is
[`reconciliation-legacy-reader.ts`](../test/fixtures/reconciliation-legacy-reader.ts). Build the
13.3.0 source at commit `e794508639902d64f350e4621fb5cf2cc0b8e701` in a separate worktree, then run:

```sh
node test/fixtures/reconciliation-legacy-reader.ts /absolute/path/to/legacy/dist
```

The drill creates its own temporary SQLite world and trace, records a failed compensation and an
accepted-unresolved decision, then requires the old binary to refuse both opening the new store
and compensating its imported archive. It asserts zero old-handler calls and the unchanged row.
Recorded on Node 24.17.0, macOS arm64: both refusals passed, zero calls, row `a` retained.
