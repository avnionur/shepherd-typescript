# Result threading and nested meta-agents

Implementation: [`src/delegation/projection.ts`](../src/delegation/projection.ts), reading
[`src/delegation/inspection.ts`](../src/delegation/inspection.ts) and
[`src/task/value.ts`](../src/task/value.ts). Public entry point:
[`src/facades/delegation.ts`](../src/facades/delegation.ts) (`./delegation`), with root exports from
[`src/index.ts`](../src/index.ts). Configuration: `delegation.limits.maxTreeEntries` and
`delegation.treeRootKinds` in [`protocol.config.json`](../protocol.config.json). Tests:
[`nested-isolation.test.ts`](../test/delegation/nested-isolation.test.ts) and
[`result-projection.test.ts`](../test/delegation/result-projection.test.ts). Design constraints:
[task-as-value contract](../.plan/task-as-value-contract.md). Decisions that produce the retained
evidence: [supervisor operations](./supervisor-operations.md). Authority rules:
[delegated authority](./delegated-authority.md).

## Result projection

`projectChildRunResult(store, handleId, options?)` folds one handle with `inspectChildRun` and
projects its retained result. Only an accepted handle carries a value; every other status projects
`value: null` and `output_id: null`, so a discarded handle contributes nothing upward.

| Field | Meaning |
| --- | --- |
| `handle_id`, `child_run_id` | Handle identity and derived child run identity |
| `status` | Derived handle status |
| `task` | Retained task value whose output schema typed the value |
| `value` | Validated canonical accepted output, or null |
| `output_id` | Digest of the canonical accepted output retained by the accept decision, or null |
| `decision_record_id` | Retained accept or discard decision record, or null |
| `child_outcome_record_id` | Child outcome record cited by the accept decision, or null |

For an `accepted` handle the retained child outcome value is re-validated against the retained
task value's output schema, rehydrated through `taskDescriptorOf(task).parseOutput`, normalized,
and its digest must equal the decision's `output_id`. A void output projects as `null` with a
non-null `output_id`.

`options.schema` is an optional caller schema created by the schema factory. Its document must
canonically equal the retained `task.artifact.output_schema`; when it does, the projection is typed
as the schema's inferred value type, and when it does not, `TypeError` is raised before any value is
returned. The schema proves the static type of the canonical value; it does not reparse it.

The projection appends nothing and works on reopened, read-only, and imported stores.

## Tree projection

`projectDelegationTree(store, root)` folds the direct handles under one root into a typed tree.

| Root | Direct children |
| --- | --- |
| `{ kind: "handle", handleId }` | Handles whose retained parent is that handle; the root handle must be retained |
| `{ kind: "supervisor", supervisorId }` | Handles with a root parent whose current supervisor, after every retained handoff, is that supervisor |

Handles are enumerated through the store's schema-based owner listing over the opened record
schema, paged by `limits.maxTreeEntries`, and every candidate is folded with `inspectChildRun`.
Handles outside the root are not folded. Each entry carries the handle:

| Field | Meaning |
| --- | --- |
| `handle_id`, `child_run_id`, `depth` | Identity and nesting depth |
| `status`, `supervisor_id` | Derived status and current supervisor |
| `authority`, `budget` | Retained ceiling and effective resource authority, budget ceiling and child budget |
| `task` | Retained task value |
| `result` | The result projection above |

Entries are in canonical handle-identity order. A handed-off handle appears under its successor
and never under a former supervisor. The projection lists at most `limits.maxTreeEntries` direct
handles; a larger tree is refused with `TypeError` and no partial tree is returned, because the bound
is a projection bound rather than a defect in retained evidence.

## Isolation rules

Nested meta-agents remain isolated. A program-serviced child receives its authenticated handle and
opens grandchildren under it; the evidence rules are:

- A grandchild's effective authority is contained in the child's effective authority, which is
  contained in the root ceiling, and the grandchild budget never exceeds the child budget. A grant
  naming a resource outside the child's authority, or a budget above the child's, is refused with
  `DelegationAuthorityError` before any record.
- Grandchild records live only on the grandchild's own handle and child run owner paths. No record
  on the child's handle path or child run path cites or names a grandchild handle, child run, or
  record; the origin cut a grandchild publishes through the child handle head is retained on the
  grandchild's path.
- Grandchildren are never listed in the root's tree and none of their records, authority, or values
  appear in it. A parent's accepted value is the only thing a grandchild contributes upward: the
  child's program reads the accepted grandchild value through `projectChildRunResult` and embeds it
  in its own output, which the root accepts and projects.
- Discarding a handle removes its accepted value and everything threaded through it from the
  parent's projection. A grandchild the discarded child accepted stays accepted on its own handle,
  and the child's tree still lists it, but the root's tree shows the child with a null value.

## Failures

| Failure | Behavior |
| --- | --- |
| Handle or handle root not retained | `DelegationEvidenceError` |
| Inconsistent retained evidence on a projected handle | `DelegationEvidenceError` from the fold |
| Forged accept `output_id` or swapped outcome citation | `DelegationEvidenceError` from the fold |
| Accepted outcome fails the retained output schema or its digest | `DelegationEvidenceError` from the projection |
| Caller schema not created by the schema factory | `TypeError` |
| Caller schema document differs from the retained output schema | `TypeError`; no value returned |
| Malformed handle identity, options, or root | `TypeError` |
| Direct handles exceed `limits.maxTreeEntries` | `TypeError`; no partial tree |
