# Command-line interface

Implementation: [`src/cli`](../src/cli), configuration:
[`protocol.config.json`](../protocol.config.json), public runner:
[`runCli`](../src/cli/cli.ts), executable: `shepherd-ts`. Tests:
[`test/cli`](../test/cli). Generated reference:
[`docs/generated/cli-reference.md`](./generated/cli-reference.md). Machine schema:
[`spec/schemas/cli-output-v1.schema.json`](../spec/schemas/cli-output-v1.schema.json).

## Boundary

The CLI is a bounded human-facing adapter over existing public TypeScript APIs. Command/group
names, handler IDs, executable name/path, defaults, limits, remedies, and exit codes are validated
configuration. The package exposes only the distinct `shepherd-ts` binary; it does not claim the
upstream executable name.

Exit codes are configured as: `0` success, `1` runtime failure, `2` usage refusal, and `3`
unavailable capability. Human errors print one bounded message without a stack. Human output is
the unchanged `shepherd.cli.v1` contract shipped in 1.46.0.

## Stable JSON

Pass `--json` anywhere in an invocation to select the `shepherd.cli.json.v1` machine contract.
Success writes one canonical JSON object plus a newline to stdout. Failure writes one canonical
JSON object plus a newline to stderr and preserves the configured exit class. Every envelope is
closed and contains `cli_compatibility_version`, `cli_output_version`, `command`, and `ok`;
success adds one command-specific `result`, while failure adds only a configured error `code`.

Machine results retain exact public ledger, citation, settlement, and repair identities. Error
envelopes deliberately omit messages, stacks, resolved paths, and exception details. Canonical
UTF-8 output is bounded independently by `cli.machineOutput.maxCanonicalBytes`. The checked-in
schema closes envelope and command-result field names; nested semantic records remain governed by
their existing generated protocol schemas and are not redefined by the CLI.

The generated command reference derives its executable, commands, options, unavailable remedies,
versions, schema identity, and bounds from `protocol.config.json`. Protocol artifact drift checks,
source/process tests, and the pack/install/bin gate keep the reference, schema, and executable in
sync.

## Commands

```text
shepherd-ts init [WORKSPACE] [--adopt MODE] [--initialize-git|--no-initialize-git]
shepherd-ts doctor [--workspace PATH] [--store PATH] [--registry PATH]
shepherd-ts run <command> ...
shepherd-ts task <command> ...
shepherd-ts demo write
shepherd-ts package init
shepherd-ts store verify [--store PATH] | --backup DIR [--manifest ID]
shepherd-ts store backup [--store PATH] --output DIR
shepherd-ts store restore --backup DIR --manifest ID --store TARGET
shepherd-ts store export [--store PATH] --output FILE [--redacted]
shepherd-ts store import [--store PATH] --input FILE
shepherd-ts store maintain [--store PATH] [--mode inspect|checkpoint|optimize|vacuum]
```

`init` delegates to protected workspace initialization and never creates a commit, stages files,
or rewrites Git history. `doctor` reads Node/protocol, existing store/registry/workspace state, and
authenticated native-jail availability without creating missing stores. All diagnostic and
ledger commands use current-schema read-only SQLite connections: they never migrate an older
database and fail visibly when a migration is required.

`run` supports bounded `list`, `show`, `trace`, `output-citations`, and `recovery-records`; exact
`select`, `apply`, `release`, and `discard`; and globally idempotent orphan `repair`. Read commands
accept configured selectors. Settlement requires the exact output identity plus `--command`,
`--store`, `--workspace`, and optional binding name/root. `run start` remains visibly fenced.

`run outputs` presents validated retained products and their current settlement state. `run
changeset` authenticates a bounded canonical path page or `--read` UTF-8 preview through retained
carrier evidence. `run vcscore` presents the complete native output/custody/revision citation.
These views are read-only and documented in
[`retained-output-cli-views.md`](./retained-output-cli-views.md).

`run trace-revision` is the configured documented spelling for the existing immutable
trace-revision projection. It preserves `run trace` human bytes while stable JSON records the
distinct command identity.

`run publish-retained-workspace-output RUN_ID` verifies the exact committed native output citation.
Native outputs are already cited by their immutable execution cut, so equal calls are read-only and
idempotent. A missing cut fails with the configured managed-recovery remedy because a raw run ID
cannot grant the complete recovery contract.

`task` supports bounded `list`, `show`, and `resolve` over an existing task registry. Dynamic
source registration is unavailable because the package does not execute caller modules merely
because a CLI string names them.

`demo write quickstart` emits the checked-in offline package fixture byte-for-byte. JSON mode
returns its configured name and byte length without embedding source. Missing, unknown, or extra
demo selectors fail with the configured usage class. `package init` remains unavailable until its
reproducible scaffold capability is delivered.

`store` (from 2.29.0) wraps the operations APIs documented in
[backup, restore, and migration](./backup-restore-and-migration.md#command-line).
`store verify` opens an existing store read-only and fails with exit `1` and a bounded issue list
when `verifyIntegrity` or `verifyBlobs` reports a defect; with `--backup` it verifies a backup
directory, optionally against an exact `--manifest` identity. `store backup` reads the store
read-only and writes a new owner-only backup directory. `store restore` requires the exact
manifest identity and an explicit target that must not exist; it never overwrites. `store export`
writes a native archive, or with `--redacted` a one-way
[redacted archive](./secrets-and-retention.md), to a new owner-only file and refuses an existing
output. `store import` loads a native archive into a pristine store, creating it when absent;
redacted archives are refused, and from 2.32.0 a file larger than
`kernel.interchange.limits.maxArchiveBytes` is refused before it is read
([input limits](./trace-interchange.md#input-limits)). Backup failures print `<reason>: <message>` with the configured
backup failure reason; JSON mode reports only the configured error code.

`store maintain` (from 2.30.0) runs `SQLiteTraceStore.maintain` on an existing store: `inspect`
(the configured default) runs `quick_check` and reports page, freelist, and write-ahead-log sizes;
`checkpoint`, `optimize`, and `vacuum` also truncate the log, refresh planner statistics, or rebuild
the file ([SQLite trace store](./sqlite-trace-store.md#maintenance)). It opens the store writable,
so an older schema is migrated first, like any writable open; it never creates a store (exit `3`)
and never changes semantic content. A `quick_check` defect fails with exit `1` and a bounded issue
list; an unconfigured `--mode` is a usage error. JSON mode returns the complete `maintenance`
report.

## Resource limits and security

The options each command accepts are declared per handler role in `cli.commandOptions` (flags and
value options, since 2.32.2); every handler parses argv only through that table, and the
[compatibility gate](./compatibility-policy.md) fingerprints it per command.
The CLI rejects excessive argument counts/bytes, duplicate/unknown options, invalid pagination,
missing selectors, and missing paths. Human output shares one configured byte ceiling. Reads do
not create stores or registries; `store import` is the only command that creates a trace store,
and `store import` and `store maintain` are the only store commands that open a store writable. Mutations retain all existing exact-ID, command-idempotency,
carrier, basis, custody, scope, and provider safety checks; the CLI itself grants no authority.
