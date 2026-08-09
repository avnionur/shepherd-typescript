# Run Budgets and Cancellation

Implementation: [`src/run/control.ts`](../src/run/control.ts). Public exports:
[`src/index.ts`](../src/index.ts). Tests:
[`test/run/control.test.ts`](../test/run/control.test.ts).

## Contract

`createRunControl(options)` creates one cooperative controller for an executing run. A budget may
limit turns, effects, elapsed milliseconds, aggregate input/output tokens, and aggregate US-dollar
cost. Limits are optional and validated before timers or caller-signal listeners are installed.

`consume(delta)` records non-negative incremental counter consumption. Equality remains active;
the first configured metric whose aggregate exceeds its limit transitions control to `exhausted`.
The triggering observation remains in the frozen snapshot so partial execution evidence is not
rewritten or hidden. Integer accounting rejects unsafe overflow and cost accounting rejects
non-finite overflow.

Duration limits use the configured safe Node timer bound and transition after the allowed interval.
The controller's signal aborts with `RunBudgetExhaustedError`, carrying the metric, limit, and
observed aggregate.

## Cancellation and races

An optional caller `AbortSignal` is composed into the controller. A pre-aborted signal cancels
immediately; a later abort transitions control synchronously with `RunCancelledError`. Its stable
public message is configuration-owned, while the caller's original signal reason is retained as
the error cause. Disposing active control is also cancellation and releases the duration timer and
caller listener. Disposal after a terminal transition is idempotent.

The first transition wins across caller cancellation, budget exhaustion, duration expiry, and
disposal. Later transitions cannot replace the status, structured reason, or signal error.
Consumption after terminal control throws that original typed signal reason.

Cancellation is cooperative. The signal must be passed to providers, effect handlers, and other
async boundaries, which must stop and settle before a terminal run outcome is published. This
controller does not claim it can forcibly stop arbitrary promises, processes, or external side
effects. Permission enforcement remains a separate security boundary.

## Configuration and preservation

Run-control statuses, reason discriminants, metric precedence, stable cancellation/disposal text,
and maximum timer duration live under `runs.control` in
[`protocol.config.json`](../protocol.config.json). They are generated into typed literals and
locked by the run protocol v1 compatibility contract.

The control retains only consumption and a terminal reason. It neither deletes nor fabricates run
outcomes, artifacts, usage, effects, or trace records. Future execution code will use its signal
at every async boundary and translate exhaustion/cancellation into existing terminal outcome
records after partial evidence has settled.
