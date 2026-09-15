# Phase 9 task-as-value meta-agents exit audit

Audit: 2.20.1, 2026-09-15, #169. Delivered on branch `codex/phase-9-1-7-task-as-value` together
with #163–#168.

Verdict: **complete for the documented scope**. Every roadmap work item and exit criterion maps to
public entry points, normative documentation, and repeatable tests, and both epic exit checkboxes
are supported below. Phase 9 reaches the roadmap milestone, L3 paper programming-model parity, for
the documented scope: task values as data, durable child run handles, record-proven attenuated
delegation, supervisor operations, provenance-gated revision and synthesis, typed result threading,
and isolated nested meta-agents. No live provider adapter, no automatic retry policy, and no
transfer of live process or provider state on handoff is claimed. Phase 10 (research applications)
remains.

## Scope and evidence boundary

The [roadmap](./implementation-roadmap.md#phase-9--task-as-value-meta-agents) lists eight work
items and five exit criteria. [Epic #22](https://github.com/avnionur/shepherd-typescript/issues/22)
groups them into five work checkboxes and two exit checkboxes. Children: contract #163, task values
and handles #164, delegated authority #165, supervisor operations #166, revision and synthesis
#167, result threading and nested isolation #168, and this audit #169, delivered together.

Evidence is local: macOS arm64 (Node 24.17.0, APFS) for the full verification, including the two
process-kill tests. Delegation is trace-only (no world custody is involved), so no Linux container
run is required for this phase. Hosted workflows remain disabled at the owner's request.

## Roadmap work items

| Work item (unchanged) | Delivery | Implementation, documentation, and evidence |
| --- | --- | --- |
| Allow validated task descriptors as inputs and outputs | #164 | `readTaskValue`, `taskValueOf`, `taskDescriptorOf`, `schema.task()`, [task values](../docs/task-values.md), [`task-value-v1`](../spec/schemas/task-value-v1.schema.json), [task value tests](../test/task/task-value.test.ts) |
| Add durable child run handles | #164 | `openChildRun`, `runChildRun`, `inspectChildRun`, reserved `delegation:sha256:` owners, derived `delegation-run:sha256:` run identities, opened and completion records, [child run tests](../test/delegation/child-run.test.ts), [evidence tests](../test/delegation/delegation-evidence.test.ts), [process crash tests](../test/delegation/delegation-crash.test.ts) |
| Implement authority-preserving task delegation | #165 | Root declaration and parent-handle ceilings through the scope attenuation rule, metric-wise budget attenuation, bounded depth, origin cuts, `DelegationAuthorityError`, [delegated authority](../docs/delegated-authority.md), [seeded law suite](../test/delegation/delegation-laws.test.ts) over [`delegation-law.config.json`](../config/delegation-law.config.json) |
| Implement supervisor operations: observe, inject, handoff, discard/retry | #166 | `observeChildRun`, `injectChildRunContext`, `handoffChildRun`, `discardChildRun`, `retryChildRun`, `acceptChildRunResult`, [supervisor operations](../docs/supervisor-operations.md), [operation tests](../test/delegation/supervisor-operations.test.ts), [context recovery](../test/delegation/context-recovery.test.ts) |
| Permit controlled task revision and synthesized helper tasks | #167 | `revised` provenance keeping the source task identity and listing exactly the differing configured fields; `synthesized` provenance citing the producing record; revision retries citing the replay point; [task revision](../docs/task-revision.md), [revision tests](../test/delegation/task-revision.test.ts) |
| Add provenance and approval for model-generated task definitions | #167 | `approveChildRunTask`, `approval_pending` and `rejected` statuses, `DelegationApprovalRequiredError`, [`delegation-approval-v1`](../spec/schemas/delegation-approval-v1.schema.json), [execution boundary tests](../test/delegation/execution-boundary.test.ts) |
| Implement retained result threading and typed projection | #168 | `projectChildRunResult` with caller-schema proof, `projectDelegationTree` bounded by `delegation.limits.maxTreeEntries`, [result threading](../docs/result-threading.md), [projection tests](../test/delegation/result-projection.test.ts) |
| Support nested meta-agents without scope contamination | #168 | Program-serviced children open grandchildren under their own authenticated handle; grandchild records stay on their own owner paths; [isolation rules](../docs/result-threading.md#isolation-rules), [nested isolation tests](../test/delegation/nested-isolation.test.ts), [conformance scenario](../test/delegation/delegation-conformance.test.ts) |

## Roadmap exit criteria

| Criterion (unchanged) | Evidence | Outcome |
| --- | --- | --- |
| A supervisor can accept a worker task as data, run it in a child, inspect its trace, and merge or discard | The conformance scenario runs a planner whose output is typed `schema.task()`, accepts it, projects the task value with the same schema, opens a worker under a root declaration with that value as `synthesized` data, observes it through `observeChildRun` (deliveries equal the retained records of both owners), inspects the completion against the child's terminal record and cut, discards it, retries with an approved revision, and accepts and threads the finished result; the imported archive yields identical inspections, trees, and typed projection | Verified |
| Child authority never exceeds delegated authority | The seeded law suite proves containment in the grant, the parent's effective authority, and the ceiling over random chains; the conformance grandchild is refused for a resource the child never held and for a larger budget, and the admitted grandchild's `write` atom is attenuated away with its ceiling equal to the child's effective authority; inspection re-derives effective authority and refuses evidence that disagrees | Verified |
| Revised task identity and causal replay point are explicit | A revision retry retains `provenance.source_task`, a task lock with the source `task_id` and a different artifact digest, and `predecessor: { handle_id, decision_record_id, cut_id }`; the retry cut resolves through the predecessor's discard decision, and the same evidence reads from reopened, read-only, and imported stores | Verified |
| Meta-meta-agent nesting passes isolation tests | Grandchild records live only on the grandchild's handle and child run owner paths; no record on the child's paths cites or names a grandchild; the root's tree lists only the child and the grandchild's supervisor tree is empty; discarding the child removes everything threaded through it from the root's projection while the grandchild stays accepted on its own handle | Verified |
| Dynamic task code cannot bypass the execution boundary | Synthesized values carrying a function, an extra key, a foreign `$ref`, unsupported grammar, non-canonical form, or a lock mismatch are refused with `TypeError` before any record; revised and synthesized values are `approval_pending` until the current supervisor approves; an approved value executes only through the caller's provider or program under the derived child run identity, and no other owner path gains records | Verified |

Epic exit checkboxes: "Supervisors can run, inspect, merge, or discard child task values" is
supported by rows one and three. "Delegation cannot amplify authority and nested meta-agents remain
isolated" is supported by rows two, four, and five.

## Recovery classification

| Failure | Classification | Recovery |
| --- | --- | --- |
| Child killed after its durable start, before its terminal | Child `started`, handle `running` | Discard, re-execution, and `recoverTaskDurably` are refused (started runs fail closed); a cancellation request bound to the running head, acknowledged with the dead worker's retained claim authority, settles the child `cancelled`; `runChildRun` then retains the completion without invoking the program, and the supervisor discards and retries; process test |
| Child killed after its terminal, before the completion record | Child `committed`, handle `settling` | The next `runChildRun` retains the completion citing the child terminal and cut without re-executing; the result is accepted and projected; process test |
| Crash between the consumption record and the child's creation | Handle `ready` with a retained consumption | The next `runChildRun` reuses exactly the consumed injections and retains no second consumption record |
| Crash after the child terminal, before its cut | Child `terminal_pending_cut`, handle `settling` | `runChildRun` is refused with `DelegationStatusError` until the cut is repaired through durable recovery |
| Command under a moved head, from a former supervisor, or beyond the parent authority | No record | `DelegationHeadConflictError`, `DelegationSupervisorError`, or `DelegationAuthorityError` before writing |

## Independent review

A self-review of `src/delegation` covered command idempotency across handles, head comparison in
every command, the supervisor chain through handoffs, the consumption record rule, decision
terminality, the tree bound, and projection digests. It found one defect, fixed with a regression
test in [`delegation-review.test.ts`](../test/delegation/delegation-review.test.ts):

- an opening or retry command could reuse a command identity that a handle command (injection,
  handoff, approval, or decision) on another handle had already retained, because the opening
  append intent differs from the command append intent; `openChildRun` and `retryChildRun` now
  refuse such an identity with `DelegationCommandConflictError` before any record, matching the
  existing refusal of a handle command that reuses an opening identity.

No other defect was found: a command that reuses an opening identity, a head that moves between
inspection and append, a command from a former supervisor, a repeated or late consumption record,
and a record after a decision were already refused with tests.

## Verification (2.20.1)

- `pnpm sync:version`, `pnpm generate:api-reference`, `CI=true pnpm verify`, and `pnpm build:desktop`
  pass on macOS arm64 (Node 24.17.0): 720 tests, zero failures, zero skips, 100% configured line,
  branch, and function coverage, protocol artifact and API reference drift checks, and installed
  package gates.
- The process tests kill a program-serviced child after its durable start and a child after its
  terminal record; both recover through the documented paths above.

## Limits

- No execution-history relation records (`spawned`, `adopted`, `abandoned`) are written; the
  projection layer's untyped relations remain upstream-compatible and unused by delegation.
- No live provider adapter ships; provider-serviced children use caller-supplied providers.
- Handoff transfers supervisor ownership of the handle only; no process, provider session, or
  world state moves.
- Injection composes the provider request deterministically and retains what the child saw; it does
  not claim to mutate a provider-side conversation.
- No automatic retry policy and no automatic discard of failed children; a started child whose
  worker died stays fail-closed until a holder of its claim authority cancels it.
