# Decisions, Open Questions, and Risks

## Adopted planning decisions

### D-001: Spec-first TypeScript implementation

Use one language-neutral protocol and conformance suite. Implement the complete product natively
in TypeScript.

Reason: TypeScript must own deployment, cancellation, streaming, persistence, and type safety.
Upstream Python behavior may inform compatibility tests but is not a runtime dependency.

### D-002: Separate compatibility levels

Track shipped `0.3.0` parity, substrate parity, paper parity, and operational
maturity independently.

Reason: public Shepherd sources explicitly distinguish shipped and planned
surfaces, while upstream `main` is undergoing architectural convergence.

### D-003: Content-addressed semantic records

Canonical semantic identity is independent of storage receipts and local
metadata.

Reason: portable verification and shared-prefix traces require stable identity across stores,
processes, and platforms.

### D-004: SQLite reference store

Use SQLite plus a content-addressed blob directory for the first durable store.

Reason: atomicity, idempotency, portability, introspection, and Node support. Remote stores remain
adapters behind the kernel contract.

### D-005: Runtime schemas are the security surface

TypeScript generics improve ergonomics but never authorize effects. Validated
runtime task and grant descriptors do.

### D-006: Copy carrier is the correctness model

Build and test simple full-copy worlds before optimized copy-on-write backends.

Reason: optimized carriers need a trustworthy differential oracle.

### D-007: Honest reversibility

Every effect declares reversible, compensable, or irreversible semantics.
Replay and UI retain this distinction.

### D-008: Observers and interceptors are different roles

Observers cannot affect execution. Interceptors participate in a durable
decision protocol.

Reason: this is necessary to prove non-perturbing observation.

### D-009: CLI mutation requires exact identity

Read selectors may be ergonomic; settlement and other mutation require exact
identities.

### D-010: Upstream is pinned, not followed implicitly

No build uses moving upstream `main` as a compatibility dependency. Drift is
reviewed through scheduled reports.

### D-011: Distinct npm and CLI identity

Use `@avnionur/shepherd-typescript` for npm and `shepherd-ts` for the CLI.

Do not expose an unscoped `shepherd` compatibility alias without a separate
legal, ecosystem-conflict, and migration review. The README must continue to
identify this as an independent implementation.

### D-012: MIT license with upstream attribution

License original repository work under MIT. Preserve applicable upstream
copyright and license notices for copied or substantially derived material.
Verify paper prose, diagrams, trademarks, logos, and brand assets separately
before reuse.

### D-013: Python is an upstream oracle only

Do not build or publish a native Python implementation. Use the pinned upstream Python package
only in optional compatibility tests where it exposes relevant shipped behavior.

Reason: the project goal is a complete TypeScript implementation. Language-neutral schemas and
fixtures protect protocol stability without expanding the deliverable into a second runtime.

### D-014: One record graph and explicit evidence authority

The content-addressed record graph is the only canonical runtime history. Owner-local ordinals,
causal references, and immutable cuts establish semantic order and causality. Timestamps,
delivery sequences, logs, and materialized run views are non-semantic projections.

Trace records prove runtime decisions and observed evidence; they do not by themselves prove an
external mutation, a provider session, or a managed-world snapshot. Those claims require the
corresponding verified effect, provider, or carrier receipt. Tools remain effect handlers, not a
second event model.

Reason: this preserves portable semantic identity while preventing event-sourcing terminology from
overstating replay, recovery, or world-state guarantees.

### D-016: "1.0" is the L4 maturity milestone, not a package version

"1.0" names the L4 operational-maturity milestone closed by the Phase 11 readiness audit (#29). The
package keeps Semantic Versioning from its current version; reaching the milestone neither resets
nor reserves a version number, and no Phase 11 slice is MAJOR unless it breaks a public contract.

Reason: the package is already past 2.0.0, and a version number reserved for a milestone would
either force a false downgrade or hide a breaking change behind a marketing number.

### D-017: No new dependencies for hardening

Phase 11 hardening (compatibility gates, SBOM, provenance, fuzzing, fault suites, telemetry,
backup) uses Node built-ins and existing development dependencies only. No runtime dependency and
no `allowBuilds` entry is added.

Reason: every dependency enlarges the supply-chain surface this phase is meant to shrink, and the
package has zero runtime dependencies today.

### D-018: Remote storage is interfaces-only for 1.0

For 1.0, remote storage and concurrency are delivered as stable interfaces, conformance kits, and
local reference adapters (#181). `SQLiteTraceStore` remains the only canonical append store, and no
cloud adapter ships.

Reason: D-004 keeps remote stores as adapters; a cloud adapter needs credentials, hosted test
infrastructure, and a failure model the local suites cannot verify.

### D-015: Run control is a fenced durable protocol

Creation, invocation, pause, resume, cancellation, and recovery must be represented by one
normative lifecycle and idempotent control commands. A worker may invoke a provider or effect only
while it holds a durable first-writer claim or lease; recovery fences expired authority before a
new worker proceeds.

Reason: cooperative cancellation alone cannot prevent duplicate provider invocation or stale-worker
side effects under concurrent callers and process failure.

## Decisions required before coding

### Q-004: Supported runtimes

Recommended initial support:

- Node current LTS and the immediately preceding active LTS;
- Linux and macOS;
- Windows via WSL until native permission enforcement has a credible design.

Freeze exact versions during Phase 0.

### Q-005: Native security helper

Landlock and possibly process checkpointing require native components. Choose:

- small Rust helper binaries;
- small C helpers;
- privileged container-only implementation;
- advisory-only Node path plus external enforcement service.

Recommended: narrowly scoped Rust helpers with versioned JSON/CBOR IPC,
prebuilt signed binaries, and source builds in CI. This is a separate review
boundary.

### Q-006: Canonical encoding

Confirm RFC 8785 JSON plus SHA-256, or select canonical CBOR. JSON offers easier
inspection and fixture maintenance; CBOR offers richer native primitives.

Recommended: canonical JSON for v1 control records, content-addressed blobs for
binary data.

### Q-007: Public API compatibility

Decide whether TypeScript mirrors Python names or provides only semantic
compatibility with idiomatic builders. Recommended: idiomatic TypeScript facade
over a protocol-compatible core, with a migration mapping document.

## Major risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Upstream architecture continues to change | Rework and false parity claims | Pin revisions; version protocol; maintain drift report |
| “Full” scope becomes unbounded | Project never reaches useful release | Capability levels and phase exit gates |
| TypeScript type erasure weakens grants | Security mismatch | Runtime schemas/descriptors are authoritative |
| Node cannot provide syscall jail directly | Advisory behavior mistaken for enforcement | Native helper/container adapter; honest placement metadata |
| Atomic agent + process + filesystem fork is platform-specific | Paper parity blocked | Adapter contract; distinguish atomic vs reconstructive forks |
| Protocol serialization changes silently | Trace IDs incompatible | Canonical vectors before runtime work; compatibility CI |
| SQLite behavior differs across Node/platform versions | Recovery bugs | Transaction law suite and platform kill tests |
| Git semantics leak into trace semantics | Fragile model and poor portability | Typed trace kernel independent of Git; carrier abstraction |
| Symlink/path alias escapes grants | Sandbox breakout | Canonical roots, OS enforcement, adversarial filesystem tests |
| Live interception races materialization | Unsafe actions land before denial | Durable intent, explicit decision lease, fail policy |
| Irreversible effects replay twice | External harm | Reversibility tier, frontier, approval, idempotency keys |
| Provider nondeterminism invalidates “replay” | Misleading correctness claims | Verify exact prefix; label suffix re-execution; deterministic fixtures |
| Secrets enter immutable traces | Persistent exposure | Delivered in 2.27.0 (#180): opt-in `secretScanning: "refuse"` rejects configured secret classes before any write; data classes, one-way redacted export and verifier, retention inspection, rotation runbook, and owner-only SQLite files ([secrets and retention](../docs/secrets-and-retention.md)). Secret references and encrypted stores remain unimplemented; scanning is off by default and pattern-based (F-001 accepted residual) |
| Dynamic task synthesis executes untrusted code | Code execution vulnerability | Schema/policy validation and isolated execution boundary |
| Optimized filesystem backend corrupts state | Data loss | Copy backend oracle; verify before settlement; recovery receipts |
| Concurrent settlement splits ownership | Duplicate application | Transactional CAS and exact output identity |
| Concurrent workers cross one invocation boundary | Duplicate cost or external action | First-writer claim, lease fencing, idempotent control commands, cross-connection race tests |
| Projection/event terminology implies unproven state | False replay or audit claims | One canonical record graph; receipt-specific evidence authority and explicit reconstructive status |
| Checkpoint cites unavailable constituent state | Unsafe resume or misleading branch | Coupled checkpoint descriptor with verified trace, world, and provider/process receipts |
| Native binary supply chain | Compromise/install friction | Signed artifacts, SBOM, reproducible builds, source fallback |
| Name/branding conflicts | Publishing or user confusion | Resolve naming before package publication |
| Upstream benchmark claims are inherited | Credibility loss | Reproduce locally and scope all reported numbers |

## Security boundaries to document

The system can only reverse state it owns:

- managed workspace files and declared carrier state;
- processes captured by a supported checkpoint backend;
- provider context represented in a verified checkpoint;
- compensable external effects with correct handlers.

It cannot inherently reverse:

- host-global package/cache changes outside managed roots;
- arbitrary network or cloud mutations;
- sent messages or emails;
- consumed model/API cost;
- credentials exposed to an executed process;
- unsupported kernel/process state.

Every run must state its actual boundary.

## Upstream drift procedure

On a schedule:

1. fetch upstream tags and selected `main`;
2. compare docs, CLI JSON/help, schemas, package layout, and roadmap;
3. classify changes as bug fix, compatible addition, semantic break, or
   research-only;
4. add/update compatibility fixtures;
5. assign a target protocol version;
6. publish the drift report without auto-merging behavior.

## Stop conditions

Pause a phase rather than weakening guarantees when:

- canonical identity cannot be reproduced across supported Node versions and platforms;
- a jail cannot prove fail-closed behavior;
- a settlement transition can produce two winners;
- replay cannot distinguish irreversible effects;
- an optimized carrier disagrees with the reference model;
- protocol migration can orphan or silently reinterpret records;
- a control command or recovered worker can cross an invocation/effect boundary without a valid
  durable claim;
- a checkpoint or replay claim cannot verify every constituent it represents;
- the project name or licensing posture remains unresolved at publication time.
