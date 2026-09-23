# Testing, Verification, and Release Plan

## Test strategy

The testing pyramid is centered on shared laws and behavioral conformance:

1. schema and canonicalization vectors;
2. pure state-machine and property tests;
3. package unit tests;
4. upstream-oracle and protocol conformance;
5. storage and filesystem integration;
6. platform security integration;
7. provider contract integration;
8. packaged end-to-end examples;
9. recovery, fuzz, and performance suites.

Unit test count is not a parity signal. The shared conformance suite is.

## Conformance Test Kit

The TCK is stored under `test/fixtures` and runnable against:

- TypeScript in-process API;
- TypeScript CLI JSON;
- optionally, pinned upstream `0.3.0` for compatible rows.

Fixture groups:

- canonical values and hashes;
- record append/read;
- cuts, slices, and projections;
- task descriptors and grants;
- effect lifecycle;
- run outcomes;
- workspace changesets;
- settlement transitions;
- permissions and placement resolution;
- CLI identity selection;
- export/import;
- recovery and repair;
- scope algebra;
- replay divergence;
- proof-envelope classification and sidecar validation;
- research-application protocol and artifact manifests.

Each fixture declares protocol version, required capability level, platforms,
and expected structured error code.

## Property and model-based testing

### Trace properties

- canonicalization is deterministic;
- encode/decode preserves semantics;
- equal semantics imply equal IDs;
- different covered semantics change IDs;
- append is atomic;
- append intent is idempotent;
- owner ordinals never repeat;
- every non-root parent resolves;
- a slice never invents a record;
- projections are deterministic.

### Settlement properties

- at most one terminal settlement;
- exact identity is required for mutation;
- reads do not mutate;
- selection requires unchanged basis;
- apply accepts path-disjoint changes only;
- discard preserves the target workspace;
- retry after lost acknowledgment returns the original decision;
- recovery cannot settle a different output accidentally.

### Scope properties

- fork initially equals parent;
- child mutation does not change parent;
- discard(child) leaves parent unchanged;
- merge of a valid child produces the reference-model result;
- sibling order does not matter when changes are disjoint;
- nested authority is no stronger than parent authority;
- failed fork publishes no usable child.

### Effect properties

- every outcome has exactly one prior intent;
- denied intent has no materialized success outcome;
- passive observation is trace-neutral;
- irreversible effect is never labeled reversible;
- compensation is idempotent or records why it is unsafe to retry;
- interceptor decisions are totally ordered.

### Formal-claim properties

- unsupported or incomplete traces never receive a stronger envelope by inference;
- profile and strength are accepted only with their configured evidence;
- content-addressed sidecars and pinned theorem metadata fail on drift;
- TypeScript conformance is not reported as a formal proof of excluded runtime behavior.

Property and fuzz tests use a seeded, hand-rolled harness rather than `fast-check`: decision D-017
adds no dependencies for hardening, and the seeded PRNG (`seededRandom`, mulberry32) drives the
scope reference model. Delivered in 2.32.0 (#185): the PRNG moved to `test/support/prng.ts`, the
fuzz harness lives in `test/fuzz/` with `config/hardening-suites.config.json`, failures print the
target, case index, and input, and minimized counterexamples are kept in
`test/fixtures/fuzz-corpus/` ([fault and fuzz conformance](../docs/fault-and-fuzz-conformance.md)).

## Differential testing

For every stable fixture:

1. run through the TypeScript public seam and export canonical records;
2. reopen and import the export in a fresh TypeScript process;
3. normalize explicitly non-semantic receipts;
4. compare semantic records, IDs, transitions, and error codes;
5. where an upstream-compatible behavior exists, compare it with the pinned Python oracle.

For `0.3.0` compatibility rows, also execute the pinned upstream oracle and
compare documented semantics. Do not compare unstable text formatting where
structured output is available.

## Filesystem matrix

Test:

- empty directories and existing Git repositories;
- adopted Git HEAD and dirty worktrees;
- files with spaces, Unicode, and long names;
- binary and sparse files;
- executable-bit changes;
- symlinks, broken symlinks, and path escape attempts;
- add/edit/delete and delete/recreate;
- case-sensitive and case-insensitive filesystems;
- concurrent external workspace changes;
- control-plane tampering;
- disk full, permission denied, and interrupted writes.

Optimized carriers must pass the copy carrier's full contract.

## Security testing

Threats:

- path traversal and symlink escape;
- binding overlap or aliasing;
- permission amplification;
- command/argument injection into native helpers;
- malicious model/tool payloads;
- untrusted task synthesis;
- secret persistence and export;
- sandbox downgrade;
- trace tampering;
- replay of irreversible effects;
- race conditions in settlement and handoff;
- denial of service through unbounded events or blobs.

Gates:

- explicit `jail` fails closed;
- `auto` fallback is recorded;
- read-only roots reject writes at the OS boundary on supported platforms;
- helper protocols accept structured data, not shell fragments;
- generated code executes only inside a declared sandbox;
- exports redact configured secret classes;
- integrity verification detects modified canonical records;
- security-sensitive errors are stable but do not leak secrets.

## Recovery testing

Inject process termination:

- before and after blob write/rename;
- before and after append transaction commit;
- during world materialization;
- before and after settlement compare-and-swap;
- during child fork/publish/handoff;
- during compensation;
- during trace export/import;
- while a live interceptor owns a decision lease.

After restart, the system must classify state as complete, safely retryable,
abandoned, or manual-recovery-required. It must never guess success.

Status (2.32.1, #186; [fault and fuzz conformance](../docs/fault-and-fuzz-conformance.md#faults-and-soak)):

| Injection point | Evidence |
| --- | --- |
| Before and after blob write/rename | `test/blob/crash.test.ts`; seeded `SIGKILL` during `putBlob` in `test/faults/process-kill.test.ts` and the soak |
| Before and after append transaction commit | `test/faults/process-kill.test.ts` (`append`, `cut`, `vacuum` loops), `test/store/recovery.test.ts` |
| During world materialization | `test/workspace/retained-world-apply.test.ts` (carrier interruption after planned path writes), `test/workspace/platform-fault-conformance.test.ts` |
| Before and after settlement compare-and-swap | `test/workspace/retained-world-apply.test.ts` (interrupted settlement citation repaired after reopen) |
| During child fork/publish/handoff | `test/delegation/delegation-crash.test.ts` |
| During compensation | `test/store/orphan-operation-repair.test.ts` (killed repair preparation) |
| During trace export/import | Seeded `SIGKILL` during `importTrace` (`test/faults/process-kill.test.ts`); export is read-only |
| While a live interceptor owns a decision lease | `test/supervision/supervision-crash.test.ts` |
| During backup and vacuum (added) | `test/faults/process-kill.test.ts` (`backup`, `vacuum`) |
| Disk full and file-size limit (added) | `test/faults/disk-full.test.ts`; opt-in `pnpm test:faults:volume` |
| At-rest corruption (added) | `test/faults/corruption.test.ts` |
| Long duration (added) | Bounded soak in `pnpm test`; recorded `pnpm test:soak` run |

Operating-system crash and power loss are not simulated; only process termination is.

## Provider testing

Every provider adapter passes a fake-server or fake-CLI contract:

- request mapping;
- streaming order;
- tool-call intent/outcome correlation;
- cancellation;
- timeout;
- rate limiting and retry classification;
- usage;
- raw response citation;
- secret redaction;
- provider/session checkpoint support;
- cache identity where offered.

Live tests are opt-in, budget-limited, and never required for the offline core
suite. The static provider is required everywhere.

## Performance plan

Benchmarks:

- append throughput and latency;
- trace query/materialization;
- fork/revert latency by backend;
- disk/RAM per branch;
- scaling by base world size;
- scaling by changed suffix size;
- K-way branch concurrency;
- settlement on small and large changesets;
- replay cold/warm provider behavior;
- observer/interceptor overhead;
- startup and CLI latency;
- trajectory-compression suffix cost and bounded best-of-N controls;

Report median, p95, variance, environment, warmup, and sample count. Preserve raw
results as versioned artifacts.

Initial performance budgets are set only after a correct reference
implementation is measured. Upstream numbers are comparison context, not this
project's SLOs.

## CI matrix

Per pull request:

- formatting/lint;
- TypeScript typecheck and API checks;
- unit and property tests;
- shared conformance;
- export/import compatibility;
- SQLite migration tests;
- packaged npm smoke;
- dependency and license scan.

Platform lanes:

- Linux current LTS Node + minimum Node;
- macOS current + minimum supported;
- privileged Linux jail/overlay tests;
- macOS Seatbelt/clonefile tests;
- Windows or WSL detection/compatibility according to final policy.

Scheduled:

- live provider adapters;
- long-running recovery/fault tests;
- fuzzers;
- large trace/storage tests;
- benchmark trend detection;
- upstream drift report.

## Documentation verification

- generate CLI reference from packaged binaries;
- compile/run every code example;
- test the TypeScript quickstart offline;
- validate every claimed capability against the parity manifest;
- stamp docs with protocol/package version;
- reject broken internal/external links;
- maintain “shipped” and “planned” labels.
- validate the section-by-section paper coverage map against the pinned paper revision.

## Release train

Release numbers follow Semantic Versioning from the current package version; capability milestones
do not reserve version numbers in advance. Promote releases in this order:

1. complete the L0 trace-kernel developer preview;
2. add deterministic tasks, effects, and runs;
3. deliver retained workspace settlement alpha;
4. reach documented upstream `0.3.0` compatibility beta;
5. stabilize TypeScript SDK ergonomics;
6. add the scope substrate;
7. add live observation and interception;
8. add rewind and replay;
9. preview task-as-value meta-agents;
10. release an audited, migration-capable L4 core.

Every release states its compatibility level separately. A project version matching an upstream
version does not imply compatibility by number alone.

## Release gates

Every release:

- all required parity rows are green;
- protocol compatibility report generated;
- npm tarballs tested after packing;
- changelog and migration guide present;
- SBOM and provenance generated;
- license and attribution verified;
- security scan clean at the approved threshold;
- docs deployed from the same tag;
- rollback/yank procedure documented.

Stable release additionally:

- no silent protocol changes;
- downgrade behavior known;
- previous stable store migrates forward in CI;
- supported prior client can read compatible records;
- recovery drill passes;
- public performance report exists.

### Enforced gates (from 2.26.0, #179)

Hosted CI is disabled (2026-09-23 enablement attempts were blocked by an account billing limit),
and by owner decision of 2026-09-23 (#199, D-019) it stays disabled for 1.0: these local commands,
run on the macOS reference host and in the local Docker Linux lane, are the 1.0 verification
substitute:

| Gate | Command | Where |
| --- | --- | --- |
| Protocol and API compatibility, deprecation window, no silent protocol changes | `pnpm check:compatibility` | `pnpm verify`, `pnpm verify:serial` |
| Lockfile SBOM current | `pnpm check:sbom` | `pnpm verify`, `pnpm verify:serial` |
| npm tarball tested after packing; packed file set equals the literal, anchored `files` allowlist for every npm version (from 2.33.3, #191, F-032) | `pnpm test:package-cli` | `pnpm verify` |
| Downgrade behavior known; every historical store schema migrates forward; recovery (backup, restore, interruption) drills pass (from 2.29.0, #182) | `test/operations/migration-drills.test.ts`, `test/operations/backup-restore.test.ts` | `pnpm test` in `pnpm verify` |
| No full table scan on hot-path SQL; bounded scale tier; maintenance preserves exports (from 2.30.0, #183) | `test/store/query-plans.test.ts`, `test/store/scale.test.ts`, `test/store/maintenance.test.ts` | `pnpm test` in `pnpm verify` |
| Kill/restart, disk-full, and corruption outcomes classified complete, retryable, or refused; bounded soak (from 2.32.1, #186) | `test/faults/*.test.ts` | `pnpm test` in `pnpm verify` |
| Long-duration soak and real-volume ENOSPC (from 2.32.1, #186; Linux ext4 loop-image variant from 2.34.0, #199, root and loop devices required) | `pnpm test:soak --duration <s>`, `pnpm test:faults:volume` | On demand (outside `verify`) |
| Public performance report; kernel SLOs on the reference host class (from 2.30.0, #183) and the `linux-arm64-overlayfs-container` class (from 2.34.0, #199) | `pnpm check:slo` ([performance report](../docs/performance-report.md)) | `pnpm verify:release` |
| Two clean builds and packs byte-identical | `pnpm release:reproducible-build` | `pnpm verify:release` |
| SBOM, unsigned provenance, release manifest | `pnpm release:manifest` | `pnpm verify:release` |

Signed provenance and publication are waived for 1.0 (1.0 is a private, unpublished source release)
and hosted security scanning (CodeQL) is waived while the repository is private, by owner decision
of 2026-09-23 (O-2, O-3 in the [production hardening contract](./production-hardening-contract.md),
#199); license scanning and docs deployment remain open.
The compatibility report is the gate's output; the classified change log is
`spec/compatibility/protocol-changes.json`.
