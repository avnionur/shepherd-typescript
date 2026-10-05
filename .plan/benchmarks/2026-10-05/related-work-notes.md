# Primary-source research notes for the Shepherd TypeScript study

Research date: 2026-10-05 (Europe/Istanbul). These notes establish interpretation and experiment design; they contain no newly measured performance or task-quality results. The original task was expanded to performance, reliability, comparison with another harness, provider-backed task quality, and context engineering.

## Positioning and boundaries

Shepherd proposes tasks, effects, scopes, and traces as a programming model for operating on agent executions. Its paper evaluates substrate operations, prompt-cache reuse, and meta-agent applications. Appendix C times sandbox operations through readiness, while Appendix B confines formal assurance to restricted fragments. Consequently, a TypeScript study should distinguish physical snapshots, durable scope operations, replay checkpoints, and model behavior. Local operation timings cannot establish reproduction of its reported application results. [Yu et al., paper v3](https://arxiv.org/html/2605.10913v3)

The TypeScript repository describes an independent, language-neutral implementation and pins Python release behavior separately from the paper and development architecture. Its target architecture separates the trace kernel, world substrate, runtime, and public dialect. The architecture document includes historical planned sections, so implemented behavior must be checked against the current normative documents and public seams. [Repository README](../../../README.md), [target architecture](../../architecture.md), [upstream baseline](../../upstream-baseline.md)

The 2026-09-27 audit identifies incomplete integration, restart recovery, real-provider execution, and experimental validity. It is historical investigation rather than a new guarantee. Read it alongside current source and tests before asserting a gap still exists. Historical working-tree audit (uncommitted in the measured checkout; excluded from this publication)

## Related work suitable for the paper

| Primary source | Relevant design axis | Permitted use in this study |
| --- | --- | --- |
| [Shepherd v3](https://arxiv.org/html/2605.10913v3) | Coupled execution state and meta-agent operations | Motivation and methodological comparison; independent results unless an equivalent pinned upstream experiment is actually run |
| [AgentGit](https://arxiv.org/abs/2511.00628v1) | Git-like commit, revert, and branching for workflows built on LangGraph; its evaluation studies prompt selection | A nearby execution-history design. Its abstract does not establish the same filesystem/process, durability, or authority guarantees as this repository |
| [OpenHands Software Agent SDK](https://arxiv.org/abs/2511.03690v2) | Extensible agents, tools and memory management, local/remote execution, services and lifecycle control | A possible task-level comparator after pinning version, tools, model and workload; do not infer a reversible-state capability matrix from the abstract |
| [Fork, Explore, Commit / BranchFS](https://arxiv.org/abs/2602.08199v2) | Branch contexts; FUSE filesystem branching and a separately proposed process-coordination syscall | Compare the level at which state is controlled. Do not conflate the proposed syscall with installed functionality or borrow its operation microseconds as a harness-level latency baseline |
| [StateFork](https://arxiv.org/abs/2609.38648v1) | Logical exploration control separated from physical materialization; Waypoint combines filesystem, process and persistent terminal state | Recent work relevant to restoration correctness. Observation equivalence motivates tests of future behavior after restore, beyond checking present file bytes. No implementation comparison was run here |

Bibliographic caution: arXiv 2511.03690 currently resolves to **The OpenHands Software Agent SDK: A Composable and Extensible Foundation for Production Agents**, by Xingyao Wang and colleagues, v2 dated 2026-04-22. Use that verified title rather than copying the different title in Shepherd's reference list. [arXiv record](https://arxiv.org/abs/2511.03690v2)

## Upstream benchmark feasibility

The pinned upstream library revision is `d45074e0099d9ccafeed4a233702ad68ff8a2fa6`; release v0.3.0 is `a8196d4c453514836d06bd2fece91a03cdc37107`. Its root manifest requires Python 3.11 or newer and a multi-package workspace. Its `experiments/README.md` points to a separate experiment repository. [Pinned manifest](https://github.com/shepherd-agents/shepherd/blob/d45074e0099d9ccafeed4a233702ad68ff8a2fa6/pyproject.toml), [pinned experiments pointer](https://github.com/shepherd-agents/shepherd/blob/d45074e0099d9ccafeed4a233702ad68ff8a2fa6/experiments/README.md)

GitHub API inspection resolved the experiments repository's `main` on this research date to `c12ebd1b774cf12f70ef2b4486e61e7052f3e3ab`. This records the inspected experiment revision; it does not update the repository's upstream compatibility lock. The framework-performance README labels the harness WIP and contains stale command paths. Its manifest includes Anthropic, E2B, Modal, NumPy, and plotting libraries. The image experiments need a Linux Docker/overlay environment, while other lanes require cloud authentication and model credentials. Installing or running that repository was not performed by this research task. [Inspected framework-performance README](https://github.com/shepherd-agents/shepherd-experiments/blob/c12ebd1b774cf12f70ef2b4486e61e7052f3e3ab/exp/framework-perf/README.md), [manifest](https://github.com/shepherd-agents/shepherd-experiments/blob/c12ebd1b774cf12f70ef2b4486e61e7052f3e3ab/exp/framework-perf/pyproject.toml)

Two tempting shortcuts are scientifically unsuitable:

- The experiment's `bench_observe.py` simulates effect logging using shell commands and JSONL, then compares manually constructed worker message lists. Its context measurement counts characters as a proxy, and its entry point requires E2B credentials. This does not measure the same public durable effect/subscription seam as the TypeScript scope benchmark. [Pinned script](https://github.com/shepherd-agents/shepherd-experiments/blob/c12ebd1b774cf12f70ef2b4486e61e7052f3e3ab/exp/framework-perf/src/experiment_framework_perf/bench_observe.py)
- The library's `kernel_runtime_bench.py` measures a reference evaluator's prepared computations, traces, continuations, validation and replay journals. That differs from the TypeScript benchmark's durable SQLite append, cut resolution, archive and CLI operations. Reporting a ratio between the two suites would compare different work. [Pinned reference benchmark](https://github.com/shepherd-agents/shepherd/blob/d45074e0099d9ccafeed4a233702ad68ff8a2fa6/shepherd/packages/kernel-v3-reference/benchmarks/kernel_runtime_bench.py), [local performance contract](../../../docs/performance-report.md)

A valid comparison needs a common workload adapter and equivalent start/end conditions, restored constituents, durability, correctness checks, and resource accounting. If those prerequisites cannot be met during this session, report the comparison as pending with its exact blockers; a conceptual comparison remains valid as related work.

## Research questions for the available local suites

These questions are proposed analysis targets rather than conclusions.

1. **RQ1: durable kernel cost.** What are append, prefix-resolution, export/import, integrity and startup costs for the fixed synthetic trace? Treat per-record latency and burst throughput separately. Retain configuration digest, SQLite/runtime versions, warmups, every raw sample, and independent run identity. [Kernel procedure](../../../docs/performance-report.md#kernel-benchmark)
2. **RQ2: end-to-end scope scaling.** How do public `forkScope` and `discardScope` costs vary by world and available backend, and does every checked revert preserve the source/checkpoint? Scope custody publication and verification belong in the measured operation. Byte count and file count co-vary in the configured worlds, limiting attribution. [Scope procedure](../../../docs/performance-report.md#scope-forkrevert-and-observation-benchmark)
3. **RQ3: branching resources.** How do observed disk deltas change with K branches and mutation size? Distinguish sibling-only storage, the checkpoint/base, trace metadata and total footprint. Free-space deltas are vulnerable to concurrent volume writes; RSS deltas from one process are not per-agent memory. [Storage accounting](../../../docs/performance-report.md#branch-storage-at-k--4-default-10-kib-writes-medians-of-3)
4. **RQ4: checkpoint representation cost.** How much additional database/blob storage comes from automatic checkpointing? Changed file bytes deduplicate, but each changed manifest includes the complete entry set; more files can therefore increase storage per checkpoint without duplicating all file contents. [Checkpoint procedure](../../../docs/coupled-checkpoints.md#storage-growth-per-checkpoint)
5. **RQ5: physical layer cost.** How do device checkpoint/restore latency, stack depth and compaction differ among available adapters? Report ordinary and compacting checkpoints separately. These process-scoped devices are not replay checkpoints, scope custody, full process images, or durable restart evidence. [Device contract](../../../docs/device-layers.md)
6. **RQ6: reliability at production boundaries.** Which asserted restoration, isolation, idempotency, admission and recovery laws have executed evidence? Performance-suite digest checks support specific filesystem reverts. Passing selected crash tests supports their fault locations and adapters, not a general failure rate, external-effect exactly-once claim or security proof. [Checkpoint constituents](../../../docs/coupled-checkpoints.md), historical working-tree audit (not included in this publication)
7. **RQ7: observation behavior.** How do recording and subscription-pull costs vary by step count and observer count? Unchanged record counts do not by themselves prove byte-identical complete model contexts. Compare retained requests/messages when making context noninterference claims. [Observation procedure](../../../docs/performance-report.md#record-and-observe-overhead-per-event-ms), [tool loop](../../../docs/tool-use-loop.md)

SQLite WAL and synchronization mode are experiment conditions, not incidental implementation details. SQLite documents an additional WAL synchronization at transaction commit for `synchronous=FULL`; changing the mode changes durability expectations and measured work. [SQLite WAL](https://sqlite.org/wal.html), [synchronous pragma](https://sqlite.org/pragma.html#pragma_synchronous)

Docker's overlay documentation describes read-only lower layers, a writable upper layer, and whole-file copy-up on a first write. This makes first-write versus subsequent-write patterns and layer depth relevant controls. The documented legacy `overlay2` driver differs from the default containerd snapshotter in newer Docker installations; record the actual configuration. [Docker storage documentation](https://docs.docker.com/engine/storage/drivers/overlayfs-driver/)

## Provider-backed quality and context engineering at the measured revision

The measured revision's public seams support an experimental harness without changing the runtime:

- `createLiveProvider` accepts configured provider kind, model and endpoint; `converse` accepts ordered messages, system prompt, schemas, tools and reusable-prefix length. Normalized usage includes uncached input, cached input and output tokens, but live monetary cost is unavailable. [Live providers](../../../docs/live-providers.md)
- `runToolLoop` accepts initial messages, system prompt and tools, a turn budget, between-turn guidance, and `onTurn`. It returns the conversation and per-turn requests/responses. Replay-bound execution records provider and effect steps. Tool-result truncation is configured and should be held constant across treatments. [Tool loop](../../../docs/tool-use-loop.md)
- `createProviderConversation` retains/rebuilds ordered context and restores a byte-identical prefix in supported circumstances. Process-memory checkpoint receipts do not survive restart; reconstructive replay from retained steps is a distinct condition. [Provider conversations](../../../docs/live-providers.md#provider-conversations-and-rewind)
- `runTrajectoryCompression` replays a shorter guided suffix and requires verifier admission. Its reported step ratio is execution-trajectory compression. It is not a measurement of input-token compression, summarization quality, retrieval recall or working-memory effectiveness. [Trajectory compression](../../../docs/trajectory-compression.md)

Suggested context treatments are full task history, a fixed bounded relevant-evidence package, and a declared summary/retrieval policy where implemented by the study harness. Keep task, model, tools, task budget and judge fixed; vary only the policy under test. Retain the exact supplied context, evidence-selection identities, per-turn byte count and provider token usage. Characters, serialized bytes and provider tokens are different metrics. Account for summarizer/retriever calls in total compute; do not silently count only the worker. Use an independent executable task judge where possible, and separate completed conversations from correct solutions. These are study-design recommendations, not claims that such policies have already been implemented or benchmarked.

Context quality requires failures designed to discriminate treatments: distracting material, required evidence omitted by a summary, long tool outputs, conflicting records, and evidence introduced at a later turn. Pair treatments by task and repeat using independent trials. If a local provider is unavailable or credentials/model choice are missing, synthetic cassettes establish harness determinism only; provider-backed task success and token/cache claims remain unmeasured. [Limits of existing application evaluation](../../../docs/application-evaluation.md#limitations)

## Validity checklist for the report author

- Separate fresh raw observations, historical checked-in measurements, scripted conformance evidence, and cited results from other authors.
- Repeated samples in a session share filesystem/JIT/cache state. They are not independent machines or independent tasks. Report within-run and between-run variability separately.
- Nearest-rank p95 from 7, 10 or 12 samples equals the maximum; describe it as an empirical sample statistic, not a stable production tail estimate. Do not bootstrap every nested per-event sample as if independently assigned.
- One Apple Silicon host and its VM/container lanes do not establish x86, bare-metal Linux, Windows, remote sandbox, concurrent-tenant or model-provider generality.
- Passing an existing SLO shows compatibility with a configured regression budget. It does not identify the best framework or establish statistical superiority.
- A small synthetic task battery is useful for wiring and discriminating known behaviors. Label it a pilot; do not equate it with external coding-benchmark performance.

## Source provenance and limits

The research read the repository README, architecture, historical audit, upstream baseline, and current normative performance/device/checkpoint/provider/tool/compression/evaluation documents. Primary web records and official SQLite/Docker documentation were checked. GitHub API reads inspected the pinned library manifest, experiments pointer, reference benchmark, and selected files from the resolved experiments revision. Some raw/web GitHub fetches failed; API reads succeeded. No upstream checkout, upstream benchmark execution, dependency installation, live provider request, or new measurement was performed by this note's author.

## Publication boundary

This study measured 12.0.3 before publication main 13.7.0. Newer releases add durable compensation ownership and provider conversation checkpoint retention; the historical limits above do not describe the current implementation. Earlier uncommitted audit files are deliberately excluded from this PR.
