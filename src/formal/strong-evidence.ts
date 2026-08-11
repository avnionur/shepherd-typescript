import type { SemanticValue } from "../canonical/canonical-record.ts";
import { formalAssuranceProtocolConfig } from "../protocol/config.ts";
import { formalContentRef } from "./content-ref.ts";
import { StrongProofEvidenceValidationError } from "./errors.ts";
import type { ProofEnvelopeProfile, ProofEnvelopeStrength } from "./types.ts";

type StrongProofValidation = {
    readonly evidenceId: string;
    readonly metadata: Readonly<Record<string, SemanticValue>>;
    readonly profile: ProofEnvelopeProfile;
    readonly strength: ProofEnvelopeStrength;
    readonly theoremIds: readonly string[];
};

const { proofEnvelope, referenceMachine, strongEvidence } = formalAssuranceProtocolConfig;

/**
 * Validates one untrusted strong-evidence bundle against a completed reference trace.
 *
 * @param value - Untrusted lowering, optional sidecar, and theorem-artifact metadata.
 * @param programRef - Independently validated static-program identity.
 * @param traceRef - Canonical identity of the completed generated trace.
 * @param trace - Ordered trace already accepted by the Core-A reference machine.
 * @returns Frozen strong claim data for proof-envelope construction.
 * @throws {StrongProofEvidenceValidationError} If any evidence binding or profile rule fails.
 * @internal
 */
export function validateStrongProofEvidence(
    value: unknown,
    programRef: string,
    traceRef: string,
    trace: readonly unknown[],
): StrongProofValidation {
    const bundle = readExactObject(value, [
        "core0h_sidecar",
        "lowering",
        "profile",
        "strength",
        "theorem_artifact",
    ]);
    const profile = readText(bundle.profile, "strong evidence profile");
    const strength = readText(bundle.strength, "strong evidence strength");
    const claim = strongEvidence.profileClaims.find(
        (candidate) => candidate.profile === profile && candidate.strength === strength,
    );
    requireEvidence(
        claim !== undefined,
        "profile and strength do not name a configured strong claim",
    );
    validateTheoremArtifact(bundle.theorem_artifact);
    const loweringRef = validateLowering(bundle.lowering, claim, programRef, traceRef);
    validateTraceBoundary(trace, claim);
    requireEvidence(
        strongEvidence.lowering.trustedManifestRefs.includes(loweringRef),
        "lowering manifest is not trusted by this release",
    );
    const sidecarRef = claim.requiresCore0hSidecar
        ? validateSidecar(bundle.core0h_sidecar, loweringRef, programRef, traceRef)
        : rejectUnexpectedSidecar(bundle.core0h_sidecar);
    const evidenceId = formalContentRef(proofEnvelope.evidenceRefPrefix, {
        lowering_ref: loweringRef,
        profile: claim.profile,
        program_ref: programRef,
        sidecar_ref: sidecarRef,
        strength: claim.strength,
        theorem_metadata_ref: strongEvidence.theoremArtifact.metadataRef,
        trace_ref: traceRef,
        validator: proofEnvelope.validator,
    });
    return Object.freeze({
        evidenceId,
        metadata: Object.freeze({
            completed: true,
            lowering_ref: loweringRef,
            sidecar_ref: sidecarRef,
            theorem_metadata_ref: strongEvidence.theoremArtifact.metadataRef,
        }),
        profile: claim.profile as ProofEnvelopeProfile,
        strength: claim.strength as ProofEnvelopeStrength,
        theoremIds: Object.freeze([...claim.theoremIds]),
    });
}

function validateTheoremArtifact(value: unknown): void {
    const fields = readExactObject(value, [
        "authority",
        "build_gate",
        "extension_theorem_ids",
        "metadata_ref",
        "revision",
        "schema_version",
        "theorem_ids",
    ]);
    const expected = strongEvidence.theoremArtifact;
    requireEvidence(fields.authority === expected.authority, "theorem authority drifted");
    requireEvidence(fields.build_gate === expected.buildGate, "theorem build gate drifted");
    requireEvidence(fields.metadata_ref === expected.metadataRef, "theorem metadata ref drifted");
    requireEvidence(fields.revision === expected.revision, "theorem artifact revision drifted");
    requireEvidence(fields.schema_version === expected.schemaVersion, "theorem schema drifted");
    requireEvidence(
        sameStrings(readStrings(fields.theorem_ids, "theorem ids"), expected.theoremIds),
        "base theorem surface drifted",
    );
    requireEvidence(
        sameStrings(
            readStrings(fields.extension_theorem_ids, "extension theorem ids"),
            expected.extensionTheoremIds,
        ),
        "extension theorem surface drifted",
    );
}

function validateLowering(
    value: unknown,
    claim: (typeof strongEvidence.profileClaims)[number],
    programRef: string,
    traceRef: string,
): string {
    const fields = readExactObject(value, [
        "assumptions",
        "completed",
        "generated_trace_ref",
        "lowering_ref",
        "oracle_case",
        "oracle_path",
        "oracle_repository",
        "oracle_revision",
        "profile",
        "program_ref",
        "schema_version",
        "source_ref",
        "validator",
    ]);
    requireEvidence(fields.completed === true, "strong lowering evidence must be complete");
    requireEvidence(fields.profile === claim.profile, "lowering profile disagrees with claim");
    requireEvidence(fields.program_ref === programRef, "lowering program identity disagrees");
    requireEvidence(fields.generated_trace_ref === traceRef, "lowering trace identity disagrees");
    requireEvidence(
        fields.schema_version === strongEvidence.lowering.schemaVersion,
        "lowering schema drifted",
    );
    requireEvidence(
        fields.validator === strongEvidence.lowering.validator,
        "lowering authority drifted",
    );
    const oracleCase = readText(fields.oracle_case, "lowering oracle case");
    requireEvidence(
        fields.oracle_path === strongEvidence.lowering.oracle.path,
        "lowering oracle path drifted",
    );
    requireEvidence(
        fields.oracle_repository === strongEvidence.lowering.oracle.repository,
        "lowering oracle repository drifted",
    );
    requireEvidence(
        fields.oracle_revision === strongEvidence.lowering.oracle.revision,
        "lowering oracle revision drifted",
    );
    const assumptions = readStrings(fields.assumptions, "lowering assumptions");
    requireEvidence(sameStrings(assumptions, claim.assumptions), "lowering assumptions drifted");
    const sourceRef = readContentRef(
        fields.source_ref,
        strongEvidence.lowering.sourceRefPrefix,
        "lowering source identity",
    );
    const expectedSourceRef = formalContentRef(strongEvidence.lowering.sourceRefPrefix, {
        oracle_case: oracleCase,
        oracle_path: strongEvidence.lowering.oracle.path,
        oracle_repository: strongEvidence.lowering.oracle.repository,
        oracle_revision: strongEvidence.lowering.oracle.revision,
    });
    requireEvidence(sourceRef === expectedSourceRef, "lowering source provenance disagrees");
    const loweringRef = readContentRef(
        fields.lowering_ref,
        strongEvidence.lowering.contentRefPrefix,
        "lowering manifest identity",
    );
    const expectedRef = formalContentRef(strongEvidence.lowering.contentRefPrefix, {
        assumptions: [...assumptions],
        completed: true,
        generated_trace_ref: traceRef,
        oracle_case: oracleCase,
        oracle_path: strongEvidence.lowering.oracle.path,
        oracle_repository: strongEvidence.lowering.oracle.repository,
        oracle_revision: strongEvidence.lowering.oracle.revision,
        profile: claim.profile,
        program_ref: programRef,
        schema_version: strongEvidence.lowering.schemaVersion,
        source_ref: sourceRef,
        validator: strongEvidence.lowering.validator,
    });
    requireEvidence(loweringRef === expectedRef, "lowering manifest content identity disagrees");
    return loweringRef;
}

function validateSidecar(
    value: unknown,
    loweringRef: string,
    programRef: string,
    traceRef: string,
): string {
    const fields = readExactObject(value, [
        "handler_phases",
        "lowering_ref",
        "program_ref",
        "schema_version",
        "sidecar_ref",
        "trace_ref",
        "validator",
    ]);
    requireEvidence(fields.lowering_ref === loweringRef, "sidecar lowering identity disagrees");
    requireEvidence(fields.program_ref === programRef, "sidecar program identity disagrees");
    requireEvidence(fields.trace_ref === traceRef, "sidecar trace identity disagrees");
    requireEvidence(
        fields.schema_version === strongEvidence.core0hSidecar.schemaVersion,
        "sidecar schema drifted",
    );
    requireEvidence(
        fields.validator === strongEvidence.core0hSidecar.validator,
        "sidecar authority drifted",
    );
    requireEvidence(
        Array.isArray(fields.handler_phases),
        "sidecar handler phases must be an array",
    );
    requireEvidence(fields.handler_phases.length > 0, "Core-0H sidecar must cite handler phases");
    const handlerRefs = new Set<string>();
    const phaseRefs = new Set<string>();
    const handlerPhases = fields.handler_phases.map((value, index) => {
        const phase = readExactObject(value, ["handler_ref", "phase_one_ref", "phase_two_ref"]);
        const handlerRef = readContentRef(
            phase.handler_ref,
            strongEvidence.core0hSidecar.handlerRefPrefix,
            `sidecar handler ${index}`,
        );
        const phaseOneRef = readContentRef(
            phase.phase_one_ref,
            strongEvidence.core0hSidecar.phaseRefPrefix,
            `sidecar handler ${index} phase one`,
        );
        const phaseTwoRef = readContentRef(
            phase.phase_two_ref,
            strongEvidence.core0hSidecar.phaseRefPrefix,
            `sidecar handler ${index} phase two`,
        );
        requireEvidence(!handlerRefs.has(handlerRef), "sidecar handler identities must be unique");
        requireEvidence(
            phaseOneRef !== phaseTwoRef &&
                !phaseRefs.has(phaseOneRef) &&
                !phaseRefs.has(phaseTwoRef),
            "sidecar phase identities must be distinct",
        );
        handlerRefs.add(handlerRef);
        phaseRefs.add(phaseOneRef);
        phaseRefs.add(phaseTwoRef);
        return {
            handler_ref: handlerRef,
            phase_one_ref: phaseOneRef,
            phase_two_ref: phaseTwoRef,
        };
    });
    const sidecarRef = readContentRef(
        fields.sidecar_ref,
        strongEvidence.core0hSidecar.contentRefPrefix,
        "Core-0H sidecar identity",
    );
    const expectedRef = formalContentRef(strongEvidence.core0hSidecar.contentRefPrefix, {
        handler_phases: handlerPhases,
        lowering_ref: loweringRef,
        program_ref: programRef,
        schema_version: strongEvidence.core0hSidecar.schemaVersion,
        trace_ref: traceRef,
        validator: strongEvidence.core0hSidecar.validator,
    });
    requireEvidence(sidecarRef === expectedRef, "Core-0H sidecar content identity disagrees");
    requireEvidence(
        strongEvidence.core0hSidecar.trustedManifestRefs.includes(sidecarRef),
        "Core-0H sidecar is not trusted by this release",
    );
    return sidecarRef;
}

function rejectUnexpectedSidecar(value: unknown): null {
    requireEvidence(value === null, "this strong profile does not accept a Core-0H sidecar");
    return null;
}

function validateTraceBoundary(
    trace: readonly unknown[],
    claim: (typeof strongEvidence.profileClaims)[number],
): void {
    const records = trace as readonly Readonly<Record<string, unknown>>[];
    const captures = records.filter(
        (record) => record.record_type === referenceMachine.recordTypes.capture,
    );
    for (const capture of captures) {
        requireEvidence(
            !claim.forbiddenActionKinds.includes(String(capture.action_kind)),
            "trace contains a handler answer forbidden by the strong profile",
        );
    }
    if (claim.requiredCaptureActionKind === null) {
        return;
    }
    requireEvidence(captures.length === 1, "strong Core-A requires exactly one direct capture");
    const capture = captures[0];
    requireEvidence(
        capture?.action_kind === claim.requiredCaptureActionKind,
        "strong Core-A capture action disagrees",
    );
    const selectedPathRef = capture.selection_path_ref;
    requireEvidence(
        !records.some(
            (record) =>
                (record.record_type === referenceMachine.recordTypes.continuationResume ||
                    record.record_type === referenceMachine.recordTypes.resumeReturn) &&
                record.selection_path_ref === selectedPathRef,
        ),
        "strong Core-A abort path must not resume or return",
    );
    requireEvidence(
        !records.some(
            (record) => record.record_type === referenceMachine.recordTypes.selectionClosed,
        ),
        "strong Core-A does not admit a selection-closure suffix",
    );
}

function readExactObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw invalid("strong proof evidence must contain data objects");
    }
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) {
        throw invalid("strong proof evidence must use data-object prototypes");
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (
        Object.values(descriptors).some(
            (descriptor) => descriptor.get !== undefined || descriptor.set !== undefined,
        )
    ) {
        throw invalid("strong proof evidence must not contain accessors");
    }
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
        throw invalid("strong proof evidence object shape is not exact");
    }
    return value as Record<string, unknown>;
}

function readText(value: unknown, context: string): string {
    if (typeof value !== "string" || value.length === 0) {
        throw invalid(`${context} must be a non-empty string`);
    }
    return value;
}

function readStrings(value: unknown, context: string): readonly string[] {
    if (!Array.isArray(value)) {
        throw invalid(`${context} must be an array`);
    }
    const strings = value.map((item, index) => readText(item, `${context}[${index}]`));
    if (new Set(strings).size !== strings.length) {
        throw invalid(`${context} must contain unique values`);
    }
    return strings;
}

function readContentRef(value: unknown, prefix: string, context: string): string {
    const ref = readText(value, context);
    const digest = ref.slice(prefix.length);
    if (
        !ref.startsWith(prefix) ||
        digest.length !== proofEnvelope.hexLength ||
        !/^[0-9a-f]+$/u.test(digest)
    ) {
        throw invalid(`${context} must be a configured content reference`);
    }
    return ref;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

function requireEvidence(condition: boolean, message: string): asserts condition {
    if (!condition) {
        throw invalid(message);
    }
}

function invalid(message: string): StrongProofEvidenceValidationError {
    return new StrongProofEvidenceValidationError(message);
}
