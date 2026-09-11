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
            "commandKinds",
            "compatibilityVersion",
            "errors",
            "evidenceKinds",
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
        ["childRegisteredSchema", "emissionSchema", "registrationSchema"],
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
    const identity = readObject(
        scopes.identity,
        ["originCutIdPrefix", "scopeIdPrefix"],
        "scopes.identity",
    );
    const limits = readObject(
        scopes.limits,
        ["maxCitedRecords", "maxDataCanonicalBytes", "maxResources"],
        "scopes.limits",
    );
    const schemas = readObject(
        scopes.schemas,
        ["childRegisteredId", "emissionId", "registrationId"],
        "scopes.schemas",
    );
    const traceSchemas = readObject(
        scopes.traceSchemas,
        ["childRegistered", "emission", "registration"],
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
    if (commandKinds.length !== 3) {
        throw new TypeError(
            "scopes.commandKinds must classify root registration, child registration, and emission",
        );
    }
    const states = readUniqueStrings(scopes.states, "scopes.states");
    if (states.length !== 3) {
        throw new TypeError("scopes.states must contain exactly open, merged, and discarded");
    }
    const evidenceKinds = readUniqueStrings(scopes.evidenceKinds, "scopes.evidenceKinds");
    if (evidenceKinds.length !== 4) {
        throw new TypeError(
            "scopes.evidenceKinds must classify registration, origin cut, child registration, and emission",
        );
    }
    const traceSchemaValues = [
        readNonEmptyString(traceSchemas.childRegistered, "scopes.traceSchemas.childRegistered"),
        readNonEmptyString(traceSchemas.emission, "scopes.traceSchemas.emission"),
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
        identity: {
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
            registrationId: readAbsoluteUrl(
                schemas.registrationId,
                "scopes.schemas.registrationId",
            ),
        },
        states,
        traceSchemas: {
            childRegistered: traceSchemaValues[0] as string,
            emission: traceSchemaValues[1] as string,
            registration: traceSchemaValues[2] as string,
        },
        worldCapabilities: readUniqueStrings(scopes.worldCapabilities, "scopes.worldCapabilities"),
        writerClaimLeaseMilliseconds: readPositiveInteger(
            scopes.writerClaimLeaseMilliseconds,
            "scopes.writerClaimLeaseMilliseconds",
        ),
    };
}
