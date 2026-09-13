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

**Scope**:
One owned branch identity whose append-only local history is a trace owner path holding its
registration, origin, and emitted records.
_Avoid_: Run, Git branch, filesystem path, mutable checkpoint

**Scope Writer**:
Package-authenticated live authority over one scope, admitted by a monotonically fenced
single-writer claim.
_Avoid_: Serialized handle, permission string, imported record

**Scope Emission**:
Validated application data retained on one scope's local history under an exact head and command
identity.
_Avoid_: Effect outcome, parent-visible publication, external execution

**Scope Fork**:
An isolated child scope whose world is separate verified-copy custody of one bound resource,
admitted by a prepared journal record and completed under the parent's writer fence.
_Avoid_: Atomic snapshot, Git branch, merge

**Scope Checkpoint**:
The classified constituents of a completed fork, each verified with a receipt, reconstructive, not
applicable, or unavailable with a reason.
_Avoid_: Restorable process snapshot, trace cut alone

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

**Typed-Effect Reference Trace**:
An ordered normalized record sequence accepted by the configured single-root Core-A lifecycle
machine for one content-addressed static program. A valid live prefix is reference-validatable but
is not proof-backed or complete.
_Avoid_: Production run ledger, arbitrary runtime trace, Lean proof

**Proof Envelope**:
A frozen fail-closed classification of trace evidence at the strongest configured claim supported
by validated evidence. Missing, malformed, unsupported, or incomplete proof evidence cannot imply
theorem authority.
_Avoid_: Runtime guarantee, inferred formal proof, marketing compatibility label

**Static Lowering Evidence**:
A content-addressed manifest binding one completed reference trace and program to a named case in
the exact configured upstream source generator revision.
_Avoid_: Self-attested hash, arbitrary source file, production-runtime equivalence

**Core-0H Sidecar**:
A validator-issued content-addressed manifest binding deterministic two-phase handler evidence to
one exact lowering, program, and completed trace. An untrusted sidecar cannot strengthen a claim.
_Avoid_: Inferred handler purity, runtime handler log, allowlist bypass

**Theorem Artifact Metadata**:
A content-addressed declaration of the pinned paper revision, theorem-name surface, authority, and
external build gate. It does not prove that the external Lean build ran in this repository.
_Avoid_: Local theorem verification receipt, production-runtime proof, mutable theorem alias

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

**Durable Recovery Command**:
A globally idempotent canonical request to apply one safe recovery transition to retained durable
execution evidence. Provider-boundary recovery additionally requires the current invocation fence.
_Avoid_: Mutable run flag, provider replay permission, unretained retry request

**Workspace Control State**:
Versioned closed metadata under the configured `.vcscore` root that records initialization options
and an adopted baseline citation without modifying ordinary workspace files or Git history.
_Avoid_: Retained file carrier, Git repository alias, mutable user configuration

**Workspace Adoption**:
The configured choice to cite no baseline, an exact Git HEAD, or a content-addressed ordinary
worktree. A worktree citation identifies content but does not itself retain the cited bytes.
_Avoid_: Settlement, implicit commit, copy-carrier custody

**Workspace Binding**:
A frozen content-addressed authority identity joining one exact logical name to one canonical,
workspace-contained, pairwise-disjoint filesystem root.
_Avoid_: Runtime permission grant, display-path authority, retained world snapshot

**Git Repository Binding**:
A package-authenticated workspace binding extended with one exact non-bare Git worktree, shared
repository identity, per-worktree identity, object format, and a separate content-addressed
resource identity. It carries no runtime read/write grant by itself.
_Avoid_: Git custody receipt, ambient repository discovery, permission grant, linked worktree

**Repository Task Grant Artifact**:
A versioned companion artifact binding one exact bodyless task artifact digest to a complete,
canonical, per-binding whole-repository authority declaration without redefining the task artifact.
_Avoid_: Mutable policy file, repository binding, ambient filesystem permission

**Repository Grant Plan**:
An authenticated content-addressed admission record that resolves every task grant to one exact
repository resource and intersects it with a whole-run authority ceiling.
_Avoid_: OS sandbox profile, mutable ACL, display-path allowlist

**Whole-Run Authority Ceiling**:
A configured repository grant profile whose authority atoms can only remove, never add, atoms from
each task-declared binding grant for one admitted run.
_Avoid_: Default permission, task grant replacement, runtime escalation

**Placement Platform Evidence**:
An immutable content-addressed classification of an explicit execution-environment probe into a
platform family and native, WSL, or unsupported environment without retaining environment values.
_Avoid_: Sandbox capability, launcher receipt, ambient host guess

**Placement Resolution**:
An immutable content-addressed record binding requested placement, effective placement, actual
enforcement, reason, platform, grant plan, runner, run, and capture before execution admission.
_Avoid_: Jail profile, aspirational enforcement, mutable runtime option

**Native Jail Probe**:
An immutable content-addressed local backend result that reports availability only after a real
native granted-write and denied-write canary succeeds.
_Avoid_: Executable presence check, synthetic platform claim, advisory fallback

**Native Confinement Plan**:
An immutable content-addressed lowering of one exact effective repository grant to canonical
writable custody roots and a backend-private profile digest.
_Avoid_: User worktree path, mutable profile file, display-path allowlist

**Native Launch Receipt**:
An immutable content-addressed terminal record for one structured judged process, including exit,
signal, bounded output, cancellation/timeout classification, and process-group quiescence.
_Avoid_: Inferred exit, missing start evidence, automatic uncertain replay

**World Revision**:
An immutable verified copy-carrier snapshot whose revision identity binds canonical logical
filesystem content to one exact workspace binding and carrier protocol.
_Avoid_: Git commit, mutable checkout, custody directory path

**World Custody**:
An owned mutable retained checkout forked from one verified world revision, identified by a
non-semantic receipt and kept outside the user's working tree.
_Avoid_: Immutable revision, settlement decision, user workspace

**Retained-World Runner**:
A registered runtime adapter identified by closed versioned metadata whose private callback may
execute only after orchestration authenticates its handle and supplies one exact fenced isolated
world context.
_Avoid_: Provider descriptor, arbitrary callback object, process sandbox, filesystem grant

**Git Basis**:
A content-addressed repository/worktree citation joining exact HEAD, index, sparse, ignored-source,
managed-world, binding, and retained-object evidence for movement checks and retained output.
_Avoid_: Branch display name, current user checkout, changeset, settlement decision

**World Changeset**:
An immutable content-addressed, ordered comparison of two exact world revisions for one binding,
whose path changes reconstruct the head manifest from the base manifest.
_Avoid_: Mutable custody, filesystem diff output, settlement authorization, heuristic rename

**Changeset Inspection**:
An authenticated read-only projection over one exact world changeset that provides bounded path,
content, preview, move, and Git-aware presentation without changing canonical identity.
_Avoid_: Settlement decision, unbounded diff output, user-workspace read, canonical rename record

**Retained-World Application Conflict**:
A bounded content-addressed classification proving that candidate and current changes touch equal,
portable-alias, or ancestor/descendant paths and therefore cannot be applied automatically.
_Avoid_: Textual merge conflict, consumed settlement decision, rename inference

**Retained-World Application Plan**:
An immutable content-addressed settlement record binding one shared base, current world, retained
candidate, path-disjoint merged revision, input changesets, and exact publication changeset.
_Avoid_: Mutable merge workspace, Git merge commit, inferred conflict resolution

**Retained-World Release**:
A consume-once receipt-only settlement that records deliberate non-selection against the current
parent-basis witness while preserving the existing retained custody for read-only inspection.
_Avoid_: Filesystem handoff, new authority handle, custody cleanup, parent publication

**Durable Resume Command**:
A globally idempotent canonical request naming one exact suspension acknowledgement and its
continuation descriptor. Successful application atomically acquires the next worker fence and
publishes running authority without restoring external state or invoking a provider.
_Avoid_: Process restart, implicit checkpoint restore, reuse of the previous worker lease

**Waiting Run**:
A non-terminal quiescent run whose continuation depends on one explicitly identified prerequisite
and independently verifiable satisfaction evidence.
_Avoid_: Paused run, sleeping worker, uncertain provider call

**Suspended Run**:
A non-terminal quiescent run whose authorized pause was acknowledged at a safe continuation
boundary with sufficient continuation evidence.
_Avoid_: Pause request, cancelled run, expired worker lease

**Continuation Descriptor**:
A canonical classification of the trace cut and world, provider-session, process, and prerequisite
evidence required to continue a non-terminal run.
_Avoid_: Trace cut alone, mutable worker snapshot, implicit replay promise

**Model Provider**:
A provider-neutral boundary that exposes immutable identity/capabilities and maps a validated
structured model request to a validated structured response under cooperative cancellation.
_Avoid_: Task implementation, ambient global model, credential store

**Static Provider**:
A deterministic offline model provider that consumes an exact ordered request/response cassette
and fails closed on mismatch or exhaustion.
_Avoid_: Test-only mock, live model adapter, fallback response generator

**Structured Public Error**:
An exported in-memory `Error` instance carrying a stable configuration-owned machine code and,
where already available, its original in-memory cause without changing class identity or message.
_Avoid_: Validation `TypeError`, serialized CLI error, canonical failure record, recovery authority
