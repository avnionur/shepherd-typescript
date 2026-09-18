# Package exports and module policy

Runtime APIs are ESM-only on Node >=24.12.0 <25; the type-only `/read` entry requires no Node
runtime or declarations. Version 2.0.0 narrows the previous range with owner approval and enforces
it before runtime operations. See [runtime support](./runtime-support.md) for pre-initialization
CLI errors, required SQLite checks, and boundary verification. Supported imports are:

```ts
import { task } from "@avnionur/shepherd-typescript";
import {
    runCodingSupervisor,
    runCounterfactualOptimization,
    runTrajectoryCompression,
    runTreeRlRollouts,
} from "@avnionur/shepherd-typescript/applications";
import { canonicalizeRecord } from "@avnionur/shepherd-typescript/canonical";
import { runCli, type CliIo } from "@avnionur/shepherd-typescript/cli";
import { createEffectHandlerStack, createEffectIntent } from "@avnionur/shepherd-typescript/effects";
import { createStaticProvider } from "@avnionur/shepherd-typescript/providers";
import type { Slice } from "@avnionur/shepherd-typescript/read";
import { executeTask, executeTaskDurably } from "@avnionur/shepherd-typescript/runs";
import { registerRootScope, emitScopeRecord } from "@avnionur/shepherd-typescript/scopes";
import { schema, SQLiteTaskRegistry, task } from "@avnionur/shepherd-typescript/tasks";
import { listTraceRevisions, SQLiteTraceStore } from "@avnionur/shepherd-typescript/trace";
import {
    createWorkspaceBindings,
    initializeWorkspace,
} from "@avnionur/shepherd-typescript/workspace";
```

The root preserves the complete existing public API. `./canonical` is the cohesive canonical
encoding/identity surface. `./cli` contains the reusable runner and injectable I/O boundary.
The root also exports `PublicError`, `PublicErrorCode`, and `isPublicError` for additive in-memory
classification without adding error metadata to canonical records or CLI JSON.
`./tasks` owns task/schema construction, task registry contracts/errors, and bounded task-ledger
reads; it intentionally excludes providers, run execution/control, trace stores, workspace grants,
and private migrations. `./providers` owns the provider-neutral contract, descriptors,
artifact/usage response types, deterministic static adapter, and stable errors; execution, tools,
credentials, and workspace authority remain excluded. Undeclared deep imports are rejected.

`./effects` owns immutable effect intent/outcome builders, exact correlation validation, ordered
exact-kind handler stacks, schema-validated typed payload adapters, their public types, and stable
unhandled-effect errors. Handlers are
caller-supplied in-process callbacks and dispatch is non-durable. The facade does not append trace
records, materialize world changes, intercept execution, provide replay, or create a sandbox. It
excludes formal proof/reference machinery, task/provider/run execution, trace persistence,
workspace settlement, private validators, migrations, and protocol configuration.

`./trace` is Node-only and explicitly write-capable through `SQLiteTraceStore`. It owns public
append/cut/slice/blob contracts, integrity and native archive methods, store errors/types, and
bounded run/output/trace/recovery evidence reads. It excludes task registry, providers, executors,
workspace carriers/settlements, private SQL/migrations, and protocol configuration.
Its `SQLiteTraceStore.iterateCutRecords` method provides
[lazy owner-record iteration](./trace-queries.md#async-owner-record-iteration) over a fixed published
cut, without a cursor across pulls; it does not provide graph closure or redaction.

`./read` is the separate [web-safe type-only entry](./web-safe-read-types.md) for existing readonly
semantic/record/owner/cut/slice data. It exports no runtime values, store handles or mutation
requests. Its installed declarations compile without Node declarations in strict Bundler and
NodeNext consumers; its ESM module is empty. It provides no runtime validation or redaction.

`./runs` is Node-only and owns public run builders/types/errors, budgets and cancellation,
provider-neutral task execution, and durable execution/control/recovery/inspection. Consumers
must supply authenticated task descriptors from `./tasks`, provider authority from `./providers`
or another contract implementation, and an open trace authority from `./trace` for durable calls.
The facade creates no ambient provider, persistence, or workspace authority. It excludes task
registries, provider adapters, the SQLite store constructor, workspace carrier/settlement handles,
private codecs, migrations, and protocol configuration.

`./scopes` is Node-only and owns trace-only durable scope registration, single and atomic
multi-scope writer claims, fenced scope-local emission, inspection, receipt replay, fork and
checkpoint types, generated scope constants, and the scope error classes,
plus the shared append-conflict and trace-store base errors those commands raise. Consumers supply
an open trace store from `./trace`; the facade creates no world, provider, filesystem, or
settlement authority and excludes the store constructor, private codecs, migrations, and protocol
configuration. See [scope registration](./scope-registration.md). The world-bearing `forkScope`
lives on `./workspace` because it composes binding and carrier authority; see
[scope fork](./scope-fork.md).

`./supervision` is Node-only and owns live cursor trace subscriptions, supervised effect dispatch
with ordered interceptors and fenced decision leases, read-only dispatch inspection, approval
verdicts, cited context injection and reads, generated supervision constants, and the supervision
error classes. It re-exports the existing fenced durable-run pause, resume, and cancellation
commands for supervisors. Consumers supply an open trace store from `./trace` and handler stacks
from `./effects`; interceptors and handlers stay caller-supplied callbacks. The facade creates no
provider, filesystem, or workspace authority and excludes the store constructor, private codecs,
migrations, and protocol configuration. See [trace subscriptions](./trace-subscriptions.md),
[supervised effects](./supervised-effects.md), and
[approval, context, and worker control](./supervision-control.md).

`./replay` is Node-only and owns replay sessions, coupled checkpoints, rewind and suffix replay,
record-derived session inspection, checkpoint classification, divergence and dependency analysis,
the cooperative and transparent process checkpoint adapters, generated replay constants, and the
replay error classes. Consumers supply an open trace store from `./trace`, providers from
`./providers`, handler stacks from `./effects`, and task descriptors from `./tasks`; programs,
replay policies, and provider-session adapters stay caller-supplied. Rewind and replay write only
into caller-selected empty world roots. The facade loads process support for the cooperative
adapter and creates no workspace binding, carrier custody, or settlement authority. See
[replay sessions](./replay-sessions.md), [coupled checkpoints](./coupled-checkpoints.md), and
[rewind and replay](./rewind-and-replay.md).

`./delegation` is Node-only and owns task values (`readTaskValue`, `taskValueOf`,
`taskDescriptorOf`), durable child run handles (`openChildRun`, `runChildRun`, `retryChildRun`),
supervisor operations (`observeChildRun`, `injectChildRunContext`, `handoffChildRun`,
`discardChildRun`, `acceptChildRunResult`), task approval (`approveChildRunTask`), record-derived
handle inspection, typed result and tree projections (`projectChildRunResult`,
`projectDelegationTree`), generated delegation constants, and the delegation error classes. Consumers
supply an open trace store from `./trace`, task descriptors from `./tasks`, and providers from
`./providers`; child programs stay caller-supplied callbacks. A handle's authority is derived from a
caller-declared root ceiling or the parent handle's retained effective authority and never exceeds
it; revised and synthesized task values run only after the current supervisor's approval. The
facade creates no provider, filesystem, workspace, custody, or settlement authority and excludes the
store constructor, private codecs, migrations, and protocol configuration. See
[task values and child run handles](./task-values.md),
[delegated authority](./delegated-authority.md),
[supervisor operations](./supervisor-operations.md),
[task revision and synthesis](./task-revision.md), and
[result threading and nested meta-agents](./result-threading.md).

`./applications` is Node-only and owns application protocol definitions and identity
(`readApplicationProtocol`, `applicationProtocolId`, `deriveApplicationOwnerId`), manifests
(`createApplicationManifest`, `validateApplicationManifest`, `retainApplicationManifest`,
`inspectApplicationManifest`), the two-worker coding supervisor (`runCodingSupervisor`,
`inspectCodingSupervisorRun`), the counterfactual workflow optimizer
(`runCounterfactualOptimization`, `inspectCounterfactualOptimization`), trajectory compression
(`runTrajectoryCompression`, `inspectTrajectoryCompression`), the Tree-RL adapter
(`selectTreeRlForkPoints`, `runTreeRlRollouts`, `computeTreeRlAdvantages`,
`exportTreeRlTrainingBatch`, `inspectTreeRlRun`), offline evaluation
(`runApplicationEvaluation`, `readApplicationEvaluationDefinition`, `compareApplicationBaseline`,
`validateApplicationEvaluationReport`), the world adapter types,
generated application constants, and the application error classes. Consumers supply an open trace
store from `./trace`, task descriptors from `./tasks` or task values from `./delegation`, providers
from `./providers`, and optionally a world adapter such as `createScopeWorldAdapter` from
`./workspace`; policies, worker programs, workflow programs, evaluators, compressors,
verifiers, Tree-RL provider factories, reward functions, and evaluation bindings stay
caller-supplied. Every supervisor command and every compressor and verifier child
runs through the delegation seam under the caller's root declaration, and every optimizer,
compression, and Tree-RL rollout session runs through the replay seam without bound worlds or
processes. The facade
imports no workspace entry code of its own and creates no provider, filesystem, workspace, custody,
or settlement authority; because the optimizer composes the replay session implementation, loading
the entry loads the same process-support module the replay entry loads, without starting a process.
See [application manifests](./application-manifests.md), the
[coding supervisor](./coding-supervisor.md),
[counterfactual optimization](./counterfactual-optimization.md),
[trajectory compression](./trajectory-compression.md), the
[Tree-RL adapter](./tree-rl-rollouts.md), and [application evaluation](./application-evaluation.md).

`./workspace` is Node-only and owns workspace initialization/bindings, copy and Git custody,
changeset inspection, repository grants, placement/native-jail evidence, retained-world runners
and execution journals, reference-copy scope forks, the scope world adapter (`createScopeWorldAdapter`), and exact prepare/select/apply/release/discard
settlement operations. These
APIs can read or mutate caller-selected filesystem/Git state, and native runners can launch a
capability-probed process. Consumers must explicitly supply the required task, provider, run,
trace-store, carrier, runner, and grant handles from their owning domains. The facade excludes task
registries, provider adapters, run builders/controls, the SQLite store constructor, low-level trace
mutation, private codecs, migrations, and protocol configuration; it creates no ambient authority.

CommonJS `require()` is intentionally unsupported; use ESM or dynamic `import()`. The package does
not ship a partial CommonJS transform. Node TypeScript consumers use `moduleResolution: "NodeNext"`,
the `ESNext` disposable library, and Node declarations.

Fresh-tarball conformance imports every entry at runtime, typechecks every declaration entry,
rejects CommonJS and deep imports, verifies declaration/source maps, validates effect records and
handler precedence, and composes the task, provider, run, trace, and workspace facades through an
installed offline retained-output consumer, read-only changeset inspection, and exact settlement.
It separately reruns the unchanged root-facade quickstart.

Every supported entry includes JavaScript and declaration maps. Their portable source-path,
embedded-content, installed-stack, and redaction policy is defined in
[`source-maps-and-causes.md`](./source-maps-and-causes.md).

The [generated API reference](./generated/api-reference.md) is built only from these emitted
declaration targets. Its [generation policy](./api-reference.md) requires exact export-map/config
agreement, explicit type/runtime classification, public JSDoc and thrown-error retention,
entry-owned authority notes, private/internal exclusion, deterministic check mode, and packaged
consumer typechecking for every subpath.

## Installed import loading

Fresh-process conformance imports every installed export and observes Node builtin module loads
with synchronous module hooks. The repository's
[`config/entry-loading.config.json`](../config/entry-loading.config.json) requires complete
agreement with the export map and records the following dependencies:

| Entry | Filesystem configuration | SQLite loaded | Process-execution module loaded |
| --- | --- | --- | --- |
| Root, CLI, tasks, trace | Yes | Yes | Yes |
| Canonical, delegation, effects, providers, runs, scopes, supervision | Yes | No | No |
| Applications, replay, workspace | Yes | No | Yes |
| Read (type-only) | No | No | No |

The tasks entry exports its SQLite registry as well as task builders; task-ledger/grant support
also reaches process-related modules. The applications, delegation, replay, runs, scopes, and supervision entries accept store
authority from callers and do not load SQLite merely by being imported. The applications, replay, and workspace entries load filesystem and
process support but do not construct the caller's trace store.

“Loaded” is an import observation, not a claim that a subprocess ran or a database opened.
Every runtime-capable entry reads and validates filesystem-backed protocol configuration, so
those narrow entries are still Node-only. The read entry must load zero Node builtins and expose
an empty runtime namespace. Separate installed no-Node declaration checks cover its type-only
usage; these checks do not prove browser-engine execution or bundler dead-code removal.
There are currently no separately installed optional provider/native adapter packages to test;
their future loading behavior is not inferred from this matrix.

The [installed loading verifier](../tooling/testing/entry-loading.ts) is invoked by the ordinary
package conformance command. Each export gets a fresh process to avoid module-cache contamination;
required loads act as positive controls alongside forbidden loads. Bundler tree-shaking and
configuration-asset handling are exercised separately below.

## Tested Node bundles

Package conformance uses Rollup WASM 4.63.1 (installed under the `rollup` alias) with the official
Node resolver 16.0.3. These are development-only dependencies, installed without lifecycle scripts;
the build allowlist remains empty. Rollup's optional filesystem/compression packages remain
development dependencies, not optional Shepherd runtime adapters.

The [bundle policy](../config/bundle-verification.config.json) defines two installed consumer
fixtures: importing `canonicalizeRecord` through `/canonical` and through the root. Each is built with
tree-shaking off and on; the optimized chunk must be smaller. Module metadata must retain canonical
encoding and configuration validation. The narrow fixture additionally excludes SQLite-store and
native-jail implementation modules and removes the unused `createRecordId` export.

Both optimized ESM chunks execute under Node and produce the independently expected canonical JSON.
The root fixture retains public-error configuration initialization, even though only canonical
encoding is requested. No blanket `sideEffects: false` or `moduleSideEffects: false` is applied.
Root imports remain more coupled than the narrow entry.

Configuration URLs remain relative to `import.meta.url`. The tested output layout is:

```text
bundle-root/
  protocol.config.json
  runtime.config.json
  public-errors.config.json   # additionally required by the root fixture
  chunks/nested/bundle.mjs
```

The two-level nesting preserves the emitted configuration modules' `../../` asset references.
Assets are copied from the installed package's `dist/` directory. Removing each required asset
must fail with a missing-file error; replacing it with invalid configuration must also fail.
Restoring assets restores successful execution. A bundle is therefore not a single self-contained
file. Other output locations require a deliberate asset-location strategy.

The root graph produces known Rollup `THIS_IS_UNDEFINED` warnings for compiler-generated ESM helpers
and `CIRCULAR_DEPENDENCY` warnings for existing workspace modules. These categories are explicitly
accepted in the test policy; other warnings fail bundling. Runtime execution and asset-validation
checks remain mandatory.

This evidence covers the two stated Node fixtures, not arbitrary root-export combinations,
browser targets, CommonJS bundles, all bundlers, bundled source-map portability, or optional
provider/native adapters that do not yet exist. The unchanged unbundled package still has its
separate installed source-map and all-export conformance checks.
