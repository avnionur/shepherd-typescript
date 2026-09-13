# Durable isolated-scope ownership and authority

Status: reviewed TypeScript contract, Phase 6 task #127, 2.0.1. Slice A (#129) is implemented in
2.1.0 as [trace-only scope registration and fenced emission](../docs/scope-registration.md) and
slice B (#130) in 2.2.0 as [reference-copy scope fork](../docs/scope-fork.md), and slice C (#131)
in 2.3.0 as [consume-once merge and discard](../docs/scope-merge-discard.md). This page itself introduces no API, schema, storage table,
runtime grant or parity claim; normative behavior lives in `docs/`.

## Evidence and deliberate native choices

Pinned release source: `a8196d4c453514836d06bd2fece91a03cdc37107`, from
[upstream.lock.json](../upstream.lock.json). Reviewed sources:

- [Scope protocol](https://github.com/shepherd-agents/shepherd/blob/a8196d4c453514836d06bd2fece91a03cdc37107/shepherd/packages/core/src/shepherd_core/foundation/protocols/scope.py): isolation, merge/discard and escape vocabulary. Its four-primitives heading includes materialization, while the local roadmap lists emit/fork/merge/discard; these lists are not identical APIs.
- [Hierarchy coordinator](https://github.com/shepherd-agents/shepherd/blob/a8196d4c453514836d06bd2fece91a03cdc37107/shepherd/packages/runtime/src/shepherd_runtime/_scope/_hierarchy.py): attached children have live parent linkage; isolated forks copy bindings, carry origin metadata and do not propagate sandbox registrations until merge. Merge handles effects, registrations and binding updates. Discard refuses already escaped state.
- [Immutable model](https://github.com/shepherd-agents/shepherd/blob/a8196d4c453514836d06bd2fece91a03cdc37107/shepherd/packages/core/src/shepherd_core/scope/model.py) and [fork-origin tests](https://github.com/shepherd-agents/shepherd/blob/a8196d4c453514836d06bd2fece91a03cdc37107/shepherd/packages/core/tests/unit/scope/test_fork_origin_tracking.py): ancestry used for call-tree presentation is distinct from live parent linkage.

These are source-level observations, not executed Python conformance. The older scope tree is an
input to the native design, not proof of durable isolation, terminal admission or crash recovery.
The proposal deliberately requires consume-once terminal decisions, immutable evidence and fenced
writers; it does not infer those guarantees merely from similarly named Python methods.

Existing TypeScript authorities remain normative: [trace records/cuts](../docs/trace-queries.md),
[execution-history projections](../docs/execution-history-projections.md),
[grant ceilings](../docs/repository-grants.md), [copy custody](../docs/reference-copy-carrier.md),
[run control](../docs/durable-execution-control.md) and
[retained settlement](../docs/retained-world-settlement.md).

## Identity and ownership

| Concept | Proposed meaning | Must not be confused with |
| --- | --- | --- |
| Scope identity | Stable identity of one owned branch, with an append-only control/effect-evidence owner | Run ID, filesystem path, Git branch, mutable checkpoint |
| Owning parent | One immutable parent relationship for a non-root isolated scope | Permission inferred from knowing the ID |
| Fork origin | Exact source scope cut and verified constituent revisions used to construct a branch | Mutable latest state or the parent used for display |
| Execution association | An explicit reference between a run and the scope authority under which it executes | A second run lifecycle |
| Handle | Package-authenticated live authority supplied by the caller | A serialized descriptor or imported record |
| Scope checkpoint | Immutable trace address plus classified world/provider/process/control constituents | A trace cut alone or an atomic process snapshot |

Initially every child created by the scope runtime is an **isolated fork** with one owning parent.
Its origin is an exact cut of that owning parent; borrowing an arbitrary other scope's origin is
outside the initial contract. Merge admission must verify this exact parent-child relationship.
An upstream-style attached child is a distinct future operation; it must not be aliased to fork.
Multiple scopes may cite the same immutable origin without sharing mutable custody. No cycles,
self-parenting, silent reparenting or ownership inferred from a projection are allowed.

Names, roles, schema references, identity prefixes and resource limits must come from versioned
configuration when implemented. Existing run-owner paths and canonical effect bodies are not
rewritten. New scope wrappers cite existing record identities instead of changing their meaning.

## Authority and writer model

Creation requires explicit trace authority and authenticated resource/grant inputs. Child authority
is the intersection of the parent's effective authority, the requested child grant and the
whole-run ceiling, bound to exact resource identities. Unknown atoms and forged/stale handles fail
closed. A child cannot authorize writes or settlement in its parent merely by citing its parent ID.

Each mutable scope custody has at most one admitted writer. Mutating commands carry an exact scope
head, operation/command identity and monotonically fenced writer claim. Fork snapshot/capture,
merge and discard require proven quiescence and compatible claims for every affected scope.
The live claim/fence is a separate authorization envelope, not a way to change stable command
content. Recovery may acquire a new fence only for the same retained request and verified
command-owned progress; it cannot replace the original semantic basis or accept unrelated head drift.
Acquisition across multiple scopes uses a deterministic order; a failed acquisition performs no
partial mutation. Lease expiry alone does not prove an external process stopped.

Imported archives provide inspection evidence only. Reopening for mutation requires fresh live
authority, exact ownership/resource validation and reconciliation with retained receipts. Existing
advisory grants remain advisory; no scope API claims to confine ambient Node code. Native process
authority must retain the existing placement/jail evidence and quiescence requirements.

## Primitive contract

| Primitive | Admission and retained evidence | Observable outcome |
| --- | --- | --- |
| `emit` | Open scope, current writer fence, exact head and idempotency key; versioned scope envelope cites validated semantic records | Extend only that scope's local history. Recording an intent never fabricates an outcome or authorizes arbitrary external execution |
| `fork` | Open owner, verified fixed origin, attenuated grants and quiescence; durable operation precedes custody creation; completion cites actual carrier receipts | Distinct child owner and mutable custody; parent/sibling logical worlds and selected effect history unchanged |
| `merge` | Explicit parent authority plus exact child terminal candidate; both quiescent, compatible grants, current parent basis and one consume-once decision | Integrate verified child delta into parent-managed state, cite the fixed child cut once, then seal child against further writes |
| `discard` | Exact owned scope and quiescent descendants, unconsumed terminal decision and no unresolved escaped effects | Seal the owned subtree, retain audit history, and clean only proven-owned mutable custody; parent/siblings retain their current state |

“Parent unchanged” means its managed-world content and effective selected effects, not byte-equal
global trace storage: explicit fork/merge/discard control records remain append-only evidence.
Child emission never implicitly appears in the parent's effective history. Merge cites a bounded
child cut; it must not rerun callbacks or duplicate external effects. Immutable record IDs and
their original provenance survive integration.

Selected-history integration includes only the child's local contribution after its fork origin,
including explicitly integrated descendant contributions. Inherited common-origin history is not
re-added to the current parent. Track contribution identity by its original owner/ordinal and
record identity, not just a payload digest: distinct retained occurrences of the same semantic
record remain distinct. Reaching an already selected occurrence through a descendant citation
must not apply it twice. Preserve child-cut/merge-receipt provenance and deterministic ordering.

Parent advancement since fork is not permission to overwrite it. Merge derives an exact three-way
plan from the common origin, current parent and child revision. Portable path overlaps, structural
conflicts or unsupported objects are refused without consuming the child. Disjoint changes may be
combined only under a rechecked parent-head comparison and verified carrier publication receipt.
Existing `apply` logic is a reference for conflict policy, not a shortcut to mutate the user tree.

Scope merge targets **parent-managed custody**, never implicit user-workspace materialization.
User publication remains separately authorized settlement through an explicitly specified adapter;
the existing select/apply/release/discard commands keep their current exact-output contracts.
No new root-materialization command is part of the initial scope slices.

## Branch lifecycle, commands and recovery

Proposed logical branch states are open, merged and discarded. This is branch ownership state,
not a replacement for created/running/waiting/suspended/terminal run lifecycle. Prepared/in-flight/
repair-required classifications describe command progress, not extra successful terminal states.

Each command identity binds the complete normalized request. First check for an authenticated
completed command with that exact request; a caller allowed to read its result receives the original
receipt even if the old head/fence is now stale or the scope is terminal. This is receipt replay,
not renewed mutation authority. Only a new or unfinished command proceeds to current open/head/
fence admission or receipt-based recovery. Conflicting identity reuse always fails.
Parent merge versus discard and competing merge attempts have
one winning terminal admission. Repeating a completed discard is idempotent; merge-after-discard,
discard-after-merge and post-terminal writes are refused. Readable immutable evidence remains.

For operations crossing trace and carrier storage: retain intent/admission before effects; retain
actual carrier results; publish the terminal decision only from validated receipts. A crash before
physical work permits safe retry; a crash after an effect but before terminal evidence requires
receipt-based reconciliation, never blind re-execution. Unknown physical state remains blocked.
Absence of a receipt alone is not proof that invocation never began; pre-effect retry requires
positive evidence of that safe boundary and writer quiescence.
Cleanup progress is separate from logical discard so deletion retries cannot invent success.

Nested discard fences and quiesces the owned subtree before deletion. A partial cleanup resumes
from exact retained identities; it never scans arbitrary directories for presumed ownership.
Unresolved live descendants block parent merge. An already merged descendant is represented by
the child's verified checkpoint and is not independently consumed a second time.

## Checkpoint and effect limits

The descriptor must name the exact trace cut, task/run association where present, bindings and
world revisions/receipts, effective grants, child ownership frontier, budget/cancellation evidence,
and provider/process/irreversible-effect constituents. Each constituent is verified, reconstructive,
not applicable, or unavailable with a reason. IDs and timestamps alone are not proof of restoration.

The initial copy-carrier path is a quiescent **verified copy**, not a kernel-atomic snapshot.
Trace-only scope registration/emission must explicitly lack a coupled-world capability and cannot
be advertised as an executable world fork. Missing required provider/process state forbids an
atomic-fork/resume claim. A reconstructive route is permitted only when its concrete replay
contract is implemented and safe; otherwise the requested operation is unavailable.

External irreversible effects do not vanish on discard. Unresolved escape/compensation evidence
blocks any operation claiming reversal. Initial emission records validated data only; materializing
effect adapters need separate intent/fence/receipt admission. Provider, process and live-observer
capabilities remain in their existing later phases rather than being simulated by record copies.

## Vocabulary mapping

Current `spawned`, `adopted`, `abandoned` and published-record projections remain version-1 read
semantics. They grant no scope authority. Future adapters may associate spawn with child creation,
adopt with selecting a verified child cut, abandon with removing an effective selection, and
publish with parent-visible semantic data. These are **not aliases**: abandon is not custody
deletion, adopt is not world merge, and publish is not user-workspace materialization. Any adapter
must retain explicit scope command/receipt evidence without reinterpreting old projection records.

## Proposed implementation slices (not yet published)

| Slice | Blocked by | Independently verifiable delivery |
| --- | --- | --- |
| A — Durable scope registration and fenced local emission | This contract's reviewed delivery | Configured closed schemas, authenticated root/ownership records, exact read/reopen/import, transactional writer admission and idempotent semantic emission. Explicitly trace-only: no world fork, provider execution or materialization claim |
| B — Reference-copy isolated fork and restart recovery | A | Verified origin descriptor, exact attenuated resources, separate custody, durable fork journal, parent/sibling preservation and receipt-based restart convergence through public APIs |
| C — Consume-once scope merge/discard | B | Explicit parent authority, quiescence, three-way conflict refusal, one terminal winner, parent-managed publication, subtree cleanup/recovery and immutable selected-child citations |

The remaining Phase 6 work stays on #19: attached-child design if required, nested/parallel
scheduling integration, optimized carriers and measured scaling, plus full algebraic/property
conformance. Completing A–C alone does not automatically satisfy all Phase 6 exit criteria.

Slice A permits application-data emission only, not caller-asserted external-effect outcomes or
world-state changes. Those require their later adapter receipts. Slice B starts with one active
bound resource using the existing single-capture authority model; coordinated multi-resource
forks require a separately reviewed checkpoint/publication contract before that support is claimed.

Required law/fault matrix for these slices: independent command IDs; equal/conflicting retries;
parent/child/sibling grant attenuation; wrong-parent and forged handle refusal; stale fences;
concurrent terminal races; unchanged current parent after discard (not rollback to fork time);
disjoint merge preservation and overlap refusal; nested discard; byte-equivalent reopen/import;
exact receipt replay after head advancement or terminal state; common-origin exclusion and nested
merge deduplication while preserving distinct repeated emission occurrences;
crashes before/after each physical/trace boundary; absent or contradictory receipts; unsupported
checkpoint constituents; and no publication or external-effect replay without explicit authority.

## Preservation and verification for this planning slice

| Existing capability | Risk | Evidence retained |
| --- | --- | --- |
| Canonical identity, owner paths and projection-v1 history | Semantic conflation | Existing record/projection/trace suites; no schema or source edits |
| Grants, custody, settlement and recovery | Accidental authority expansion | Existing grant/carrier/settlement suites; proposed operations clearly unimplemented |
| Node support and package examples | Documentation drift | Unchanged approved runtime policy; full installed-package verification and production build |

Local `pnpm sync:version`, `CI=true pnpm verify` (501 tests, zero skips, 100% configured coverage,
installed-package gates), `pnpm build:desktop`, diff checks and all seven local reference links pass.
Standards/specification reviews have no remaining findings after clarifying receipt replay and
history contribution identity. Runtime, protocol, tests, schemas and dependencies are unchanged.
No Python tests, scope laws, new crash protocol or new carrier behavior have been executed by
this documentation task. Hosted workflows remain disabled; no fresh cross-platform claim is made.
