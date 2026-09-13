import type { ProtocolConfig } from "./config-types.ts";
import {
    readAbsoluteUrl,
    readNonEmptyString,
    readObject,
    readPositiveInteger,
    readUniqueStrings,
    sameStrings,
} from "./config-value-readers.ts";

/** Validates configured scope kinds, states, authority, identity, limits, errors, and schemas. */
export function readScopeConfig(
    value: unknown,
    grantAtoms: readonly string[],
): ProtocolConfig["scopes"] {
    const scopes = readObject(
        value,
        [
            "artifacts",
            "authority",
            "checkpoint",
            "commandKinds",
            "compatibilityVersion",
            "discardPhases",
            "errors",
            "evidenceKinds",
            "forkPhases",
            "identity",
            "kinds",
            "limits",
            "mergePhases",
            "recordVersion",
            "recovery",
            "scheduling",
            "schemas",
            "states",
            "traceSchemas",
            "vocabulary",
            "worldCapabilities",
            "writerClaimLeaseMilliseconds",
        ],
        "scopes",
    );
    const recovery = readObject(
        scopes.recovery,
        ["classifications", "resumeKinds"],
        "scopes.recovery",
    );
    const recoveryClassifications = readUniqueStrings(
        recovery.classifications,
        "scopes.recovery.classifications",
    );
    if (recoveryClassifications.length !== 7) {
        throw new TypeError(
            "scopes.recovery.classifications must classify terminal, cleanup, merge, fork, expired, held, and idle scopes",
        );
    }
    const resumeKinds = readUniqueStrings(recovery.resumeKinds, "scopes.recovery.resumeKinds");
    if (resumeKinds.length !== 4) {
        throw new TypeError(
            "scopes.recovery.resumeKinds must contain fork, merge, discard, and claim",
        );
    }
    const scheduling = readObject(
        scopes.scheduling,
        [
            "commandSuffixes",
            "decisions",
            "maxDepth",
            "maxNodes",
            "maxParallel",
            "outcomes",
            "pathSeparator",
        ],
        "scopes.scheduling",
    );
    const suffixes = readObject(
        scheduling.commandSuffixes,
        ["create", "discard", "emit", "merge", "writer"],
        "scopes.scheduling.commandSuffixes",
    );
    const suffixValues = (["create", "discard", "emit", "merge", "writer"] as const).map((key) =>
        readNonEmptyString(suffixes[key], `scopes.scheduling.commandSuffixes.${key}`),
    );
    if (new Set(suffixValues).size !== suffixValues.length) {
        throw new TypeError("scopes.scheduling.commandSuffixes must be distinct");
    }
    const decisions = readUniqueStrings(scheduling.decisions, "scopes.scheduling.decisions");
    if (decisions.length !== 2) {
        throw new TypeError("scopes.scheduling.decisions must contain exactly merge and discard");
    }
    const outcomes = readUniqueStrings(scheduling.outcomes, "scopes.scheduling.outcomes");
    if (outcomes.length !== 4) {
        throw new TypeError(
            "scopes.scheduling.outcomes must contain merged, discarded, conflicted, and failed",
        );
    }
    const vocabulary = readObject(
        scopes.vocabulary,
        ["statuses", "terms", "version"],
        "scopes.vocabulary",
    );
    const vocabularyTerms = readUniqueStrings(vocabulary.terms, "scopes.vocabulary.terms");
    if (vocabularyTerms.length !== 4) {
        throw new TypeError(
            "scopes.vocabulary.terms must contain spawn, adopt, abandon, and publish",
        );
    }
    const vocabularyStatuses = readUniqueStrings(vocabulary.statuses, "scopes.vocabulary.statuses");
    if (vocabularyStatuses.length !== 2) {
        throw new TypeError(
            "scopes.vocabulary.statuses must contain exactly pending and completed",
        );
    }
    const artifacts = readObject(
        scopes.artifacts,
        [
            "childMergedSchema",
            "childRegisteredSchema",
            "discardSchema",
            "emissionSchema",
            "forkSchema",
            "mergeSchema",
            "registrationSchema",
        ],
        "scopes.artifacts",
    );
    const authority = readObject(scopes.authority, ["atoms", "resourceKinds"], "scopes.authority");
    const errors = readObject(
        scopes.errors,
        [
            "authorityCode",
            "authorityMessage",
            "evidenceCode",
            "evidenceMessage",
            "headConflictCode",
            "headConflictMessage",
            "mergeConflictCode",
            "mergeConflictMessage",
            "quiescenceCode",
            "quiescenceMessage",
            "terminalConflictCode",
            "terminalConflictMessage",
            "writerConflictCode",
            "writerConflictMessage",
            "writerFencedCode",
            "writerFencedMessage",
        ],
        "scopes.errors",
    );
    const checkpoint = readObject(
        scopes.checkpoint,
        ["constituentKinds", "evidenceStatuses", "startClassifications", "version"],
        "scopes.checkpoint",
    );
    const startClassifications = readObject(
        checkpoint.startClassifications,
        ["captureKinds", "values"],
        "scopes.checkpoint.startClassifications",
    );
    const startValues = readUniqueStrings(
        startClassifications.values,
        "scopes.checkpoint.startClassifications.values",
    );
    if (startValues.length !== 3) {
        throw new TypeError(
            "scopes.checkpoint.startClassifications.values must contain atomic snapshot, quiescent verified copy, and reconstructed",
        );
    }
    const captureKindEntries = Object.entries(
        readObject(
            startClassifications.captureKinds,
            [],
            "scopes.checkpoint.startClassifications.captureKinds",
            true,
        ),
    ).map(([captureKind, classification]) => {
        const value = readNonEmptyString(
            classification,
            `scopes.checkpoint.startClassifications.captureKinds.${captureKind}`,
        );
        if (!startValues.slice(0, 2).includes(value)) {
            throw new TypeError(
                "scopes.checkpoint.startClassifications.captureKinds must map to a non-reconstructed classification",
            );
        }
        return [captureKind, value] as const;
    });
    const identity = readObject(
        scopes.identity,
        [
            "custodyIdentityKind",
            "mergeCustodyIdentityKind",
            "mergeCutIdPrefix",
            "originCutIdPrefix",
            "scopeIdPrefix",
        ],
        "scopes.identity",
    );
    const limits = readObject(
        scopes.limits,
        [
            "maxCitedRecords",
            "maxContributions",
            "maxDataCanonicalBytes",
            "maxDiscardScopes",
            "maxResources",
        ],
        "scopes.limits",
    );
    const schemas = readObject(
        scopes.schemas,
        [
            "childMergedId",
            "childRegisteredId",
            "discardId",
            "emissionId",
            "forkId",
            "mergeId",
            "registrationId",
        ],
        "scopes.schemas",
    );
    const traceSchemas = readObject(
        scopes.traceSchemas,
        ["childMerged", "childRegistered", "discard", "emission", "fork", "merge", "registration"],
        "scopes.traceSchemas",
    );
    const atoms = readUniqueStrings(authority.atoms, "scopes.authority.atoms");
    if (!sameStrings(atoms, grantAtoms)) {
        throw new TypeError(
            "scopes.authority.atoms must equal the configured repository grant atoms",
        );
    }
    const kinds = readUniqueStrings(scopes.kinds, "scopes.kinds");
    if (kinds.length !== 2) {
        throw new TypeError("scopes.kinds must contain exactly a root kind and a child kind");
    }
    const commandKinds = readUniqueStrings(scopes.commandKinds, "scopes.commandKinds");
    if (commandKinds.length !== 6) {
        throw new TypeError(
            "scopes.commandKinds must classify root registration, child registration, emission, fork, merge, and discard",
        );
    }
    const forkPhases = readUniqueStrings(scopes.forkPhases, "scopes.forkPhases");
    if (forkPhases.length !== 2) {
        throw new TypeError("scopes.forkPhases must contain exactly prepared and completed");
    }
    const mergePhases = readUniqueStrings(scopes.mergePhases, "scopes.mergePhases");
    if (mergePhases.length !== 2) {
        throw new TypeError("scopes.mergePhases must contain exactly prepared and completed");
    }
    const discardPhases = readUniqueStrings(scopes.discardPhases, "scopes.discardPhases");
    if (discardPhases.length !== 2) {
        throw new TypeError("scopes.discardPhases must contain exactly decided and cleaned");
    }
    const worldCapabilities = readUniqueStrings(
        scopes.worldCapabilities,
        "scopes.worldCapabilities",
    );
    if (worldCapabilities.length !== 2) {
        throw new TypeError(
            "scopes.worldCapabilities must contain exactly trace-only and reference-copy",
        );
    }
    const checkpointConstituentKinds = readUniqueStrings(
        checkpoint.constituentKinds,
        "scopes.checkpoint.constituentKinds",
    );
    if (checkpointConstituentKinds.length !== 10) {
        throw new TypeError(
            "scopes.checkpoint.constituentKinds must classify trace cut, execution, binding, world, grants, child frontier, budget, provider session, process, and irreversible effects",
        );
    }
    const checkpointEvidenceStatuses = readUniqueStrings(
        checkpoint.evidenceStatuses,
        "scopes.checkpoint.evidenceStatuses",
    );
    if (checkpointEvidenceStatuses.length !== 4) {
        throw new TypeError(
            "scopes.checkpoint.evidenceStatuses must contain verified, reconstructive, not applicable, and unavailable",
        );
    }
    const states = readUniqueStrings(scopes.states, "scopes.states");
    if (states.length !== 3) {
        throw new TypeError("scopes.states must contain exactly open, merged, and discarded");
    }
    const evidenceKinds = readUniqueStrings(scopes.evidenceKinds, "scopes.evidenceKinds");
    if (evidenceKinds.length !== 12) {
        throw new TypeError(
            "scopes.evidenceKinds must classify registration, origin cut, child registration, emission, fork, merge, and discard evidence",
        );
    }
    const traceSchemaValues = [
        readNonEmptyString(traceSchemas.childMerged, "scopes.traceSchemas.childMerged"),
        readNonEmptyString(traceSchemas.childRegistered, "scopes.traceSchemas.childRegistered"),
        readNonEmptyString(traceSchemas.discard, "scopes.traceSchemas.discard"),
        readNonEmptyString(traceSchemas.emission, "scopes.traceSchemas.emission"),
        readNonEmptyString(traceSchemas.fork, "scopes.traceSchemas.fork"),
        readNonEmptyString(traceSchemas.merge, "scopes.traceSchemas.merge"),
        readNonEmptyString(traceSchemas.registration, "scopes.traceSchemas.registration"),
    ];
    if (new Set(traceSchemaValues).size !== traceSchemaValues.length) {
        throw new TypeError("scopes.traceSchemas must be distinct");
    }
    return {
        artifacts: {
            childMergedSchema: readNonEmptyString(
                artifacts.childMergedSchema,
                "scopes.artifacts.childMergedSchema",
            ),
            childRegisteredSchema: readNonEmptyString(
                artifacts.childRegisteredSchema,
                "scopes.artifacts.childRegisteredSchema",
            ),
            discardSchema: readNonEmptyString(
                artifacts.discardSchema,
                "scopes.artifacts.discardSchema",
            ),
            emissionSchema: readNonEmptyString(
                artifacts.emissionSchema,
                "scopes.artifacts.emissionSchema",
            ),
            forkSchema: readNonEmptyString(artifacts.forkSchema, "scopes.artifacts.forkSchema"),
            mergeSchema: readNonEmptyString(artifacts.mergeSchema, "scopes.artifacts.mergeSchema"),
            registrationSchema: readNonEmptyString(
                artifacts.registrationSchema,
                "scopes.artifacts.registrationSchema",
            ),
        },
        authority: {
            atoms,
            resourceKinds: readUniqueStrings(
                authority.resourceKinds,
                "scopes.authority.resourceKinds",
            ),
        },
        checkpoint: {
            constituentKinds: checkpointConstituentKinds,
            evidenceStatuses: checkpointEvidenceStatuses,
            startClassifications: {
                captureKinds: Object.freeze(Object.fromEntries(captureKindEntries)),
                values: startValues,
            },
            version: readPositiveInteger(checkpoint.version, "scopes.checkpoint.version"),
        },
        commandKinds,
        compatibilityVersion: readNonEmptyString(
            scopes.compatibilityVersion,
            "scopes.compatibilityVersion",
        ),
        discardPhases,
        errors: {
            authorityCode: readNonEmptyString(errors.authorityCode, "scopes.errors.authorityCode"),
            authorityMessage: readNonEmptyString(
                errors.authorityMessage,
                "scopes.errors.authorityMessage",
            ),
            evidenceCode: readNonEmptyString(errors.evidenceCode, "scopes.errors.evidenceCode"),
            evidenceMessage: readNonEmptyString(
                errors.evidenceMessage,
                "scopes.errors.evidenceMessage",
            ),
            headConflictCode: readNonEmptyString(
                errors.headConflictCode,
                "scopes.errors.headConflictCode",
            ),
            headConflictMessage: readNonEmptyString(
                errors.headConflictMessage,
                "scopes.errors.headConflictMessage",
            ),
            mergeConflictCode: readNonEmptyString(
                errors.mergeConflictCode,
                "scopes.errors.mergeConflictCode",
            ),
            mergeConflictMessage: readNonEmptyString(
                errors.mergeConflictMessage,
                "scopes.errors.mergeConflictMessage",
            ),
            quiescenceCode: readNonEmptyString(
                errors.quiescenceCode,
                "scopes.errors.quiescenceCode",
            ),
            quiescenceMessage: readNonEmptyString(
                errors.quiescenceMessage,
                "scopes.errors.quiescenceMessage",
            ),
            terminalConflictCode: readNonEmptyString(
                errors.terminalConflictCode,
                "scopes.errors.terminalConflictCode",
            ),
            terminalConflictMessage: readNonEmptyString(
                errors.terminalConflictMessage,
                "scopes.errors.terminalConflictMessage",
            ),
            writerConflictCode: readNonEmptyString(
                errors.writerConflictCode,
                "scopes.errors.writerConflictCode",
            ),
            writerConflictMessage: readNonEmptyString(
                errors.writerConflictMessage,
                "scopes.errors.writerConflictMessage",
            ),
            writerFencedCode: readNonEmptyString(
                errors.writerFencedCode,
                "scopes.errors.writerFencedCode",
            ),
            writerFencedMessage: readNonEmptyString(
                errors.writerFencedMessage,
                "scopes.errors.writerFencedMessage",
            ),
        },
        evidenceKinds,
        forkPhases,
        identity: {
            custodyIdentityKind: readNonEmptyString(
                identity.custodyIdentityKind,
                "scopes.identity.custodyIdentityKind",
            ),
            mergeCustodyIdentityKind: readNonEmptyString(
                identity.mergeCustodyIdentityKind,
                "scopes.identity.mergeCustodyIdentityKind",
            ),
            mergeCutIdPrefix: readNonEmptyString(
                identity.mergeCutIdPrefix,
                "scopes.identity.mergeCutIdPrefix",
            ),
            originCutIdPrefix: readNonEmptyString(
                identity.originCutIdPrefix,
                "scopes.identity.originCutIdPrefix",
            ),
            scopeIdPrefix: readNonEmptyString(
                identity.scopeIdPrefix,
                "scopes.identity.scopeIdPrefix",
            ),
        },
        kinds,
        limits: {
            maxCitedRecords: readPositiveInteger(
                limits.maxCitedRecords,
                "scopes.limits.maxCitedRecords",
            ),
            maxContributions: readPositiveInteger(
                limits.maxContributions,
                "scopes.limits.maxContributions",
            ),
            maxDataCanonicalBytes: readPositiveInteger(
                limits.maxDataCanonicalBytes,
                "scopes.limits.maxDataCanonicalBytes",
            ),
            maxDiscardScopes: readPositiveInteger(
                limits.maxDiscardScopes,
                "scopes.limits.maxDiscardScopes",
            ),
            maxResources: readPositiveInteger(limits.maxResources, "scopes.limits.maxResources"),
        },
        mergePhases,
        recordVersion: readPositiveInteger(scopes.recordVersion, "scopes.recordVersion"),
        schemas: {
            childMergedId: readAbsoluteUrl(schemas.childMergedId, "scopes.schemas.childMergedId"),
            childRegisteredId: readAbsoluteUrl(
                schemas.childRegisteredId,
                "scopes.schemas.childRegisteredId",
            ),
            discardId: readAbsoluteUrl(schemas.discardId, "scopes.schemas.discardId"),
            emissionId: readAbsoluteUrl(schemas.emissionId, "scopes.schemas.emissionId"),
            forkId: readAbsoluteUrl(schemas.forkId, "scopes.schemas.forkId"),
            mergeId: readAbsoluteUrl(schemas.mergeId, "scopes.schemas.mergeId"),
            registrationId: readAbsoluteUrl(
                schemas.registrationId,
                "scopes.schemas.registrationId",
            ),
        },
        recovery: { classifications: recoveryClassifications, resumeKinds },
        scheduling: {
            commandSuffixes: {
                create: suffixValues[0] as string,
                discard: suffixValues[1] as string,
                emit: suffixValues[2] as string,
                merge: suffixValues[3] as string,
                writer: suffixValues[4] as string,
            },
            decisions,
            maxDepth: readPositiveInteger(scheduling.maxDepth, "scopes.scheduling.maxDepth"),
            maxNodes: readPositiveInteger(scheduling.maxNodes, "scopes.scheduling.maxNodes"),
            maxParallel: readPositiveInteger(
                scheduling.maxParallel,
                "scopes.scheduling.maxParallel",
            ),
            outcomes,
            pathSeparator: readNonEmptyString(
                scheduling.pathSeparator,
                "scopes.scheduling.pathSeparator",
            ),
        },
        states,
        traceSchemas: {
            childMerged: traceSchemaValues[0] as string,
            childRegistered: traceSchemaValues[1] as string,
            discard: traceSchemaValues[2] as string,
            emission: traceSchemaValues[3] as string,
            fork: traceSchemaValues[4] as string,
            merge: traceSchemaValues[5] as string,
            registration: traceSchemaValues[6] as string,
        },
        vocabulary: {
            statuses: vocabularyStatuses,
            terms: vocabularyTerms,
            version: readPositiveInteger(vocabulary.version, "scopes.vocabulary.version"),
        },
        worldCapabilities,
        writerClaimLeaseMilliseconds: readPositiveInteger(
            scopes.writerClaimLeaseMilliseconds,
            "scopes.writerClaimLeaseMilliseconds",
        ),
    };
}
