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
| L0 | Canonical schemas, identities, trace storage, and projections | In progress |
| L1 | Documented Shepherd `0.3.0` settlement behavior | Planned |
| L2 | Scope and versioned-world substrate parity | Planned |
| L3 | Paper programming-model parity | Planned |
| L4 | Production security, recovery, performance, packaging, and releases | Planned |

Naming and MIT licensing are defined, but publication remains disabled until package exports,
consumer compatibility, and release checks are complete. Current examples import the source entry
point for repository development only.

## Current capability

Version `0.19.0` provides versioned task, effect, provider, run-outcome, run-artifact, run-usage, and
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
- immutable finished, failed, exhausted, and cancelled run outcomes with exact task-lock
  provenance;
- immutable ordered text/blob run artifacts and aggregate run-usage records correlated by run ID;
- cooperative run controls with configured counter/duration budgets and caller cancellation;
- a provider-neutral structured invocation contract and deterministic exact-cassette static
  provider;
- Node-native TypeScript execution and tests.

The implementation preserves Unicode code points as supplied. It does not normalize Unicode.

## Requirements

- Node.js 24 or newer
- pnpm 10

## Install

```sh
pnpm install
```

## API

```ts
import {
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
    planAppendBatch,
    ROOT_WITNESS_ID,
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
const staticRequest = {
    instruction: "Return one status word.",
    input: { state: "ready" },
    outputSchema: { type: "string" },
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
await staticProvider.invoke(staticRequest, runControl.signal);
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
```

Biome provides formatting and linting. Node's built-in test runner executes TypeScript directly.
The test command enforces 100% line, branch, and function coverage for runtime source. TypeScript
builds declarations and JavaScript into `dist/`.

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
- [Project structure](./docs/project-structure.md)
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
- [Run outcomes](./docs/run-outcomes.md)
- [Run artifacts and usage](./docs/run-artifacts-and-usage.md)
- [Run budgets and cancellation](./docs/run-control.md)
- [Provider contract and static provider](./docs/static-provider.md)
- [Protocol configuration](./docs/protocol-configuration.md)
- [Trace kernel vocabulary](./CONTEXT.md)
- [Changelog](./CHANGELOG.md)

## Status

The project is currently at L0. Phase 0 governance and the Phase 1 canonical record, append
planning, SQLite durability, blob storage, trace-cut, causal-slice, execution-history projection,
integrity, recovery, native interchange, and blob-orphan collection contracts are implemented.
Phase 2 now includes bodyless task descriptors, runtime schemas, artifact locks, durable exact task
registration, immutable correlated effect intent/outcome records, ordered exact-kind handler
dispatch, versioned terminal run-outcome records, ordered text/blob artifact records, and aggregate
run-usage records. Configured run controls now enforce cooperative counter/duration budgets and
caller cancellation. A provider-neutral structured request/response boundary and deterministic
exact-cassette static provider are implemented. Dynamic handler scopes, offline task execution,
live-provider adapters, artifact persistence within the run ledger, settlement, scopes, live
supervision, replay, and the paper applications remain planned. The next TypeScript slice adds
offline task execution through the static provider.

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
