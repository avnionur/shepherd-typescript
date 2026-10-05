# Shepherd TypeScript

A native TypeScript implementation of [Shepherd](https://arxiv.org/abs/2605.10913): reversible,
inspectable agent execution traces for building meta-agents that observe, intercept, fork, rewind,
and replay other agents.

The implementation is built over a language-neutral protocol. Upstream Python behavior is a pinned
compatibility oracle, not a runtime dependency. This project is not affiliated with the upstream
Shepherd authors.

## Benchmark

The study measures runtime **12.0.3**. The report describes its methodology, results, and limitations.

- [Scientific benchmark report (PDF)](https://github.com/avnionur/shepherd-typescript/blob/main/benchmark/shepherd-empirical-study.pdf)
- [Scope fork and revert latency (PDF)](https://github.com/avnionur/shepherd-typescript/blob/main/benchmark/scope-latency.pdf)
- [Context engineering and task quality (PDF)](https://github.com/avnionur/shepherd-typescript/blob/main/benchmark/context-quality.pdf)

[Paper](https://arxiv.org/abs/2605.10913) ·
[Upstream project](https://shepherd-agents.ai/) ·
[Upstream code](https://github.com/shepherd-agents/shepherd) ·
[Paper coverage](https://github.com/avnionur/shepherd-typescript/blob/main/.plan/paper-coverage.md) ·
[Documentation](https://github.com/avnionur/shepherd-typescript/blob/main/docs/README.md) ·
[Changelog](https://github.com/avnionur/shepherd-typescript/blob/main/CHANGELOG.md)

[![Original Shepherd paper teaser: a meta-agent creates, observes, intercepts, reverts, and forks a worker trace](https://shepherd-agents.ai/assets/teaser.png)](https://shepherd-agents.ai/assets/teaser.mp4)

_The teaser image and video belong to the upstream paper project. They illustrate the target and are
not benchmark claims for this implementation._

## Contents

- [Benchmark](#benchmark)
- [Concepts](#concepts)
- [Status](#status)
- [Paper coverage](#paper-coverage)
- [Requirements](#requirements)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Package entries](#package-entries)
- [Documentation](#documentation)
- [Development](#development)
- [Releases](#releases)
- [Contributing and security](#contributing-and-security)
- [Attribution and license](#attribution-and-license)

## Concepts

Shepherd treats agent execution as a first-class value. Four primitives define the model:

| Primitive | Meaning | Main entry |
| --- | --- | --- |
| **Task** | A typed, content-addressed agent definition that can be passed, returned, revised, or synthesized | `./tasks`, `./delegation` |
| **Effect** | A typed intent/outcome pair for dispatched effects, observable and interceptable before its outcome exists; compensation records use stable materialization keys and reverse order; uncertain retries require idempotent handlers | `./effects`, `./supervision` |
| **Scope** | An isolated agent-and-environment region supporting `emit`, `fork`, `merge`, and `discard` | `./scopes`, `./workspace` |
| **Trace** | An immutable, content-addressed record graph with historical cuts, rewind, and suffix replay | `./trace`, `./replay` |

On top of these, `./applications` implements the paper's meta-agents: a concurrent runtime
supervisor (with a round-based handle-level coding supervisor), counterfactual replay optimization, trajectory compression, and meta-agent-guided Tree-RL. A bounded
[tool-use loop](https://github.com/avnionur/shepherd-typescript/blob/main/docs/tool-use-loop.md) turns every model tool call into an effect intent through a
handler stack, supervised dispatch, or replay session, and a configured catalog exposes observe,
fork, discard, rewind, replay, read-trace, and diff to an LLM meta-agent.

The default path runs offline and deterministically: providers are exact-cassette (`static`) or
program serviced. Configured live adapters for the Anthropic Messages API and OpenAI-compatible
chat completions (OpenAI, OpenRouter) are opt-in and restore a byte-identical message prefix after
rewind so the provider's prompt cache can serve replay ([live providers](https://github.com/avnionur/shepherd-typescript/blob/main/docs/live-providers.md));
Opt-in [retained conversation checkpoints](https://github.com/avnionur/shepherd-typescript/blob/main/docs/provider-conversation-checkpoints.md)
preserve exact prefixes across restart and native import. The adapters are tested against stub transports. The [2026-10-05 local study](https://github.com/avnionur/shepherd-typescript/blob/main/.plan/benchmarks/2026-10-05/paper.tex)
also exercises single invocations through the OpenAI-compatible adapter against Ollama at its measured
12.0.3 revision; commercial services, live tool-loop policies, and cache reuse after rewind remain
unmeasured. All results are this repository's measurements, never upstream numbers.

## Status

| Level | Meaning | Status |
| --- | --- | --- |
| L0 | Canonical schemas, identities, trace storage, and projections | Complete |
| L1 | Shepherd `0.3.0` settlement compatibility | Complete (1.51.0) |
| L2 | Scope and versioned-world substrate parity | Complete on recorded hosts (2.7.1) |
| L3 | Paper programming-model parity and research applications | Complete for the documented offline scope (2.20.1, applications 2.25.1) |
| L4 | Security, recovery, performance, packaging, and releases | "1.0" in 2.34.0 as a private, unpublished source release with owner waivers ([release notes](https://github.com/avnionur/shepherd-typescript/blob/main/docs/release-notes-1.0.md)) |

"1.0" is a maturity milestone, not a package version. It excludes an external security review,
signing, npm publication, hosted CI (local macOS gates and a local Docker Linux lane substitute),
and Windows. Phase-by-phase evidence is in the [tracker](https://github.com/avnionur/shepherd-typescript/blob/main/.plan/tracker.md) and the phase exit
audits under [`.plan`](https://github.com/avnionur/shepherd-typescript/blob/main/.plan/README.md).

## Paper coverage

The current [capability evidence inventory](https://github.com/avnionur/shepherd-typescript/blob/main/docs/generated/capability-inventory.md)
separates shipped APIs from composition, restart recovery, live experiments, platform measurements
and formal claims. Follow-up gaps are tracked in [epic #235](https://github.com/avnionur/shepherd-typescript/issues/235);
earlier completed milestones retain their documented scope.

The 2026-09-25 audit of [paper v3](https://arxiv.org/abs/2605.10913) is tracked in
[#202](https://github.com/avnionur/shepherd-typescript/issues/202); details are in the
[coverage map](https://github.com/avnionur/shepherd-typescript/blob/main/.plan/paper-coverage.md#known-deviations-2026-09-25-audit-2340).

| Paper section | Implemented | Known gaps |
| --- | --- | --- |
| §3.1 Tasks | Typed task values, substitution, revision, synthesis, nested meta-agents; string, number, integer, boolean, null, array, enum/literal, union, and optional-field schemas with path-level refusal of invalid values (3.0.0, [#205](https://github.com/avnionur/shepherd-typescript/issues/205)) | No constraint keywords (`minimum`, `minLength`), arbitrary-key records, or recursive schemas |
| §3.2 Effects | Intent/outcome records, handlers, live observation, allow/deny/replace/pause interception, irreversible approval frontier; a tool-use loop in which every model tool call is a schema-validated `ToolCallIntent`-style effect with deny-before-outcome and byte-identical replay, plus substrate-native meta-agent tools, end-to-end tested on the Figure 1 fork/observe/revert/retry scenario with a scripted model (6.0.0, [#206](https://github.com/avnionur/shepherd-typescript/issues/206)); per-kind compensation handlers keyed by materialization and invoked in reverse materialization order, when a scope discard or a replay rewind/replay abandons a successful compensable effect, with retained intent/attempt/outcome records and a SIGKILL fault suite (7.0.0, [#209](https://github.com/avnionur/shepherd-typescript/issues/209)); exploratory replay branches (Tree-RL, CRO, compression, the meta-agent `replay` tool) declare the `retain` source disposition and compensate nothing, while abandoning rewinds keep the configured `compensate` default (12.0.0) | Compensation serializes active attempts with durable leases and fencing (13.3.0), while external effects still require idempotent handlers; audited operator reconciliation is available (13.5.0); no live model has run the loop here (no credentials) |
| §3.3 Scopes | `emit`, `fork`, `merge`, `discard`, nesting, parallel scheduling, copy/clone/overlay carriers with opt-in recorded fallback selection; a pluggable device layer whose checkpoints freeze the writable layer as a named lower layer under a configured depth bound with compaction, with copy, clone, stacked-overlay, and reference Docker adapters and a conformance kit; overlay checkpoints measured constant in world size (2.1–3.1 ms over 1–128 MiB on the Linux lane) (11.3.0, [#215](https://github.com/avnionur/shepherd-typescript/issues/215)) | Carrier custody, `forkScope`, and replay world images do not use device layers (still verified full copies); no E2B/Modal/Daytona or other remote sandbox adapter; device-layer worlds are process-scoped |
| §3.4 Trace | Content-addressed graph, cuts, rewind, suffix replay, branch divergence; configured automatic checkpoint policies (per provider step, per effect, every N steps) make every checkpointed step of a world-bound session a byte-equivalent rewind and replay target, with measured storage growth per checkpoint (8.0.0, [#210](https://github.com/avnionur/shepherd-typescript/issues/210)); N-way diff of any sessions against their common lineage ancestor by captured effects, deterministic bisect/linear first-regression search over a session lineage, and read-only `shepherd-ts replay log/show/diff` and `scope list/show` (9.1.0, [#217](https://github.com/avnionur/shepherd-typescript/issues/217)); rewind and replay branches take a configured `sourceDisposition` (`compensate` or `retain`, replay protocol v3, 12.0.0) | Uncheckpointed step boundaries of world-bound sessions stay refused; each checkpoint rewrites the full world manifest; scopes are listed and shown with lineage but not diffed; the N-way diff assigns no divergence causes |
| §4, App. C Performance | Kernel benchmarks and SLOs on recorded hosts; `pnpm bench:scopes` measures scope fork/revert (`forkScope`/`discardScope`) latency over three world sizes and every conformant carrier, K=4 branch disk and RSS, a per-write mutation-size sweep with independent hash checks of every revert, and per-event record and observe overhead through 200 steps with 0, 1, and 4 observers, with raw samples and per-host-class SLOs (`pnpm check:scopes`) for macOS APFS (copy, clone) and a privileged Linux XFS container (copy, clone, overlay) (11.2.0, [#214](https://github.com/avnionur/shepherd-typescript/issues/214)); Anthropic Messages and OpenAI-compatible (OpenRouter) live adapters with `cache_control` on the last prefix message, cache read/creation tokens in usage, and provider conversations that resend a byte-identical prefix after rewind (5.1.0, [#204](https://github.com/avnionur/shepherd-typescript/issues/204)) | Fork latency grows with world size on every backend (each fork durably publishes custody and re-verifies custody and origin before completing), unlike the paper's constant-time overlay fork; device-layer checkpoints are constant in world size and flat through 48 stacked layers on the Linux overlay lane (`pnpm bench:device-layers`, [#215](https://github.com/avnionur/shepherd-typescript/issues/215)); no bare-metal Linux or x86-64 measurement; no live cache-hit rate measured (opt-in live test not run without credentials) |
| §5.1, App. E Supervisor | Concurrent runtime supervisor: workers run in forked custody while a supervisor ticks over their live streams and applies per-agent batched `none`/`inject`/`handoff`/`discard` decisions validated against the pinned Appendix E schema; inject between turns with a byte-identical prefix, cross-agent handoff from the leader's custody, a provider-backed JSON-mode policy, and crash recovery of mid-run interventions (11.1.0, [#211](https://github.com/avnionur/shepherd-typescript/issues/211)); the round-based handle supervisor remains | Policy and workers ran only against scripted providers; no CooperBench pair rate measured |
| §5.2, App. F CRO | Algorithm 1: per-example train and dev baselines, N proposer iterations of k edits with fix and guard sets (caller-supplied proposer or a replayable tool-loop proposer with `read_effect_trace`/`grep_effect_traces`), reflection-schema and reflection-contract admission, counterfactual replay from the first affected step (`request` or `downstream` scope), the fractional fix/guard gate, dev evaluation with epsilon promotion into a graduate-only pool, dev selection, and a per-proposer-session computation-reuse ratio in the manifest (11.0.0, [#212](https://github.com/avnionur/shepherd-typescript/issues/212)) | Edits are declared data applied by caller code; no live provider ran the proposer; reuse counts replay steps, not provider cache hits |
| §5.3 Tree-RL | Algorithm 2 over a batch of prompts with G graded roots each: a meta-agent (or deterministic) fork selector returns `{branch_turn, tool_call, reason}` clamped to `[1, T-2]`, the tool call seeds one of K concurrent branches, and inter-root/intra-tree advantages with per-group standardization are attributed per action in the `jsonl_v2` batch, with a trainer-export adapter seam (10.0.0, [#213](https://github.com/avnionur/shepherd-typescript/issues/213)); world- and process-bound roots fork at checkpointed boundaries (8.0.0, [#210](https://github.com/avnionur/shepherd-typescript/issues/210)) | No trainer or policy update and no learning result; meta-agent selector exercised only with fixture providers |
| App. D Compression | Fork point and hint, verifier gate, best-of-N control; fork step 0 restarts with the hint, out-of-range steps clamped to `[0, n - 1]` by configured policy and retained, missing fork step settles `no_prune`; rescue counts in the evaluation report (5.0.0, [#208](https://github.com/avnionur/shepherd-typescript/issues/208)) | No task-level source success judge, so no compression rescue is measured; world-bound sources prune only at checkpointed fork points (8.0.0, [#210](https://github.com/avnionur/shepherd-typescript/issues/210)) |
| App. B Proof envelopes | Core-0/Core-A classification; Core-0H fenced; Lean external; run, replay, and child-run inspections carry a `proof` envelope (`runtime_only` by default, imported claims only as `claimed_proof_backed` metadata, forwarding/delay/fork/replay as `extension`) and eligible static replay sessions lower into Core-A records checked by the reference machine (9.0.0, [#216](https://github.com/avnionur/shepherd-typescript/issues/216)) | Lowering covers finished effect-only root sessions and is reference-validated, never proof-backed; imported claims are never verified; no Lean build runs here |
| App. A.2, §6 Future work | Research notes for five directions (interpretability probes, reversible continual learning, substrate-native post-training actions, trace-to-workflow compression, safety deployment profile) in [`.plan/research/`](https://github.com/avnionur/shepherd-typescript/blob/main/.plan/research/README.md) (11.3.1, [#218](https://github.com/avnionur/shepherd-typescript/issues/218)) | Notes only: not normative, no results, no implementation issue until reviewed |

## Requirements

- Node.js `>=24.12.0 <27` (Node 24 and Node 26); unsupported runtimes are refused before any
  storage setup ([runtime support](./docs/runtime-support.md)). Node 24.12 prints Node's SQLite
  experimental warning.
- ESM and CommonJS `require()` consumers are supported; TypeScript consumers need TypeScript
  `5.9.3` or later.
- No runtime dependencies.

Contributor tooling (pnpm 10) is listed under [Development](#development).

## Installation

The package (`@avnionur/shepherd-typescript`) is not published to npm; publication readiness is
tracked in [#220](https://github.com/avnionur/shepherd-typescript/issues/220). Install a locally
packed tarball:

```sh
# in this repository
pnpm install && pnpm build && npm pack

# in the consuming project
npm install /path/to/avnionur-shepherd-typescript-<version>.tgz
```

The package is authored as ESM and has no runtime dependencies. On the supported Node range every
entry also loads with CommonJS `require()` (require(esm)); undeclared deep imports are rejected.
TypeScript consumers need TypeScript 5.9.3 or later. `pnpm verify` installs the packed tarball into an
isolated consumer; a 2026-09-25 local check also passed TypeScript 5.9 and 7.0 under `NodeNext`,
`Node16`, and `Bundler` resolution and `publint --strict`. `@arethetypeswrong/cli` 0.18.5 passes
with `--profile esm-only`; its default and `node16` profiles report the expected `node16 (from CJS)`
ESM warning because its bundled TypeScript predates require(esm) (details in
[package exports](https://github.com/avnionur/shepherd-typescript/blob/main/docs/package-exports.md#commonjs-require)). Bundlers must ship the package's three
`*.config.json` assets beside the bundle; a missing asset raises `ConfigurationAssetError`
(`CONFIGURATION_ASSET_MISSING`) naming the expected path.

## Quick start

Run a task durably against an offline provider, then reconstruct the result from the trace:

```ts
import {
    createStaticProvider,
    executeTaskDurably,
    inspectDurableTaskExecution,
    readDurableTaskExecution,
    schema,
    SQLiteTraceStore,
    task,
} from "@avnionur/shepherd-typescript";

// A task is a typed, content-addressed value: instruction plus input and output schemas.
const status = task({
    name: "status",
    version: "1.0.0",
    instruction: "Return one status word.",
    input: schema.object({ state: schema.string() }),
    output: schema.string(),
});

// The static provider replays an exact recorded exchange, so this runs offline.
const provider = createStaticProvider({
    descriptor: { id: "readme", model: "offline-v1" },
    exchanges: [{
        request: {
            instruction: status.instruction,
            input: { state: "ready" },
            outputSchema: status.artifact.output_schema,
        },
        response: {
            output: "ready",
            usage: {
                inputTokens: 4,
                outputTokens: 1,
                cacheCreationInputTokens: 0,
                cacheReadInputTokens: 0,
                costUsd: 0,
            },
        },
    }],
});

// Durable execution records lifecycle, usage, and outcome in the trace store.
using store = new SQLiteTraceStore("trace.sqlite");
await executeTaskDurably(store, {
    task: status,
    input: { state: "ready" },
    provider,
    runId: "run:status:1",
    budget: { maxTurns: 1 },
});

// The result is reconstructed from the trace without calling the provider again.
const recovered = readDurableTaskExecution(store, "run:status:1");
if (recovered.status === "committed") {
    console.log(recovered.result.execution.outcome.outcome); // { status: "finished", value: "ready" }
}
inspectDurableTaskExecution(store, "run:status:1").causal_edges;
```

The CLI ships a complete offline walkthrough that captures a task's workspace changes, inspects
the changeset, and settles it:

```sh
shepherd-ts demo write quickstart > quickstart.mjs
node quickstart.mjs
shepherd-ts --help          # add --json for the stable shepherd.cli.json.v1 envelope
```

More examples:

- [Pi chat and node observability](./docs/pi-observatory.md): local browser chat, canonical evidence
  graph, live provider/key setup, local Ollama and recoverable canvas clearing and an optional configured Pi RPC process

- [Offline retained-output quickstart](https://github.com/avnionur/shepherd-typescript/blob/main/docs/quickstart.md)
- [TypeScript examples](./docs/typescript-examples.md): retained coding edit, read-only review,
  multiple bindings, and custom effects
- [Python-to-TypeScript migration guide](./docs/python-to-typescript.md)

## Package entries

| Entry | Purpose |
| --- | --- |
| `.` | Complete public API |
| `./tasks` | Task and schema builders, `compileJSONSchema` validator, task registry with durable grant declarations, task ledgers |
| `./effects` | Effect intent/outcome builders, correlation, ordered and typed handlers, compensation registries, inspection and audited operator reconciliation |
| `./providers` | Provider contract, deterministic static provider, program conversation provider, live Anthropic and OpenAI-compatible adapters with tool calls, provider conversations |
| `./runs` | Offline and durable execution, budgets, cancellation, recovery, pause/resume |
| `./trace` | `SQLiteTraceStore`, cuts, slices, projections, interchange, trace revisions |
| `./scopes` | Scope registration, writer fencing, emission, inspection, recovery classification |
| `./workspace` | Workspace initialization, bindings, carriers, capture, settlement, scope fork, merge, and discard, layered device-layer worlds and adapters |
| `./supervision` | Trace subscriptions, supervised effect interception, approvals, worker control |
| `./replay` | Replay sessions, coupled checkpoints, rewind, suffix replay, divergence analysis |
| `./delegation` | Task values, child run handles, delegated authority, supervisor operations |
| `./applications` | Runtime and coding supervisors, counterfactual optimizer, trajectory compression, Tree-RL, evaluation, tool-use loop, meta-agent tools |
| `./operations` | Secrets and retention, backup and restore, storage interfaces, telemetry |
| `./canonical` | Canonical encoding and record identity |
| `./cli` | Reusable CLI runner with injectable I/O |
| `./read` | Type-only, browser-safe trace read types |

See [package exports](https://github.com/avnionur/shepherd-typescript/blob/main/docs/package-exports.md) for boundaries and per-entry loading, and the
[generated API reference](./docs/generated/api-reference.md) for every symbol. Semantic values must
be JSON-compatible: undefined array elements, non-finite numbers, accessors, symbols, class
instances, and cycles are rejected.

## Documentation

[Effect reconciliation](https://github.com/avnionur/shepherd-typescript/blob/main/docs/effect-reconciliation.md)
records authorized retry, verified external completion or accepted unresolved risk while preserving
factual outcomes. Affected run, replay and scope inspections expose residual risk.

Built-in retained-world reads and writes now produce automatic
[operation evidence](https://github.com/avnionur/shepherd-typescript/blob/main/docs/world-effect-journal.md),
including overwritten writes, denials and interrupted admissions, with bounded digest-only content.

Branch retries bind the complete declared request before compensation or restoration. See
[replay request identity](https://github.com/avnionur/shepherd-typescript/blob/main/docs/replay-request-identity.md)
for inspection, excluded operational fields and the 13.0.0 legacy-retry refusal.

The [documentation index](https://github.com/avnionur/shepherd-typescript/blob/main/docs/README.md) lists every guide. Starting points:

- **Trace kernel:** [canonical records](https://github.com/avnionur/shepherd-typescript/blob/main/docs/canonical-records.md),
  [SQLite trace store](https://github.com/avnionur/shepherd-typescript/blob/main/docs/sqlite-trace-store.md), [cuts and slices](https://github.com/avnionur/shepherd-typescript/blob/main/docs/trace-queries.md),
  [interchange](https://github.com/avnionur/shepherd-typescript/blob/main/docs/trace-interchange.md), [vocabulary](https://github.com/avnionur/shepherd-typescript/blob/main/CONTEXT.md)
- **Tasks and runs:** [task descriptors](https://github.com/avnionur/shepherd-typescript/blob/main/docs/task-descriptors.md),
  [JSON Schema validation](https://github.com/avnionur/shepherd-typescript/blob/main/docs/json-schema-validation.md),
  [durable execution](https://github.com/avnionur/shepherd-typescript/blob/main/docs/durable-task-execution.md),
  [execution control](https://github.com/avnionur/shepherd-typescript/blob/main/docs/durable-execution-control.md),
  [effect handlers](https://github.com/avnionur/shepherd-typescript/blob/main/docs/effect-handlers.md), [effect compensation](https://github.com/avnionur/shepherd-typescript/blob/main/docs/compensation.md)
- **Scopes and worlds:** [scope fork](https://github.com/avnionur/shepherd-typescript/blob/main/docs/scope-fork.md),
  [merge and discard](https://github.com/avnionur/shepherd-typescript/blob/main/docs/scope-merge-discard.md), [scope laws](https://github.com/avnionur/shepherd-typescript/blob/main/docs/scope-laws.md),
  [optimized carriers](https://github.com/avnionur/shepherd-typescript/blob/main/docs/optimized-carriers.md), [device layers](https://github.com/avnionur/shepherd-typescript/blob/main/docs/device-layers.md),
  [native jail execution](https://github.com/avnionur/shepherd-typescript/blob/main/docs/native-jail-execution.md)
- **Supervision and replay:** [trace subscriptions](https://github.com/avnionur/shepherd-typescript/blob/main/docs/trace-subscriptions.md),
  [supervised effects](https://github.com/avnionur/shepherd-typescript/blob/main/docs/supervised-effects.md),
  [replay sessions](https://github.com/avnionur/shepherd-typescript/blob/main/docs/replay-sessions.md), [rewind and replay](https://github.com/avnionur/shepherd-typescript/blob/main/docs/rewind-and-replay.md),
  [task values](https://github.com/avnionur/shepherd-typescript/blob/main/docs/task-values.md), [supervisor operations](https://github.com/avnionur/shepherd-typescript/blob/main/docs/supervisor-operations.md)
- **Research applications:** [runtime supervisor](https://github.com/avnionur/shepherd-typescript/blob/main/docs/runtime-supervisor.md),
  [coding supervisor](https://github.com/avnionur/shepherd-typescript/blob/main/docs/coding-supervisor.md),
  [counterfactual optimization](https://github.com/avnionur/shepherd-typescript/blob/main/docs/counterfactual-optimization.md),
  [trajectory compression](https://github.com/avnionur/shepherd-typescript/blob/main/docs/trajectory-compression.md),
  [Tree-RL rollouts](https://github.com/avnionur/shepherd-typescript/blob/main/docs/tree-rl-rollouts.md),
  [evaluation report](https://github.com/avnionur/shepherd-typescript/blob/main/docs/generated/application-evaluation.md)
- **Operations:** [CLI](https://github.com/avnionur/shepherd-typescript/blob/main/docs/cli.md), [secrets and retention](https://github.com/avnionur/shepherd-typescript/blob/main/docs/secrets-and-retention.md),
  [backup and restore](https://github.com/avnionur/shepherd-typescript/blob/main/docs/backup-restore-and-migration.md),
  [observability](https://github.com/avnionur/shepherd-typescript/blob/main/docs/observability.md), [performance report](https://github.com/avnionur/shepherd-typescript/blob/main/docs/performance-report.md),
  [threat model](https://github.com/avnionur/shepherd-typescript/blob/main/docs/threat-model.md), [support policy](https://github.com/avnionur/shepherd-typescript/blob/main/docs/support-policy.md)
- **Planning:** [roadmap](https://github.com/avnionur/shepherd-typescript/blob/main/.plan/implementation-roadmap.md),
  [parity matrix](https://github.com/avnionur/shepherd-typescript/blob/main/.plan/parity-matrix.md), [tracker](https://github.com/avnionur/shepherd-typescript/blob/main/.plan/tracker.md)

## Development

An independent [2026-10-05 empirical study](https://github.com/avnionur/shepherd-typescript/blob/main/.plan/benchmarks/2026-10-05/paper.tex)
records fresh runtime measurements and a local-model context-selection pilot against a matched
direct harness. Its [reproduction guide](https://github.com/avnionur/shepherd-typescript/blob/main/.plan/benchmarks/2026-10-05/README.md)
links the raw observations, failures, and limitations; it does not rank other frameworks.

Development needs pnpm 10 (`packageManager` in `package.json`) on the same Node range.

```sh
pnpm install
pnpm verify              # every gate: protocol, evaluation, SBOM, API reference, compatibility,
                         # lint, typecheck, tests with 100% coverage, build, packaged CLI
pnpm test                # tests, default fuzz tier, fault suites, bounded soak
pnpm build               # declarations and JavaScript into dist/
node src/cli/main.ts     # run the CLI from source
```

| Command | Purpose |
| --- | --- |
| `pnpm verify:serial` | `pnpm verify` without native-probe process contention |
| `pnpm verify:release` | Adds SLO checks, byte-identical double build and pack, SBOM, and unsigned provenance in `release/` |
| `pnpm bench:kernel`, `pnpm check:slo` | Record kernel benchmarks; check budgets for the current host class |
| `pnpm bench:scopes`, `pnpm check:scopes`, `pnpm bench:scopes:linux` | Record scope fork/revert, storage, and observation benchmarks; check their budgets; record the privileged Linux XFS container lane |
| `pnpm fuzz` | Extended fuzz tier (`--seed`, `--iterations`, `--target`, `--json`) |
| `pnpm test:soak --duration 600` | Mixed soak for a wall-clock budget |
| `pnpm test:faults:volume` | Real `ENOSPC` on a macOS disk image or, as root, a Linux ext4 loop image |
| `pnpm generate:protocol` | Regenerate schemas after changing `protocol.config.json` |

Biome formats and lints; Node's built-in test runner executes TypeScript directly. Coverage is merged
from raw V8 data by the repository's own [coverage gate](https://github.com/avnionur/shepherd-typescript/blob/main/docs/coverage-gate.md). `scripts/` holds
thin command adapters and `tooling/` holds tested build, release, and conformance code; only `src/`
is emitted. `pnpm verify` also enforces the [compatibility policy](https://github.com/avnionur/shepherd-typescript/blob/main/docs/compatibility-policy.md)
for exports, error codes, CLI commands, schemas, and migrations.

## Releases

1. Set the version in `release-config.yaml` and add its `CHANGELOG.md` section.
2. Run `pnpm sync:version`, `pnpm generate:api-reference`, `pnpm generate:sbom`, and
   `pnpm update:compatibility-baseline`, then `pnpm verify` and `pnpm build:desktop`.
3. After merge, push the `v<version>` tag. The [release workflow](https://github.com/avnionur/shepherd-typescript/blob/main/docs/release-integrity.md#release-workflow)
   checks that the tag, configuration, and changelog agree, runs `pnpm verify:release`, attests the
   tarball, and creates a GitHub Release with the tarball, SBOM, and provenance attached.

npm publication is a separate manual dispatch that refuses a `"private": true` package; it stays
disabled until the owner decision in [#221](https://github.com/avnionur/shepherd-typescript/issues/221).
Hosted Actions are currently unavailable for this repository, so the workflow has not run yet.

## Contributing and security

See [CONTRIBUTING.md](https://github.com/avnionur/shepherd-typescript/blob/main/CONTRIBUTING.md) for development and review requirements and
[SECURITY.md](https://github.com/avnionur/shepherd-typescript/blob/main/SECURITY.md) for private vulnerability reporting. Participation is governed by the
[Code of Conduct](https://github.com/avnionur/shepherd-typescript/blob/main/CODE_OF_CONDUCT.md).

## Attribution and license

The design follows the MIT-licensed [Shepherd project](https://github.com/shepherd-agents/shepherd)
and its paper, _Shepherd: Enabling Programmable Meta-Agents via Reversible Agentic Execution
Traces_ ([arXiv 2605.10913](https://arxiv.org/abs/2605.10913)), by Simon Yu, Derek Chong, Ananjan
Nandi, Dilara Soylu, Jiuding Sun, Christopher D. Manning, and Weiyan Shi. Compatibility claims are
tracked explicitly in the [coverage map](https://github.com/avnionur/shepherd-typescript/blob/main/.plan/paper-coverage.md).

Original work in this repository is available under the [MIT License](./LICENSE). See
[NOTICE](./NOTICE) for upstream attribution and reuse boundaries.

`SQLiteTaskRegistry.registerGranted` persists exact-version repository declarations for read-only
`task show` inspection after restart. See [registration and migration](https://github.com/avnionur/shepherd-typescript/blob/main/docs/task-registry.md).
