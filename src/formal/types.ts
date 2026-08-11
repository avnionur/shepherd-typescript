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
    /** Ordered normalized reference records or unsupported runtime evidence. */
    readonly trace: readonly unknown[];
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
