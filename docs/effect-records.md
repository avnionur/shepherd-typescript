# Effect Intent and Outcome Records

Implementation: [`src/effect/records.ts`](../src/effect/records.ts), public types:
[`src/effect/types.ts`](../src/effect/types.ts), runtime validation:
[`src/effect/validation.ts`](../src/effect/validation.ts). Tests:
[`test/effect/records.test.ts`](../test/effect/records.test.ts) and
[`test/effect/protocol.test.ts`](../test/effect/protocol.test.ts). Fixture:
[`test/fixtures/effect-record-v1.json`](../test/fixtures/effect-record-v1.json).

## Record lifecycle

`createEffectIntent()` emits a closed, deeply frozen semantic record before an external action may
materialize. It records the caller-assigned effect ID, application-defined kind, typed semantic
payload, and one configured reversibility tier. The three v1 tiers are `reversible`,
`compensable`, and `irreversible`.

`createEffectOutcome()` accepts that intent and either a typed success value or typed failure
value. It emits a closed, deeply frozen outcome that repeats the effect ID and kind and contains
`intent_ref`, the configured digest of the complete canonical intent.

```ts
const intent = createEffectIntent({
    effectId: "effect:tool:1",
    kind: "tool.call",
    payload: { command: "pnpm test" },
    reversibility: "irreversible",
});

const outcome = createEffectOutcome(intent, {
    ok: true,
    value: { exitCode: 0 },
});

validateEffectCorrelation(intent, outcome);
```

Use JSON `null` when a successful effect has no return value. Effect payloads, success values, and
failure values use the canonical semantic-value rules; undefined values, non-finite numbers,
accessors, symbols, custom prototypes, sparse arrays, and cycles are rejected.

## Exact correlation

`validateEffectCorrelation()` validates both closed wire records and requires equal effect IDs,
equal kinds, supported versions and phases, and an exact recomputation of `intent_ref`. Because the
reference covers the complete intent, changing its ID, kind, payload, version, phase, or
reversibility invalidates the outcome relationship.

This module defines records and correlation only. It does not materialize effects, append them to a
trace, enforce intent-before-outcome ordering across storage, or run observers and interceptors.
Those runtime concerns consume this protocol in later slices.

## Protocol artifacts

Versions, phases, reversibility vocabulary, digest settings, schema IDs, and generated artifact
paths are defined in [`protocol.config.json`](../protocol.config.json) and compatibility locked as
effect protocol v1. Generated JSON Schemas live at
[`spec/schemas/effect-intent-v1.schema.json`](../spec/schemas/effect-intent-v1.schema.json) and
[`spec/schemas/effect-outcome-v1.schema.json`](../spec/schemas/effect-outcome-v1.schema.json).
