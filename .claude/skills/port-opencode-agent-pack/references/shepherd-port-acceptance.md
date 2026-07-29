# Shepherd port acceptance boundary

## Contents

1. [Purpose and provenance](#purpose-and-provenance)
2. [Ownership and activation](#ownership-and-activation)
3. [Runtime profiles and allowed claims](#runtime-profiles-and-allowed-claims)
4. [Programming-model gates](#programming-model-gates)
5. [Coding-runtime gates](#coding-runtime-gates)
6. [Placement gates](#placement-gates)
7. [Evidence and non-claim gates](#evidence-and-non-claim-gates)
8. [Guarded workspace production contract](#guarded-workspace-production-contract)
9. [Current known gaps](#current-known-gaps)
10. [Focused-test evidence map](#focused-test-evidence-map)
11. [Port decision record](#port-decision-record)

## Purpose and provenance

Use this file as the self-contained Shepherd acceptance contract for an OpenCode-to-Cognia pack port. Do not require `.plan/` or product documentation to exist at execution time.

This snapshot was consolidated on 2026-07-22 from the skill-local source snapshots:

- [Shepherd grade gap analysis](shepherd-grade-gap-analysis.md);
- [Phase 15 conformance snapshot](shepherd-phase-15-conformance.md);
- [Shepherd runtime snapshot](shepherd-runtime.md);
- the focused suites under `test/shepherd`, `test/packs`, and `test/ui`;
- the same-date comprehensive code/spec review of the production adapters.

Treat the checklists below as normative for the skill. Treat the “current production contract” and “known gaps” as a dated implementation snapshot that must be reverified against current source. If newer schemas or runtime behavior deliberately change the contract, update this reference in the same change; never silently weaken a gate because an original plan file disappeared.

## Ownership and activation

`@cognia/shepherd` is the single TypeScript source of truth for tasks, typed results and handles, effects, scopes and bindings, traces, retained runs and candidates, settlement, replay, and meta-agent decisions. The kernel must not depend on Electron, React, Node filesystem APIs, provider SDKs, Python Shepherd, Docker, or an external Shepherd service. Desktop adapters supply storage, placement, provider/tool execution, verification, approval, and redacted renderer views.

Context Engine remains a separate owner of bounded model projections, context epochs, summaries, recall, output artifacts, and child-context containment. Link a Shepherd execution checkpoint to an immutable Context Engine snapshot reference; do not copy the full transcript or execution trace across the boundary.

Managed coding activates only when both the application feature flag and `pack.yaml` `runtime.shepherd` block opt in. Never infer activation from a pack name, agent name, `codingAgent`, prompt, or tool call. Non-opted-in packs must remain behaviorally unchanged.

The host derives repository identity, task, bindings, file scope, placement, baseline, retention, verification profiles, preview identity, and settlement authority. A model may request a registered operation but must not supply trusted roots, arbitrary commands, baseline/authority digests, capability handles, or host-held previews.

## Runtime profiles and allowed claims

Every run records requested and resolved profile plus actual enforcement. Fail closed instead of silently downgrading.

| Profile | Required guarantees | Strongest allowed claim |
| --- | --- | --- |
| `trace-only` | Typed immutable intent/outcome records; no containment guarantee. | “Recorded Cognia-mediated effects.” |
| `workspace` | Retained repository state, path/file authority, exact candidate ancestry, consume-once settlement, and end-state reconciliation. | “Revertible managed workspace proposal.” |
| `process-isolated` | `workspace` plus process/container isolation and controlled network/credentials. | “Isolated managed coding process,” limited to declared external effects. |
| `coupled` | Synchronized agent cursor, filesystem, process/container state, bindings, tool surface, and trace cut with verified restore/resume. | “Shepherd-grade coupled agent/environment fork for the managed placement.” |

Git worktrees alone are never process isolation or coupled restoration. Advisory controls are never a sandbox. A lower profile cannot inherit a higher profile's claims.

## Programming-model gates

A managed coding port is not complete until all applicable gates pass:

- [ ] Versioned TypeScript task, effect, scope, and trace schemas are frozen and runtime-validated.
- [ ] Tasks are immutable first-class values with compatible substitution, pass/return, synthesis provenance, typed projection, resource handles, and nested supervision.
- [ ] Every Cognia-mediated boundary action records durable intent before materialization and causal outcome, failure, or outcome-unknown afterward.
- [ ] Every effect declares reversibility tier plus observation and authority scope.
- [ ] Scope emit, fork, merge, discard, pause, resume, revert, adoption, abandonment, and publication laws pass where exposed.
- [ ] Durable parent/child execution recovers across application/process restart without injecting the child transcript into the parent.
- [ ] Content-addressed traces support atomic append, cuts, slices, ancestry, structural sharing, behavioral diff, export/import, and schema migration.
- [ ] Replay supports dependency-cone planning with explicit recorded/reused, reexecuted, stubbed, compensated-and-reexecuted, irreversible, and blocked/forbidden modes.
- [ ] Ambient delivery carries explicit typed execution context; ambient authority is forbidden.

## Coding-runtime gates

- [ ] Every coding execution surface routes material effects through the same intent-before-outcome broker; no direct materialization bypass exists.
- [ ] Repository writes, processes, tests/builds, providers, tools, artifacts, candidate revisions, and settlement are traced at their admitted boundaries.
- [ ] Coding occurs in a retained candidate and cannot alter the selected workspace before authorized settlement.
- [ ] Named bindings and file scopes are enforced; command, network, credential, package/dependency, provider, publish, database, and external-service capabilities are explicit and default-denied.
- [ ] Generic shell access is absent from Shepherd-managed supervisors and workers. Verification uses host-registered structured profiles, not model-provided commands.
- [ ] Typed worker completion is consume-once; a blocked, failed, invalid, or settlement-ineligible result cannot be retained or settled.
- [ ] Retention requires nonempty verification evidence and every required profile to pass before preview or materialization.
- [ ] Select, apply, release, and discard are exact-identity, consume-once, idempotent, durable, authorization-bound, and crash-recoverable when the pack exposes them.
- [ ] Concurrent candidates preserve immutable baselines; repeated settlement cannot contaminate later changesets.
- [ ] Candidate comparison covers effects, files, verification, cost, permissions, irreversible actions, and external dependencies.
- [ ] Select is conservative; apply permits path-disjoint composition only after exact destination inspection. Conflict synthesis is a separate authorized task.
- [ ] The exact revision-bound preview is shown before a separate confirmation; renderer input carries no hidden authority.
- [ ] Composed candidates run required typecheck/test/build validation before consumption. Failed post-materialization verification enters durable attention/recovery and must not be represented as successful settlement.
- [ ] Redaction, encryption at rest, access control, retention/erasure, secret detection, and audit export cover trace data and output artifacts.
- [ ] Failure injection covers crash points around intent, materialization, outcome append, fork, merge, settlement preparation, apply, and cleanup.
- [ ] Same-version pack hot reload invalidates runtime authority when Shepherd configuration changes.
- [ ] Renderer projections omit host paths, payload/content handles, idempotency keys, credentials, raw supervisor rationale, and capability/authority tokens.

## Placement gates

- [ ] Every run records requested/resolved profile and enforcement mode.
- [ ] Required hard isolation fails closed instead of degrading to advisory/workspace execution.
- [ ] A `coupled` claim proves synchronized checkpoint and restore of agent cursor, filesystem, process/container state, bindings, tool surface, and trace cut.
- [ ] Windows uses an approved WSL/container/VM backend for hard profiles or visibly exposes only supported lower guarantees.
- [ ] End-state reconciliation supplements broker evidence; external or unobserved paths are surfaced rather than hidden by a “complete trace” label.
- [ ] Platform/container/native prerequisites are introduced only with explicit user approval and a passing platform conformance suite.

## Evidence and non-claim gates

- [ ] Say “managed coding environment,” never “whole-world rollback.”
- [ ] Never call live provider calls deterministic replay.
- [ ] Never call runtime tests, trace hashes, or canonical serialization formal verification.
- [ ] Never promise that Shepherd paper benchmark improvements transfer automatically; run Cognia-specific workload and cost evaluations.
- [ ] Keep Context Engine mechanisms—child isolation, output artifacts, compaction, retrieval—separate from Shepherd execution claims.
- [ ] Never claim that external effects, the entire host computer, or unbrokered repository behavior are reversible.
- [ ] Never claim Git worktrees restore process or live agent state.
- [ ] State unavailable or skipped verification as a barrier, not a pass.

The strongest acceptable completion statement is:

> Cognia implements the frozen Shepherd task/effect/scope/trace programming model for managed coding/build-agent execution in TypeScript, including higher-order delegation, durable children, typed results, and replay. It provides coupled agent/environment restoration only when the recorded placement profile verifies that capability, and it explicitly denies, isolates, compensates, or audits effects outside the managed boundary.

## Guarded workspace production contract

As of the snapshot date, the experimental frontend and backend build packs opt into `workspace`. This profile holds destination writes in a managed Git worktree but does not isolate the worker process, network, credentials, or live agent state and cannot restore them.

The intended guarded controls are:

- explicit trust for the repository's exact current content identity;
- task-derived file scope for reads and writes;
- no generic shell tool for managed agents;
- host-registered no-shell verification profiles;
- verification environment limited to non-secret allowlisted variables such as `PATH` and `CI`;
- denial of shell interpreters, direct network utilities, package mutation/materialization, forged commands, credentials, and undeclared external effects;
- separate approval after executable configuration changes;
- bounded output and timeout with process-tree termination;
- intent-before-outcome recording for provider, tool, completion, and settlement boundaries;
- consume-once typed completion that disables later worker effects;
- exact revision-bound preview and separate user confirmation before settlement;
- post-composition verification and durable attention-required recovery;
- paginated, redacted observability;
- fail-closed replay UI when `coupled` restoration is required but unavailable.

Workspace settlement is an irreversible managed destination write with inspectable evidence. External release remains unavailable unless a separately admitted release adapter exists. A compromised repository verification script may still use host network availability even when credentials are removed; the workspace profile is not a security sandbox.

## Current known gaps

Recheck these dated findings before accepting a port. They were open in the 2026-07-22 implementation review even though the repository-wide test suite passed:

1. The build service accepted outer `succeeded` runs without requiring typed output `complete` or settlement eligibility, so blocked output could be retained.
2. Initial verification evidence could contain failed/errored statuses and still be retained; the later check occurred after destination materialization.
3. The production runtime cache key omitted the resolved Shepherd contract digest, allowing same-version hot reload to retain stale worker/effect authority.
4. Experimental supervisors retained generic `exec`, which bypassed the admitted structured effect boundary.
5. Command/workflow `@path.md` tokens were inert because pack mention expansion applied only to agent prompt templates.
6. No concrete process-isolated or coupled desktop backend was advertised; hard profiles correctly failed closed.
7. Production release settlement was unavailable without an injected adapter.
8. Durable SQLite/content storage lacked demonstrated encryption at rest.
9. General trace slicing, behavioral diff, structural-sharing evidence, and some Phase-15 workload/trajectory benchmarks were incomplete or calculator-only.
10. Operational limits and named verification profiles were hard-coded instead of fully configuration-driven.

Do not convert these gaps into permanent expectations. A future implementation may close them; require current source and negative tests as evidence before marking the corresponding gates complete.

## Focused-test evidence map

Use the highest relevant seam and include negative/adversarial cases. File names below are the durable expected coverage areas; if files are renamed, find their successors by behavior.

| Concern | Focused evidence |
| --- | --- |
| Frozen schemas, canonical records, authority, reducers, trace laws | `phase-0-conformance`, `kernel-canonical`, `kernel-authority`, `kernel-laws`, `kernel-reducers` |
| Typed tasks, ambient delivery, projection | `task-registry`, `task-execution`, `typed-projection` |
| Durable children and exactly-once result delivery | `child-storage`, `child-task-runtime` |
| Intent/outcome broker, policy, tool/provider effects | `effect-broker`, `effect-storage`, `desktop-tool-effects`, `settlement-effects` |
| Scope and binding attenuation | `scope-manager`, kernel authority/reducer tests |
| Transactional persistence, archive, recovery | `storage-transaction`, `storage-recovery`, candidate/effect/settlement/meta/replay storage suites |
| Retained placement and reconciliation | `workspace-placement`, `placement-capability`, `process-isolated-placement`, `candidate-retention`, `retained-candidate`, `candidate-storage` |
| Coupled contracts and checkpoint references | `coupled-checkpoint`, `context-checkpoint-integration`, `desktop-context-checkpoint` |
| Settlement exactness and crash recovery | `settlement-coordinator`, `settlement-effects`, `settlement-storage`, `workspace-placement` |
| Replay modes and public API | `replay-planner`, `replay-validator`, `replay-executor`, `replay-storage`, `replay-api`, `counterfactual-replay-adapter` |
| Meta-agents and CRO | `meta-observation-admission`, `meta-supervisor`, `meta-storage`, `meta-task-benchmark`, `counterfactual-*` |
| Managed build contracts/tools/runtime | `build-pack-contracts`, `build-pack-runtime`, `build-pack-service`, `desktop-build-tools`, `command-profile` |
| Pack dual gating and non-opt-in compatibility | `build-fe-experimental-pack`, `build-be-experimental-pack`, `runtime-migration`, `blank-pack`, pack loader/registry suites |
| Desktop control and redacted observability | `desktop-control-plane`, `desktop-observability`, `shepherd-approval-controls`, `shepherd-trace-panel` |

For a Shepherd-enabled port, run at minimum:

```bash
pnpm exec vitest run test/shepherd test/packs/build-fe-experimental-pack.test.ts test/packs/build-be-experimental-pack.test.ts test/packs/runtime-migration.test.ts test/ui/shepherd-approval-controls.test.ts test/ui/shepherd-trace-panel.test.ts
CI=true pnpm typecheck
CI=true pnpm test
CI=true pnpm build:desktop
```

Add pack-specific tests for its configured supervisors/workers, tools, effects, profile, trust, verification profiles, settlement actions, and non-opt-in behavior. A green generic suite cannot prove a port-specific contract that no test exercises.

## Port decision record

Emit a row for every gate with:

| Field | Required value |
| --- | --- |
| Gate | Exact checklist item or configured capability |
| Disposition | `native`, `adapted`, `blocked`, or `omitted-with-approval` |
| Configuration | Pack-owned IDs/profile/effects/tools/permissions involved |
| Runtime evidence | Source seam that enforces the behavior |
| Test evidence | Focused positive and negative tests |
| Actual guarantee | Claim allowed by resolved placement/effect boundary |
| Remaining risk | External, unobserved, unavailable, or unverified behavior |

Reject the port when a required gate has no runtime enforcement, depends only on prompt prose, relies on a removed plan file, or is represented as passing without executable evidence.
