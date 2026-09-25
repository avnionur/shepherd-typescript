# Provider Contract and Static Provider

Implementation: [`src/provider/static-provider.ts`](../src/provider/static-provider.ts). Public
types and errors: [`src/provider/types.ts`](../src/provider/types.ts) and
[`src/provider/errors.ts`](../src/provider/errors.ts). Tests:
[`test/provider/static-provider.test.ts`](../test/provider/static-provider.test.ts),
[`test/provider/static-provider-validation.test.ts`](../test/provider/static-provider-validation.test.ts),
and [`test/provider/protocol.test.ts`](../test/provider/protocol.test.ts).

Package consumers may import the owned provider contract, deterministic adapter, response
artifact/usage types, and stable errors from `@avnionur/shepherd-typescript/providers` without
importing task execution, tools, credentials, or workspace authority.

## Provider-neutral boundary

`ModelProvider` exposes `descriptor()` and `invoke(request, signal)`. The immutable descriptor
identifies the provider instance, provider kind, model, and declared streaming, structured-output,
and tool capabilities. Tasks do not select providers; [`executeTask`](./task-execution.md) binds a
provider for a run and maps the task instruction, validated input, and output JSON Schema into
`ModelRequest`.

`ModelResponse` contains one canonical semantic output, optional ordered artifact definitions, and
per-invocation token, cache-token, and optional cost usage. Artifact definitions contain a kind,
name, semantic metadata, and either inline text or a durable blob receipt; the executor binds them
to its run and assigns protocol ordinals. Provider-call usage is distinct from the aggregate
`RunUsage` record. The provider boundary validates semantic data but does not claim that an output
satisfies the request's JSON Schema; the task executor remains responsible for parsing the output
through the exact task descriptor before publishing a finished outcome.

## Deterministic cassette

`createStaticProvider(definition)` snapshots an ordered sequence of exact request/response
exchanges. Each invocation validates and canonicalizes its request, compares it with the next
expected request, and returns the already-frozen configured response. Object key declaration order
does not affect the comparison; semantic values, array order, instruction text, and output schema
do.

The cassette is deliberately single-pass. A mismatch throws `StaticProviderRequestMismatchError`
without consuming the exchange. Invoking after the final exchange throws
`StaticProviderExhaustedError`. Both errors expose a configuration-owned stable code and the
zero-based cassette position. Construct a new provider from the same immutable definition to
replay from the beginning; there is no mutable reset surface.

## Cancellation and validation

`invoke` requires an `AbortSignal` and checks it before reading or consuming an exchange. A
pre-aborted signal rejects with its original reason, leaving the cassette unchanged. The static
provider performs no asynchronous transport work. The [live adapters](./live-providers.md) observe
the same signal while their requests are pending.

Definitions and invocation requests are closed descriptor-safe data. The implementation rejects
accessors, symbols, sparse/custom arrays, unknown fields, invalid Unicode, non-canonical semantic
values, unsafe token counts, and invalid cost values. Provider kinds, static capabilities, and
error codes/messages are compatibility-locked under `providers` in
[`protocol.config.json`](../protocol.config.json). Since 5.1.0 the kind vocabulary also lists the
configured live kinds; see [live providers](./live-providers.md) for the Anthropic Messages and
OpenAI-compatible adapters, the multi-turn message model, and provider conversations.

The provider itself does not append events, validate task output, or create run outcomes. The
offline executor owns task-schema validation, artifact ordinal assignment, and terminal
normalization; the durable executor owns retained lifecycle, artifact, usage, and outcome evidence.
