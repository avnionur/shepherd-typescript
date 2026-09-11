# Shared Protocol Specification

This directory contains language-neutral protocol artifacts implemented by the TypeScript
package and suitable for independent compatibility implementations.

- `schemas/` contains JSON Schema 2020-12 wire contracts.
- `schemas/trace-archive-v1.schema.json` defines lossless native trace interchange.
- `schemas/task-descriptor-v1.schema.json` defines canonical bodyless task artifacts.
- `schemas/task-artifact-lock-v1.schema.json` defines exact task artifact citations.
- `schemas/orphan-operation-diagnosis-v1.schema.json` defines bounded read-only operation
  diagnosis.
- `schemas/orphan-repair-command-v1.schema.json` and
  `schemas/orphan-repair-receipt-v1.schema.json` define exact bookkeeping-only repair evidence.
- `schemas/scope-registration-v1.schema.json`, `schemas/scope-child-registered-v1.schema.json`,
  and `schemas/scope-emission-v1.schema.json` define trace-only scope ownership, origin, authority,
  and fenced emission records.

Runtime implementations must validate the semantic rules that JSON Schema cannot express, such as
`record_id == digest`, versioned digest input, root-witness constraints, parent existence,
append-local reference order, and owner-ordinal uniqueness.
Schemas carrying `x-shepherd-max-utf8-bytes` require the named UTF-8 byte bound in addition to
ordinary JSON Schema string constraints; `x-shepherd-max-canonical-bytes` likewise bounds the
complete canonical JSON representation.
For task object schemas, implementations must also require the sorted `required` members to equal
the `properties` keys; descriptor and lock digests must be recomputed rather than trusted.

Cross-language conformance vectors are test assets under `test/fixtures/`.

The schemas are generated from `protocol.config.json`. Update them with
`pnpm generate:protocol`; do not edit them directly.
