import type { SemanticRecord, SemanticValue } from "../canonical/canonical-record.ts";
import { formalAssuranceProtocolConfig } from "../protocol/config.ts";
import { freezeEnvelope } from "./proof-envelope.ts";
import type { ProofEnvelope, ProofEnvelopeProfile, ProofEnvelopeStrength } from "./types.ts";

const { inspection, proofEnvelope } = formalAssuranceProtocolConfig;
const CLAIM_FIELDS = ["evidence_id", "profile", "strength", "validator"] as const;

/**
 * One retained record whose carrier metadata may import a proof-envelope claim.
 *
 * @internal
 */
export type ProofClaimSource = {
    /** Canonical carrier metadata retained with the record. */
    readonly metadata: SemanticRecord;
    /** Canonical identity of the record carrying the metadata. */
    readonly record_id: string;
};

/**
 * Creates the default `runtime_only` envelope of one production inspection.
 *
 * An imported non-runtime claim found under the configured carrier-metadata key never changes the
 * profile, strength, `proof_backed`, or `reference_validated` fields; it is surfaced only through
 * `metadata.claimed_proof_backed` and `metadata.claim`, or refused with `metadata.claim_rejection`.
 *
 * @param sources - Retained records whose carrier metadata may import a claim.
 * @returns A frozen `runtime_only` envelope.
 * @internal
 */
export function createRuntimeInspectionEnvelope(
    sources: readonly ProofClaimSource[],
): ProofEnvelope {
    return freezeEnvelope({
        evidence_id: null,
        metadata: { ...readImportedClaim(sources), reason: inspection.reasons.productionRuntime },
        profile: proofEnvelope.runtimeOnlyProfile as ProofEnvelopeProfile,
        program_ref: null,
        proof_backed: false,
        reference_validated: false,
        strength: proofEnvelope.runtimeOnlyStrength as ProofEnvelopeStrength,
        theorem_ids: [],
        trace_ref: null,
    });
}

/**
 * Reclassifies an inspection envelope as `extension` naming its publication controls.
 *
 * Publication controls sit outside the base theorem surface, so the result never carries
 * reference validation, theorem identifiers, or proof authority. Existing metadata, including an
 * imported claim, is preserved; controls are merged in configured reporting order.
 *
 * @param envelope - Envelope derived from the inspected evidence.
 * @param controls - Configured publication-control kinds observed in that evidence.
 * @returns The unchanged envelope when no control applies, otherwise a frozen extension envelope.
 * @internal
 */
export function withPublicationControls(
    envelope: ProofEnvelope,
    controls: readonly string[],
): ProofEnvelope {
    if (controls.length === 0) {
        return envelope;
    }
    const existing = envelope.metadata.publication_controls;
    const observed = new Set([...(Array.isArray(existing) ? existing : []), ...controls]);
    return freezeEnvelope({
        evidence_id: null,
        metadata: {
            ...envelope.metadata,
            publication_controls: inspection.publicationControls.kinds.filter((kind) =>
                observed.has(kind),
            ),
            reason: inspection.reasons.publicationControl,
        },
        profile: inspection.extensionProfile as ProofEnvelopeProfile,
        program_ref: null,
        proof_backed: false,
        reference_validated: false,
        strength: proofEnvelope.runtimeOnlyStrength as ProofEnvelopeStrength,
        theorem_ids: [],
        trace_ref: null,
    });
}

/**
 * Returns an envelope with additional diagnostic metadata and otherwise identical claim fields.
 *
 * @param envelope - Envelope to extend.
 * @param metadata - Diagnostic fields that cannot strengthen the claim.
 * @returns A frozen envelope.
 * @internal
 */
export function withEnvelopeMetadata(
    envelope: ProofEnvelope,
    metadata: Readonly<Record<string, SemanticValue>>,
): ProofEnvelope {
    return freezeEnvelope({
        evidence_id: envelope.evidence_id,
        metadata: { ...envelope.metadata, ...metadata },
        profile: envelope.profile,
        program_ref: envelope.program_ref,
        proof_backed: envelope.proof_backed,
        reference_validated: envelope.reference_validated,
        strength: envelope.strength,
        theorem_ids: envelope.theorem_ids,
        trace_ref: envelope.trace_ref,
    });
}

function readImportedClaim(
    sources: readonly ProofClaimSource[],
): Readonly<Record<string, SemanticValue>> {
    const { metadataKey, rejections } = inspection.importedClaim;
    const claims = sources.filter((source) => Object.hasOwn(source.metadata, metadataKey));
    if (claims.length === 0) {
        return { claimed_proof_backed: false };
    }
    if (claims.length > 1) {
        return { claim_rejection: rejections.ambiguous, claimed_proof_backed: false };
    }
    const source = claims[0] as ProofClaimSource;
    const rejection = readClaimRejection(source.metadata[metadataKey]);
    if (rejection !== null) {
        return {
            claim_record_id: source.record_id,
            claim_rejection: rejection,
            claimed_proof_backed: false,
        };
    }
    const claim = source.metadata[metadataKey] as Readonly<Record<string, string>>;
    return {
        claim: {
            evidence_id: claim.evidence_id as string,
            profile: claim.profile as string,
            record_id: source.record_id,
            strength: claim.strength as string,
            validator: claim.validator as string,
        },
        claimed_proof_backed: true,
    };
}

function readClaimRejection(value: SemanticValue | undefined): string | null {
    const { rejections } = inspection.importedClaim;
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return rejections.malformed;
    }
    const claim = value as Readonly<Record<string, SemanticValue>>;
    const keys = Object.keys(claim).sort();
    if (
        keys.length !== CLAIM_FIELDS.length ||
        keys.some((key, index) => key !== CLAIM_FIELDS[index]) ||
        CLAIM_FIELDS.some((field) => typeof claim[field] !== "string") ||
        !proofEnvelope.profiles.includes(claim.profile as string) ||
        !proofEnvelope.strengths.includes(claim.strength as string)
    ) {
        return rejections.malformed;
    }
    if (
        claim.profile === proofEnvelope.runtimeOnlyProfile ||
        claim.strength === proofEnvelope.runtimeOnlyStrength
    ) {
        return rejections.runtime;
    }
    if (claim.validator !== proofEnvelope.validator) {
        return rejections.provenance;
    }
    const evidenceId = claim.evidence_id as string;
    const digest = evidenceId.slice(proofEnvelope.evidenceRefPrefix.length);
    return evidenceId.startsWith(proofEnvelope.evidenceRefPrefix) &&
        digest.length === proofEnvelope.hexLength &&
        /^[0-9a-f]+$/u.test(digest)
        ? null
        : rejections.evidenceRef;
}
