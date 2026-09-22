# Canonical Record Contract

Implementation: [`src/canonical/canonical-record.ts`](../src/canonical/canonical-record.ts),
[`src/canonical/errors.ts`](../src/canonical/errors.ts), and the internal explicit-stack JSON
text serializer [`src/canonical/json-text.ts`](../src/canonical/json-text.ts) (byte-identical to
`JSON.stringify` for plain data; also used by the JSON-lines telemetry sink). Public exports:
[`src/index.ts`](../src/index.ts) and `./canonical`. Tests:
[`test/canonical-record.test.ts`](../test/canonical-record.test.ts),
[`test/canonical-nesting-bound.test.ts`](../test/canonical-nesting-bound.test.ts), and
[`test/canonical-json-text.test.ts`](../test/canonical-json-text.test.ts).

## Purpose

Canonical records provide deterministic semantic identity. Equivalent records must serialize to
the same bytes and receive the same identifier regardless of object insertion order. The encoding
follows [RFC 8785 JSON Canonicalization Scheme](https://www.rfc-editor.org/rfc/rfc8785), with one
pre-encoding extension: undefined object properties are omitted.

## Input

Accepted values:

- strings, booleans, null, and finite numbers;
- dense arrays containing accepted values and no custom properties;
- plain objects containing accepted values or undefined properties.

Rejected values:

- sparse or undefined array elements;
- array accessors, symbols, or custom properties;
- `NaN`, positive infinity, and negative infinity;
- class instances and built-in objects such as `Date`;
- accessor or symbol properties;
- cyclic arrays or objects;
- arrays and objects nested deeper than the configured bound (see below).

## Nesting bound

From 2.33.0 (F-016, #189) the canonical value domain has a configured maximum nesting depth:
`kernel.canonicalization.maxNestingDepth` in `protocol.config.json` (default 1,000), validated at
load as a positive integer. Depth counts arrays and objects on the path from the outermost value,
which is level one; scalars and siblings do not add depth, so `{"a":[1]}` is two levels deep. A
value at the bound is accepted and one level deeper is refused with `CanonicalNestingLimitError`
(`CANONICAL_NESTING_LIMIT_EXCEEDED`, a `TypeError` exported from the root and `./canonical`), whose
`bound` names the configured depth and whose message contains no value content or key path.

The encoder walks and serializes values with explicit stacks and checks the bound before entering
the next container, so acceptance depends only on the value and the configuration, never on the
caller's stack depth or JIT state. Before 2.33.0 values nested roughly 2,000 to 8,000 levels deep
were accepted or refused depending on where they were canonicalized.

A value embedded in a larger canonical value has the bound minus its embedding depth: a record
body may be 1,000 levels deep, and a task value, effect payload, or model output inside a body
has correspondingly fewer levels. Kernel framing that embeds whole record bodies (the record
identity input, the append batch digest, and native and redacted archives) is encoded under
`maxNestingDepth + framingDepth` (`kernel.canonicalization.framingDepth`, default 8), so a body at
the bound can be appended, exported, imported, and redacted. Configuration load refuses a
`framingDepth` smaller than the deepest body location among those frames (`src/canonical/framing.ts`,
checked against the real frames by `test/canonical-nesting-bound.test.ts`). Readers that walk a
whole body (snapshots, secret scanning, OTLP body mapping, and telemetry batch freezing) use
explicit work lists, so they are independent of the caller's stack and of container width. A
typed-effect trace is content-addressed as one canonical value, so `classifyProofEnvelope` keeps a
trace whose record payload fits its record but not the whole trace `runtime_only`, and
`validateTypedEffectTrace` reports a payload past the bound as `CanonicalNestingLimitError`. The
[compatibility gate](./compatibility-policy.md) fingerprints both settings as
`identity:protocol.config.json#/kernel/canonicalization`.

Lowering the bound narrows the domain: a store holding a deeper body fails closed with
`CanonicalNestingLimitError` wherever that body is canonicalized again. Output beyond the runtime's
maximum string length is still refused as `TypeError` with the `RangeError` as cause.

## Encoding rules

1. Encode as UTF-8 JSON without insignificant whitespace.
2. Sort object keys recursively using JavaScript's UTF-16 code-unit order.
3. Preserve array order.
4. Omit undefined object properties.
5. Use ECMAScript number serialization and encode negative zero as zero.
6. Preserve supplied Unicode code points without normalization.
7. Reject lone Unicode surrogates.
8. Read the digest algorithm and identifier prefix from `protocol.config.json`.
9. Serialize with an explicit stack; the output is byte-identical to `JSON.stringify` of the
   normalized value (array-index keys first in ascending numeric order, then the remaining keys in
   sorted order), without invoking any `toJSON` method.

The initial protocol uses SHA-256 and identifiers shaped as `sha256:<lowercase hex digest>`.

## Stability

Changing any encoding rule is a protocol-breaking change. Storage locations, timestamps, and
backend receipts must not be added to a semantic record unless they are intended to affect its
identity.

## Public seam

`canonicalizeRecord(record)` returns canonical JSON.

`createRecordId(record)` hashes the canonical UTF-8 bytes and returns a configured identifier.

Both functions are exported from `src/index.ts` and covered through that public module.
