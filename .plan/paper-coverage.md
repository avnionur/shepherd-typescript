# Paper Coverage Map

Paper baseline: [Shepherd paper v3](https://arxiv.org/html/2605.10913v3)

Audited: 2026-08-02

## Purpose

This map prevents “full paper coverage” from becoming an untestable marketing claim. It connects
every substantive paper section to a TypeScript capability, roadmap phase, and required evidence.
The paper is a design and research target; a row is shipped only after its TypeScript public seam
passes the proof named in the parity matrix.

“Full TypeScript coverage” means:

1. the paper's runtime programming model is implemented through native TypeScript APIs;
2. the paper's formal claim boundary is represented and validated honestly in TypeScript;
3. the paper's demonstrated meta-agent applications have reproducible TypeScript implementations;
4. performance and experimental results are measured again rather than inherited from upstream;
5. limitations and future-work ideas remain visibly classified instead of being presented as
   shipped behavior.

The upstream Python runtime and Lean development may be used as pinned external oracles. Neither
is a runtime deliverable of this repository. TypeScript conformance to a proof-envelope profile is
not described as a new formal proof unless a separately verified theorem artifact supports it.

## Main-paper coverage

| Paper section | Required TypeScript surface | Plan owner | Completion evidence |
| --- | --- | --- | --- |
| §1 Introduction | First-class, inspectable, transformable execution | L0–L3 architecture | End-to-end supervisor scenario |
| §2 Related work | Explicit compatibility and non-claim boundary | Phase 0 documentation | Pinned sources and parity report |
| §3.1 Tasks | Typed tasks, task identity, task-as-value, substitution, synthesis, nested meta-agents | Phases 2 and 9 (complete; [Phase 9 exit audit](./phase-9-exit-audit.md)) | Descriptor suites, task value and child run handle tests, the delegation law suite, revision and execution-boundary tests, nested isolation tests, the conformance scenario, and process crash tests |
| §3.2 Effects | Typed intent/outcome events, custom effects, observation, interception, handler replay, reversibility tiers | Phases 2, 7, and 8 | Effect laws plus live deny/replace/replay tests |
| §3.3 Scopes | `emit`, `fork`, `merge`, `discard`, isolated nested/parallel scopes, coupled agent/environment state, pause/resume | Phases 6–8 | Algebraic laws, isolation tests, and coupled-checkpoint fixtures |
| §3.4 Traces | Immutable content-addressed graph, arbitrary historical access, rewind/replay, divergence, shared-prefix storage | Phases 1, 6, and 8 | Identity fixtures, byte-equivalent restore, replay, and storage-scaling benchmark |
| §4 Performance | Fork/revert latency, observer overhead, prefix-cache reuse, backend/scaling behavior | Phases 8, 10, and 11 | Reproducible TypeScript benchmark artifacts by platform/backend |
| §5.1 Runtime supervisor | Observe, inject, handoff, discard/retry across conflicting workers | Phases 7 and 9 (complete: observation, injection, handoff, discard, retry, and accept over child run handles) and 10 (two-worker application) | Supervisor operation tests and the conformance scenario; reproducible two-worker protocol and baseline comparison remain Phase 10 |
| §5.2 Counterfactual replay optimization | Dependency-aware workflow edits, targeted evaluation, suffix replay, cache evidence, promotion/handoff records | Phases 8–10 | Reproducible small CRO benchmark and artifact manifest |
| §5.3 Meta-agent-guided Tree-RL | Trace-selected fork points, branched rollouts, inter/intra-branch advantages, training adapter | Phase 10 | Synthetic deterministic rollout plus gated measured experiment |
| §6 Conclusion | Honest summary of implemented programming-model and application coverage | Release documentation | Generated compatibility report linked from releases |

## Appendix coverage

| Paper appendix | Classification | Plan owner | Required treatment |
| --- | --- | --- | --- |
| A.1 Limitations | Normative non-claims | All phases | Report proof-of-existence scope, supervisor cost, and replay coupling limits with measured results |
| A.2 Future work | P3 research backlog | Phases 10–11 and future releases | Track interpretability interventions, continual-learning environments, substrate-native post-training, and safety frontiers without calling them paper-parity blockers |
| B Mechanized core and proof envelopes | Formal assurance boundary | Phases 1–2 | Native trace-machine validator and allowlisted static lowerings implemented; Core-0/Core-A strong claims are enabled, Core-0H stays fail-closed without a published trusted sidecar, and Lean execution remains external |
| C Extended performance | Measurement protocol | Phases 8, 10, and 11 | Record hardware, backend, warm/cold state, mutation size, branch count, observer load, cache evidence, and raw samples |
| D Trajectory compression | Fourth demonstrated meta-agent application | Phase 10 | Fork-point/hint schema, suffix restoration, no-prune handling, verifier gate, best-of-N control, and reproducible aggregate artifacts |
| E Runtime-supervision details | Experimental protocol | Phase 10 | Version the observation schema, action schema, tools, prompts, budgets, seeds, and dataset selection |
| F CRO details | Experimental protocol | Phase 10 | Version proposer tools, scratchpad/handoff manifests, candidate lineage, targeted-eval gates, prompts, datasets, costs, and results |

## Coverage decisions

### Formal claims

Appendix B does not prove the complete production runtime. The TypeScript implementation preserves
that boundary: the executable Core-A validator and fail-closed reference/runtime classifier are
implemented, while ordinary runs remain runtime-only and stronger envelopes require exact
configured lowering, sidecar, and pinned theorem/artifact evidence. A formal proof remains an
external verified artifact.

### Experimental parity

Programming-model parity (L3) does not imply reproduction of the paper's reported benchmark
numbers. The application implementations and their reproducible protocols are required for full
project coverage, but results must be reported as this repository's measurements, including
failures and limitations.

### Future work

Appendix A.2 proposes research directions rather than capabilities demonstrated by the paper.
They are tracked explicitly at P3 so they cannot disappear, but they do not block the L3 paper
programming-model milestone.

## Audit result

The 2026-08-02 audit found and closed these planning omissions:

- mechanized-core and proof-envelope claim handling from Appendix B;
- trajectory compression and its best-of-N control from Appendix D;
- versioned protocol and artifact fidelity for Appendices E and F;
- explicit classification of Appendix A limitations and future work.

New paper revisions require a fresh section-by-section audit before the pinned baseline or parity
claims change.
