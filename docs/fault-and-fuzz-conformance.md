# Fault and fuzz conformance

Status: normative for 2.32.1. The fuzz part is delivered by Phase 11 slice 8 (#185, 2.32.0); the
fault and soak part by slice 9 (#186, 2.32.1). Findings live in the
[internal security review](../.plan/security-review.md); boundaries and residual risks in the
[threat model](./threat-model.md); operator procedures in [incident response](./incident-response.md).

## Fuzz

### What it is

A deterministic, seeded, dependency-free mutation fuzzer that runs every configured target inside
`pnpm test` (the `verify` tier) and on demand at a larger tier (`pnpm fuzz`). It is not
coverage-guided: inputs are mutations of well-formed seeds chosen by a seeded
[mulberry32](../test/support/prng.ts) stream, so every case is reproducible from its run seed,
target name, and case index.

| Part | Location |
| --- | --- |
| Configuration (seeds, tiers, iterations, budget, mutation parameters, per-target allowed errors) | [`config/hardening-suites.config.json`](../config/hardening-suites.config.json) (`fuzz` section) |
| Seeded PRNG (`seededRandom`, `createPrng`, `deriveSeed`) | [`test/support/prng.ts`](../test/support/prng.ts) |
| Mutators | [`test/fuzz/mutators.ts`](../test/fuzz/mutators.ts) |
| Harness and shared oracle | [`test/fuzz/harness.ts`](../test/fuzz/harness.ts) |
| Targets | [`test/fuzz/targets/`](../test/fuzz/targets) |
| Default-tier tests | `test/fuzz/{records,archives,cli,workspace,helpers}.test.ts` |
| Regression corpus and replay | [`test/fixtures/fuzz-corpus/`](../test/fixtures/fuzz-corpus), [`test/fuzz/corpus.test.ts`](../test/fuzz/corpus.test.ts) |
| Extended runs | `pnpm fuzz` ([`scripts/fuzz-cli.ts`](../scripts/fuzz-cli.ts)) |

### Mutators

Text inputs: a UTF-8 byte flip (decoded back with replacement characters), truncation, a
duplicated raw object key with a different value, a structural mutation through a parse when the
text still parses, deep nesting spliced at a value position (`textNestingLevels`: 64, 4097, and
20000 levels), huge and non-finite number spellings (`1e400`, `-1e400`, `9007199254740993`, `-0`),
an oversized string (`oversizedStringCharacters`, 1,048,577) or a lone surrogate at a value
position, a single inserted structural or control character, and `__proto__`, `constructor`, or
`prototype` keys spliced into the first object.

Value inputs: key deletion, array element removal, duplication, or reversal, unknown and
prototype-named own data keys (`pollutionKeys`), type swaps, the configured numbers (`NaN`,
`Infinity`, `-Infinity`, `-0`, `1e308`, `9007199254740993`, `-1`, `0.5`), deep nesting
(`valueNestingLevels`: 64, 400, and 20000), oversized strings, path-shaped and malformed strings,
single-character flips, and container truncation. One case applies between one and
`maxMutationsPerCase` (3) mutations. Value nesting avoids the band between roughly 2,000 and
8,000 levels on purpose: there, canonical acceptance depends on stack depth and JIT state
(F-016), which would make the oracle nondeterministic.

### Oracle

Every case, in every target, must satisfy all of the following ([`runCase`](../test/fuzz/harness.ts)):

1. The input is accepted and the target's acceptance check holds: the result re-encodes
   canonically and stably (for canonical results `canonicalizeRecord(JSON.parse(x)) === x`, and a
   second decode of the re-encoding yields the same canonical result); or
2. the call throws an `Error` whose class name is in the target's configured `allowedErrors`.
3. No non-`Error` value is thrown.
4. The case finishes within `caseBudgetMilliseconds` (5,000). Asynchronous targets race a timer;
   a synchronous hang cannot be interrupted in-process and is caught by the test timeout
   (`testTimeoutMilliseconds`).
5. The own keys of `Object.prototype`, `Array.prototype`, `Function.prototype`, and
   `String.prototype` are unchanged after the case (no prototype pollution).

Well-formed seeds must be accepted before any mutation runs. Target-specific acceptance checks
are stronger where a reference exists, listed below.

### Targets

| Target | Unit | Seeds | Allowed errors | Acceptance check |
| --- | --- | --- | --- | --- |
| `canonicalizeRecord` | `src/canonical/canonical-record.ts` | Archive record bodies, a Unicode body | `TypeError` | Output re-encodes to itself |
| `createRecordId` | same | same | `TypeError` | Configured prefix and length; the identity of the parsed canonical output is equal |
| `validateRecordBody` | `src/record/guards.ts` | same | `TypeError` | Canonical re-encoding is stable |
| `validateRecordEnvelope` | `src/record/validation.ts` | Archive `{ body, envelope }` pairs | `TypeError` | `record_id` equals `digest`; the canonical envelope validates again |
| `decodeAppendReceipt` | `src/store/codec.ts` | Archived receipts | `TraceStoreError` | `encode(decode(encode(x)))` is stable |
| `decodeTraceArchive` | `src/interchange/decode.ts` | Committed fixture, a fresh store export | `RedactedTraceArchiveError`, `TraceArchiveLimitError`, `TypeError` | Decoding is deterministic and every record re-encodes canonically |
| `importTrace` | `SQLiteTraceStore.importTrace` into a fresh store | same | same | `verifyIntegrity` passes; the export re-imports to an identical export |
| `verifyRedactedTraceArchive` | `src/retention/redacted-archive.ts` | A redacted export | `RedactedTraceArchiveError`, `TraceArchiveLimitError` | Verification is deterministic |
| `parseBackupManifest` | `src/operations/backup-manifest.ts` | A sealed canonical manifest | `TraceStoreBackupError` | Re-encoding reproduces the input exactly |
| `runCli` | `src/cli/cli.ts` with an in-memory `CliIo` in a nested temporary directory | Grammar-derived argv from the configured groups, commands, options, and help aliases, then mutated (over-long, multi-byte, over-count, non-string, dropped, duplicated) | none (`runCli` must not throw) | Exit code is one of `cli.exitCodes`; argv over `maxArguments` or `maxArgumentBytes` exits with the usage code; with `--json`, exactly one envelope that validates against `spec/schemas/cli-output-v1.schema.json` (ajv) and whose `ok` matches the exit code |
| `isCanonicalWorldPath` | `src/workspace/changesets.ts` | Plain and Unicode paths, segment edits with `.`, `..`, empty, and the control directory | none | An accepted path is POSIX-normalized, relative, free of `\` and NUL, well-formed, and has no `..` or control-directory segment |
| `createVerifiedWorldChangeset` | `src/workspace/changesets.ts` with a reference copy carrier | Seeded random trees (files, directories, symlinks, modes) and seeded head mutations; 30% of cases also mutate a revision object | `WorldChangesetError` | The changeset equals a reference-model diff (paths, operations, kinds, byte lengths, content identities, modes, symlink targets), `changed_paths` matches, and `changeset_id` re-derives |
| `decodeSelectionPublication` | `src/workspace/selection-publication-codec.ts` plan, step, schedule, and receipt decoders | Canonical encodings for one authenticated fixture | `TypeError` | Only the exact canonical text is accepted |
| `encodeSelectionPublicationPlan` | same | The fixture changeset | `TypeError` | Only a changeset equivalent to the pinned identity encodes |
| `readPlacementPlatformEvidence`, `readGrantedPlacementResolutionEvidence`, `readRepositoryGrantPlanEvidence` | `src/protocol/placement-evidence.ts`, `src/protocol/repository-grant-evidence.ts` | `test/fixtures/placement-resolution-v1.json` | `TypeError` | Canonical output re-reads to itself |
| `classifyOverlayMountInfo` | `src/workspace/carrier-backends.ts` | Owned, foreign, and empty `mountinfo` text | none | Returns `absent`, `foreign`, or `owned`; `owned` only with the configured type and every layer option |
| `readNativeJailCommandEvidence` | `src/protocol/native-jail-evidence.ts` | `createNativeJailCommand` output | `TypeError` | Canonical output re-reads to itself |
| `readNativeJailPlanEvidence` | same | Read-only and writable plans from the local backend | `TypeError` | same; skipped with the probe reason when no native jail backend is available |
| `readModelResponse`, `readStaticProviderDefinition` | `src/provider/validation.ts` | Text and structured responses | `TypeError` | Snapshot re-reads to itself |
| `readApplicationProtocol` | `src/applications/manifest.ts` | Every definition in `config/research-applications.config.json` that validates | `ApplicationProtocolError` | Snapshot re-reads to itself |
| `telemetryBatch` | none | none | none | Skipped: no telemetry decoder exists; #184 only maps committed records to OTLP/JSON for a caller sink |

`readOverlayMountState` reads Linux `/proc/self/mountinfo`; 2.32.0 moved its parsing into the
host-independent `classifyOverlayMountInfo` so the parser is fuzzed and fully covered on every host.

### Tiers

| Tier | Iterations per target and seed | Where |
| --- | --- | --- |
| `verify` (default) | 1,000; `createVerifiedWorldChangeset` 30, `importTrace` 300, `runCli` 600; seed 20260918 | `pnpm test`, on every `pnpm verify` |
| `extended` | 20,000; `createVerifiedWorldChangeset` 400, `importTrace` 4,000, `runCli` 6,000 | `pnpm fuzz` |

The default tier adds about 8 seconds of wall time (about 20 seconds of CPU across parallel test
files) on the reference host. Environment overrides: `SHEPHERD_FUZZ_TIER`, `SHEPHERD_FUZZ_SEED`,
`SHEPHERD_FUZZ_ITERATIONS`. `pnpm fuzz` accepts `--tier NAME`, repeated `--seed N`,
`--iterations N`, repeated `--target NAME`, and `--json` (full report with every finding's input
preview), and exits non-zero on any finding.

### Recorded extended run

| Property | Value |
| --- | --- |
| Command | `node scripts/fuzz-cli.ts --tier extended --seed 185185` (`pnpm fuzz --seed 185185`) |
| Package | 2.32.0 working tree of #185 |
| Host | macOS arm64 (Apple M4 Pro), APFS, Node.js 24.17.0 |
| Cases | 410,400 across 23 executed targets (telemetry skipped) |
| Findings | 0 |
| Duration | 188.7 s wall; peak memory footprint 632 MB |

| Target | Cases | Accepted | Rejected by class |
| --- | --- | --- | --- |
| `canonicalizeRecord` | 20,000 | 17,757 | `TypeError` 2,243 |
| `createRecordId` | 20,000 | 17,811 | `TypeError` 2,189 |
| `validateRecordBody` | 20,000 | 17,733 | `TypeError` 2,267 |
| `validateRecordEnvelope` | 20,000 | 824 | `TypeError` 19,176 |
| `decodeAppendReceipt` | 20,000 | 1,273 | `TraceStoreError` 18,727 |
| `decodeTraceArchive` | 20,000 | 338 | `TypeError` 18,842, `TraceArchiveLimitError` 820 |
| `importTrace` | 4,000 | 12 | `TypeError` 3,818, `TraceArchiveLimitError` 170 |
| `verifyRedactedTraceArchive` | 20,000 | 319 | `RedactedTraceArchiveError` 18,271, `TraceArchiveLimitError` 1,410 |
| `parseBackupManifest` | 20,000 | 0 | `TraceStoreBackupError` 20,000 |
| `runCli` | 6,000 | 6,000 | none (every run satisfied the CLI oracle) |
| `isCanonicalWorldPath` | 20,000 | 20,000 | none |
| `createVerifiedWorldChangeset` | 400 | 284 | `WorldChangesetError` 116 |
| `decodeSelectionPublication` | 20,000 | 22 | `TypeError` 19,978 |
| `encodeSelectionPublicationPlan` | 20,000 | 522 | `TypeError` 19,478 |
| `readPlacementPlatformEvidence` | 20,000 | 157 | `TypeError` 19,843 |
| `readGrantedPlacementResolutionEvidence` | 20,000 | 157 | `TypeError` 19,843 |
| `readRepositoryGrantPlanEvidence` | 20,000 | 610 | `TypeError` 19,390 |
| `classifyOverlayMountInfo` | 20,000 | 20,000 | none |
| `readNativeJailCommandEvidence` | 20,000 | 468 | `TypeError` 19,532 |
| `readNativeJailPlanEvidence` | 20,000 | 359 | `TypeError` 19,641 |
| `readModelResponse` | 20,000 | 6,693 | `TypeError` 13,307 |
| `readStaticProviderDefinition` | 20,000 | 6,909 | `TypeError` 13,091 |
| `readApplicationProtocol` | 20,000 | 12,325 | `ApplicationProtocolError` 7,675 |

The first extended run with the same seed, before the fixes below, reported 26 `parseBackupManifest`
cases (F-015) and one `canonicalizeRecord` case (F-016), and stopped when a mutator itself
overflowed the call stack while copying a deeply nested value; the mutator copy is now iterative.
The recorded run above is the rerun after those changes.

### Findings

| Finding | Found by | Resolution | Corpus |
| --- | --- | --- | --- |
| F-012 canonical encoding threw `RangeError` past the call stack | Deep-nesting mutator (`canonicalizeRecord`) | Fixed: reported as `TypeError` with the `RangeError` as cause | `canonicalizeRecord/01`, `createRecordId/01`, `validateRecordBody/01`, `decodeTraceArchive/04`, `importTrace/01`, `readModelResponse/01` |
| F-013 repeated keys and non-canonical nested text accepted (parser differential) | Duplicate-raw-key mutator (archives, redacted archives, manifests, receipts) | Fixed for archives, redacted archives, archived receipts, and manifests; accepted residual for the store-internal receipt decoder | `decodeTraceArchive/02`, `decodeTraceArchive/03`, `importTrace/02`, `verifyRedactedTraceArchive/01`, `parseBackupManifest/01`, `parseBackupManifest/02`, `decodeAppendReceipt/01` (residual pinned as accepted) |
| F-014 append admits a non-witness `witness_ref` | Seed construction | Fixed in 2.32.2 (#29): append refuses it with `TraceStoreError` before any write | none (append-path behavior, not a decoder); `test/store/integrity.test.ts` |
| F-015 backup manifest lone-surrogate owner escaped as `TypeError` | Extended run | Fixed: `manifest-invalid` | `parseBackupManifest/03` |
| F-016 stack- and JIT-dependent canonical acceptance of deep nesting | Extended run | Open, Low, #29 (left open in 2.32.2 as a protocol decision; failure is closed) | none (not deterministic); mutators avoid the band |
| F-004 archive decode bounds (pre-existing) | Register | Fixed: configured limits and `TraceArchiveLimitError` | `decodeTraceArchive/01`, `verifyRedactedTraceArchive/02` |

Other corpus cases pin accepted behavior at edges: the unmodified export and fixture archive,
`__proto__` and `constructor` data keys, non-finite numbers, CLI argument count and multi-byte byte
limits, a non-string argument, a missing import file, hostile `mountinfo` lines, and dot and
control-directory path segments.

### Adding a corpus case

A corpus file is `test/fixtures/fuzz-corpus/<target>/<nn>-<slug>.json` with `description`,
optional `finding`, `input`, and `expect` (`{ "outcome": "accepted" }` or
`{ "outcome": "rejected", "error": "<class name>" }`). `input` is one of `{ "text": ... }` (a string
or segments `{ "literal" }` / `{ "repeat", "count" }`), `{ "value": ... }` (JSON with `$fuzz`
markers for `number`, `nest`, and `repeat`), or `{ "seed": <index>, "replace": [{ "from", "to" }] }`
(first-occurrence replacements in one of the target's seeds). Minimize a finding to the smallest
input that still reproduces it, add the fix and the case together, and record the finding in the
register.

### Non-claims

- Not coverage-guided and not a substitute for an external fuzzing service; mutation depth is
  bounded by the seeds and mutators above.
- Host-dependent targets run where the host allows: `readNativeJailPlanEvidence` needs an
  available native jail backend; the overlay parser is host-independent, but live overlay mounts
  remain Linux-only.
- The extended run is recorded for the reference host only.

## Faults and soak

### What it is

Destructive suites that kill a writer mid-operation, fill the database and the disk, corrupt store
and backup files, and run a long mixed workload, then check that the store never reports a guessed
success. Every assertion is an invariant over the reopened store; no assertion depends on timing.
Seeds choose kill delays, corrupted offsets, and workload content, so a failing case is
reproducible from its seed (`SHEPHERD_FAULT_SEED` overrides the configured seed).

| Part | Location |
| --- | --- |
| Configuration (seeds, kill cycles and delays, page limits, file-size limit, volume size, corruption case counts, workload shape, soak cadence) | [`config/hardening-suites.config.json`](../config/hardening-suites.config.json) (`faults` and `soak` sections) |
| Deterministic workload, child launcher, health check | [`test/faults/workload.ts`](../test/faults/workload.ts) |
| Looping child writer that is killed | [`test/fixtures/fault-process.ts`](../test/fixtures/fault-process.ts) |
| Recovery classifier and retries | [`test/faults/recovery.ts`](../test/faults/recovery.ts) |
| Process kill | [`test/faults/process-kill.test.ts`](../test/faults/process-kill.test.ts) |
| Disk full (`max_page_count`, `ulimit -f`) | [`test/faults/disk-full.test.ts`](../test/faults/disk-full.test.ts) |
| Real-volume ENOSPC (opt-in) | [`test/faults/volume-enospc.suite.ts`](../test/faults/volume-enospc.suite.ts), `pnpm test:faults:volume` |
| Corruption | [`test/faults/corruption.test.ts`](../test/faults/corruption.test.ts) |
| Soak workload and invariants | [`test/faults/soak.ts`](../test/faults/soak.ts), bounded run in [`test/faults/soak.test.ts`](../test/faults/soak.test.ts), `pnpm test:soak` ([`scripts/soak-cli.ts`](../scripts/soak-cli.ts)) |

The fault and soak logic lives under `test/`, like the fuzz harness: it drives the public store,
backup, and telemetry entry points from test fixtures and is not shipped, so it is outside the
`src/` coverage gate. The only `src/` changes of this slice are the fixes below, which the
default suites cover.

### Outcome classification

After a kill or an injected write failure, every operation the writer started is classified:

| Outcome | Meaning | Evidence required |
| --- | --- | --- |
| complete | Durable before the kill | The append intent diagnoses `committed`, the blob reads back, the cut reads back, the import target exports the archive, or the backup verifies; every operation reported done before the kill must be complete |
| retryable | Absent, with no residue that blocks a retry | The intent diagnoses `retry_safe` (never `manual_recovery_required`), the blob is unregistered, or the import target is pristine or absent; the retry then succeeds and the result verifies |
| refused | A partial artifact every verifier refuses | A backup directory without a manifest: `verifyTraceStoreBackup` fails with `manifest-missing`; a fresh backup then verifies |

Before and after the retries the reopened store must pass `verifyIntegrity`, `verifyBlobs`, and
the `maintain` inspect `quick_check`, and `exportTrace` must succeed. Blob orphans may only be
bytes the killed writer started to put.

Corruption cases are classified by what the store does with the damaged files:

| Outcome | Meaning |
| --- | --- |
| refused | The store or backup does not open or verify, with a typed error |
| detected | The store opens and `verifyIntegrity`, `verifyBlobs`, `maintain` inspect `quick_check`, or a read reports or throws on the defect |
| recovered | Every check passes and the native export and the read surface (every owner, record, cut, and blob) equal the golden copy |
| rolled back | Every check passes and the export equals the store at an earlier commit; allowed only for write-ahead-log damage (F-020) |
| residual | Every check passes and only an append intent's well-formed batch digest differs (F-018 residual) |

A case whose checks pass while the export differs in any other way is a silent difference and
fails the suite.

### Process kill

`process-kill.test.ts` runs one test per configured operation. For each seed and each of
`cyclesPerOperation` (3) cycles, a child process opens the store and loops over the operation,
writing a `start` and `done` line to a pipe around every call; the parent sends `SIGKILL` a seeded
0 to 250 ms after the child reports `ready`, then classifies and retries every started operation.

| Operation | Child loop | Retry after the kill |
| --- | --- | --- |
| `append` | `append` of seeded multi-record batches | Same request (idempotent) |
| `blob` | `putBlob` of seeded 1 B to 256 KiB content | Same bytes |
| `cut` | `append`, then `publishCut` through its last record | Same append and cut |
| `import` | `importTrace` of a fixed archive into a new store | `importTrace` into the pristine or absent target |
| `backup` | `append`, then `backupTraceStore` into a new directory | A fresh backup, which must verify |
| `vacuum` | `append`, then `maintain({ mode: "vacuum" })` | Same append, then `vacuum` |

Default-tier result (seed 20260919, 18 kills, every kill landed inside an operation):

| Operation | Complete | Retryable | Refused |
| --- | --- | --- | --- |
| `append` | 432 | 3 | 0 |
| `blob` | 34 | 3 | 0 |
| `cut` | 434 | 3 | 0 |
| `import` | 2 | 3 | 0 |
| `backup` | 2 | 0 | 3 |
| `vacuum` | 34 | 3 | 0 |

Counts depend on how many iterations run before the kill, so they vary between hosts; the
classification rules do not. No intent was ever `manual_recovery_required`, no reopened store
failed a check, and no partial backup verified. A kill during `importTrace` can leave its staging
directory (`.shepherd-import-stage-*`, owner-only, holding copies of archive blob bytes); since
2.32.2 that directory is created beside the target store instead of in the OS temporary directory
(F-019, fixed). The suite points the child's `TMPDIR` at a private directory, asserts that nothing
at all is left there, and counts staging directories beside the import targets.

### Disk full

| Case | Injection | Outcome |
| --- | --- | --- |
| Database full | `PRAGMA max_page_count` set on the store's connection to the current size plus `headroomPages`, then to the current size after filling | `append`, `publishCut`, `putBlob` (receipt row), and `importTrace` fail with the SQLite error (`ERR_SQLITE_ERROR`, `errcode` 13, `SQLITE_FULL`); the export is unchanged, checks pass, the append intent is `retry_safe`, an unregistered blob reads as absent; after the limit is raised every retry succeeds, `vacuum` runs, and orphans are gone |
| File-size limit | Child launched by `/bin/sh -c "ulimit -f 1024 && exec node ..."` (1 MiB) running `append`, `blob`, `vacuum`, and `backup` until one fails | Node.js ignores `SIGXFSZ`, so the write fails with `EFBIG`; SQLite reports `SQLITE_IOERR_WRITE` (`errcode` 778) for every operation; the parent reopens without the limit and classifies every started operation complete or retryable |
| Real volume (opt-in) | `pnpm test:faults:volume`: a 16 MiB HFS+ image created and attached by `hdiutil` at a private mount point without privileges, a ballast file, then appends and blob puts until one fails | Recorded below |

`PRAGMA max_page_count` cannot be set below the current page count, so `vacuum` under a full
database is exercised by the file-size and volume suites instead. The file-size case is skipped on
non-POSIX hosts.

Recorded real-volume run (macOS 27.0 arm64, APFS host, HFS+ image, Node.js 24.17.0, 2.32.1 working
tree): the first failure was a blob put (`ENOSPC` from the blob layer); while full, `append` and
`vacuum` failed with `SQLITE_FULL` (`errcode` 13), `putBlob` and `backupTraceStore` with `ENOSPC`,
and the backup directory had no manifest; the store passed every check, the failed intent was
`retry_safe`, and after the ballast was removed every retry succeeded. The image was detached and
removed. The suite takes about 3 seconds and never runs in `pnpm test` or `pnpm verify`. On other
platforms it is skipped: Linux loop devices and `tmpfs` mounts need privileges (O-3).

### Corruption

Every case copies a golden store (24 appends on four owners, three cuts, six blobs, and an
acknowledged durable subscription cursor, checkpointed) or a golden backup, damages the copy, and
classifies it.

| Case | Injection | Classification (seed 20260919) |
| --- | --- | --- |
| Database page flips | `pageFlipCases` (48) seeded cases, each XOR-ing 1 to 8 bytes at a seeded offset of a seeded page (page 1 included) | 27 recovered (flip in unused space), 19 detected (`record_mismatch`, `parent_index_mismatch`, `sqlite_integrity_mismatch`, `append_receipt_mismatch`, or `SQLITE_CORRUPT` thrown by a check), 2 refused (`SQLITE_CORRUPT` on open) |
| Page flips, 64-seed sweep | Seeds 1 to 64 (`SHEPHERD_FAULT_SEED`), 3,072 cases, run on the final 2.32.1 working tree | 1,701 recovered, 1,296 detected, 75 refused; no residual, rollback, or silent difference |
| WAL deleted, with or without the SHM | Crash image with six commits in the log | rolled back to the last checkpoint (commit 0 of 6) |
| SHM deleted, truncated to zero, or overwritten | same | recovered (SQLite rebuilds the index) |
| WAL header flipped | same | rolled back to commit 0 |
| WAL truncated or a frame byte flipped | 12 seeded offsets | rolled back to commit 0, 1, 2, 4, or 5 of 6 (the frame checksum chain ends at the damage) |
| Stray garbage rollback journal | 4 KiB of seeded bytes beside a WAL-mode store | recovered |
| Blob truncated, altered, deleted, renamed, or replaced by a directory | One registered blob | detected (`blob_size_mismatch`, `blob_digest_mismatch`, `blob_missing`, `blob_not_regular_file`) |
| Stray temporary file or unregistered blob in the blob directory | Beside the registered blobs | recovered (reported by `collectBlobOrphans` inspection) |
| Backup manifest flipped, truncated, or deleted | Copy of a verified backup | refused (`manifest-invalid`, `manifest-missing`) by verification and restore |
| Backup database flipped, truncated, or deleted | same | refused (`database-mismatch`) |
| Backup blob deleted or altered | same | refused (`blob-mismatch`) |
| Stray staging directory in a backup | same | recovered (verifies, restores to the golden export) |
| Append intent batch digest malformed | Direct update | detected (`append_receipt_mismatch`; `diagnoseAppend` reports `manual_recovery_required`; export refused) |
| Append intent batch digest replaced by another well-formed digest | Direct update | residual (F-018): checks pass, records and receipt are unchanged, a retry of the intent fails with `AppendIntentConflictError` |

No case produced a silent difference after the fixes below. Deleting or truncating the
write-ahead log loses the commits it held without any in-store signal: the store is a consistent
earlier state and the lost intents diagnose `retry_safe` (F-020, accepted). Keep the `-wal` and
`-shm` files with the database, and use `backupTraceStore` (an online, consistent copy) instead of
copying files of a live store.

### Soak

`runSoak` in [`test/faults/soak.ts`](../test/faults/soak.ts) drives one store with a seeded mix of
operations (weights: append 6, blob 2, cut 1) and, on the configured cadence:

| Every | Action and invariant |
| --- | --- |
| 17 operations | `exportPending` on a telemetry exporter over a durable subscription to every workload owner |
| 43 operations | `maintain` in a seeded mode (`inspect`, `checkpoint`, `optimize`, `vacuum`); the export digest must be unchanged |
| 50 operations | Integrity, blob, and quick checks; a sample of committed intents diagnose `committed`, sampled blobs read back, sampled cuts equal their published value; telemetry drained until the acknowledged cursor of every owner equals the store's next ordinal |
| 61 operations | Kill cycle: close the store and exporter, run the fault child with a seeded operation from the process-kill list, `SIGKILL` it after a seeded delay, classify and retry as above, reopen, and drain telemetry from the durable cursor |
| 97 operations | `backupTraceStore` and `verifyTraceStoreBackup` with the expected manifest identity; only the newest two backups are kept |

The bounded soak in `pnpm test` runs 240 operations (three kill cycles, two verified backups, five
invariant checks) in about 7 seconds. It is operation-bounded, so the workload and its checkpoints
are identical on every host; only where the seeded kills land depends on speed.
`pnpm test:soak --duration <seconds>` runs the same workload for a wall-clock budget (default 600
seconds); `--operations N`, `--seed N`, `--directory DIR`, `--keep`, and `--json` are also
accepted. The working directory is removed after a passing run and kept after a failure.

Recorded soak:

| Property | Value |
| --- | --- |
| Command | `pnpm test:soak --duration 720` |
| Package | 2.32.1 working tree of #186 |
| Host | macOS arm64 (Apple M4 Pro), APFS, Node.js 24.17.0 |
| Duration | 722.1 s (12 min 2 s wall) |
| Operations | 2,537 workload operations: 1,731 append intents, 537 blobs, 269 cuts |
| Kill cycles | 41; outcomes of every operation the killed children started: 3,230 complete, 24 retryable, 11 refused (partial backups), none needing manual recovery |
| Other cadence work | 26 verified backups; 59 maintenance passes (14 inspect, 16 checkpoint, 15 optimize, 14 vacuum), each with an unchanged export digest; 369 telemetry batches |
| Invariant checks | 51, all passed (integrity, blobs, quick check, sampled intents, blobs, and cuts, telemetry cursor) |
| Final store | 13,544 record occurrences on the workload owners, all exported as telemetry log records; 50.3 MB database |
| Result | Passed |

The rate falls as the store grows because every maintenance pass exports the whole store twice
and every backup copies and re-verifies every blob; parts of the run overlapped other suites on
the same host.

### Findings

| Finding | Found by | Resolution |
| --- | --- | --- |
| F-017 SQLite's automatic rollback after `SQLITE_FULL` or an I/O error made the store's own `ROLLBACK` fail, so every store write surfaced "cannot rollback - no transaction is active" instead of the SQLite error | `max_page_count` and `ulimit -f` suites | Fixed: transactions roll back only when one is still open (`rollbackFailedTransaction`), so the original typed error reaches the caller; state was already unchanged |
| F-018 Append intent batch digests were not verified | Seeded page flips (a flip inside `append_intents.batch_digest` passed every check and was exported, producing an archive `importTrace` refuses) | Fixed for malformed digests (`diagnoseAppend` reports `receipt_mismatch`, `verifyIntegrity` reports `append_receipt_mismatch`, export refuses); accepted residual: a well-formed substitute is not derivable from retained records and fails closed on retry |
| F-019 A kill during `importTrace` leaves its staging directory in the OS temporary directory | Process-kill suite (`TMPDIR` pointed at a private directory) | Fixed in 2.32.2 (#29): staging is created beside the target store (`kernel.interchange.staging`); the suite asserts the temporary directory stays empty |
| F-020 Deleting or truncating the write-ahead log silently rolls the store back to an earlier commit | WAL corruption cases | Accepted (SQLite property); runbook and threat-model residual |

### Non-claims

- Kills are `SIGKILL` of a process; operating-system crash and power loss (lost page-cache writes,
  torn sectors) are not simulated. `synchronous = FULL` and the blob layer's `fsync` are the
  mitigation, not verified here.
- The real-volume suite is macOS-only and opt-in; Linux volume and jail variants are owner-owed
  (O-3). The file-size case needs a POSIX shell.
- Kill points are chosen by seeded delays, not by instrumented injection points, so a given run
  does not prove every instruction boundary was hit; the recorded soak and the per-cycle counts
  show how often kills landed inside an operation.
- Corruption covers single-region flips and whole-file damage; it does not model an adversary who
  rewrites records and digests consistently (F-006).
- Recorded runs are for the reference host only.
