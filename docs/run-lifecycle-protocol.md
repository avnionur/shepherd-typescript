# Run Lifecycle Protocol

Implementation: [`src/run/lifecycle.ts`](../src/run/lifecycle.ts). Public types:
[`src/run/lifecycle-types.ts`](../src/run/lifecycle-types.ts). Public entry point:
[`src/index.ts`](../src/index.ts). Generated schemas:
[`spec/schemas/run-continuation-descriptor-v1.schema.json`](../spec/schemas/run-continuation-descriptor-v1.schema.json),
[`spec/schemas/run-lifecycle-waiting-v1.schema.json`](../spec/schemas/run-lifecycle-waiting-v1.schema.json),
[`spec/schemas/run-lifecycle-suspended-v1.schema.json`](../spec/schemas/run-lifecycle-suspended-v1.schema.json),
and
[`spec/schemas/run-lifecycle-running-v1.schema.json`](../spec/schemas/run-lifecycle-running-v1.schema.json).
Tests: [`test/run/lifecycle.test.ts`](../test/run/lifecycle.test.ts) and
[`test/run/lifecycle-protocol.test.ts`](../test/run/lifecycle-protocol.test.ts).

## Implemented contract

`createRunLifecycleTransition(definition)` validates and freezes one transition against the
configured normative matrix. The matrix permits:

- `created → running`;
- `running → waiting → running`;
- `running → suspended → running`;
- configured terminal outcomes from each non-terminal source state.

The terminal matrix rejects successful completion directly from `created`, `waiting`, or
`suspended`. Those states must enter `running` before a `finished` outcome. Terminal states have no
outgoing transition.

This builder validates transition topology and terminal-outcome legality. It does not assert that
a durable command, lifecycle record, checkpoint, receipt, expected owner head, or fencing token
exists. Runtime mutation must validate those evidence contracts independently before citing the
transition.

## Continuation descriptor

The generated continuation-descriptor schema requires:

- the configured wire version;
- a non-empty execution identity and trace-cut identity;
- exactly one entry for every configured constituent kind, in configured order;
- a receipt identity for `verified` evidence;
- no receipt identity for `not_required` or `unavailable` evidence.

The current constituent kinds classify managed-world, provider-session, process, and prerequisite
state. An `unavailable` required constituent remains valid descriptive evidence but cannot
authorize same-run resume.

## Waiting, suspended, and resumed-running evidence

The generated waiting schema binds an execution to a continuation-descriptor record and an
explicit prerequisite descriptor. The suspended schema binds an execution to a continuation
descriptor and a content-addressed pause-command record. The running-continuation schema binds the
resumed execution to the exact descriptor, resume command, claim, fencing token, and lease. All are
closed versioned record bodies.

These schemas do not make the current one-shot executor automatically pausable or restorable.
Read-only durable inspection validates cut-bound waiting and suspension evidence. The runtime can
retain a globally idempotent pause request, collect configured checkpoint evidence, and atomically
publish either a command-bound suspension acknowledgement or prerequisite-driven waiting
acknowledgement while releasing the exact current worker fence. It then validates an exact resume
command, rejects unavailable evidence, requires independently verified matching prerequisite
satisfaction for waiting, acquires the next monotonic fence, and publishes running authority
without invoking a provider or restoring external state. The remaining lifecycle work is tracked
in the proposed [`normative-run-lifecycle.md`](../.plan/normative-run-lifecycle.md) contract.

## Configuration

Lifecycle statuses, legal transition pairs, terminal source/outcome pairs, continuation versions,
constituent kinds, evidence statuses, the receipt-bearing evidence status, schema identifiers, and
artifact destinations are validated from [`protocol.config.json`](../protocol.config.json).
Generated TypeScript values and JSON Schemas cannot drift from the immutable run-protocol
compatibility contract.
