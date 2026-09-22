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
and protocol artifact generation use the same parser. The CLI section fixes the distinct
executable name/path, ordered group/command topology, internal handler identities, exit classes,
default paths, quickstart name/artifact, stable demo errors, argument/output/page bounds, explicit
unavailable/fenced remedies, stable machine version/schema/error codes, canonical byte bound, and
generated JSON/reference artifact paths. It also fixes retained-content preview option names,
default/maximum bytes, and stable unavailable/binary messages. The task
section also fixes descriptor and
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
The provider section fixes provider kinds, static-provider and program-provider capabilities, and
stable typed-error codes and messages. The task section also fixes the published task value schema
identifier that `schema.task()` references.
The delegation section fixes the delegation record version and compatibility namespace; parent,
execution, provenance, context-phase, and decision kinds, approval verdicts, revision fields, and
derived handle statuses; handle, child run, origin-cut, and retry-cut identity prefixes, the command
append-intent key, and the request and output digest kinds;
citation, injection, nesting-depth, reason, supervisor-identity, and tree-entry bounds; tree
projection root kinds; trace schema references; generated schema identifiers and destinations; and
stable error codes and messages.
Applications protocol v1 introduces the `applications` section whole: the application record and
manifest versions and compatibility namespace; application kinds (`coding_supervisor`,
`counterfactual_optimization`, `trajectory_compression`, `tree_rl`) and protocol surface kinds
(`prompt`, `schema`, `tool`); application, manifest, protocol, artifact, terminal-cut, candidate,
fork-point, rollout, and report identity prefixes, the command append-intent key, and the digest
algorithm; artifact, best-of-N, branch, candidate, dataset, fork-point, prompt, reason, rollout,
round, schema, seed, surface, tool, and worker bounds; the coding supervisor vocabulary (record
phases, policy kinds, conflict kinds, worker lineage statuses, manifest artifact roles, protocol
budget keys, required surface roles, and the retained not-accepted reason); the manifest and
supervision trace schema references; generated schema identifiers and destinations; and stable
error codes and messages. Later applications protocol versions append their own sub-objects and
never mutate a v1 value. See [application manifests](./application-manifests.md) and the
[coding supervisor](./coding-supervisor.md).
Applications protocol v2 spreads v1 and appends the `cro` sub-object for the counterfactual
workflow optimizer: its record phases (`opened`, `candidate`), candidate statuses (`proposed`,
`evaluated`, `promoted`, `rejected`), comparison baseline kinds (`full_replay`), manifest artifact
roles, protocol budget keys (`maxCandidates`, `maxProviderCalls`, `minPromotionScore`), and required
surface roles (`proposer`, `reflection`, `handoff`); plus the `croCandidate` trace schema reference,
schema identifier, and generated schema destination. No v1 value changes. See
[counterfactual optimization](./counterfactual-optimization.md).
Applications protocol v3 spreads v2 and appends the `compression` sub-object for trajectory
compression: its record phases (`opened`, `candidate`, `outcome`), candidate kinds (`compression`,
`control`), candidate statuses (`proposed`, `rewound`, `settled`, `rejected`), outcomes (`pruned`,
`no_prune`, `restored`), verifier verdicts (`accepted`, `rejected`), comparison baseline kinds
(`no_compression`), manifest artifact roles, protocol budget keys (`bestOfN`, `maxProviderCalls`),
the canonical child text fields (`evidence`, `result`), the retained no-fork-point,
not-admissible, and unavailable-restore reasons, and required surface roles (`compressor`,
`compression`, `verifier`); plus the `compression` trace schema reference, schema identifier, and
generated schema destination. No v1 or v2 value changes. See
[trajectory compression](./trajectory-compression.md).
Applications protocol v4 spreads v3 and appends the `treeRl` sub-object for the Tree-RL adapter: its
record phases (`opened`, `rollout`, `batch`), rollout statuses (`completed`, `failed`), comparison
baseline kinds (`single_rollout`), training batch formats (`jsonl_v1`), manifest artifact roles
(including `training_batch`), protocol budget keys (`branches`, `maxForkPoints`, `minDependents`,
`maxProviderCalls`), the retained diverged, interrupted, not-finished, and reward-failed reasons,
and required surface roles (`rollout`, `training_batch`); plus the `treeRlRollout` trace schema
reference, schema identifier, and generated schema destination. No v1, v2, or v3 value changes. See
the [Tree-RL adapter](./tree-rl-rollouts.md).
Applications protocol v5 spreads v4 and appends the `evaluation` sub-object for offline evaluation:
the measured metrics in report order (`cost_usd`, `provider_calls`, `input_tokens`,
`output_tokens`, `steps`, `success`), the coding supervisor comparison baseline kinds
(`no_supervision`), the report version, and the experiment, limitation, and limitation-length
bounds; plus the `evaluation` schema identifier and generated schema destination. The report is a
returned and generated artifact, not a retained record, so v5 adds no trace schema reference. No
v1–v4 value changes. See [application evaluation](./application-evaluation.md).
The scope section fixes the scope record version and compatibility namespace, root/child kinds,
open/merged/discarded states, history evidence kinds, the trace-only world capability, authority
atoms (equal to repository grant atoms) and resource kinds, scope and origin-cut identity prefixes,
citation/data/resource bounds, writer-claim lease duration, trace schema references, generated
schema identifiers and destinations, and stable authority, evidence, head, and writer error codes.
Scope protocol v2 appends the reference-copy world capability, fork command and history kinds,
the workspace-binding resource kind, fork journal phases and schema, the deterministic fork custody
identity kind, and the checkpoint constituent and evidence-status vocabulary without changing any
v1 value.
The supervision section fixes the supervision record version and compatibility namespace; cursor
version, owner, buffer, and poll bounds with origin/head start positions and backpressure/fail
overflow policies; allow/deny/replace/pause decisions, interceptor/timeout/failure sources,
fail-open/fail-closed policies, fail-open-forbidden tiers, interceptor and timeout bounds, and the
decision lease and renewal intervals; approval gates, phases, verdicts, required tiers, and default
and maximum waits; terminal dispositions and recovery classifications; dispatch, context channel,
and cursor identity prefixes and the command append-intent key; citation, context-data, and reason
bounds; trace schema references; generated schema identifiers and destinations; and stable error
codes and messages.
The replay section fixes the replay record version and compatibility namespace; session modes, step
kinds and sources, declarable change dimensions, effect dispositions and approval-required tiers,
cache statuses, checkpoint constituent kinds, evidence statuses, and classifications, terminal
statuses, recovery classifications, and divergence statuses and causes; configured unavailability
and refusal reasons; the session lease and renewal intervals; step, dependency, world, world-entry,
process, image, reason, and error-message bounds; cooperative protocol message types, version,
line bound, and timeout and transparent CRIU probe platforms, executable, check arguments, timeout,
and reasons; session, checkpoint, cut, prompt, response, step, prefix, context prefix, and frontier
identity prefixes and the command append-intent key; trace schema references; generated schema
identifiers and destinations; and stable error codes and messages.
The orphan-repair section fixes versioned operation, diagnosis, command, and receipt contracts;
canonical identity domains; command/receipt trace schemas; blocker and error codes; generated
schema destinations; and count, page, identifier, cause, and canonical-byte bounds.
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
identity, version, and stable validation/conflict errors; workspace protocol v13 adds deterministic
operation/receipt codec versions and the content-addressed operation identity domain. Workspace
protocol v14 adds configured journaled-path atomicity, selection plan/step/publication codec
versions and identity domains, carrier descriptor names, resource bounds, schemas, and stable
movement/recovery/unsupported errors. Workspace protocol v15 adds a separate content-addressed
dependency schedule over canonical plan changes. It preserves canonical changeset identity while
ordering directory construction parent-first and directory removal or replacement
descendant-first. Workspace protocol v16 adds separate dependency-scheduled path-step and terminal
receipt versions and identity domains bound to the exact v15 schedule, while preserving all v14
and v15 evidence unchanged. Workspace protocol v17 adds settlement-citation record, cut, schema,
and append-intent identities. Workspace protocol v18 adds configured protected roots, Unicode and
case normalization, alternate-name handling, stable rejection evidence, and validation version.
Workspace protocol v19 adds host metadata probes, portable filesystem/Git policy, stable custody
fault classifications and recovery phases, and the optimized-carrier reference-suite gate.
Workspace protocol v20 adds the repository-binding resource type, identity domain, protected
per-resource receipt directory, version, and stable repository-validation errors without changing
v2 directory binding identity. Workspace protocol v21 adds explicit repository grant atoms,
profiles, task-grant/plan identities, schemas, and journal-v10 evidence. Workspace protocol v22
adds platform classification, advisory placement resolution, visible auto fallback, and
journal-v11 evidence. Workspace protocol v23 adds configured Seatbelt/Landlock backend
descriptors, compiler/helper policy, probe/status/reason vocabularies, structured command/resource
bounds, native resolution and confinement-plan identities, process/quiescence classifications,
schema destinations, and journal-v12/v4 evidence without redefining v1-v3 journals.
Workspace protocol v24 extends settlement with configured `apply`/`applied` vocabulary, NFC and
case-folded equal/prefix/alias conflict classification, bounded conflict evidence, exact
application-plan and receipt identities, reason/status roles, and generated schema destinations
without redefining existing select/discard or journal-v1-v4 evidence.
Workspace protocol v25 adds configured `release`/`released` vocabulary, a receipt-only release
compatibility namespace/version, and a generated closed release-receipt schema without redefining
existing select, discard, apply, citation, store, or task-world journal evidence.
Workspace protocol v26 adds the closed `carrierBackends` section: selectable `copy`, `clone`, and
`overlay` backend vocabulary with the copy default, the macOS clonefile helper compiler policy,
overlay mount/unmount executables, argument and option templates, layer directory names, reserved
layer-path characters, command bounds, parity status/reason roles, and the backend-unavailable error
contract, without changing revision, custody, or discard descriptor formats for the copy backend.
`workspaces.gitInvocation` (2.32.0) is operational hardening outside the workspace protocol
identity: `configOverrides` are passed as `-c key=value` before `-C <root>` on every Git subprocess
(default `core.fsmonitor=false`, `core.untrackedCache=false`), inherited environment variables
whose names start with a `removedEnvironmentPrefixes` entry (default `GIT_`) are removed, and the
`environment` variables (default `GIT_OPTIONAL_LOCKS=0`, `GIT_TERMINAL_PROMPT=0`) are then set
([`src/workspace/git-command.ts`](../src/workspace/git-command.ts)). `workspaces.gitExecutable`
may be an absolute path to pin the executable instead of resolving `git` through `PATH`.
`kernel.interchange.limits` (2.32.0) bounds untrusted archive input and is likewise excluded from
the archive format identity: `maxArchiveBytes`, `maxNestingDepth`, `maxAppendIntents`, `maxBlobs`,
`maxBlobBytes`, `maxCuts`, `maxRecords`, and `maxRecordViews`, each a positive integer
([trace interchange](./trace-interchange.md#input-limits)).
`kernel.canonicalization` (2.33.0) bounds the canonical value domain:
`maxNestingDepth` (default 1,000) is the deepest array and object nesting any canonical value may
have, counting the outermost container as level one, and `framingDepth` (default 8) is the extra
depth kernel framing (record identity input, append batch digest, native and redacted archives)
may add around a record body at the bound. Both are positive integers; load refuses a
`framingDepth` below the deepest body location among the kernel frames (five levels, the append
batch digest's `groups[i].records[j].body`; `KERNEL_FRAME_BODY_PATHS` in
`src/canonical/framing.ts`) and a `kernel.interchange.limits.maxNestingDepth` below their sum. The section is not pinned by the
kernel ABI contract; the [compatibility gate](./compatibility-policy.md) fingerprints it as an
identity setting, so a change needs a version bump and, when changed rather than added, a classified
change-log entry ([canonical records](./canonical-records.md#nesting-bound)).
`kernel.interchange.staging.directoryPrefix` (2.32.2, `.shepherd-import-stage-`, one portable path
segment) names the owner-only directory `importTrace` validates an archive in, created beside the
target store's blob directory; it is operational and excluded from the archive format identity.
2.32.2 also adds, without changing any protocol identity: `cli.commandOptions`, the option keys
each handler role accepts as flags and value options, which the CLI handlers parse argv through
and the [compatibility gate](./compatibility-policy.md) fingerprints (it is part of the CLI v1
contract and must equal it); `backup.databaseJournalMode` (`DELETE`, `TRUNCATE`, or `PERSIST`),
the rollback-journal mode a backup copy is switched to, and a check that the backup digest
algorithm and prefix equal the store blob identity's; and `retention.scanning.findingDigestPrefix`
(`hmac-<digestAlgorithm>:`), the prefix of the per-process keyed secret-finding digest.
Store schema
v6 owns the consume-once
settlement decision table without changing kernel record identity.
Store schema v7 adds nullable retained-world effect-journal evidence. Store schema v8 adds narrow
open-operation bookkeeping and repair commit-marker tables without changing canonical record,
settlement, custody, or native trace archive identity. Store schema v9 adds live scope
registration and writer-claim tables that are verified against canonical records and never
exported. Store schema v10 adds durable subscription cursor bookkeeping and schema v11 adds
supervised-dispatch registration and decision-lease rows; neither is exported or part of record
identity. Store schema v12 adds replay session registration and writer-lease rows, which are also
never exported. Store schema v13 (2.30.0) adds only the `records_by_schema` and
`trace_cuts_by_publication` indexes. `kernel.store.maintenance` (2.30.0) configures
`SQLiteTraceStore.maintain`: the enabled `modes` (a subset of `inspect`, `checkpoint`, `optimize`,
and `vacuum`), the non-mutating `defaultMode` that must be enabled, `quickCheckMaxIssues`, the
`walCheckpointMode` (`TRUNCATE`), and the `walFileSuffix` used to measure the write-ahead log. See
[SQLite trace store](./sqlite-trace-store.md#maintenance).
Retention protocol v1 introduces the `retention` section (2.27.0): the data classes and the
default class, export dispositions and the disposition of every class, the schema family keys and
the `schemaFamilies` mapping of every configured `schemas`/`traceSchemas` family (or single
schema) to a class, named secret detectors (pattern and flags), the finding digest, finding and
report bounds, the redacted-archive and retention-report formats and versions, the store scanning
modes and default (`off`), the owner-only SQLite file mode and sidecar suffixes, and generated
schema identifiers and destinations. The reader resolves every mapped path to schema identifiers
and exposes the result as `schemaDataClasses`. See [secrets and retention](./secrets-and-retention.md).
Storage protocol v1 introduces the `storage` section (2.28.0): the durability vocabulary, lease and
reference-swap status vocabularies, the anchored name grammar and length bound shared by reference
names and lease keys, reference value, lease owner, and lease TTL bounds, default and maximum blob
list page sizes, and the SQLite storage-coordinator contract (busy timeout, defensive mode, foreign
keys, WAL, `FULL`, `IMMEDIATE`, migrations, and schema version). See
[storage interfaces](./storage-interfaces.md).
Backup protocol v1 introduces the `backup` section (2.29.0): the manifest schema destination and
identifier, the `shepherd.store.backup` v1 manifest format, the digest algorithm and prefix, the
blob-location (`directory`, `backend`) and failure-reason vocabularies, the owner-only backup
directory mode, the backup layout names (database, blob directory, manifest, manifest temporary
suffix, restore staging prefix), and the manifest byte and online-backup page-step bounds. The CLI
section gains the `store` group, its five handler roles and result shapes, and the `backup`,
`input`, `manifest`, `output`, and `redacted` options. See
[backup, restore, and migration](./backup-restore-and-migration.md).
Observability protocol v1 introduces the `observability` section (2.31.0): the telemetry-batch
schema destination and identifier, the `shepherd.telemetry.batch` v1 format, the attribute
namespace, the body modes (`omit`, `retention-policy`) with the default and the body-handling
vocabulary, trace and span identifier digest and domains, the instrumentation-scope name, batch and
body bounds, OTLP wire constants (proto release, span kind, status codes, log severity), resource
attributes, the run-span name with its start and terminal execution schemas, and the
semantic-conventions schema URL prefix and release. `retention.schemaFamilies` maps
`observability.schemas`. See [observability](./observability.md).

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
- CLI groups and nested commands are uniquely named, each group defines either one direct handler
  or nested commands, exit and machine error codes are distinct, defaults/remedies are non-empty,
  schema identity is absolute, limits are positive and ordered, artifact paths are unique, and all
  values match the immutable CLI protocol v1 contract;
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
- provider kinds are unique and list the distinct static and program kinds, capabilities are
  booleans, error codes/messages are non-empty, and every value matches the immutable provider
  protocol v1 contract.
- delegation vocabularies have their exact sizes, trace schema references and identity prefixes are
  distinct, bounds and the record version are positive, schema identifiers are absolute URLs, and
  every value matches the immutable delegation protocol v1 contract.
- application kinds, surface kinds, and supervision vocabularies have their exact sizes, identity
  prefixes and trace schema references are distinct, bounds and versions are positive, the worker
  minimum does not exceed the maximum, the cro vocabularies have their exact sizes and distinct
  artifact roles, budget keys, and surface roles, schema identifiers are absolute URLs, and every
  value matches the immutable latest `APPLICATIONS_PROTOCOL_V5_CONTRACT`, which spreads
  `APPLICATIONS_PROTOCOL_V4_CONTRACT`; each contract spreads its predecessor back to
  `APPLICATIONS_PROTOCOL_V1_CONTRACT`.
- scope kinds are exactly two, states exactly three, evidence kinds exactly four, authority atoms
  equal the configured repository grant atoms, trace schema references are distinct, identity
  prefixes, bounds, lease, versions, schema identifiers, and error codes are closed, and every
  value matches the immutable scope protocol v1 contract.
- supervision vocabularies have their exact sizes, approval and fail-open-forbidden tiers cite
  configured effect reversibility tiers, the lease renewal interval is shorter than the lease, the
  default buffer and approval wait do not exceed their maximums, trace schema references are
  distinct, schema identifiers are absolute URLs, and every value matches the immutable supervision
  protocol v1 contract.
- replay vocabularies have their exact sizes, approval-required tiers cite configured effect
  reversibility tiers, the lease renewal interval is shorter than the lease, the cooperative line
  bound holds a base64-encoded maximum process image, message types and trace schema references are
  distinct, schema identifiers are absolute URLs, and every value matches the immutable replay
  protocol v1 contract.
- orphan-repair digest length matches its configured algorithm; blocker codes are unique; page
  bounds are ordered within the total operation limit; schema IDs and artifact destinations are
  closed; and every value matches the immutable orphan-repair protocol v1 contract.
- workspace adoption modes are unique and include the configured default, path components are safe
  simple names, digest and reference settings agree, binding identity and errors are non-empty, and
  copy-carrier descriptor, collection, entry-kind, identity, and error values are closed and
  non-empty. Changeset operations, identity, limits, version, and error contracts are also closed.
  Parent-linked capture versioning and its positive ancestry bound are closed. Retained-world
  runner versioning, identity bounds, and enforcement kinds are also closed. Task-world capture
  schema paths, identity prefixes, limits, statuses, and version are closed. Settlement request,
  effect-journal, and selection-publication vocabularies, identity prefixes, resource bounds,
  descriptor names, errors, schema destinations, and versions are closed. Every value matches the
  immutable workspace protocol v26 contract. Protocols v1 through v25 remain unchanged historical
  subsets. Native-jail backend names/platforms, probe/placement/process vocabularies, compiler and
  command bounds, schema paths, journal readers/writers, and semantic roles are closed and
  internally consistent. Platform probes contain valid path-token arguments and regular expressions, fault
  names/codes/phases are unique, classification mappings resolve, and supported hosts are closed.

- retention data classes, dispositions, family keys, and scanning modes are unique; the default
  class and mode belong to their sets and every class has a configured disposition; the digest
  prefix names its algorithm; the redacted-archive, report, and native archive formats are pairwise
  distinct; every detector has a unique name, compiles with Unicode-mode flags limited to `i`, `m`,
  and `s`, and does not match the empty string; every object under a family key anywhere in the
  configuration has a mapping, every mapped path resolves to non-empty schema identifiers, and no
  identifier receives two classes except through a more specific path; the store-file mode is an
  octal owner read-write mode without group or other bits; and the vocabularies, formats, schema
  identifiers, and destinations match the immutable retention protocol v1 contract. Detector
  patterns, mappings, per-class dispositions, bounds, and the file mode are tunable policy.

- storage durabilities and status vocabularies are unique and, with the compatibility version,
  match the immutable storage protocol v1 contract; the name pattern compiles in Unicode mode, is
  anchored with `^` and `$`, and does not match the empty string; every bound is a positive
  integer, the default list page does not exceed the maximum, and the minimum lease TTL does not
  exceed the maximum; coordinator migrations are contiguous from 1 and end at the schema version,
  and the coordinator keeps defensive mode, foreign keys, WAL, `FULL`, and `IMMEDIATE`. Bounds,
  grammar, and the busy timeout are tunable policy.

- the backup digest prefix names its algorithm; the directory mode is an octal owner
  read-write-search mode without group or other bits; every layout name is one portable path
  segment and the database, blob directory, manifest, and manifest temporary names are distinct;
  the manifest format differs from the importable archive format; bounds are positive integers;
  and the manifest identity, digest algorithm, schema identifier and destination, and the
  blob-location and failure-reason vocabularies match the immutable backup protocol v1 contract.
  Layout names, the directory mode, and bounds are tunable policy.

- the observability attribute namespace is a dotted lowercase key; the batch format differs from
  the importable archive format; the span and trace identifier domains differ; the default batch
  bound does not exceed the maximum; the proto and semantic-conventions versions are
  `MAJOR.MINOR.PATCH` releases and the schema URL prefix is an absolute URL ending in `/`; run-span
  start and terminal schemas are distinct configured execution-history schemas and every terminal
  status has a positive status code; and the batch identity, schema identifier and destination,
  identifier derivation, and body-mode and body-handling vocabularies match the immutable
  observability protocol v1 contract. Namespace, resource attributes, semantic-conventions release,
  run-span schemas, and bounds are tunable policy.

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
and SQLite behavior are loaded from the validated task protocol configuration. The storage
coordinator's table names and SQL commands live in
[`src/storage/sqlite-coordinator.ts`](../src/storage/sqlite-coordinator.ts), with migration
versions and SQLite behavior from `storage.coordinator`.

The current durability contract permits WAL journaling, FULL synchronization, IMMEDIATE
transactions, defensive mode, and foreign-key enforcement. Weakening one of these values is a
protocol change, not an ordinary runtime preference.
