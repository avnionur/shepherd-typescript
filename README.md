# Shepherd TypeScript

An independent, native TypeScript implementation of Shepherd's reversible agent execution model,
with complete coverage of the paper's programming model and research applications as the target.

The implementation is built over a language-neutral protocol. Upstream Python behavior is a pinned
compatibility oracle where applicable, not a runtime dependency or a second deliverable. This
project is not affiliated with the upstream Shepherd authors.

[Paper coverage](./.plan/paper-coverage.md) ·
[Parity matrix](./.plan/parity-matrix.md) ·
[Implementation roadmap](./.plan/implementation-roadmap.md)

[Paper](https://arxiv.org/abs/2605.10913) ·
[PDF](https://arxiv.org/pdf/2605.10913) ·
[Upstream project](https://shepherd-agents.ai/) ·
[Blog](https://shepherd-agents.ai/blog/) ·
[Docs](https://docs.shepherd-agents.ai/) ·
[Upstream code](https://github.com/shepherd-agents/shepherd) ·
[Experiments](https://github.com/shepherd-agents/shepherd-experiments)

[![Original Shepherd paper teaser: a meta-agent creates, observes, intercepts, reverts, and forks a worker trace](https://shepherd-agents.ai/assets/teaser.png)](https://shepherd-agents.ai/assets/teaser.mp4)

_Watch the [original Shepherd teaser video](https://shepherd-agents.ai/assets/teaser.mp4). The image,
video, and results shown above belong to the upstream paper project; they explain the target and
are not benchmark claims for this TypeScript implementation._

## What this project covers

Shepherd makes agent execution durable, inspectable, and transformable. Four primitives define the
paper's programming model:

| Primitive | TypeScript target |
| --- | --- |
| **Task** | A typed, substitutable agent value that can be passed, returned, revised, or synthesized |
| **Effect** | A typed intent/outcome boundary that can be observed, intercepted, replayed, or compensated |
| **Scope** | An isolated agent-and-environment region with `emit`, `fork`, `merge`, and `discard` |
| **Trace** | An immutable, content-addressed execution graph that supports historical access, rewind, and suffix replay |

Complete coverage includes the paper's runtime supervisor, counterfactual replay optimization,
meta-agent-guided Tree-RL, trajectory compression, performance protocol, and formal proof-envelope
claim boundary. Every area has an owner and acceptance evidence in the
[section-by-section coverage map](./.plan/paper-coverage.md).

Coverage is earned in explicit levels so planned behavior is never presented as shipped:

| Level | Meaning | Status |
| --- | --- | --- |
| L0 | Canonical schemas, identities, trace storage, and projections | Complete |
| L1 | Shepherd `0.3.0` settlement compatibility | Complete in 1.51.0 |
| L2 | Scope and versioned-world substrate parity | Planned |
| L3 | Paper programming-model parity | Planned |
| L4 | Production security, recovery, performance, packaging, and releases | Planned |

Naming, MIT licensing, ESM package exports, and installed consumer compatibility are defined.
Publication remains disabled until registry ownership and release checks are complete.

## Current capability

Version `2.0.1` provides versioned task, effect, provider, run-outcome, run-artifact, run-usage, and
trace-record contracts with durable SQLite task and trace stores:

- deterministic recursive object-key ordering;
- kernel ABI v0 `RecordBody` and `RecordEnvelope` types;
- domain-separated canonical v2 record identifiers;
- ordered causal-parent and witness identity;
- runtime body and envelope validation;
- append batches with backward-only local causal references;
- known-parent validation and owner-local ordinal allocation;
- atomic SQLite append transactions with numbered migrations;
- append-intent idempotency, conflict detection, and rollback-safe retry;
- exact-record and ordered owner-path reads;
- content-addressed blob writes, verified reads, and durable storage receipts;
- complete registered-blob integrity reports with corruption classification;
- inspect-first, lock-protected collection of unregistered blob objects and temporary files;
- immutable published owner-prefix cuts with verified resolution;
- causal-closure and owner-prefix slices with mode filters, visibility, anchors, and witness
  support;
- configured execution lifecycle, relation, published-data, and effective-history projections;
- whole-store integrity verification and read-only append recovery diagnosis;
- deterministic native trace export and validated pristine-store import without identity changes;
- configured root-witness bootstrap through `ROOT_WITNESS_ID`;
- fail-closed, immutable protocol configuration with centralized store constants;
- descriptor-safe closed draft validation, immutable body snapshots, and record views outside
  semantic identity;
- JSON Schema contracts and pinned implementation-neutral fixtures;
- immutable bodyless task descriptors with inferred runtime input/output schemas and exact
  content-addressed artifact locks;
- durable exact task-version registration, idempotent replay, conflict detection, and verified
  resolution across registry restarts;
- immutable typed effect intent/outcome records with configured reversibility tiers and exact
  content-bound intent correlation;
- immutable ordered exact-kind effect handler stacks with configured last-matching precedence;
- a configured executable Core-A typed-effect trace machine with pinned Core-0/Core-A conformance
  vectors, completed-versus-prefix validation, and fail-closed malformed-evidence rejection;
- frozen proof-envelope classification with allowlisted, pinned-oracle static
  lowering evidence, exact theorem-metadata identity, fail-closed Core-0H sidecar admission, and
  explicit production-runtime non-claims;
- protected workspace initialization with configured `none`, `git-head`, and `worktree` baseline
  citations, no implicit Git history mutation, exact reuse, and fail-closed control metadata;
- stable canonical workspace binding identities with containment and overlap rejection;
- workspace protocol v20 repository-aware binding authorities with exact Git worktree evidence,
  stable order-independent resource identity, linked-worktree/common-repository refusal, and
  multi-repository Git custody without nested control metadata;
- workspace protocol v21 explicit per-binding repository task-grant companion artifacts, exact
  multi-resource admission plans, non-amplifying whole-run ceilings, advisory read/write capability
  enforcement, stale-resource refusal, and exact journaled recovery identity;
- trace-only durable scope registration: content-addressed root and child scopes, exact
  parent origin cuts, per-resource attenuation of parent, request, and whole-run ceiling,
  single-writer monotonic fencing, globally idempotent emission of validated application data,
  reconstructed inspection after reopen or import, and store schema v9 integrity checks;
- reference-copy scope fork of one bound resource: verified fixed origins, a prepared journal
  record before physical custody, verified completion under the parent fence, honest checkpoint
  descriptors, receipt-based restart convergence, and atomic multi-scope writer claims;
- consume-once scope merge and discard: three-way world plans with overlap refusal, a single
  terminal winner, verified publication into parent-managed custody, exact selected-history
  contributions without common-origin re-addition, subtree sealing that preserves the current
  parent, custody cleanup from retained identities, and receipt-based recovery;
- a read-only spawn/adopt/abandon/publish vocabulary mapping over exact scope evidence;
- bounded parallel and nested scope scheduling with deterministic settlement and restart
  convergence, plus record-derived recovery classification of every live scope;
- workspace protocol v22 content-addressed macOS/Linux/native-Windows/WSL platform evidence,
  advisory/auto placement resolution with visible fallback, exact placed capture/recovery, and
  fail-closed explicit jail refusal without a native-sandbox claim;
- workspace protocol v23 authenticated macOS Seatbelt and Linux/WSL Landlock probes, exact
  grant-to-writable-root lowering, structured shell-free native commands, bounded output and
  timeout/cancellation, process-group quiescence receipts, journal-v12 recovery, and no automatic
  retry after uncertain process start;
- workspace protocol v24 bounded portable path-conflict evidence, exact durable three-way
  application plans, path-disjoint retained-world `apply`, protected merged-revision custody,
  consume-once terminal citations, and concurrent/fresh-process recovery;
- workspace protocol v25 receipt-only retained-world release with current-parent basis witnesses,
  preserved readable custody, consume-once terminal citations, and interruption/concurrency/
  fresh-process recovery;
- a configured reference copy carrier with immutable verified revisions, isolated mutable custody,
  restart reopen, drift verification, deterministic parent-linked custody capture, and exact
  idempotent discard;
- workspace protocol v18 configured protected-path validation with Unicode/case normalization,
  alternate-name and symlink-alias refusal, stable versioned errors, and enforcement across copy,
  Git, inspection, selection, discard, and recovery seams;
- workspace protocol v19 configured platform inspection, fail-closed ACL/xattr/resource-fork/
  alternate-stream detection, portable case-collision and `core.symlinks=false` refusal,
  sparse-index evidence, stable deterministic custody faults, and receipt-safe recovery;
- a closed workspace-protocol-v7 retained-world runner registration with a private callback
  registry and an honest initial advisory enforcement classification;
- authenticated invocation-fenced task-world execution over isolated custody, with successful
  immutable capture, canonical changesets, ordered durable capture journaling, restart-safe
  inspection, command-authorized pre-execution recovery, deterministic custody convergence,
  terminal-cut repair, cooperative partial-world cancellation retention, competing-recovery
  fencing, fail-closed uncertain execution, and atomic terminal-cut world evidence;
- Git-aware `git-head` and `worktree` basis custody with exact index receipts, independently
  retained Git objects, sparse/ignore evidence, linked-worktree identity, basis-movement checks,
  and isolated restart-safe retained output;
- workspace protocol v12 exact retained-output settlement requests, workspace protocol v13
  deterministic operation/receipt codecs, workspace protocol v14 closed selection plan/step/
  publication codecs, workspace protocol v15 dependency-ordered publication schedules, workspace
  protocol v16 scheduled step/terminal-receipt evidence, workspace protocol v17 cut-bounded
  execution-trace settlement citations, workspace protocol v18 protected control-path
  enforcement, authenticated immutable-head selection staging,
  scheduled reference-carrier materialization and prefix recovery, public exact-ID
  selection with two pre-write basis checks and terminal repair, authenticated terminal/cut/
  carrier evidence preparation, trace-store schema v6 consume-once admission, and schema v7
  effect-journal storage with atomic deterministic operation/receipt transitions, one-winner
  conflict detection, exact restart replay, fail-closed read-only settlement inspection, and
  terminal-before-cleanup public discard recovery;
- immutable copy-world changesets with carrier-verified revision citations, canonical reconstructive
  add/delete/modify/replace operations, configured resource limits, and deterministic identity;
- immutable finished, failed, exhausted, and cancelled run outcomes with exact task-lock
  provenance;
- immutable ordered text/blob run artifacts and aggregate run-usage records correlated by run ID;
- a configured normative run-lifecycle transition matrix with versioned continuation, waiting,
  suspension, and resumed-running evidence schemas;
- cooperative run controls with configured counter/duration budgets and caller cancellation;
- a provider-neutral structured invocation contract with ordered text/blob artifact definitions
  and a deterministic exact-cassette static provider;
- offline bodyless task execution with exact schema validation, usage accounting, budgets,
  cancellation, ordered artifact assignment, and terminal-result normalization;
- durable task execution with configured lifecycle records, ordered artifacts, verified blob
  receipts, aggregate usage, exact terminal outcomes, deterministic append replay, immutable
  terminal cuts, restart-safe recovery classification, exact committed-result reconstruction,
  command-authorized creation resume and cut repair, cross-connection first-writer leases, and
  stale-writer fencing;
- read-only durable execution inspection with configured recovery status, lifecycle, artifact,
  usage, and outcome record identities, immutable terminal cuts, canonical causal edges, and
  cut-bound waiting/suspension evidence, plus exact import-safe terminal settlement citations;
- bounded retained-output citation, published-cut trace-revision, and durable recovery-record
  list/show projections with exact/prefix/latest reads, generated closed schemas, post-cut
  exclusion, and native import/fresh-process reconstruction;
- bounded orphaned-operation diagnosis plus globally idempotent exact bookkeeping repair with
  externally proven session death, live/provider/scope refusal, durable command/receipt evidence,
  interruption and concurrent retry convergence, and fail-soft pre-run reclaim;
- a configured distinct `shepherd-ts` executable with preserved bounded human help/output,
  protocol-versioned canonical JSON, generated command/schema references, protected
  initialization, read-only run/task/trace/trace-revision/output/changeset/vcs-core views, exact
  settlements and repair, a checked-in installed-package offline quickstart, and stable
  fenced/unavailable error envelopes;
- globally idempotent durable recovery commands with canonical command evidence, expired-lease
  takeover, command-bound start/cut transitions, and fail-closed absent/started handling;
- globally idempotent pause requests bound atomically to the exact current started lifecycle head,
  invocation fencing token, run, reason, and command content without claiming suspension;
- configured checkpoint constituent adapters and atomic command-authorized suspension
  acknowledgement that publishes continuation evidence, releases the worker claim, and fences
  stale terminal publication;
- prerequisite-driven waiting acknowledgement that publishes cut-bound continuation and
  prerequisite evidence while atomically releasing and fencing the worker;
- globally idempotent resume commands bound to the exact waiting or suspension acknowledgement
  and continuation descriptor, with guarded prerequisite-satisfaction evidence for waiting,
  unavailable-evidence rejection, atomic monotonic fencing, and a command-bound running
  acknowledgement;
- globally idempotent direct cancellation from created, waiting, and suspended lifecycle heads,
  with atomic exact-head comparison, inactive-worker proof, terminal publication, claim expiry,
  deterministic replay, and stale-worker fencing;
- Node-native TypeScript execution and tests.

The implementation preserves Unicode code points as supplied. It does not normalize Unicode.
Durable recovery serializes concurrent first admission and safely reclaims only expired pre-start
claims through an explicit command. Ordinary durable execution does not advance retained
incomplete evidence. A retained start remains fail-closed because provider execution is not yet
replay-safe.

## Requirements

Version 2.0.0 narrows Node support to the approved range below and rejects unsupported runtimes
before storage setup. See [runtime support](./docs/runtime-support.md) for the breaking-change,
capability checks and verification policy. Public storage formats are unchanged.

- Node.js >=24.12.0 <25
- pnpm 10

## Install

```sh
pnpm install
```

The source CLI runs with `node src/cli/main.ts`; built/package consumers use `shepherd-ts`.
Run `shepherd-ts --help` for human help or add `--json` for the stable
`shepherd.cli.json.v1` envelope. See the [generated command reference](./docs/generated/cli-reference.md)
and [machine-output schema](./spec/schemas/cli-output-v1.schema.json).

Emit and run the deterministic installed-package walkthrough with:

```sh
shepherd-ts demo write quickstart > quickstart.mjs
node quickstart.mjs
```

See the [offline retained-output quickstart](./docs/quickstart.md).

For a typed source-file edit using the domain facades, see the
[packaged TypeScript retained-coding example](./docs/typescript-examples.md). It verifies original
workspace bytes before selection and durable selected evidence after reopening.
The same guide includes a repeatable read-only review of an existing retained output with bounded
previews and verification that workspace and trace evidence remain unchanged.
It also demonstrates independent captures and settlements across disjoint bindings, checking
sibling files after each selection.
The custom-effect example covers exact-kind handler precedence, outcome correlation, and failure
handling for non-durable in-process dispatch.
Use `createTypedEffectHandler` to infer and validate a callback payload from a package-created
schema; the returned handler composes with the existing effect stack.
Use `schema.fromJSONSchema` for dynamic documents in the supported string/null/strict-object
subset; it returns an authenticated schema with an honest unknown result type.
The [Python-to-TypeScript migration guide](./docs/python-to-typescript.md) maps the pinned upstream
examples to these programs and identifies adapted and unsupported behavior.

## API

The package is ESM-only. Supported entries are `.`, `./canonical`, `./cli`, `./effects`,
`./providers`, `./read`, `./runs`, `./scopes`, `./tasks`, `./trace`, and `./workspace`; see
[Package exports and module policy](./docs/package-exports.md). The checked-in and packaged
[generated API reference](./docs/generated/api-reference.md) lists every supported symbol,
signature, JSDoc contract, runtime requirement, and authority note; its
[generation policy](./docs/api-reference.md) defines drift and privacy checks. CommonJS must use
dynamic `import()`, and undeclared deep imports are unsupported.

For browser-facing TypeScript, use `import type { Slice }` from
`@avnionur/shepherd-typescript/read`. The [web-safe read entry](./docs/web-safe-read-types.md)
exposes existing readonly trace data without Node declarations, runtime values, or storage
authority. It does not validate or redact data and does not make other entries browser-safe.

On Node, `store.iterateCutRecords(cutId)` lazily yields owner-record occurrences through a
published cut without retaining a database cursor across pulls. See
[trace iteration and integrity limits](./docs/trace-queries.md#async-owner-record-iteration).

```ts
import {
    acknowledgeDurableTaskSuspension,
    captureRunContinuationCheckpoints,
    canonicalizeRecord,
    createEffectHandlerStack,
    createEffectIntent,
    createEffectOutcome,
    createRecordEnvelope,
    createRecordId,
    createRunOutcome,
    createRunArtifact,
    createRunControl,
    createRunUsage,
    createStaticProvider,
    executeTask,
    executeTaskDurably,
    captureTaskWorldDurably,
    inspectDurableTaskExecution,
    isPublicError,
    planAppendBatch,
    ROOT_WITNESS_ID,
    readDurableTaskExecution,
    recoverTaskDurably,
    recoverTaskWorldDurably,
    requestDurableTaskPause,
    resumeDurableTask,
    schema,
    SQLiteTaskRegistry,
    SQLiteTraceStore,
    task,
    validateEffectCorrelation,
} from "./src/index.ts";

const writeNote = task({
    name: "writeNote",
    version: "1.0.0",
    instruction: "Write one note about the topic.",
    input: schema.object({ topic: schema.string() }),
    output: schema.void(),
});
writeNote.parseInput({ topic: "Shepherd" });
writeNote.artifactLock;

using taskRegistry = new SQLiteTaskRegistry("tasks.sqlite");
const registration = taskRegistry.register(writeNote);
taskRegistry.resolve({
    taskId: registration.artifactLock.task_id,
    version: registration.artifactLock.task_version,
});

const intent = createEffectIntent({
    effectId: "effect:tool:1",
    kind: "tool.call",
    payload: { command: "pnpm test" },
    reversibility: "irreversible",
});
const effectOutcome = createEffectOutcome(intent, {
    ok: true,
    value: { exitCode: 0 },
});
validateEffectCorrelation(intent, effectOutcome);

const handlers = createEffectHandlerStack([
    {
        handlerId: "fallback.tool",
        kind: "tool.call",
        handle: () => ({ ok: true, value: null }),
    },
    {
        handlerId: "local.tool",
        kind: "tool.call",
        handle: (current) => ({ ok: true, value: current.effect_id }),
    },
]);
await handlers.dispatch(intent);

const runOutcome = createRunOutcome({
    runId: "run:write-note:1",
    taskArtifactLock: writeNote.artifactLock,
    outcome: { status: "finished", value: null },
});

const runArtifact = createRunArtifact({
    runId: "run:write-note:1",
    artifactOrdinal: 0,
    kind: "report",
    name: "note.txt",
    content: { type: "text", text: "Shepherd records execution as data." },
    metadata: { media_type: "text/plain" },
});

const runUsage = createRunUsage({
    runId: "run:write-note:1",
    inputTokens: 120,
    outputTokens: 30,
    cacheCreationInputTokens: 10,
    cacheReadInputTokens: 80,
    costUsd: 0.0042,
});

const runControl = createRunControl({
    budget: {
        maxTurns: 20,
        maxEffects: 100,
        maxDurationMilliseconds: 30_000,
        maxInputTokens: 20_000,
        maxOutputTokens: 4_000,
        maxCostUsd: 1,
    },
});
runControl.consume({ turns: 1, inputTokens: 500, outputTokens: 100, costUsd: 0.02 });
const statusTask = task({
    name: "status",
    version: "1.0.0",
    instruction: "Return one status word.",
    input: schema.object({ state: schema.string() }),
    output: schema.string(),
});
const staticRequest = {
    instruction: statusTask.instruction,
    input: { state: "ready" },
    outputSchema: statusTask.artifact.output_schema,
};
const staticProvider = createStaticProvider({
    descriptor: { id: "readme-fixture", model: "offline-v1" },
    exchanges: [{
        request: staticRequest,
        response: {
            output: "ready",
            usage: {
                cacheCreationInputTokens: 0,
                cacheReadInputTokens: 0,
                costUsd: 0,
                inputTokens: 4,
                outputTokens: 1,
            },
        },
    }],
});
const execution = await executeTask({
    task: statusTask,
    input: { state: "ready" },
    provider: staticProvider,
    runId: "run:status:1",
    budget: { maxTurns: 1, maxInputTokens: 4, maxOutputTokens: 1 },
});
execution.outcome;
execution.usage;
runControl.snapshot();
runControl.dispose();

const record = { operation: "task.started", ordinal: 1 };

canonicalizeRecord(record);
// {"operation":"task.started","ordinal":1}

createRecordId(record);
// sha256:<digest>

createRecordEnvelope({
    body: { operation: "task.started" },
    mode: "capture",
    schema_ref: "example.task-event.v1",
    witness_ref: "sha256:<64 lowercase hexadecimal characters>",
});
// { record_id, digest, schema_ref, mode, witness_ref, caused_by_record_ids }

planAppendBatch({
    groups: [{
        owner_id: "run:example",
        records: [{
            body: { operation: "task.started" },
            mode: "capture",
            schema_ref: "example.task-event.v1",
            witness_ref: "sha256:<64 lowercase hexadecimal characters>",
        }],
    }],
});
// { records, causal_edges, owner_ordinal_ranges, next_owner_ordinals }

using store = new SQLiteTraceStore("trace.sqlite");
const durableProvider = createStaticProvider({
    descriptor: { id: "durable-readme-fixture", model: "offline-v1" },
    exchanges: [{
        request: staticRequest,
        response: {
            output: "ready",
            usage: {
                cacheCreationInputTokens: 0,
                cacheReadInputTokens: 0,
                costUsd: 0,
                inputTokens: 4,
                outputTokens: 1,
            },
        },
    }],
});
const durableExecution = await executeTaskDurably(store, {
    task: statusTask,
    input: { state: "ready" },
    provider: durableProvider,
    runId: "run:status:durable",
    budget: { maxTurns: 1 },
});
store.projectExecution(durableExecution.ledger.cut.cut_id);
const durableRecovery = readDurableTaskExecution(store, "run:status:durable");
if (durableRecovery.status === "committed") {
    durableRecovery.result.execution.outcome;
}
const durableInspection = inspectDurableTaskExecution(store, "run:status:durable");
durableInspection.causal_edges;
const recoveredExecution = await recoverTaskDurably(store, {
    commandId: "command:recover:status",
    execution: {
        task: statusTask,
        input: { state: "ready" },
        provider: durableProvider,
        runId: "run:status:durable",
        budget: { maxTurns: 1 },
    },
});
recoveredExecution.command.record_id;
const receipt = store.append({
    append_intent_id: "append:example:1",
    batch: {
        groups: [{
            owner_id: "run:example",
            records: [{
                body: { operation: "task.started" },
                mode: "capture",
                schema_ref: "example.task-event.v1",
                witness_ref: ROOT_WITNESS_ID,
            }],
        }],
    },
});

store.readRecord(receipt.record_ids[0]);
store.readOwner("run:example");

const blobReceipt = store.putBlob(new TextEncoder().encode("retained output"));
store.readBlob(blobReceipt.blob_id);
store.verifyBlobs();
store.collectBlobOrphans();
store.verifyIntegrity();
store.diagnoseAppend("append:example:1");
const archiveJson = store.exportTrace();

using importedStore = new SQLiteTraceStore("imported.sqlite");
importedStore.importTrace(archiveJson);

const cut = store.publishCut({
    cut_id: "cut:example",
    target_owner_id: "run:example",
    through_record_id: receipt.record_ids[0],
});
store.resolveCut(cut.cut_id);
store.readCausalClosure(receipt.record_ids);

// For a cut whose owner uses the configured Shepherd lifecycle schemas:
store.projectExecution(cut.cut_id);
store.projectEffectiveHistory(cut.cut_id);
```

Only JSON-compatible semantic values are accepted. Undefined object properties are omitted;
undefined array elements, non-finite numbers, accessors, symbol properties, class instances, and
cycles are rejected.

## Development

```sh
pnpm test
pnpm typecheck
pnpm lint
pnpm check:protocol
pnpm build
pnpm verify
pnpm verify:serial
```

Biome provides formatting and linting. Node's built-in test runner executes TypeScript directly.
The test command enforces 100% line, branch, and function coverage for runtime source. The serial
verification variant retains the same gates while avoiding native-probe process contention on the
Windows CI runner. TypeScript builds declarations and JavaScript into `dist/`.

Package-script entry points under `scripts/` are thin command adapters. Tested build, generation,
release, and conformance implementations live under `tooling/`. The production compiler includes
only `src/`, so repository tooling is typechecked but is not emitted into `dist/`.

Release versions are configured in `release-config.yaml`. After changing the version, run
`pnpm sync:version` to update every configured JSON manifest.

Protocol modes, identifier shape, append defaults, interchange versions, and generated schemas are
configured in `protocol.config.json`. After changing them, run `pnpm generate:protocol`; the
`pnpm verify` command rejects stale generated artifacts. Critical hash, ordinal, migration,
root-witness, and SQLite durability settings are validated before runtime or generator side
effects.

## Contributing and security

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development and review requirements and
[SECURITY.md](./SECURITY.md) for private vulnerability reporting and the supported security
boundary. Participation is governed by the [Code of Conduct](./CODE_OF_CONDUCT.md).

## Documentation

- [Documentation index](./docs/README.md)
- [Command-line interface](./docs/cli.md)
- [Project structure](./docs/project-structure.md)
- [Reference copy carrier](./docs/reference-copy-carrier.md)
- [Repository grants and run authority ceilings](./docs/repository-grants.md)
- [Durable scope registration and fenced local emission](./docs/scope-registration.md)
- [Reference-copy scope fork and restart recovery](./docs/scope-fork.md)
- [Consume-once scope merge and discard](./docs/scope-merge-discard.md)
- [Scope vocabulary mapping](./docs/scope-vocabulary.md)
- [Scope scheduling and recovery classification](./docs/scope-scheduling.md)
- [Scope algebra laws](./docs/scope-laws.md)
- [Placement resolution and reporting](./docs/placement-resolution.md)
- [Native jail execution](./docs/native-jail-execution.md)
- [Retained-world path-disjoint application](./docs/retained-world-application.md)
- [Receipt-only retained-world release](./docs/retained-world-release.md)
- [Naming and licensing](./docs/naming-and-licensing.md)
- [Implementation plan](./.plan/README.md)
- [Paper coverage map](./.plan/paper-coverage.md)
- [Compatibility and parity matrix](./.plan/parity-matrix.md)
- [Progress tracker](./.plan/tracker.md)
- [Pinned upstream baseline](./.plan/upstream-baseline.md)
- [Canonical record contract](./docs/canonical-records.md)
- [Record body and envelope contract](./docs/record-envelope.md)
- [Append planning contract](./docs/append-planning.md)
- [SQLite trace store](./docs/sqlite-trace-store.md)
- [Content-addressed blob storage](./docs/blob-storage.md)
- [Blob orphan collection](./docs/blob-orphan-collection.md)
- [Trace cuts and causal slices](./docs/trace-queries.md)
- [Execution-history projections](./docs/execution-history-projections.md)
- [Store integrity and append recovery](./docs/store-integrity-and-recovery.md)
- [Native trace interchange](./docs/trace-interchange.md)
- [Task descriptors](./docs/task-descriptors.md)
- [Task registry](./docs/task-registry.md)
- [Effect intent/outcome records](./docs/effect-records.md)
- [Ordered effect handlers](./docs/effect-handlers.md)
- [Structured public errors](./docs/public-errors.md)
- [Source maps, stacks, and causes](./docs/source-maps-and-causes.md)
- [Run outcomes](./docs/run-outcomes.md)
- [Run artifacts and usage](./docs/run-artifacts-and-usage.md)
- [Run budgets and cancellation](./docs/run-control.md)
- [Run lifecycle protocol](./docs/run-lifecycle-protocol.md)
- [Provider contract and static provider](./docs/static-provider.md)
- [Offline task execution](./docs/task-execution.md)
- [Durable task execution](./docs/durable-task-execution.md)
- [Durable execution inspection](./docs/durable-execution-inspection.md)
- [Task and run ledger projections](./docs/task-run-ledgers.md)
- [Output citations, trace revisions, and recovery records](./docs/output-trace-recovery-records.md)
- [Orphaned operation diagnosis and repair](./docs/orphan-operation-repair.md)
- [Durable execution control](./docs/durable-execution-control.md)
- [Protocol configuration](./docs/protocol-configuration.md)
- [Trace kernel vocabulary](./CONTEXT.md)
- [Changelog](./CHANGELOG.md)

## Status

The [Phase 5 exit audit](https://github.com/avnionur/shepherd-typescript/blob/main/.plan/phase-5-exit-audit.md) maps delivered product-surface evidence.
Phase 5 is complete through the approved 2.0.0 runtime-support remedy. Phase 6 follows the
[scope ownership/authority proposal](https://github.com/avnionur/shepherd-typescript/blob/main/.plan/scope-ownership-contract.md);
[trace-only scope registration](./docs/scope-registration.md),
[reference-copy scope fork](./docs/scope-fork.md), and
[consume-once merge and discard](./docs/scope-merge-discard.md), and the
[scope vocabulary mapping](./docs/scope-vocabulary.md), and
[scope scheduling](./docs/scope-scheduling.md) are implemented. Optimized carriers and L2 parity
are not. The major version does not
imply production readiness.

The project is at **L1-alpha**. Phases 0–2 provide the canonical trace kernel, deterministic offline
execution, durable lifecycle/control evidence, and conservative formal-claim boundary. Phase 3 now
provides the complete P0 retained-world settlement loop through public TypeScript APIs: isolated
task-world capture, authenticated changeset inspection, consume-once preparation, moved-basis
refusal, exact selection, parent-preserving discard, terminal trace citations, protected control
paths, and restart recovery.

The [Phase 3 status](./docs/phase-3-l1-alpha.md) and
[exit audit](./.plan/phase-3-exit-audit.md) map each criterion to repeatable production-seam
evidence. Phase 4 now completes the L1 documented compatibility package, including the offline
quickstart and safe publication compatibility. Live-provider adapters, scopes, supervision,
replay, and paper applications remain later work.
Phase 4 now includes exact named multi-repository resources, explicit read-only/read-write task
grants, a whole-run ceiling, honest advisory/auto placement reporting, authenticated native
filesystem-write jails for capable macOS Seatbelt and Linux/WSL Landlock hosts, and path-disjoint
three-way retained-world application, receipt-only release, bounded task/run ledgers,
cut-bounded output-citation/trace-revision/recovery-record read selectors, and public exact
orphaned-operation repair plus configured human CLI groups and stable JSON/reference artifacts.
The [Phase 4 exit audit](./.plan/phase-4-exit-audit.md) records the complete installed-package and
CLI compatibility evidence. Native Windows,
simultaneous multi-world runner access, network/read isolation, and the remaining documented run
surface are not implemented.

The [package policy](./docs/package-exports.md#installed-import-loading) now records verified
per-entry Node module loading. Narrow imports avoid SQLite/process support where documented;
filesystem configuration remains required for those runtime entries. The type-only `/read` entry
has no runtime dependencies. The same policy documents tested Rollup Node
tree-shaking fixtures and their required configuration-asset layout.

## Attribution

The design is informed by the MIT-licensed
[Shepherd project](https://github.com/shepherd-agents/shepherd) and its
[research paper](https://arxiv.org/abs/2605.10913), _Shepherd: Enabling Programmable Meta-Agents
via Reversible Agentic Execution Traces_, by Simon Yu, Derek Chong, Ananjan Nandi, Dilara Soylu,
Jiuding Sun, Christopher D. Manning, and Weiyan Shi. Compatibility claims are tracked explicitly;
complete paper-level behavior is the project target, not a claim about the current release. The
[paper coverage map](./.plan/paper-coverage.md) records the implementation and evidence required
before that claim can be made.

Original repository work is available under the [MIT License](./LICENSE). See [NOTICE](./NOTICE)
for upstream attribution and reuse boundaries.
