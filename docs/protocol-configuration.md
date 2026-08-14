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
The workspace section fixes the control directory and manifest names, format version, adoption
vocabulary and defaults, Git discovery command, baseline-reference hashing, binding-identity
domain, copy-carrier layout and identity vocabulary, and stable control, conflict, binding, and
carrier errors. Workspace protocol v4 additionally fixes Git HEAD kinds, semantic basis and exact
index/object receipt identities, descriptor filenames, local repository/worktree identity domains,
supported Git object formats, command bounds, and stable Git-custody failures.
Workspace protocol v5 additionally fixes changeset operations, identity, schema version, resource
limits, and stable validation failures.
Workspace protocol v6 additionally fixes parent-linked custody-capture versioning and the maximum
revision-ancestry depth verified before recovery fails closed.
Workspace protocol v7 additionally fixes retained-world runner-registration versioning,
runner-identity bounds, and the closed enforcement vocabulary.
Workspace protocol v8 additionally fixes task-world capture schema and output identities, capture
identity and text-operation bounds, and the successful retention status vocabulary.
Workspace protocol v9 additionally fixes the task-world journal schema, ordered phase vocabulary,
and journal version. Workspace protocol v10 adds the configured deterministic task-world custody
identity domain used by command-authorized restart recovery.
Workspace protocol v11 fixes bounded authenticated changeset inspection and projection
vocabularies. Workspace protocol v12 fixes exact settlement actions, durable states, request
identity, version, and stable validation/conflict errors. Store schema v6 owns the consume-once
settlement decision table without changing kernel record identity.

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
- workspace adoption modes are unique and include the configured default, path components are safe
  simple names, digest and reference settings agree, binding identity and errors are non-empty, and
  copy-carrier descriptor, collection, entry-kind, identity, and error values are closed and
  non-empty. Changeset operations, identity, limits, version, and error contracts are also closed.
  Parent-linked capture versioning and its positive ancestry bound are closed. Retained-world
  runner versioning, identity bounds, and enforcement kinds are also closed. Task-world capture
  schema paths, identity prefixes, limits, statuses, and version are closed. Every value matches
  the immutable workspace protocol v8 contract. Protocols v1 through v7 remain unchanged
  historical subsets.

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
