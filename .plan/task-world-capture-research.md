# Task-World Capture Research

Status: Phase 3 Task 6 implementation input

Research date: 2026-08-12

Pinned Shepherd shipped revision: `a8196d4c453514836d06bd2fece91a03cdc37107` (`v0.3.0`)

Pinned Shepherd development revision: `d45074e0099d9ccafeed4a233702ad68ff8a2fa6`

## Primary sources and evidence boundary

Shepherd sources:

- [v0.3.0 checked quickstart](https://docs.shepherd-agents.ai/start/)
- [v0.3.0 runs concept](https://docs.shepherd-agents.ai/concepts/runs/)
- [v0.3.0 effects concept](https://docs.shepherd-agents.ai/concepts/effects/)
- [v0.3.0 permissions concept](https://docs.shepherd-agents.ai/concepts/permissions/)
- [generated v0.3.0 CLI reference](https://docs.shepherd-agents.ai/reference/cli/)
- [pinned shipped source tree](https://github.com/shepherd-agents/shepherd/tree/a8196d4c453514836d06bd2fece91a03cdc37107)
- [pinned development source tree](https://github.com/shepherd-agents/shepherd/tree/d45074e0099d9ccafeed4a233702ad68ff8a2fa6)

Owning platform sources:

- [Node.js `AbortSignal`](https://nodejs.org/api/globals.html#class-abortsignal)
- [Node.js filesystem API](https://nodejs.org/api/fs.html)
- [Git status background-refresh rules](https://git-scm.com/docs/git-status#_background_refresh)
- [Git worktree shared/per-worktree state](https://git-scm.com/docs/git-worktree)

Local normative inputs:

- [`architecture.md`](./architecture.md), run/world lifecycle and workspace carrier sections
- [`Agent-Runtime-Architecture.md`](./Agent-Runtime-Architecture.md), coordinated execution,
  trace, and environment versioning discussion
- [`implementation-roadmap.md`](./implementation-roadmap.md), Phase 3 Task 6
- [`parity-matrix.md`](./parity-matrix.md), retained-world and read-only changeset rows
- [`reference-copy-carrier-research.md`](./reference-copy-carrier-research.md)
- [`git-aware-custody-research.md`](./git-aware-custody-research.md)
- [`changeset-model-research.md`](./changeset-model-research.md)
- [`durable-task-execution.md`](../docs/durable-task-execution.md)
- [`durable-execution-control.md`](../docs/durable-execution-control.md), quiescence and fencing

Verified Shepherd `0.3.0` behavior is narrow but decisive: a task's work lands as a retained output
beside the user's files; the user worktree is unchanged before settlement; the output's changeset
and contents can be inspected; and every run remains a durable record, including failure. The
public docs do not publish the capture journal, fencing protocol, tool filesystem API, failure
retention rule, output-record schema, or exact restart behavior. The detailed contract below is
TypeScript-owned policy derived from the existing durable execution and carrier authorities. It is
not a Python-internal parity claim.

Node documents that abort notification is cooperative and that filesystem cancellation can be
best-effort after some writes have occurred. Therefore an aborted signal is not proof that a world
writer is quiescent. Git documents that ordinary `status` can refresh/write index stat data; any
background Git inspection of the user repository must use `--no-optional-locks` and still be
checked for preservation.

## Authority map

Task 6 composes existing authorities without replacing them:

| Evidence | Authority |
| --- | --- |
| Task/provider result, lifecycle, usage, artifacts, cancellation | Durable execution records and terminal cut |
| Base and captured head filesystem state | Authentic world carrier verification |
| Exact semantic difference | Workspace protocol v5 changeset |
| Git HEAD/index/sparse/ignore basis | Git-aware custody descriptor and movement check |
| Capture ownership, fence, and publication phase | Task-world capture journal |
| User-worktree non-mutation | Pre/post binding or Git-basis witnesses |

Provider text, tool claims, logs, process exit status, and a directory's mere existence cannot
stand in for carrier or capture evidence.

The current carrier API has an implementation gap that Task 6 must close: `verifyCustody` verifies
a mutable fork, while `snapshot(binding)` reads a user binding and creates a root revision. Neither
can publish the fork as an immutable child of its exact base. Add a carrier-owned operation such as
`captureCustody(custody, expectedBase)` that double-scans the fenced custody, atomically publishes
one immutable head with `parentRevisionId === expectedBase.revisionId`, and converges only when a
repeat proves byte-equivalent evidence. The execution layer must not synthesize a revision from a
manifest or call `snapshot` on the control-plane custody path.

## Public integration seam

The target public operation is asynchronous and accepts one binding in the initial core:

```ts
type CaptureTaskWorldOptions<I, O> = {
  readonly captureId: string;
  readonly store: TraceStore;
  readonly execution: TaskExecutionOptions<I, O>;
  readonly binding: WorkspaceBinding;
  readonly baseRevision: WorldRevision;
  readonly carrier: ReferenceCopyCarrier;
  readonly runner: RetainedWorldRunner<I, O>;
  readonly signal?: AbortSignal;
};

type RetainedWorldRunner<I, O> = {
  readonly runnerId: string;
  run(context: RetainedWorldExecutionContext<I, O>): Promise<TaskExecutionResult>;
};

type TaskWorldCaptureResult = {
  readonly captureId: string;
  readonly execution: TaskExecutionResult;
  readonly executionReceipt: TaskExecutionLedgerReceipt;
  readonly output: RetainedWorldOutput | null;
  readonly captureReceipt: TaskWorldCaptureReceipt;
};
```

Names are illustrative until protocol generation, but the semantics are required:

- `captureId` is a stable caller-supplied idempotency identity distinct from run ID, custody ID,
  output ID, and changeset ID;
- the execution options retain the exact existing run/task/provider/budget contract;
- the binding and carrier are authenticated package-created values;
- `baseRevision` is reopened and verified by that carrier before authority is issued;
- the runner is an authenticated runtime adapter, not an arbitrary structurally forged object;
- options are closed canonical data except for authenticated authority objects and optional signal;
- Task 6 does not add grants or multi-binding execution; those remain Phase 4.

The runner seam lets a deterministic test runner, provider/tool runtime, or future jailed placement
share the same custody lifecycle. It returns the transient execution result that durable execution
already validates and must bind that result to the configured run ID. The capture operation—not
the runner—owns durable terminal publication and world-output publication.

This cannot be implemented as a wrapper around an already committed `executeTaskDurably` call.
That API's terminal cut deliberately excludes later owner records. Task 6 therefore needs an
internal, exact terminal-contribution seam: after provider/tool execution but before the atomic
artifact/usage/outcome/lifecycle terminal group, it quiesces and captures the world, and supplies
the authenticated capture record as a causal parent of the outcome/lifecycle terminal. The
existing no-world path must preserve its current public result and record graph.

## Retained world execution context

The runtime issues a frozen context only after base verification and fork publication:

```ts
type RetainedWorldExecutionContext<I, O> = {
  readonly execution: TaskExecutionOptions<I, O>;
  readonly world: RetainedWorldCapability;
  readonly signal: AbortSignal;
  readonly captureFence: number;
};
```

`RetainedWorldCapability` identifies the binding, custody ID, base revision, and current fence. Its
filesystem operations accept canonical binding-relative paths; they reject absolute paths,
traversal, `.vcscore`, symlink escape, unsupported node types, and access after fence loss. Raw
custody paths may be exposed only to an audited placement/launcher adapter that needs a process
working directory; ordinary providers and model messages receive no host path.

Provider generation does not mutate files by itself. Mutations occur only when a runtime tool or
bodied deterministic runner invokes the retained-world capability, or when an isolated process
launched by an authenticated placement operates inside the custody root. Every in-process tool
operation checks the current capture fence immediately before materialization. An external process
must be placed in a sandbox whose writable root is the retained custody, never the user binding.

Task 6 does not claim syscall enforcement from path validation. Until the Phase 4 jail adapters
exist, the initial executor is explicitly deterministic/in-process or advisory and its actual
enforcement is recorded.

## Capture lifecycle

Use one durable state machine:

```text
prepared → forked → executing → quiescing → captured → retained
                  ↘                         ↘
                   recovery-required        recovery-required
```

`prepared` durably binds capture ID, run creation identity, binding, carrier, exact base revision,
runner identity, requested enforcement, and resource limits. `forked` cites the isolated custody.
`executing` additionally cites the current first-writer claim and fencing token. `quiescing`
records that new writes are denied while existing authority is being stopped. `captured` cites a
verified immutable head revision. `retained` atomically publishes the changeset and retained-output
record. Recovery status is a classification, not a second lifecycle authority.

Required order:

1. Validate all caller inputs, carrier authority, and limits before the first append; then retain
   the existing durable execution creation evidence. A pre-aborted valid execution follows the
   existing durable cancellation contract without creating a fork.
2. Reopen/verify the base and obtain the pre-execution user-worktree/basis witness.
3. Atomically claim the capture ID and append `prepared`.
4. Fork isolated custody and append `forked`; the user binding remains read-only.
5. Acquire a monotonic execution fence and invoke the runner with the isolated capability.
6. Before terminal publication, deny new writes, stop/await the runner, and prove quiescence.
7. Use the carrier-owned custody-capture operation to publish its immutable parent-linked head,
   then create the Task 5 changeset.
8. Obtain a post-execution user-worktree/basis witness and compare it with the pre-witness.
9. Atomically append the retained-output/capture record with the existing artifacts, usage,
   outcome, and lifecycle terminal, then publish the terminal cut that includes this causal chain.

No `RetainedWorldOutput` is returned before steps 6–9 finish. Snapshot, fork, head publication,
changeset, and trace citations must use the existing configured identities rather than recalculate
parallel forms.

## Retained output and trace citation

Publish a closed world-capture record before the outcome. It contains only upstream evidence:

```ts
type RetainedWorldCaptureRecord = {
  readonly schemaVersion: number;
  readonly outputId: string;
  readonly captureId: string;
  readonly runId: string;
  readonly bindingId: string;
  readonly baseRevisionId: string;
  readonly headRevisionId: string;
  readonly custodyId: string;
  readonly changesetId: string;
  readonly userBasisBefore: string;
  readonly userBasisAfter: string;
  readonly status: "retained";
};
```

The public result is an immutable projection joining that record with downstream terminal evidence:

```ts
type RetainedWorldOutput = {
  readonly schemaVersion: number;
  readonly outputId: string;
  readonly captureId: string;
  readonly runId: string;
  readonly bindingId: string;
  readonly baseRevisionId: string;
  readonly headRevisionId: string;
  readonly custodyId: string;
  readonly changesetId: string;
  readonly captureRecordId: string;
  readonly executionOutcomeId: string;
  readonly executionCut: TraceCut;
  readonly userBasisBefore: string;
  readonly userBasisAfter: string;
  readonly status: "retained";
};
```

The output ID is the configured canonical digest of the capture record's semantic citations;
storage paths, mutable receipts, downstream outcome ID, and downstream cut are excluded. The
custody ID is included because it is the exact owned content handle, not its host path. The
pre/post witness values must be equal for a normally retained output.

Task 6 appends a world-capture intent before runner invocation. When a world is safely captured,
the retained capture record joins the existing terminal append group and is included in the one
terminal cut. The outcome and lifecycle terminal causally cite it; recovery and inspection can
therefore reconstruct the same world attachment from the immutable cut. Task 6 must not commit the
old terminal cut first and append world evidence afterward, and must never rewrite a published cut.

The record cannot cite the outcome or terminal cut that causally follow it. Those fields exist only
on the verified public projection after cut publication; this avoids a content-identity/causality
cycle. A capture failure analogously records the exact failed phase before the failure outcome.

The retained record cites the exact terminal outcome even when that outcome is failed, exhausted,
or cancelled. It is not a provider artifact and must not be inserted into the ordered provider
artifact list.

## Failure, exhaustion, and cancellation

- Invalid options, unauthenticated authority, and invalid base fail before execution creation and
  leave no lifecycle evidence. A valid pre-aborted execution retains the existing creation and
  cancelled terminal evidence but creates no fork, head, changeset, or retained world output.
- Once a fork exists, partial world changes are evidence. A quiesced runner ending as `finished`,
  `failed`, `exhausted`, or `cancelled` produces a verified retained output, including an empty
  changeset. Terminal status never rewrites the captured bytes.
- If provider output fails schema validation after tools changed the world, retain those verified
  partial changes alongside the failed execution outcome.
- Abort notification immediately fences new in-process mutations, but Node abort alone is not
  quiescence. Publication waits for runner acknowledgement/process exit and final custody verify.
- If the runner ignores abort, an external process cannot be stopped, a lease expires while it may
  still write, or quiescence is otherwise unprovable, publish `recovery-required`, not a retained
  output. Never snapshot concurrently with a possibly authoritative writer.
- A carrier/head/changeset failure retains the mutable custody for repair, records the exact failed
  phase in durable terminal failure evidence, and returns/throws a structured capture error with
  recovery identity. It does not publish a finished-world claim, fabricate an empty output, or
  delete diagnostic custody.
- Failure before the runner obtains write authority may safely discard an unmodified fork through
  an explicit cleanup transition; automatic cleanup must itself be journaled and idempotent.

## Concurrency, fencing, and idempotency

Reuse the durable run claim semantics: one live writer per `(captureId, bindingId)`, monotonic
fencing tokens, exact expected-head comparison, and claim expiry. The capture claim and durable
execution claim must be acquired in a fixed configured order to avoid deadlock.

Every mutation, quiescence acknowledgement, head publication, and retained-output append checks
the exact current fence. A stale worker may read its private custody for diagnostics but cannot
mutate, capture, retain, or discard it. A process that cannot be physically fenced prevents safe
publication.

Repeating the same `captureId` with byte-equivalent prepared evidence:

- returns the exact retained result when committed;
- resumes `prepared`/`forked` only through a configured recovery command;
- repairs `captured` by publishing the already verified changeset/output without invoking the
  runner again;
- refuses automatic replay from `executing` because tool/provider effects may have occurred;
- returns the original `recovery-required` classification until an explicit repair establishes
  quiescence;
- conflicts before mutation when any task, input, provider, budget, binding, base, runner, or limit
  evidence differs.

No retry may create a second custody or invoke the runner twice after `executing` is durable. Lost
acknowledgements replay by exact content identity.

## User-worktree non-mutation evidence

Task 6 must prove observed equivalence, not claim causal omniscience:

- For a copy-world binding, capture and verify a pre-run observation revision, then repeat after
  runner quiescence; compare semantic content identities and binding identity.
- For Git-aware `git-head` or `worktree`, use Task 4's semantic basis-movement classifier and also
  verify byte preservation of HEAD, refs, index, config, sparse metadata, and relevant user files.
- Run Git observations with no optional locks. Do not checkout, reset, add, refresh-index, commit,
  stash, fetch, worktree-add/remove, submodule-update, gc, or prune.
- The control-plane writes caused by capture are excluded by the configured protected-root rule,
  but the exact control-root identity is checked for alias/path escape.

If the witness moves, the system cannot attribute the change safely to the user, another process,
or an escaped runner. It retains custody for diagnosis, records `user-basis-moved`, and refuses the
normal retained-output claim. Later `apply` semantics do not excuse movement during the capture
boundary.

## Git-aware execution behavior

The Task 4 adapter prepares an isolated Git-aware retained child whose object/index/HEAD evidence is
independent of the user's administrative state. Task 6 may run Git commands only against that child.
It must not create a linked worktree sharing the user's common directory because linked worktrees
share refs and objects.

- `git-head` execution begins from the custodied commit tree and isolated detached/private Git
  state; staged, unstaged, untracked, and ignored user content is absent by definition.
- `worktree` execution begins from the custodied composite basis, including tracked present and
  untracked non-ignored files plus private index/sparse evidence.
- `none` has no adopted settlement basis and cannot enter this Git-aware capture seam without an
  explicit separately verified base revision.
- Submodules and embedded repositories follow Task 4's authority boundary; no recursive write
  authority is inferred.
- Object alternates may inform provenance but the retained child cannot require them for restart.

Task 6 still emits the canonical copy-world v5 changeset for supported nodes. Gitlink and richer
Git-aware inspection remain Task 7 and require the documented protocol extension rather than
silent reinterpretation.

## Restart and recovery

Reopen from the capture journal and exact descriptors, never by scanning directories and guessing:

| Durable phase | Recovery rule |
| --- | --- |
| absent | Start normally |
| prepared | Explicit command may create the one fork |
| forked, never executing | Explicit command may acquire a fresh fence and start once |
| executing | Uncertain; do not rerun or publish until quiescence is independently proven |
| quiescing | Continue termination/fencing verification; never snapshot early |
| captured | Reverify head and deterministically rebuild/reopen the same changeset |
| retained | Return the exact immutable result without runner/provider invocation |
| recovery-required | Require a phase-specific repair or explicit discard decision |

Recovery verifies the execution cut/outcome, claim history, carrier descriptors, base/head bytes,
changeset identity, output citations, user-basis witnesses, and ownership before returning. Missing,
orphaned, duplicate, conflicting, corrupt, or reordered evidence fails closed.

Replay means reopening the recorded result. Re-executing a provider or filesystem tool is a new
capture/run identity unless a future effect-level replay contract proves every boundary safe.

## Control-plane and resource policy

The entire configured `.vcscore` root, carrier journals, SQLite files, descriptors, staging paths,
and aliases are outside task authority. Capability path validation is repeated at every operation;
placement adapters receive structured arguments, never shell fragments. Cleanup targets only an
exact owned custody beneath the configured carrier root.

All static values come from versioned configuration. Task 6 needs configured limits for:

- maximum retained bindings/outputs per run (one in the initial core);
- capture claim/lease duration and quiescence deadline;
- maximum world operations and cumulative bytes written by controlled tools;
- maximum custody/world size and entries before and after execution;
- maximum output-record bytes and recovery attempts;
- bounded carrier verification/copy concurrency;
- stable lifecycle names, schema references, identity prefixes, and error codes.

Existing task budget, copy-carrier limits, and changeset limits remain independently enforced; Task
6 composes rather than weakens them. Limit exhaustion becomes an exact exhausted/failed execution
outcome when execution caused it, followed by safe partial capture if quiescence is proven.

Stable capture errors must distinguish invalid authority/input, base unavailable/corrupt, claim
lost/fenced/conflict, fork failure, runner failure before a terminal result, quiescence timeout,
head capture/verification failure, changeset failure, user-basis movement, output publication
failure, and recovery-required/corrupt evidence. Diagnostics may add safe detail without changing
the code.

## TDD and conformance matrix

### Successful capture

- clean base, file add/edit/delete, directory and mode changes, symlink target change;
- deterministic runner and static provider produce one retained output and exact v5 changeset;
- task reads/writes only isolated custody; user bytes and Git state remain identical;
- empty change still yields a retained output with deterministic empty changeset;
- failed provider/output validation after writes retains the partial world;
- exhausted and cooperatively cancelled executions retain safely quiesced partial worlds;
- reopen in a fresh carrier/store process returns identical output and changeset without execution.

### Authority and security

- traversal, absolute paths, `.vcscore`, symlink escape, unsupported nodes, and stale fences fail;
- provider/model content cannot forge runner, carrier, binding, custody, or output authority;
- raw host paths never enter provider requests or canonical output records;
- arbitrary process runner is refused without an authenticated placement;
- copy/advisory enforcement is reported honestly and never labeled jailed.

### Concurrency and recovery

- two callers for one capture produce one fork, runner invocation, head, changeset, and output;
- unequal repeat conflicts before mutation; equal committed repeat returns exact evidence;
- lease takeover before execution is command-authorized and monotonic;
- stale worker loses every write and publication boundary;
- interruption after prepared, forked, executing, quiesced, head, changeset, and output append follows
  the recovery table;
- an uncertain executing runner is never automatically reinvoked or snapshotted;
- lost acknowledgement after capture/output publication repairs without duplicate records.

### Non-mutation and Git

- concurrent user edit, HEAD/ref/index/sparse/submodule movement fails the equality witness;
- attached, detached, and custodied unborn/worktree bases follow Task 4 semantics;
- staged/unstaged/untracked/ignored/sparse state is reproduced only in isolated custody;
- linked worktree/common Git state, config, refs, index, reflogs, and object inventory are unchanged;
- alternates disappear after fork and restart still verifies retained output;
- submodule/nested-repository writes require explicit authority.

### Failures and limits

- disk full, permission denied, unsupported filesystem metadata, corrupt blob/descriptor, and
  interrupted atomic rename publish no false output;
- task/world byte, operation, entry, duration, record, and concurrency limits fail with exact code;
- abort during a write proves quiescence before capture; best-effort cancellation alone is rejected;
- cleanup/discard is exact, idempotent, parent-preserving, and never automatic after uncertain work.

## Task 7 boundary

Task 6 publishes the immutable retained-output identity and canonical v5 changeset citation. Task 7
adds read-only lookup, pagination, retained byte/text reads, safe bounded previews, derived
rename/copy projections, Gitlink presentation, and CLI/read-selector integration. Inspection reads
existing evidence only; it never runs the task, mutates custody, changes settlement state, or
creates a competing changeset model.

Settlement compare-and-swap, `select`, `apply`, `release`, and user-facing `discard` remain later
Phase 3 tasks. Task 6 carrier cleanup is an internal recovery operation and is not the consume-once
settlement decision.

## Remaining Shepherd oracle gaps

Before claiming Python `0.3.0` parity, run the pinned implementation across success, provider/tool
failure, exhaustion, cancellation, restart, concurrent capture, dirty Git state, submodules, and
interrupted custody publication. Capture its output schema, partial-work retention rule, operation
journal, errors, fencing, and exact trace citations. Current verified parity remains limited to the
public fact that retained work is inspectable beside unchanged user files and is settled explicitly.
