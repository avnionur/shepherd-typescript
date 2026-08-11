import type { SemanticValue } from "../canonical/canonical-record.ts";
import { formalAssuranceProtocolConfig } from "../protocol/config.ts";
import { formalContentRef } from "./content-ref.ts";
import { StrongProofEvidenceValidationError, TypedEffectTraceValidationError } from "./errors.ts";
import { validateStrongProofEvidence } from "./strong-evidence.ts";
import { validateTypedEffectTrace } from "./trace-machine.ts";
import type {
    ProofEnvelope,
    ProofEnvelopeClassificationOptions,
    ProofEnvelopeProfile,
    ProofEnvelopeStrength,
} from "./types.ts";

const { proofEnvelope } = formalAssuranceProtocolConfig;

/**
 * Classifies untrusted trace evidence at the strongest executable claim this runtime can defend.
 *
 * Missing, malformed, unsupported, or lifecycle-inconsistent evidence returns a frozen
 * `runtime_only` envelope. A complete trace or valid live prefix with an exact static-program
 * identity receives only `reference_validated`; this function never infers Lean-backed proof
 * coverage, lowering adequacy, Core-0H sidecar authority, or theorem-artifact validity.
 *
 * @param options - Completion mode, optional static program identity, and ordered trace evidence.
 * @returns A frozen conservative proof envelope with explicit production-runtime exclusions.
 * @throws {TypeError} If the top-level options container is malformed.
 *
 * @example
 * ```ts
 * const envelope = classifyProofEnvelope({
 *     completed: false,
 *     programRef,
 *     trace: declarationPrefix,
 * });
 * envelope.reference_validated;
 * ```
 *
 * @public
 */
export function classifyProofEnvelope(options: ProofEnvelopeClassificationOptions): ProofEnvelope {
    const parsed = readClassificationOptions(options);
    if (parsed.programRef === undefined) {
        return runtimeOnlyEnvelope("missing-program-ref");
    }
    try {
        validateTypedEffectTrace({
            completed: parsed.completed,
            programRef: parsed.programRef,
            trace: parsed.trace,
        });
    } catch (error) {
        if (error instanceof TypedEffectTraceValidationError || error instanceof TypeError) {
            return runtimeOnlyEnvelope("trace-not-reference-core-a");
        }
        throw error;
    }
    const traceRef = formalContentRef(
        parsed.completed
            ? proofEnvelope.traceRefPrefixes.completed
            : proofEnvelope.traceRefPrefixes.prefix,
        parsed.trace as readonly SemanticValue[],
    );
    if (parsed.completed && parsed.proofEvidence !== undefined) {
        try {
            const strong = validateStrongProofEvidence(
                parsed.proofEvidence,
                parsed.programRef,
                traceRef,
                parsed.trace,
            );
            return freezeEnvelope({
                evidence_id: strong.evidenceId,
                metadata: strong.metadata,
                profile: strong.profile,
                program_ref: parsed.programRef,
                proof_backed: true,
                reference_validated: false,
                strength: strong.strength,
                theorem_ids: strong.theoremIds,
                trace_ref: traceRef,
            });
        } catch (error) {
            if (
                !(error instanceof StrongProofEvidenceValidationError || error instanceof TypeError)
            ) {
                throw error;
            }
        }
    }
    const evidenceId = formalContentRef(proofEnvelope.evidenceRefPrefix, {
        completed: parsed.completed,
        envelope_schema_version: proofEnvelope.schemaVersion,
        profile: proofEnvelope.referenceValidatedProfile,
        program_ref: parsed.programRef,
        proof_authority: proofEnvelope.validator,
        strength: proofEnvelope.referenceValidatedStrength,
        trace_ref: traceRef,
        validator: parsed.completed
            ? proofEnvelope.validationOperations.completed
            : proofEnvelope.validationOperations.prefix,
    });
    return freezeEnvelope({
        evidence_id: evidenceId,
        metadata: {
            completed: parsed.completed,
            validator: parsed.completed
                ? proofEnvelope.validationOperations.completed
                : proofEnvelope.validationOperations.prefix,
        },
        profile: proofEnvelope.referenceValidatedProfile as ProofEnvelopeProfile,
        program_ref: parsed.programRef,
        proof_backed: false,
        reference_validated: true,
        strength: proofEnvelope.referenceValidatedStrength as ProofEnvelopeStrength,
        theorem_ids: [],
        trace_ref: traceRef,
    });
}

function runtimeOnlyEnvelope(reason: string): ProofEnvelope {
    return freezeEnvelope({
        evidence_id: null,
        metadata: { reason },
        profile: proofEnvelope.runtimeOnlyProfile as ProofEnvelopeProfile,
        program_ref: null,
        proof_backed: false,
        reference_validated: false,
        strength: proofEnvelope.runtimeOnlyStrength as ProofEnvelopeStrength,
        theorem_ids: [],
        trace_ref: null,
    });
}

function freezeEnvelope(value: {
    readonly evidence_id: string | null;
    readonly metadata: Readonly<Record<string, SemanticValue>>;
    readonly profile: ProofEnvelopeProfile;
    readonly program_ref: string | null;
    readonly proof_backed: boolean;
    readonly reference_validated: boolean;
    readonly strength: ProofEnvelopeStrength;
    readonly theorem_ids: readonly string[];
    readonly trace_ref: string | null;
}): ProofEnvelope {
    return Object.freeze({
        evidence_id: value.evidence_id,
        excluded_runtime_surfaces: Object.freeze([...proofEnvelope.excludedRuntimeSurfaces]),
        metadata: Object.freeze({ ...value.metadata }),
        profile: value.profile,
        program_ref: value.program_ref,
        proof_backed: value.proof_backed,
        reference_validated: value.reference_validated,
        schema_version: proofEnvelope.schemaVersion,
        strength: value.strength,
        theorem_ids: Object.freeze([...value.theorem_ids]),
        trace_ref: value.trace_ref,
        validator: proofEnvelope.validator,
    });
}

function readClassificationOptions(value: unknown): {
    readonly completed: boolean;
    readonly programRef?: string;
    readonly proofEvidence?: unknown;
    readonly trace: readonly unknown[];
} {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError("proof-envelope classification options must be an object");
    }
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError("proof-envelope classification options must be a data object");
    }
    if (
        Object.values(Object.getOwnPropertyDescriptors(value)).some(
            (descriptor) => descriptor.get !== undefined || descriptor.set !== undefined,
        )
    ) {
        throw new TypeError("proof-envelope classification options must not contain accessors");
    }
    const fields = value as Record<string, unknown>;
    const keys = Object.keys(fields).sort();
    const allowed = [
        "completed",
        ...(fields.programRef === undefined ? [] : ["programRef"]),
        ...(fields.proofEvidence === undefined ? [] : ["proofEvidence"]),
        "trace",
    ].sort();
    if (keys.length !== allowed.length || keys.some((key, index) => key !== allowed[index])) {
        throw new TypeError("proof-envelope classification options must be exact");
    }
    if (typeof fields.completed !== "boolean" || !Array.isArray(fields.trace)) {
        throw new TypeError("proof-envelope completion and trace values are malformed");
    }
    if (fields.programRef !== undefined && typeof fields.programRef !== "string") {
        throw new TypeError("proof-envelope programRef must be a string when provided");
    }
    return {
        completed: fields.completed,
        ...(fields.programRef === undefined ? {} : { programRef: fields.programRef }),
        ...(fields.proofEvidence === undefined ? {} : { proofEvidence: fields.proofEvidence }),
        trace: fields.trace,
    };
}
