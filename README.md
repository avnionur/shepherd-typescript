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
| L2 | Scope and versioned-world substrate parity | Complete in 2.7.1 for the recorded hosts |
| L3 | Paper programming-model parity | Complete in 2.20.1 for the documented scope: live observation and interception (Phase 7) in 2.10.1, coupled checkpoints, rewind, and replay (Phase 8) in 2.15.1, and task-as-value meta-agents (Phase 9) in 2.20.1; research applications (Phase 10) complete in 2.25.1 for the documented offline scope |
| L4 | Production security, recovery, performance, packaging, and releases | Release candidate for the in-repo scope in 2.32.4 ([Phase 11 exit audit](https://github.com/avnionur/shepherd-typescript/blob/main/.plan/phase-11-exit-audit.md)); 1.0 general availability is no-go until the owner-owed items close: external security review, signed provenance and publication, hosted CI and cross-OS lanes, private vulnerability reporting, and the registry name |

Naming, MIT licensing, ESM package exports, and installed consumer compatibility are defined.
Publication remains disabled until registry ownership and release checks are complete. "1.0" is the
L4 maturity milestone, not a package version; see the [1.0 release notes](./docs/release-notes-1.0.md).

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
- workspace protocol v26 clone and Linux overlay carrier backends with identities equal to the copy
  reference, shared conformance and law suites, and branch storage that scales with changed data;
- evidence-derived checkpoint start classification proving whether a branch started from an atomic
  snapshot, a quiescent verified copy, or reconstructed state;
- bounded parallel and nested scope scheduling with deterministic settlement and restart
  convergence, plus record-derived recovery classification of every live scope;
- durable and ephemeral cursor trace subscriptions over exact owner paths: canonical
  owner-ordinal cursors, pull-driven backpressure with lag metrics and a declared overflow policy,
  monotonic acknowledgement retained outside the record graph, and reconnect without duplicated or
  lost acknowledged records;
- supervised effect interception: ordered allow/deny/replace/pause decisions retained before
  admission, declared fail-open/fail-closed timeout policy with irreversible tiers always failing
  closed, an irreversible approval frontier, fenced renewable decision leases, and restart
  classification that refuses to re-materialize an uncertain effect;
- human approval verdicts that race expiry with exactly one winner, cited context injection
  channels, and supervisor access to fenced durable-run pause, resume, and cancellation;
- durable replay sessions for deterministic programs: fenced step journals with runtime-derived
  prompt, prefix, and context prefix identities, cache-hit evidence, admission before
  materialization, and record-derived recovery classification;
- coupled checkpoints with coordinated multi-resource world images, provider-session and process
  adapter evidence, the irreversible-effect frontier, and honest atomic, reconstructive, or
  unavailable classification, including a cooperative process backend and an accurate transparent
  CRIU probe;
- verified rewind with byte-equivalent world restoration, replay that reconstructs the recorded
  prefix without provider or handler invocation and continues with a changed task, provider, or
  handler stack, policy-gated irreversible suffix effects, imported-archive replay, and divergence
  and dependency analysis;
- task values as data: canonical `{ artifact, artifact_lock }` values with lock re-derivation,
  descriptor rehydration through the task builder, and the `schema.task()` schema kind published
  as a JSON Schema reference;
- durable child run handles on command-derived reserved owner paths: opened and completion
  records, provider- and program-serviced children under derived durable run identities, idempotent
  commands with head comparison, record-derived status, and inspection stable across reopen and
  import;
- record-proven delegated authority: resource attenuation through the scope rule, budget
  attenuation, root declarations, bounded parent-handle chains with origin cuts, and inspection that
  re-derives effective authority and refuses amplification;
- supervisor operations over child run handles: observation through trace subscriptions, ordered
  cited context injections folded into the composed provider request under a consumption record,
  fenced supervisor handoff, terminal accept and discard decisions, and retry successors citing
  the discarded predecessor, its decision, and the causal replay point;
- declared, revised, and synthesized task provenance with supervisor approval before a
  model-generated task value runs, canonical-form refusal of definitions that carry code or foreign
  schema references, and revision retries with explicit revised identity;
- typed result threading: accepted outputs re-validated against the retained output schema with
  digest proof and caller-schema equality, bounded delegation trees under a handle or supervisor
  root, and nested meta-agents whose records, authority, and values never leak into the root;
- research application manifests: content-addressed application protocol definitions, command-
  derived reserved application owner paths, and digest-bearing manifests citing protocol surfaces
  and produced artifacts by digest with measured costs, retained with a terminal cut and
  inspectable on reopened, read-only, and imported stores
  ([application manifests](./docs/application-manifests.md));
- the two-worker coding supervisor (Appendix E) over child run handles: isolated world custody
  through a caller-supplied adapter or the scope world adapter, path-overlap conflict
  classification, inject, handoff, and discard-and-restart from a clean fork with retained evidence
  citing exact records and receipts, exactly one accepted and merged worker, and crash recovery
  through the documented cancellation path ([coding supervisor](./docs/coding-supervisor.md));
- the counterfactual workflow optimizer (Appendix F) over replay sessions: a recorded baseline,
  candidate edits of the declarable change dimensions replayed only over the affected suffix of
  their parent's trace, a divergence proof, a caller-supplied evaluation gate, candidate lineage,
  a single terminal promotion, and a measured `full_replay` comparison by provider calls and cache
  reads ([counterfactual optimization](./docs/counterfactual-optimization.md));
- Appendix D trajectory compression over replay sessions: a delegated compressor proposing a
  fork point and hint validated against the closed compression grammar and the retained prefix,
  restoration with `rewindReplaySession` and suffix replay under the hint, `no_prune` for a null
  fork point or an `unavailable` restore classification, a delegated verifier gating `pruned`
  against `restored`, a bounded seeded best-of-N control, and measured step-count ratios only
  ([trajectory compression](./docs/trajectory-compression.md));
- the §5.3 Tree-RL adapter over replay sessions: deterministic fork points selected from declared
  dependencies, seeded branched rollouts from each fork point under per-rollout static cassettes,
  a caller-supplied reward, intra- and inter-branch advantages over completed rollouts only, failed
  rollouts retained and excluded, and a canonical `jsonl_v1` training batch whose digest is
  identical across runs and after archive import ([Tree-RL adapter](./docs/tree-rl-rollouts.md));
- offline evaluation of every configured application against its baseline (`no_supervision`,
  `full_replay`, `no_compression`, `single_rollout`) into one measured-only, digest-bearing report
  with per-metric comparisons and published limitations, identical across runs, stores, and hosts,
  with a checked repository report ([application evaluation](./docs/application-evaluation.md),
  [generated report](./docs/generated/application-evaluation.md)); upstream headline results are
  not reproduced;
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

The package is ESM-only. Supported entries are `.`, `./applications`, `./canonical`, `./cli`, `./effects`,
`./delegation`, `./operations`, `./providers`, `./read`, `./replay`, `./runs`, `./scopes`,
`./supervision`, `./tasks`, `./trace`, and `./workspace`; see
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
pnpm check:compatibility
pnpm check:sbom
pnpm build
pnpm verify
pnpm verify:serial
pnpm verify:release
pnpm bench:kernel
pnpm check:slo
pnpm fuzz
pnpm test:soak --duration 600
pnpm test:faults:volume
```

`pnpm test` includes the default seeded fuzz tier and replays the regression corpus; `pnpm fuzz`
runs the extended tier (`--seed`, `--iterations`, `--target`, `--json`)
([fault and fuzz conformance](./docs/fault-and-fuzz-conformance.md)). `pnpm test` also runs the
kill/restart, disk-full, and corruption fault suites and a bounded soak; `pnpm test:soak` runs the
mixed soak for a wall-clock budget, and `pnpm test:faults:volume` fills a macOS disk image to
exercise real `ENOSPC` (both outside `pnpm verify`).

Biome provides formatting and linting. Node's built-in test runner executes TypeScript directly.
The test command enforces 100% line, branch, and function coverage for runtime source. The serial
verification variant retains the same gates while avoiding native-probe process contention on the
Windows CI runner. TypeScript builds declarations and JavaScript into `dist/`.

Package-script entry points under `scripts/` are thin command adapters. Tested build, generation,
release, and conformance implementations live under `tooling/`. The production compiler includes
only `src/`, so repository tooling is typechecked but is not emitted into `dist/`.

Release versions are configured in `release-config.yaml`. After changing the version, run
`pnpm sync:version` to update every configured JSON manifest, then refresh the version-bearing
evidence: `pnpm generate:api-reference`, `pnpm generate:sbom`, and
`pnpm update:compatibility-baseline`.

`pnpm verify` enforces the [compatibility policy](./docs/compatibility-policy.md): removed exports,
error codes, CLI commands, or schema branches, narrowed schemas, and removed or reordered
migrations fail with a precise message unless the configured deprecation window, classification,
and version bump allow them. `pnpm verify:release` additionally runs `pnpm check:slo` (kernel
benchmark budgets for the reference host class, [performance report](./docs/performance-report.md);
`pnpm bench:kernel` records a new artifact), builds and packs twice and requires
byte-identical tarballs, then writes a lockfile SBOM and an unsigned provenance statement into the
ignored `release/` directory ([release integrity](./docs/release-integrity.md)).

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
- [Threat model](./docs/threat-model.md)
- [Support policy](./docs/support-policy.md)
- [Incident response](./docs/incident-response.md)
- [Secrets and retention](./docs/secrets-and-retention.md)
- [Storage interfaces](./docs/storage-interfaces.md)
- [Backup, restore, and migration](./docs/backup-restore-and-migration.md)
- [Performance report](./docs/performance-report.md)
- [Observability](./docs/observability.md)
- [Fault and fuzz conformance](./docs/fault-and-fuzz-conformance.md)
- [Command-line interface](./docs/cli.md)
- [Project structure](./docs/project-structure.md)
- [Reference copy carrier](./docs/reference-copy-carrier.md)
- [Optimized scope-world carriers](./docs/optimized-carriers.md)
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
Phase 5 is complete through the approved 2.0.0 runtime-support remedy. Phase 6 is complete for its
documented scope: the
[Phase 6 exit audit](https://github.com/avnionur/shepherd-typescript/blob/main/.plan/phase-6-exit-audit.md)
maps [scope registration](./docs/scope-registration.md), [fork](./docs/scope-fork.md),
[merge and discard](./docs/scope-merge-discard.md), the
[vocabulary mapping](./docs/scope-vocabulary.md), [scheduling](./docs/scope-scheduling.md),
[laws](./docs/scope-laws.md), and [optimized carriers](./docs/optimized-carriers.md) to L2
substrate parity on the recorded hosts. The major version does not imply production readiness.
Phase 7 is complete for its documented scope: the
[Phase 7 exit audit](https://github.com/avnionur/shepherd-typescript/blob/main/.plan/phase-7-exit-audit.md)
maps [trace subscriptions](./docs/trace-subscriptions.md),
[supervised effect interception](./docs/supervised-effects.md), and
[approval, context, and worker control](./docs/supervision-control.md) to the live observation and
interception exit criteria. Phase 8 is complete for its documented scope: the
[Phase 8 exit audit](https://github.com/avnionur/shepherd-typescript/blob/main/.plan/phase-8-exit-audit.md)
maps [replay sessions](./docs/replay-sessions.md), [coupled checkpoints](./docs/coupled-checkpoints.md),
and [rewind and replay](./docs/rewind-and-replay.md) to the coupled checkpoint, rewind, and replay
exit criteria. Phase 9 is complete for its documented scope: the
[Phase 9 exit audit](https://github.com/avnionur/shepherd-typescript/blob/main/.plan/phase-9-exit-audit.md)
maps [task values and child run handles](./docs/task-values.md),
[delegated authority](./docs/delegated-authority.md),
[supervisor operations](./docs/supervisor-operations.md),
[task revision and synthesis](./docs/task-revision.md), and
[result threading and nested meta-agents](./docs/result-threading.md) to the task-as-value
meta-agent exit criteria and records L3 paper programming-model parity for the documented scope.
Phase 10 is complete for its documented offline scope: the
[Phase 10 exit audit](https://github.com/avnionur/shepherd-typescript/blob/main/.plan/phase-10-exit-audit.md)
maps [application manifests](./docs/application-manifests.md), the
[two-worker coding supervisor](./docs/coding-supervisor.md), the
[counterfactual workflow optimizer](./docs/counterfactual-optimization.md),
[trajectory compression](./docs/trajectory-compression.md), the
[Tree-RL adapter](./docs/tree-rl-rollouts.md), and
[application evaluation](./docs/application-evaluation.md) to the research application exit
criteria. Every figure is an offline measurement on synthetic fixtures; no upstream headline result
is reproduced. Phase 11 (production hardening and 1.0) is in progress: its
[threat model](./docs/threat-model.md), [support policy](./docs/support-policy.md), and
[incident response](./docs/incident-response.md) are published, and "1.0" names the L4 maturity
milestone, not a package version. [Secrets and retention](./docs/secrets-and-retention.md)
(2.27.0) adds opt-in secret refusal at append time, retention data classes, one-way redacted
exports, and owner-only SQLite file modes through the `./operations` entry and the trace store.
[Storage interfaces](./docs/storage-interfaces.md) (2.28.0) add blob-store and coordinator
contracts with conformance kits and local memory, filesystem, and SQLite reference adapters; the
SQLite trace store remains the only canonical append store.
[Backup, restore, and migration](./docs/backup-restore-and-migration.md) (2.29.0) adds verified
online backups with a digest-bearing manifest, non-destructive exact-manifest restore, replication
by compare-and-swap, the forward-only schema and downgrade policy, migration drills for every
historical store schema, and the `shepherd-ts store` command group. The
[performance report](./docs/performance-report.md) (2.30.0) publishes kernel benchmarks and SLO
budgets for the macOS arm64 APFS reference host only, alongside semantics-preserving store
maintenance (`SQLiteTraceStore.maintain`, `shepherd-ts store maintain`), query-plan tests with no
full table scans on hot paths, and a bounded scale tier.
[Observability](./docs/observability.md) (2.31.0) adds a passive, at-least-once
OpenTelemetry-compatible exporter: committed records become OTLP/JSON log records and run
lifecycles become spans with deterministic identifiers, bodies are withheld unless the retention
policy allows them, and a JSON-lines sink writes owner-only files for a collector. Telemetry is
never canonical and its timestamps are exporter observation times.
[Fault and fuzz conformance](./docs/fault-and-fuzz-conformance.md) (2.32.0) adds deterministic
seeded fuzzing of decoders, CLI argv, changesets, and helper protocols with a replayed regression
corpus, configured trace-archive input limits (`TraceArchiveLimitError`), and hardened Git
subprocess options and environment. From 2.33.0 the
[canonical value domain](./docs/canonical-records.md#nesting-bound) has a configured nesting bound
(`kernel.canonicalization.maxNestingDepth`, default 1,000) that refuses deeper values with
`CanonicalNestingLimitError` independently of the caller's stack depth. Its fault part (2.32.1) kills writers mid-operation, fills
the database and the disk, and corrupts store and backup files, classifying every outcome as
complete, retryable, refused, or detected, with a recorded long-duration soak.
The [Phase 11 exit audit](https://github.com/avnionur/shepherd-typescript/blob/main/.plan/phase-11-exit-audit.md)
(2.32.4) records the 1.0 readiness verdict: a release candidate for the in-repo scope, with no
unresolved critical or high internal finding, and 1.0 general availability no-go until the
owner-owed items close. No external security review has been performed, nothing is signed or
published, hosted CI is disabled, and performance budgets hold only for the macOS arm64 APFS
reference host. Its 2.33.1 close-out addendum records a local Docker Linux lane (every
`pnpm verify` gate on Node 24.21.0 and the 24.12.0 minimum), closes the in-repo Phase 11 scope,
and moves the owner-only items to
[#191](https://github.com/avnionur/shepherd-typescript/issues/191). The [1.0 release notes](./docs/release-notes-1.0.md) list what is delivered, the
known limits, and upgrade pointers.

Phase 3 reached **L1-alpha**. Phases 0–2 provide the canonical trace kernel, deterministic offline
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
