# Protocol Configuration

Implementation:
[`src/protocol/config.ts`](../src/protocol/config.ts),
[`src/protocol/config-validation.ts`](../src/protocol/config-validation.ts), and the supporting
typed section/value modules. Configuration source:
[`protocol.config.json`](../protocol.config.json). Tests:
[`test/protocol-config.test.ts`](../test/protocol-config.test.ts) and
[`test/protocol-artifacts.test.ts`](../test/protocol-artifacts.test.ts), plus provider-specific
coverage in [`test/provider/protocol.test.ts`](../test/provider/protocol.test.ts).

## Source of truth

`protocol.config.json` is the language-neutral source for record identity, kernel versions,
ordinal bounds, schema/artifact locations, the root witness, query modes/policies, blob
identity/layout, trace-store behavior, and execution-history projection contracts. Runtime code
and protocol artifact generation use the same parser. The task section also fixes descriptor and
artifact-lock versions, hashing, identity prefixes, schema IDs, generated artifact paths, and the
task registry's SQLite durability and migration contract. The effect section fixes intent/outcome
versions and phases, reversibility tiers, canonical intent-reference hashing, schema IDs, and
generated effect schema paths. It also selects last-matching handler precedence and fail-closed
unhandled behavior. The run section fixes outcome, artifact, and usage versions; closed terminal
status and artifact-content vocabularies; artifact ordinal bounds; schema identifiers; and
generated schema paths. It also fixes run-control statuses, reason types, budget-metric precedence,
stable cancellation reasons, and safe duration-timer bounds.
It also fixes executor failure classifications and fallback messages used for provider, output,
and unavailable-cost failures, plus durable execution recovery and claim statuses, configured
control-command kinds and schema, invocation claim lease duration, and fail-closed recovery,
claim-loss, and fencing error codes and messages. The control-command vocabulary includes recovery,
pause, resume, and cooperative cancellation without embedding those discriminants in runtime code.
The run section also fixes the normative lifecycle statuses and transition matrix, continuation
constituent/evidence vocabularies, the receipt-bearing evidence status, their versions, and
generated continuation, waiting, and suspension schema contracts.
The provider section fixes provider kinds, static-provider capabilities, and stable typed-error
codes and messages.

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
- blob hashing, identifier length/prefix, fanout, directory suffix, filesystem flushing, receipt
  version, orphan-collection modes/default, and temporary-file prefix match the immutable
  contract;
- cut schema and append-intent prefix, witness schema, mode filters, visibility profiles, closure
  policies, and their defaults match the immutable ABI contract;
- execution lifecycle and relation schemas, relation transitions, active transitions, publication
  schema, required mode, and payload visibility match immutable projection-v1 constants;
- root-witness mode, reference, body, schema reference, and JSON values are valid;
- schema identifiers are unique absolute URLs, use the supported JSON Schema 2020-12 dialect,
  and match ABI v0;
- artifact destinations are unique, repository-contained, and match the fixed generated-file
  locations before any write begins.
- task compatibility, descriptor, and artifact-lock versions, digest contract, task-ID prefix,
  schema identifiers, and generated descriptor/lock paths match immutable task-protocol-v1
  constants.
- task-registry migrations are non-empty and contiguous, their latest version matches configured
  support, and defensive SQLite, foreign-key, WAL, FULL, and IMMEDIATE settings remain enabled.
- effect phases are distinct, reversibility tiers are unique, intent/outcome versions are positive,
  handler policies are supported, and intent-reference hashing, schema IDs, and generated paths
  match effect protocol v1.
- run record versions are positive, terminal statuses and artifact content types are unique,
  artifact ordinal and timer bounds are safe, control vocabularies are unique, schema identifiers
  and artifact paths are valid, recovery and control-command vocabularies and executor errors are
  non-empty, lifecycle and continuation vocabularies are closed, transition pairs cite known
  non-terminal states and outcomes, and all values match the immutable run protocol v1 contract.
- provider kinds are unique, static capabilities are booleans, error codes/messages are non-empty,
  and every value matches the immutable provider protocol v1 contract.

Changing canonicalization, record hashing, append-intent hashing, blob identity/layout,
root-witness identity, or current ordinal bounds requires a new ABI or migration contract.
Historical migration and receipt values are read from immutable compatibility constants when
constructing migration SQL; the JSON snapshot must match those constants.

## Fixed store constants

SQLite table and index identifiers are versioned implementation constants, not deployment
configuration. Transaction and PRAGMA commands are assembled once from validated configuration in
[`src/store/constants.ts`](../src/store/constants.ts). Store modules consume those constants
instead of repeating identifiers or interpolating unchecked values.

Task-registry table names and SQL commands are centralized separately in
[`src/task/registry-constants.ts`](../src/task/registry-constants.ts), while migration versions
and SQLite behavior are loaded from the validated task protocol configuration.

The current durability contract permits WAL journaling, FULL synchronization, IMMEDIATE
transactions, defensive mode, and foreign-key enforcement. Weakening one of these values is a
protocol change, not an ordinary runtime preference.
