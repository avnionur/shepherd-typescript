# Capability evidence inventory

Generated from [reviewed configuration](../../config/capability-inventory.config.json). Run `pnpm generate:capabilities` after reviewing claims; `pnpm check:capabilities` rejects drift and is part of `pnpm verify`.

Baseline: upstream [v0.3.0](https://github.com/shepherd-agents/shepherd/tree/a8196d4c453514836d06bd2fece91a03cdc37107) and [paper v3](https://arxiv.org/html/2605.10913v3), reviewed for issue #236. Release vocabulary, research targets, imported proof evidence and native extensions are distinct sections.

The gate checks emitted public exports, complete evidence dimensions, and SHA-256 pins of cited local files. It does not run cited experiments or establish that prose is true. Evidence pins require human review when their content changes; generation never refreshes them. Test files specify executable evidence, not passing live/platform results. No aggregate coverage percentage is assigned.

See [inventory maintenance](../capability-inventory.md) for verification commands and the review boundary.

## Upstream 0.3.0 release vocabulary

### Typed tasks and explicit execution

Upstream 0.3.0 task/schema vocabulary; adapted to explicit TypeScript descriptors and providers.

Public entry points: `./tasks#task`, `./tasks#schema`, `./runs#executeTaskDurably`

| Dimension | Evidence boundary |
| --- | --- |
| API availability | Supported: scalar forms, arrays, literals/enums, disjoint unions, strict objects with optional fields, task values and whole-value void. |
| Composed behavior | Adapted: explicit provider execution; no ambient Python decorator calls. General constraints, tuple/dictionary/recursive forms remain unsupported. |
| Restart recovery | Durable run reconstruction exists; a started uncertain provider operation is refused rather than blindly repeated. |
| Live-provider evidence | No live-provider result claimed; ordinary tests use deterministic providers. |
| Performance evidence | No performance result claimed by this row. |
| Supported platforms / evidence | Node runtime support applies; filesystem/native support depends on the separately documented host and backend. |
| Formal claim boundary | Runtime behavior only; no production correctness theorem claimed. |

Reviewed evidence (content pinned; existence is not a passing test result):

- [test/task/schema-builders.test.ts](../../test/task/schema-builders.test.ts)
- [test/run/durable-execution-replay.test.ts](../../test/run/durable-execution-replay.test.ts)
- [docs/task-descriptors.md](../task-descriptors.md)
- [docs/python-to-typescript.md](../python-to-typescript.md)

Outstanding issues: [263](https://github.com/avnionur/shepherd-typescript/issues/263)

### Retained outputs, bindings and grants

Upstream 0.3.0 workspace, output, binding and permission vocabulary.

Public entry points: `./workspace#captureTaskWorldDurably`, `./workspace#createWorkspaceBindings`, `./workspace#prepareRetainedWorldSettlement`, `./workspace#inspectTaskWorldEffects`

| Dimension | Evidence boundary |
| --- | --- |
| API availability | Supported: retained capture, inspect, select/apply/discard/release and authenticated repository grants. |
| Composed behavior | Adapted: each retained task exposes one repository world. Supplied readText/writeText capabilities journal individual intents, admissions and outcomes even when the final changeset is empty. CLI task inspection retrieves validated exact-version repository declarations after registry reopen; per-run effective grants remain distinct. |
| Restart recovery | Capture and settlement have durable recovery; operation inspection survives reopen/import and distinguishes unentered work from uncertain admission without replaying an arbitrary runner. |
| Live-provider evidence | No live-provider result claimed; ordinary tests use deterministic providers. |
| Performance evidence | No performance result claimed by this row. |
| Supported platforms / evidence | Node runtime support applies; filesystem/native support depends on the separately documented host and backend. |
| Formal claim boundary | Runtime behavior only; no production correctness theorem claimed. |

Reviewed evidence (content pinned; existence is not a passing test result):

- [test/workspace/task-world-repository-grants.test.ts](../../test/workspace/task-world-repository-grants.test.ts)
- [docs/task-world-execution.md](../task-world-execution.md)
- [docs/retained-world-settlement.md](../retained-world-settlement.md)
- [examples/multiple-bindings.ts](../../examples/multiple-bindings.ts)
- [test/workspace/retained-world-select.test.ts](../../test/workspace/retained-world-select.test.ts)
- [test/workspace/retained-world-discard.test.ts](../../test/workspace/retained-world-discard.test.ts)
- [test/workspace/retained-world-apply.test.ts](../../test/workspace/retained-world-apply.test.ts)
- [test/workspace/retained-world-release.test.ts](../../test/workspace/retained-world-release.test.ts)
- [docs/world-effect-journal.md](../world-effect-journal.md)
- [test/workspace/world-effect-journal.test.ts](../../test/workspace/world-effect-journal.test.ts)
- [test/workspace/world-effect-crash.test.ts](../../test/workspace/world-effect-crash.test.ts)
- [test/task/registry-grants.test.ts](../../test/task/registry-grants.test.ts)
- [docs/task-registry.md](../task-registry.md)

Outstanding issues: [247](https://github.com/avnionur/shepherd-typescript/issues/247)

### CLI discovery, registration and scaffolding

Upstream 0.3.0 CLI reference: command presence is distinct from implemented execution.

Public entry points: `./cli#runCli`, `./tasks#SQLiteTaskRegistry`

| Dimension | Evidence boundary |
| --- | --- |
| API availability | Supported: configured CLI topology, stable JSON, retained inspection and replay/scope views; registered repository declarations appear in task inspection after restart. |
| Composed behavior | Partial: declarative CLI task registration and extension scaffolding are stubs; help/version/selectors/trace detail/readiness conveniences remain incomplete. |
| Restart recovery | Exact mutation commands delegate to fenced runtime operations; read selectors confer no mutation authority. |
| Live-provider evidence | No live-provider result claimed; ordinary tests use deterministic providers. |
| Performance evidence | No performance result claimed by this row. |
| Supported platforms / evidence | Node runtime support applies; filesystem/native support depends on the separately documented host and backend. |
| Formal claim boundary | Runtime behavior only; no production correctness theorem claimed. |

Reviewed evidence (content pinned; existence is not a passing test result):

- [test/cli/trace-cli.test.ts](../../test/cli/trace-cli.test.ts)
- [docs/cli.md](../cli.md)
- [test/task/registry-persistence.test.ts](../../test/task/registry-persistence.test.ts)
- [test/task/registry-grants.test.ts](../../test/task/registry-grants.test.ts)

Outstanding issues: [259](https://github.com/avnionur/shepherd-typescript/issues/259), [260](https://github.com/avnionur/shepherd-typescript/issues/260), [261](https://github.com/avnionur/shepherd-typescript/issues/261)

### HTTP providers and process-provider boundary

Upstream 0.3.0 provider concept: HTTP adapters are an adapted transport, not Claude CLI or Codex process adapters.

Public entry points: `./providers#createLiveProvider`, `./providers#createProviderConversation`

| Dimension | Evidence boundary |
| --- | --- |
| API availability | Supported: Anthropic Messages and OpenAI-compatible HTTP adapters with tool blocks and cache-token usage. |
| Composed behavior | Partial: no streaming, bounded retry policy, actual monetary accounting, or governed process-provider adapter. |
| Restart recovery | Conversation checkpoints are process-local; retained trace data does not reconstruct the checkpoint receipt map after restart. |
| Live-provider evidence | Opt-in live test exists but was not run in the recorded audit; no live cache-hit or tool-loop conformance result. |
| Performance evidence | No performance result claimed by this row. |
| Supported platforms / evidence | Node runtime support applies; filesystem/native support depends on the separately documented host and backend. |
| Formal claim boundary | Runtime behavior only; no production correctness theorem claimed. |

Reviewed evidence (content pinned; existence is not a passing test result):

- [test/provider/live-provider.test.ts](../../test/provider/live-provider.test.ts)
- [test/provider/provider-conversation.test.ts](../../test/provider/provider-conversation.test.ts)
- [test/provider/live-provider-opt-in.test.ts](../../test/provider/live-provider-opt-in.test.ts)
- [docs/live-providers.md](../live-providers.md)

Outstanding issues: [242](https://github.com/avnionur/shepherd-typescript/issues/242), [249](https://github.com/avnionur/shepherd-typescript/issues/249), [250](https://github.com/avnionur/shepherd-typescript/issues/250), [251](https://github.com/avnionur/shepherd-typescript/issues/251), [252](https://github.com/avnionur/shepherd-typescript/issues/252), [264](https://github.com/avnionur/shepherd-typescript/issues/264)

## Paper targets and measured limitations

### Tasks as substitutable values

Paper §3.1: task values, substitution, revision, synthesis and nested meta-agents.

Public entry points: `./delegation#taskValueOf`, `./delegation#openChildRun`, `./delegation#approveChildRunTask`, `./delegation#projectDelegationTree`

| Dimension | Evidence boundary |
| --- | --- |
| API availability | Supported: canonical task values, explicit child-run handles and task provenance. |
| Composed behavior | Adapted: revised and synthesized task values are data with approval gating; program-serviced children compose bounded nested agents. No ambient Python call semantics. |
| Restart recovery | Retained child identity, approval and completion records survive reopen/import; uncertain running children require the documented cancellation/retry path. |
| Live-provider evidence | No live synthesis or nested-agent experiment measured. |
| Performance evidence | No task-substitution performance result claimed. |
| Supported platforms / evidence | Node runtime support applies; nested worlds inherit their carrier and placement limits. |
| Formal claim boundary | Runtime authority/isolation tests; no production correctness theorem claimed. |

Reviewed evidence (content pinned; existence is not a passing test result):

- [test/delegation/task-revision.test.ts](../../test/delegation/task-revision.test.ts)
- [test/delegation/nested-isolation.test.ts](../../test/delegation/nested-isolation.test.ts)
- [test/delegation/nested-open-replay.test.ts](../../test/delegation/nested-open-replay.test.ts)
- [docs/task-values.md](../task-values.md)
- [docs/task-revision.md](../task-revision.md)

Outstanding issues: None for this stated boundary.

### Effects, observation and interception

Paper §3.2; separate from upstream release completeness.

Public entry points: `./effects#createEffectHandlerStack`, `./supervision#openTraceSubscription`, `./supervision#dispatchSupervisedEffect`, `./workspace#inspectTaskWorldEffects`

| Dimension | Evidence boundary |
| --- | --- |
| API availability | Supported: typed intent/outcome records, handler stacks, trace subscriptions and supervised dispatch. |
| Composed behavior | Adapted: in-process handler stacks alone are not durable dispatch. Supplied retained-world readText/writeText operations automatically retain individual effects, distinct from enclosing tool-loop effects. |
| Restart recovery | Subscriptions retain acknowledgements; supervised dispatch fences ownership. Retained capability journals preserve exact authority and reject uncertain publication; direct filesystem calls and native syscalls are outside this operation journal. |
| Live-provider evidence | No live-provider result claimed; ordinary tests use deterministic providers. |
| Performance evidence | No performance result claimed by this row. |
| Supported platforms / evidence | Node runtime support applies; filesystem/native support depends on the separately documented host and backend. |
| Formal claim boundary | Runtime behavior only; no production correctness theorem claimed. |

Reviewed evidence (content pinned; existence is not a passing test result):

- [test/supervision/trace-subscription.test.ts](../../test/supervision/trace-subscription.test.ts)
- [test/agent/tool-loop.test.ts](../../test/agent/tool-loop.test.ts)
- [docs/supervised-effects.md](../supervised-effects.md)
- [docs/world-effect-journal.md](../world-effect-journal.md)
- [test/workspace/world-effect-journal.test.ts](../../test/workspace/world-effect-journal.test.ts)
- [test/workspace/world-effect-crash.test.ts](../../test/workspace/world-effect-crash.test.ts)

Outstanding issues: None for this stated boundary.

### Compensation of abandoned materializations

Paper §3.2 reversibility boundary.

Public entry points: `./effects#createEffectCompensationRegistry`

| Dimension | Evidence boundary |
| --- | --- |
| API availability | Supported: per-kind handlers and retained compensation intent/attempt/outcome evidence. |
| Composed behavior | Branches retaining their source do not compensate; abandoning branches and scope discard compensate recorded successful compensable materializations. |
| Restart recovery | Partial: uncertain attempts can invoke the same handler key again; idempotency remains the handler obligation. No durable attempt ownership or audited reconciliation yet. |
| Live-provider evidence | No live-provider result claimed; ordinary tests use deterministic providers. |
| Performance evidence | No performance result claimed by this row. |
| Supported platforms / evidence | Node runtime support applies; filesystem/native support depends on the separately documented host and backend. |
| Formal claim boundary | Runtime behavior only; no production correctness theorem claimed. |

Reviewed evidence (content pinned; existence is not a passing test result):

- [test/effect/compensation.test.ts](../../test/effect/compensation.test.ts)
- [test/faults/compensation-kill.test.ts](../../test/faults/compensation-kill.test.ts)
- [test/replay/replay-source-disposition.test.ts](../../test/replay/replay-source-disposition.test.ts)
- [docs/compensation.md](../compensation.md)

Outstanding issues: [240](https://github.com/avnionur/shepherd-typescript/issues/240), [241](https://github.com/avnionur/shepherd-typescript/issues/241)

### Scope algebra and coupled checkpoints

Paper §3.3 and §3.4.

Public entry points: `./scopes#emitScopeRecord`, `./workspace#forkScope`, `./workspace#mergeScope`, `./workspace#discardScope`

| Dimension | Evidence boundary |
| --- | --- |
| API availability | Supported: emission, isolated nested/parallel scope fork, merge and discard with authority fencing. |
| Composed behavior | Adapted: coordinated multi-resource checkpoints exist; atomic/reconstructive/unavailable classification depends on every constituent. No generic OS process snapshot promise. |
| Restart recovery | Carrier custody and operation journals support documented recovery; device-layer worlds and provider conversation receipt maps are separately process-local. |
| Live-provider evidence | No live-provider result claimed; ordinary tests use deterministic providers. |
| Performance evidence | Existing scope benchmark measures full custody verification; it does not establish image-size-independent scope fork. |
| Supported platforms / evidence | Node runtime support applies; filesystem/native support depends on the separately documented host and backend. |
| Formal claim boundary | Runtime behavior only; no production correctness theorem claimed. |

Reviewed evidence (content pinned; existence is not a passing test result):

- [test/scope/scope-laws.test.ts](../../test/scope/scope-laws.test.ts)
- [test/replay/replay-checkpoint.test.ts](../../test/replay/replay-checkpoint.test.ts)
- [docs/coupled-checkpoints.md](../coupled-checkpoints.md)
- [docs/scope-merge-discard.md](../scope-merge-discard.md)

Outstanding issues: [242](https://github.com/avnionur/shepherd-typescript/issues/242), [243](https://github.com/avnionur/shepherd-typescript/issues/243), [244](https://github.com/avnionur/shepherd-typescript/issues/244)

### Trace history, rewind and suffix replay

Paper §3.4.

Public entry points: `./replay#rewindReplaySession`, `./replay#replayReplaySession`, `./replay#diffReplaySessions`, `./replay#findFirstReplayRegression`, `./replay#inspectReplayBranchRequest`

| Dimension | Evidence boundary |
| --- | --- |
| API availability | Supported: retained replay sessions, rewind, recorded-prefix suffix replay, divergence and lineage comparison. |
| Composed behavior | Adapted: restoration requires available checkpoint constituents; side effects are not automatically reversible. Branch request identity is now bound before receipt replay, compensation and restoration; legacy branches without request journals refuse retries. |
| Restart recovery | Replay records survive reopen/import; uncertain started effects remain fenced. Provider receipt durability is separate. |
| Live-provider evidence | No live-provider result claimed; ordinary tests use deterministic providers. |
| Performance evidence | Replay-step reuse is observable; it is not measured live KV-cache reuse. |
| Supported platforms / evidence | Node runtime support applies; filesystem/native support depends on the separately documented host and backend. |
| Formal claim boundary | Runtime behavior only; no production correctness theorem claimed. |

Reviewed evidence (content pinned; existence is not a passing test result):

- [test/replay/replay-branch.test.ts](../../test/replay/replay-branch.test.ts)
- [test/replay/replay-lineage.test.ts](../../test/replay/replay-lineage.test.ts)
- [test/replay/replay-crash.test.ts](../../test/replay/replay-crash.test.ts)
- [docs/rewind-and-replay.md](../rewind-and-replay.md)
- [test/replay/replay-request-identity.test.ts](../../test/replay/replay-request-identity.test.ts)
- [docs/replay-request-identity.md](../replay-request-identity.md)

Outstanding issues: [242](https://github.com/avnionur/shepherd-typescript/issues/242), [262](https://github.com/avnionur/shepherd-typescript/issues/262)

### Concurrent runtime supervisor

Paper §5.1 and Appendix E.

Public entry points: `./applications#runRuntimeSupervisor`, `./applications#createModelRuntimeSupervisorPolicy`

| Dimension | Evidence boundary |
| --- | --- |
| API availability | Supported: concurrent workers, tick observations, batched inject/handoff/discard decisions and a model-backed policy interface. |
| Composed behavior | Partial: worker grants, placement and shared budgets are not fully composed into the concurrent supervisor; leader handoff is a native extension. |
| Restart recovery | Retained intervention recovery is tested; a crash during a tool turn can still repeat effects. |
| Live-provider evidence | No live-provider result claimed; ordinary tests use deterministic providers. |
| Performance evidence | No real-task concurrent-supervisor or CooperBench result measured. |
| Supported platforms / evidence | Node runtime support applies; filesystem/native support depends on the separately documented host and backend. |
| Formal claim boundary | Runtime behavior only; no production correctness theorem claimed. |

Reviewed evidence (content pinned; existence is not a passing test result):

- [test/applications/runtime-supervisor.test.ts](../../test/applications/runtime-supervisor.test.ts)
- [test/applications/runtime-supervisor-crash.test.ts](../../test/applications/runtime-supervisor-crash.test.ts)
- [docs/runtime-supervisor.md](../runtime-supervisor.md)

Outstanding issues: [245](https://github.com/avnionur/shepherd-typescript/issues/245), [246](https://github.com/avnionur/shepherd-typescript/issues/246), [253](https://github.com/avnionur/shepherd-typescript/issues/253), [258](https://github.com/avnionur/shepherd-typescript/issues/258)

### Counterfactual optimization

Paper §5.2 and Appendix F.1–F.5.

Public entry points: `./applications#runCounterfactualOptimization`, `./applications#createToolLoopCounterfactualProposer`

| Dimension | Evidence boundary |
| --- | --- |
| API availability | Supported: train/dev baselines, candidate proposals, fix/guard gate, promotion and suffix replay. |
| Composed behavior | Partial: candidates use caller-applied edits; bound worlds are excluded. Proposer conformance uses scripted models. |
| Restart recovery | Application append recovery is tested; stateful world isolation is not established by those tests. |
| Live-provider evidence | No live-provider result claimed; ordinary tests use deterministic providers. |
| Performance evidence | Synthetic offline measurements only; replay-step reuse does not imply live cache or monetary savings. |
| Supported platforms / evidence | Node runtime support applies; filesystem/native support depends on the separately documented host and backend. |
| Formal claim boundary | Runtime behavior only; no production correctness theorem claimed. |

Reviewed evidence (content pinned; existence is not a passing test result):

- [test/applications/counterfactual-optimizer.test.ts](../../test/applications/counterfactual-optimizer.test.ts)
- [test/applications/replay-applications-crash.test.ts](../../test/applications/replay-applications-crash.test.ts)
- [docs/counterfactual-optimization.md](../counterfactual-optimization.md)

Outstanding issues: [256](https://github.com/avnionur/shepherd-typescript/issues/256), [258](https://github.com/avnionur/shepherd-typescript/issues/258), [249](https://github.com/avnionur/shepherd-typescript/issues/249)

### Tree-RL rollout and training boundary

Paper §5.3 and Appendix F.6–F.7.

Public entry points: `./applications#runTreeRlRollouts`, `./applications#computeTreeRlAdvantages`, `./applications#exportTreeRlBatchToTrainer`

| Dimension | Evidence boundary |
| --- | --- |
| API availability | Supported: fork selector, branched rollouts, advantages and per-action trainer export. |
| Composed behavior | Partial: branch provider interface requires static providers; seed delivery depends on the factory. No policy update or trainer ships. |
| Restart recovery | Retained rollout recovery is tested; process-local provider state is not restart-durable. |
| Live-provider evidence | No live-provider result claimed; ordinary tests use deterministic providers. |
| Performance evidence | No matched-compute learning or policy-improvement result measured. |
| Supported platforms / evidence | Node runtime support applies; filesystem/native support depends on the separately documented host and backend. |
| Formal claim boundary | Runtime behavior only; no production correctness theorem claimed. |

Reviewed evidence (content pinned; existence is not a passing test result):

- [test/applications/tree-rl.test.ts](../../test/applications/tree-rl.test.ts)
- [test/applications/tree-rl-meta-agent.test.ts](../../test/applications/tree-rl-meta-agent.test.ts)
- [test/applications/tree-rl-worlds.test.ts](../../test/applications/tree-rl-worlds.test.ts)
- [docs/tree-rl-rollouts.md](../tree-rl-rollouts.md)

Outstanding issues: [254](https://github.com/avnionur/shepherd-typescript/issues/254), [255](https://github.com/avnionur/shepherd-typescript/issues/255)

### Trajectory compression and rescue accounting

Paper Appendix D.

Public entry points: `./applications#runTrajectoryCompression`

| Dimension | Evidence boundary |
| --- | --- |
| API availability | Supported: fork/hint proposals, verifier children, shorter suffixes, restoration and best-of-N controls. |
| Composed behavior | Adapted: world-bound pruning requires a checkpoint. Child evidence uses a text envelope by protocol choice, not because task schemas only support strings. |
| Restart recovery | Retained child/session recovery and crash refusal paths are tested. |
| Live-provider evidence | No live-provider result claimed; ordinary tests use deterministic providers. |
| Performance evidence | Offline step-count measurements; no independent task-level source judge, so current compression rescue accounting cannot measure failed-source rescue. |
| Supported platforms / evidence | Node runtime support applies; filesystem/native support depends on the separately documented host and backend. |
| Formal claim boundary | Runtime behavior only; no production correctness theorem claimed. |

Reviewed evidence (content pinned; existence is not a passing test result):

- [test/applications/trajectory-compression.test.ts](../../test/applications/trajectory-compression.test.ts)
- [test/applications/trajectory-compression-crash.test.ts](../../test/applications/trajectory-compression-crash.test.ts)
- [docs/trajectory-compression.md](../trajectory-compression.md)

Outstanding issues: [257](https://github.com/avnionur/shepherd-typescript/issues/257)

### Performance and sandbox realization

Paper §4 and Appendix C.1–C.7.

Public entry points: `./workspace#openDeviceLayerWorld`, `./workspace#checkDeviceLayerConformance`

| Dimension | Evidence boundary |
| --- | --- |
| API availability | Supported: copy/clone/overlay carriers and separate layered device adapters, including a reference Docker adapter. |
| Composed behavior | Partial: optimized device layers are not integrated into normal custody, scope fork or replay images. No remote sandbox adapter ships. |
| Restart recovery | Device-layer world identity and checkpoints are process-local; durable recovery is outstanding. |
| Live-provider evidence | No live provider cache-reuse measurement. |
| Performance evidence | Recorded kernel/scope/device benchmarks are local measurements; device-layer timing does not prove end-to-end constant-time fork/replay. |
| Supported platforms / evidence | Measured macOS arm64 APFS and Linux arm64 container-in-VM lanes only. No bare-metal Linux, x86-64 or remote-host result. |
| Formal claim boundary | Runtime behavior only; no production correctness theorem claimed. |

Reviewed evidence (content pinned; existence is not a passing test result):

- [test/workspace/device-layer.test.ts](../../test/workspace/device-layer.test.ts)
- [test/benchmark/scope-benchmark.test.ts](../../test/benchmark/scope-benchmark.test.ts)
- [docs/performance-report.md](../performance-report.md)
- [docs/device-layers.md](../device-layers.md)

Outstanding issues: [243](https://github.com/avnionur/shepherd-typescript/issues/243), [244](https://github.com/avnionur/shepherd-typescript/issues/244), [248](https://github.com/avnionur/shepherd-typescript/issues/248), [266](https://github.com/avnionur/shepherd-typescript/issues/266)

### Overall coverage and research directions

Paper §1–2, §6 and Appendix A.1–A.2.

Public entry points: No runtime API claimed.

| Dimension | Evidence boundary |
| --- | --- |
| API availability | No aggregate paper-coverage percentage or complete reproduction claim. |
| Composed behavior | Programming-model availability does not establish experimental parity; safety and coupling limits stay explicit. |
| Restart recovery | Recovery boundaries are stated per constituent above. |
| Live-provider evidence | No live-provider result claimed; ordinary tests use deterministic providers. |
| Performance evidence | No performance result claimed by this row. |
| Supported platforms / evidence | Node runtime support applies; filesystem/native support depends on the separately documented host and backend. |
| Formal claim boundary | Research proposals and future work are not implemented capabilities. |

Reviewed evidence (content pinned; existence is not a passing test result):

- [.plan/research/README.md](../../.plan/research/README.md)
- [.plan/phase-10-exit-audit.md](../../.plan/phase-10-exit-audit.md)
- [docs/application-evaluation.md](../application-evaluation.md)

Outstanding issues: [235](https://github.com/avnionur/shepherd-typescript/issues/235), [258](https://github.com/avnionur/shepherd-typescript/issues/258), [255](https://github.com/avnionur/shepherd-typescript/issues/255)

## Imported formal evidence

### Imported proof evidence and runtime envelopes

Paper Appendix B; imported pinned evidence is separate from native runtime behavior.

Public entry points: `.#classifyProofEnvelope`, `./runs#inspectDurableTaskExecution`, `./replay#inspectReplaySession`

| Dimension | Evidence boundary |
| --- | --- |
| API availability | Supported: executable reference classification and proof envelopes on inspections. |
| Composed behavior | Eligible effect-only finished root replays can lower to Core-A; ordinary production executions remain runtime-only. Imported claims are metadata, not verified proofs. |
| Restart recovery | Trace inspection preserves claim boundaries across reopen/import; no process-state proof follows. |
| Live-provider evidence | No live-provider result claimed; ordinary tests use deterministic providers. |
| Performance evidence | No performance result claimed by this row. |
| Supported platforms / evidence | Node runtime support applies; filesystem/native support depends on the separately documented host and backend. |
| Formal claim boundary | Core-0/Core-A stronger reference claims depend on exact pinned artifacts. Core-0H is fail-closed without a trusted sidecar. External proof build remains unexecuted here. |

Reviewed evidence (content pinned; existence is not a passing test result):

- [test/formal/inspection-proof-envelope.test.ts](../../test/formal/inspection-proof-envelope.test.ts)
- [test/formal/strong-proof-envelope.test.ts](../../test/formal/strong-proof-envelope.test.ts)
- [docs/formal-assurance.md](../formal-assurance.md)

Outstanding issues: [265](https://github.com/avnionur/shepherd-typescript/issues/265)

## Native TypeScript extensions

### TypeScript authority, settlement and operational extensions

Native TypeScript contracts; not inferred upstream parity or paper proof.

Public entry points: `./workspace#prepareRetainedWorldSettlement`, `./operations#backupTraceStore`

| Dimension | Evidence boundary |
| --- | --- |
| API availability | Supported: explicit exact-ID settlement, canonical JSON CLI and operational backup contracts. |
| Composed behavior | Native grant and jail facilities exist; an end-to-end jailed retained-agent workflow remains separate work. |
| Restart recovery | Backup/migration and settlement journals have explicit repair rules; arbitrary external effects stay uncertain. |
| Live-provider evidence | No live-provider result claimed; ordinary tests use deterministic providers. |
| Performance evidence | No performance result claimed by this row. |
| Supported platforms / evidence | Node runtime support applies; filesystem/native support depends on the separately documented host and backend. |
| Formal claim boundary | Runtime behavior only; no production correctness theorem claimed. |

Reviewed evidence (content pinned; existence is not a passing test result):

- [docs/backup-restore-and-migration.md](../backup-restore-and-migration.md)
- [docs/native-jail-execution.md](../native-jail-execution.md)
- [docs/retained-world-settlement.md](../retained-world-settlement.md)
- [test/operations/backup-restore.test.ts](../../test/operations/backup-restore.test.ts)
- [test/operations/migration-drills.test.ts](../../test/operations/migration-drills.test.ts)
- [test/workspace/retained-world-select.test.ts](../../test/workspace/retained-world-select.test.ts)
- [test/workspace/retained-world-discard.test.ts](../../test/workspace/retained-world-discard.test.ts)
- [test/workspace/retained-world-apply.test.ts](../../test/workspace/retained-world-apply.test.ts)
- [test/workspace/retained-world-release.test.ts](../../test/workspace/retained-world-release.test.ts)

Outstanding issues: [253](https://github.com/avnionur/shepherd-typescript/issues/253)
