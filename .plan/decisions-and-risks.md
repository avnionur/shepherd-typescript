# Decisions, Open Questions, and Risks

## Adopted planning decisions

### D-001: Spec-first, dual native implementations

Use one language-neutral protocol and conformance suite. Implement TypeScript
and Python natively.

Reason: a subprocess wrapper would not provide a real TypeScript runtime and
would make deployment, cancellation, streaming, and type safety depend on
Python.

### D-002: Separate compatibility levels

Track shipped `0.3.0` parity, substrate parity, paper parity, and operational
maturity independently.

Reason: public Shepherd sources explicitly distinguish shipped and planned
surfaces, while upstream `main` is undergoing architectural convergence.

### D-003: Content-addressed semantic records

Canonical semantic identity is independent of storage receipts and local
metadata.

Reason: cross-language verification and shared-prefix traces require stable
identity across stores and platforms.

### D-004: SQLite reference store

Use SQLite plus a content-addressed blob directory for the first durable store.

Reason: atomicity, idempotency, portability, introspection, and good Node/Python
support. Remote stores remain adapters behind the kernel contract.

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

## Decisions required before coding

### Q-001: Project and package names

Resolve:

- npm scope and package names;
- Python distribution/import name;
- CLI executable name;
- whether a `shepherd` compatibility alias is legally and operationally
  appropriate;
- README wording that clearly identifies the project as an independent
  implementation unless upstream authorizes otherwise.

Recommended default: use a distinct project name and offer Shepherd protocol/API
compatibility as a mode.

### Q-002: Python scope

Choose one:

1. native reimplementation of the planned shared protocol;
2. maintained compatibility fork/adapter of upstream Python;
3. Python is only an oracle during TypeScript development.

This plan assumes option 1 because the request asks for both languages and
cross-language identity. It is the highest-effort option.

### Q-003: License

Upstream is MIT. Decide whether this project is MIT and preserve upstream
copyright/license notices for copied or substantially derived material.

Do not copy paper prose, diagrams, brand assets, or documentation wholesale
merely because the code is MIT; verify the applicable license for each asset.

### Q-004: Supported runtimes

Recommended initial support:

- Node current LTS and the immediately preceding active LTS;
- Python 3.11+ to align with upstream;
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
| Cross-language serialization diverges | Trace IDs incompatible | Canonical vectors before runtime work; differential CI |
| SQLite drivers differ in transaction behavior | Recovery bugs | Transaction law suite and kill tests in both languages |
| Git semantics leak into trace semantics | Fragile model and poor portability | Typed trace kernel independent of Git; carrier abstraction |
| Symlink/path alias escapes grants | Sandbox breakout | Canonical roots, OS enforcement, adversarial filesystem tests |
| Live interception races materialization | Unsafe actions land before denial | Durable intent, explicit decision lease, fail policy |
| Irreversible effects replay twice | External harm | Reversibility tier, frontier, approval, idempotency keys |
| Provider nondeterminism invalidates “replay” | Misleading correctness claims | Verify exact prefix; label suffix re-execution; deterministic fixtures |
| Secrets enter immutable traces | Persistent exposure | Secret references, redaction, encrypted stores, export policy |
| Dynamic task synthesis executes untrusted code | Code execution vulnerability | Schema/policy validation and isolated execution boundary |
| Optimized filesystem backend corrupts state | Data loss | Copy backend oracle; verify before settlement; recovery receipts |
| Concurrent settlement splits ownership | Duplicate application | Transactional CAS and exact output identity |
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

- canonical cross-language identity cannot be reproduced;
- a jail cannot prove fail-closed behavior;
- a settlement transition can produce two winners;
- replay cannot distinguish irreversible effects;
- an optimized carrier disagrees with the reference model;
- protocol migration can orphan or silently reinterpret records;
- the project name or licensing posture remains unresolved at publication time.
