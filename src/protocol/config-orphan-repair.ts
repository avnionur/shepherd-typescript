import { createHash } from "node:crypto";

import { type ProtocolConfig, SECURE_HASH_ALGORITHMS } from "./config-types.ts";
import {
    readAbsoluteUrl,
    readEnum,
    readNonEmptyString,
    readObject,
    readPositiveInteger,
} from "./config-value-readers.ts";

/** Validates versioned bounded orphaned-operation diagnosis and repair configuration. */
export function readOrphanRepairConfig(value: unknown): ProtocolConfig["orphanRepair"] {
    const config = readObject(
        value,
        [
            "artifacts",
            "blockers",
            "compatibilityVersion",
            "errors",
            "identity",
            "limits",
            "schemas",
            "statuses",
            "traceSchemas",
            "versions",
        ],
        "orphanRepair",
    );
    const artifacts = readObject(
        config.artifacts,
        ["commandSchema", "diagnosisSchema", "receiptSchema"],
        "orphanRepair.artifacts",
    );
    const blockers = readObject(
        config.blockers,
        ["liveSession", "providerStarted", "scopeOwned"],
        "orphanRepair.blockers",
    );
    const errors = readObject(
        config.errors,
        [
            "blockedCode",
            "blockedMessage",
            "commandConflictCode",
            "commandConflictMessage",
            "corruptCode",
            "corruptMessage",
            "staleCode",
            "staleMessage",
            "unsupportedCode",
            "unsupportedMessage",
        ],
        "orphanRepair.errors",
    );
    const identity = readObject(
        config.identity,
        [
            "algorithm",
            "commandAppendIntentPrefix",
            "commandOwnerPrefix",
            "diagnosisPrefix",
            "hexLength",
            "receiptAppendIntentPrefix",
            "receiptPrefix",
        ],
        "orphanRepair.identity",
    );
    const limits = readObject(
        config.limits,
        [
            "defaultPageSize",
            "maxCanonicalBytes",
            "maxCauseBytes",
            "maxIdentifierBytes",
            "maxOperations",
            "maxPageSize",
        ],
        "orphanRepair.limits",
    );
    const schemas = readObject(
        config.schemas,
        ["commandId", "diagnosisId", "receiptId"],
        "orphanRepair.schemas",
    );
    const statuses = readObject(config.statuses, ["preRun", "session"], "orphanRepair.statuses");
    const preRunStatuses = readObject(
        statuses.preRun,
        ["declined", "repaired"],
        "orphanRepair.statuses.preRun",
    );
    const sessionStatuses = readObject(
        statuses.session,
        ["dead", "live"],
        "orphanRepair.statuses.session",
    );
    const traceSchemas = readObject(
        config.traceSchemas,
        ["command", "receipt"],
        "orphanRepair.traceSchemas",
    );
    const versions = readObject(
        config.versions,
        ["command", "diagnosis", "operation", "receipt"],
        "orphanRepair.versions",
    );
    const algorithm = readEnum(
        identity.algorithm,
        SECURE_HASH_ALGORITHMS,
        "orphanRepair.identity.algorithm",
    );
    const hexLength = readPositiveInteger(identity.hexLength, "orphanRepair.identity.hexLength");
    if (hexLength !== createHash(algorithm).digest("hex").length) {
        throw new TypeError("orphanRepair.identity.hexLength must match the digest algorithm");
    }
    const maxPageSize = readPositiveInteger(limits.maxPageSize, "orphanRepair.limits.maxPageSize");
    const maxOperations = readPositiveInteger(
        limits.maxOperations,
        "orphanRepair.limits.maxOperations",
    );
    const defaultPageSize = readPositiveInteger(
        limits.defaultPageSize,
        "orphanRepair.limits.defaultPageSize",
    );
    if (defaultPageSize > maxPageSize || maxPageSize > maxOperations) {
        throw new TypeError("orphanRepair page limits must be ordered within maxOperations");
    }
    const blockerValues = {
        liveSession: readNonEmptyString(blockers.liveSession, "orphanRepair.blockers.liveSession"),
        providerStarted: readNonEmptyString(
            blockers.providerStarted,
            "orphanRepair.blockers.providerStarted",
        ),
        scopeOwned: readNonEmptyString(blockers.scopeOwned, "orphanRepair.blockers.scopeOwned"),
    };
    if (new Set(Object.values(blockerValues)).size !== Object.keys(blockerValues).length) {
        throw new TypeError("orphanRepair blocker codes must be unique");
    }
    const statusValues = {
        preRun: {
            declined: readNonEmptyString(
                preRunStatuses.declined,
                "orphanRepair.statuses.preRun.declined",
            ),
            repaired: readNonEmptyString(
                preRunStatuses.repaired,
                "orphanRepair.statuses.preRun.repaired",
            ),
        },
        session: {
            dead: readNonEmptyString(sessionStatuses.dead, "orphanRepair.statuses.session.dead"),
            live: readNonEmptyString(sessionStatuses.live, "orphanRepair.statuses.session.live"),
        },
    };
    if (
        statusValues.preRun.declined === statusValues.preRun.repaired ||
        statusValues.session.dead === statusValues.session.live
    ) {
        throw new TypeError("orphanRepair status discriminants must be distinct");
    }
    return {
        artifacts: {
            commandSchema: readNonEmptyString(
                artifacts.commandSchema,
                "orphanRepair.artifacts.commandSchema",
            ),
            diagnosisSchema: readNonEmptyString(
                artifacts.diagnosisSchema,
                "orphanRepair.artifacts.diagnosisSchema",
            ),
            receiptSchema: readNonEmptyString(
                artifacts.receiptSchema,
                "orphanRepair.artifacts.receiptSchema",
            ),
        },
        blockers: blockerValues,
        compatibilityVersion: readNonEmptyString(
            config.compatibilityVersion,
            "orphanRepair.compatibilityVersion",
        ),
        errors: {
            blockedCode: readNonEmptyString(errors.blockedCode, "orphanRepair.errors.blockedCode"),
            blockedMessage: readNonEmptyString(
                errors.blockedMessage,
                "orphanRepair.errors.blockedMessage",
            ),
            commandConflictCode: readNonEmptyString(
                errors.commandConflictCode,
                "orphanRepair.errors.commandConflictCode",
            ),
            commandConflictMessage: readNonEmptyString(
                errors.commandConflictMessage,
                "orphanRepair.errors.commandConflictMessage",
            ),
            corruptCode: readNonEmptyString(errors.corruptCode, "orphanRepair.errors.corruptCode"),
            corruptMessage: readNonEmptyString(
                errors.corruptMessage,
                "orphanRepair.errors.corruptMessage",
            ),
            staleCode: readNonEmptyString(errors.staleCode, "orphanRepair.errors.staleCode"),
            staleMessage: readNonEmptyString(
                errors.staleMessage,
                "orphanRepair.errors.staleMessage",
            ),
            unsupportedCode: readNonEmptyString(
                errors.unsupportedCode,
                "orphanRepair.errors.unsupportedCode",
            ),
            unsupportedMessage: readNonEmptyString(
                errors.unsupportedMessage,
                "orphanRepair.errors.unsupportedMessage",
            ),
        },
        identity: {
            algorithm,
            commandAppendIntentPrefix: readNonEmptyString(
                identity.commandAppendIntentPrefix,
                "orphanRepair.identity.commandAppendIntentPrefix",
            ),
            commandOwnerPrefix: readNonEmptyString(
                identity.commandOwnerPrefix,
                "orphanRepair.identity.commandOwnerPrefix",
            ),
            diagnosisPrefix: readNonEmptyString(
                identity.diagnosisPrefix,
                "orphanRepair.identity.diagnosisPrefix",
            ),
            hexLength,
            receiptAppendIntentPrefix: readNonEmptyString(
                identity.receiptAppendIntentPrefix,
                "orphanRepair.identity.receiptAppendIntentPrefix",
            ),
            receiptPrefix: readNonEmptyString(
                identity.receiptPrefix,
                "orphanRepair.identity.receiptPrefix",
            ),
        },
        limits: {
            defaultPageSize,
            maxCanonicalBytes: readPositiveInteger(
                limits.maxCanonicalBytes,
                "orphanRepair.limits.maxCanonicalBytes",
            ),
            maxCauseBytes: readPositiveInteger(
                limits.maxCauseBytes,
                "orphanRepair.limits.maxCauseBytes",
            ),
            maxIdentifierBytes: readPositiveInteger(
                limits.maxIdentifierBytes,
                "orphanRepair.limits.maxIdentifierBytes",
            ),
            maxOperations,
            maxPageSize,
        },
        schemas: {
            commandId: readAbsoluteUrl(schemas.commandId, "orphanRepair.schemas.commandId"),
            diagnosisId: readAbsoluteUrl(schemas.diagnosisId, "orphanRepair.schemas.diagnosisId"),
            receiptId: readAbsoluteUrl(schemas.receiptId, "orphanRepair.schemas.receiptId"),
        },
        statuses: statusValues,
        traceSchemas: {
            command: readNonEmptyString(traceSchemas.command, "orphanRepair.traceSchemas.command"),
            receipt: readNonEmptyString(traceSchemas.receipt, "orphanRepair.traceSchemas.receipt"),
        },
        versions: {
            command: readPositiveInteger(versions.command, "orphanRepair.versions.command"),
            diagnosis: readPositiveInteger(versions.diagnosis, "orphanRepair.versions.diagnosis"),
            operation: readPositiveInteger(versions.operation, "orphanRepair.versions.operation"),
            receipt: readPositiveInteger(versions.receipt, "orphanRepair.versions.receipt"),
        },
    };
}
