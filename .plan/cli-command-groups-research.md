# CLI command-group research

Status: Phase 4 Task 10 implemented oracle record

## Pinned oracle

- Repository: `https://github.com/shepherd-agents/shepherd`
- Tag: `v0.3.0`
- Revision: `a8196d4c453514836d06bd2fece91a03cdc37107`
- Primary source: `shepherd/packages/dialect/src/shepherd_dialect/cli.py`
- Primary tests:
  - `shepherd/packages/dialect/tests/test_run_repair.py`
  - `shepherd/packages/dialect/tests/test_run_trace.py`
  - `shepherd/packages/dialect/tests/test_nucleus_run_ledger.py`
  - `shepherd/packages/dialect/tests/test_workspace_control_fenced_run_start.py`
  - `shepherd/packages/dialect/tests/test_workspace_control_run_output_wrappers.py`

## Extracted topology

The pinned dialect CLI exposes `run` and `task` groups. `run` includes list/show, direct trace
revision and run-trace views, vcs-core/output citations, retained outputs and changesets,
select/apply/release/discard settlement, retained-output publication, fenced start, and orphan
repair. `task` includes list/show/register/resolve. Exact run mutation does not accept read aliases;
reads accept exact, prefix, or latest selectors where the underlying ledger does.

The repository roadmap additionally documents top-level `init`, `doctor`, `demo`, and `package`
families. Complete release-tag implementations for those families are not present in the pinned
dialect source. The TypeScript CLI therefore implements initialization and diagnostics from its
shipped public APIs, while `demo write`, `package init`, dynamic task registration, and fenced run
start remain visible configured refusals instead of speculative behavior.

## Pinned arguments and formatting

| Command | Pinned arguments/options | Human result or refusal |
| --- | --- | --- |
| `run list` | `--status`, `--task-id`, `--max-count`, `--json` | one bounded run summary per row |
| `run show` | optional `RUN_REF`, `--latest`, `--json` | selected run fields; missing selection fails |
| `run trace[-revision]` | run/revision ref, `--latest`, `--events`, `--json` | trace summary and optional events |
| `run output-citations` | optional run ref, `--binding`, `--latest`, `--json` | raw citations without custody claim |
| `run outputs` | optional run ref, `--trace-store`, `--binding`, `--state`, `--latest`, `--json` | validated retained outputs |
| `run changeset` | optional run ref plus store/output/binding/state/latest/read/json options | summary or bounded file read; read/json conflict |
| `run select/apply/release/discard` | exact run ref plus store/output/binding | consume-once settlement summary |
| `run repair` | `--json` | reclaimed count/IDs or “nothing to repair” |
| `run start` | task ref, args/may/placement/reason | fenced unless explicitly enabled upstream |
| `task list/show` | status/prefix or task ref; optional `--json` | artifact/grant summaries |
| `task register` | source plus task-id/may-default/metadata | dynamic source load and registration upstream |
| `task resolve` | task ref, reason, parent-run, `--json` | resolved artifact; raw parent-run fails closed |

Pinned selector helpers reject a positional run ref combined with `--latest`, require one when the
command is not an optional list, and keep exact mutation separate from read aliases. Click usage
errors use its usage class; command/workspace/vcs-core failures become one user-facing exception
message. The TypeScript mapping fixes numeric exits in protocol configuration and uses concise
tabular list rows plus labelled show fields; those human bytes are tested but not declared stable
machine output.

## Errors and output

Pinned Click usage errors distinguish missing/conflicting selectors and mutually exclusive flags.
Workspace and vcs-core errors become user-facing `ClickException` messages. Orphan-operation
errors map to the Shepherd-level repair remedy rather than exposing the lower-layer archive
function. Human list/show formatting is deterministic and bounded; several pinned commands expose
`--json`, but stable machine output and generated reference are a separate Phase 4 slice.

The TypeScript executable uses configured exit classes: success, runtime failure, usage refusal,
and unavailable capability. It emits error messages without stacks. Output, argument count, and
argument bytes are bounded by protocol configuration.

## Compatibility boundary

The executable name is deliberately `shepherd-ts`; no `shepherd` compatibility alias is claimed.
The CLI delegates mutations to existing exact public APIs and introduces no new provider,
filesystem, Git, custody, settlement, or repair authority. Stable JSON, generated command
reference, demo/package scaffolding, dynamic source loading, and the packaged offline quickstart
remain later issues.
