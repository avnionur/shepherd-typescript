# Phase 10 research applications exit audit

Audit: 2.25.1, 2026-09-18, #177. Delivered in the worktree for `codex/phase-10-*` together with
#171–#176.

Verdict: **complete for the documented scope**. Every roadmap work item and exit criterion maps to
public entry points, normative documentation, and repeatable tests, and both epic exit checkboxes
are supported below. The four paper applications (the Appendix E two-worker coding supervisor, the
Appendix F counterfactual workflow optimizer, Appendix D trajectory compression, and the §5.3
Tree-RL adapter) run offline against static providers and deterministic programs, each retains a
digest-bearing manifest citing its versioned protocol and every artifact, and one checked
evaluation report compares each against a simple repository baseline. No live provider, no
reproduction of upstream headline results, no trainer, and no performance claim is made. Phase 11
(production hardening and 1.0, epic #24) remains.

## Scope and evidence boundary

The [roadmap](./implementation-roadmap.md#phase-10--research-applications) lists nine work items
and five exit criteria. [Epic #23](https://github.com/avnionur/shepherd-typescript/issues/23)
groups them into six work checkboxes and two exit checkboxes. Children: contract #171, manifests
and the coding supervisor #172, the counterfactual optimizer #173, trajectory compression #174, the
Tree-RL adapter #175, evaluation, baselines, and the report #176, and this audit #177. The design
authority is the [research applications contract](./research-applications-contract.md); normative
behavior is in the `docs/` pages linked below.

Evidence is local: macOS arm64 (Node 24.17.0, APFS) for the full verification, including the
process-kill tests. World custody in the supervisor uses the reference copy carrier through
`createScopeWorldAdapter`; no Linux container run is required for this phase because no new world
carrier or jail behavior is introduced. Hosted workflows remain disabled at the owner's request.

## Roadmap work items

| Work item (unchanged) | Delivery | Implementation, documentation, and evidence |
| --- | --- | --- |
| Build a small two-worker coding supervisor | #172 | `runCodingSupervisor`, `inspectCodingSupervisorRun` in `./applications`; `createScopeWorldAdapter` in `./workspace`; [coding supervisor](../docs/coding-supervisor.md); [real scope custody test](../test/applications/coding-supervisor.test.ts) (line 41), [policy tests](../test/applications/coding-supervisor-policies.test.ts), [scope world adapter tests](../test/workspace/scope-world-adapter.test.ts) |
| Implement inject, handoff, and discard/restart policies | #172 | `inject`, `handoff`, `discard_restart`, and `accept` decisions over `injectChildRunContext`, `handoffChildRun`, `discardChildRun`, `retryChildRun`, `acceptChildRunResult`; "each policy kind is applied alone" ([policies](../test/applications/coding-supervisor-policies.test.ts) line 115); former-supervisor refusal ([supervisor](../test/applications/coding-supervisor.test.ts) line 263) |
| Build a counterfactual optimization example that edits a workflow and replays only affected suffixes | #173 | `runCounterfactualOptimization`, `inspectCounterfactualOptimization`; [counterfactual optimization](../docs/counterfactual-optimization.md); "only the affected suffix is replayed" ([optimizer](../test/applications/counterfactual-optimizer.test.ts) line 39), [lineage](../test/applications/counterfactual-lineage.test.ts), [failures](../test/applications/counterfactual-failures.test.ts) |
| Build the Appendix D trajectory-compression workflow with fork-point/hint output, suffix restoration, no-prune handling, verifier gating, and a bounded best-of-N control | #174 | `runTrajectoryCompression`, `inspectTrajectoryCompression`; [trajectory compression](../docs/trajectory-compression.md); pruned, restored, `no_prune`, unavailable-restore, and checkpoint cases ([compression](../test/applications/trajectory-compression.test.ts) lines 49–511), [failures](../test/applications/trajectory-compression-failures.test.ts), [recovery](../test/applications/trajectory-compression-recovery.test.ts) |
| Build a Tree-RL adapter over synthetic and small reproducible rollouts | #175 | `selectTreeRlForkPoints`, `runTreeRlRollouts`, `computeTreeRlAdvantages`, `exportTreeRlTrainingBatch`, `inspectTreeRlRun`; [Tree-RL adapter](../docs/tree-rl-rollouts.md); deterministic selection, exact advantages, and identical batch digests across stores and import ([Tree-RL](../test/applications/tree-rl.test.ts) lines 40, 85, 193), [failures](../test/applications/tree-rl-failures.test.ts) |
| Version the Appendix E supervision and Appendix F CRO prompts, schemas, tools, handoff records, dataset selections, budgets, costs, and seeds | #172, #173 (and #174, #175 for Appendix D and §5.3) | `readApplicationProtocol`, `applicationProtocolId`, `createApplicationManifest`, `validateApplicationManifest`, `inspectApplicationManifest`; [application manifests](../docs/application-manifests.md); the versioned definitions in [`research-applications.config.json`](../config/research-applications.config.json) (`supervision`, `counterfactual`, `compression`, `treeRl`); applications protocol v1–v5 with generated [manifest](../spec/schemas/application-manifest-v1.schema.json), [supervision](../spec/schemas/application-supervision-v1.schema.json), [CRO candidate](../spec/schemas/application-cro-candidate-v1.schema.json), [compression](../spec/schemas/application-compression-v1.schema.json), and [Tree-RL rollout](../spec/schemas/application-tree-rl-rollout-v1.schema.json) schemas; [manifest tests](../test/applications/application-manifest.test.ts) |
| Record evaluation inputs, versions, costs, and seeds | #176 | `runApplicationEvaluation`, `validateApplicationEvaluationReport`; [application evaluation](../docs/application-evaluation.md); the checked [report](../docs/generated/application-evaluation.md) and [JSON](../docs/generated/application-evaluation.json) carry every run's manifest, protocol identity and version, seeds, dataset, and measured costs; [evaluation tests](../test/applications/application-evaluation.test.ts) |
| Compare to simple baselines | #173–#176 | `no_supervision`, `full_replay`, `no_compression`, and `single_rollout` baselines with per-metric comparisons from `compareApplicationBaseline`; "every metric is measured from retained evidence and every configured baseline kind is run" ([evaluation](../test/applications/application-evaluation.test.ts)) |
| Publish limitations and avoid claiming reproduction of upstream headline results without equivalent experiments | #171, #176 | Contract [non-claims](./research-applications-contract.md#non-claims); configured limitations published verbatim in the report, including `no-upstream-reproduction`; "limitations are published verbatim and the documentation disclaims upstream results" ([evaluation](../test/applications/application-evaluation.test.ts)) |

## Roadmap exit criteria

| Criterion (unchanged) | Evidence | Outcome |
| --- | --- | --- |
| Each use case is reproducible offline or with clearly gated provider access | Every application runs against caller-supplied static providers or deterministic programs; no live provider exists. Seeded runs in fresh stores retain identical manifest digests (supervisor policies line 223, compression line 254, Tree-RL line 193). The evaluation report is byte-identical across repeated runs and fresh stores and re-executes nothing on repeat ("the report is byte-identical…"); `pnpm check:evaluation` regenerates it and fails on drift | Verified |
| The runtime-supervision, CRO, trajectory-compression, and Tree-RL applications expose their protocol and artifact manifests | The [conformance scenario](../test/applications/applications-conformance.test.ts) (line 186) runs all four through `./applications` in one store and, for every run, validates the manifest with `validateApplicationManifest` and the generated `application-manifest-v1` schema, proves its `protocol_id`, version, kind, seeds, dataset, and surfaces equal the configured protocol section (lines 211–266), and resolves every artifact citation to a retained record and published cut in the imported archive (line 299). Packaged probes exercise every application through the installed `./applications` entry (`pnpm test:package-cli`) | Verified |
| Causal fork/replay behavior is visible in exported traces | From the imported archive alone the scenario shows (lines 311–442): the supervisor's discard decision record and `delegation-retry` cut, the successor's `predecessor` citing both, and the world fork, discard, and merge receipts with the parent scope's children `discarded`, `discarded`, `merged`; every optimizer branch, the compressed session, the rewind, and every Tree-RL rollout restored from its declared source session, step boundary, trace cut, and prefix identity, with no live step before the target; and the full-replay baselines starting at step zero. Inspections, replay sessions, handles, and the training batch digest are identical on the live, read-only, and imported stores (line 281) | Verified |
| Evaluations have stable scripts and artifact manifests | `pnpm evaluate:applications` and `pnpm check:evaluation` (in `pnpm verify`) write and check the report and page; the report cites exactly the manifests retained by the evaluated store (conformance line 211) and the three unchanged experiments reproduce the checked report's runs, baselines, and comparisons (line 268); [artifact tests](../test/applications/evaluation-artifacts.test.ts) cover generation, host-independent re-check, mutation, and path refusal | Verified; final `check:evaluation` recorded after the #176 review fixes land |
| Performance and quality claims are scoped to measured results | Metrics are measured values only (`cost_usd`, `provider_calls`, `input_tokens`, `output_tokens`, `steps`, `success`); no wall-clock, host, or duration enters digest-bearing JSON; deltas are null unless both sides are numbers; the report publishes the configured limitations including `single-rollout-shared-cost` and `measurement-scope`; the evaluation report schema refuses extra metrics | Verified |

Epic exit checkboxes: "Each use case exposes stable protocol/artifact manifests and reproducible
execution" is supported by rows one, two, and four. "Claims remain limited to measured, versioned
results" is supported by rows four and five.

## Recovery classification

| Failure | Classification | Recovery and evidence |
| --- | --- | --- |
| Supervisor killed after a worker's durable start | Worker `running`, fail-closed | Documented cancellation path, then `discard_restart` forks clean custody; process test ([supervisor crash](../test/applications/coding-supervisor-crash.test.ts) line 28) |
| Crash between a world fork and the child's durable start | Retained fork receipt | Rerun reuses the fork without a second fork ([recovery](../test/applications/coding-supervisor-recovery.test.ts) line 315) |
| Process killed inside an optimizer candidate branch | Branch session `running` under a live lease, `interrupted` after expiry | Refused with `ReplaySessionInterruptedError` and no record while the lease is live; retained as `rejected` with `APPLICATION_EVIDENCE_INVALID` after expiry, never promoted; process test added by this slice ([replay application crash](../test/applications/replay-applications-crash.test.ts) line 79) |
| Process killed inside a Tree-RL rollout session | Rollout session `running` under a live lease, `interrupted` after expiry | Refused without a record while the lease is live; retained as a `failed` rollout, excluded from the batch, and the run completes; process test added by this slice ([replay application crash](../test/applications/replay-applications-crash.test.ts) line 26) |
| Process killed after the compression rewind restore, before the suffix | Rewound or restore-only rewind | Rerun converges with one restore; process tests ([compression crash](../test/applications/trajectory-compression-crash.test.ts) lines 23, 71) |
| Crash at an application append (opened, candidate, rollout, batch, promotion, outcome, manifest) | Partial application owner path | Rerun converges from retained sessions and records without extra provider calls (optimizer recovery line 180, compression failures line 466, Tree-RL recovery line 75) |
| Evaluation interrupted inside an application | Partial evidence | Rerun converges to the fresh-store report ("an evaluation interrupted inside an application converges…") |
| Imported archive | Inspection source | Raw appends to an application owner path are refused with `TraceStoreError` and inspection is unchanged (conformance line 444) |

## Independent review

Each slice was verified independently and its fixes are recorded in its tracker entry and in the
contract (the "(#17x fixed this reading…)" notes). The #176 review found, and a follow-up fix in the
same slice resolved:

- the optimizer could promote a candidate whose branch session ended `failed`; a candidate whose
  branch did not finish is now rejected and never promoted;
- `cost_usd` could fold to `0` when observed usage reported no cost; the contract requires `null`,
  so manifest and report costs are `null` whenever any observed usage lacks a cost (manifest
  digests of affected runs change accordingly);
- limitation wording in the repository evaluation definition was tightened, the counterfactual
  comparison restricts both sides to candidates with a full-replay comparison, and the generated
  page states that comparisons are not whole-run savings;
- trajectory compression kept a branch for a null terminal result that became unreachable once
  only finished sessions reach child evidence; it was removed to restore 100% branch coverage.

Final verification of those fixes is recorded below; this audit's conformance scenario
derives its expectations from the code and the checked report rather than hard-coded digests or
costs. This slice (#177) found no new defect: the conformance scenario and both new process tests
passed against the delivered code on first execution after test-side corrections.

## Verification (2.25.1)

- `pnpm sync:version` passes and `package.json`, `release-config.yaml`, and the changelog read
  2.25.1.
- Focused: `node --test test/applications/applications-conformance.test.ts` (1 test, pass) and
  `node --test test/applications/replay-applications-crash.test.ts` (2 tests, pass); `tsc --noEmit`
  and `biome check` pass on the new files.
- `CI=true pnpm verify` after the #176 review fixes: `check:protocol`, `check:evaluation`,
  `build`, `check:api-reference`, `lint` (0 errors; 2 pre-existing warnings outside Phase 10), and
  `typecheck` pass; `pnpm test` runs 841 tests, 840 pass, with 100% line, branch, and function
  coverage on all files. The single failure is the host clone carrier test listed under Limits.
- Because the test stage stops `verify`, its remaining stages ran separately:
  `pnpm build && pnpm test:package-cli` pass, including the applications, counterfactual,
  compression, Tree-RL, and evaluation package probes.
- `pnpm build:desktop` passes.

## Limits

Carried from the slice reviews; none blocks the documented scope.

- Host: the macOS clone carrier test ("clone carrier fails closed on a macOS filesystem without
  clonefile support") fails on this host because the C toolchain cannot link the clone helper; it
  fails identically on `main` and is environmental.
- #172: the supervisor protocol's observation and action schema surfaces are pinned by digest only;
  observations and decisions are validated against the closed `application-supervision-v1` grammar,
  not by a runtime JSON Schema evaluator. A crash after applying a decision and before its
  supervision record recovers the decision from the retained delegation commands, but observations
  are re-derived at recovery rather than replayed.
- #173: `minPromotionScore` is an integer like every protocol budget (evaluator scores may be
  fractional); `ReplayMaterializationUncertainError` from a candidate session is not mapped to an
  application failure and propagates.
- #174: an interrupted restoration or control session rejects its candidate and stops the run
  rather than continuing.
- #175: the `single_rollout` baseline reuses branch-0 rollouts, so it shares cost with the tree
  batch (not an equal-budget comparison); a failed branch 0 drops its fork point from the v4
  training batch, while the evaluation report still counts it in baseline cost and steps and marks
  baseline success false. The adapter trains nothing.
- Delegation (pre-existing, Phase 9): the `clock?` option is declared on child run options but
  `openChildRun` and `runChildRun` refuse it as an unknown key.
- No live provider adapter; every figure is an offline measurement on synthetic fixtures with
  configured seeds, single-host, with no wall-clock or throughput measurement.
