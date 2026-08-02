# Shared Protocol Specification

This directory contains language-neutral protocol artifacts implemented by the TypeScript
package and suitable for independent compatibility implementations.

- `schemas/` contains JSON Schema 2020-12 wire contracts.
- `schemas/trace-archive-v1.schema.json` defines lossless native trace interchange.
- `schemas/task-descriptor-v1.schema.json` defines canonical bodyless task artifacts.
- `schemas/task-artifact-lock-v1.schema.json` defines exact task artifact citations.

Runtime implementations must validate the semantic rules that JSON Schema cannot express, such as
`record_id == digest`, versioned digest input, root-witness constraints, parent existence,
append-local reference order, and owner-ordinal uniqueness.
For task object schemas, implementations must also require the sorted `required` members to equal
the `properties` keys; descriptor and lock digests must be recomputed rather than trusted.

Cross-language conformance vectors are test assets under `test/fixtures/`.

The schemas are generated from `protocol.config.json`. Update them with
`pnpm generate:protocol`; do not edit them directly.
