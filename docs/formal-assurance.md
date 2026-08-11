# Typed-Effect Reference Validation and Proof Envelopes

The public formal-assurance surface validates normalized Appendix B typed-effect traces and
classifies their strongest defensible claim. It is an executable reference boundary, not a proof
that the production runtime or an arbitrary TypeScript program implements the mechanized model.

Public entry points are exported from [`src/index.ts`](../src/index.ts):

- `validateTypedEffectTrace` executes the configured single-root Core-A lifecycle machine;
- `classifyProofEnvelope` returns a frozen, fail-closed claim envelope;
- `TypedEffectTraceValidationError` identifies invalid record or lifecycle evidence.

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

## Claim classification

Classification requires an independently supplied static-program reference and a trace accepted
by the reference machine. Accepted complete traces and live prefixes receive the configured
`reference_core_a` profile and `reference_validated` strength, with canonical content identities
for the trace and envelope. A live prefix remains explicitly incomplete.

Missing, malformed, unsupported, or lifecycle-inconsistent evidence returns `runtime_only`.
Reference validation never supplies theorem identifiers, `proof_backed` authority, forward
simulation, semantic adequacy, lowering evidence, or Core-0H sidecar authority. Those stronger
claims require separately validated evidence and remain planned.

Every envelope reports the configured production surfaces excluded from formal coverage,
including provider and model behavior, shell and filesystem correctness, sandbox implementations,
storage, scheduling, cancellation, retries, recovery, and multi-branch replay.

## Configuration

[`protocol.config.json`](../protocol.config.json) owns the closed profile, strength, record,
action, disposition, closure, content-reference, validator, and non-claim vocabularies. Startup
validation freezes that contract, and generated TypeScript values expose its closed unions.
