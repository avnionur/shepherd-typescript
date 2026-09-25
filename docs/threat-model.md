# Threat model

Status: normative for 2.34.0 (Phase 11 slice 1, #187; B10 added by #179; secret and store-file rows
updated by #180; storage-adapter rows added by #181; backup, restore, and store CLI rows added by
#182; store maintenance and growth rows added by #183; telemetry rows added by #184; fuzz, archive
limit, parser-differential, and Git invocation rows updated by #185; crash, disk-full, and
corruption recovery rows added by #186; witness, secret-digest, store-file, backup, replication,
import-staging, Git filter, and compatibility-gate rows updated by #29 for F-014, F-019, and
F-021 to F-028; worktree submodule check row updated by #29 in 2.32.3 for F-028; residual table
re-examined and completed by the [Phase 11 exit audit](../.plan/phase-11-exit-audit.md) in 2.32.4;
concurrent first-open row added and the F-029 residual row removed in 2.32.5; canonical nesting
row updated and the F-016 residual row replaced by #189 in 2.33.0; carrier cleanup, packed file
set, and F-008 rows updated by the Linux verification lane, #190, in 2.33.1; packed file set
row (F-032 fixed) and F-008, F-009, and F-010 residual rows updated by #191 in 2.33.3; F-008,
F-009, and F-010 residual rows updated and an external-review row added for the owner decisions of
2026-09-23, #199, in 2.34.0). Findings, severities, and owning issues live
in the [internal security review](../.plan/security-review.md); the
[production hardening contract](../.plan/production-hardening-contract.md) owns the slice map.
This page states what the runtime defends, where, and with which test. A threat without a cited
mitigation and test is a residual risk with a register finding.

## Scope and assumptions

- Shepherd TypeScript is an in-process library and a local CLI (`shepherd-ts`). It opens no network
  listener and ships no live provider adapter.
- The calling process is trusted with the authority it passes in (store paths, grants, runners,
  handlers, providers). The runtime defends the integrity of its records against malformed input
  and against its own crashes, and defends managed worlds against effects that exceed declared
  authority.
- The host operating system, Node runtime (`>=24.12.0 <27`, [runtime support](./runtime-support.md)),
  and the files of the installed package are trusted. A hostile process running as the same OS user
  is out of scope: it can rewrite the store, the package, or Node builtins.
- Other OS users on the same host are untrusted.

## Assets

| Asset | Where it lives | Property defended |
| --- | --- | --- |
| Canonical records, envelopes, cuts | SQLite database (`SQLiteTraceStore`) | Integrity, immutability, confidentiality |
| Blob content | Blob directory beside the database | Integrity, confidentiality |
| Append intents and receipts | SQLite database | Idempotency, exactly-once semantics |
| Leases, claims, fences | SQLite database | Single-writer authority |
| Storage-adapter refs, leases, and blobs | Caller-named coordinator file or blob directory ([storage interfaces](./storage-interfaces.md)) | Single-writer authority, content addressing |
| Managed worlds and retained outputs | Carrier custody roots, workspaces | Isolation, exact settlement |
| Task registry | Separate SQLite database | Integrity of exact task versions |
| Trace archives | Caller-held JSON text | Integrity on import, confidentiality after export |
| Store backups | Backup directory (database copy, blobs, manifest) or a caller blob backend ([backup, restore, and migration](./backup-restore-and-migration.md)) | Integrity, completeness, confidentiality |
| Telemetry batches and files | Caller-supplied sink; JSON-lines files at caller-named paths ([observability](./observability.md)) | Confidentiality; never canonical |
| Caller credentials | Caller process (provider implementations) | Never persisted by the runtime |

## Trust boundaries

| ID | Boundary | Untrusted side |
| --- | --- | --- |
| B1 | Caller API (`src/index.ts` and package entries) | Argument shape and values |
| B2 | CLI argv and environment (`src/cli/`) | Arguments, output size, process environment |
| B3 | Archive import (`src/interchange/`) | Archive text from another store or host |
| B4 | Store files on a shared host | Other OS users; files at rest |
| B5 | Provider responses (`src/provider/`) | Model output, usage, tool calls |
| B6 | Model-emitted task definitions (`src/delegation/`) | Revised and synthesized task values |
| B7 | Native helpers (`src/workspace/native-jail.ts`, `src/workspace/carrier-backends.ts`) | Launched processes, helper evidence |
| B8 | Interceptors and supervisors (`src/supervision/`) | Decision callbacks, supervisor processes |
| B9 | Git executable (`src/workspace/git-aware-custody.ts`, `bindings.ts`, `initialization.ts`) | Repository contents and configuration, `PATH` |
| B10 | Build and release supply chain (`pnpm-lock.yaml`, `tooling/release/`, `tooling/compatibility/`, `.github/workflows/release.yml`) | Registry packages, build host, release consumers |

## STRIDE per boundary

S spoofing, T tampering, R repudiation, I information disclosure, D denial of service, E elevation of
privilege. Paths are repository-relative.

### B1 caller API

| STRIDE | Threat | Mitigation | Test |
| --- | --- | --- | --- |
| T | Malformed or prototype-bearing values alter canonical identity | `src/canonical/canonical-record.ts` rejects non-plain prototypes and copies into null-prototype objects; `src/record/validation.ts` validates envelopes | `test/canonical-record.test.ts`, `test/record-envelope.test.ts` |
| T | Replayed append intent with different content | Intent conflict check in `src/store/append.ts` (`AppendIntentConflictError`) | `test/store/append.test.ts` |
| E | Delegated child gains more authority than its parent | `src/delegation/authority.ts` (`assertBudgetAttenuated`, `deriveDelegatedAuthority`) | `test/delegation/delegation-laws.test.ts` |
| S | Stale writer acts after lease loss | Fencing in `src/store/durable-execution-claims.ts` and `src/scope/writer.ts` | `test/run/durable-execution.test.ts`, `test/scope/scope-writer.test.ts` |
| S | Stale storage-adapter writer swaps a reference after lease loss, including from another process | Fenced `compareAndSwapRef` checks owner, token, and expiry in the same atomic step; the SQLite coordinator serializes every change in one `IMMEDIATE` transaction (`src/storage/coordination.ts`, `src/storage/sqlite-coordinator.ts`) | `test/storage/conformance.test.ts` (`fenced-swap`, `lease-expiry-takeover-fences`), `test/storage/process-race.test.ts` |
| T | A blob-store adapter stores bytes under the wrong identifier or replaces an object | Reference backends verify the digest before writing and never replace (`src/storage/blob-backend.ts`, `src/blob/filesystem.ts`); third-party adapters self-test with `checkBlobStoreBackendConformance` | `test/storage/conformance.test.ts`, `test/storage/blob-backends.test.ts`; residual: the kit cannot prove a third-party adapter's durability claim |
| I | Secrets passed in record bodies are persisted and exported | Opt-in `secretScanning: "refuse"` rejects bodies matching configured detectors before any append or import write (`src/store/secret-scanning.ts`, `src/store/append.ts`); findings carry class, pointer, and a per-process keyed digest only, so a finding cannot confirm a guessed secret (`src/retention/secret-scan.ts`, F-025); data classes and the one-way redacted export and its verifier keep bodies out of shared evidence (`src/retention/`); [secrets and retention](./secrets-and-retention.md) defines rotation | `test/retention/append-refusal.test.ts`, `test/retention/secret-scan.test.ts` ("finding digests are keyed per process"), `test/retention/redacted-archive.test.ts`; residual (default off, pattern-based, records immutable): F-001 (accepted); unkeyed whole-body `body_digest` in redacted archives and telemetry: F-025 (accepted) |
| I | Redacted evidence re-enters a store or leaks through reports | Redacted archives are refused by import before any other check; the retention report and all errors carry counts, pointers, classes, and digests only | `test/retention/redacted-archive.test.ts` ("refused by every import path"), `test/retention/retention-report.test.ts` |
| D | Values nested past the call stack escape as `RangeError` from canonical encoding, record validation, or readers built on them, or are accepted or refused depending on the call site's stack depth and JIT state | The canonical value domain has a configured maximum nesting depth (`kernel.canonicalization.maxNestingDepth`, 1,000; kernel framing around whole record bodies gets `framingDepth`, 8, more). The encoder normalizes and serializes with explicit stacks and checks the bound before entering the next container, so a value at the bound is accepted and one level deeper is refused with `CanonicalNestingLimitError` (`CANONICAL_NESTING_LIMIT_EXCEEDED`, a `TypeError`) at any call-site depth; output beyond the runtime string length is still reported as `TypeError` with the `RangeError` as cause (`src/canonical/canonical-record.ts`) | `test/canonical-record.test.ts` ("canonical nesting depth is bounded by configuration, independent of the call site"), `test/canonical-nesting-bound.test.ts`, seeded fuzz of `canonicalizeRecord`, `createRecordId`, `validateRecordBody`, and `validateRecordEnvelope` (`test/fuzz/records.test.ts`) with bound-relative corpus cases; F-012 and F-016 fixed |
| T | Append admits a record whose `witness_ref` names a record that is not a witness; the store then fails `verifyIntegrity` and refuses export | Append refuses a witness whose schema is neither the root witness nor `kernel.queries.witnessSchemaRef` with `TraceStoreError` before any write (`validateWitnesses` in `src/store/append.ts`); `verifyIntegrity` still reports `witness_mismatch` for rows written outside the API | `test/store/integrity.test.ts` ("append refuses a witness_ref that names a record that is not a witness"); F-014 fixed |

### B2 CLI argv and environment

| STRIDE | Threat | Mitigation | Test |
| --- | --- | --- | --- |
| D | Oversized argv or output | `cliProtocolConfig.limits` (`maxArguments`, `maxArgumentBytes`, `maxOutputBytes`) in `src/cli/cli.ts` | `test/cli/cli.test.ts` ("argument bounds") |
| I | Stacks, paths, or causes leak through error output | Closed configured error codes and remedies in `src/cli/cli.ts`; closed JSON envelope `spec/schemas/cli-output-v1.schema.json` | `test/cli/cli.test.ts` ("without a stack"), `test/cli/json-schema.test.ts` |
| E | Mutation through an ergonomic selector | Exact identities required for mutation (D-009) in `src/cli/handlers.ts` | `test/cli/cli.test.ts` |
| T | `store restore`, `store export`, or `store import` overwrites existing data | Restore requires an exact `--manifest` and an explicit, absent `--store` target; export opens its output exclusively; import requires a pristine store (`src/cli/store-handlers.ts`) | `test/cli/store-cli.test.ts` |
| T | Unexpected argv shapes reach a handler | Configured limits and closed option parsing (`src/cli/cli.ts`, `src/cli/arguments.ts`); every exit code is configured and every `--json` run writes one envelope valid against `cli-output-v1` | Seeded grammar-derived and mutated argv fuzz (`test/fuzz/cli.test.ts`, [fault and fuzz conformance](./fault-and-fuzz-conformance.md)); F-002 fixed |
| D | `store import` reads an oversized archive file into memory | The file size is compared with `kernel.interchange.limits.maxArchiveBytes` before the file is read (`src/cli/store-handlers.ts`) | `test/interchange/archive-limits.test.ts` (sparse file one byte over the bound) |

### B3 archive import

| STRIDE | Threat | Mitigation | Test |
| --- | --- | --- | --- |
| T | Archive with inconsistent records, views, or versions | Closed-key decode and envelope validation in `src/interchange/decode.ts`; staged replay and integrity scan in `src/interchange/import.ts` | `test/interchange/validation.test.ts` |
| T | Import merges into a live history | Pristine-target check inside the import transaction | `test/interchange/validation.test.ts` ("requires a pristine target store") |
| T | Tampered blob bytes | Declared length and canonical base64 length in `src/interchange/decode.ts`; content digest in the staged integrity scan (`src/interchange/import.ts`) | `test/interchange/validation.test.ts` (malformed blob fields), `test/interchange/archive-limits.test.ts` ("substituted blob bytes"), `test/fuzz/archives.test.ts` |
| D | Oversized archive exhausts memory before validation | Configured `kernel.interchange.limits`: byte length and nesting depth checked before `JSON.parse`; append-intent, blob, cut, record, and view counts and the declared blob byte total checked before any record or blob is decoded; canonical base64 length checked before each blob decode; `TraceArchiveLimitError` (`TRACE_ARCHIVE_LIMIT_EXCEEDED`); the same text and count limits apply to `verifyRedactedTraceArchive` (`src/interchange/limits.ts`) | `test/interchange/archive-limits.test.ts`, fuzz corpus `test/fixtures/fuzz-corpus/decodeTraceArchive/`; F-004 fixed. Residual: within the bounds, decode and staged import still hold the parsed archive in memory |
| T | Repeated JSON keys or non-canonical nested text let another parser read a different archive or manifest than the importer, verifier, or restore | Archive and redacted-archive text is scanned for repeated object keys before parsing; archived `receipt_json` must be canonical; backup manifests must be the writer's exact canonical encoding (`src/interchange/limits.ts`, `src/interchange/decode.ts`, `src/operations/backup-manifest.ts`) | `test/interchange/archive-limits.test.ts`, `test/operations/backup-restore.test.ts`, fuzz corpus; F-013 fixed. Residual: the store-internal receipt decoder still accepts non-canonical receipt text written directly into a database; `diagnoseStoredAppend` re-checks its meaning against retained rows |

### B4 store files on a shared host

| STRIDE | Threat | Mitigation | Test |
| --- | --- | --- | --- |
| I | Other users read blob content | Blob files `0o600`, directories `0o700` in `src/blob/filesystem.ts`, `src/blob/directory-durability.ts` | `test/blob/security.test.ts` |
| I | Other users read the database, WAL, or SHM | Writable opens create the trace-store and task-registry database with the configured owner-only mode (`retention.storeFiles.mode`, `0600`) and tighten existing owned database and sidecar files; SQLite creates the WAL, SHM, and journal with the database's mode. Every file is opened with `O_NOFOLLOW` and checked and tightened through its descriptor (`fstat`, `fchmod`), so a link at a store path is never followed or changed and creation errors other than `EEXIST` surface (`src/store/file-mode.ts`) | `test/store/file-mode.test.ts`; F-003 fixed (files owned by another user are left unchanged); F-023 fixed (residual: a database reached through a link is not tightened, accepted) |
| T | Blob directory replaced by a symlink | Symlink and non-directory ancestor refusal in `src/blob/directory-durability.ts` | `test/blob/security.test.ts` |
| T | Records or blobs altered at rest | `verifyIntegrity` and `verifyBlobs` (`src/store/integrity.ts`, `src/store/receipt-integrity.ts`) classify defects | `test/store/integrity.test.ts`, `test/blob/integrity.test.ts`, `test/store/corruption.test.ts` |
| T | Consistent rewrite of records and digests by a principal with write access | Content addressing only; no signatures | Residual: F-006 (accepted) |
| T | Newer or older schema silently reinterpreted | `UnsupportedStoreSchemaError` for newer schemas; read-only requires exact schema (`src/store/migrations.ts`) | `test/store/migrations.test.ts`, `test/operations/migration-drills.test.ts` (every historical schema and a future schema) |
| I | Other users read a backup copy or its manifest | Backup directories use the configured owner-only `backup.directoryMode` (`0700`); the database copy, manifest, and staging copies use `retention.storeFiles.mode` (`0600`); blobs use the blob-layer modes (`src/operations/backup-staging.ts`, `src/operations/backup.ts`) | `test/operations/backup-restore.test.ts` (umask `022`); packaged CLI probe asserts `700`/`600`; F-003 backup part fixed |
| T | Incomplete, tampered, or substituted backup restored as good | Manifest written last by atomic rename; restore requires the exact manifest identity, a verified staged copy (database digest, blob set and bytes, integrity, export digest), a non-existent target, and a read-only re-verification before success; a failed publication move is classified `target-exists` and removes the empty directory it created (`src/operations/restore.ts`, `src/operations/backup-staging.ts`); backup databases are opened with the store's defensive setting and written in the configured rollback-journal mode (`src/operations/backup-manifest.ts`, `src/operations/backup.ts`) | `test/operations/backup-restore.test.ts` (interrupted, tampered, race cases, failed publication move), `test/operations/backup-config.test.ts`; F-024 and F-027 fixed; residual: a consistent rewrite of a backup by its owner is not detected (F-006) |
| T | A backup file swapped between verification and replication is published as the verified replica | The re-read database must hash to the manifest's database digest and the re-read manifest must name the verified identity before anything is stored; configuration requires the backup digest scheme to equal the blob identifier scheme it is stored under (`src/operations/replication.ts`, `src/protocol/config-backup.ts`) | `test/operations/replication.test.ts` ("refuses database or manifest files that change after verification"); F-026 fixed |
| T | Maintenance (checkpoint, optimize, vacuum) alters or loses retained evidence | `SQLiteTraceStore.maintain` runs a bounded `quick_check` first and refuses mutating modes on a defect, refuses read-only handles (`TraceStoreReadOnlyError`), and issues only SQLite-atomic PRAGMA/`VACUUM` statements (`src/store/maintenance.ts`) | `test/store/maintenance.test.ts`, `test/store/scale.test.ts`, packaged CLI probe (export digest identical before and after every mode) |
| D | Large stores degrade appends and listings through full scans, or files grow without reclamation | Append planning reads only cited records and extended owners by primary key; index-only schema v13 indexes owner-by-schema and cut listings; `maintain` reclaims the log and freelist; kernel SLOs checked by `pnpm check:slo` in `verify:release` | `test/store/query-plans.test.ts`, `test/store/scale.test.ts`, [performance report](./performance-report.md); residual: budgets exist only for the reference host class |
| E | Defensive SQLite unavailable | `src/runtime/sqlite.ts` proves defensive behavior before any file is created | `test/runtime-policy.test.ts` |
| D | A writer killed mid-append, blob put, cut, import, backup, or vacuum leaves a state that is guessed complete | Every store write is one SQLite transaction; blob bytes become visible only after their receipt commits; backups are complete only with a manifest written last; `diagnoseAppend` classifies each intent `committed`, `retry_safe`, or `manual_recovery_required` | `test/faults/process-kill.test.ts`, `test/faults/soak.test.ts` (seeded `SIGKILL`; every started operation complete, retryable, or refused; checks clean after every kill; nothing left in the OS temporary directory); F-019 fixed: import stages beside the target store (`kernel.interchange.staging`), so a killed import's owner-only staging directory stays in the store's own directory (`test/interchange/validation.test.ts`) |
| D | A full disk or file-size limit leaves partial records or hides the cause | Failed transactions are rolled back only while still open, so SQLite's own rollback after `SQLITE_FULL` or an I/O error no longer replaces the error (`rollbackFailedTransaction` in `src/runtime/sqlite-transaction.ts`, every store, import, export, coordinator, and task-registry transaction) | `test/faults/disk-full.test.ts` (`max_page_count`, `ulimit -f`), opt-in `test/faults/volume-enospc.suite.ts`; F-017 fixed |
| D | Several processes opening the same new trace-store, task-registry, or coordinator database at once fail with `database is locked`, a duplicate table or column, or `EEXIST` on the blob directory | The write-ahead-log switch retries SQLite's deadlock-avoidance `SQLITE_BUSY` within the configured busy timeout (`execRetryingBusy` in `src/runtime/sqlite-transaction.ts`); every migration step reads the applied schema version inside its configured `IMMEDIATE` transaction, so concurrent migrators serialize and later ones commit nothing (`src/store/migrations.ts`, `src/task/registry-migrations.ts`, `src/storage/sqlite-coordinator.ts`); blob-directory creation treats a component another process created as existing (`src/blob/directory-durability.ts`) | `test/storage/process-race.test.ts` (four processes released together open one new database, four rounds per handle kind), `test/storage/sqlite-busy-retry.test.ts`, `test/blob/directory-durability.test.ts`; F-029 fixed |
| T | Damaged pages, sidecars, blobs, or backups read back as different records | `verifyIntegrity` (`PRAGMA integrity_check`, canonical records, receipts, cuts, owners, blobs), `verifyBlobs`, `maintain` `quick_check`, backup verification, and `diagnoseAppend` rejecting a malformed batch digest (`src/store/append-recovery.ts`) | `test/faults/corruption.test.ts` (seeded page flips, WAL/SHM, blob, and backup damage compared with a golden export and read surface); F-018 fixed for malformed digests. Residuals: a well-formed substitute batch digest is not derivable from retained records and fails closed on retry (F-018); a deleted or truncated write-ahead log rolls the store back to an earlier commit without an in-store signal (F-020) |

### B5 provider responses

| STRIDE | Threat | Mitigation | Test |
| --- | --- | --- | --- |
| T | Malformed response or usage enters records | `readModelResponse` in `src/provider/validation.ts`; output schema validation in task execution | `test/provider/static-provider-validation.test.ts`, `test/run/execution.test.ts`, seeded fuzz of `readModelResponse`, `readStaticProviderDefinition`, and `readApplicationProtocol` (`test/fuzz/helpers.test.ts`) |
| S | Replay served for a different request | Exact cassette request matching (`StaticProviderRequestMismatchError`) in `src/provider/static-provider.ts` | `test/provider/static-provider.test.ts` |
| I | Credentials persisted | Providers are caller-held objects; closed provider definitions refuse unknown fields (`readStaticProviderDefinition` in `src/provider/validation.ts`) | `test/provider/static-provider-validation.test.ts` ("rejects open or malformed definitions") |

### B6 model-emitted task definitions

| STRIDE | Threat | Mitigation | Test |
| --- | --- | --- | --- |
| E | Synthesized task value carries or runs code | Task values are data; revised and synthesized handles open in `approval_pending` (`src/delegation/handle.ts`) and need `approveChildRunTask` (`src/delegation/commands.ts`) | `test/delegation/execution-boundary.test.ts`, `test/delegation/task-revision.test.ts` |
| E | Grandchild escapes the root's authority or projection | Bounded delegation trees and isolation in `src/delegation/projection.ts` | `test/delegation/nested-isolation.test.ts` |

### B7 native helpers

| STRIDE | Threat | Mitigation | Test |
| --- | --- | --- | --- |
| E | Placement reported as jailed without enforcement | Authenticated live probe required before runner admission; fail closed (`src/workspace/native-jail.ts`) | `test/workspace/native-jail.test.ts` |
| E | Shell or argument injection | Absolute executable, literal argv, explicit environment, no shell (`createNativeJailConfinementPlan`) | `test/workspace/native-jail.test.ts` ("reject shell-like ambiguity") |
| E | Write outside granted roots or through aliases | Seatbelt/Landlock lowering of exact grants | `test/workspace/native-jail.test.ts` ("writable, read-only, and alias boundaries") |
| D | Unbounded helper output or runtime | Configured output bounds and timeout classification | `test/workspace/native-jail.test.ts` ("output bounds") |
| T | Optimized carrier diverges from the copy oracle | Shared carrier conformance matrix (`src/workspace/carrier-backends.ts`) | `test/workspace/carrier-conformance.test.ts` |
| T | A failed carrier write leaves a staged symbolic link (dangling) in custody or the canonical workspace, because `fs.rmSync` on Node 24.12.x and 24.13.x silently keeps a dangling link (F-031) | Every product removal goes through `removePathSync` (`src/runtime/remove-path.ts`), which unlinks a symbolic link itself and delegates other paths to `rmSync` | `test/runtime/remove-path.test.ts`; `test/workspace/reference-copy-carrier.test.ts` ("a failed symbolic-link replacement leaves no staged link behind and retries cleanly") |
| T | Malformed persisted helper evidence (placement, repository grant, native-jail command and plan) or a hostile mount table is accepted | Exact-shape readers re-derive every content-addressed identity (`src/protocol/placement-evidence.ts`, `src/protocol/repository-grant-evidence.ts`, `src/protocol/native-jail-evidence.ts`); overlay `mountinfo` classification is total and host-independent (`classifyOverlayMountInfo` in `src/workspace/carrier-backends.ts`) | Seeded mutation fuzz (`test/fuzz/helpers.test.ts`), `test/workspace/overlay-mount-info.test.ts` |
| T | Changeset or selection-publication evidence misstates a world change | Changesets are re-derived from authenticated carrier revisions; selection-publication decoders accept only the exact canonical encoding for their authenticated inputs (`src/workspace/changesets.ts`, `src/workspace/selection-publication-codec.ts`) | Seeded tree mutations compared with a reference model and mutated revision objects (`test/fuzz/workspace.test.ts`) |

### B8 interceptors and supervisors

| STRIDE | Threat | Mitigation | Test |
| --- | --- | --- | --- |
| T | Observer perturbs execution | Subscriptions acknowledge outside the record graph (`src/supervision/subscription.ts`) | `test/supervision/passive-observation.test.ts` |
| E | Irreversible effect lands on interceptor timeout | Declared timeout policy; irreversible tiers always fail closed (`dispatchSupervisedEffect` in `src/supervision/dispatch.ts`) | `test/supervision/supervised-dispatch.test.ts` |
| S | Stale supervisor decides after lease loss | Fenced decision leases | `test/supervision/supervision-crash.test.ts` |
| D | Slow consumer grows buffers without bound | Bounded buffers with backpressure and a fail overflow policy | `test/supervision/trace-subscription.test.ts` |
| R | Decision cannot be attributed | Retained decision records with cited causes | `test/supervision/supervision-evidence.test.ts` |
| I | Telemetry leaks record bodies or secrets to a collector or telemetry file | Bodies are withheld by default (`omit`); in `retention-policy` mode a body is exported only with disposition `include`, no configured detector match, and within `observability.limits.maxBodyBytes`; redacted bodies export only a retention digest and secret classes; JSON-lines files are created `0600` and loosened files tightened (`src/observability/mapping.ts`, `src/observability/jsonl-sink.ts`) | `test/observability/telemetry-exporter.test.ts` ("secret-bearing bodies are never emitted"), `test/observability/jsonl-sink.test.ts`; residual: attributes (owner paths, schema and record identifiers) are exported unscanned, and a caller sink controls its own confidentiality (F-011, accepted) |
| T | Telemetry export perturbs a run or the trace, or a sink failure loses telemetry | The exporter only reads through a subscription and acknowledges its cursor after the sink succeeds (`src/observability/exporter.ts`); telemetry is never imported or replayed | `test/observability/telemetry-exporter.test.ts` (byte-identical `exportTrace`, throwing sink, restart from the acknowledged cursor) |

### B9 Git executable

| STRIDE | Threat | Mitigation | Test |
| --- | --- | --- | --- |
| E | Repository config or an injected `GIT_CONFIG_PARAMETERS` runs commands (fsmonitor) during custody, binding inspection, or workspace initialization | Every Git subprocess passes the configured `workspaces.gitInvocation.configOverrides` (`core.fsmonitor=false`, `core.untrackedCache=false`) before the subcommand, runs argv without a shell, and gets an environment with every inherited `GIT_*` variable removed and the configured variables set (`src/workspace/git-command.ts`, used by `git-aware-custody.ts`, `bindings.ts`, `initialization.ts`) | `test/workspace/git-command.test.ts` (a hostile `core.fsmonitor` helper runs under a plain `git status` and not under the pinned invocation); F-005 fixed |
| E | Repository attributes select a filter program (`filter.<driver>.smudge`/`process`) or export rewrite that runs or alters content while `git-head` custody materializes HEAD | The tree is written from `git ls-tree` and `git cat-file --batch`, which apply no attributes; entries named `.`, `..`, or empty, or without a tree parent, are refused (`materializeHeadTree` in `src/workspace/git-aware-custody.ts`) | `test/workspace/git-aware-custody.test.ts` ("never runs repository filters or export attributes", "matches git archive for a repository without attributes", "refuses entries that escape the world"); F-021 fixed |
| E | A hostile repository configuration's `clean`/`process` filter runs when `worktree` custody checks a declared submodule for local changes | No `git status` runs: the check compares the gitlink, submodule HEAD, index, and HEAD tree with `rev-parse`, `ls-tree`, and `ls-files`, hashes worktree content as raw Git blobs in Node, and lists untracked paths with `ls-files --others` (`checkedOutRepositoryMatches` in `src/workspace/git-aware-custody.ts`); content equal to its blob only after a filter or end-of-line conversion fails closed as a dirty submodule | `test/workspace/git-aware-custody.test.ts` ("worktree submodule check never runs repository clean filters", "preserves git status dirty semantics without git status"); F-028 fixed |
| T | Protected control paths reached through aliases | Configured normalization (`src/workspace/protected-control-paths.ts`) | `test/workspace/protected-control-paths.test.ts` |
| T | Overlapping or escaping binding roots | Canonical disjoint roots (`src/workspace/bindings.ts`) | `test/workspace/bindings.test.ts` |
| S | Ambient `GIT_DIR`, `GIT_WORK_TREE`, or other `GIT_*` variables redirect inspection to another repository | Removed by the configured prefix (`workspaces.gitInvocation.removedEnvironmentPrefixes`) | `test/workspace/git-command.test.ts` (bindings name the requested repository's Git directory with a decoy `GIT_DIR` set) |
| S | `git` resolved through `PATH` | `workspaces.gitExecutable` accepts an absolute path; the default `git` is resolved through the caller's `PATH`, which is part of the trusted calling process (a principal that controls it controls the process) | Accepted residual (F-005): no default absolute path is portable across the supported hosts |

### B10 build and release supply chain

| STRIDE | Threat | Mitigation | Test |
| --- | --- | --- | --- |
| T | A locked dependency is substituted | Frozen lockfile installs with registry integrity; the lockfile SBOM records every integrity digest and `pnpm check:sbom` rejects drift (`tooling/release/sbom.ts`) | `test/release-integrity.test.ts` ("checked-in SBOM matches the lockfile") |
| E | Dependency lifecycle scripts run during install or release | `allowBuilds` is empty in `pnpm-workspace.yaml`; `release.yml` installs with `--ignore-scripts`; the pack command uses `--ignore-scripts` | Configuration review; `release.yml` not run (F-010) |
| T | Build output differs from the reviewed source or between builds | Two clean builds and packs compared by output-tree, tarball, and per-entry digest (`tooling/release/reproducible-build.ts`) | `test/release-integrity.test.ts` ("reproducible builds compare"); `pnpm verify:release` |
| T | The packed file set depends on the npm version used to pack (unanchored `files` entries matched in every directory under npm 11) | Every top-level `files` entry is anchored with `/` and every entry is a literal path; `pnpm test:package-cli` (in `pnpm verify`) packs with the installed npm and fails when the tarball holds a file the allowlist does not declare or misses a declared entry (`tooling/release/packed-files.ts`) | `test/release-integrity.test.ts` ("files allowlist is literal and anchored", "packed tarballs are checked"); npm 11.19.0 and 12.0.2 pack identical file sets (F-032 fixed, 2.33.3) |
| T | Silent API or protocol break reaches consumers | `pnpm check:compatibility` over emitted declarations and protocol artifacts (schemas, version markers, migrations, error codes, CLI commands, exit codes, per-command CLI options, identity settings) with an append-only classified change log; version-marker increases need a noted classification or matching migrations, changed API declarations and markers are classified one at a time, the deprecation window counts released versions, and declarations older than `src` are refused (`tooling/compatibility/policy.ts`, `config/compatibility-policy.config.json`) | `test/compatibility-policy.test.ts`; F-022 fixed |
| R | A release cannot be tied to its commit and inputs | Unsigned in-toto/SLSA provenance naming the tarball digest, commit, lockfile digest, and tool versions (`tooling/release/provenance.ts`) | `test/release-integrity.test.ts` ("release evidence binds"); signing waived for 1.0 by owner decision (F-010 accepted, #199) |

## Residual risks

| Risk | Finding | Owner |
| --- | --- | --- |
| Secrets appended while scanning is off (the default) or in formats no detector matches persist in immutable records and native exports; removal requires store rotation | F-001 | accepted |
| Default `git` is resolved through the caller's `PATH` (set `workspaces.gitExecutable` to an absolute path to pin it) | F-005 | accepted |
| Trace identity is not a signature | F-006 | accepted |
| The store-internal append-receipt decoder accepts non-canonical receipt text written directly into a database; its meaning is re-checked against retained rows | F-013 | accepted |
| A store written before 2.33.0 that holds a record body nested deeper than `kernel.canonicalization.maxNestingDepth` fails closed wherever that body is canonicalized again (record reads, export, integrity checks) until the configured bound is raised; no such body can be appended from 2.33.0 on | F-016 | accepted |
| A store database reached through a symbolic link is not tightened to owner-only (links are never followed; SQLite still opens the target) | F-023 | accepted |
| Redacted-archive and telemetry `body_digest` is the unkeyed digest of the whole canonical body, so a body consisting of a low-entropy secret can be confirmed from it | F-025 | accepted |
| An append intent's batch digest replaced by another well-formed digest passes integrity checks; a retry of that intent fails with `AppendIntentConflictError` | F-018 | accepted |
| Deleting or truncating a store's `-wal` file (or a damaged log frame) returns the store to an earlier consistent commit with no in-store signal; lost intents diagnose `retry_safe` | F-020 | accepted |
| Within the configured interchange limits, archive decode and the staged import hold the parsed archive in memory; operators can lower the limits | F-004 | accepted |
| Telemetry attributes (owner paths, schema, record, and witness identifiers) are exported unscanned, and the confidentiality of a caller sink or downstream collector is the caller's | F-011 | accepted |
| A killed import leaves its owner-only `.shepherd-import-stage-*` directory beside the target store until the operator removes it | F-019 | accepted |
| No hosted workflow runs: attempts on 2026-09-23 to run `CI` (#191 and the #199 recheck) were blocked by the account's Actions billing or spending limit and the workflows were disabled again, and CodeQL needs GitHub Advanced Security on a private repository. By owner decision of 2026-09-23 the local macOS gates (`pnpm verify`, `pnpm verify:release`, `pnpm build:desktop`) and the local Docker Linux lane are the 1.0 verification substitute; CodeQL is waived while the repository is private; there is no Windows lane or hosted privileged-jail lane | F-008 | accepted (owner decision, #199) |
| GitHub private vulnerability reporting is unavailable while the repository is private and is waived while it stays private; intake is by email as documented in `SECURITY.md` | F-009 (fixed by documented email intake) | waived while private (owner decision, #199) |
| Release evidence is unsigned and nothing is published; the release workflow has never run. 1.0 is a private, unpublished source release by owner decision of 2026-09-23 | F-010 | accepted (owner decision, #199) |
| No external security review has been performed; the owner waived it for 1.0 and accepted the internal review (implementing agents plus one independent internal reviewer) in its place | none (O-1) | accepted (owner decision, #199) |

## Out of scope

- A hostile process running as the same OS user, a compromised Node runtime, or a modified package.
- Reversal of external network actions, sent messages, consumed API cost, or leaked credentials
  ([SECURITY.md](../SECURITY.md)).
- Native Windows (unsupported), live provider adapters (none ship), and remote storage (interfaces,
  conformance kits, and local reference adapters only, D-018; no network adapter ships, and a
  third-party adapter's transport, credentials, and durability are the adapter's responsibility).
