# Task-as-value meta-agent contract

Status: TypeScript contract, Phase 9 task 1 (#163), 2.15.2. It is implemented by
[task values and child run handles](../docs/task-values.md) (#164, 2.16.0),
[delegated authority](../docs/delegated-authority.md) (#165, 2.17.0),
[supervisor operations](../docs/supervisor-operations.md) (#166, 2.18.0),
[task revision and synthesis](../docs/task-revision.md) (#167, 2.19.0), and
[result threading and nested meta-agents](../docs/result-threading.md) (#168, 2.20.0). Conformance,
process crash evidence, and the [Phase 9 exit audit](./phase-9-exit-audit.md) are #169 (2.20.1).
Normative behavior lives in `docs/`; this page records the reviewed design constraints and
deliberate non-claims.

## Evidence

Pinned release source: `a8196d4c453514836d06bd2fece91a03cdc37107`
([upstream.lock.json](../upstream.lock.json)).

- The paper (§3.1, §5.1) describes tasks as first-class values that a meta-agent can accept as
  input, run in a child, inspect, substitute, revise, or synthesize, and supervisors that observe,
  inject, hand off, discard, and retry workers. It gives no record format, no authority rule for
  delegation, and no approval rule for model-generated task definitions.
- The pinned release has no public child run handle, delegation, handoff, or task revision API.
  [research notes](./research-notes.md) list task-as-value delegation and meta-agent supervision
  among the capabilities the reference does not ship.

These are source-level observations, not executed Python conformance. The TypeScript design keeps
the paper's model and adds what it does not specify: a durable handle per child run, record-proven
attenuated authority, ordered retained context injection, fenced supervisor ownership, provenance
and approval for model-generated definitions, and typed projection of accepted results.

Existing TypeScript authorities stay normative: [task descriptors](../docs/task-descriptors.md),
[the task registry](../docs/task-registry.md), [durable task execution](../docs/durable-task-execution.md),
[run control](../docs/run-control.md), [scope authority attenuation](../docs/scope-registration.md),
[trace subscriptions](../docs/trace-subscriptions.md), and
[supervision control](../docs/supervision-control.md).

## Task values

A **task value** is the canonical, serializable form of a task descriptor: the task artifact and its
artifact lock, `{ artifact, artifact_lock }`, validated exactly as a registry registration is.

- `readTaskValue(value)` accepts only a plain data object with exactly those keys, re-derives the
  lock from the artifact, and refuses any mismatch. `taskValueOf(descriptor)` produces the value of a
  package-created descriptor. `taskDescriptorOf(value)` rehydrates an authenticated descriptor
  through the task builder and the schema factory and asserts the recomputed lock equals the value's.
- `schema.task()` is a fifth schema kind whose document is the published task-value JSON Schema
  reference. It types a task value as a task input or output, so a supervisor task can accept a
  worker task as data and a model-serviced task can emit a task definition as its output.
- A task value carries no code. Its artifact is the bodyless descriptor (name, version, instruction,
  input schema, output schema); the only executor is the configured provider path or a caller
  program running under a durable child run. Nothing in a task value is ever evaluated.

## Child run handles

A **child run handle** names one delegated execution of one task value under one supervisor. It is
retained on its own reserved owner path derived from the opening command identity
(`delegation:sha256:…`); the child run itself is an ordinary durable execution whose run identity is
derived from the handle (`delegation-run:sha256:…`).

- The opening record retains the supervisor identity, the parent (a root declaration or the parent
  handle), the task value, its provenance, the child input validated against the task input schema,
  the requested grant and budget, the derived delegated authority, and the origin cut through the
  parent handle head when the parent is a handle.
- Every handle mutation is a command with a global idempotent command identity, names the current
  supervisor, and compares the exact handle head atomically. Repeating a command returns the retained
  receipt; a different command under the same identity or a moved head is refused.
- `runChildRun` executes the child once: provider-serviced when the caller binds a provider,
  program-serviced when the caller binds a program that receives the authenticated handle, the
  delegated authority, the validated input, and the cooperative signal. The output is validated
  against the task value's output schema before the terminal record; a program that returns an
  invalid output fails the child.
- A completion record on the handle cites the child's terminal record and published cut. Handle
  status is derived from handle records and the child's durable execution inspection, so a crash
  between the child terminal and the completion record is classified from the child's own records.
- Raw appends and cut publication onto handle owner paths are refused; child run owner paths accept
  the ordinary durable control commands (pause, resume, cancel, recover).

## Delegated authority

Delegation never amplifies authority. A handle's authority is derived, retained, and compared by
records, never by identifiers.

- Resource authority reuses the scope attenuation rule: for a root parent, effective authority is the
  requested grant intersected with the declared ceiling; for a handle parent, the ceiling is the
  parent's effective authority and the effective authority is the grant intersected with it. A
  requested resource absent from the ceiling fails closed before the handle is opened.
- Budget authority: every budget metric the parent declares must be declared by the child with a
  value no greater than the parent's; a child may declare additional metrics. A root declaration
  fixes the ceiling budget.
- The retained authority carries both `ceiling` and `effective`; inspection re-derives the effective
  authority from the retained ceiling and grant and refuses evidence that disagrees.
- A program-serviced child receives an authenticated handle and may open grandchildren only under
  its own effective authority. Forged or foreign handles are refused by the package-minted check.
- Nesting depth is bounded by configuration; the chain of parent handles is verified at opening.

## Supervisor operations

| Operation | Behavior |
| --- | --- |
| observe | `inspectChildRun` reads the handle and the child's durable inspection; `observeChildRun` opens a trace subscription over the handle and child run owner paths through the Phase 7 subscription contract |
| inject | `injectChildRunContext` retains an ordered context injection on the handle citing retained records. Injections retained before the child starts are folded, in owner order, into the provider request context the child sees; the context record retains the consumed injection identities and the composed request identity. Injections after start remain pending for a retry |
| handoff | `handoffChildRun` transfers supervisor ownership to a named successor under head comparison. Every later command must name the successor; commands naming a former supervisor are refused |
| discard | `discardChildRun` retains a discard decision with a reason. A started, non-terminal child must be cancelled through durable control first; discard of a live child is refused |
| retry | `retryChildRun` opens a successor handle citing the discarded predecessor handle, its decision record, and its published cut as the causal replay point, with the same task value or a revised one |
| accept | `acceptChildRunResult` retains an accept decision for a finished child and the identity of the validated output value; only accepted results thread into the parent |

Decisions are terminal for the handle: one accept or discard per handle. Ordinary worker control
(pause, resume, cancel) stays the Phase 7 supervision surface and is addressed to the child run.

## Task revision and synthesis

Task values that a model produced are executed only after explicit approval.

- Provenance is retained on the handle: `declared` (a package-created descriptor supplied by the
  caller), `revised` (derived from a source task value with the differing fields listed), or
  `synthesized` (produced by a cited retained record of a run in the same store).
- A revised task keeps the source task identity, differs in at least one of `instruction`,
  `input_schema`, `output_schema`, or `task_version`, and lists exactly the differing fields. A
  revision retry cites the predecessor decision record and cut as its causal replay point.
- `revised` and `synthesized` provenance require an approval record from the current supervisor
  before `runChildRun` admits the child; rejection is terminal. `declared` provenance needs no
  approval. The approval retains the approver identity and the approved task value digest.
- A synthesized definition is admitted only through `readTaskValue`: extra keys, foreign schema
  documents, functions, or unsupported schema grammar are refused before any record is written.
  There is no eval path; the execution boundary is the configured provider path or the caller's
  program under the child's run identity.

## Result threading and typed projection

- `projectChildRunResult` returns the accepted output of a handle validated against the retained
  task value's output schema, rehydrated through the schema factory on reopened and imported stores.
  When the caller supplies a schema, its canonical document must equal the retained output schema.
- `projectDelegationTree` folds a supervisor's direct handles into a typed tree: each entry is the
  handle, its status, its authority, and its accepted value or null. Grandchildren appear only as
  the values their parents accepted, never as records or authority of the root.
- Nested meta-agents remain isolated: a grandchild's records live on its own owner paths, its
  authority is bounded by its parent's effective authority, and discarding a handle removes its
  accepted value and everything threaded through it from the parent's projection.

## Failure and recovery

| Failure | Required behavior |
| --- | --- |
| Child crashes before the terminal record | Handle status follows the child's durable recovery classification; the supervisor recovers through durable control or discards and retries |
| Crash after the child terminal, before the completion record | Handle status is derived from the child terminal; a later `runChildRun` for the same handle retains the completion record without re-executing |
| Command under a moved head | Refused with the current head; no record written |
| Command from a former supervisor | Refused; no record written |
| Grant exceeds the parent's effective authority | Refused before opening; no record written |
| Unapproved revised or synthesized task | `runChildRun` refused; no child records written |
| Imported store | Handles are inspection and projection sources; mutation requires a store that registered the handle |

## Non-claims

- No transfer of live process, provider session, or world state on handoff; handoff transfers
  supervisor ownership of the handle only.
- No automatic retry policy and no automatic discard of failed children.
- No execution-history relation records (`spawned`, `adopted`, `abandoned`) are written; the
  projection layer's untyped relations remain upstream-compatible and unused by delegation.
- No live provider adapter; provider-serviced children use caller-supplied providers.
- Injection composes the provider request context deterministically and retains what the child saw;
  it does not claim to mutate a provider-side conversation.
