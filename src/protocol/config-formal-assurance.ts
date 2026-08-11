import { createHash } from "node:crypto";

import type { ProtocolConfig } from "./config-types.ts";
import { SECURE_HASH_ALGORITHMS } from "./config-types.ts";
import {
    readEnum,
    readNonEmptyString,
    readObject,
    readPositiveInteger,
    readUniqueStrings,
} from "./config-value-readers.ts";

/** Validates executable reference-machine and proof-envelope configuration. */
export function readFormalAssuranceConfig(value: unknown): ProtocolConfig["formalAssurance"] {
    const config = readObject(value, ["proofEnvelope", "referenceMachine"], "formalAssurance");
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
    };
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
