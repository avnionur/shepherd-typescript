# Record Body and Envelope Contract

Implementation:
[`src/record/envelope.ts`](../src/record/envelope.ts),
[`src/record/validation.ts`](../src/record/validation.ts), and
[`src/record/types.ts`](../src/record/types.ts). Public exports:
[`src/index.ts`](../src/index.ts). Tests:
[`test/record-envelope.test.ts`](../test/record-envelope.test.ts).

## Protocol versions

The implemented record contract is `shepherd.kernel.abi.v0`. Record identity uses
`shepherd.kernel.canonical.v2`.

The ABI and canonical versions are runtime values loaded from `protocol.config.json` and exported
as `KERNEL_ABI_VERSION` and `KERNEL_CANONICAL_VERSION`. The JSON Schema documents are versioned
independently by their `$id`.

## Record body

A `RecordBody` is a schema-specific semantic object. It follows the canonical-record value rules:
plain objects, dense arrays, finite numbers, booleans, strings, and null. Storage paths, owner
ordinals, receipts, insertion timestamps, and backend metadata do not belong in the body unless
they are intentionally part of semantic identity.

`validateRecordBody(value)` validates untrusted input without changing it.

## Record envelope

A `RecordEnvelope` contains:

| Field | Meaning |
| --- | --- |
| `record_id` | Versioned content identifier; equal to `digest` in ABI v0 |
| `digest` | Versioned canonical digest of the semantic record input |
| `schema_ref` | Non-empty identifier for the body schema |
| `mode` | `capture` or `declaration` |
| `witness_ref` | Retained witness record ID, or the root sentinel for only the root witness |
| `caused_by_record_ids` | Ordered causal-parent record IDs |

Snake-case field names are intentional because the envelope is a language-neutral wire contract.
The protocol version, owner path, owner ordinal, storage receipts, and local timestamps remain
outside the envelope. One semantic record can therefore appear at multiple owner paths without
changing identity.

## Identity

`createRecordEnvelope(draft)` hashes this canonical input:

```json
{
    "body": {},
    "caused_by": [],
    "kind": "record",
    "mode": "capture",
    "schema_ref": "example.record.v1",
    "witness": "sha256:<64 lowercase hexadecimal characters>"
}
```

The SHA-256 input is:

```text
shepherd.kernel.canonical.v2\n<canonical-json-bytes>
```

Parent order participates in identity. Changing the mode, schema reference, witness reference,
body, or parent order changes the digest.

The lower-level `createRecordId(record)` API intentionally hashes canonical JSON without this
kernel version prefix. Use `createRecordEnvelope` for kernel record identity.

## Root witness

The empty witness sentinel is legal only for the configured root witness record. Its schema,
capture mode, empty causal-parent list, and body must match `protocol.config.json`. Every other
record requires a configured content identifier as its witness reference.

## Validation and fixtures

`validateRecordEnvelope(value, body)` validates the exact envelope shape and recomputes identity
from the supplied body. It rejects extra or missing fields, malformed identifiers, unsupported
modes, invalid root witnesses, and identity mismatches.

Normative JSON Schema 2020-12 documents live in `spec/schemas/`. Cross-language golden vectors
live in `test/fixtures/kernel-record-envelope-v0.json` and retain their pinned upstream revision
and source path.

`protocol.config.json` is the editable source for record modes, identifier shape, schema IDs, and
artifact paths. `pnpm generate:protocol` derives the TypeScript mode tuple and both schemas.
`pnpm check:protocol` rejects stale generated files. Ajv strictly meta-validates the schemas and
tests positive and negative instances.
