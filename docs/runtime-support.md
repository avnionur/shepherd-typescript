# Node runtime support

Version 2.0.0 supports **Node >=24.12.0 <25**. Node 24.0–24.11, other majors and prerelease
versions are not supported. This owner-approved narrowing is a breaking change; it does not
change public data formats or require a database migration. Additional majors require a new
support decision and conformance evidence. Package 2.0.0 is not a production-readiness milestone.

## Policy and refusal

[`runtime.config.json`](https://github.com/avnionur/shepherd-typescript/blob/main/runtime.config.json) owns the bounded Node range. The package engine
field must match it; source tests and installed conformance reject drift. The
[`policy loader`](https://github.com/avnionur/shepherd-typescript/blob/main/src/runtime/policy.ts) validates and freezes the range and checks the running
version during Node runtime initialization, before any public operation can create storage.
The package manager engine field is advisory; the runtime check enforces the policy even when a
consumer ignores package-manager warnings.

Unsupported Node runtime imports throw an ordinary bootstrap `Error` with the actual and required
versions. The CLI exits nonzero before command dispatch, including `--help` and `--json`; this
pre-initialization error is not a protocol-versioned CLI JSON envelope. Supported-runtime CLI
error/redaction contracts are unchanged. Missing/malformed policy assets also fail closed.
Very old runtimes unable to parse/import the package may produce their own loader error first.

Node 24.12.0 itself emits a SQLite `ExperimentalWarning` on stderr. This is distinct from CLI
output and can accompany successful commands, including JSON commands. CLI byte-comparison tests
use Node's `--disable-warning=ExperimentalWarning` flag while retaining their exact assertions;
installed boundary checks run with normal warning behavior. Applications requiring clean stderr
may use that Node flag explicitly. The package does not suppress host warnings globally.

The type-only `/read` entry is exempt: its empty ESM module loads neither policy nor Node builtins.
It provides no executable runtime API. All other runtime entries reach the version check without
adding SQLite loads to canonical/effects/providers/runs.

## SQLite capability proof

Before trace-store blob-directory setup, task-registry opening, or archive staging-directory
creation, [`SQLite support checks`](https://github.com/avnionur/shepherd-typescript/blob/main/src/runtime/sqlite.ts) require the defensive API and open an
isolated in-memory database using the configured required defensive setting. A schema-version
write must remain a no-op; otherwise construction fails before persistent setup. The probe closes
in all cases. Each actual connection still receives its existing required defensive/timeout
configuration. No safety setting is disabled to accommodate old runtimes.

This verifies a concrete required database behavior, not just a property in a configuration
object. It is not a defense against a hostile process rewriting Node builtins or package files.

## API floor inventory

| Used capability | Floor relevant to this package |
| --- | --- |
| Built-in synchronous SQLite and read-only/foreign-key options | Available before Node 24 |
| SQLite timeout | Node 24.0.0 |
| Explicit resource management in shipped native JS/TS examples | Node 24.0.0 |
| Synchronous module hooks used by installed-loading verification | Available by Node 24.0.0 |
| SQLite defensive option/API | Node 24.12.0 (25.1.0 on the excluded odd-major line) |
| Existing filesystem, crypto, process, buffer and path APIs | Covered by the minimum-runtime conformance run; no newer floor was identified |

Primary references: [Node SQLite history](https://nodejs.org/api/sqlite.html#new-databasesyncpath-options),
[Node 24 release features](https://nodejs.org/en/blog/release/v24.0.0), and
[module hooks](https://nodejs.org/api/module.html#moduleregisterhooksoptions).

## Verification

[`test/runtime-policy.test.ts`](https://github.com/avnionur/shepherd-typescript/blob/main/test/runtime-policy.test.ts) covers range parsing, metadata
agreement, prerelease/other-major refusal, SQLite negative controls, ineffective/missing API
fault injection, and refusal before store/registry files or blob directories are created.

The installed [boundary verifier](https://github.com/avnionur/shepherd-typescript/blob/main/tooling/testing/runtime-boundaries.ts) uses
[`config/runtime-verification.config.json`](https://github.com/avnionur/shepherd-typescript/blob/main/config/runtime-verification.config.json). Ordinary package
conformance exercises the current process runtime. The explicit boundary command additionally
requires exact minimum and unsupported executables; missing or wrong binaries fail the command:

```sh
SHEPHERD_MINIMUM_NODE=/absolute/path/to/node-24.12.0 \
SHEPHERD_UNSUPPORTED_NODE=/absolute/path/to/node-24.11.1 \
pnpm test:runtime-boundaries
```

The verifier uses a freshly installed tarball for trace append/read/archive/reopen/import,
task registration/read-only reopen, and CLI initialization. Unsupported attempts must fail with
the runtime diagnostic and leave their destination directories empty. No runtime is downloaded
automatically. POSIX environment syntax is shown; other shells should set the same variables.

The supported minimum and current host must also pass ordinary full verification and production
build. Hosted workflows remain disabled; local results do not establish all-OS or future-major
support. Recorded release results belong in the [Phase 5 audit](https://github.com/avnionur/shepherd-typescript/blob/main/.plan/phase-5-exit-audit.md).
Implementation, test and audit links require repository access; these sources are not shipped as
public deep imports.

## Distribution

The build copies the policy beside the existing runtime assets in `dist/runtime.config.json`.
Installed consumers need that file. The tested two-level Rollup layout additionally places
`runtime.config.json` at the bundle root; missing/malformed/restored policy cases are tested along
with the existing protocol/error assets. Arbitrary bundle layouts remain outside that evidence.
