# Application evaluation report

<!-- Generated from config/research-applications.config.json by `pnpm evaluate:applications`. Do not edit directly. `pnpm check:evaluation` fails when the JSON report or this page above the generation host section drifts. -->

Report `evaluation-report:sha256:bd7e90a66c916ebeeea9be26947981c6ef878827f35826c5572f00baea7b74b5` ([JSON](application-evaluation.json)), evaluation `phase-10-offline-applications` revision `1`, report version 1, `shepherd.applications.v1`.

Every figure is this repository's offline measurement on synthetic fixtures with configured seeds and static providers. Upstream headline results are not reproduced. Metrics are measured only; the delta is the application value minus the baseline value. See [application evaluation](../application-evaluation.md) for what each metric counts.

## Runs

| Experiment | Kind | Protocol version | Seeds | Dataset | Manifest |
| --- | --- | --- | --- | --- | --- |
| coding-supervisor | `coding_supervisor` | `appendix-e.v1` | 11, 23 | `conflicting-edit-fixture` r1: `greet.ts` | `application-manifest:sha256:8b8b05e3b56c0ba5e67e02831da7e157c8c46196af28a8f3ab0a4ee5291d5fe7` |
| counterfactual-optimization | `counterfactual_optimization` | `appendix-f.v1` | 7, 19 | `draft-review-workflow-fixture` r1: `plan-draft-review` | `application-manifest:sha256:69492f5bafa00ed40892782da9785a183e48629ae52f5944da6c517b4de3ea48` |
| trajectory-compression | `trajectory_compression` | `appendix-d.v1` | 7, 19, 23 | `explore-answer-workflow-fixture` r1: `plan-explore-answer` | `application-manifest:sha256:9e95c6e3640d86bc4d789660b10d1dd6ec9e4ef973e741ba6fba3af9dd1500dc` |
| tree-rl | `tree_rl` | `section-5.3.v1` | 3, 5, 8 | `plan-explore-draft-answer-fixture` r1: `plan-explore-draft-note-answer` | `application-manifest:sha256:6c0fe302767554eb4e8ec2eb53ac6caba9505754d7d0b0f1667b10870a4e3e3c` |

## Manifest costs

Whole-run measured costs retained in each manifest, including work outside the compared metrics.

| Experiment | Provider calls | Input tokens | Output tokens | Cache creation | Cache read | Cost (USD) |
| --- | --- | --- | --- | --- | --- | --- |
| coding-supervisor | 2 | 20 | 4 | 2 | 4 | 0.5 |
| counterfactual-optimization | 14 | 140 | 28 | 14 | 28 | 3.5 |
| trajectory-compression | 17 | 130 | 26 | 13 | 26 | n/a |
| tree-rl | 24 | 240 | 48 | 24 | 48 | 6 |

## Comparisons

### coding-supervisor against `no_supervision`

| Metric | Application | Baseline | Delta |
| --- | --- | --- | --- |
| `cost_usd` | 0.5 | 0.25 | 0.25 |
| `provider_calls` | 2 | 1 | 1 |
| `input_tokens` | 20 | 10 | 10 |
| `output_tokens` | 4 | 2 | 2 |
| `steps` | 2 | 1 | 1 |
| `success` | true | true | n/a |

Baseline evidence: `delegation:sha256:4fa17f5ad4fefa9623f1feb4db635774594f01292474ee78c6906a0697dda3e2`.

These values measure only the compared sessions of each side, not the whole run; a delta is not a whole-run saving. Whole-run costs are in the manifest costs table above.

### counterfactual-optimization against `full_replay`

| Metric | Application | Baseline | Delta |
| --- | --- | --- | --- |
| `cost_usd` | 0.5 | 2 | -1.5 |
| `provider_calls` | 2 | 8 | -6 |
| `input_tokens` | 20 | 80 | -60 |
| `output_tokens` | 4 | 16 | -12 |
| `steps` | 8 | 8 | 0 |
| `success` | true | true | n/a |

Baseline evidence: `replay-session:sha256:309b60fec6864782e41845105ae91cef224866cb218d0e1b0e05756b965bcc69`, `replay-session:sha256:c6ccf5ea2f2f63e179b3c2226e014430f48af0252b769e131f0ef1ec589b10c1`.

These values measure only the compared sessions of each side, not the whole run; a delta is not a whole-run saving. Whole-run costs are in the manifest costs table above.

### trajectory-compression against `no_compression`

| Metric | Application | Baseline | Delta |
| --- | --- | --- | --- |
| `cost_usd` | 0.25 | 1 | -0.75 |
| `provider_calls` | 1 | 4 | -3 |
| `input_tokens` | 10 | 40 | -30 |
| `output_tokens` | 2 | 8 | -6 |
| `steps` | 2 | 4 | -2 |
| `success` | true | true | n/a |

Baseline evidence: `replay-session:sha256:44f1e82127e4cafd6396b8e590de9ecc2bdc5c52bbdc171ff206973b4d8f20a2`.

These values measure only the compared sessions of each side, not the whole run; a delta is not a whole-run saving. Whole-run costs are in the manifest costs table above.

### tree-rl against `single_rollout`

| Metric | Application | Baseline | Delta |
| --- | --- | --- | --- |
| `cost_usd` | 6 | 3 | 3 |
| `provider_calls` | 24 | 12 | 12 |
| `input_tokens` | 240 | 120 | 120 |
| `output_tokens` | 48 | 24 | 24 |
| `steps` | 30 | 15 | 15 |
| `success` | true | true | n/a |

Baseline evidence: `replay-session:sha256:baa735dbb881cebf86713e93946b970938545ff69f095511ce4fffb7599ea572`, `replay-session:sha256:12d488b490dd9c46fa59c659de62a77d83c29371f358835b5c7355351439cb4f`, `replay-session:sha256:eb16e1166a18213fd0a414cf7d64064e1d2d7ae5585165d7d6f1c3663a536a8b`.

These values measure only the compared sessions of each side, not the whole run; a delta is not a whole-run saving. Whole-run costs are in the manifest costs table above.

## Limitations

- **offline-static-providers**: Every provider is an offline static fixture: exact order-bound cassettes for the Tree-RL source and rollouts, and request-keyed providers with a static descriptor where an application serves repeated sessions or workers from one provider. Token counts and costs are the fixtures' configured per-call usage, not provider billing.
- **no-live-provider**: No live model provider is called. Nothing here measures model quality, latency, or behavior under real provider variance.
- **synthetic-fixtures**: Fixtures are synthetic and small: one dataset item per application, four or five workflow stages, two supervised workers, two optimizer candidates, and the configured seeds. The figures describe these fixtures, not a benchmark or task distribution.
- **no-wall-clock**: No wall-clock time, throughput, or duration is measured or reported. Steps and provider calls are counts, not time.
- **repository-baselines**: Baselines are this repository's constructions: no_supervision runs one worker once as a plain child run without a policy, full_replay re-runs the whole workflow per candidate, no_compression keeps the recorded source trajectory, and single_rollout reuses branch 0 of each fork point. None is an upstream baseline.
- **single-rollout-shared-cost**: The Tree-RL single_rollout baseline reuses the tree's branch-0 rollouts instead of running separate sessions, so its cost is a subset of the tree batch's cost, not an equal budget; a failed branch-0 rollout still counts in the baseline's cost and steps and makes baseline success false (the v4 single_rollout training batch drops that fork point).
- **measurement-scope**: Application-side metrics count only the work compared against the baseline: supervised worker starts and retained completions, counterfactual candidate branch sessions, the compression result session, and every Tree-RL rollout. Supervisor rounds, recorded baseline and source sessions, compressor and verifier children, and best-of-N controls appear only in each run's manifest costs.
- **single-host**: Each generation runs on one host. The report bytes are host-independent by construction, but no multi-host, concurrent-writer, or crash-injected evaluation is performed.
- **no-upstream-reproduction**: Upstream headline results (paired coding success, optimizer dev-set gains, compression ratios, and Tree-RL training gains) are not reproduced. No figure in this report is comparable to a published number.
- **no-training**: The Tree-RL adapter emits a training batch and trains nothing; no learning result is claimed.

<!-- generation-host: excluded from check:evaluation -->

## Generation host

Host metadata of the last write; it never enters the JSON report or the check.

| Field | Value |
| --- | --- |
| Node.js | `v24.17.0` |
| Platform | `darwin` |
| Architecture | `arm64` |
