# Protocol Configuration

Implementation:
[`src/protocol/config.ts`](../src/protocol/config.ts),
[`src/protocol/config-validation.ts`](../src/protocol/config-validation.ts), and the supporting
typed section/value modules. Configuration source:
[`protocol.config.json`](../protocol.config.json). Tests:
[`test/protocol-config.test.ts`](../test/protocol-config.test.ts) and
[`test/protocol-artifacts.test.ts`](../test/protocol-artifacts.test.ts).

## Source of truth

`protocol.config.json` is the language-neutral source for record identity, kernel versions,
ordinal bounds, schema/artifact locations, the root witness, blob identity/layout, and trace-store
behavior. Runtime code and protocol artifact generation use the same parser.

The parser creates a defensive copy and deeply freezes the validated result. Runtime modules
therefore cannot mutate configuration, and callers retaining the parsed JSON object cannot mutate
the active protocol snapshot.

Validation has two layers: structural validation proves a value is safe to use, while
compatibility validation proves it still describes the implemented kernel ABI and store schema.
The immutable ABI v0 compatibility constants live in
[`src/protocol/compatibility-constants.ts`](../src/protocol/compatibility-constants.ts).

## Critical validation

Configuration loading fails before hashing, schema generation, or SQLite access unless:

- content identities use an approved cryptographic hash, prefix, and hexadecimal length, then
  match the hash contract pinned by ABI v0;
- kernel record modes are unique, non-empty, and synchronized with generated TypeScript
  constants at runtime;
- owner ordinals are safe integers with room for a representable next ordinal;
- schema migrations are non-empty, contiguous from version one, match the configured schema
  version and current ordinal contract, and exactly match immutable historical descriptors;
- defensive SQLite mode and foreign keys remain enabled;
- journal, synchronization, and transaction modes belong to the durability-safe closed sets;
- blob hashing, identifier length/prefix, fanout, directory suffix, filesystem flushing, and
  receipt version match the immutable store-v2 contract;
- root-witness mode, reference, body, schema reference, and JSON values are valid;
- schema identifiers are unique absolute URLs, use the supported JSON Schema 2020-12 dialect,
  and match ABI v0;
- artifact destinations are unique, repository-contained, and match the fixed generated-file
  locations before any write begins.

Changing canonicalization, record hashing, append-intent hashing, blob identity/layout,
root-witness identity, or current ordinal bounds requires a new ABI or migration contract.
Historical migration and receipt values are read from immutable compatibility constants when
constructing migration SQL; the JSON snapshot must match those constants.

## Fixed store constants

SQLite table and index identifiers are versioned implementation constants, not deployment
configuration. Transaction and PRAGMA commands are assembled once from validated configuration in
[`src/store/constants.ts`](../src/store/constants.ts). Store modules consume those constants
instead of repeating identifiers or interpolating unchecked values.

The current durability contract permits WAL journaling, FULL synchronization, IMMEDIATE
transactions, defensive mode, and foreign-key enforcement. Weakening one of these values is a
protocol change, not an ordinary runtime preference.
