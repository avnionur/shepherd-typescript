# Release-readiness dashboard

Status: 2.32.4, 2026-09-19, #29; updated in 2.32.5 for the F-029 fix and in 2.33.0 for the F-016
fix (#189, configured canonical nesting bound), and in 2.33.1 for the Phase 11 close-out (#190: local
Docker Linux lane, F-030 and F-031 fixed, F-032 open for the owner's release work, owner actions
moved to #191), and in 2.33.3 for the owner decisions of #191 (a hosted-CI enablement attempt
blocked by an account billing limit and the workflows disabled again, CodeQL unavailable without
GitHub Advanced Security, email vulnerability intake, registry name decided, F-032 fixed; remaining
owner actions moved to #199).
Companion to the
[Phase 11 exit audit](./phase-11-exit-audit.md). It shows every phase epic, every
[parity matrix](./parity-matrix.md) row, and every [paper coverage](./paper-coverage.md) row with
one classification. Nothing classified below as open, fenced, or unsupported is presented as
complete anywhere in the repository.

Classifications:

- **Implemented**: the named proof passes through the public seam (exit audits and tests).
- **Implemented, remainder deferred**: the core proof passes; a named remainder is not built.
- **Platform-fenced**: implemented and verified only on named hosts; elsewhere it fails closed or
  is unmeasured.
- **Version-fenced**: configured behind a protocol or configuration gate that is disabled by
  default or until trusted evidence exists.
- **Classified unsupported / deferred / external**: not built; the boundary is documented and the
  runtime refuses or does not claim it.

## Phase epics

| Phase | Epic | State | Exit evidence | Level |
| --- | --- | --- | --- | --- |
| 0 Baseline, identity, and repository foundation | #13 | Closed 2026-08-16 | Epic exit checkboxes ticked; [tracker](./tracker.md), [upstream baseline](./upstream-baseline.md); no separate exit-audit file | L0 foundation |
| 1 Canonical specification and trace kernel | #14 | Closed 2026-08-16 | Epic exit checkboxes ticked; golden vectors, atomicity, idempotency, crash suites, round trip ([tracker](./tracker.md)); no separate exit-audit file | L0 |
| 2 Tasks, effects, outcomes, offline execution | #15 | Closed 2026-08-16 | [Phase 2 exit audit](./phase-2-exit-audit.md) (1.10.1) | L0/L1 inputs |
| 3 Workspaces, retained outputs, basic settlement | #16 | Closed 2026-08-18 | [Phase 3 exit audit](./phase-3-exit-audit.md) (1.36.1) | L1-alpha |
| 4 Full documented `0.3.0` compatibility | #17 | Closed 2026-08-25 | [Phase 4 exit audit](./phase-4-exit-audit.md) (1.51.0) | L1 |
| 5 Native TypeScript product surface | #18 | Closed 2026-09-08 | [Phase 5 exit audit](./phase-5-exit-audit.md) (1.68.1, remediation 2.0.0) | L1 product surface |
| 6 Scope algebra and versioned-world substrate | #19 | Closed 2026-09-13 | [Phase 6 exit audit](./phase-6-exit-audit.md) (2.7.1) | L2, recorded hosts |
| 7 Live observation and interception | #20 | Closed 2026-09-14 | [Phase 7 exit audit](./phase-7-exit-audit.md) (2.10.1) | L3 progress |
| 8 Coupled checkpoints, rewind, and replay | #21 | Closed 2026-09-14 | [Phase 8 exit audit](./phase-8-exit-audit.md) (2.15.1) | L3 progress |
| 9 Task-as-value meta-agents | #22 | Closed 2026-09-15 | [Phase 9 exit audit](./phase-9-exit-audit.md) (2.20.1) | L3 documented scope |
| 10 Research applications | #23 | Closed 2026-09-18 | [Phase 10 exit audit](./phase-10-exit-audit.md) (2.25.1) | L3 research applications, offline scope |
| 11 Production hardening and 1.0 | #24 | Closed with the close-out (#190, PR #198) after the owner re-scope of 2026-09-19 | [Phase 11 exit audit](./phase-11-exit-audit.md) (2.32.4; F-029 fixed in 2.32.5; [close-out addendum](./phase-11-exit-audit.md#linux-verification-lane-and-close-out-2331) 2.33.1): in-repo scope complete, including a local Docker Linux lane on Node 24.21.0 and 24.12.0; owner-only items O-1 to O-5 move to #191; [#191 addendum](./phase-11-exit-audit.md#owner-actions-2333) 2.33.3: owner decisions delivered, remainder moved to #199 | L4 release candidate for the in-repo scope; GA no-go until #199 closes |

Source: `gh issue list --state all --label type:epic` on 2026-09-19. Children of #24 (#187, #179
to #186, #29) are open pending the Phase 11 pull request.

## Parity matrix rows

Evidence columns cite the phase exit audit or doc that proves the row; the planned-proof text in
the [parity matrix](./parity-matrix.md) states the full requirement.

### Core semantic surface

| Row | Classification | Evidence or boundary |
| --- | --- | --- |
| Typed task declaration | Implemented | Phase 2 ([task descriptors](../docs/task-descriptors.md)) |
| Bodyless task contract | Implemented | Phase 2 offline and durable execution (`executeTask`, `executeTaskDurably`); the matrix text "durable run retention follows" predates Phase 2 durable execution and is corrected |
| Bodied deterministic task | Classified (adapted) | No decorator or callable bodied task; ordinary TypeScript functions and Phase 9 program-serviced children replace it ([Python-to-TypeScript](../docs/python-to-typescript.md)) |
| Doc/instruction is behavioral identity | Implemented | [Phase 2 exit audit](./phase-2-exit-audit.md) |
| Runtime input/output validation | Implemented | Phase 2 audit (invalid provider output) |
| Task registration/version resolution | Implemented | [Task registry](../docs/task-registry.md) |
| Task as argument/value | Implemented | [Phase 9 exit audit](./phase-9-exit-audit.md) |
| Runtime task synthesis/rewrite | Implemented | Phase 9 ([task revision](../docs/task-revision.md)) |
| Returned resource handles | Implemented | Phase 9 ([task values](../docs/task-values.md)) |
| Typed value projection | Implemented | Phase 9 ([result threading](../docs/result-threading.md)) |

### Effects

| Row | Classification | Evidence or boundary |
| --- | --- | --- |
| Typed effect records | Implemented | [Effect records](../docs/effect-records.md) |
| Intent/outcome correlation | Implemented, remainder deferred | Exact content-bound correlation; no separate stream-ordering proof is recorded |
| Immutable append stream | Implemented | Phase 1 kernel ([SQLite trace store](../docs/sqlite-trace-store.md)) |
| In-process handlers | Implemented | [Effect handlers](../docs/effect-handlers.md) |
| Non-perturbing observation | Implemented | [Phase 7 exit audit](./phase-7-exit-audit.md) |
| Pre-materialization interception | Implemented | Phase 7 ([supervised effects](../docs/supervised-effects.md)) |
| Custom effect families | Implemented | Custom effect kinds with exact-kind handlers (#101, [examples](../docs/typescript-examples.md)); unknown schema fields preserved by native interchange |
| Reversible tier | Implemented | World-owned state restored byte-equivalently by rewind ([Phase 8 exit audit](./phase-8-exit-audit.md)); the tier annotation alone does not reverse arbitrary callbacks |
| Compensable tier | Classified deferred | Vocabulary only; no idempotent compensation fixture |
| Irreversible tier | Implemented | Replay never re-materializes without policy approval (Phase 8); approval frontier (Phase 7) |

### Runs, traces, and kernel

| Row | Classification | Evidence or boundary |
| --- | --- | --- |
| Durable run ledger | Implemented | Phases 2 and 4 ([task/run ledgers](../docs/task-run-ledgers.md)) |
| Success/failure/exhausted/cancelled outcomes | Implemented | [Run outcomes](../docs/run-outcomes.md) |
| Artifacts and usage | Implemented | [Run artifacts and usage](../docs/run-artifacts-and-usage.md) |
| Content-addressed record identity | Implemented | [Canonical records](../docs/canonical-records.md), golden vectors |
| Atomic append batches | Implemented | Phase 1 crash suites; Phase 11 kill suites |
| Idempotent append intent | Implemented | Phase 1; Phase 11 fault classification |
| Owner/cut/slice addressing | Implemented | [Trace queries](../docs/trace-queries.md) |
| Trace query and materialization | Implemented, remainder deferred | Bounded selectors implemented; upstream event verbs and CLI golden output remain |
| Orphaned operation diagnosis and repair | Implemented | [Orphan operation repair](../docs/orphan-operation-repair.md) |
| Live trace subscription | Implemented | Phase 7 ([trace subscriptions](../docs/trace-subscriptions.md)) |
| Arbitrary rewind | Implemented | Phase 8 ([rewind and replay](../docs/rewind-and-replay.md)) |
| Suffix replay | Implemented | Phase 8 |
| Export/import | Implemented, remainder deferred | Native archive v1, `store export/import`, backup and restore (Phase 11); ATIF export not built |

### Worlds, scopes, and settlement

| Row | Classification | Evidence or boundary |
| --- | --- | --- |
| Workspace initialization/adoption | Implemented, remainder deferred | [Workspace initialization](../docs/workspace-initialization.md); pinned dirty-worktree oracle parity remains |
| Named disjoint bindings | Implemented | [Workspace bindings](../docs/workspace-bindings.md) |
| Retained world output | Implemented | [Phase 3 exit audit](./phase-3-exit-audit.md) |
| Read-only changeset | Implemented | Phase 3 |
| `select` fast-forward settlement | Implemented | Phase 3 |
| `apply` path-disjoint three-way settlement | Implemented | [Phase 4 exit audit](./phase-4-exit-audit.md) |
| `release` | Implemented | Phase 4 |
| `discard` | Implemented | Phase 3 |
| Consume-once settlement | Implemented | Phase 3 |
| Scope `emit/fork/merge/discard` | Implemented, platform-fenced | [Phase 6 exit audit](./phase-6-exit-audit.md): copy carrier everywhere; clone and overlay carriers on recorded hosts only |
| Nested/concurrent scopes | Implemented | Phase 6 |
| Agent + environment atomic fork | Implemented | Phase 8; program memory re-derived, never captured |
| Process checkpoint/resume | Implemented, platform-fenced | Cooperative backend implemented; transparent CRIU backend reports unavailability, no transparent image claimed |
| Storage sharing by divergent suffix | Implemented, platform-fenced | Phase 6 storage scaling benchmark ([optimized carriers](../docs/optimized-carriers.md)) on recorded hosts |

### Permissions, placement, and safety

| Row | Classification | Evidence or boundary |
| --- | --- | --- |
| Runtime permission descriptors | Implemented | [Repository grants](../docs/repository-grants.md) |
| `ReadOnly`/`ReadWrite` per binding | Implemented | Phase 4 |
| Whole-run permission ceiling | Implemented | Phase 4 |
| Deny by default | Implemented | Phase 4 |
| Advisory placement | Implemented | [Placement resolution](../docs/placement-resolution.md) |
| Auto placement | Implemented | Phase 4 |
| Jail placement fails closed | Implemented | [Native jail execution](../docs/native-jail-execution.md) |
| macOS Seatbelt | Platform-fenced | Real local denial suite on macOS |
| Linux Landlock/container jail | Platform-fenced | The native jail tests (live Landlock probe with a real denial, runner admission, jailed granted capture at the durable task-world seam) ran and passed unprivileged in the local Docker Linux lane (Landlock ABI 8, 2.33.1, [addendum](./phase-11-exit-audit.md#linux-verification-lane-and-close-out-2331)); no hosted or bare-metal Linux run (O-3, #191) |
| Windows/WSL policy | Classified unsupported | Native Windows unsupported; WSL uses Landlock only when its probe and denial suite pass |
| Capability attenuation/delegation | Implemented | Phase 9 ([delegated authority](../docs/delegated-authority.md)) |
| Irreversible-effect approval gate | Implemented | Phase 7 ([supervision control](../docs/supervision-control.md)) |

### Providers and higher-order behavior

| Row | Classification | Evidence or boundary |
| --- | --- | --- |
| Deterministic/static provider | Implemented | [Static provider](../docs/static-provider.md) |
| Claude CLI provider | Classified deferred | No live provider adapter ships |
| Codex provider | Classified deferred | No live provider adapter ships |
| OpenRouter/provider adapter | Classified deferred | No live provider adapter ships |
| Provider-neutral event model | Implemented, remainder deferred | Request/response and descriptor normalization; streaming event normalization remains |
| Provider prompt/cache identity | Implemented, remainder deferred | Offline identities and cache-hit evidence (Phase 8); live provider adapters remain |
| Cancellation and budgets | Implemented, remainder deferred | Counter and duration controls; effect accounting remains |
| Runtime supervisor | Implemented | [Phase 10 exit audit](./phase-10-exit-audit.md) |
| Inject/steer | Implemented | Phase 9; provider-side conversation mutation not claimed |
| Handoff/redirect | Implemented | Phase 9; ownership only |
| Discard/revert worker | Implemented | Phases 9 and 10 |
| Counterfactual replay optimizer | Implemented | Phase 10 (offline) |
| Trajectory compression | Implemented | Phase 10 (offline) |
| Tree-RL fork integration | Implemented | Phase 10 synthetic rollouts; no trainer |

### Formal assurance and claim boundaries

| Row | Classification | Evidence or boundary |
| --- | --- | --- |
| Executable typed-effect trace machine | Implemented | [Formal assurance](../docs/formal-assurance.md) |
| Proof-envelope profiles and strengths | Implemented | Phase 2 audit |
| Static-fragment lowering evidence | Implemented | Allowlisted manifests |
| Core-0H sidecar validation | Version-fenced | Validation implemented; activation disabled until a trusted published sidecar is configured |
| Pinned theorem-artifact metadata | Classified external | Metadata drift checks implemented; the Lean build is not run locally |
| Fail-closed claim classification | Implemented | Phase 2 audit |
| Runtime/formal non-claim boundary | Implemented | Frozen envelopes report excluded surfaces |

### Paper experiments and reporting

| Row | Classification | Evidence or boundary |
| --- | --- | --- |
| Runtime-supervision protocol fidelity | Implemented | Phase 10; schemas digest-pinned, not runtime-evaluated |
| CRO protocol fidelity | Implemented | Phase 10 |
| TypeScript-owned performance report | Platform-fenced | [Performance report](../docs/performance-report.md): macOS arm64 APFS reference host only |
| OpenTelemetry-compatible observability | Implemented | Phase 11 #184 ([observability](../docs/observability.md)); no SDK, collector, or metrics signal |
| Paper limitation reporting | Implemented, remainder deferred | Measured-scope limitations published verbatim in the [evaluation report](../docs/generated/application-evaluation.md) and the contracts' non-claims; no section maps the Appendix A.1 supervisor-cost, proof-of-existence, and replay-coupling disclosures one to one |
| Paper future-work register | Classified deferred | Appendix A.2 rows kept at P3 in the [paper coverage map](./paper-coverage.md) |

### CLI

| Row | Classification | Evidence or boundary |
| --- | --- | --- |
| `init` | Implemented | [CLI](../docs/cli.md) |
| `doctor` | Implemented | CLI |
| `run list/show/trace/trace-revision/changeset` | Implemented | Phase 4 |
| `run select/discard` | Implemented | Phase 4 |
| `run apply/release` | Implemented | Phase 4 |
| `run outputs/output-citations/vcscore` | Implemented | Phase 4 |
| `run publish-retained-workspace-output` | Implemented | Raw missing-cut repair fails closed without managed recovery authority |
| `run repair` | Implemented | Phase 4 |
| `task list/register/resolve/show` | Implemented, remainder deferred | list, resolve, show implemented; dynamic source registration fails closed |
| `demo write` | Implemented | [Quickstart](../docs/quickstart.md) |
| `package init` | Classified deferred | Configured honest refusal |
| `store verify/backup/restore/export/import/maintain` | Implemented | Phase 11 #182, #183 |
| fenced `run start` compatibility | Version-fenced | Configured and disabled by default |

Totals (99 rows): 73 implemented; 9 implemented with a deferred remainder; 3 implemented and
platform-fenced; 3 platform-fenced; 2 version-fenced; 9 classified (6 deferred, 1 unsupported, 1
adapted, 1 external). No row is unclassified.

## Paper coverage rows

| Paper section | Classification | Evidence or boundary |
| --- | --- | --- |
| §1 Introduction | Implemented | End-to-end supervisor scenario (Phase 10 conformance) |
| §2 Related work | Implemented | [Upstream baseline](./upstream-baseline.md), this dashboard, and the parity matrix |
| §3.1 Tasks | Implemented | Phases 2 and 9 |
| §3.2 Effects | Implemented, remainder deferred | Phases 2, 7, 8; compensation fixture and effect accounting remain |
| §3.3 Scopes | Implemented, platform-fenced | Phases 6 to 8; optimized carriers on recorded hosts |
| §3.4 Traces | Implemented | Phases 1, 6, 8; shared-prefix storage benchmark on recorded hosts |
| §4 Performance | Platform-fenced | Phase 8 and 10 measurements, Phase 11 kernel benchmark and SLOs on the reference host only |
| §5.1 Runtime supervisor | Implemented | Phase 10 (offline) |
| §5.2 Counterfactual replay optimization | Implemented | Phase 10 (offline) |
| §5.3 Meta-agent-guided Tree-RL | Implemented, remainder deferred | Phase 10 synthetic scope; no trainer, no learning experiment |
| §6 Conclusion | Implemented | This dashboard and the [1.0 release notes](../docs/release-notes-1.0.md); no release is published to link it from |
| A.1 Limitations | Implemented, remainder deferred | Measured-scope limitations published; A.1 disclosures not mapped one to one |
| A.2 Future work | Classified deferred | P3 research backlog |
| B Mechanized core and proof envelopes | Implemented, version-fenced | Core-0/Core-A strong claims enabled; Core-0H fenced; Lean external |
| C Extended performance | Platform-fenced | Raw samples and environment recorded for the reference host |
| D Trajectory compression | Implemented | Phase 10 |
| E Runtime-supervision details | Implemented | Phase 10 |
| F CRO details | Implemented | Phase 10 |

No paper row is presented as a reproduction of upstream headline results; every figure is this
repository's own measurement ([paper coverage](./paper-coverage.md#experimental-parity)).
