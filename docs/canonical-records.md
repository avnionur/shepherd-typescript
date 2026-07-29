# Canonical Record Contract

Implementation: [`src/canonical-record.ts`](../src/canonical-record.ts). Public exports:
[`src/index.ts`](../src/index.ts). Tests:
[`test/canonical-record.test.ts`](../test/canonical-record.test.ts).

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
- cyclic arrays or objects.

## Encoding rules

1. Encode as UTF-8 JSON without insignificant whitespace.
2. Sort object keys recursively using JavaScript's UTF-16 code-unit order.
3. Preserve array order.
4. Omit undefined object properties.
5. Use ECMAScript number serialization and encode negative zero as zero.
6. Preserve supplied Unicode code points without normalization.
7. Reject lone Unicode surrogates.
8. Read the digest algorithm and identifier prefix from `protocol.config.json`.

The initial protocol uses SHA-256 and identifiers shaped as `sha256:<lowercase hex digest>`.

## Stability

Changing any encoding rule is a protocol-breaking change. Storage locations, timestamps, and
backend receipts must not be added to a semantic record unless they are intended to affect its
identity.

## Public seam

`canonicalizeRecord(record)` returns canonical JSON.

`createRecordId(record)` hashes the canonical UTF-8 bytes and returns a configured identifier.

Both functions are exported from `src/index.ts` and covered through that public module.
