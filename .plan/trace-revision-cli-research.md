# Trace-revision CLI research

Status: Phase 4 Task 14 implemented oracle record

## Pinned oracle

- Repository: `https://github.com/shepherd-agents/shepherd`
- Tag: `v0.3.0`
- Revision: `a8196d4c453514836d06bd2fece91a03cdc37107`
- CLI source: `shepherd/packages/dialect/src/shepherd_dialect/cli.py`
- Generated reference: `https://docs.shepherd-agents.ai/reference/cli/`
- Primary tests: `shepherd/packages/dialect/tests/test_run_trace.py`

The shipped `run` group exposes both `trace` and the distinct `trace-revision` spelling.
Read commands accept latest and unique-prefix selectors and expose JSON. The trace-revision view is
read-only immutable evidence; it does not advance or repair a run.

## TypeScript mapping

The native `TraceRevisionEntry` already defines the stronger exact contract: one published cut and
its fully resolved immutable owner-prefix slice, with canonical ordering, exact/prefix/`@latest`
selectors, archive reconstruction, and configured bounds. `run trace-revision` is therefore a
separate configured handler identity that delegates to the same formatter/projection as `run
trace`. Human list/show bytes remain identical while stable JSON records the distinct command path.

No new trace record, cut, archive field, selector, or mutation authority is introduced.
