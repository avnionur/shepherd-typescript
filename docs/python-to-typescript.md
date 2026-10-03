# Migrating Python Shepherd examples to TypeScript

This guide maps the pinned upstream release to the supported TypeScript package and its
[four executable examples](./typescript-examples.md). It is a source-level migration guide:
Python workspace directories, run databases, and runtime objects are not interchangeable with
TypeScript storage. Do not point the TypeScript store at an upstream Python database.

## Which upstream version?

The source baseline is Shepherd tag `v0.3.0`, commit
`a8196d4c453514836d06bd2fece91a03cdc37107`, recorded in the repository's
[upstream lock](https://github.com/avnionur/shepherd-typescript/blob/main/upstream.lock.json).
Sources reviewed for these mappings:

- [Offline function-task example](https://github.com/shepherd-agents/shepherd/blob/a8196d4c453514836d06bd2fece91a03cdc37107/examples/quickstart/offline_task.py).
- [Static-provider retained-world example](https://github.com/shepherd-agents/shepherd/blob/a8196d4c453514836d06bd2fece91a03cdc37107/examples/quickstart/world_channel.py).
- [Live Claude agent example](https://github.com/shepherd-agents/shepherd/blob/a8196d4c453514836d06bd2fece91a03cdc37107/examples/quickstart/agent_task.py).
- [Task semantics](https://github.com/shepherd-agents/shepherd/blob/a8196d4c453514836d06bd2fece91a03cdc37107/docs/shepherd/concepts/tasks.md),
  [permissions and bindings](https://github.com/shepherd-agents/shepherd/blob/a8196d4c453514836d06bd2fece91a03cdc37107/docs/shepherd/concepts/permissions.md),
  and [effect concepts](https://github.com/shepherd-agents/shepherd/blob/a8196d4c453514836d06bd2fece91a03cdc37107/docs/shepherd/concepts/effects.md).

Some concept pages at this release commit still label themselves v0.2.0. They provide vocabulary,
not proof that every described facility is implemented here. The separate pinned development
revision and the research paper are not substitutes for this release baseline. This slice does not
run the upstream Python tests or establish new cross-language protocol parity.

## Translation map

“Equivalent” below means the stated observable intent is available, not identical implementation,
storage, or wire identity. “Adapted” requires explicit TypeScript composition or a narrower scope.

| Python concept | TypeScript replacement | Classification |
| --- | --- | --- |
| Function signature and behavioral docstring | `task({ input, output, instruction, name, version })` from `/tasks` | Adapted: explicit runtime schemas and artifact identity |
| Bodied `@sp.task` in `offline_task.py` | Ordinary TS function for local computation; use an explicit provider and `executeTask` for bodyless tasks | Adapted: no function decorator or implicit callable task |
| `runtime={"provider":"static"}` | `createStaticProvider` from `/providers` with exact request/response exchanges | Adapted: caller supplies cassette and provider authority |
| `workspace.run(...)` yielding retained output | `captureTaskWorldDurably` with explicit binding, carrier, runner, task, provider and store | Adapted: retained-coding example |
| `output.changeset()` / `output.read_text(...)` | Citation selection, revision opening, `createWorldChangesetInspection`, bounded page/preview methods | Equivalent inspection goal: read-only-review example |
| Named disjoint bindings | `createWorkspaceBindings` and separate captures | Adapted: multiple-bindings example; no simultaneous multi-world runner |
| Per-parameter `May[GitRepo, ...]` and `may=` ceiling | Explicit repository grant artifacts/plans and whole-run ceiling | Adapted: bindings alone do not grant OS confinement |
| Selecting a retained output | `prepareRetainedWorldSettlement` then exact-ID `selectRetainedWorldSettlement` | Equivalent explicit-publication goal |
| `output.release()` in pinned `world_channel.py` | Receipt-only release via the public settlement interface | Equivalent non-selection goal; the TS coding demo chooses selection instead |
| `sp.handle` / effect concepts | `createEffectHandlerStack`, intent/outcome builders, correlation validation from `/effects` | Adapted: custom-effects example is in-process and non-durable |
| `runtime={"provider":"claude"}` in `agent_task.py` | Configured HTTP adapters from `/providers`; no Claude CLI process adapter | Adapted HTTP transport; process-provider translation unsupported |

The package namespace is `@avnionur/shepherd-typescript`; append the subpaths shown above.
Use Node >=24.12.0 <27, ESM, and TypeScript NodeNext resolution. Copy shipped `.ts` examples out of
`node_modules` before running them with Node. See the example guide for source-checkout and
tarball commands. No Python runtime is required.

## 1. Make task schemas and execution explicit

Python annotations do not translate into runtime validation automatically; declare each task
input and output with the schema factory. The Python type hints of upstream tasks map as follows:

| Python annotation | TypeScript schema |
| --- | --- |
| `str` | `schema.string()` |
| `int` | `schema.integer()` (safe integers) |
| `float` | `schema.number()` (finite numbers) |
| `bool` | `schema.boolean()` |
| `None` return | `schema.void()` |
| `None` inside a value | `schema.null()` |
| `list[T]` | `schema.array(T)` |
| `Literal["a", "b"]` | `schema.enum(["a", "b"])`, or `schema.literal("a")` for one value |
| `T \| U`, `Optional[T]` as a value | `schema.union([T, U])`, `schema.union([T, schema.null()])` |
| Pydantic model / `TypedDict` | `schema.object({ ... })` |
| Field with a default, `NotRequired[T]` | `schema.optional(T)` inside `schema.object()` |
| A task as data | `schema.task()` |

Unions follow JSON Schema `oneOf`: a value matching several members is refused, so prefer disjoint
members (`schema.union([schema.integer(), schema.number()])` refuses `1`). There are no validators
for constraints such as `Field(ge=0)`, string formats, dictionaries with arbitrary keys, tuples, or
recursive models; do not assume general Pydantic or arbitrary JSON Schema compatibility. Void is
normalized to canonical null by execution. Invalid values are refused with a path-level
`JSONSchemaValidationError`, such as `$.items[1].count must be a safe integer`. Inspect each
supported interface rather than casting a TypeScript type over unvalidated input.
`schema.fromJSONSchema` adapts exactly this language into authenticated schemas; it returns unknown
for dynamic documents, validates all supplied keywords, and normalizes property/required order
through the existing builders. To validate other data against a JSON Schema document, such as a
tool input, use `compileJSONSchema` ([JSON Schema validation](./json-schema-validation.md)).

The retained-coding example declares its runtime schemas explicitly:

```ts source=examples/retained-coding.ts
const inputSchema = schema.object({ source: schema.string() });
const outputSchema = schema.string();
```

These are excerpts in the context of the linked example, not independently runnable fragments.
The complete program constructs a descriptor, supplies a static provider, calls `executeTask`
inside the retained-world runner, and validates the result before writing through world authority.
The descriptor is not a callable function. `instruction` changes are behavioral changes and affect
task artifact identity. Task registration through `SQLiteTaskRegistry` is explicit; it is not an
ambient workspace side effect.

A provider cassette must match input, instruction, and output schema exactly. The shipped examples
have zero real token usage and no live inference; reported cassette values are fixtures, not model
quality or cost measurements.

## 2. Separate execution, retained inspection, and settlement

The [retained-coding example](../examples/retained-coding.ts) constructs one isolated capture and
checks that user source bytes are unchanged before it explicitly prepares and selects the output.
The pinned Python `world_channel.py` instead releases its output. Those are different decisions:
release records deliberate non-selection while retaining custody; selection publishes candidate
bytes. Do not mechanically replace release with select when porting a workflow.

Selection uses exact output identity and checks the current basis. Read selectors such as
`@latest` are conveniences for inspection, not mutation authority. `apply` is a separate operation
for path-disjoint three-way application; it is not a general textual merge. Discard and release
have different custody cleanup semantics.

The [review example](../examples/read-only-review.ts) opens the database read-only:

```ts source=examples/read-only-review.ts
using store = new SQLiteTraceStore(path.join(workspace.control_path, configuration.storeFile), {
    readOnly: true,
});
```

It reads existing retained revisions and a bounded preview. It does not launch another task,
repair evidence, or settle anything. Its fixture already has a selected settlement because setup
ran first. The carrier exposes broader operations and may ensure internal directories exist;
the read-only example requires an intact captured workspace and uses only revision reads.

## 3. Preserve binding and grant authority

The pinned Python permission page shows multiple bindings supplied to one run. The TypeScript
[multiple-bindings example](../examples/multiple-bindings.ts) deliberately uses a narrower model:

```ts source=examples/multiple-bindings.ts
const { bindings } = createWorkspaceBindings({
    workspaceRoot,
    bindings: scenarios.map((entry) => ({ name: entry.name, root: entry.directory })),
});
```

It performs independent sequential captures before selecting each output separately. Each
selection preserves sibling files, but the collection is not an atomic transaction: an earlier
selection stays committed if a later one fails. No runner receives simultaneous multi-world access.

Bindings identify disjoint roots. For Git-aware permissions, explicitly construct the public
repository task-grant artifact and admission plan; TypeScript type annotations do not confer
authority. The examples use advisory in-process runners, not jailed commands. Native confinement
is a distinct, capability-probed facility with platform limits. Copying `placement="jail"` from
the live Python example does not create a TypeScript provider adapter or a native sandbox.

## 4. Keep custom effects separate from durable runs

The [custom-effect example](../examples/custom-effects.ts) validates application payload meaning
inside its selected handler, then verifies exact correlation for success and failure:

```ts source=examples/custom-effects.ts
validateEffectCorrelation(successIntent, success.outcome);
validateEffectCorrelation(failureIntent, failure.outcome);
```

The last handler with the exact effect kind wins; an unrelated later handler does not intercept it.
Explicit failure data is an outcome. A thrown handler failure propagates; an unhandled kind throws
`EffectHandlerNotFoundError`. Matching only an effect ID is insufficient: changing the intent
payload invalidates correlation with its old outcome.

The pinned effect concept page discusses scoped/interception machinery and warns against using
it as ambient model delivery for bodyless tasks. The TS handler stack is not a replacement for that
runtime: it provides no trace persistence, external-effect retry, observation, or interception.
Reversibility annotations do not implement rollback or compensation for arbitrary callbacks.

## Supported boundaries and recovery

The [capability evidence inventory](https://github.com/avnionur/shepherd-typescript/blob/main/docs/generated/capability-inventory.md)
separates API availability, composition, restart, live-provider, platform, performance, and formal
evidence. These capabilities are implemented with explicit TypeScript contracts:

| Capability | Supported / adapted boundary | Remaining unsupported constituent |
| --- | --- | --- |
| Scope algebra | `emitScopeRecord`, `forkScope`, `mergeScope`, `discardScope`; nested and parallel scope scheduling | A retained task still receives one repository world; scope operations are not arbitrary process snapshots |
| Live observation | `openTraceSubscription` with durable acknowledgement and reconnect | Subscription delivery does not imply live model-provider verification |
| Supervisor injection and handoff | `injectSupervisionContext`, delegated supervisor operations, concurrent `runRuntimeSupervisor` | Worker grants/placement/shared budgets are not fully composed; a tool turn interrupted by a crash can repeat effects |
| Rewind and suffix replay | `rewindReplaySession` and `replayReplaySession` restore verified constituents and replay a recorded prefix | Unavailable constituents and uncheckpointed world boundaries are refused; provider conversation receipts remain process-local |
| Providers | Anthropic Messages and OpenAI-compatible HTTP adapters with tool calls | Claude CLI/Codex process adapters, streaming, bounded retry policies and live monetary accounting remain outstanding |
| Process checkpoints | Cooperative process checkpoint adapter and explicit transparent-backend availability probes | No general transparent process restoration guarantee |

See the repository contracts for
[scopes](https://github.com/avnionur/shepherd-typescript/blob/main/docs/scope-laws.md),
[subscriptions](https://github.com/avnionur/shepherd-typescript/blob/main/docs/trace-subscriptions.md),
[supervision](https://github.com/avnionur/shepherd-typescript/blob/main/docs/runtime-supervisor.md), and
[replay](https://github.com/avnionur/shepherd-typescript/blob/main/docs/rewind-and-replay.md).
Ambient Python bodyless calls and storage interchange remain unsupported. Ordinary production
runs carry no paper-level formal guarantee: reference validation and imported proof-envelope
metadata have separate, restricted evidence boundaries.

Durable restart is not permission to replay external effects. Retained incomplete executions need
the documented recovery command and evidence; a started provider operation can remain unsafe to
resume. Example setup programs refuse existing destination directories rather than silently
replaying work. Retain the directory after failure and inspect it before deciding recovery.

Further implemented contracts (repository access required):
[execution/recovery](https://github.com/avnionur/shepherd-typescript/blob/main/docs/durable-task-execution.md),
[settlement](https://github.com/avnionur/shepherd-typescript/blob/main/docs/retained-world-settlement.md),
[repository grants](https://github.com/avnionur/shepherd-typescript/blob/main/docs/repository-grants.md),
and [native confinement](https://github.com/avnionur/shepherd-typescript/blob/main/docs/native-jail-execution.md).

## Verification ownership

The shipped [manifest](../examples/manifest.json) names this guide. Installed-package conformance
checks that every TypeScript excerpt matches the specified shipped example and that its source is
among the programs typechecked and executed from a fresh tarball installation. All four examples
retain their independent expected-result checks, including original/selected bytes, repeated
review preservation, sibling states, and effect correlation.

This verifies the excerpts in their full program context. It does not execute Python, promise
storage interoperability, or expand the existing parity claims.
