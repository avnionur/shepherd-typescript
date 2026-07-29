# Shepherd TypeScript

An independent TypeScript implementation of Shepherd's reversible agent execution model.

The project is being built as a complete TypeScript implementation over a language-neutral
protocol. Upstream Python behavior is used as a compatibility oracle where applicable; a native
Python package is not a project deliverable. This project is not affiliated with the upstream
Shepherd authors.

Naming and MIT licensing are defined, but publication remains disabled until package exports,
consumer compatibility, and release checks are complete. Current examples import the source entry
point for repository development only.

## Current capability

Version `0.6.0` provides a versioned trace-record contract and a durable SQLite trace store:

- deterministic recursive object-key ordering;
- kernel ABI v0 `RecordBody` and `RecordEnvelope` types;
- domain-separated canonical v2 record identifiers;
- ordered causal-parent and witness identity;
- runtime body and envelope validation;
- append batches with backward-only local causal references;
- known-parent validation and owner-local ordinal allocation;
- atomic SQLite append transactions with numbered migrations;
- append-intent idempotency, conflict detection, and rollback-safe retry;
- exact-record and ordered owner-path reads;
- content-addressed blob writes, verified reads, and durable storage receipts;
- complete registered-blob integrity reports with corruption classification;
- configured root-witness bootstrap through `ROOT_WITNESS_ID`;
- fail-closed, immutable protocol configuration with centralized store constants;
- descriptor-safe closed draft validation, immutable body snapshots, and record views outside
  semantic identity;
- JSON Schema contracts and pinned implementation-neutral fixtures;
- Node-native TypeScript execution and tests.

The implementation preserves Unicode code points as supplied. It does not normalize Unicode.

## Requirements

- Node.js 24 or newer
- pnpm 10

## Install

```sh
pnpm install
```

## API

```ts
import {
    canonicalizeRecord,
    createRecordEnvelope,
    createRecordId,
    planAppendBatch,
    ROOT_WITNESS_ID,
    SQLiteTraceStore,
} from "./src/index.ts";

const record = { operation: "task.started", ordinal: 1 };

canonicalizeRecord(record);
// {"operation":"task.started","ordinal":1}

createRecordId(record);
// sha256:<digest>

createRecordEnvelope({
    body: { operation: "task.started" },
    mode: "capture",
    schema_ref: "example.task-event.v1",
    witness_ref: "sha256:<64 lowercase hexadecimal characters>",
});
// { record_id, digest, schema_ref, mode, witness_ref, caused_by_record_ids }

planAppendBatch({
    groups: [{
        owner_id: "run:example",
        records: [{
            body: { operation: "task.started" },
            mode: "capture",
            schema_ref: "example.task-event.v1",
            witness_ref: "sha256:<64 lowercase hexadecimal characters>",
        }],
    }],
});
// { records, causal_edges, owner_ordinal_ranges, next_owner_ordinals }

using store = new SQLiteTraceStore("trace.sqlite");
const receipt = store.append({
    append_intent_id: "append:example:1",
    batch: {
        groups: [{
            owner_id: "run:example",
            records: [{
                body: { operation: "task.started" },
                mode: "capture",
                schema_ref: "example.task-event.v1",
                witness_ref: ROOT_WITNESS_ID,
            }],
        }],
    },
});

store.readRecord(receipt.record_ids[0]);
store.readOwner("run:example");

const blobReceipt = store.putBlob(new TextEncoder().encode("retained output"));
store.readBlob(blobReceipt.blob_id);
store.verifyBlobs();
```

Only JSON-compatible semantic values are accepted. Undefined object properties are omitted;
undefined array elements, non-finite numbers, accessors, symbol properties, class instances, and
cycles are rejected.

## Development

```sh
pnpm test
pnpm typecheck
pnpm lint
pnpm check:protocol
pnpm build
pnpm verify
```

Biome provides formatting and linting. Node's built-in test runner executes TypeScript directly.
The test command enforces 100% line, branch, and function coverage for runtime source. TypeScript
builds declarations and JavaScript into `dist/`.

Release versions are configured in `release-config.yaml`. After changing the version, run
`pnpm sync:version` to update every configured JSON manifest.

Protocol modes, identifier shape, append defaults, and generated schemas are configured in
`protocol.config.json`. Run `pnpm generate:protocol` after changing them; `pnpm verify` rejects
stale generated artifacts. Critical hash, ordinal, migration, root-witness, and SQLite durability
settings are validated before runtime or generator side effects.

## Contributing and security

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development and review requirements and
[SECURITY.md](./SECURITY.md) for private vulnerability reporting and the supported security
boundary. Participation is governed by the [Code of Conduct](./CODE_OF_CONDUCT.md).

## Documentation

- [Documentation index](./docs/README.md)
- [Project structure](./docs/project-structure.md)
- [Naming and licensing](./docs/naming-and-licensing.md)
- [Implementation plan](./.plan/README.md)
- [Progress tracker](./.plan/tracker.md)
- [Pinned upstream baseline](./.plan/upstream-baseline.md)
- [Canonical record contract](./docs/canonical-records.md)
- [Record body and envelope contract](./docs/record-envelope.md)
- [Append planning contract](./docs/append-planning.md)
- [SQLite trace store](./docs/sqlite-trace-store.md)
- [Content-addressed blob storage](./docs/blob-storage.md)
- [Protocol configuration](./docs/protocol-configuration.md)
- [Trace kernel vocabulary](./CONTEXT.md)
- [Changelog](./CHANGELOG.md)

## Status

Phase 0 governance and the Phase 1 canonical record, append planning, SQLite durability, and blob
storage contracts are implemented. The next TypeScript slice adds trace cuts and causal-slice
queries.

## Attribution

The design is informed by the MIT-licensed
[Shepherd project](https://github.com/shepherd-agents/shepherd) and its
[research paper](https://arxiv.org/abs/2605.10913). Compatibility claims are tracked explicitly;
paper-level behavior is not yet implemented.

Original repository work is available under the [MIT License](./LICENSE). See [NOTICE](./NOTICE)
for upstream attribution and reuse boundaries.
