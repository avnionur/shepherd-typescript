# Incident response

Status: normative for 2.33.3 (Phase 11 slice 1, #187; email intake while private by #191; secret runbook completed by #180; backup,
restore, and downgrade runbooks completed by #182; store growth runbook added by #183; crash,
disk-full, and corruption evidence and runbooks added by #186). No runbook is pending. Severity
uses the rubric in the
[internal security review](../.plan/security-review.md#severity-rubric); the
[threat model](./threat-model.md) names the boundaries.

## Severity levels

| Level | Meaning | Target handling |
| --- | --- | --- |
| Critical | Rubric critical: silent forgery or reinterpretation of canonical evidence, jail escape under a jailed placement, code execution from data, or default secret exposure | Private advisory; fix before any other release; no public detail until a fixed release exists |
| High | Rubric high, or data loss affecting canonical records | Private advisory; fix in the next release |
| Medium | Rubric medium, or a recoverable store defect | Tracked issue without exploit detail; scheduled fix |
| Low | Rubric low | Ordinary issue |

## Triage

1. Acknowledge the report on the channel it arrived on. Security reports stay private: in the
   email thread while the repository is private, or in the private advisory once it is public
   ([SECURITY.md](../SECURITY.md)).
2. Reproduce on the current `main` with the reporter's version. Record the commit, Node version,
   operating system, and whether the store was writable, read-only, or imported.
3. Assign a severity with the rubric and add a finding to the
   [findings register](../.plan/security-review.md#findings-register) with an owning issue.
4. Identify affected surfaces from the threat model boundary and the affected versions from the
   changelog.

## Private advisory

- While the repository is private, reports arrive by email to the address in
  [SECURITY.md](../SECURITY.md) (owner decision of 2026-09-23, O-4 in the
  [hardening contract](../.plan/production-hardening-contract.md)); keep the report, exploit
  detail, and proofs of concept in that thread and in the owner's private tracking, never in a
  public issue. A maintainer may still open a GitHub security advisory draft for a critical or high
  finding.
- Once the repository is public and private vulnerability reporting is enabled (#199), use a GitHub
  security advisory draft for critical and high findings.
- Keep exploit detail, proofs of concept, and affected user data inside the private channel.
- Request a CVE through the advisory when the package is published.

## Fix and release

1. Develop the fix on a private branch or advisory fork; add a regression test that fails before
   the fix.
2. Classify the version bump under `AGENTS.md` (a security fix without API change is PATCH).
3. Run `CI=true pnpm verify` and `pnpm build:desktop`. From #179, also run `pnpm verify:release`.
4. Add the changelog entry, update the finding status to `fixed` with its test, and publish the
   advisory with the fixed version.

## Deprecate and roll back

- The package is not published; rollback today means reverting the change on `main` and releasing
  the next version. Force-pushing shared branches is not a rollback method.
- After publication (O-2), a vulnerable version is deprecated on the registry with a message naming
  the fixed version; unpublishing is not used.
- A store that a faulty version wrote to is not rolled back by downgrading the package: newer
  schemas are refused by older versions. Restore the pre-upgrade backup into a new store
  ([roll back an upgrade](./backup-restore-and-migration.md#roll-back-an-upgrade-downgrade)) or use
  the store-corruption runbook below.

## Runbook: suspected store corruption

1. Stop writers. Open the store read-only (`new SQLiteTraceStore(path, { readOnly: true })`); it
   refuses non-current schemas and does not modify files.
2. Run `verifyIntegrity()` and `verifyBlobs()` and keep the reports
   ([store integrity and append recovery](./store-integrity-and-recovery.md)).
3. For an interrupted append, use `diagnoseAppend` before retrying the same intent; a retried
   intent is idempotent.
4. If integrity is clean, export with `exportTrace()` and keep the archive as evidence.
5. If integrity reports defects, do not repair in place. Import the last clean archive into a new
   store with `importTrace()` ([native trace interchange](./trace-interchange.md)), or restore a
   verified backup into a new path with `restoreTraceStoreBackup` or `shepherd-ts store restore`
   ([restore after loss or corruption](./backup-restore-and-migration.md#restore-after-loss-or-corruption)).
6. Blob orphans are collected only after inspection (`collectBlobOrphans({ mode: "inspect" })`
   first, [blob orphan collection](./blob-orphan-collection.md)).
7. What each kind of damage looks like is classified in
   [fault and fuzz conformance](./fault-and-fuzz-conformance.md#corruption): page damage is
   refused on open or reported by the checks above; a deleted or truncated `-wal` file silently
   returns the store to an earlier commit (F-020), so compare with the last backup manifest's
   record count and cut heads, or with an exported archive, before trusting a store whose log was
   touched. A malformed append-intent batch digest is reported as `append_receipt_mismatch`.

## Runbook: writer crash or kill

1. Reopen the store (writable) in one process; SQLite recovers the write-ahead log. Run
   `verifyIntegrity()`, `verifyBlobs()`, and `maintain()` (inspect) and keep the reports.
2. For every append the crashed writer may have attempted, call `diagnoseAppend` with its intent:
   `committed` needs nothing, `retry_safe` means retry the original request (idempotent), and
   `manual_recovery_required` moves the incident to the store-corruption runbook. The fault suites
   never observed `manual_recovery_required` after a kill
   ([process kill](./fault-and-fuzz-conformance.md#process-kill)).
3. A cut that `readOptionalCut` does not return is retried with the same specification; a blob
   that `readBlob` does not return is put again. Inspect orphans with `collectBlobOrphans()`
   before deleting them.
4. A backup directory without `manifest.json` is an interrupted backup: `verifyTraceStoreBackup`
   refuses it with `manifest-missing`. Delete it and take a new backup.
5. An import target that does not export the archive is pristine after a crash; import again into
   it or into a new path. A crashed import can leave a `.shepherd-import-stage-*` directory
   (`kernel.interchange.staging.directoryPrefix`, owner-only, holding archive blob bytes) beside
   the target store's blob directory; since 2.32.2 it is never left in the shared OS temporary
   directory. Delete it once no import into that store is running (F-019).
6. Telemetry exporters over a durable subscription resume from the acknowledged cursor; expect
   duplicate batches (at-least-once), never gaps.

## Runbook: disk full

1. The failing call throws the underlying error: SQLite `SQLITE_FULL` (`code` `ERR_SQLITE_ERROR`,
   `errcode` 13), `SQLITE_IOERR_WRITE` (778) when a file-size limit is hit, or `ENOSPC`/`EFBIG` from
   the blob layer or backup. Nothing is written by the failed call; the append intent diagnoses
   `retry_safe` ([disk full](./fault-and-fuzz-conformance.md#disk-full)).
2. Do not delete `-wal`, `-shm`, or blob files to make space (see F-020). Free space elsewhere, or
   move the store with a verified backup and restore.
3. After space returns, retry the failed operations with their original requests, then run the
   checks from the crash runbook. Unregistered blob bytes written before the failure are orphans:
   inspect, then collect them.
4. A backup that failed for space has no manifest and is refused by verification; delete it.
   `maintain({ mode: "vacuum" })` needs free space of about the database size.

## Runbook: store growth or slow store operations

1. Measure before changing anything: `shepherd-ts store maintain --store <path>` (mode `inspect`)
   runs `quick_check` and reports page, freelist, and write-ahead-log sizes without modifying the
   store. A `quick_check` defect moves the incident to the store-corruption runbook above.
2. A large write-ahead log is reclaimed with `--mode checkpoint`; a large freelist with
   `--mode vacuum`, after other writers stop (`VACUUM` needs an exclusive lock). Take a verified
   backup first when the store is irreplaceable.
3. Maintenance never changes semantic content; confirm with a native export digest before and after
   (`shepherd-ts store export`) when the evidence matters.
4. Compare timings with the [performance report](./performance-report.md) and run `pnpm check:slo`
   on the reference host class; a regression beyond the budgets is a defect with a bisectable
   benchmark artifact. Budgets exist only for the reference host (macOS arm64 APFS).

## Runbook: lost or unverifiable backup

1. Treat the backup as absent. Do not restore a backup that `verifyTraceStoreBackup` (or
   `shepherd-ts store verify --backup <dir>`) refuses; the refusal reason classifies the defect, and
   `manifest-missing` means the backup is incomplete or was interrupted.
2. If the live store verifies, take a new verified backup immediately with `backupTraceStore` or
   `shepherd-ts store backup`, and a native export if an archive is also wanted.
3. If the live store does not verify and no clean archive exists, the recoverable history is what
   `verifyIntegrity()` reports as intact; record the loss in the incident and do not fabricate
   records to fill it.
4. Backup, restore, downgrade, and interruption procedures are in
   [backup, restore, and migration](./backup-restore-and-migration.md#runbooks).

## Runbook: secret appended to a store

Records are immutable; nothing in the package deletes or rewrites them. The procedure is defined in
[secrets and retention](./secrets-and-retention.md#store-rotation):

1. Rotate the exposed credential with its issuer first.
2. Stop writers and stop producing native exports (`exportTrace()` copies every body).
3. Open the store read-only and run `inspectTraceRetention(store)` from `./operations`. The report
   lists affected record identities, data classes, and secret classes without content.
4. Produce shareable evidence with `exportRedactedTraceArchive(store)` and check it with
   `verifyRedactedTraceArchive`. It is one-way: `importTrace` refuses it.
5. Continue in a new store opened with `secretScanning: "refuse"` so the same mistake is refused
   before any write.
6. Destroy the old database, its `-wal`, `-shm`, and `-journal` files, its blob directory, native
   archives exported from it, and backups under the operator's retention policy.

Writable opens create and tighten SQLite files to the configured owner-only mode (F-003 fixed in
2.27.0); confirm older stores were reopened writable or tighten them manually before sharing a host.

## Post-incident

Record the timeline, root cause, fix commit, and test in the tracker and the findings register. If
the threat model missed the boundary or threat, update it in the same change.
