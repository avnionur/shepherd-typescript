# Research Notes: Paper Appendix A.2 and Section 6

Status: research note index, not normative

Research date: 2026-09-25

Tracking: [#218](https://github.com/avnionur/shepherd-typescript/issues/218) (epic
[#202](https://github.com/avnionur/shepherd-typescript/issues/202)). Paper:
[Shepherd v3](https://arxiv.org/html/2605.10913v3), Appendix A.2 (Future Works) and §6
(Conclusion). Coverage classification: [paper coverage](../paper-coverage.md) (A.2 is a P3
backlog, not a paper-parity blocker).

Each note scopes one future-work direction: the paper statement, what the repository provides now
(with links to implemented modules and normative docs), gaps, one research question, a minimal
experiment, success and falsification criteria, and risks. Notes claim no results. No
implementation issue is filed for a direction until its note is reviewed.

| Direction | Paper source | Note | Main existing seams |
| --- | --- | --- | --- |
| Agent interpretability probes (minimal flip edit, smallest sufficient prompt span) | A.2, §6 | [agent-interpretability-probes.md](./agent-interpretability-probes.md) | CRO replay, divergence proof, N-way diff, regression bisection |
| Reversible environments for continual learning | A.2, §6 | [reversible-continual-learning.md](./reversible-continual-learning.md) | Tree-RL adapter, automatic checkpoints, branch lineage |
| Substrate-native actions for post-training | A.2 | [substrate-native-actions.md](./substrate-native-actions.md) | Meta-agent tool catalog, replayable tool loop, `jsonl_v2` export |
| Trace compression into reusable workflows | §6, Appendix D | [trace-to-workflow-compression.md](./trace-to-workflow-compression.md) | Trajectory compression, CRO cross-example gate |
| Safety deployment profile (irreversible override, rollback to last materialization point) | A.2, §6 | [safety-deployment-profile.md](./safety-deployment-profile.md) | Approval frontier, compensation, rewind, runtime supervisor |

## Review rule

A note moves forward only by review: an approved note may produce one scoped implementation issue
under the GitHub issue delivery workflow in `AGENTS.md`, with its own acceptance criteria,
configuration (no hard-coded domain literals), tests, and normative documentation under `docs/`.
Until then, nothing here is a contract.
