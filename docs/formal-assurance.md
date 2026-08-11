# Typed-Effect Reference Validation and Proof Envelopes

The public formal-assurance surface validates normalized Appendix B typed-effect traces and
classifies their strongest defensible claim. It is an executable reference boundary, not a proof
that the production runtime or an arbitrary TypeScript program implements the mechanized model.

Public entry points are exported from [`src/index.ts`](../src/index.ts):

- `validateTypedEffectTrace` executes the configured single-root Core-A lifecycle machine;
- `classifyProofEnvelope` returns a frozen, fail-closed claim envelope;
- `TypedEffectTraceValidationError` identifies invalid record or lifecycle evidence.
- `StrongProofEvidence` describes the untrusted lowering, optional sidecar, and theorem-metadata
  bundle accepted by classification.

## Reference-machine boundary

The validator accepts the configured declaration, handler-selection, resumption-handle,
continuation-resume, resume-return, effect-capture, and selection-closure records. It validates
exact record shapes, the content-addressed static-program identity, declaration and selection
correlation, callable one-shot resumptions, nested selection ancestry, terminal capture, and
Core-A closure evidence.

`completed: true` requires every declaration to be selected, every selection to obtain a
resumption handle, and every selected path to close. `completed: false` accepts a structurally
valid live prefix and reports its open-path count. Unsupported records, malformed values,
duplicate identities, invalid ordering, and inconsistent correlation fail closed.

The conformance fixture
[`test/fixtures/typed-effect-reference-v1.json`](../test/fixtures/typed-effect-reference-v1.json)
is derived from the pinned upstream MIT-licensed Core-0/Core-A golden traces at revision
`d45074e0099d9ccafeed4a233702ad68ff8a2fa6`. The public-seam tests are in
[`test/formal/proof-envelope.test.ts`](../test/formal/proof-envelope.test.ts).

## Strong-evidence boundary

Completed Core-0 and Core-A traces may upgrade to their configured theorem-backed profiles only
when all of the following agree exactly: the program and generated-trace identities, the ordered
fragment assumptions, an allowlisted lowering manifest, the pinned upstream golden-case generator
repository/path/revision and case identity, the configured profile/strength, and the pinned theorem
metadata declaration. Core-A additionally admits exactly one direct abort capture and no resume,
return, or closure suffix on the selected path.

Core-0H uses the same checks against an allowlisted pinned lowering plus a content-addressed
two-phase-handler sidecar. This release intentionally configures no trusted Core-0H sidecar
manifests because the pinned upstream revision publishes no such artifact. Structurally valid but
untrusted Core-0H evidence therefore remains reference-validated.

The theorem metadata pins the published paper revision, declared theorem names, and the external
`make verify-proof-envelope-claim` gate. This repository does not contain or execute that Lean
build, so the metadata check establishes exact imported claim identity, not independent local
verification of theorem signatures. Public-seam strong-evidence and drift tests are in
[`test/formal/strong-proof-envelope.test.ts`](../test/formal/strong-proof-envelope.test.ts).

## Claim classification

Classification requires an independently supplied static-program reference and a trace accepted
by the reference machine. Accepted complete traces and live prefixes receive the configured
`reference_core_a` profile and `reference_validated` strength, with canonical content identities
for the trace and envelope. A live prefix remains explicitly incomplete.

Missing program/trace evidence or a reference-machine failure returns `runtime_only`. Once a trace
is reference-valid, missing, malformed, unsupported, stale, or untrusted strong evidence cannot
weaken that result and remains `reference_core_a` / `reference_validated`. Only exact allowlisted
Core-0/Core-A lowering evidence emits theorem identifiers and `proof_backed` authority.

Every envelope reports the configured production surfaces excluded from formal coverage,
including provider and model behavior, shell and filesystem correctness, sandbox implementations,
storage, scheduling, cancellation, retries, recovery, and multi-branch replay.

## Configuration

[`protocol.config.json`](../protocol.config.json) owns the closed profile, strength, record,
action, disposition, closure, content-reference, validator, oracle revision, trusted-manifest,
theorem-metadata, and non-claim vocabularies. Startup validation freezes that contract, and
generated TypeScript values expose its closed unions.
