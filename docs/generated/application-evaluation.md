# Application evaluation report

<!-- Generated from config/research-applications.config.json by `pnpm evaluate:applications`. Do not edit directly. `pnpm check:evaluation` fails when the JSON report or this page above the generation host section drifts. -->

Report `evaluation-report:sha256:f2074346c5222c7c993514c94c9c019fde5bd81e5e1afbd00add97d1480f3a62` ([JSON](application-evaluation.json)), evaluation `phase-10-offline-applications` revision `4`, report version 2, `shepherd.applications.v1`.

Every figure is this repository's offline measurement on synthetic fixtures with configured seeds and static providers. Upstream headline results are not reproduced. Metrics are measured only; the delta is the application value minus the baseline value. See [application evaluation](../application-evaluation.md) for what each metric counts.

## Runs

| Experiment | Kind | Protocol version | Seeds | Dataset | Manifest |
| --- | --- | --- | --- | --- | --- |
| coding-supervisor | `coding_supervisor` | `appendix-e.v1` | 11, 23 | `conflicting-edit-fixture` r1: `greet.ts` | `application-manifest:sha256:8b8b05e3b56c0ba5e67e02831da7e157c8c46196af28a8f3ab0a4ee5291d5fe7` |
| counterfactual-optimization | `counterfactual_optimization` | `appendix-f.v2` | 7, 19 | `draft-review-workflow-fixture` r2: `train-1`, `train-2`, `train-3`, `train-4`, `dev-1`, `dev-2` | `application-manifest:sha256:5e972faa6707013f0ec1d1e86ce3a5051a602780cf8f5e556a7dab2814289ba9` |
| trajectory-compression | `trajectory_compression` | `appendix-d.v2` | 7, 19, 23 | `explore-answer-workflow-fixture` r1: `plan-explore-answer` | `application-manifest:sha256:0f719a83a70154715d76811b0d4c52e3383a77dae821fcc4d940f4ef82bdc41a` |
| tree-rl | `tree_rl` | `section-5.3.algorithm-2.v2` | 3, 5, 8 | `plan-explore-draft-answer-fixture` r1: `plan-explore-draft-note-answer` | `application-manifest:sha256:6ed415155e18b1a3d8f816d29a17f6a6c215ada354107693086408210db15074` |

## Manifest costs

Whole-run measured costs retained in each manifest, including work outside the compared metrics.

| Experiment | Provider calls | Input tokens | Output tokens | Cache creation | Cache read | Cost (USD) |
| --- | --- | --- | --- | --- | --- | --- |
| coding-supervisor | 2 | 20 | 4 | 2 | 4 | 0.5 |
| counterfactual-optimization | 106 | 1060 | 212 | 106 | 212 | 26.5 |
| trajectory-compression | 17 | 130 | 26 | 13 | 26 | n/a |
| tree-rl | 26 | 260 | 52 | 26 | 52 | 6.5 |

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
| `cost_usd` | 8.5 | 12 | -3.5 |
| `provider_calls` | 34 | 48 | -14 |
| `input_tokens` | 340 | 480 | -140 |
| `output_tokens` | 68 | 96 | -28 |
| `steps` | 48 | 48 | 0 |
| `success` | true | true | n/a |

Baseline evidence: `replay-session:sha256:8c16fce4062b8d80fa53263a7273d655265e7bfabd066037e4cdaf82a3446722`, `replay-session:sha256:daebe9fcacd405ea8711fd636766ac2ad497013c98e20e4a73c3e51a918efe15`, `replay-session:sha256:774e528659e23e5a01e92d8ce76728eb06a7b2aedb22ca701f0f20f1c8323529`, `replay-session:sha256:6b14dc53f042104717d34e08eb24a4f65f1ad20f706a70e36ff1063304110083`, `replay-session:sha256:eb3bcab678c74df482ac34b1394daad1923eddc5aab71d007c112ed2fb4b77b8`, `replay-session:sha256:0b037e1556b8009e8fba5f02c8a461e4af55f1cd750e64d9efba010e1ca829a3`, `replay-session:sha256:8240410fec2543cb836209514b772f1045ab157fef495d775b2e9ae02a992909`, `replay-session:sha256:c86915d8184df979408b02a0b9b7d3fc18a24e15aa49d2efd19e9971af172c4c`, `replay-session:sha256:a27d4938eed6cdc7f80fcdd4753fde9a15907f00f6658dee3d1bbd443e55458b`, `replay-session:sha256:f272b3bf66975b17a98d1c570f5b9f64aa9719c086b40be7bbeef9fd9776bf5a`, `replay-session:sha256:ee910866ce6a662e5c7c21f88bf4915dfa9df914604a9c75c514c9c61bd2c4a0`, `replay-session:sha256:1be3f229c6a6edac930a90ea3ce1c53fbb8dcc6561ad3c6ef3cc32a5ac8c72ba`.

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

### tree-rl against `flat_grpo`

| Metric | Application | Baseline | Delta |
| --- | --- | --- | --- |
| `cost_usd` | 6.5 | 2.5 | 4 |
| `provider_calls` | 26 | 10 | 16 |
| `input_tokens` | 260 | 100 | 160 |
| `output_tokens` | 52 | 20 | 32 |
| `steps` | 30 | 10 | 20 |
| `success` | true | true | n/a |

Baseline evidence: `replay-session:sha256:c9f5f3acc2c13c07e41c3146fbf07bbd51f4c1b23d01b0311eeff2cef32ccd98`, `replay-session:sha256:58e9e0971d6b862bc4d11e78df03c3b6bedf7db9031b262bd70e38e3b0820bf2`.

These values measure only the compared sessions of each side, not the whole run; a delta is not a whole-run saving. Whole-run costs are in the manifest costs table above.

## Rescues

Experiments whose baseline failed its success condition while the application run passed (Appendix D, Table 12).

Rescued: 0 of 4.

## Limitations

- **offline-static-providers**: Every provider is an offline static fixture: exact order-bound cassettes for the Tree-RL roots and rollouts, and request-keyed providers with a static descriptor where an application serves repeated sessions or workers from one provider. Token counts and costs are the fixtures' configured per-call usage, not provider billing.
- **no-live-provider**: No live model provider is called. Nothing here measures model quality, latency, or behavior under real provider variance.
- **synthetic-fixtures**: Fixtures are synthetic and small: one dataset item per application except the optimizer's four train and two dev examples, four or five workflow stages, two supervised workers, two scripted optimizer iterations with three candidate edits, and the configured seeds. The figures describe these fixtures, not a benchmark or task distribution.
- **no-wall-clock**: No wall-clock time, throughput, or duration is measured or reported. Steps and provider calls are counts, not time.
- **repository-baselines**: Baselines are this repository's constructions: no_supervision runs one worker once as a plain child run without a policy, full_replay re-runs the whole workflow per candidate example branch, no_compression keeps the recorded source trajectory, and flat_grpo keeps only the G graded roots of each prompt with the inter-root advantage on every action. None is an upstream baseline.
- **flat-grpo-shared-roots**: The Tree-RL flat_grpo baseline is the tree run's own G roots per prompt, so its cost is a subset of the tree run's cost (roots plus K branches per root), not a matched generation budget as in the paper's comparison. The fixture forks every root at a configured turn instead of consulting a meta-agent, so no proposed tool call seeds a branch here.
- **measurement-scope**: Application-side metrics count only the work compared against the baseline: supervised worker starts and retained completions, counterfactual candidate example branch sessions, the compression result session, and every Tree-RL root and branch rollout. Supervisor rounds, recorded baseline and source sessions, compressor and verifier children, and best-of-N controls appear only in each run's manifest costs.
- **single-host**: Each generation runs on one host. The report bytes are host-independent by construction, but no multi-host, concurrent-writer, or crash-injected evaluation is performed.
- **rescue-scope**: A rescue counts an experiment whose baseline failed its success condition while the application run passed. Trajectory compression requires a finished source and every fixture baseline here succeeds, so the measured rescue count is zero; no task-level success judge of the source trajectory (the upstream Table 12 notion) is run.
- **no-upstream-reproduction**: Upstream headline results (paired coding success, optimizer dev-set gains, compression ratios, and Tree-RL training gains) are not reproduced. No figure in this report is comparable to a published number.
- **no-training**: The Tree-RL adapter emits a training batch and trains nothing; no learning result is claimed.
- **scripted-proposer**: The optimizer's proposer is a scripted caller proposer replaying configured iterations; no provider-backed tool-loop proposer runs in the evaluation, and the per-example metric is a configured score table keyed by the provider that produced the final stage.

<!-- generation-host: excluded from check:evaluation -->

## Generation host

Host metadata of the last write; it never enters the JSON report or the check.

| Field | Value |
| --- | --- |
| Node.js | `v24.17.0` |
| Platform | `darwin` |
| Architecture | `arm64` |
