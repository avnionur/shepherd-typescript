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
