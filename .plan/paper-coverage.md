# Paper Coverage Map

Paper baseline: [Shepherd paper v3](https://arxiv.org/html/2605.10913v3)

Audited: 2026-08-02; re-audited 2026-09-25 (see Known deviations)

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
| §5.1 Runtime supervisor | Observe, inject, handoff, discard/retry across conflicting workers | Phases 7, 9, and 10 (complete; [Phase 10 exit audit](./phase-10-exit-audit.md)) | Supervisor operation tests; the two-worker coding supervisor over real scope custody with inject, discard/restart from a clean fork, handoff, and accept; the versioned Appendix E protocol; the `no_supervision` baseline comparison; the research applications conformance scenario and process crash tests |
| §5.2 Counterfactual replay optimization | Dependency-aware workflow edits, targeted evaluation, suffix replay, cache evidence, promotion/handoff records | Phases 8–10 (complete; [Phase 10 exit audit](./phase-10-exit-audit.md)) | Affected-suffix optimizer tests, divergence and evaluation-gate refusals, the measured `full_replay` comparison in the checked evaluation report, retained candidate records and manifest, and process crash tests |
| §5.3 Meta-agent-guided Tree-RL | Trace-selected fork points, branched rollouts, inter/intra-branch advantages, training adapter | Phase 10 (complete for the synthetic deterministic scope; [Phase 10 exit audit](./phase-10-exit-audit.md)) | Deterministic selection, exact advantages, the `jsonl_v1` batch digest stable across stores and import, the `single_rollout` comparison, and process crash tests; no trainer and no measured learning experiment |
| §6 Conclusion | Honest summary of implemented programming-model and application coverage | Release documentation | Generated compatibility report linked from releases |

## Appendix coverage

| Paper appendix | Classification | Plan owner | Required treatment |
| --- | --- | --- | --- |
| A.1 Limitations | Normative non-claims | All phases | Report proof-of-existence scope, supervisor cost, and replay coupling limits with measured results |
| A.2 Future work | P3 research backlog | Phases 10–11 and future releases | Track interpretability interventions, continual-learning environments, substrate-native post-training, and safety frontiers without calling them paper-parity blockers |
| B Mechanized core and proof envelopes | Formal assurance boundary | Phases 1–2 | Native trace-machine validator and allowlisted static lowerings implemented; Core-0/Core-A strong claims are enabled, Core-0H stays fail-closed without a published trusted sidecar, and Lean execution remains external |
| C Extended performance | Measurement protocol | Phases 8, 10, and 11 | Record hardware, backend, warm/cold state, mutation size, branch count, observer load, cache evidence, and raw samples |
| D Trajectory compression | Fourth demonstrated meta-agent application | Phase 10 (complete; [Phase 10 exit audit](./phase-10-exit-audit.md)) | Fork-point/hint schema, suffix restoration, no-prune handling, verifier gate, best-of-N control, and reproducible aggregate artifacts implemented |
| E Runtime-supervision details | Experimental protocol | Phase 10 (complete) | Observation and action schemas, tools, prompts, budgets, seeds, and dataset selection versioned in the repository experiment definition and cited by digest in each manifest |
| F CRO details | Experimental protocol | Phase 10 (complete) | Proposer tools, reflection and handoff schemas, prompts, datasets, budgets, and seeds versioned and cited by digest; candidate lineage, targeted-eval verdicts, costs, and results retained as candidate records |

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

## 1.0 readiness classification (2.32.4)

The Phase 11 audit (#29) classified all 18 rows above in the
[release-readiness dashboard](./release-readiness-dashboard.md#paper-coverage-rows). Ten rows are
implemented for their documented scope (§1, §2, §3.1, §3.4, §5.1, §5.2, §6, D, E, F). B is
implemented for Core-0 and Core-A, with Core-0H version-fenced (activation disabled until a trusted
sidecar is published) and the Lean build external. §3.2 (compensation fixture, effect accounting),
§5.3 (no trainer or learning experiment), and A.1 (measured-scope limitations are published, but
the supervisor-cost, proof-of-existence, and replay-coupling disclosures are not mapped one to one)
have deferred remainders. §3.3, §4, and C are platform-fenced: optimized carriers on recorded hosts
and kernel SLOs on the macOS arm64 APFS reference host only; §4 now also covers the Phase 11
[performance report](../docs/performance-report.md). A.2 stays a classified P3 backlog. No row
claims reproduction of upstream results.

## Known deviations (2026-09-25 audit, 2.34.0)

A fresh section-by-section audit of paper v3 against the code found the deviations below. Rows
marked complete above remain complete for their documented offline scope; these items record where
that scope differs from the paper. Tracking epic:
[#202](https://github.com/avnionur/shepherd-typescript/issues/202).

| Paper section | Deviation | Issue |
| --- | --- | --- |
| §3.1, §4, C.6, §5 | Only `static` and `program` provider kinds; no live provider or prompt-cache measurement | [#204](https://github.com/avnionur/shepherd-typescript/issues/204) |
| §3.1, D.6, E, F | Task schemas limited to string, object, and void; application protocol schemas pinned but not evaluated | [#205](https://github.com/avnionur/shepherd-typescript/issues/205) |
| Fig. 1, §3.2, A.2, F.2.3 | No tool-use loop mapping tool calls to effects; no substrate-native meta-agent tools | [#206](https://github.com/avnionur/shepherd-typescript/issues/206) |
| §5.2, F.1 | CRO replays from the first dependent, so the edited step itself is served from the journal | [#207](https://github.com/avnionur/shepherd-typescript/issues/207) |
| D.5, D.6 | Compression refuses `fork_step` 0 and out-of-range steps instead of clamping; no rescue count | [#208](https://github.com/avnionur/shepherd-typescript/issues/208) |
| §3.2 | Compensable tier has no compensation handlers | [#209](https://github.com/avnionur/shepherd-typescript/issues/209) |
| §3.4, §5.3, D | No automatic per-step world checkpoints; Tree-RL and compression refuse world-bound sources | [#210](https://github.com/avnionur/shepherd-typescript/issues/210) |
| §5.1, E | Sequential workers, one decision per round, inject only before start, ownership-only handoff | [#211](https://github.com/avnionur/shepherd-typescript/issues/211) |
| §5.2, F.1–F.2 | No Algorithm 1 proposer loop, fix/guard gate, dev promotion, or computation-reuse metric | [#212](https://github.com/avnionur/shepherd-typescript/issues/212) |
| §5.3, F.6–F.7 | Heuristic fork points; advantages differ from Algorithm 2; no G roots per prompt | [#213](https://github.com/avnionur/shepherd-typescript/issues/213) |
| §4, C.1–C.5 | No fork/revert latency, mutation-size sweep, or observer-overhead benchmarks | [#214](https://github.com/avnionur/shepherd-typescript/issues/214) |
| §3.3, C.4, C.7 | Single-layer overlay, no layer compaction, no pluggable sandbox device layer | [#215](https://github.com/avnionur/shepherd-typescript/issues/215) |
| B | Runs and replay inspections do not carry proof envelopes; `extension` never emitted | [#216](https://github.com/avnionur/shepherd-typescript/issues/216) |
| §3.4 | Divergence only between a branch and its source; no N-way diff, regression search, or trace CLI | [#217](https://github.com/avnionur/shepherd-typescript/issues/217) |
| A.2, §6 | Future-work directions tracked in prose only | [#218](https://github.com/avnionur/shepherd-typescript/issues/218) |

The paper-version baseline is unchanged: v3 (24 Jun 2026) predates the 2026-08-02 audit.
