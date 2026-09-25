# Typed-Effect Reference Validation and Proof Envelopes

The public formal-assurance surface validates normalized Appendix B typed-effect traces and
classifies their strongest defensible claim. It is an executable reference boundary, not a proof
that the production runtime or an arbitrary TypeScript program implements the mechanized model.

Public entry points are exported from [`src/index.ts`](../src/index.ts):

- `validateTypedEffectTrace` executes the configured single-root Core-A lifecycle machine;
- `classifyProofEnvelope` returns a frozen, fail-closed claim envelope;
- `inspectDurableTaskExecution`, `inspectReplaySession`, and `inspectChildRun` attach an envelope
  to every inspection ([inspection envelopes](#inspection-envelopes));
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

## Inspection envelopes

Every run, replay-session, and delegated child-run inspection carries a `proof` field holding a
frozen envelope, so claim strength is inspectable without a separate classification call (paper
Appendix B: public `Run[T]` values carry a proof field). Entry points:
[`inspectDurableTaskExecution`](./durable-execution-inspection.md#proof-envelope),
[`inspectReplaySession`](./replay-sessions.md#proof-envelope), and
[`inspectChildRun`](./delegated-authority.md#proof-envelope). Implementation:
[`src/formal/inspection-envelope.ts`](../src/formal/inspection-envelope.ts) and
[`src/replay/proof-lowering.ts`](../src/replay/proof-lowering.ts). Tests:
[`test/formal/inspection-proof-envelope.test.ts`](../test/formal/inspection-proof-envelope.test.ts),
with production-seam assertions in
[`retained-world-select.test.ts`](../test/workspace/retained-world-select.test.ts) and
[`delegation-review.test.ts`](../test/delegation/delegation-review.test.ts).

- **Default.** Production runs and root replay sessions are `runtime_only` with
  `metadata.reason` set to the configured `productionRuntime` reason and
  `metadata.claimed_proof_backed: false`.
- **Imported claims.** A run artifact whose metadata carries the configured
  `importedClaim.metadataKey` (`proof_envelope`) imports one claim object with exactly
  `evidence_id`, `profile`, `strength`, and `validator`. The envelope stays `runtime_only`,
  `proof_backed: false`, and `reference_validated: false`; an accepted claim surfaces only as
  `metadata.claimed_proof_backed: true` plus `metadata.claim` (the four fields and the carrying
  artifact record). A claim is accepted only when its profile and strength are configured and
  non-runtime, its validator is the configured reference validator, and its evidence identity is a
  configured `proof-evidence:sha256:` reference. Otherwise `metadata.claim_rejection` names the
  configured rejection (`claim_malformed`, `claim_runtime_only`, `claim_provenance_unrecognized`,
  `claim_evidence_ref_invalid`, or `claim_ambiguous` for more than one claiming artifact). The
  runtime never verifies an imported claim.
- **Publication controls.** Forwarding, terminal delay/fork, and replay are outside the base
  theorem surface and classify as the configured `extension` profile with `runtime_only` strength,
  no evidence identity, and `metadata.publication_controls` listing the observed controls in
  configured order. Evidence sources are configured under `publicationControls`: a retained-world
  settlement citation on a run is `delay`; a rewind branch session is `fork`; a replay branch
  session is `replay`; a delegated child run with a retained supervisor handoff is `forwarding`.
  Existing metadata, including an imported claim, is preserved.
- **Optional lowering.** `inspectReplaySession(store, { sessionId, lowerProof: true })` lowers an
  eligible static session into Core-A records and classifies them with `classifyProofEnvelope`.
  Eligibility is configured under `lowering`: a `root` session, terminal status `finished`, only
  `effect` steps, and every effect `materialized` with a retained outcome and handler. Each effect
  step lowers to a declaration, handler selection, resumption handle, continuation resume carrying
  the outcome result, resume return, and `return` capture on the root branch, with trace-local
  identities derived from the configured `localRefPrefix` and the step identity; the static program
  identity is a `program:sha256:` digest over the session program identity and the lowering
  version. An accepted lowering is `reference_core_a` / `reference_validated` with
  `metadata.lowering` naming the configured lowering version; it is never `proof_backed`, and it
  does not establish source-to-kernel lowering adequacy, which remains the pinned static-lowering
  evidence boundary above. An ineligible session keeps its envelope and reports
  `metadata.lowering_ineligible` (`branch_session`, `not_finished`, `non_static_step`, or
  `effect_not_materialized`). Durable task executions invoke a provider and are never lowered.

Run-ledger entries embed the run inspection, so their schema
([`run-ledger-entry-v1.schema.json`](../spec/schemas/run-ledger-entry-v1.schema.json)) requires the
`proof` envelope from 9.0.0.

## Configuration

[`protocol.config.json`](../protocol.config.json) owns the closed profile, strength, record,
action, disposition, closure, content-reference, validator, oracle revision, trusted-manifest,
theorem-metadata, and non-claim vocabularies, plus the `formalAssurance.inspection` extension
profile, imported-claim key and rejections, publication-control kinds and sources, lowering
eligibility and version, and envelope reasons (formal assurance protocol v2,
`FORMAL_ASSURANCE_V2_CONTRACT`). Startup validation checks lowering eligibility and replay-mode
controls against the replay vocabularies and requires every replay mode to be either lowerable or a
publication control. Startup validation freezes that contract, and
generated TypeScript values expose its closed unions.
