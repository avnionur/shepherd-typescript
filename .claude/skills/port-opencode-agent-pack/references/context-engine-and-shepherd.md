# Context Engine and Shepherd rules for pack ports

## Contents

1. [Ownership boundary](#ownership-boundary)
2. [Context Engine conformance](#context-engine-conformance)
3. [Shepherd activation](#shepherd-activation)
4. [Authority and effect policy](#authority-and-effect-policy)
5. [Placement truth](#placement-truth)
6. [Retained candidate and settlement](#retained-candidate-and-settlement)
7. [Replay and meta-agent claims](#replay-and-meta-agent-claims)
8. [Managed-pack acceptance](#managed-pack-acceptance)

## Ownership boundary

Keep one owner for each state machine.

| Concern | Owner |
| --- | --- |
| bounded model projection, context epochs, summaries, recall, output artifacts, child-context containment | Context Engine |
| tasks, typed results/handles, effects, scopes/bindings, trace, placement, retained candidates, settlement, replay, supervisor/meta-agent decisions | Shepherd |
| phase/command declarations and agent/tool/KB policy | active pack configuration |
| host filesystem/process/provider/UI adapters and durable storage | desktop runtime |

Do not copy complete transcripts or execution traces into the model context. Couple execution checkpoints to immutable context snapshot references. Do not make prompts or workflow YAML an alternate durable task/effect ledger.

## Context Engine conformance

Preserve these invariants from OpenCode-inspired packages:

- Treat logical session identity as stable across model-projection epochs.
- Build model input from durable state under a budget; preserve the newest coherent turn and tool-call/result pairs.
- Externalize oversized tool, MCP, command, provider-error, KB, and child-result content to scoped durable artifacts before it reaches a provider request. Return bounded previews and opaque retrieval handles.
- Enforce workspace/session/permission/sensitivity scope on artifact read/search. Redact before persistence where policy requires it.
- Give a fresh delegated task an isolated child projection. Reuse child history only for explicit continuation.
- Return bounded child completion envelopes; never inject the child's entire transcript or unbounded final text into the parent.
- Rotate at configured workflow boundaries and preserve requirements, constraints, decisions, artifacts, touched files, errors/corrections, pending work, unresolved questions, rejected approaches, and verification results required by the pack profile.
- Use semantic snapshots and recall for relevance, then exact artifact reads for evidence. A summary is not proof.
- Validate and recover durable state; expose manual maintenance controls rather than silently dropping corrupted history.

Pack configuration may opt into a `runtime.context` profile, rotation triggers, required state, and boundary briefs. Use only current schema fields. Do not hard-code a particular pack, agent, phase, or KB path into Context Engine code.

## Shepherd activation

Do not infer managed coding from pack names, agent names, `codingAgent`, prompt wording, or tool calls. Activation requires both the application feature flag and a valid pack block:

```yaml
runtime:
  shepherd:
    enabled: true
    profile: workspace
    settlement: explicit
    supervisorAgents: [<configured-supervisor-id>]
    workerAgents: [<configured-worker-id>]
    allowedEffects: [<configured-effect-id>]
    deniedEffects: [<configured-effect-id>]
```

Use configured IDs from the port. Never copy the example's values as universal defaults. Every listed supervisor/worker must exist and its tool/permission configuration must match the role.

Packs that omit this block must retain prior behavior. Never create a second Python Shepherd package, subprocess, service, trace package, or pack-owned execution state machine.

## Authority and effect policy

The host—not model output—derives repository identity, task, scope, bindings, placement, baseline checkpoint, retention, verification command/profile, preview identity, and settlement authority.

Models may request registered operations. They must not supply trusted filesystem roots, arbitrary command strings, baseline digests, authority digests, capability handles, or host-held preview objects.

Every material effect follows intent-before-outcome recording. Classify at least:

- workspace reads/writes and VCS observation;
- process verification versus unknown/general process execution;
- provider and tool calls;
- package/dependency materialization;
- network, credentials, external databases/services, publishing, and settlement.

Default-deny effects not required by the source package. Preserve delegated file scope. A no-shell verification profile is not interchangeable with generic shell access. Never claim that unbrokered repository code, live provider calls, external systems, or the host computer are reversible.

## Placement truth

Use the exact configured profile and fail closed when unavailable. Never silently downgrade.

| Profile | Permitted claim |
| --- | --- |
| `trace-only` | Effects are recorded at the admitted boundary; no workspace/process isolation is implied. |
| `workspace` | Candidate destination writes are held in a managed workspace/worktree. Process, network, credentials, and live agent state are not isolated or restored. |
| `process-isolated` | Claim hard/container process isolation only when a concrete backend passes its platform conformance suite. |
| `coupled` | Claim synchronized agent/filesystem/process/binding/trace checkpoint and verified restore only when a backend proves all of them. |

Git worktrees alone are never `process-isolated` or `coupled`. Advisory or guarded workspace controls reduce exposure but are not a security sandbox. Record actual enforcement per run.

## Retained candidate and settlement

A managed coding worker produces a retained candidate, not an automatic destination mutation.

Required lifecycle:

1. Establish explicit trust, immutable baseline, typed task contract, bindings, scope, allowed effects, and registered verification profiles.
2. Run the worker within the admitted placement and record effects durably.
3. Reconcile authoritative end state with broker evidence; surface drift and unknown outcomes.
4. Retain candidate changes, typed result/evidence, tests, costs, permissions, irreversible effects, and dependencies.
5. Compare candidate to baseline/siblings with content identity, not worker prose.
6. Create an exact revision-bound preview for one action: `select`, `apply`, `release`, or `discard` where supported.
7. Obtain a separate explicit confirmation and execute through consume-once settlement.
8. Perform post-settlement verification. On crash, conflict, stale preview, duplicate consumption, or failed verification, recover durably and fail closed.

Do not hide conflict synthesis inside settlement. Fast-forward select and path-disjoint apply are conservative mechanisms; overlapping content requires a separately authorized and reviewed resolution task.

Only configured supervisors receive settlement authority. A worker must not settle, delegate outside its task, ask the user through disallowed tools, or continue effects after typed completion is consumed.

## Replay and meta-agent claims

Replay must label effect handling explicitly: recorded/reused, reexecuted, stubbed, compensated-and-reexecuted, or forbidden/blocked. Live providers are not deterministic. Exact replay is claimable only when dependencies are content-addressed and replayable; otherwise call the result a traced continuation or counterfactual with declared variance.

Counterfactual optimization and supervisors may recommend, fork, compare, intervene, or retain candidates only within configured budgets and authority. Do not encode paper benchmark uplift as a product guarantee. Do not offer replay execution in a `workspace` profile when coupled environment restoration is required but unavailable.

## Managed-pack acceptance

Test all of the following for every Shepherd-enabled port:

- dual feature/manifest opt-in and unchanged behavior when either side is off;
- valid configured supervisor/worker IDs and role/tool separation;
- exact repository trust and content identity before placement;
- host-derived scope, binding, baseline, verification, preview, and authority;
- denied credentials/network/package mutation/general shell and allowed registered effects;
- intent/outcome pairing, partial/outcome-unknown durability, cancellation, and crash recovery;
- actual placement capability and fail-closed unsupported profiles;
- candidate retention, authoritative diff, secret/binary/scope checks, and verification evidence;
- revision-bound preview, separate confirmation, consume-once settlement, idempotency, and stale/conflict failure;
- post-settlement verification and attention-required recovery;
- redacted renderer projections with no host paths, payload handles, idempotency keys, credentials, raw rationale, or authority tokens;
- replay control truth and absence of false reversibility/coupled claims;
- immutable Context Engine snapshot references at execution checkpoints without transcript/trace duplication.

Use [Shepherd port acceptance boundary](shepherd-port-acceptance.md) as the durable local acceptance boundary. When the original gap analysis, conformance report, runtime documentation, and focused test suites still exist, compare them with the vendored snapshot and update this skill deliberately when the product contract changes.
