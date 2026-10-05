# Shepherd empirical benchmark study

Study date: 2026-10-05 (Europe/Istanbul). Measured runtime: 12.0.3. Publication release: 13.7.1.

## Read the report

- [Scientific-style paper (PDF)](./output/pdf/shepherd-empirical-study.pdf)
- [Editable standalone LaTeX source](./paper.tex)
- [Shared authored manuscript](./manuscript.json)
- [Derived statistics](./summary.json), [kernel CSV](./kernel-summary.csv), and
  [harness/context CSV](./agent-context-summary.csv)
- [Primary-source notes and comparator feasibility](./related-work-notes.md)
- [Capability preservation and verification](./preservation.md)

This is a local technical report with a synthetic model pilot. Its comparator is a minimal direct
invocation harness using the same provider adapter. It does not rank independently implemented
frameworks or reproduce upstream coding, optimization, compression, or learning results.

## Evidence

`raw/` preserves captured bytes. The scoped Biome configuration excludes it from automatic
formatting; research scripts and authored configurations remain checked. Figures use ReportLab's
standard chart library; PDF pages are rendered for visual inspection with bundled Poppler.

| Artifact | Evidence |
| --- | --- |
| `raw/provenance.json`, `raw/configuration/` | Source revision, initial working-tree status, unchanged runtime paths, exact configuration snapshots and SHA-256 hashes |
| `raw/kernel-1.json` through `raw/kernel-3.json` | Three fresh-dataset repetitions in one Node process; raw samples and summaries |
| `raw/kernel-*-slo.json` | 30 fixed-budget comparisons, all passing |
| `raw/scope-1.json`, `raw/scope-1-slo.json` | Scope raw samples, 150 passed recorded restoration checks, 16/17 passing budgets; clone/medium revert p95 314.139 ms exceeds 250 ms |
| `raw/carriers.stdout.json`, `raw/carriers.stderr.txt` | Failed copy-storage assertion and retained output; precise volume-delta storage claims are unsupported |
| `raw/checkpoints.stdout.json` | Four paired closed-footprint measurements of checkpoint overhead |
| `raw/device-layers.stdout.json` | Copy/clone timing summaries; overlay unavailable and container probe unavailable in this lane; no depth sweep |
| `raw/offline-applications.json` | Fresh deterministic fixture evaluation; usage/cost values are configured synthetic accounting |
| `raw/agent-study/results.json` | 96 actual local-model calls, full HTTP bodies/responses, usage including failures, independent answer/evidence grades |
| `raw/agent-study/reliability.json`, `trace-archive.json` | Terminal result repetition, reopen, import, and store integrity evidence |
| `raw/agent-study-smoke/` | Six setup calls, excluded from the reported task denominator |
| `raw/journal.json` | Original collection status, including the carrier failure and a refused study-runner application call |
| `verification.json` | Verification results, limitations, and execution/setup corrections |

The first offline application invocation erroneously passed an extra `artifacts` option and was
refused. The corrected invocation passed only `bind` and `definition`, ran all four fixtures, and
saved `raw/offline-applications.json`. The original journal is retained rather than rewritten.
Later runner edits add fresh-directory protection, output-directory arguments, archive export, and
configuration-driven harness roles; they preserve the measured request bodies and task definitions.

## Reproduce measurements

Use Node **24.17.0** and pnpm **10.32.1**, already installed on the recorded host. The measured
checkout contains earlier uncommitted documentation changes; provenance identifies them. Runtime
code is unchanged by this study, but rerunning on publication main reports package 13.7.1. These newer-runtime repetitions are distinct from the original study; exact historical reproduction requires the recorded revision and configuration snapshots.
These are measurement repetitions, not a promise of byte-identical timing or model results.

From the repository root, with that Node version selected:

```sh
pnpm build:desktop
node .plan/benchmarks/2026-10-05/run-study.mjs rerun-systems
node .plan/benchmarks/2026-10-05/run-agent-study.mjs rerun-agent
```

The positional paths resolve within this study directory. Use fresh names: system provenance and
agent databases are protected from accidental overwrite. Update `study.config.json`'s date when
collecting on a different day. Existing benchmark configurations are read from the repository and
copied into each system run; historical `docs/generated/benchmarks/` artifacts are not overwritten.
The system runner continues after a suite failure and records it in its journal. SLO verdicts are
separate JSON artifacts; an ordinary scope suite exit is not proof of SLO compliance.

The model runner requires the already installed, local `qwen2.5-coder:0.5b` model on Ollama at the
configured loopback endpoint. It refuses a cloud-backed model. Endpoint, model, seed, task inputs,
prompt, output cap, and harness identities live in [agent-study.config.json](./agent-study.config.json).
Loopback access may require host permission in a sandbox. No paid credentials are needed. Oracle
selection is deliberately a study treatment, not an implemented production retrieval capability.

## Reproduce analysis and paper

The analysis defaults to the captured `raw/` evidence. It requires Python with ReportLab and
pypdfium2. The recorded bundled runtime is:

```sh
/Users/avnionur/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 .plan/benchmarks/2026-10-05/analysis.py
/Users/avnionur/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 .plan/benchmarks/2026-10-05/build-paper.py
./node_modules/.bin/biome check --write .plan/benchmarks/2026-10-05
```

`analysis.py` validates exact configuration snapshots, request equality, output equality, and
independently recomputed task scores. It exports CSV/JSON summaries and standalone vector PDF and
PNG figures. The eight-task bootstrap uses seed 20261005 and 10,000 whole-task draws; its interval
is conditional on this synthetic battery. `build-paper.py` reads the authored manuscript and
derived results to produce the PDF and self-contained LaTeX source. The latter embeds plots,
without external image or bibliography files. Both formats share paragraphs and measurement tables.
Follow-up source edits can remain in the same native LaTeX editor; rebuilding from the authored
manuscript replaces the generated source.

The native editor open request was queued; the built-in compilation call did not return diagnostics
before its wait was canceled. Native LaTeX compilation is therefore **unverified**. The delivered PDF
is generated separately with ReportLab and its rendered pages are visually checked. No TeX package
or plugin installation was performed.

## Verification commands

```sh
node --test test/benchmark/kernel-benchmark.test.ts test/benchmark/scope-benchmark.test.ts test/provider/provider-conversation.test.ts test/applications/application-evaluation.test.ts test/applications/trajectory-compression-crash.test.ts
pnpm sync:version
pnpm build:desktop
pnpm generate:sbom
pnpm generate:api-reference
pnpm update:compatibility-baseline
pnpm verify
```

The focused run passed 35 tests. `verification.json` records the full repository gate, sandbox and
host distinctions, build evidence, and document checks. Existing coverage gates and assertions are
unchanged. No runtime fix, issue closure, branch switch, commit, or push is part of this study.

## PR publication verification

Publication release 13.7.1 is based on main 13.7.0. A fresh complete `pnpm verify` succeeded:
1,416 passed, zero failed, two documented skips, 100% configured coverage, installed-package
and quickstart gates passed. See [publication log](./evidence/publication-verify.txt).
The historical verification failures and benchmark negatives above remain unchanged.
