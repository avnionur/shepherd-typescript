# Secrets and retention

Status: normative from 2.27.0 (Phase 11 slice 3, #180). Configuration: the `retention` section of
[`protocol.config.json`](../protocol.config.json), read by
[`src/protocol/config-retention.ts`](../src/protocol/config-retention.ts). Implementation:
[`src/retention/`](../src/retention) (`policy.ts`, `secret-scan.ts`, `redacted-archive.ts`,
`retention-report.ts`, `errors.ts`), store scanning in
[`src/store/secret-scanning.ts`](../src/store/secret-scanning.ts) and
[`src/store/append.ts`](../src/store/append.ts), and database file modes in
[`src/store/file-mode.ts`](../src/store/file-mode.ts). Public entry:
[`./operations`](./package-exports.md) and the root. Schemas:
[`redacted-trace-archive-v1`](../spec/schemas/redacted-trace-archive-v1.schema.json) and
[`retention-report-v1`](../spec/schemas/retention-report-v1.schema.json). Tests:
[`test/retention/`](../test/retention) and [`test/store/file-mode.test.ts`](../test/store/file-mode.test.ts).

## Records are immutable

Canonical records are content-addressed and never deleted, rewritten, or redacted in place. Once a
body is appended, it stays in the store, in every export of the store, and in every backup of the
database files. Retention in this package therefore means three things only:

1. **Classification**: every record has a data class derived from its schema.
2. **Redacted export**: a one-way archive that keeps record identities and replaces bodies the
   policy does not allow to leave the store.
3. **Store rotation**: the operator procedure below. There is no in-place deletion and no purge
   API; `store.collectBlobOrphans({ mode: "delete" })` removes only unreferenced blob files and is
   not a retention mechanism.

The only way to keep a secret out of a trace is to keep it out of the append. Provider credentials
remain caller-held: a [live provider](./live-providers.md#errors-and-credentials) reads its
credential from the caller definition or the configured environment variable, holds it only in its
closure, and redacts it from every error message before a failure can be retained; a secret-scan
test proves no store file contains it.

## Data classes and dispositions

The configured data classes are `checkpoint`, `context`, `general`, `memory-adapter`, and
`provider-citation` (`RETENTION_DATA_CLASSES`). `retention.schemaFamilies` maps every configured
schema family to a class. A family is any object under a configured family key (`schemas` or
`traceSchemas`) anywhere in `protocol.config.json`; a mapping may also name one schema, and the
more specific path wins. The reader refuses a configuration that leaves a family unmapped, names a
path that does not resolve to schema identifiers, or gives one schema identifier two classes from
unrelated paths. `test/retention/retention-policy.test.ts` walks the configuration independently
and asserts the same gate.

A schema identifier no family names gets `defaultDataClass` (`general`). Callers classify their
own schemas, such as memory-adapter records, with `schemaDataClasses` in
`RetentionClassificationOptions`; a configured protocol schema cannot be reclassified.
`classifyTraceSchema(schemaRef, options?)` returns the class and disposition;
`readRetentionPolicy()` returns the frozen policy without detector patterns.

Each class has an export disposition (`RETENTION_EXPORT_DISPOSITIONS`):

| Disposition | Redacted export of the body | Default classes |
| --- | --- | --- |
| `include` | Verbatim when no detector matches; otherwise replaced by a digest-bearing marker | `checkpoint`, `general` |
| `redact` | Always replaced by `{ redacted: true, data_class, secret_classes, body_digest }` | `context`, `provider-citation` |
| `omit-body` | Replaced by a marker with `secret_classes: []` and `body_digest: null`, disclosing nothing about the body | `memory-adapter` |

`body_digest` is the configured retention digest of the canonical body. It lets a holder of the
original body confirm a match; it does not reveal the body.

[Retained provider conversation checkpoints](./provider-conversation-checkpoints.md) opt into
storing complete system/message/tool prefixes as existing supervision-context records. They are
redacted by current and 13.5.0 exporters, including after native import. Native archives and backups
retain the complete prefix; credentials are excluded from factory configuration identity.

[Retained device worlds](./retained-device-layers.md) keep full user file trees outside the trace
store. Their journals retain paths and content identities; native trace export does not contain
those external bytes. Explicit owned cleanup leaves immutable journal history, and trace secret
scanning does not inspect external world-file contents.

## Secret detection

`retention.secretClasses` holds named regular expressions; patterns live only in configuration.
The shipped detectors cover PEM private-key headers, bearer tokens, cloud and code-host access-key
prefixes, provider API-key prefixes, and chat-platform tokens. The reader rejects invalid
expressions, flags other than Unicode mode with `i`, `m`, or `s`, duplicate names, and patterns that
match the empty string.

`scanSemanticValueForSecrets(value)` canonicalizes the value and matches every string value and
object key against every detector. A finding is `{ secret_class, path, location, digest }`: the
class name, an RFC 6901 JSON Pointer, whether a value or a key matched, and a keyed digest of the
matched text. Since 2.32.2 (F-025) the digest is an HMAC under the configured retention algorithm
with a random key created once per process, prefixed `retention.scanning.findingDigestPrefix`
(`hmac-sha256:`): equal matches share a digest within one process, so findings deduplicate and
correlate there, but nobody who sees a finding (for example in an error log) can recompute it to
confirm a guessed secret. Earlier releases used the unkeyed retention digest, which let a
low-entropy secret be confirmed offline. The matched text is never returned, stored, logged, or
put in an error. The redacted-archive and telemetry `body_digest` stays the unkeyed retention
digest of the whole canonical body, because a holder must be able to compare it with the original
store; the threat model records that residual. A key
match is reported at the pointer of the owning object and its value is not descended into, so no
reported pointer contains matched text. Findings are unique, in canonical key order, and bounded by
`retention.limits.maxFindings`; `truncated` reports overflow.

Detection is pattern-based and incomplete. A credential in an unrecognized format, split across
fields, or encoded is not detected. Envelopes, owner identifiers, append-intent identifiers, cut
identifiers other than inside record bodies, and blob bytes are not scanned.

## Refusing secrets at append time

`new SQLiteTraceStore(path, { secretScanning: "refuse" })` scans every record body of every append
before anything is written: the public `append`, and every append the store performs inside its own
transactions (cuts, scopes, supervision, replay, delegation, durable runs, orphan repair). An import
into a refusing store scans every archived body before staging. A match raises
`TraceSecretDetectedError` (`TRACE_SECRET_DETECTED`, a `TraceStoreError`) whose `findings` use
pointers such as `/batch/groups/0/records/1/body/headers/authorization`. Its message lists the
count, classes, and pointers, never matched text; the CLI prints only that message in human mode
and only the configured code in `--json` mode (see [public errors](./public-errors.md)).

A refusal writes nothing, so the append intent stays unused (`diagnoseAppend` reports
`retry_safe`) and a corrected retry with the same intent succeeds. Replaying an intent that was
committed with a secret-bearing body while scanning was off is refused once the store scans; the
committed records stay readable. `store.secretScanning` reports the mode.

The default is `"off"` (`retention.scanning.defaultMode`): no scan runs and behavior is unchanged
from 2.26.0. Read-only handles accept either mode and never append.

## Redacted archives

`exportRedactedTraceArchive(store, options?)` builds on `store.exportTrace()`, so it covers one
integrity-verified snapshot and refuses a store that fails verification. The archive
(`shepherd.trace.redacted-archive` version 1) keeps every record envelope and `record_id`, owner
views, append intents, and cuts; each record carries its `data_class` and applied `disposition`
(`include`, or `redact` when a detector forced it); blobs are listed by identity and length without
content. Output is deterministic canonical JSON.

`verifyRedactedTraceArchive(json, options?)` checks the closed structure and versions, strict
record-identity order, and the policy: a verbatim record must have the configured `include`
disposition, re-derive its `record_id` from envelope and body, and contain no detected secret; a
marker must match its record's class, list only configured secret classes in sorted order, carry a
well-formed digest unless omitted, and agree with the configured disposition. Views and cuts must
cite archived records. It returns frozen counts and raises `RedactedTraceArchiveError`
(`REDACTED_TRACE_ARCHIVE_ERROR`, a `TypeError`) otherwise. Pass the same `schemaDataClasses` used
at export.

Redaction is one-way. `importTrace` (through the internal archive decoder) refuses any text in the
redacted format with `RedactedTraceArchiveError` before any other check, whatever the scanning
mode, and leaves the target unchanged. A redacted archive is an evidence and sharing artifact, not a
backup.

## Retention inspection

`inspectTraceRetention(store, options?)` reads every retained record and returns a
`retention-report-v1` object: record counts per data class with their dispositions, records whose
body matches a detector per class, finding and record counts per secret class, and up to
`retention.limits.maxReportedRecords` secret-bearing record identities with their classes. It
contains no body content or matched text, writes nothing, and works on read-only handles.

## Store rotation

When a store holds data that must not persist (for example a leaked credential, see the
[incident runbook](./incident-response.md#runbook-secret-appended-to-a-store)):

1. Rotate the exposed credential with its issuer. Nothing in the trace can un-leak it.
2. Stop writers. Open the store read-only and run `inspectTraceRetention` to find the affected
   records and classes.
3. Produce the retained evidence with `exportRedactedTraceArchive` and check it with
   `verifyRedactedTraceArchive`.
4. Open a new store with `secretScanning: "refuse"` for continued work. The redacted archive is
   never imported; history that must stay machine-replayable has to be re-created by the owning
   workflow in the new store.
5. Destroy the old database, its WAL, SHM, and journal files, its blob directory, every native
   archive exported from it, and every backup, under the operator's own retention policy. The
   package provides no deletion or purge API for this step.

## Store file modes

`retention.storeFiles.mode` (`0600`) is the owner-only mode for SQLite files; the reader rejects any
mode with group or other bits or without owner read and write. Opening a writable
`SQLiteTraceStore` or `SQLiteTaskRegistry` on a file path creates a missing database file with that
mode before SQLite opens it; SQLite's Unix VFS creates the WAL, SHM, and rollback journal with the
database file's permission bits, so they are owner-only too. An existing database and its
`-journal`, `-shm`, and `-wal` sidecars owned by the current user are tightened, never loosened,
before opening. Read-only opens never change modes.

Not covered:

- files owned by another user are left unchanged;
- a WAL or SHM file that another program creates while an existing database is still loose, before
  this package's next writable open, keeps that mode until the next writable open tightens it;
- read-only opens, `:memory:` stores, and import staging databases change nothing;
- archives, redacted archives, and reports written by callers take the caller's mode.

Blob directories remain `0700` and blob files `0600` ([blob storage](./blob-storage.md)). Tests:
`test/store/file-mode.test.ts` creates stores and registries under umask `022` and asserts `0600`
for the database, WAL, and SHM, tightening of `0644` files on a writable open, and unchanged modes
on read-only opens.

## Non-claims

- Detection is pattern-based and incomplete; scanning is off by default.
- Nothing is removed from an existing store; retention is classification, redacted export, and
  rotation.
- Blob bytes, envelopes, and identifiers are not scanned; blob purge is not provided.
- CLI retained-output views print stored content verbatim from the caller's own store.
