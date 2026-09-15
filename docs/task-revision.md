# Task revision and synthesis

Implementation: [`src/delegation/handle.ts`](../src/delegation/handle.ts) (provenance reading at
opening and retry), [`src/delegation/commands.ts`](../src/delegation/commands.ts)
(`approveChildRunTask`), [`src/delegation/records.ts`](../src/delegation/records.ts) (provenance and
approval bodies, revision differences), and
[`src/task/value-codec.ts`](../src/task/value-codec.ts) (`readTaskValue`). Public entry point:
[`src/facades/delegation.ts`](../src/facades/delegation.ts) (`./delegation`), with root exports from
[`src/index.ts`](../src/index.ts). Configuration: `delegation.provenanceKinds`,
`delegation.revisionFields`, and `delegation.approvalVerdicts` in
[`protocol.config.json`](../protocol.config.json). Tests:
[`task-revision.test.ts`](../test/delegation/task-revision.test.ts) and
[`execution-boundary.test.ts`](../test/delegation/execution-boundary.test.ts). Design constraints:
[task-as-value contract](../.plan/task-as-value-contract.md).

## Provenance

Every handle retains where its task value came from. `openChildRun` and `retryChildRun` accept a
`provenance` declaration; a descriptor created by `task()` defaults to `declared`, and a task value
supplied as data must state its provenance explicitly or is refused with `TypeError`.

| Kind | Declaration | Retained | Rule |
| --- | --- | --- | --- |
| `declared` | `{ kind: "declared" }` | `{ kind }` | A package-created descriptor or a value the caller vouches for; no approval needed |
| `revised` | `{ kind: "revised", source: TaskValue, changes: RevisionField[] }` | `{ kind, source_task, fields }` | The task keeps the source `task_id`, differs from the source in at least one of `delegation.revisionFields` (`instruction`, `input_schema`, `output_schema`, `task_version`), and `changes` names exactly the differing fields in configured order |
| `synthesized` | `{ kind: "synthesized", producer: { run_id, record_id } }` | `{ kind, source_run_id, source_record_id }` | The producer record must be retained on the producing run's owner path in the same store |

A revised or synthesized value goes through `readTaskValue` before any record is written: exact
keys, plain data only, the supported schema grammar, the protocol version, and a lock that
re-derives from the artifact. Functions, extra keys, foreign `$ref` documents, unsupported grammar,
and artifacts not in builder-normalized form are refused. There is no normalization step: a model
that emits a task definition must emit the canonical form, exactly what a task typed with
`schema.task()` yields when parsed.

## Approval

Handles with `revised` or `synthesized` provenance open in status `approval_pending`.
`runChildRun` refuses them with `DelegationApprovalRequiredError` and writes no child record.

`approveChildRunTask(store, { handle, commandId, supervisorId, verdict, approverId?, reason? })`
retains one `shepherd.delegation.approval.v1` record with the verdict, the approver identity
(defaulting to the supervisor), the optional reason, and the digest of the approved task artifact.
Only the current supervisor may approve, the verdict is one of `delegation.approvalVerdicts`, and
exactly one approval is retained per handle:

- `approved` moves the handle to `ready`; it then runs like a declared handle;
- `rejected` is terminal for execution: the handle is `rejected`, `runChildRun` and injection are
  refused, and the handle may still be discarded for bookkeeping or handed off.

Approval of a `declared` handle, a second approval, and an approval from a former supervisor are
refused without writing. Inspection refuses an approval whose task digest disagrees with the
retained task value or that follows a consumption or completion record.

## Revision retries

A retry that supplies a revised task value retains both `provenance` (the source task and the
differing fields) and `predecessor` (the discarded handle, its decision record, and the retry cut).
Together they make the revised task identity and the causal replay point explicit and readable from
any reopened or imported store: the revised identity is `task.artifact_lock`, the source identity is
`provenance.source_task.artifact_lock`, and the replay point is `predecessor.cut_id` through
`predecessor.decision_record_id`. A revised successor requires its own approval before it runs.

## Execution boundary

A task value carries no code, and no path in the runtime evaluates one. A synthesized definition
reaches execution only as a validated artifact whose instruction and schemas are handed to the
caller's provider, or whose input is handed to the caller's program, under the derived child run
identity (`delegation-run:sha256:…`). The boundary is enforced by:

- `readTaskValue` refusing anything that is not a canonical artifact and lock pair;
- `schema.task()` typing model output as a task value, so a model-serviced task can emit a
  definition without any escape hatch in the schema grammar;
- `approval_pending` gating on every non-declared value, with refusal before any child record;
- the durable execution codec, which retains the child's task lock, input, provider, and outcome on
  the child run owner path and nowhere else.

## Failures

| Failure | Behavior |
| --- | --- |
| Task value without provenance | `TypeError`; no record |
| Revised value with a different task identity, no difference, or a `changes` list that is not exactly the differing fields | `TypeError`; no record |
| Synthesized producer record absent or retained by another owner | `DelegationEvidenceError`; no record |
| Malformed synthesized artifact (extra key, function, foreign `$ref`, unsupported grammar, non-canonical form) | `TypeError`; no record |
| `runChildRun` before approval | `DelegationApprovalRequiredError`; no child record |
| Approval of a declared handle, a second approval, or approval after rejection | `DelegationStatusError`; no record |
| Approval from a former supervisor | `DelegationSupervisorError`; no record |
| Opening a child under a rejected or discarded parent handle | `DelegationStatusError`; no record |
