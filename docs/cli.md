# Command-line interface

Implementation: [`src/cli`](../src/cli), configuration:
[`protocol.config.json`](../protocol.config.json), public runner:
[`runCli`](../src/cli/cli.ts), executable: `shepherd-ts`. Tests:
[`test/cli`](../test/cli).

## Boundary

The CLI is a bounded human-facing adapter over existing public TypeScript APIs. Command/group
names, handler IDs, executable name/path, defaults, limits, remedies, and exit codes are validated
configuration. The package exposes only the distinct `shepherd-ts` binary; it does not claim the
upstream executable name.

Exit codes are configured as: `0` success, `1` runtime failure, `2` usage refusal, and `3`
unavailable capability. Errors print one bounded message without a stack. This version does not
claim stable JSON or a generated command reference.

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

`demo write` and `package init` appear in help but return the configured unavailable remedy until
their checked-in fixture and reproducible scaffold capabilities are delivered.

## Resource limits and security

The CLI rejects excessive argument counts/bytes, duplicate/unknown options, invalid pagination,
missing selectors, and missing paths. Human output shares one configured byte ceiling. Reads do
not create stores or registries. Mutations retain all existing exact-ID, command-idempotency,
carrier, basis, custody, scope, and provider safety checks; the CLI itself grants no authority.
