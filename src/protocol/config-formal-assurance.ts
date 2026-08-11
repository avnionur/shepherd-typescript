import { createHash } from "node:crypto";

import type { ProtocolConfig } from "./config-types.ts";
import { SECURE_HASH_ALGORITHMS } from "./config-types.ts";
import {
    readArray,
    readEnum,
    readNonEmptyString,
    readObject,
    readPositiveInteger,
    readUniqueStrings,
} from "./config-value-readers.ts";

/** Validates executable reference-machine and proof-envelope configuration. */
export function readFormalAssuranceConfig(value: unknown): ProtocolConfig["formalAssurance"] {
    const config = readObject(
        value,
        ["proofEnvelope", "referenceMachine", "strongEvidence"],
        "formalAssurance",
    );
    const proof = readObject(
        config.proofEnvelope,
        [
            "digestAlgorithm",
            "evidenceRefPrefix",
            "excludedRuntimeSurfaces",
            "hexLength",
            "profiles",
            "programRefPrefix",
            "referenceValidatedProfile",
            "referenceValidatedStrength",
            "runtimeOnlyProfile",
            "runtimeOnlyStrength",
            "schemaVersion",
            "strengths",
            "traceRefPrefixes",
            "validationOperations",
            "validator",
        ],
        "formalAssurance.proofEnvelope",
    );
    const machine = readObject(
        config.referenceMachine,
        [
            "actionKinds",
            "closureReasons",
            "continuationDispositions",
            "pathPrefix",
            "profileVersion",
            "recordTypes",
            "resumptionSourceRecordType",
            "rootBranchRef",
        ],
        "formalAssurance.referenceMachine",
    );
    const strong = readObject(
        config.strongEvidence,
        ["core0hSidecar", "lowering", "profileClaims", "theoremArtifact"],
        "formalAssurance.strongEvidence",
    );
    const sidecar = readObject(
        strong.core0hSidecar,
        [
            "contentRefPrefix",
            "handlerRefPrefix",
            "phaseRefPrefix",
            "schemaVersion",
            "trustedManifestRefs",
            "validator",
        ],
        "formalAssurance.strongEvidence.core0hSidecar",
    );
    const lowering = readObject(
        strong.lowering,
        [
            "contentRefPrefix",
            "oracle",
            "schemaVersion",
            "sourceRefPrefix",
            "trustedManifestRefs",
            "validator",
        ],
        "formalAssurance.strongEvidence.lowering",
    );
    const loweringOracle = readObject(
        lowering.oracle,
        ["path", "repository", "revision"],
        "formalAssurance.strongEvidence.lowering.oracle",
    );
    const theoremArtifact = readObject(
        strong.theoremArtifact,
        [
            "authority",
            "buildGate",
            "extensionTheoremIds",
            "metadataRef",
            "metadataRefPrefix",
            "revision",
            "schemaVersion",
            "theoremIds",
        ],
        "formalAssurance.strongEvidence.theoremArtifact",
    );
    const traceRefPrefixes = readObject(
        proof.traceRefPrefixes,
        ["completed", "prefix"],
        "formalAssurance.proofEnvelope.traceRefPrefixes",
    );
    const validationOperations = readObject(
        proof.validationOperations,
        ["completed", "prefix"],
        "formalAssurance.proofEnvelope.validationOperations",
    );
    const recordTypes = readObject(
        machine.recordTypes,
        [
            "capture",
            "continuationResume",
            "declaration",
            "resumeReturn",
            "resumptionHandle",
            "selection",
            "selectionClosed",
        ],
        "formalAssurance.referenceMachine.recordTypes",
    );
    const digestAlgorithm = readEnum(
        proof.digestAlgorithm,
        SECURE_HASH_ALGORITHMS,
        "formalAssurance.proofEnvelope.digestAlgorithm",
    );
    const hexLength = readPositiveInteger(
        proof.hexLength,
        "formalAssurance.proofEnvelope.hexLength",
    );
    if (hexLength !== createHash(digestAlgorithm).digest("hex").length) {
        throw new TypeError(
            "formalAssurance.proofEnvelope.hexLength must match the digest algorithm",
        );
    }
    const profiles = readUniqueStrings(proof.profiles, "formalAssurance.proofEnvelope.profiles");
    const strengths = readUniqueStrings(proof.strengths, "formalAssurance.proofEnvelope.strengths");
    const runtimeOnlyProfile = readMember(
        proof.runtimeOnlyProfile,
        profiles,
        "formalAssurance.proofEnvelope.runtimeOnlyProfile",
    );
    const referenceValidatedProfile = readMember(
        proof.referenceValidatedProfile,
        profiles,
        "formalAssurance.proofEnvelope.referenceValidatedProfile",
    );
    const runtimeOnlyStrength = readMember(
        proof.runtimeOnlyStrength,
        strengths,
        "formalAssurance.proofEnvelope.runtimeOnlyStrength",
    );
    const referenceValidatedStrength = readMember(
        proof.referenceValidatedStrength,
        strengths,
        "formalAssurance.proofEnvelope.referenceValidatedStrength",
    );
    if (
        runtimeOnlyProfile === referenceValidatedProfile ||
        runtimeOnlyStrength === referenceValidatedStrength
    ) {
        throw new TypeError("formal assurance runtime and reference claims must be distinct");
    }
    const actionKinds = readUniqueStrings(
        machine.actionKinds,
        "formalAssurance.referenceMachine.actionKinds",
    );
    const continuationDispositions = readUniqueStrings(
        machine.continuationDispositions,
        "formalAssurance.referenceMachine.continuationDispositions",
    );
    if (actionKinds.length !== continuationDispositions.length) {
        throw new TypeError("reference-machine actions and dispositions must pair by ordinal");
    }
    const validatedRecordTypes = {
        capture: readNonEmptyString(
            recordTypes.capture,
            "formalAssurance.referenceMachine.recordTypes.capture",
        ),
        continuationResume: readNonEmptyString(
            recordTypes.continuationResume,
            "formalAssurance.referenceMachine.recordTypes.continuationResume",
        ),
        declaration: readNonEmptyString(
            recordTypes.declaration,
            "formalAssurance.referenceMachine.recordTypes.declaration",
        ),
        resumeReturn: readNonEmptyString(
            recordTypes.resumeReturn,
            "formalAssurance.referenceMachine.recordTypes.resumeReturn",
        ),
        resumptionHandle: readNonEmptyString(
            recordTypes.resumptionHandle,
            "formalAssurance.referenceMachine.recordTypes.resumptionHandle",
        ),
        selection: readNonEmptyString(
            recordTypes.selection,
            "formalAssurance.referenceMachine.recordTypes.selection",
        ),
        selectionClosed: readNonEmptyString(
            recordTypes.selectionClosed,
            "formalAssurance.referenceMachine.recordTypes.selectionClosed",
        ),
    };
    if (
        new Set(Object.values(validatedRecordTypes)).size !==
        Object.keys(validatedRecordTypes).length
    ) {
        throw new TypeError("formal assurance reference-machine record types must be unique");
    }
    const evidenceRefPrefix = readDigestPrefix(
        proof.evidenceRefPrefix,
        digestAlgorithm,
        "formalAssurance.proofEnvelope.evidenceRefPrefix",
    );
    const programRefPrefix = readDigestPrefix(
        proof.programRefPrefix,
        digestAlgorithm,
        "formalAssurance.proofEnvelope.programRefPrefix",
    );
    const completedTracePrefix = readDigestPrefix(
        traceRefPrefixes.completed,
        digestAlgorithm,
        "formalAssurance.proofEnvelope.traceRefPrefixes.completed",
    );
    const prefixTracePrefix = readDigestPrefix(
        traceRefPrefixes.prefix,
        digestAlgorithm,
        "formalAssurance.proofEnvelope.traceRefPrefixes.prefix",
    );
    if (
        new Set([evidenceRefPrefix, programRefPrefix, completedTracePrefix, prefixTracePrefix])
            .size !== 4
    ) {
        throw new TypeError("formal assurance content-reference prefixes must be unique");
    }
    const theoremIds = readUniqueStrings(
        theoremArtifact.theoremIds,
        "formalAssurance.strongEvidence.theoremArtifact.theoremIds",
    );
    const extensionTheoremIds = readUniqueStrings(
        theoremArtifact.extensionTheoremIds,
        "formalAssurance.strongEvidence.theoremArtifact.extensionTheoremIds",
    );
    if (extensionTheoremIds.some((theoremId) => theoremIds.includes(theoremId))) {
        throw new TypeError("base and extension theorem surfaces must be disjoint");
    }
    const validatedTheoremArtifact = {
        authority: readNonEmptyString(
            theoremArtifact.authority,
            "formalAssurance.strongEvidence.theoremArtifact.authority",
        ),
        buildGate: readNonEmptyString(
            theoremArtifact.buildGate,
            "formalAssurance.strongEvidence.theoremArtifact.buildGate",
        ),
        extensionTheoremIds,
        metadataRefPrefix: readDigestPrefix(
            theoremArtifact.metadataRefPrefix,
            digestAlgorithm,
            "formalAssurance.strongEvidence.theoremArtifact.metadataRefPrefix",
        ),
        revision: readNonEmptyString(
            theoremArtifact.revision,
            "formalAssurance.strongEvidence.theoremArtifact.revision",
        ),
        schemaVersion: readNonEmptyString(
            theoremArtifact.schemaVersion,
            "formalAssurance.strongEvidence.theoremArtifact.schemaVersion",
        ),
        theoremIds,
    };
    const metadataRef = readContentRef(
        theoremArtifact.metadataRef,
        validatedTheoremArtifact.metadataRefPrefix,
        hexLength,
        "formalAssurance.strongEvidence.theoremArtifact.metadataRef",
    );
    const theoremMetadataDigest = createHash(digestAlgorithm)
        .update(
            JSON.stringify({
                authority: validatedTheoremArtifact.authority,
                build_gate: validatedTheoremArtifact.buildGate,
                extension_theorem_ids: extensionTheoremIds,
                revision: validatedTheoremArtifact.revision,
                schema_version: validatedTheoremArtifact.schemaVersion,
                theorem_ids: theoremIds,
            }),
            "utf8",
        )
        .digest("hex");
    if (metadataRef !== `${validatedTheoremArtifact.metadataRefPrefix}${theoremMetadataDigest}`) {
        throw new TypeError("theorem-artifact metadata ref must match its configured content");
    }
    const profileClaims = readArray(
        strong.profileClaims,
        "formalAssurance.strongEvidence.profileClaims",
    ).map((claim, index) => {
        const path = `formalAssurance.strongEvidence.profileClaims[${index}]`;
        const fields = readObject(
            claim,
            [
                "assumptions",
                "forbiddenActionKinds",
                "profile",
                "requiredCaptureActionKind",
                "requiresCore0hSidecar",
                "strength",
                "theoremIds",
            ],
            path,
        );
        const claimTheoremIds = readUniqueStrings(fields.theoremIds, `${path}.theoremIds`);
        if (claimTheoremIds.some((theoremId) => !theoremIds.includes(theoremId))) {
            throw new TypeError(`${path}.theoremIds must belong to the pinned theorem surface`);
        }
        const forbiddenActionKinds = readMembers(
            fields.forbiddenActionKinds,
            actionKinds,
            `${path}.forbiddenActionKinds`,
        );
        const requiredCaptureActionKind =
            fields.requiredCaptureActionKind === null
                ? null
                : readMember(
                      fields.requiredCaptureActionKind,
                      actionKinds,
                      `${path}.requiredCaptureActionKind`,
                  );
        if (
            requiredCaptureActionKind !== null &&
            forbiddenActionKinds.includes(requiredCaptureActionKind)
        ) {
            throw new TypeError(`${path} cannot require and forbid the same capture action`);
        }
        return {
            assumptions: readUniqueStrings(fields.assumptions, `${path}.assumptions`),
            forbiddenActionKinds,
            profile: readMember(fields.profile, profiles, `${path}.profile`),
            requiredCaptureActionKind,
            requiresCore0hSidecar: readBoolean(
                fields.requiresCore0hSidecar,
                `${path}.requiresCore0hSidecar`,
            ),
            strength: readMember(fields.strength, strengths, `${path}.strength`),
            theoremIds: claimTheoremIds,
        };
    });
    if (
        profileClaims.length === 0 ||
        new Set(profileClaims.map((claim) => claim.profile)).size !== profileClaims.length
    ) {
        throw new TypeError("strong proof profile claims must name distinct profiles");
    }
    const loweringContentRefPrefix = readDigestPrefix(
        lowering.contentRefPrefix,
        digestAlgorithm,
        "formalAssurance.strongEvidence.lowering.contentRefPrefix",
    );
    const sourceRefPrefix = readDigestPrefix(
        lowering.sourceRefPrefix,
        digestAlgorithm,
        "formalAssurance.strongEvidence.lowering.sourceRefPrefix",
    );
    const sidecarContentRefPrefix = readDigestPrefix(
        sidecar.contentRefPrefix,
        digestAlgorithm,
        "formalAssurance.strongEvidence.core0hSidecar.contentRefPrefix",
    );
    const handlerRefPrefix = readDigestPrefix(
        sidecar.handlerRefPrefix,
        digestAlgorithm,
        "formalAssurance.strongEvidence.core0hSidecar.handlerRefPrefix",
    );
    const phaseRefPrefix = readDigestPrefix(
        sidecar.phaseRefPrefix,
        digestAlgorithm,
        "formalAssurance.strongEvidence.core0hSidecar.phaseRefPrefix",
    );
    const strongPrefixes = [
        loweringContentRefPrefix,
        sourceRefPrefix,
        sidecarContentRefPrefix,
        handlerRefPrefix,
        phaseRefPrefix,
        validatedTheoremArtifact.metadataRefPrefix,
    ];
    if (new Set(strongPrefixes).size !== strongPrefixes.length) {
        throw new TypeError("strong proof evidence content-reference prefixes must be unique");
    }
    const trustedLoweringRefs = readTrustedRefs(
        lowering.trustedManifestRefs,
        loweringContentRefPrefix,
        hexLength,
        "formalAssurance.strongEvidence.lowering.trustedManifestRefs",
    );
    const trustedSidecarRefs = readTrustedRefs(
        sidecar.trustedManifestRefs,
        sidecarContentRefPrefix,
        hexLength,
        "formalAssurance.strongEvidence.core0hSidecar.trustedManifestRefs",
        true,
    );
    return {
        proofEnvelope: {
            digestAlgorithm,
            evidenceRefPrefix,
            excludedRuntimeSurfaces: readUniqueStrings(
                proof.excludedRuntimeSurfaces,
                "formalAssurance.proofEnvelope.excludedRuntimeSurfaces",
            ),
            hexLength,
            profiles,
            programRefPrefix,
            referenceValidatedProfile,
            referenceValidatedStrength,
            runtimeOnlyProfile,
            runtimeOnlyStrength,
            schemaVersion: readNonEmptyString(
                proof.schemaVersion,
                "formalAssurance.proofEnvelope.schemaVersion",
            ),
            strengths,
            traceRefPrefixes: {
                completed: completedTracePrefix,
                prefix: prefixTracePrefix,
            },
            validationOperations: {
                completed: readNonEmptyString(
                    validationOperations.completed,
                    "formalAssurance.proofEnvelope.validationOperations.completed",
                ),
                prefix: readNonEmptyString(
                    validationOperations.prefix,
                    "formalAssurance.proofEnvelope.validationOperations.prefix",
                ),
            },
            validator: readNonEmptyString(
                proof.validator,
                "formalAssurance.proofEnvelope.validator",
            ),
        },
        referenceMachine: {
            actionKinds,
            closureReasons: readUniqueStrings(
                machine.closureReasons,
                "formalAssurance.referenceMachine.closureReasons",
            ),
            continuationDispositions,
            pathPrefix: readNonEmptyString(
                machine.pathPrefix,
                "formalAssurance.referenceMachine.pathPrefix",
            ),
            profileVersion: readNonEmptyString(
                machine.profileVersion,
                "formalAssurance.referenceMachine.profileVersion",
            ),
            recordTypes: validatedRecordTypes,
            resumptionSourceRecordType: readMember(
                machine.resumptionSourceRecordType,
                Object.values(validatedRecordTypes),
                "formalAssurance.referenceMachine.resumptionSourceRecordType",
            ),
            rootBranchRef: readNonEmptyString(
                machine.rootBranchRef,
                "formalAssurance.referenceMachine.rootBranchRef",
            ),
        },
        strongEvidence: {
            core0hSidecar: {
                contentRefPrefix: sidecarContentRefPrefix,
                handlerRefPrefix,
                phaseRefPrefix,
                schemaVersion: readNonEmptyString(
                    sidecar.schemaVersion,
                    "formalAssurance.strongEvidence.core0hSidecar.schemaVersion",
                ),
                trustedManifestRefs: trustedSidecarRefs,
                validator: readNonEmptyString(
                    sidecar.validator,
                    "formalAssurance.strongEvidence.core0hSidecar.validator",
                ),
            },
            lowering: {
                contentRefPrefix: loweringContentRefPrefix,
                oracle: {
                    path: readNonEmptyString(
                        loweringOracle.path,
                        "formalAssurance.strongEvidence.lowering.oracle.path",
                    ),
                    repository: readNonEmptyString(
                        loweringOracle.repository,
                        "formalAssurance.strongEvidence.lowering.oracle.repository",
                    ),
                    revision: readNonEmptyString(
                        loweringOracle.revision,
                        "formalAssurance.strongEvidence.lowering.oracle.revision",
                    ),
                },
                schemaVersion: readNonEmptyString(
                    lowering.schemaVersion,
                    "formalAssurance.strongEvidence.lowering.schemaVersion",
                ),
                sourceRefPrefix,
                trustedManifestRefs: trustedLoweringRefs,
                validator: readNonEmptyString(
                    lowering.validator,
                    "formalAssurance.strongEvidence.lowering.validator",
                ),
            },
            profileClaims,
            theoremArtifact: {
                ...validatedTheoremArtifact,
                metadataRef,
            },
        },
    };
}

function readBoolean(value: unknown, context: string): boolean {
    if (typeof value !== "boolean") {
        throw new TypeError(`${context} must be boolean`);
    }
    return value;
}

function readMembers(
    value: unknown,
    values: readonly string[],
    context: string,
): readonly string[] {
    const members = readArray(value, context).map((member, index) =>
        readMember(member, values, `${context}[${index}]`),
    );
    if (new Set(members).size !== members.length) {
        throw new TypeError(`${context} must contain unique configured values`);
    }
    return members;
}

function readMember(value: unknown, values: readonly string[], context: string): string {
    const member = readNonEmptyString(value, context);
    if (!values.includes(member)) {
        throw new TypeError(`${context} must belong to its configured value set`);
    }
    return member;
}

function readDigestPrefix(value: unknown, algorithm: string, context: string): string {
    const prefix = readNonEmptyString(value, context);
    if (!prefix.endsWith(`${algorithm}:`)) {
        throw new TypeError(`${context} must identify the configured digest algorithm`);
    }
    return prefix;
}

function readContentRef(
    value: unknown,
    prefix: string,
    hexLength: number,
    context: string,
): string {
    const ref = readNonEmptyString(value, context);
    const digest = ref.slice(prefix.length);
    if (!ref.startsWith(prefix) || digest.length !== hexLength || !/^[0-9a-f]+$/u.test(digest)) {
        throw new TypeError(`${context} must be a configured content reference`);
    }
    return ref;
}

function readTrustedRefs(
    value: unknown,
    prefix: string,
    hexLength: number,
    context: string,
    allowEmpty = false,
): readonly string[] {
    const refs = readArray(value, context).map((ref, index) =>
        readContentRef(ref, prefix, hexLength, `${context}[${index}]`),
    );
    if ((!allowEmpty && refs.length === 0) || new Set(refs).size !== refs.length) {
        throw new TypeError(`${context} must contain unique trusted manifest refs`);
    }
    return refs;
}
