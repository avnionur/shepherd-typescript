# Offline Task Execution

Implementation: [`src/run/execution.ts`](../src/run/execution.ts), with terminal-result construction
in [`src/run/execution-results.ts`](../src/run/execution-results.ts). Public entry point:
[`src/index.ts`](../src/index.ts). Tests:
[`test/run/execution.test.ts`](../test/run/execution.test.ts).

## Execution contract

`executeTask(options)` runs one bodyless task through a provider-neutral structured boundary. It
validates the closed option container, run identity, task input, budget, and optional caller
signal before invoking the provider. Task descriptors must be authenticated values returned by
this package's `task` builder; structural copies are rejected so a changed instruction or parser
cannot cite an older artifact lock. The request contains the validated canonical input, exact task
instruction, and output JSON Schema from the task artifact.

One turn is consumed before provider invocation. A zero-turn budget therefore produces an
`exhausted` outcome without consuming a deterministic provider exchange. The same composed
`AbortSignal` governs pre-abort, in-flight caller cancellation, and duration exhaustion.

The immutable result contains:

- a terminal `RunOutcome` bound to the exact task artifact lock;
- aggregate `RunUsage`, or `null` when no valid provider response was observed;
- the provider descriptor used by the run;
- the final `RunControlSnapshot` captured before internal timer and listener cleanup.

## Validation and terminal behavior

Provider descriptors and responses are treated as untrusted. The executor validates and snapshots
provider identity, capabilities, semantic output, and usage before returning or accounting, then
parses output through the task's exact runtime schema. Successful void values are normalized to
canonical JSON `null`.

Provider errors become classified `failed` outcomes. Output-schema errors use the configured
`TaskOutputValidationError` classification and retain observed provider usage. Budget exhaustion
and caller cancellation remain distinct terminal outcomes, including when a provider ignores an
abort and resolves late. If a cost budget is configured but the provider reports unavailable cost,
execution fails closed instead of claiming that the limit was enforced.

When a provider resolves only after control became terminal, its validated `RunUsage` remains the
authoritative late observation. The control snapshot retains counters admitted before the first
terminal transition and is not rewritten after cancellation or exhaustion.

Observed token and cost usage is consumed before output validation. A response that crosses a
configured token or measured-cost limit therefore returns `exhausted` with its usage retained.
Malformed caller input and malformed execution options throw `TypeError` before provider
invocation because no run has begun.

## Configuration and boundary

Stable executor failure classifications and fallback messages live under `runs.execution` in
[`protocol.config.json`](../protocol.config.json). Terminal statuses and control lifecycle values
remain generated, typed, and compatibility locked.

This executor is deliberately offline and side-effect free beyond the supplied provider. It does
not itself persist a run ledger, append lifecycle records, dispatch effects, or create artifacts.
[`executeTaskDurably`](./durable-task-execution.md) wraps the same validated execution with trace
evidence; effect dispatch and artifact collection remain separate capabilities.
