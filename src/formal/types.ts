import type { SemanticValue } from "../canonical/canonical-record.ts";
import type {
    PROOF_ENVELOPE_PROFILES,
    PROOF_ENVELOPE_STRENGTHS,
    TYPED_EFFECT_TRACE_RECORD_TYPES,
} from "../protocol/values.generated.ts";

/** Configured Appendix B proof-envelope profile. */
export type ProofEnvelopeProfile = (typeof PROOF_ENVELOPE_PROFILES)[number];

/** Configured Appendix B proof-envelope strength. */
export type ProofEnvelopeStrength = (typeof PROOF_ENVELOPE_STRENGTHS)[number];

/** Configured normalized record discriminant accepted by the Core-A trace machine. */
export type TypedEffectTraceRecordType =
    (typeof TYPED_EFFECT_TRACE_RECORD_TYPES)[keyof typeof TYPED_EFFECT_TRACE_RECORD_TYPES];

/** Normalized semantic record consumed by the executable typed-effect trace machine. */
export type TypedEffectTraceRecord = {
    /** Canonical record-specific semantic field. */
    readonly [field: string]: SemanticValue;
    /** Configured lifecycle record discriminant. */
    readonly record_type: TypedEffectTraceRecordType;
    /** Trace-local identity unique within one reference trace. */
    readonly ref: string;
};

/** Untrusted input for executable Core-A trace lifecycle validation. */
export type TypedEffectTraceValidationOptions = {
    /** Whether every selected effect path must be terminally closed. */
    readonly completed: boolean;
    /** Content-addressed identity of the static reference program. */
    readonly programRef: string;
    /** Ordered normalized records to validate without mutation. */
    readonly trace: readonly unknown[];
};

/** Frozen summary returned after executable typed-effect trace validation. */
export type TypedEffectTraceValidation = {
    /** Whether completed lifecycle obligations were enforced. */
    readonly completed: boolean;
    /** Number of selected paths that remain open in an accepted prefix. */
    readonly open_path_count: number;
    /** Validated content-addressed static-program identity. */
    readonly program_ref: string;
    /** Number of normalized records consumed by the machine. */
    readonly record_count: number;
};

/** Untrusted input classified against the executable proof-envelope boundary. */
export type ProofEnvelopeClassificationOptions = {
    /** Whether the supplied trace claims to be complete. */
    readonly completed: boolean;
    /** Content-addressed static-program identity, when independently available. */
    readonly programRef?: string;
    /** Optional static lowering and theorem evidence requesting a stronger completed-trace claim. */
    readonly proofEvidence?: StrongProofEvidence;
    /** Ordered normalized reference records or unsupported runtime evidence. */
    readonly trace: readonly unknown[];
};

/** Content-addressed static source-to-kernel lowering manifest. */
export type StaticLoweringEvidence = {
    /** Exact ordered fragment assumptions checked by the lowering authority. */
    readonly assumptions: readonly string[];
    /** Completion assertion; strong profiles require true. */
    readonly completed: boolean;
    /** Content identity of the exact generated trace. */
    readonly generated_trace_ref: string;
    /** Content identity of this lowering manifest. */
    readonly lowering_ref: string;
    /** Upstream static-source case that generated this lowering. */
    readonly oracle_case: string;
    /** Repository-relative path of the pinned lowering generator. */
    readonly oracle_path: string;
    /** Upstream repository containing the lowering generator. */
    readonly oracle_repository: string;
    /** Exact upstream revision containing the lowering generator and case. */
    readonly oracle_revision: string;
    /** Strong profile for which lowering was checked. */
    readonly profile: ProofEnvelopeProfile;
    /** Content identity of the lowered kernel program. */
    readonly program_ref: string;
    /** Stable lowering-manifest schema version. */
    readonly schema_version: string;
    /** Content identity of the admitted static source fragment. */
    readonly source_ref: string;
    /** Configured lowering authority. */
    readonly validator: string;
};

/** Deterministic two-phase handler body cited by a Core-0H sidecar. */
export type Core0hHandlerPhases = {
    /** Content identity of the static handler body. */
    readonly handler_ref: string;
    /** Content identity of the first deterministic handler phase. */
    readonly phase_one_ref: string;
    /** Content identity of the second deterministic handler phase. */
    readonly phase_two_ref: string;
};

/** Validator-issued content-addressed Core-0H sidecar manifest. */
export type Core0hSidecarEvidence = {
    /** Ordered deterministic handler phase pairs covered by the sidecar. */
    readonly handler_phases: readonly Core0hHandlerPhases[];
    /** Exact lowering manifest covered by this sidecar. */
    readonly lowering_ref: string;
    /** Exact lowered program covered by this sidecar. */
    readonly program_ref: string;
    /** Stable Core-0H sidecar schema version. */
    readonly schema_version: string;
    /** Content identity of this sidecar manifest. */
    readonly sidecar_ref: string;
    /** Exact completed generated trace covered by this sidecar. */
    readonly trace_ref: string;
    /** Configured Core-0H sidecar authority. */
    readonly validator: string;
};

/** Pinned metadata declaration for an external theorem artifact. */
export type PinnedTheoremArtifactEvidence = {
    /** Named external theorem-artifact authority. */
    readonly authority: string;
    /** External command declared to check theorem names and typed signatures. */
    readonly build_gate: string;
    /** Complete extension theorem surface, kept separate from base profile claims. */
    readonly extension_theorem_ids: readonly string[];
    /** Content identity of this exact theorem metadata. */
    readonly metadata_ref: string;
    /** Pinned external artifact revision label. */
    readonly revision: string;
    /** Stable theorem-artifact metadata schema version. */
    readonly schema_version: string;
    /** Complete declared base theorem surface. */
    readonly theorem_ids: readonly string[];
};

/** Complete external evidence bundle requesting one theorem-backed profile claim. */
export type StrongProofEvidence = {
    /** Core-0H sidecar, required only for the configured sidecar-gated profile. */
    readonly core0h_sidecar: Core0hSidecarEvidence | null;
    /** Exact static lowering manifest bound to the generated trace. */
    readonly lowering: StaticLoweringEvidence;
    /** Requested theorem-backed profile. */
    readonly profile: ProofEnvelopeProfile;
    /** Requested proof strength. */
    readonly strength: ProofEnvelopeStrength;
    /** Exact pinned external theorem-artifact metadata. */
    readonly theorem_artifact: PinnedTheoremArtifactEvidence;
};

/** Frozen inspectable claim over runtime or executable-reference trace evidence. */
export type ProofEnvelope = {
    /** Content-addressed evidence identity for non-runtime claims, otherwise null. */
    readonly evidence_id: string | null;
    /** Production surfaces explicitly excluded from formal coverage. */
    readonly excluded_runtime_surfaces: readonly string[];
    /** Whether the envelope claims Lean-backed semantic coverage. */
    readonly proof_backed: boolean;
    /** Configured claim profile. */
    readonly profile: ProofEnvelopeProfile;
    /** Static reference-program identity for non-runtime claims, otherwise null. */
    readonly program_ref: string | null;
    /** Whether executable reference validation supports this envelope. */
    readonly reference_validated: boolean;
    /** Stable proof-envelope wire version. */
    readonly schema_version: string;
    /** Configured claim strength. */
    readonly strength: ProofEnvelopeStrength;
    /** Lean theorem identifiers; empty until explicit theorem evidence is validated. */
    readonly theorem_ids: readonly string[];
    /** Complete or prefix trace identity for non-runtime claims, otherwise null. */
    readonly trace_ref: string | null;
    /** Stable diagnostic metadata that cannot strengthen the claim. */
    readonly metadata: Readonly<Record<string, SemanticValue>>;
    /** Executable validator authority named by this envelope. */
    readonly validator: string;
};
