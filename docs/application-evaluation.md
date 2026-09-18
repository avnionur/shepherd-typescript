# Application evaluation

Implementation: [`src/applications/evaluation.ts`](../src/applications/evaluation.ts) and
[`src/applications/evaluation-types.ts`](../src/applications/evaluation-types.ts). Public entry
point: [`src/facades/applications.ts`](../src/facades/applications.ts) (`./applications`:
`runApplicationEvaluation`, `compareApplicationBaseline`, `validateApplicationEvaluationReport`,
`readApplicationEvaluationDefinition`), with root exports from [`src/index.ts`](../src/index.ts).
Configuration: `applications.evaluation` in [`protocol.config.json`](../protocol.config.json)
(applications protocol v5); the repository's evaluation definition, fixtures, and limitations are the
`evaluation` section of
[`config/research-applications.config.json`](../config/research-applications.config.json). Generated
schema:
[`application-evaluation-v1.schema.json`](../spec/schemas/application-evaluation-v1.schema.json).
Repository artifacts: [`application-evaluation.json`](./generated/application-evaluation.json) and
[`application-evaluation.md`](./generated/application-evaluation.md), written by
[`tooling/evaluation/writer.ts`](../tooling/evaluation/writer.ts) through
[`scripts/evaluate-applications-cli.ts`](../scripts/evaluate-applications-cli.ts). Tests:
[`application-evaluation.test.ts`](../test/applications/application-evaluation.test.ts) and
[`evaluation-artifacts.test.ts`](../test/applications/evaluation-artifacts.test.ts). Design
constraints: [research applications contract](../.plan/research-applications-contract.md).

Upstream headline results are not reproduced. Every figure the evaluation reports is this
repository's offline measurement on synthetic fixtures with configured seeds and static providers.

## Definition

An evaluation definition is plain data: `{ evaluationId, revision, experiments, limitations }`.
`readApplicationEvaluationDefinition` validates it and `runApplicationEvaluation` validates it again
before anything runs. Each experiment is:

| Field | Meaning |
| --- | --- |
| `id` | Distinct experiment identity; the report's alignment key |
| `protocol` | An application protocol definition accepted by `readApplicationProtocol`; its `kind` selects the application |
| `commandId` | The application's globally idempotent command identity |
| `baseline` | `{ kind }`, where `kind` is a configured baseline of the application kind; the coding supervisor baseline also names `commandId` and `workerId` |
| `sourceCommandId` | Tree-RL only: the command identity that records the source session |

Every command identity in the definition must be distinct. A baseline kind that is not configured for
the experiment's application is refused, as is a supervisor-only field on another baseline or a
`sourceCommandId` outside Tree-RL. At most `APPLICATION_EVALUATION_LIMITS.maxExperiments`
experiments and `maxLimitations` limitations of at most `maxLimitationLength` characters are
admitted. A malformed definition is `ApplicationProtocolError` and writes nothing.

Executable parts cannot be data, so the caller passes `bind(experiment)`, called once per
experiment in order before any application runs. It returns `{ kind, options }` (plus `source` for
Tree-RL), where `options` are the application's own run options without `commandId`, `protocol`,
and `baselines`, which come from the experiment. A binding whose kind differs from the protocol's,
whose fields are not exactly the declared ones, or whose supervisor workers lack the baseline worker
is `ApplicationProtocolError`, also before any record.

The runtime reads only the definition the caller passes. The repository's definition, its fixture
data, and its limitations live in `config/research-applications.config.json`; none is coded in
`src/`.

## Baselines

| Application | Baseline | Construction |
| --- | --- | --- |
| `coding_supervisor` | `no_supervision` | The named worker's definition runs once as a plain child run: `openChildRun` and `runChildRun` under the baseline `commandId`, the binding's parent and supervisor, trace-only (`custody: null`), with no policy, injection, handoff, accept, or discard |
| `counterfactual_optimization` | `full_replay` | The optimizer's own measured whole-workflow re-run per candidate |
| `trajectory_compression` | `no_compression` | The recorded source trajectory the compression run keeps |
| `tree_rl` | `single_rollout` | The branch-0 rollouts of every fork point, reused from the tree run |

Tree-RL runs over a source session the evaluation records with `runReplaySession` from the binding's
`source` under `sourceCommandId`. The Tree-RL batch digest depends on the command identities, so
the definition fixes them.

## Metrics

Metrics are measured only, never derived or extrapolated, in the configured order `cost_usd`,
`provider_calls`, `input_tokens`, `output_tokens`, `steps`, `success`. Each experiment measures one
application side and one baseline side:

| Application | Application side | Baseline side | `steps` | `success` |
| --- | --- | --- | --- | --- |
| Coding supervisor | Manifest costs (provider calls count worker starts) | The baseline child's usage; one start | Worker attempts with a retained completion | The accepted attempt (application) or the baseline child finished |
| Counterfactual optimizer | Live provider steps of the branch session of every candidate with a full-replay comparison | Live provider steps of those candidates' full-replay sessions | Retained session steps | A candidate was promoted (application); every full replay finished (baseline) |
| Trajectory compression | Live provider steps of the result session | Live provider steps of the source session | Retained session steps | The session finished |
| Tree-RL | Retained cost of every rollout | Retained cost of every branch-0 rollout | Summed rollout step counts | Every rollout completed |

Replay-session costs fold the usage of live provider steps; a live call that failed without a
response counts one provider call with zero tokens and an unknown cost, so it makes `cost_usd` null,
as does any folded usage that reported no cost. Work outside the compared sides (supervisor rounds, the recorded optimizer baseline
and Tree-RL source, compressor and verifier children, and best-of-N controls) appears in each run's
manifest `costs`, which the report carries verbatim.

`compareApplicationBaseline(application, baseline)` returns one `{ metric, application, baseline,
delta }` per configured metric. Values are copied; `delta` is the application value minus the
baseline value when both are numbers, otherwise null (a null cost or the boolean `success`).

## Report

`runApplicationEvaluation(store, { definition, bind })` runs the experiments in order and returns an
`application-evaluation-v1` report:

- `runs`: per experiment `experiment_id`, `kind`, `application_id`, `manifest_id`, `protocol_id`,
  `protocol_version`, `seeds`, `dataset`, the manifest `costs`, and the application-side `metrics`;
- `baselines`: per experiment the baseline `kind`, the session or handle identities it was measured
  from (`evidence`), and its `metrics`;
- `comparisons`: per experiment the `baseline_kind` and the per-metric values;
- `limitations`: the definition's limitations, verbatim and in order;
- `evaluation_id`, `revision`, `metrics`, `report_version`, `compatibility_version`, and `report_id`
  (`evaluation-report:sha256:`), the digest of the canonical report body without it.

Determinism rule: no wall clock, host, node version, or duration appears in the report. Every value
is derived from the definition and retained evidence under fixed command identities, so repeated
runs, runs in fresh stores, and runs on any supported host produce the same report and identity.
`validateApplicationEvaluationReport` re-validates a parsed report, re-derives every comparison and
the identity, and refuses any mismatch with `ApplicationEvidenceError`.

## Recovery

The evaluation writes no record of its own. Every application command, the no-supervision child
(`openChildRun` returns the retained handle for identical content and `runChildRun` returns a
completed child without running it), and the Tree-RL source session are idempotent under their
fixed command identities. A repeated evaluation therefore re-executes nothing and folds the same
report, and an evaluation interrupted inside an application converges on rerun through that
application's own recovery. A no-supervision child left running by a dead process is refused by the
delegation seam (`DelegationStatusError`, no record) until the documented cancellation path settles
it. A refusal from one experiment leaves the evidence of earlier experiments
in place for a corrected rerun to reuse; seam and store errors propagate and are never retained as
evaluation failures.

## Repository artifacts

`pnpm evaluate:applications` resolves the repository definition and fixtures, runs the evaluation in
a fresh in-memory store, and writes the JSON report (canonically ordered keys, indented) and the
generated page. Each comparison on the page states that its values measure only the compared
sessions of each side, so a delta is not read as a whole-run saving. `pnpm check:evaluation` re-runs the evaluation and fails when the JSON report differs
byte for byte or when the page differs above its generation host marker; it runs in `pnpm verify`
after `check:protocol`.

Host and platform metadata (Node.js version, platform, architecture) appear only in the page's
trailing generation host section, after the
`<!-- generation-host: excluded from check:evaluation -->` marker. That section describes the host
that last wrote the page and is not compared, so the check is host-independent while the JSON report
never carries host data.

The repository fixtures are offline: request-keyed providers with a static descriptor for the
supervisor workers, the optimizer, and the compression workflow (these serve repeated sessions or
workers), exact static cassettes for the Tree-RL source and rollouts, program-serviced compression
children, a policy that observes once and accepts the configured worker, configured evaluator
verdicts, and a configured Tree-RL reward table.

## Limitations

The repository report publishes these configured limitations:

- `offline-static-providers`: every provider is an offline static fixture, and token counts and
  costs are configured per-call usage, not billing.
- `no-live-provider`: no live model provider is called.
- `synthetic-fixtures`: fixtures are synthetic and small; figures describe them, not a benchmark.
- `no-wall-clock`: no wall-clock time, throughput, or duration is measured.
- `repository-baselines`: every baseline is this repository's construction, not an upstream one.
- `single-rollout-shared-cost`: the Tree-RL `single_rollout` baseline reuses the tree's branch-0
  rollouts, so its cost is a subset of the tree batch's cost, not an equal budget; a failed
  branch-0 rollout still counts in the baseline's cost and steps and makes baseline success false
  (the v4 `single_rollout` training batch drops that fork point).
- `measurement-scope`: application-side metrics count only the compared work; the rest is in the
  manifest costs.
- `single-host`: each generation runs on one host; no multi-host, concurrent-writer, or
  crash-injected evaluation is performed.
- `no-upstream-reproduction`: upstream headline results are not reproduced and no figure is
  comparable to a published number.
- `no-training`: the Tree-RL adapter trains nothing and no learning result is claimed.
