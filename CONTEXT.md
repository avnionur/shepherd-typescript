# Trace Kernel

The trace kernel defines the language-neutral records used to retain and verify agent execution
history across implementations.

## Language

**Record Body**:
The schema-specific semantic payload retained by a record.
_Avoid_: Fact body, event payload

**Record Envelope**:
The stable semantic identity, schema, mode, witness, and ordered causal references of one record.
_Avoid_: Fact envelope, storage record

**Record View**:
Path-local metadata such as owner and ordinal that locates a record without changing its identity.
_Avoid_: Record envelope metadata

**Trace Owner**:
A stable identity naming one append-only path of retained record occurrences.
_Avoid_: Record author, storage table

**Owner Ordinal**:
The unique configured-floor position of a record occurrence on one trace owner's path.
_Avoid_: Global sequence, record version

**Append Batch**:
An ordered collection of owner-local record drafts intended to be retained as one atomic change.
_Avoid_: Record list, transaction log

**Append Intent**:
A stable idempotency key naming one requested atomic append.
_Avoid_: Transaction ID, record ID

**Append Receipt**:
The durable result associated with a committed append intent.
_Avoid_: Storage record, append response

**Append-Local Reference**:
A batch-scoped name through which a later draft cites a record drafted earlier in the same batch.
_Avoid_: Temporary record ID, forward reference

**Witness**:
A retained record identifying the authority and semantic environment under which another record
was accepted.
_Avoid_: Context digest, permission string

**Causal Parent**:
A record cited by another record as an ordered semantic cause.
_Avoid_: Storage parent, path predecessor

**Trace Store**:
A durable adapter that atomically retains semantic records and owner-local views.
_Avoid_: Event bus, record planner

**Cut**:
An immutable published read address through one retained occurrence on an owner path.
_Avoid_: Mutable cursor, latest position

**Slice**:
An immutable graph-shaped read containing selected records, owner paths, direct causal edges,
boundary anchors, and supporting witness evidence.
_Avoid_: Record list, database page

**External Anchor**:
A visible reference to a direct causal parent omitted from a slice.
_Avoid_: Synthetic parent, transitive edge

**Witness Anchor**:
A shape-only reference to supporting witness evidence whose payload is hidden.
_Avoid_: Missing witness, replacement witness

**Execution Projection**:
A disposable lifecycle value folded from configured records on an immutable execution-owner
prefix.
_Avoid_: Mutable run row, authoritative execution state

**Execution Relation**:
A parent-owned retained transition describing a spawned, adopted, or abandoned child execution.
_Avoid_: Child process handle, storage foreign key

**Effective History**:
A disposable root projection containing retained relation transitions, active child-cut
projections, and parent-published semantic data.
_Avoid_: Raw record list, mutable run tree

**Published Record**:
Schema-defined parent-owned data exposed by an effective-history projection.
_Avoid_: Log message, unretained event

**Integrity Report**:
A read-only classified account of verified trace-store records, indexes, receipts, cuts, owner
paths, and blobs.
_Avoid_: Repair result, database dump

**Append Recovery Diagnosis**:
A read-only classification stating whether an append intent is committed, safe to retry, or
requires manual recovery.
_Avoid_: Automatic repair, inferred success

**Trace Archive**:
A versioned, identity-preserving native interchange document containing complete retained store
state.
_Avoid_: Database dump, ATIF trajectory, mutable backup

**Blob Orphan**:
A store-layout filesystem object without durable blob metadata and a matching storage receipt.
_Avoid_: Unowned semantic record, corrupt registered blob, disposable projection

**Task Descriptor**:
An immutable bodyless behavioral contract containing a logical identity, instruction, and runtime
input/output schemas.
_Avoid_: Prompt template, executable task run, registry alias

**Task Schema**:
A JSON Schema document paired with inferred TypeScript types and runtime validation.
_Avoid_: Type-only annotation, unchecked model-output hint

**Task Artifact**:
The canonical, compatibility-versioned semantic value from which exact task identity is derived.
_Avoid_: Mutable function object, registry entry

**Task Artifact Lock**:
A frozen exact citation containing task identity/version and the canonical artifact/schema digests.
_Avoid_: Mutable task selector, execution permission, package lockfile

**Task Registration**:
A durable association between one exact logical task ID/version and one verified immutable artifact.
_Avoid_: Latest-version alias, executable task run, mutable descriptor

**Task Registry**:
A durable adapter that registers immutable task versions and resolves exact verified registrations.
_Avoid_: Task executor, package registry, mutable alias table

**Effect Handler Stack**:
An immutable ordered collection that selects the nearest exact-kind handler for a validated effect
intent.
_Avoid_: Interceptor pipeline, observer, global middleware

**Effect Handler Dispatch**:
The frozen selected-handler identity and exactly correlated effect outcome returned by one handler
invocation.
_Avoid_: World receipt, durable append, interception decision

**Run Outcome**:
An immutable versioned terminal value stating that one exact task revision finished, failed,
exhausted its budget, or was cancelled.
_Avoid_: Mutable execution row, stack trace, complete run ledger

**Run Artifact**:
An immutable versioned side-channel output placed at an explicit run-local emission ordinal, with
text inline or binary content cited through a durable blob receipt.
_Avoid_: Return value, embedded base64, mutable file handle

**Run Usage**:
An immutable versioned aggregate of token and cost totals for an entire run.
_Avoid_: Individual provider-call usage, billing invoice, mutable counter

**Run Control**:
A cooperative per-run controller that accumulates configured resource consumption and composes
budget exhaustion, caller cancellation, and disposal into one first-terminal-wins `AbortSignal`.
_Avoid_: Process kill, permission boundary, mutable run ledger

**Model Provider**:
A provider-neutral boundary that exposes immutable identity/capabilities and maps a validated
structured model request to a validated structured response under cooperative cancellation.
_Avoid_: Task implementation, ambient global model, credential store

**Static Provider**:
A deterministic offline model provider that consumes an exact ordered request/response cassette
and fails closed on mismatch or exhaustion.
_Avoid_: Test-only mock, live model adapter, fallback response generator
