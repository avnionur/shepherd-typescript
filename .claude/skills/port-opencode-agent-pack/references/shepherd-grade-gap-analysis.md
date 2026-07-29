# Shepherd-grade coding-agent gap analysis snapshot

## Snapshot status

This skill-local reference preserves the Shepherd 0.3.0/paper-to-Cognia decision boundary captured on 2026-07-22. It remains usable if the original planning document is removed. Revalidate moving upstream facts before changing the contract; do not weaken Cognia gates merely because upstream has not shipped them.

## Executive decision

Cognia must implement a native strict-TypeScript task/effect/scope/trace runtime for managed coding agents. The public Python Shepherd package is behavioral research input, not a runtime dependency or ABI. Cognia requires several roadmap capabilities absent from public Shepherd 0.3.0: ambient typed delivery, returned scoped handles, evidence-backed typed projection, durable children, task-as-value delegation, higher-order supervision, and public replay.

The execution claim is bounded: Cognia can describe only effects mediated by its broker and only isolation/restoration demonstrated by the resolved placement backend. It cannot claim whole-world rollback, universal deterministic replay, or that a Git worktree restores processes and agent state.

## Upstream capability mapping

| Capability | Public/paper boundary | Required Cognia behavior |
| --- | --- | --- |
| Typed tasks and task registry | Public 0.3.0 ships decorated tasks and retained runs. | Native TypeScript schemas, registry, immutable task values, compatible substitution, and runtime validation. |
| Signature authority | Public release grants whole named bindings. | Preserve named binding authority and add file scope plus typed command, network, provider, credential, publish, database, and settlement capabilities. |
| Effects | Public handlers intercept admitted in-process boundaries; the paper classifies reversible, compensable, and irreversible effects. | One shared intent-before-outcome broker, causal outcomes/failures/unknown states, explicit observation scope, and no hidden materialization bypass. |
| Scope | Paper scopes support emit, fork, merge, discard, adoption, abandonment, publication, pause/resume, and revert laws. | Typed durable scopes/bindings with authority attenuation, restart recovery, and executable law tests. |
| Retained candidates | Public 0.3.0 ships retained per-binding changes and settlement. | Immutable baseline/ancestry, authoritative reconciliation, typed evidence, candidate comparison, and no destination mutation before settlement. |
| Settlement | Public release ships consume-once select/apply/release/discard; select is fast-forward-only and apply requires path-disjointness. | Exact identity, preview/prepare/execute/inspect, separate confirmation, idempotency, crash recovery, and explicit conflict-resolution tasks. |
| Typed return values | Resource handles and evidence-backed projection were roadmap items, not public 0.3.0 behavior. | Opaque scoped durable handles; distinguish model assertions from artifact/effect-backed fields with citations. |
| Durable children | First-class long-lived supervised children were roadmap work. | Persist lifecycle, parentage, mailboxes, exactly-once result delivery, attenuation, checkpoints, recovery, and settlement ownership. |
| Task-as-value delegation | Higher-order `oversee(task)` semantics were not shipped publicly. | Pass tasks as immutable values, synthesize with provenance, supervise bounded retry/fork, compare candidates, and publish exact typed results. |
| Replay | Public runs were designed for future replay; no complete public API existed. | Dependency-cone planner, validator, executor, branch storage, explicit effect modes, checkpoint validation, deterministic fixtures, and visible variance. |
| Trace graph | The reference kernel demonstrates content-addressed records/cuts but not the complete runtime. | Atomic append, ancestry, cuts, slices, branches, structural sharing, behavioral diff, export/import, schema migration, and transactional content storage. |
| Placement | Public jail/advisory behavior and paper snapshot backends have different guarantees. | SPI capability discovery, requested/resolved profile recording, health/attestation, fail-closed hard requirements, cleanup, and recovery. |
| Context management | Shepherd does not solve the model context window. | Keep Context Engine child isolation, bounded projections, artifacts, summaries, epochs, and recall separate; link immutable snapshot references only. |

## Capabilities beyond public 0.3.0

These remain mandatory Cognia features rather than optional future work:

- Ambient task delivery through an explicit typed execution context; ambient authority is forbidden.
- Returned resource handles with owner, lineage, scope, lifecycle/expiry, serialization, and non-forgeable authority.
- Typed projection that identifies evidence-backed fields separately from model-reported assertions.
- Immutable task results/handles that can be passed between tasks without copying child transcripts.
- Durable child execution and supervision across restart.
- Task-as-value delegation, compatible substitution, synthesis provenance, bounded retry/fork, and exact publication.
- Public replay with dependency cones and explicit effect modes.
- Fine-grained binding/file/command/network/provider/credential/external-effect grants.

## Paper applications

| Application | Product decision |
| --- | --- |
| Runtime supervisor for parallel coding agents | Core product use case. Implement observation/intervention/candidate comparison and run Cognia-specific evaluations; do not promise the paper's uplift. |
| Counterfactual Replay Optimization | Required advanced capability after replay foundations. Reuse unaffected prefixes conservatively and fall back to full replay for broad dependency cones. |
| Tree-GRPO/meta-agent branching | Substrate should support tree branches and credit export; an RL trainer is not a managed-coding conformance requirement. |
| Trajectory compression | Optional optimizer built on required checkpoint/replay primitives; never a prerequisite for safe settlement. |

Paper case studies are proofs of existence, not guaranteed policies, robustness claims, or evidence that equivalent results require Shepherd.

## Formal and security boundary

- Runtime tests and trace hashes are not formal verification.
- A proof tier must be explicit; never infer proof strength from a placement/profile name.
- Narrow structural replay theorems do not verify arbitrary control flow, model output, prompt caches, shells, filesystems, sandboxing, scheduling, retries, recovery, cancellation, or multi-branch execution.
- Model calls, email, publication, network, databases, registries, credentials, global caches, daemons, and system packages are external effects. Deny, isolate, compensate, or audit them; do not label them reversible.
- Supervisor/meta-agent cost can exceed worker cost for small tasks. Admission must be risk/value/budget aware.
- A supervisor remains fallible; the substrate does not solve alignment.

## Platform prerequisites

TypeScript can define the model but cannot by itself provide syscall containment or atomic process/filesystem snapshots.

- `process-isolated` requires an admitted OS/container/VM backend with controlled process, network, and credential boundaries.
- `coupled` requires synchronized capture/restore of agent cursor, filesystem, process/container state, bindings, tool surface, and trace cut.
- Worktrees qualify only for `workspace` destination-write containment.
- Windows needs an approved WSL/container/VM route for hard profiles or must expose lower guarantees visibly.
- Broker evidence must be reconciled with authoritative end state because command-correlated observation can miss mutation paths.
- Provider prompt-cache reuse is telemetry/optimization, never a semantic replay guarantee.

## Required profiles

| Profile | Required guarantee | Allowed claim |
| --- | --- | --- |
| `trace-only` | Typed immutable intent/outcome records. | Recorded Cognia-mediated effects; no containment. |
| `workspace` | Retained repository state, path authority, ancestry, consume-once settlement, reconciliation. | Revertible managed workspace proposal. |
| `process-isolated` | Workspace guarantees plus process/container isolation and controlled network/credentials. | Isolated managed coding process, limited to declared external effects. |
| `coupled` | Verified synchronized agent/environment checkpoint and restore. | Shepherd-grade coupled agent/environment fork for the managed placement. |

## Frozen completion boundary

Managed coding is complete only when the programming-model, coding-runtime, placement, evidence, and non-claim gates in [Shepherd port acceptance boundary](shepherd-port-acceptance.md) all pass. The strongest allowed summary is:

> Cognia implements the frozen Shepherd task/effect/scope/trace programming model for managed coding/build-agent execution in TypeScript, including higher-order delegation, durable children, typed results, and replay. It provides coupled agent/environment restoration only when the recorded placement profile verifies that capability, and it explicitly denies, isolates, compensates, or audits effects outside the managed boundary.

Never claim:

- Cognia can undo everything an agent did.
- Every run is byte-identically replayable.
- Git worktrees implement atomic process/filesystem/agent forks.
- The production runtime is formally verified.
- Paper benchmark improvements automatically transfer to Cognia.
- Shepherd solves model context-window limits.

## Primary-source index captured by the snapshot

- Shepherd paper v3: `https://arxiv.org/html/2605.10913v3`
- Official project: `https://shepherd-agents.ai/`
- Official documentation and roadmap: `https://docs.shepherd-agents.ai/`
- Official repository: `https://github.com/shepherd-agents/shepherd`
- Public v0.3.0 release: `https://github.com/shepherd-agents/shepherd/releases/tag/v0.3.0`
- Reference kernel: `https://github.com/shepherd-agents/shepherd/tree/main/shepherd2`
- Transactional execution substrate: `https://github.com/shepherd-agents/shepherd/tree/main/vcs-core`
