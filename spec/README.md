# Shared Protocol Specification

This directory contains language-neutral protocol artifacts shared by the TypeScript and planned
native Python implementations.

- `schemas/` contains JSON Schema 2020-12 wire contracts.

Runtime implementations must validate the semantic rules that JSON Schema cannot express, such as
`record_id == digest`, versioned digest input, root-witness constraints, parent existence,
append-local reference order, and owner-ordinal uniqueness.

Cross-language conformance vectors are test assets under `test/fixtures/`.

The schemas are generated from `protocol.config.json`. Update them with
`pnpm generate:protocol`; do not edit them directly.
