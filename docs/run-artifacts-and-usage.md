# Run Artifacts and Usage

Run artifacts and usage are independent immutable records correlated through `run_id`. They do
not change a run's terminal status and may be retained for finished, failed, exhausted, or
cancelled runs.

## Public entry points

[`createRunArtifact`](../src/run/artifacts.ts) creates one ordered side-channel output.
[`createRunUsage`](../src/run/usage.ts) creates aggregate resource totals for the entire run. Their
public types are exported from [`src/index.ts`](../src/index.ts).

Artifacts use an explicit configured zero-based `artifactOrdinal`. Text content is retained
inline. Binary bytes are never base64-embedded in the semantic record; callers first persist the
bytes through [`SQLiteTraceStore.putBlob`](../src/store/sqlite-trace-store.ts) and pass its durable
receipt. The artifact then retains only the configured content-addressed blob identity and exact
byte length.

Usage counts must be non-negative safe integers. `costUsd` must be finite and non-negative when
known; omission becomes `null` in the closed wire record. Counts represent aggregate run totals,
not one provider call.

Both builders reject unexpected fields, accessors, symbols, class instances, malformed Unicode,
invalid semantic metadata, unsafe ordinals, and invalid blob receipts. Returned records and nested
content are deeply frozen canonical snapshots.

## Protocol ownership and evidence

Versions, artifact content discriminants, ordinal bounds, schema identifiers, and generated schema
destinations are owned by [`protocol.config.json`](../protocol.config.json) and locked by the run
protocol v1 compatibility constant. Generated JSON Schemas live in
[`spec/schemas`](../spec/schemas).

Public behavior, malformed inputs, blob integration, immutability, independent fixtures, schema
closure, and configuration drift are covered by
[`test/run/artifacts-usage.test.ts`](../test/run/artifacts-usage.test.ts) and
[`test/run/protocol.test.ts`](../test/run/protocol.test.ts). Aggregate usage is retained by
[`executeTaskDurably`](./durable-task-execution.md). Automatic artifact collection remains a later
runtime slice; these builders do not claim that behavior.
