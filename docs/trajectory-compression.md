# Trajectory compression

Implementation:
[`src/applications/trajectory-compression.ts`](../src/applications/trajectory-compression.ts),
[`src/applications/compression-records.ts`](../src/applications/compression-records.ts), and
[`src/applications/compression-types.ts`](../src/applications/compression-types.ts). Public entry
point: [`src/facades/applications.ts`](../src/facades/applications.ts) (`./applications`:
`runTrajectoryCompression`, `inspectTrajectoryCompression`), with root exports from
[`src/index.ts`](../src/index.ts). Configuration: `applications.compression` and
`applications.limits` in [`protocol.config.json`](../protocol.config.json) (applications protocol
v3; the fork-step policy since applications protocol v7); the repository's Appendix D protocol is the `compression` definition in
[`config/research-applications.config.json`](../config/research-applications.config.json).
Generated schema:
[`application-compression-v1.schema.json`](../spec/schemas/application-compression-v1.schema.json).
Tests: [`trajectory-compression.test.ts`](../test/applications/trajectory-compression.test.ts),
[`trajectory-compression-failures.test.ts`](
../test/applications/trajectory-compression-failures.test.ts),
[`trajectory-compression-crash.test.ts`](../test/applications/trajectory-compression-crash.test.ts),
[`trajectory-compression-recovery.test.ts`](
../test/applications/trajectory-compression-recovery.test.ts),
[`compression-records.test.ts`](../test/applications/compression-records.test.ts), and
[`trajectory-compression-worlds.test.ts`](../test/applications/trajectory-compression-worlds.test.ts). Manifest
rules: [application manifests](./application-manifests.md). Design constraints:
[research applications contract](../.plan/research-applications-contract.md).

## Composition

Compression adds no substrate. It records the source trajectory with
[`runReplaySession`](./replay-sessions.md), restores a fork point with
[`rewindReplaySession`](./rewind-and-replay.md), re-executes the suffix with `replayReplaySession`,
classifies checkpoint fork points with [`classifyReplayCheckpoint`](./coupled-checkpoints.md), and
measures every session from `inspectReplaySession`. The compressor and every verifier run as
delegated children through [`openChildRun`, `runChildRun`, `acceptChildRunResult`, and
`projectChildRunResult`](./supervisor-operations.md) under the caller's root declaration and
supervisor. Every session, child, and append intent identity is derived from the application
identity and the step, so a repeated command converges on retained evidence.

## Protocol

`runTrajectoryCompression` requires a protocol of kind `trajectory_compression` with:

- a `prompt` surface with the configured `compressor` role, a `schema` surface with the
  `compression` role (the fork-point and hint schema), and a `prompt` surface with the `verifier`
  role;
- the budgets named by `applications.compression.budgetKeys`: `bestOfN`, the number of seeded
  best-of-N control reruns, and `maxProviderCalls`, which bounds live provider calls across every
  session plus one call per delegated child started.

`bestOfN` above `limits.maxBestOfN` is `ApplicationBudgetError`; `bestOfN` above the number of
declared seeds is `ApplicationProtocolError`. Both, and every other malformed option or protocol,
are refused before any record, session, or provider call, as is a schema surface outside the
[supported JSON Schema subset](./json-schema-validation.md). Surfaces are pinned into the manifest
by digest. The compressor's proposal is validated at runtime against every `schema` surface of the
`compression` role (`compileJSONSchema`), then against the closed grammar published as
`$defs.proposal` of the generated compression schema and against the source. A proposal either
refuses is retained as a rejected candidate and raised as `ApplicationEvidenceError` whose cause
carries the path-level issues (for example `$.fork_point.step_index must be an integer`).

## Workflow and children

The caller supplies:

- `workflow` `{ program, programId, provider?, handlers?, task?, providerSession?, bindings?,
  checkpointPolicy? }`. `program` is a
  factory: `program(null)` is the recorded workflow and every plain rerun, and
  `program({ fork_point, hint })` re-executes the same workflow under a proposal. The guided
  program must issue the recorded prefix unchanged; only steps at or after the fork point may use
  the hint. Since 8.0.0 `bindings({ application_id, role, seed })` binds worlds, processes, and a
  handler stack to each session: `source` (the live source world), `rewind`, `compressed`, and
  `restoration` (fresh empty restoration roots), and `control` (a fresh world per seed at the
  initial state the caller prepares). It is called at every session start, including a resumed
  one, so it must return the same bindings for the same role and seed. `checkpointPolicy` is the
  [automatic checkpoint policy](./coupled-checkpoints.md#automatic-checkpoints) of the source,
  every suffix replay, and every control. Without `bindings` the workflow binds no worlds or
  processes.
- `compressor` and `verifier`: child run definitions `{ task, budget, grant, provenance?, program |
  provider }` opened under `parent` as `supervisorId`. Task schemas admit only strings and closed
  objects, so evidence and results cross the delegation seam as canonical JSON text: the child input
  is `{ [childFields.input]: text }` (`evidence`) and the output must be
  `{ [childFields.output]: text }` (`result`). A program-serviced compressor additionally receives
  the source inspection as `source`; a program-serviced verifier receives the `original` and
  `compressed` inspections, the `fork_point`, the `hint`, the candidate kind, and the seed.
- `controlProvider(seed)`, optionally, the provider of each control rerun (default: the workflow
  provider), `baselines` (`["no_compression"]` or none), and `clock`.

A finished child is accepted with `acceptChildRunResult` and read with `projectChildRunResult`; a
child that did not finish cannot be accepted.

## Fork point and hint

The compressor receives the canonical source evidence (session, status, result, step count, every
step's index, kind, prefix identity, dependencies, source, request, response output, and effect
intent, and every checkpoint's identity, boundary, prefix, and classification) and returns
`{ fork_point, hint }`:

Both fields are optional; an absent field is null.

- `fork_point` is `{ session_id, prefix_id, step_index? }` or null. It must name the source session.
  For an `n`-step source, `step_index` in `[0, n - 1]` must carry exactly the prefix identity the
  source retains through `step_index` steps, which is null at step `0`. Step `0` restarts from the
  initial prefix: the rewind and the compressed session retain no source step and the whole
  workflow reruns under the hint (Appendix D.5). The fork point names the retained checkpoint at
  that boundary when one exists, otherwise the step boundary.
- **Missing fork step.** A null or absent `fork_point`, or one without `step_index`, is a missing
  fork step and settles `no_prune` (Appendix D.6), with or without a hint.
- **Out-of-range fork step.** `step_index` is any safe integer. An index outside `[0, n - 1]` is
  resolved by the configured `applications.compression.forkStepPolicy`, one of
  `forkStepPolicies` (`APPLICATION_COMPRESSION_FORK_STEP_POLICIES`):
  - `clamp` (the repository default, Appendix D.6) moves the index to the nearest bound, `0` below
    the range and `n - 1` above it, and the fork point takes the retained prefix identity at that
    bound. The proposed index and prefix identity are retained as
    `fork_clamp { policy, proposed_step_index, proposed_prefix_id }` on every candidate record, so
    `f = n` forks at `n - 1` and `f = -1` restarts at `0`;
  - `reject` refuses the proposal like any other grammar violation.
- `hint` is `{ text, cited_step_indices }` or null; the text fits `limits.maxPromptBytes`, and cited
  indices are strictly ascending and name retained source steps (each below the source step count).
  A hint without a fork step is retained only by its digest and prunes nothing.

A proposal the grammar or the source refuses, a compressor child that terminally failed (its
completion is not `finished`, including a child settled `cancelled` by the cancellation path), or
an output that is not the configured text field is retained as a `rejected` candidate with failure
code `APPLICATION_EVIDENCE_INVALID` and raises `ApplicationEvidenceError`; nothing is rewound or
pruned. A refusal at the delegation seam itself is not a child failure and writes no record: a
rerun under another supervisor or content raises `DelegationCommandConflictError`, a child left
`running` by a dead process raises `DelegationStatusError` and stays fail-closed until the
[cancellation path](./supervisor-operations.md) settles it, and lease and store errors raise
unchanged. The same rule applies to every verifier child.
A valid proposal is retained as `proposed` with the resolved fork point, the `fork_clamp` evidence
(null when the step was in range or missing), `hint_digest` (the configured digest of the canonical
hint), and `fork_id` (`compression-fork:sha256:` over the application, resolved fork point, and hint
digest).

## Outcomes

- **`no_prune`, no fork point.** A missing fork step settles `no_prune` with the configured
  `noForkPoint` reason. The source is the result; nothing is rewound or replayed.
- **`no_prune`, unavailable restore.** A fork point at a retained checkpoint is classified with
  `classifyReplayCheckpoint`. An `unavailable` classification refuses the prune: the candidate
  settles `no_prune` with the configured `restoreUnavailable` reason and the classification and every
  constituent with its reason, and nothing is rewound.
- **`no_prune`, no checkpoint at a world-bound fork point.** A source that binds worlds or
  processes is restorable only at a retained checkpoint. A fork point without one settles
  `no_prune` with the `restoreUnavailable` reason, classification `unavailable`, and every world
  and process `unavailable` with the configured `boundaryWithoutCheckpoint` reason; nothing is
  rewound.
- **Restoration.** Otherwise `rewindReplaySession` restores the fork point (the checkpoint, or the
  step boundary) from the source. The rewind's restore classification and constituents, its restore
  record, and its session are retained as `rewound` before any suffix runs. A rewind that does not
  end `rewound`, or retains no restore record, is retained as `rejected` with
  `APPLICATION_EVIDENCE_INVALID`. A rewind left non-terminal after its restore record by a dead
  writer whose lease expired is admitted from that record: the rewind is evidence only, so
  `rewound` cites the retained restore record and no second restore runs.
- **Compressed suffix.** `replayReplaySession` replays the source from the same target with
  `program(guidance)`: the prefix is served from the source journal and the suffix runs live under
  the hint.
- **Retained source.** The rewind and the compressed rerun declare `sourceDisposition: "retain"`:
  the source is the uncompressed trajectory the result is measured against, so neither compensates
  its compensable suffix effects ([source disposition](./compensation.md#source-disposition),
  [`exploratory-branch-compensation.test.ts`](../test/applications/exploratory-branch-compensation.test.ts)).
- **`pruned`.** A compressed session that finished with strictly fewer steps than the source is
  passed to the verifier, which returns `{ verdict, score, reason }`. `accepted` settles `pruned` and
  the compressed session is the result.
- **`restored`.** A `rejected` verdict, or a compressed session that is not admissible (not finished
  or not shorter, retained with the configured `notAdmissible` reason and no verdict), re-runs the
  original suffix with `program(null)` from the same target and settles `restored` with the
  reason; the restoration session is the result. A restoration session that ended `failed` or
  `cancelled` has no result: the candidate is retained as `rejected` with
  `APPLICATION_EVIDENCE_INVALID`, the run stops, and `ApplicationEvidenceError` is raised. A
  compressed session left non-terminal by a dead
  writer whose lease expired did not finish, so it is not admissible: its `step_count` is its
  retained step count and it is cited at its retained head.

A verifier that fails, cannot be accepted, or returns a malformed verdict is a verification failure:
the candidate is retained as `rejected` with `APPLICATION_VERIFICATION_FAILED`, nothing is pruned or
restored, the run stops, and `ApplicationVerificationError` is raised with the cause.

## Best-of-N control and baseline

Up to `bestOfN` protocol seeds, in declared order, each run one plain rerun of `program(null)` as a
root session with `controlProvider(seed)`, without any fork point. Each rerun is verified like the
compression candidate (`fork_point` and `hint` null) and retained as a `control` candidate with its
seed, session, verdict, score, reason, step count, and cost. Only a control session that finished is
verified: one that ended `failed` or `cancelled` is retained as a `rejected` control with
`APPLICATION_EVIDENCE_INVALID`, the run stops, and `ApplicationEvidenceError` is raised, so a failed
control can never be the best control. The best control is the accepted rerun
with the fewest steps; the earliest seed wins a tie. The `no_compression` baseline keeps the whole
trajectory and is reported against the source.

## Retained records

Every record is `shepherd.application.compression.v1` on the application owner path and conforms to
the closed [`application-compression-v1`](../spec/schemas/application-compression-v1.schema.json)
schema; the codec re-validates every record, including the presence of each field for its candidate,
status, and outcome, whenever it is read:

- the `opened` record names the command, protocol, source session, control seeds, and baselines;
- the compression candidate retains `proposed`, `rewound`, and `settled` records, or a `rejected`
  record, each with `candidate`, `seed`, `status`, `outcome`, `fork_point` (null prefix exactly at
  step `0`), `fork_clamp`, `fork_id`, `hint_digest`,
  `restore` (classification, constituents, restore record, rewind session), `session_id` (the
  compressed session), `restoration_session_id`, `verifier_handle_id`, `verdict`, `score`, `reason`,
  `step_count`, measured `cost`, and `failure`;
- each control seed retains one `settled` or `rejected` record;
- the aggregate `outcome` record reports the outcome, the result session, and measured step counts
  and ratios only: `original_step_count`, `result_step_count`, `step_count_ratio`, the best control
  `{ seed, session_id, step_count, step_count_ratio }`, and the `no_compression` baseline.

The manifest is retained last with the terminal cut. Its artifacts are the source session
(`source_session`), each candidate's terminal record (`compression_candidate`), the compressor and
verifier children (`compressor_child`, `verifier_child`), the rewind (`rewind_session`), the
compressed, restoration, and control sessions (`compressed_session`, `restoration_session`,
`control_session`), and the outcome (`compression_outcome`). A session interrupted by a dead writer
is cited at its retained head with a null status. Costs are measured from the live
provider steps of every session and the observed usage of every child; each started child counts
one provider call.

## Budgets

Budgets are checked twice. **Projected:** before a session or child that is not yet retained
starts, its projected calls (the source's provider steps at or after the fork point for a suffix
replay, all of them for a control rerun, one for a child) are added to the measured total;
exceeding `maxProviderCalls` is `ApplicationBudgetError` before the offending call. **Measured:**
the source session is measured first and refused before the `opened` record when its live provider
calls alone exceed `maxProviderCalls`, so a rerun with a larger budget reuses the retained source.
Right after each compressed-suffix, restoration, and control session, its measured live calls are
added and an overrun of the projection past `maxProviderCalls` is `ApplicationBudgetError`: the
session is retained and its candidate is not settled. Retained evidence up to a refusal stays, and
every rerun re-measures the retained sessions and refuses the same way without new records.

## Repeats, crashes, and inspection

- Repeating a completed command returns the retained manifest without executing a session, child,
  or verifier. A repeat under a different protocol is `ApplicationProtocolError`; a repeat with
  different baselines is `ApplicationEvidenceError`.
- A crash at any application append converges on rerun. The compressor and verifier handles, the
  rewind, and the compressed, restoration, and control sessions are derived from the command and
  return their retained receipts, so none is executed twice. In particular, a process killed after
  the `rewound` record, which cites the rewind restore record, and before the suffix replay
  converges through the retained rewind receipt: the rewind session keeps its single restore
  record.
- A process that dies inside a replay session leaves that session non-terminal. While the dead
  writer's lease is live every rerun raises `ReplaySessionInterruptedError` (`running`) without a
  record. Once the lease expired: a source session keeps raising it (recover under a new command
  identity); a rewind with a retained restore record is retained as `rewound` without a second
  restore, and one without is rejected; a compressed session is not admissible and is restored; a
  restoration or control session rejects its candidate with `APPLICATION_EVIDENCE_INVALID`, the
  cause an `ReplaySessionInterruptedError`, and the run stops, because an interrupted restoration
  has no result and an interrupted control has no outcome to verify.
- A process that dies inside a compressor or verifier child leaves the child `running`; every rerun
  raises `DelegationStatusError` without a record until the cancellation path settles it, after
  which the candidate is retained as `rejected` (`APPLICATION_EVIDENCE_INVALID` for the compressor,
  `APPLICATION_VERIFICATION_FAILED` for a verifier).
- A rerun after a retained failure raises the same error class without executing or writing.
- A source trajectory that did not finish is `ApplicationEvidenceError` before the `opened` record.
- A rerun under another supervisor is refused by the delegation seam without a record; the original
  supervisor's rerun still converges.
- A moved application head is `ApplicationEvidenceError`.

`inspectTrajectoryCompression(store, applicationId)` validates the whole owner path: the opened
record and its derived source session; the compression candidate's record order with an identical
proposal and derived compressor, verifier, rewind, compressed, and restoration identities; each
control in seed order; the outcome against the settled candidates and requested baselines; the
manifest; and the terminal cut. It embeds no live state, so it is identical on the writing store, a
reopened or read-only store, and an imported archive.

## Limits

- Compression prunes and restores a suffix of a recorded trajectory. It does not compress model
  context or provider state.
- A world- or process-bound workflow prunes only at checkpointed fork points, so its
  `checkpointPolicy` bounds which proposals can prune. A provider-session adapter may be bound; its
  checkpoint evidence decides whether a checkpoint fork point is `atomic`, `reconstructive`, or
  `unavailable`.
- The guided program is caller code: the hint reaches the suffix only through `program(guidance)`,
  and the verifier, not the application, decides whether the compressed result is acceptable.
- Providers must be able to service repeated sessions.
- The reported ratios are this repository's offline measurements; no claim beyond them is made.
- The evaluation report's rescue count (Appendix D, Table 12) uses the session `success` condition;
  compression requires a finished source, so it reports no compression rescue and runs no
  task-level success judge of the source. See [application evaluation](./application-evaluation.md).
