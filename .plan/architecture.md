# Target Architecture

## Architectural thesis

The system should be split into four layers:

```text
Shepherd dialect and SDK
        ↓
Execution runtime and supervision
        ↓
Versioned-world / sandbox substrate
        ↓
Content-addressed trace kernel
```

The kernel knows records, owners, cuts, slices, hashes, append transactions, and
projections. It does not know Claude, Git repository prompts, or CLI styling.

The world substrate knows bindings, snapshots, changesets, carriers,
materialization, merge, and discard. It does not decide how a task prompt is
constructed.

The runtime knows task execution, providers, effect handling, budgets,
cancellation, children, observation, interception, and replay.

The Shepherd dialect presents typed tasks, permissions, workspaces, runs,
settlement, and meta-agent operations.

## Shared protocol

`spec/` is authoritative for both implementations. It contains:

- JSON Schema 2020-12 documents for persistent/wire data;
- normative Markdown state-machine definitions;
- canonical JSON rules;
- digest test vectors;
- golden trace graphs;
- settlement transition fixtures;
- compatibility manifests;
- error codes and retry classifications.

Use a versioned envelope:

```ts
interface RecordEnvelope<TBody extends RecordBody = RecordBody> {
  protocolVersion: string;
  recordId: string;
  ownerId: string;
  ownerOrdinal: number;
  parentRecordIds: readonly string[];
  body: TBody;
  semanticDigest: string;
  storageReceipts: readonly StorageReceipt[];
}
```

The semantic digest excludes storage receipts, local paths, insertion
timestamps, and backend-specific metadata. This ensures storage movement does
not change semantic identity.

### Canonical encoding

Before implementation, choose and freeze one encoding profile:

- UTF-8;
- object keys sorted lexicographically;
- no insignificant whitespace;
- integers only for protocol counters and byte counts;
- timestamps normalized to RFC 3339 UTC with a defined precision;
- binary content represented by content digest and explicit media type;
- absent values omitted, never conflated with `null`;
- arrays retain order;
- Unicode normalization policy declared;
- SHA-256 initially, with an algorithm prefix such as `sha256:<hex>`.

RFC 8785 JSON Canonicalization is a strong default, provided both languages'
libraries pass identical vectors.

## Trace kernel

### Responsibilities

- validate record drafts;
- assign owner-local ordinals transactionally;
- derive semantic digest and `recordId`;
- append one or more records atomically;
- enforce append-intent idempotency;
- reject same intent key with different semantics;
- maintain indexes without making them authoritative;
- read by exact ID, owner/cut, and slice;
- verify graph integrity and storage receipts;
- project effective execution history;
- support schema migrations without rewriting semantic records.

### Storage

Begin with SQLite in WAL mode:

- portable across Node and Python;
- transactional;
- suitable for append-intent uniqueness;
- easy to inspect and recover;
- compatible with a later remote store abstraction.

Persist blobs in a content-addressed object directory, not inside trace rows.
Use atomic temp-file, fsync, rename, and directory-fsync rules where supported.
Record filesystem durability limitations by platform.

Recommended logical tables:

- `records`
- `record_parents`
- `owner_ordinals`
- `append_intents`
- `storage_receipts`
- `blobs`
- `refs`
- `operations`
- `schema_migrations`

### Kernel state laws

- owner ordinal is strictly increasing;
- an append batch is all-or-nothing;
- `recordId` equals the canonical semantic digest;
- a parent must exist or be part of the same valid append batch;
- repeated equal append intent returns the original result;
- repeated unequal append intent returns an idempotency conflict;
- projections are disposable and reproducible from canonical records.

## Task model

TypeScript cannot reproduce a Python decorator's runtime signature reflection
using types alone. Use an explicit runtime task descriptor with inferred static
types:

```ts
const writeNote = task({
  name: "writeNote",
  instruction: "Write one note about the topic into the repository.",
  input: schema.object({
    repo: gitRepo({ access: "read-write" }),
    topic: schema.string(),
  }),
  output: schema.void(),
});
```

Optional decorator syntax may be added later, but it must lower to the same
descriptor.

Python can offer `@task`, but it must also compile to the same descriptor
schema. The descriptor digest includes the behavioral instruction, schemas,
grant surface, declared effect families, and compatibility version.

Task forms:

- bodyless model-serviced task;
- deterministic bodied task;
- composite task;
- task-as-value input;
- synthesized/revised task descriptor.

Synthesized task code is never executed merely because a model emitted it. It
must pass schema validation, policy checks, and an explicit execution boundary.

## Effects and handlers

Use discriminated records:

```ts
type EffectIntent<K extends string, P> = {
  phase: "intent";
  kind: K;
  effectId: string;
  reversibility: "reversible" | "compensable" | "irreversible";
  payload: P;
};

type EffectOutcome<K extends string, V, E> = {
  phase: "outcome";
  kind: K;
  effectId: string;
  result: { ok: true; value: V } | { ok: false; error: E };
};
```

The effect lifecycle:

1. validate and append intent;
2. offer intent to ordered interceptors;
3. resolve `allow`, `deny`, `replace`, `pause`, or timeout policy;
4. materialize through the selected handler;
5. append outcome;
6. update world receipts/projections;
7. notify observers after durable append.

Observers are read-only consumers. Interceptors participate in the decision
protocol. Keeping them separate is necessary to prove non-perturbing
observation.

Provide bounded queues, cursor-based resumption, backpressure metrics, and
explicit overflow policy. Never silently drop trace events.

## Run state machine

Run lifecycle:

```text
declared → queued → running → terminal
                         ↘ recovering

terminal = succeeded | failed | exhausted | cancelled
```

World output lifecycle:

```text
capturing → retained → settling → settled
                         ↘ recovery-required

settled = selected | applied | released | discarded
```

Settlement is a compare-and-swap transaction keyed by exact output identity.
The transition from `retained` to any terminal settlement is legal once.

Run records store:

- task artifact lock;
- validated inputs and binding identities;
- provider/model descriptor;
- requested/resolved placement and enforcement;
- budgets;
- outcome;
- trace root/cut;
- artifacts and usage;
- retained output references;
- settlement decision and citations;
- error codes and recovery status.

## Workspace and versioned worlds

### Binding model

A binding has:

- stable binding ID and name;
- canonical root;
- baseline world revision;
- resource type;
- permission profile;
- carrier/backend;
- current custody state.

Reject overlapping roots after canonicalization, including symlink-aware checks.

### Backends

Implement in order:

1. **copy backend** — universal correctness reference;
2. **macOS clonefile backend** — cheap file clones;
3. **Git/worktree or object backend** — repository-aware retained deltas;
4. **Linux overlayfs backend** — high-performance copy-on-write;
5. **FUSE backend** — fallback where justified;
6. **remote/container checkpoint adapter** — paper-level coupled forks.

Every backend implements the same contract:

```ts
interface WorldCarrier {
  snapshot(binding: Binding): Promise<WorldRevision>;
  fork(base: WorldRevision): Promise<WorldRevision>;
  diff(base: WorldRevision, head: WorldRevision): Promise<Changeset>;
  materialize(revision: WorldRevision, target: Binding): Promise<Receipt>;
  merge(parent: WorldRevision, child: WorldRevision): Promise<MergeResult>;
  discard(revision: WorldRevision): Promise<void>;
  verify(revision: WorldRevision): Promise<VerificationResult>;
}
```

Correctness is tested against the copy backend as the reference model.

### Changesets

Represent:

- file add/modify/delete;
- directory creation/removal where semantically required;
- executable/mode changes;
- symlink target changes;
- rename as optional derived information, not required identity;
- content digests and optional safe previews;
- unsupported filesystem objects as explicit errors.

Settlement must protect the control plane (`.vcscore` or the chosen equivalent)
and reject path escape.

## Coupled scope checkpoints

A paper-level scope checkpoint must identify:

- world revisions for every binding;
- process/container checkpoint;
- provider conversation and prompt-cache identity;
- task artifact lock;
- effect-stream cut;
- child ownership and capability grants;
- budgets and cancellation state;
- irreversible-effect frontier.

A fork succeeds only if this descriptor is durable and internally consistent.
If process checkpointing is unavailable, the implementation must label the fork
as a reconstructive replay fork, not an atomic process fork.

## Permissions and enforcement

Compile runtime task descriptors into a grant plan. Static TypeScript types are
developer ergonomics; runtime descriptors are the security source.

Enforcement adapters:

- advisory in-process adapter;
- macOS Seatbelt profile generator/launcher;
- Linux Landlock launcher, likely through a small audited native helper or
  privileged container;
- container/remote policy adapter.

The helper protocol must be narrow, versioned, structured, and tested against
argument injection. Do not attempt to imitate syscall enforcement with Node
monkey-patching.

Capability rules:

- undeclared authority is denied;
- a child receives no more authority than the parent;
- read-write can attenuate to read-only, never amplify;
- grants are bound to canonical resource identity, not a display path;
- irreversible effects may require an approval capability.

## Providers

Provider interface:

```ts
interface ModelProvider {
  descriptor(): ProviderDescriptor;
  invoke(request: ModelRequest, signal: AbortSignal): Promise<ModelResponse>;
  stream?(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent>;
  checkpoint?(session: ProviderSession): Promise<ProviderCheckpoint>;
  resume?(checkpoint: ProviderCheckpoint): Promise<ProviderSession>;
  cacheIdentity?(request: ModelRequest): Promise<CacheIdentity>;
}
```

Build the static provider first. Add live providers behind optional packages and
integration tests. Normalize provider events without discarding raw provider
payload citations.

Never store secrets in semantic trace bodies. Persist secret references or
redacted metadata and define export redaction policies.

## Cross-language interoperability

Required compatibility directions:

- TS writes, Python reads and verifies;
- Python writes, TS reads and verifies;
- either language continues a terminal-free trace slice;
- either language inspects and settles an eligible retained output;
- unknown future record bodies round-trip without semantic corruption;
- error codes and state transitions are stable across languages.

Generate model types from schemas where practical, but keep handwritten domain
types at the public API boundary. Generated types do not replace semantic
validation.

## TypeScript packages

| Package | Responsibility |
| --- | --- |
| `@scope/core` (placeholder name) | IDs, errors, schemas, outcomes, grants |
| `@scope/trace` | kernel, SQLite store, blobs, cuts/slices |
| `@scope/effects` | effects, handlers, observers, interceptors |
| `@scope/tasks` | descriptors, schemas, registration, artifact locks |
| `@scope/workspace` | bindings, carriers, changesets, settlement |
| `@scope/runtime` | execution, runs, children, budgets, replay |
| `@scope/providers` | static provider and provider contracts |
| `@scope/sandbox` | placements and enforcement adapters |
| `@scope/export` | JSONL/ATIF-compatible export and redaction |
| `@scope/cli` | CLI and machine-readable output |
| `@scope/testkit` | fake worlds/providers, TCK, property generators |
| `@scope/shepherd` | stable convenience facade |

Names are placeholders until the naming decision is resolved.

## Python packages

Mirror semantic layers, not necessarily npm package count. Python should expose
an ergonomic facade and reuse shared fixtures:

- kernel/store;
- effects;
- tasks;
- workspace;
- runtime;
- providers;
- sandbox;
- CLI;
- export/testkit;
- `shepherd`-compatible facade in an explicitly named compatibility mode.

## Dependency direction

Dependencies point downward only. In particular:

- the kernel imports no provider, workspace, or CLI code;
- providers do not import the task facade;
- platform helpers speak contracts from core/sandbox;
- CLI calls public facades and never reaches private database tables;
- tests may use testkit, but production packages never depend on it.
