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
