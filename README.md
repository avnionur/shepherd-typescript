# Shepherd TypeScript

A native TypeScript implementation of [Shepherd](https://arxiv.org/abs/2605.10913): reversible,
inspectable agent execution traces for building meta-agents that observe, intercept, fork, rewind,
and replay other agents.

The implementation is built over a language-neutral protocol. Upstream Python behavior is a pinned
compatibility oracle, not a runtime dependency. This project is not affiliated with the upstream
Shepherd authors.

[Paper](https://arxiv.org/abs/2605.10913) ·
[Upstream project](https://shepherd-agents.ai/) ·
[Upstream code](https://github.com/shepherd-agents/shepherd) ·
[Paper coverage](./.plan/paper-coverage.md) ·
[Documentation](./docs/README.md) ·
[Changelog](./CHANGELOG.md)

[![Original Shepherd paper teaser: a meta-agent creates, observes, intercepts, reverts, and forks a worker trace](https://shepherd-agents.ai/assets/teaser.png)](https://shepherd-agents.ai/assets/teaser.mp4)

_The teaser image and video belong to the upstream paper project. They illustrate the target and are
not benchmark claims for this implementation._

## Contents

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
| **Effect** | A typed intent/outcome pair for every action, observable and interceptable before its outcome exists | `./effects`, `./supervision` |
| **Scope** | An isolated agent-and-environment region supporting `emit`, `fork`, `merge`, and `discard` | `./scopes`, `./workspace` |
| **Trace** | An immutable, content-addressed record graph with historical cuts, rewind, and suffix replay | `./trace`, `./replay` |

On top of these, `./applications` implements the paper's meta-agents: a runtime coding supervisor,
counterfactual replay optimization, trajectory compression, and Tree-RL rollouts.

Everything runs offline and deterministically: providers are exact-cassette (`static`) or program
serviced, and all results are this repository's measurements, never upstream numbers.

## Status

| Level | Meaning | Status |
| --- | --- | --- |
| L0 | Canonical schemas, identities, trace storage, and projections | Complete |
| L1 | Shepherd `0.3.0` settlement compatibility | Complete (1.51.0) |
| L2 | Scope and versioned-world substrate parity | Complete on recorded hosts (2.7.1) |
| L3 | Paper programming-model parity and research applications | Complete for the documented offline scope (2.20.1, applications 2.25.1) |
| L4 | Security, recovery, performance, packaging, and releases | "1.0" in 2.34.0 as a private, unpublished source release with owner waivers ([release notes](./docs/release-notes-1.0.md)) |

"1.0" is a maturity milestone, not a package version. It excludes an external security review,
signing, npm publication, hosted CI (local macOS gates and a local Docker Linux lane substitute),
and Windows. Phase-by-phase evidence is in the [tracker](./.plan/tracker.md) and the phase exit
audits under [`.plan`](./.plan/README.md).

## Paper coverage

The 2026-09-25 audit of [paper v3](https://arxiv.org/abs/2605.10913) is tracked in
[#202](https://github.com/avnionur/shepherd-typescript/issues/202); details are in the
[coverage map](./.plan/paper-coverage.md#known-deviations-2026-09-25-audit-2340).

| Paper section | Implemented | Known gaps |
| --- | --- | --- |
| §3.1 Tasks | Typed task values, substitution, revision, synthesis, nested meta-agents | Schemas limited to string, object, and void ([#205](https://github.com/avnionur/shepherd-typescript/issues/205)) |
| §3.2 Effects | Intent/outcome records, handlers, live observation, allow/deny/replace/pause interception, irreversible approval frontier | No compensation handlers ([#209](https://github.com/avnionur/shepherd-typescript/issues/209)); no tool-use loop ([#206](https://github.com/avnionur/shepherd-typescript/issues/206)) |
| §3.3 Scopes | `emit`, `fork`, `merge`, `discard`, nesting, parallel scheduling, copy/clone/overlay carriers | Single-layer overlay, no sandbox device layer ([#215](https://github.com/avnionur/shepherd-typescript/issues/215)) |
| §3.4 Trace | Content-addressed graph, cuts, rewind, suffix replay, branch divergence | Per-step world checkpoints ([#210](https://github.com/avnionur/shepherd-typescript/issues/210)); N-way diff and trace CLI ([#217](https://github.com/avnionur/shepherd-typescript/issues/217)) |
| §4, App. C Performance | Kernel benchmarks and SLOs on recorded hosts | Fork/revert and observer benchmarks ([#214](https://github.com/avnionur/shepherd-typescript/issues/214)); live providers and prompt-cache reuse ([#204](https://github.com/avnionur/shepherd-typescript/issues/204)) |
| §5.1, App. E Supervisor | Two-worker supervisor with inject, handoff, discard-and-restart | Concurrent workers and per-tick decisions ([#211](https://github.com/avnionur/shepherd-typescript/issues/211)) |
| §5.2, App. F CRO | Affected-suffix replay of caller-declared candidates | Edited step not re-executed ([#207](https://github.com/avnionur/shepherd-typescript/issues/207)); Algorithm 1 loop ([#212](https://github.com/avnionur/shepherd-typescript/issues/212)) |
| §5.3 Tree-RL | Branched rollouts, advantages, `jsonl_v1` batches | Algorithm 2 and meta-agent fork selection ([#213](https://github.com/avnionur/shepherd-typescript/issues/213)) |
| App. D Compression | Fork point and hint, verifier gate, best-of-N control | `fork_step` 0 and clamping ([#208](https://github.com/avnionur/shepherd-typescript/issues/208)) |
| App. B Proof envelopes | Core-0/Core-A classification; Core-0H fenced; Lean external | Runs do not carry envelopes ([#216](https://github.com/avnionur/shepherd-typescript/issues/216)) |
| App. A.2, §6 Future work | Classified research backlog | [#218](https://github.com/avnionur/shepherd-typescript/issues/218) |

## Requirements

- Node.js `>=24.12.0 <25`; unsupported runtimes are refused before any storage setup
  ([runtime support](./docs/runtime-support.md)). Node 24.12 prints Node's SQLite experimental
  warning.
- pnpm 10, for development only.

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

The package is ESM-only and has no runtime dependencies. CommonJS callers must use dynamic
`import()`; undeclared deep imports are rejected. `pnpm verify` installs the packed tarball into an
isolated consumer; a 2026-09-25 local check also passed TypeScript 5.9 and 7.0 under `NodeNext`,
`Node16`, and `Bundler` resolution, `publint --strict`, and
`@arethetypeswrong/cli --profile esm-only`.

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

- [Offline retained-output quickstart](./docs/quickstart.md)
- [TypeScript examples](./docs/typescript-examples.md): retained coding edit, read-only review,
  multiple bindings, and custom effects
- [Python-to-TypeScript migration guide](./docs/python-to-typescript.md)

## Package entries

| Entry | Purpose |
| --- | --- |
| `.` | Complete public API |
| `./tasks` | Task and schema builders, task registry, task ledgers |
| `./effects` | Effect intent/outcome builders, correlation, ordered and typed handlers |
| `./providers` | Provider contract and deterministic static provider |
| `./runs` | Offline and durable execution, budgets, cancellation, recovery, pause/resume |
| `./trace` | `SQLiteTraceStore`, cuts, slices, projections, interchange, trace revisions |
| `./scopes` | Scope registration, writer fencing, emission, inspection, recovery classification |
| `./workspace` | Workspace initialization, bindings, carriers, capture, settlement, scope fork, merge, and discard |
| `./supervision` | Trace subscriptions, supervised effect interception, approvals, worker control |
| `./replay` | Replay sessions, coupled checkpoints, rewind, suffix replay, divergence analysis |
| `./delegation` | Task values, child run handles, delegated authority, supervisor operations |
| `./applications` | Coding supervisor, counterfactual optimizer, trajectory compression, Tree-RL, evaluation |
| `./operations` | Secrets and retention, backup and restore, storage interfaces, telemetry |
| `./canonical` | Canonical encoding and record identity |
| `./cli` | Reusable CLI runner with injectable I/O |
| `./read` | Type-only, browser-safe trace read types |

See [package exports](./docs/package-exports.md) for boundaries and per-entry loading, and the
[generated API reference](./docs/generated/api-reference.md) for every symbol. Semantic values must
be JSON-compatible: undefined array elements, non-finite numbers, accessors, symbols, class
instances, and cycles are rejected.

## Documentation

The [documentation index](./docs/README.md) lists every guide. Starting points:

- **Trace kernel:** [canonical records](./docs/canonical-records.md),
  [SQLite trace store](./docs/sqlite-trace-store.md), [cuts and slices](./docs/trace-queries.md),
  [interchange](./docs/trace-interchange.md), [vocabulary](./CONTEXT.md)
- **Tasks and runs:** [task descriptors](./docs/task-descriptors.md),
  [durable execution](./docs/durable-task-execution.md),
  [execution control](./docs/durable-execution-control.md),
  [effect handlers](./docs/effect-handlers.md)
- **Scopes and worlds:** [scope fork](./docs/scope-fork.md),
  [merge and discard](./docs/scope-merge-discard.md), [scope laws](./docs/scope-laws.md),
  [optimized carriers](./docs/optimized-carriers.md),
  [native jail execution](./docs/native-jail-execution.md)
- **Supervision and replay:** [trace subscriptions](./docs/trace-subscriptions.md),
  [supervised effects](./docs/supervised-effects.md),
  [replay sessions](./docs/replay-sessions.md), [rewind and replay](./docs/rewind-and-replay.md),
  [task values](./docs/task-values.md), [supervisor operations](./docs/supervisor-operations.md)
- **Research applications:** [coding supervisor](./docs/coding-supervisor.md),
  [counterfactual optimization](./docs/counterfactual-optimization.md),
  [trajectory compression](./docs/trajectory-compression.md),
  [Tree-RL rollouts](./docs/tree-rl-rollouts.md),
  [evaluation report](./docs/generated/application-evaluation.md)
- **Operations:** [CLI](./docs/cli.md), [secrets and retention](./docs/secrets-and-retention.md),
  [backup and restore](./docs/backup-restore-and-migration.md),
  [observability](./docs/observability.md), [performance report](./docs/performance-report.md),
  [threat model](./docs/threat-model.md), [support policy](./docs/support-policy.md)
- **Planning:** [roadmap](./.plan/implementation-roadmap.md),
  [parity matrix](./.plan/parity-matrix.md), [tracker](./.plan/tracker.md)

## Development

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
| `pnpm fuzz` | Extended fuzz tier (`--seed`, `--iterations`, `--target`, `--json`) |
| `pnpm test:soak --duration 600` | Mixed soak for a wall-clock budget |
| `pnpm test:faults:volume` | Real `ENOSPC` on a macOS disk image or, as root, a Linux ext4 loop image |
| `pnpm generate:protocol` | Regenerate schemas after changing `protocol.config.json` |

Biome formats and lints; Node's built-in test runner executes TypeScript directly. `scripts/` holds
thin command adapters and `tooling/` holds tested build, release, and conformance code; only `src/`
is emitted. `pnpm verify` also enforces the [compatibility policy](./docs/compatibility-policy.md)
for exports, error codes, CLI commands, schemas, and migrations.

## Releases

1. Set the version in `release-config.yaml` and add its `CHANGELOG.md` section.
2. Run `pnpm sync:version`, `pnpm generate:api-reference`, `pnpm generate:sbom`, and
   `pnpm update:compatibility-baseline`, then `pnpm verify` and `pnpm build:desktop`.
3. After merge, push the `v<version>` tag. The [release workflow](./docs/release-integrity.md#release-workflow)
   checks that the tag, configuration, and changelog agree, runs `pnpm verify:release`, attests the
   tarball, and creates a GitHub Release with the tarball, SBOM, and provenance attached.

npm publication is a separate manual dispatch that refuses a `"private": true` package; it stays
disabled until the owner decision in [#221](https://github.com/avnionur/shepherd-typescript/issues/221).
Hosted Actions are currently unavailable for this repository, so the workflow has not run yet.

## Contributing and security

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development and review requirements and
[SECURITY.md](./SECURITY.md) for private vulnerability reporting. Participation is governed by the
[Code of Conduct](./CODE_OF_CONDUCT.md).

## Attribution and license

The design follows the MIT-licensed [Shepherd project](https://github.com/shepherd-agents/shepherd)
and its paper, _Shepherd: Enabling Programmable Meta-Agents via Reversible Agentic Execution
Traces_ ([arXiv 2605.10913](https://arxiv.org/abs/2605.10913)), by Simon Yu, Derek Chong, Ananjan
Nandi, Dilara Soylu, Jiuding Sun, Christopher D. Manning, and Weiyan Shi. Compatibility claims are
tracked explicitly in the [coverage map](./.plan/paper-coverage.md).

Original work in this repository is available under the [MIT License](./LICENSE). See
[NOTICE](./NOTICE) for upstream attribution and reuse boundaries.
