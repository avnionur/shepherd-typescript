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

`task` supports bounded `list`, `show`, and `resolve` over an existing task registry. Dynamic
source registration is unavailable because the package does not execute caller modules merely
because a CLI string names them.

`demo write quickstart` emits the checked-in offline package fixture byte-for-byte. JSON mode
returns its configured name and byte length without embedding source. Missing, unknown, or extra
demo selectors fail with the configured usage class. `package init` remains unavailable until its
reproducible scaffold capability is delivered.

## Resource limits and security

The CLI rejects excessive argument counts/bytes, duplicate/unknown options, invalid pagination,
missing selectors, and missing paths. Human output shares one configured byte ceiling. Reads do
not create stores or registries. Mutations retain all existing exact-ID, command-idempotency,
carrier, basis, custody, scope, and provider safety checks; the CLI itself grants no authority.
