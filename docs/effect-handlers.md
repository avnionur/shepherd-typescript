# Ordered Effect Handlers

Implementation: [`src/effect/handlers.ts`](../src/effect/handlers.ts), public types:
[`src/effect/handler-types.ts`](../src/effect/handler-types.ts), errors:
[`src/effect/handler-errors.ts`](../src/effect/handler-errors.ts), public package entry:
[`src/facades/effects.ts`](../src/facades/effects.ts). Tests:
[`test/effect/handlers.test.ts`](../test/effect/handlers.test.ts).

## Stack construction

`createEffectHandlerStack()` validates and snapshots an ordered array of exact-kind handler
definitions. Each definition has a stable diagnostic `handlerId`, an application-defined effect
`kind`, and a synchronous or asynchronous `handle` function. Handler IDs must be unique within a
stack.

```ts
const handlers = createEffectHandlerStack([
    {
        handlerId: "fallback.tool",
        kind: "tool.call",
        handle: () => ({ ok: true, value: null }),
    },
    {
        handlerId: "local.tool",
        kind: "tool.call",
        handle: (intent) => ({ ok: true, value: intent.effect_id }),
    },
]);

const dispatch = await handlers.dispatch(intent);
```

The stack and its copied bindings are immutable. Mutating a source definition after construction
does not change selection identity or kind.

## Dispatch contract

The v1 configured selection policy is `last_matching`: dispatch scans installation order from
last to first and invokes only the nearest exact-kind match. Wildcard, prefix, inheritance, and
arbitrary predicate matching are not supported by this slice.

Dispatch validates and snapshots the complete intent before invoking user code. A handler therefore
cannot observe a malformed intent or mutate the value used for outcome identity. The handler must
return an explicit semantic success or failure result; dispatch passes that result through
`createEffectOutcome()` and returns a frozen `{ handlerId, outcome }` value.

If no handler matches, dispatch throws `EffectHandlerNotFoundError`. If a handler throws or
rejects, the original failure propagates unchanged and no fabricated semantic outcome is created.
Malformed results fail with `TypeError`.

This stack interprets an intent in-process but does not append records, materialize world changes,
install dynamic async-context bindings, intercept execution, notify observers, or create receipts.
Those responsibilities remain separate runtime slices.

## Typed payload adapter

`createTypedEffectHandler({ handlerId, kind, payloadSchema, handle })` adapts a callback whose
payload type is inferred from an existing package-created schema. It is exported by the root
and effects entries; construct schemas through the tasks entry. It returns an ordinary frozen
`EffectHandler`, so stack precedence and outcome correlation are unchanged.

The adapter authenticates the schema and snapshots the option fields without evaluating accessors.
On each call it validates the canonical intent, checks the exact kind, freezes the intent, parses
the application payload, and only then invokes `handle(payload, intent)`. The callback receives
the parsed value separately from the original intent, preserving canonical identity even when
a void schema parses null into undefined. Canonical success/failure result validation and freezing
also apply to direct `handler.handle(intent)` calls. Callback errors propagate unchanged.

This initial helper validates payload schemas; it does not infer a narrower return type from
`EffectHandlerStack.dispatch`, add output schemas, translate undefined results to null, register
effect kinds globally, or create durable execution. Callbacks return the ordinary semantic result
contract. Return explicit null for a successful operation with no value.

Implementation: [typed-handler.ts](../src/effect/typed-handler.ts). Public-interface tests:
[typed-handlers.test.ts](../test/effect/typed-handlers.test.ts). The installed
[custom-effects example](../examples/custom-effects.ts) proves callback inference and dispatch.
