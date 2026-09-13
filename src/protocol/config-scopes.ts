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
            "errors",
            "evidenceKinds",
            "forkPhases",
            "identity",
            "kinds",
            "limits",
            "recordVersion",
            "schemas",
            "states",
            "traceSchemas",
            "worldCapabilities",
            "writerClaimLeaseMilliseconds",
        ],
        "scopes",
    );
    const artifacts = readObject(
        scopes.artifacts,
        ["childRegisteredSchema", "emissionSchema", "forkSchema", "registrationSchema"],
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
            "writerConflictCode",
            "writerConflictMessage",
            "writerFencedCode",
            "writerFencedMessage",
        ],
        "scopes.errors",
    );
    const checkpoint = readObject(
        scopes.checkpoint,
        ["constituentKinds", "evidenceStatuses", "version"],
        "scopes.checkpoint",
    );
    const identity = readObject(
        scopes.identity,
        ["custodyIdentityKind", "originCutIdPrefix", "scopeIdPrefix"],
        "scopes.identity",
    );
    const limits = readObject(
        scopes.limits,
        ["maxCitedRecords", "maxDataCanonicalBytes", "maxResources"],
        "scopes.limits",
    );
    const schemas = readObject(
        scopes.schemas,
        ["childRegisteredId", "emissionId", "forkId", "registrationId"],
        "scopes.schemas",
    );
    const traceSchemas = readObject(
        scopes.traceSchemas,
        ["childRegistered", "emission", "fork", "registration"],
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
    if (commandKinds.length !== 4) {
        throw new TypeError(
            "scopes.commandKinds must classify root registration, child registration, emission, and fork",
        );
    }
    const forkPhases = readUniqueStrings(scopes.forkPhases, "scopes.forkPhases");
    if (forkPhases.length !== 2) {
        throw new TypeError("scopes.forkPhases must contain exactly prepared and completed");
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
    if (evidenceKinds.length !== 6) {
        throw new TypeError(
            "scopes.evidenceKinds must classify registration, origin cut, child registration, emission, and fork phases",
        );
    }
    const traceSchemaValues = [
        readNonEmptyString(traceSchemas.childRegistered, "scopes.traceSchemas.childRegistered"),
        readNonEmptyString(traceSchemas.emission, "scopes.traceSchemas.emission"),
        readNonEmptyString(traceSchemas.fork, "scopes.traceSchemas.fork"),
        readNonEmptyString(traceSchemas.registration, "scopes.traceSchemas.registration"),
    ];
    if (new Set(traceSchemaValues).size !== traceSchemaValues.length) {
        throw new TypeError("scopes.traceSchemas must be distinct");
    }
    return {
        artifacts: {
            childRegisteredSchema: readNonEmptyString(
                artifacts.childRegisteredSchema,
                "scopes.artifacts.childRegisteredSchema",
            ),
            emissionSchema: readNonEmptyString(
                artifacts.emissionSchema,
                "scopes.artifacts.emissionSchema",
            ),
            forkSchema: readNonEmptyString(artifacts.forkSchema, "scopes.artifacts.forkSchema"),
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
            version: readPositiveInteger(checkpoint.version, "scopes.checkpoint.version"),
        },
        commandKinds,
        compatibilityVersion: readNonEmptyString(
            scopes.compatibilityVersion,
            "scopes.compatibilityVersion",
        ),
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
            maxDataCanonicalBytes: readPositiveInteger(
                limits.maxDataCanonicalBytes,
                "scopes.limits.maxDataCanonicalBytes",
            ),
            maxResources: readPositiveInteger(limits.maxResources, "scopes.limits.maxResources"),
        },
        recordVersion: readPositiveInteger(scopes.recordVersion, "scopes.recordVersion"),
        schemas: {
            childRegisteredId: readAbsoluteUrl(
                schemas.childRegisteredId,
                "scopes.schemas.childRegisteredId",
            ),
            emissionId: readAbsoluteUrl(schemas.emissionId, "scopes.schemas.emissionId"),
            forkId: readAbsoluteUrl(schemas.forkId, "scopes.schemas.forkId"),
            registrationId: readAbsoluteUrl(
                schemas.registrationId,
                "scopes.schemas.registrationId",
            ),
        },
        states,
        traceSchemas: {
            childRegistered: traceSchemaValues[0] as string,
            emission: traceSchemaValues[1] as string,
            fork: traceSchemaValues[2] as string,
            registration: traceSchemaValues[3] as string,
        },
        worldCapabilities,
        writerClaimLeaseMilliseconds: readPositiveInteger(
            scopes.writerClaimLeaseMilliseconds,
            "scopes.writerClaimLeaseMilliseconds",
        ),
    };
}
