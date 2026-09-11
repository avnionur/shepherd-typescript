# Durable scope registration and fenced local emission

Implementation: [`src/scope`](../src/scope) (registration, writer claims, emission, inspection,
authority, and record codecs). Store transactions:
[`src/store/scope-registrations.ts`](../src/store/scope-registrations.ts). Integrity:
[`src/store/scope-integrity.ts`](../src/store/scope-integrity.ts). Configuration:
`scopes` in [`protocol.config.json`](../protocol.config.json) read by
[`src/protocol/config-scopes.ts`](../src/protocol/config-scopes.ts). Public entry points:
[`src/facades/scopes.ts`](../src/facades/scopes.ts) and [`src/index.ts`](../src/index.ts).
Schemas: [`scope-registration-v1`](../spec/schemas/scope-registration-v1.schema.json),
[`scope-child-registered-v1`](../spec/schemas/scope-child-registered-v1.schema.json), and
[`scope-emission-v1`](../spec/schemas/scope-emission-v1.schema.json). Tests:
[`test/scope`](../test/scope). Contract: the Phase 6
[scope ownership/authority proposal](../.plan/scope-ownership-contract.md), slice A.

## Scope

This is the first executable slice of the Phase 6 scope contract and is deliberately
**trace-only**. A scope is one owned branch identity whose local history is an append-only trace
owner path. The slice implements durable root and child registration, single-writer fenced
claims, idempotent scope-local emission of validated application data, and read-only inspection.
It forks no world custody, invokes no provider, materializes nothing, and adds no merge or discard
operation; those remain later Phase 6 slices. Every registration declares the configured
`trace_only` world capability so later readers cannot mistake it for an executable world fork.

## Identity and records

Scope commands are canonical capture records on the record graph rather than a separate event
store. A scope identity is content-addressed from its registration command and owning parent:
`scope:sha256:<hex>`. The same string names the scope's trace owner path.

| Record | Owner path | Causes | Meaning |
| --- | --- | --- | --- |
| `shepherd.scope.registration.v1` | the scope, ordinal 0 | root: none; child: the parent-side control record | Ownership, exact origin, ceiling and effective authority, execution association, and world capability |
| `kernel.cut.owner-prefix.v1` (origin cut) | the child scope, ordinal 1 | parent head, then the child registration | Immutable cut through the parent head fixed as the child's fork origin; its identity is `scope-origin:<hex>` derived from the command |
| `shepherd.scope.child_registered.v1` | the parent scope | the exact expected parent head | Parent-owned control evidence that one child was registered from that head |
| `shepherd.scope.emission.v1` | the emitting scope | the exact expected head, then every cited record | Validated canonical application data extending only the scope's local history |

Scope identity is content-addressed from the command and the owning parent, and a registration
record is immutable, so cycles, self-parenting, and reparenting have no representation and one
command identity names exactly one kind of command; reusing it for another kind conflicts.

A child registration is one transaction: it appends the parent control record, the child
registration record, and the origin cut, and inserts the live registration row. The parent's
managed content and earlier records are unchanged; only its head advances by the control record,
which is retained append-only evidence. Child emissions never appear on the parent path or in the
parent's effective history.

## Authority

Authority is a list of exact resources, each `{ resource_kind, resource_id, atoms }`, with the
configured resource kinds and the atoms shared with repository grants. In this slice a resource
identity is an opaque exact string; binding it to an authenticated workspace resource is the next
slice. Root registration supplies the whole-run ceiling and the requested grant; child
registration supplies only the requested grant. Effective authority is the per-resource
intersection of the parent's effective authority, the request, and the ceiling. A requested
resource absent from the ceiling or the parent, an unknown atom, an unknown resource kind, a
duplicate resource, or an exceeded resource bound fails closed with `ScopeAuthorityError`.
Requesting an atom the parent lacks attenuates it away rather than failing, so a ceiling or parent
can never amplify authority. The ceiling is retained with every registration so a scope tree is
self-describing.

Registration requires explicit trace authority: an open writable store. An optional
`executionId` associates a scope with a durable run and requires retained creation evidence for
that owner path; the association creates no second run lifecycle.

## Writer claims and fencing

`claimScopeWriter` admits at most one writer per registered open scope. The first claim receives
fencing token one and a configured lease. An exact unexpired active claim is returned again. A
released or expired claim is superseded by the next claim with the next monotonic token; an
unexpired active claim held by another identity fails with `ScopeWriterConflictError`. Expiry
alone does not prove the previous holder stopped, so its later commands are fenced rather than
assumed absent. `releaseScopeWriter` is idempotent for the exact claim and admits the next writer
immediately.

The returned `ScopeWriter` is a frozen handle authenticated by a private package registry that also
binds it to the store instance that minted it. Copied, serialized, imported, or foreign-store
handles fail with `TypeError` before any store access. Claim identities are unique per scope, so
one worker identity may hold several scopes. A handle is not stable command content: replaying a
completed command never depends on its fence.

## Commands, idempotency, and replay

Every mutating command carries a caller-supplied globally idempotent `commandId`. Its append
intent identity is derived from that command, so one identity names exactly one normalized
request. Inside one immediate SQLite transaction a command first checks for its retained intent:
an exact replay returns the original receipt across restart, after the head advanced, after the
writer was released, or after another writer was admitted; a different request under the same
identity fails with `AppendIntentConflictError`. Only a new command proceeds to admission: the
scope must hold a live open registration row, the fence must be current, the expected head must
be the current head (`ScopeHeadConflictError` otherwise), and every cited record must be retained.
Failed admission retains nothing. `readScopeCommandReceipt` is the receipt-replay read: it
reconstructs the classified original registration or emission receipt from the records retained
under the command intent without any writer authority, so a restarted caller, a stale or
superseded fence, or an imported store can still read its exact result.

Emission data must be a canonical semantic object within the configured byte bound; citations are
unique configured record identities within the configured count and may not repeat the head.
Emission records validated data only. It does not fabricate an outcome, replay an external
effect, or authorize execution.

## Inspection, reopen, and import

`inspectScope` reconstructs a scope purely from its retained owner path: the registration body,
the origin cut for a child, and each later emission or child-registration record, validating that
every record is caused by the previous head, names this scope, and is retained under the append
intent derived from its own command (the origin cut under its cut intent). It returns the authority,
parent origin, execution association, head, ordered history entries, registered children, and
state, which is `open` in this slice; merged and discarded states and post-terminal refusal
arrive with merge and discard. The same value is reconstructed after reopen, read-only
reopen, and native archive import; export bytes are unchanged by reopen. Unsupported schemas,
mismatched bodies, missing origin cuts, and bypassed raw appends fail closed with
`ScopeEvidenceError`.

Live registration and writer-claim rows are private store state and are not exported. An imported
archive therefore provides inspection evidence only: `registered_for_mutation` is false, claims
and new commands are refused, while exact replay of a completed command remains readable
evidence. Fresh root registration on an imported store is new explicit authority, not reuse of
the imported scopes. Readmitting imported scopes for mutation is later work.

## Store schema and integrity

Store schema v9 adds `scope_registrations` (scope, parent, registration record, state) and
`scope_writer_claims` (claim, monotonic token, lease, released flag). Existing stores migrate
without rewriting records. `verifyIntegrity()` now checks every registration row against the
record at its first owner ordinal and reports `scope_registration_mismatch`, counted by
`checked_scope_count`. A corrupted row refuses claims and child registration.

## Conformance boundary

| Contract | Evidence |
| --- | --- |
| Root/child registration records, origin cut, and parent control record | `test/scope/scope-registration.test.ts` |
| Ceiling and parent attenuation; unknown resource, atom, kind, duplicate, bound refusal | same |
| Exact replay across reopen and after release; changed content conflicts; cross-kind identity reuse conflicts | registration and emission tests |
| Receipt replay read without writer authority on live and imported stores | `test/scope/scope-inspection.test.ts` |
| Handles bound to the minting store; distinct identities per parent; per-scope claim identities | registration and writer tests |
| Stale head, expired, superseded, and released fences refused | registration, writer, and emission tests |
| Forged or copied handles and malformed options rejected before store access | registration, writer, and emission tests |
| Emission extends only the scope path and cites retained records | `test/scope/scope-emission.test.ts` |
| Byte-equivalent reopen, read-only reopen, and import; import grants no mutation | `test/scope/scope-inspection.test.ts` |
| Integrity classification and corrupted-row refusal | same |
| Lost response after commit and interruption before admission converge on retry | same |
| Generated schemas accept retained records and reject malformed copies | `test/scope/scope-schema.test.ts` |
| Configuration drift and rejection | `test/protocol-config.test.ts` |

Hosted execution, world custody, provider or process checkpoints, merge, discard, attached
children, multi-resource coordination, and scheduling are not claimed by this slice.
