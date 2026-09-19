# Support policy

Status: normative for 2.25.2 (Phase 11 slice 1, #187). Security reporting is in
[SECURITY.md](../SECURITY.md); response steps are in [incident response](./incident-response.md).

## Supported versions

- The project is pre-1.0 in maturity and the package is not published (`"private": true`). Fixes
  land on `main` and ship in the next Semantic Versioning release from the current version. Older
  versions are not patched unless a release announcement says otherwise.
- "1.0" is the L4 operational-maturity milestone (decision D-016), not a package version. Reaching
  it does not reset or reserve a version number.

## Supported surfaces

| Surface | Status | Evidence |
| --- | --- | --- |
| Node `>=24.12.0 <25` | Supported | [Node runtime support](./runtime-support.md) |
| macOS arm64 (APFS) | Supported and verified locally | `CI=true pnpm verify` on the reference host |
| Linux | Supported by design; hosted verification lanes are disabled | Owner-owed (O-3 in the [hardening contract](../.plan/production-hardening-contract.md)) |
| Native Windows | Unsupported | Native permission enforcement has no design; see the parity matrix |
| Package entries in `package.json` `exports` | Supported public API | [Package exports](./package-exports.md), [generated API reference](./generated/api-reference.md) |
| Deep imports into `dist/src` | Unsupported | [Package exports](./package-exports.md) |
| `shepherd-ts` CLI JSON envelope `shepherd.cli.json.v1` | Supported, closed schema | [Command-line interface](./cli.md) |
| CLI human output | Informational, not a stable format | [Command-line interface](./cli.md) |
| Static provider | Supported | [Provider contract](./static-provider.md) |
| Live provider adapters, streaming normalization | Not shipped | Parity matrix |
| Remote storage | Interfaces only (D-018, from #181) | [Storage interfaces](./storage-interfaces.md) |
| Store backup, restore, and migration | Supported on the local host; drills on the reference host | [Backup, restore, and migration](./backup-restore-and-migration.md) |
| Native jail | Fails closed where enforcement is unavailable | [Native jail execution](./native-jail-execution.md) |

## Store compatibility

- Store schemas migrate forward only. A store written by a newer schema is refused with
  `UnsupportedStoreSchemaError`; read-only opening requires the exact current schema
  ([SQLite trace store](./sqlite-trace-store.md)).
- Downgrade is by restoring a pre-upgrade backup or by native archive round trip. Verified backup
  and restore, the downgrade policy, and migration drills for every historical store schema are in
  [backup, restore, and migration](./backup-restore-and-migration.md) (from 2.29.0, #182).
- Canonical records are never deleted in place.

## Deprecation

The [compatibility policy](./compatibility-policy.md) defines the semantic-versioning mapping,
stability tiers, the configured deprecation window (two MINOR releases, then a MAJOR release), and
protocol evolution rules. `pnpm check:compatibility` enforces them locally in `pnpm verify` from
2.26.0.

## Getting help

Open a GitHub issue for bugs and questions. Do not include secrets, private repository content, or
vulnerability details; use [SECURITY.md](../SECURITY.md) for anything security-sensitive. No response
time is promised.
