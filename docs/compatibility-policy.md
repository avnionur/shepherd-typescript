# Compatibility policy

Status: normative from 2.26.0 (Phase 11 slice 2, #179); version-marker, per-artifact
classification, identity and CLI-option fingerprint, build-freshness, and last-release rules
added in 2.32.2 (#29, F-022). This page defines how the public TypeScript API and the protocol
evolve, and the local gate that enforces it. The gate is `pnpm check:compatibility`, which runs
inside `pnpm verify` and `pnpm verify:serial` right after `pnpm build` and
`pnpm check:api-reference`. Hosted CI is disabled, so "enforced" means enforced by these local
commands. Implementation: `tooling/compatibility/` with the thin adapter
`scripts/check-compatibility-cli.ts`; tests: `test/compatibility-policy.test.ts`.

## Semantic versioning

The package follows Semantic Versioning from its current version. "1.0" is the L4 maturity
milestone (decision D-016), not a package version.

| Change | Minimum bump |
| --- | --- |
| Remove or rename an export, package entry, public error code, CLI command, CLI option, CLI exit code, schema, identity setting, or version marker | MAJOR, after the deprecation window |
| Change an exported declaration, schema, exit-code value, CLI option kind, identity setting, or version marker in a way consumers must adapt to | MAJOR, with a `breaking` change-log entry |
| Change an exported declaration, schema, exit-code value, CLI option kind, identity setting, or string version marker without requiring consumers to adapt; raise a format or protocol version marker while a documented reader keeps accepting the previous value | MINOR, with an `additive` change-log entry |
| Add an export, package entry, error code, CLI command, CLI option, exit code, identity setting, schema, `oneOf` branch, `$defs` member, appended migration, or version marker; raise a schema version by exactly its appended migrations; deprecate an export | MINOR |
| Documentation, tests, internal refactors, and fixes that leave every fingerprint unchanged | PATCH |

The minimum bump is measured against the last baseline (the baseline's `packageVersion`, or its
`previousVersion` when the baseline was already refreshed for the current version). The
deprecation window is measured against the last released version instead (see below).

## What is fingerprinted

Surfaces are extracted from the built package and from repository configuration; nothing is
maintained by hand.

- **API surface** (`spec/compatibility/api-baseline.json`): for every package entry in the export
  map, every exported name with its declaration kind and a SHA-256 digest of the canonical
  classification, kind, and printed declaration. The declaration text is read from `dist/src`
  through the same TypeScript checker loading as the
  [generated API reference](./api-reference.md), so private, `#private`, and `@internal` members are
  excluded and JSDoc edits never change a digest. `@deprecated` status is recorded separately.
- **Protocol surface** (`spec/compatibility/protocol-baseline.json`):
  - a canonical digest of every `spec/schemas/*.schema.json`, plus digests of each top-level
    `oneOf` branch and `$defs` member and of the remainder;
  - every version or format marker in `protocol.config.json` and `public-errors.config.json`
    (kernel `canonicalVersion` and `abiVersion`, interchange `format` and `formatVersion`, store
    `schemaVersion`, every section `compatibilityVersion`, and every other key matching the
    configured pattern);
  - the ordered digests of the store and task-registry migration lists;
  - the public error codes in `public-errors.config.json`;
  - CLI exit codes and command paths from `protocol.config.json`;
  - the options each CLI command accepts (`cli-option:<command> --<name>`, with `flag` or `value`),
    read from the `cli.commandOptions` table that the CLI handlers parse argv through, so the
    fingerprint and the parser cannot disagree;
  - identity-bearing settings (`identity:<source>#<pointer>`): every string or number under a key
    matching `protocol.identity.keyPattern` (identifier prefixes such as `idPrefix` and
    `*IdPrefix`, digest algorithms, `hexLength`, `blobEncoding`) and the canonical digest of each
    configured pointer (`/recordId`, the root witness, record modes, and the CLI option-name map).

Locations, patterns, and tiers are configured in
[`config/compatibility-policy.config.json`](../config/compatibility-policy.config.json). A baseline
recorded before a surface existed (the identity and CLI-option fingerprints before 2.32.2) records
that surface on its next update without judging it.

## Rules

A difference between the baselines and the current surfaces is judged as follows. Violations fail
the gate with a message naming the artifact (for example `api:./trace#SQLiteTraceStore`,
`schema:cli-output-v1.schema.json`, `cli-command:run list`, `cli-option:store export --redacted`,
`identity:protocol.config.json#/recordId/prefix`, `error-code:RUN_CANCELLED`,
`migrations:protocol.config.json#/kernel/store/migrations`).

1. **Additions** are additive and need at least a MINOR bump.
2. **Removals** of stable artifacts need a deprecation that shipped for at least the configured
   window and a MAJOR bump. API exports are deprecated with a JSDoc tag stating the release, for
   example `@deprecated Since 2.27.0. Use openTraceSubscription instead.`; protocol artifacts are
   deprecated by adding `{ "artifact": "cli-command:run list", "since": "2.27.0" }` to
   `protocol.deprecations` in the policy configuration. A `@deprecated` tag without a release fails
   the gate.
3. **Changed** declarations, schemas, exit-code values, CLI option kinds, identity settings, and
   string version markers need an entry in the append-only change log
   `spec/compatibility/protocol-changes.json` naming the artifact, the baseline and current digest
   or value, a classification (`additive` or `breaking`), and the current package version.
   `additive` needs at least a MINOR bump; `breaking` needs a MAJOR bump.
4. **Version-marker increases.** Decoders of format and protocol versions (for example the archive
   `formatVersion` or the backup manifest `formatVersion`) require an exact match, so a numeric
   increase is a changed artifact that needs a classified entry: `breaking` unless a documented
   reader keeps accepting the previous value, in which case `additive` with a note naming that
   reader (`classification.additiveNotePatterns`; an `additive` version entry without a note fails).
   A schema version listed in `protocol.migrationBackedVersions` (store and task-registry
   `schemaVersion`) is instead accepted as additive when, and only when, its paired migration list
   gained exactly one appended migration per version step; any other increase of it is refused.
5. **Automatic additive acceptance** applies without a log entry when a schema keeps every other
   keyword byte-equal after canonicalization and only adds top-level `oneOf` branches or `$defs`
   members while every baseline branch and member is still present unchanged (the history of
   `cli-output-v1`), and for migration-backed schema versions as described above.
6. **Always refused**: a numeric version marker that decreases (for example store `schemaVersion`),
   a schema version raised without matching migrations, a migration list whose baseline prefix is
   removed, reordered, or changed (migrations may only be appended), a change to a frozen artifact,
   and any edit or removal of recorded change-log entries.
7. **Frozen artifacts**: a versioned schema file (`<family>-v<N>.schema.json`) is frozen once a
   higher version of the same family exists; publish a new versioned file instead of editing it.
   Additional frozen artifacts can be listed as patterns in `frozen.artifactPatterns`.
8. **Build freshness**: `pnpm check:compatibility` refuses to judge declarations emitted before the
   newest file under `build.sources` (`src`), naming the newer source file; run `pnpm build` first.
   `pnpm verify` builds immediately before the check, and `pnpm update:compatibility-baseline`
   builds itself.

## Stability tiers

Each package entry has a tier in `api.tiers`; protocol artifacts use `protocol.tier`. Tier rules are
configured, not coded:

| Tier | Changed or removed artifacts | Additions |
| --- | --- | --- |
| `stable` | Need a classified entry or a deprecation window and MAJOR bump | Need a MINOR bump |
| `experimental` | Accepted and reported | Accepted without a bump |

Every current entry is `stable`. A future entry may start as `experimental`; symbols it shares with
a stable entry (for example through the root entry) remain governed by the stable entry.

## Deprecation window

`deprecation.windowMinorReleases` (2) is the number of MINOR releases a deprecated artifact must
ship before removal. It is measured from the release named in the deprecation to
`deprecation.lastReleasedVersion`, the last version actually released; a later MAJOR line
satisfies it. Baseline refreshes are not releases and never advance the window. The value is
`2.25.1`, the last version merged to `main`; no npm release exists yet (the package is private), so
the owner updates this field when a version ships. Removal then needs the next MAJOR version.
Deprecated exports are marked `Status: deprecated` with a `Deprecated:` section in the
[generated API reference](./generated/api-reference.md).

## Protocol evolution and N-1 read compatibility

- Canonical records carry their own version fields and are never rewritten in place; new record
  versions are added beside old ones, and readers of the current release read every record version
  the previous MINOR line (N-1) could write.
- Store schemas migrate forward only through appended migrations; a store written by N-1 opens and
  migrates under N. A newer store is refused with `TRACE_STORE_SCHEMA_UNSUPPORTED`, and read-only
  opens require the exact schema (see the [support policy](./support-policy.md)).
- Trace archives keep `format` and `formatVersion` (currently only version 1 exists); a new archive
  format version must be added as a classified change, and the importer must keep accepting the
  N-1 version.
- CLI JSON is extended by adding `oneOf` branches to `cli-output-v1`; existing branches do not
  change within a compatibility version.

## Updating the baselines

Every pull request refreshes the baselines after its version bump; `pnpm check:compatibility` fails
while they are stale, including when only the package version changed.

```sh
pnpm update:compatibility-baseline
# changed schemas, exit codes, CLI options, or identity settings, after reviewing the diff:
pnpm update:compatibility-baseline --classify additive --note "Why consumers need not adapt."
# changed API declarations and version markers are classified one artifact at a time:
pnpm update:compatibility-baseline --classify additive \
    --artifact "api:./trace#SQLiteTraceStore" --note "Adds an optional member only."
```

The update builds the package, evaluates every rule, and writes nothing if any rule is violated.
`--classify` appends one log entry per selected unclassified changed artifact at the current
version: every one by default, or only those named with repeated `--artifact` options (naming an
artifact that is not an unclassified change is an error). Bulk `--classify additive` is refused
while any unclassified change matches `classification.perArtifactPatterns` (changed `api:`
declarations and `version:` markers); judge and name each of those. Use `breaking` (which also
requires a MAJOR bump) when consumers must adapt. Review the diff of `spec/compatibility/` like
source: a removed baseline entry or an edited log entry is a compatibility decision.
