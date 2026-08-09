# Run Outcomes

Implementation: [`src/run`](../src/run). Public exports:
[`src/index.ts`](../src/index.ts). Tests and fixture:
[`test/run`](../test/run) and
[`test/fixtures/run-outcome-v1.json`](../test/fixtures/run-outcome-v1.json).

## Contract

`createRunOutcome(definition)` creates one deeply frozen canonical record for exactly one terminal
task-run result. Every record carries:

- the configured `outcome_version`;
- a caller-assigned non-empty `run_id`;
- the exact versioned `task_artifact_lock` executed by the run;
- one closed terminal outcome.

The four terminal shapes are:

| Status | Required data | Meaning |
| --- | --- | --- |
| `finished` | canonical `value` | The task completed with a value. |
| `failed` | `error_type`, `message`, `retryable` | Execution began and ended in a classified failure. |
| `exhausted` | `reason` | A declared delivery budget ended the run. |
| `cancelled` | `reason` | External control stopped the run. |

The TypeScript definition uses `errorType`; the canonical wire record uses `error_type`.
Omitted retryability becomes `null`, preserving the difference between unknown and `false`.
`cancelled` is the wire spelling for the upstream runtime's externally stopped outcome and the
hosted documentation's cancellation ending.

## Validation and identity boundary

Definitions and nested outcomes are closed plain data objects. Unknown fields, accessors, symbol
properties, unsupported statuses, empty or malformed text, non-canonical successful values, and
incompatible task locks are rejected before snapshotting. Task lock versions, identity prefixes,
digest lengths, and lowercase hexadecimal encodings are validated against the task protocol.

The lock is an exact provenance citation, but outcome construction does not claim that the task is
registered or that execution occurred. A later execution slice will resolve the lock, validate
inputs and outputs, append trace evidence, and produce this record.

## Configuration and schema

Outcome version, terminal status vocabulary, schema identifier, and generated artifact path live
under `runs` in [`protocol.config.json`](../protocol.config.json). Run protocol v1 is compatibility
locked; changing its existing values requires a new protocol version. The generated
[`run-outcome-v1.schema.json`](../spec/schemas/run-outcome-v1.schema.json) validates the same closed
wire shapes independently of TypeScript.

Artifacts, usage, budgets, `AbortSignal` behavior, persistence, and task execution are separate
capabilities and are not fabricated by this record builder.
