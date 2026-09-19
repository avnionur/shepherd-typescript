import { createHash } from "node:crypto";

import {
    type ProtocolConfig,
    SECURE_HASH_ALGORITHMS,
    STORE_MAINTENANCE_OPERATIONS,
    STORE_WAL_CHECKPOINT_MODES,
} from "./config-types.ts";
import {
    readAbsoluteUrl,
    readEnum,
    readJsonObject,
    readNonEmptyString,
    readObject,
    readPositiveInteger,
    readRequiredTrue,
    readSafeInteger,
    readUniqueStrings,
} from "./config-value-readers.ts";

/** Validates the configured content-addressed identifier contract. */
export function readRecordIdConfig(value: unknown): ProtocolConfig["recordId"] {
    const config = readObject(value, ["algorithm", "hexLength", "prefix"], "recordId");
    const algorithm = readEnum(config.algorithm, SECURE_HASH_ALGORITHMS, "recordId.algorithm");
    const hexLength = readSafeInteger(config.hexLength, "recordId.hexLength");
    if (hexLength !== createHash(algorithm).digest("hex").length) {
        throw new TypeError("recordId.hexLength must match the configured hash algorithm");
    }
    const prefix = readNonEmptyString(config.prefix, "recordId.prefix");
    if (prefix !== `${algorithm}:`) {
        throw new TypeError("recordId.prefix must identify the configured hash algorithm");
    }
    return {
        algorithm,
        hexLength,
        prefix,
    };
}

/** Validates the content-addressed blob identifier and filesystem contract. */
export function readBlobConfig(value: unknown): ProtocolConfig["kernel"]["store"]["blobs"] {
    const config = readObject(
        value,
        [
            "collectionModes",
            "defaultCollectionMode",
            "digestAlgorithm",
            "directorySuffix",
            "fanoutCharacters",
            "fsync",
            "hexLength",
            "idPrefix",
            "receiptVersion",
            "temporaryFilePrefix",
        ],
        "kernel.store.blobs",
    );
    const digestAlgorithm = readEnum(
        config.digestAlgorithm,
        SECURE_HASH_ALGORITHMS,
        "kernel.store.blobs.digestAlgorithm",
    );
    const hexLength = readSafeInteger(config.hexLength, "kernel.store.blobs.hexLength");
    if (hexLength !== createHash(digestAlgorithm).digest("hex").length) {
        throw new TypeError(
            "kernel.store.blobs.hexLength must match the configured hash algorithm",
        );
    }
    const idPrefix = readNonEmptyString(config.idPrefix, "kernel.store.blobs.idPrefix");
    if (idPrefix !== `${digestAlgorithm}:`) {
        throw new TypeError(
            "kernel.store.blobs.idPrefix must identify the configured hash algorithm",
        );
    }
    const fanoutCharacters = readPositiveInteger(
        config.fanoutCharacters,
        "kernel.store.blobs.fanoutCharacters",
    );
    if (fanoutCharacters >= hexLength) {
        throw new TypeError("kernel.store.blobs.fanoutCharacters must be shorter than the digest");
    }
    const directorySuffix = readNonEmptyString(
        config.directorySuffix,
        "kernel.store.blobs.directorySuffix",
    );
    if (pathIsUnsafe(directorySuffix)) {
        throw new TypeError("kernel.store.blobs.directorySuffix must be a simple path suffix");
    }
    const collectionModes = readUniqueStrings(
        config.collectionModes,
        "kernel.store.blobs.collectionModes",
    );
    const defaultCollectionMode = readNonEmptyString(
        config.defaultCollectionMode,
        "kernel.store.blobs.defaultCollectionMode",
    );
    if (!collectionModes.includes(defaultCollectionMode)) {
        throw new TypeError(
            "kernel.store.blobs.defaultCollectionMode must belong to collectionModes",
        );
    }
    const temporaryFilePrefix = readNonEmptyString(
        config.temporaryFilePrefix,
        "kernel.store.blobs.temporaryFilePrefix",
    );
    if (pathIsUnsafe(temporaryFilePrefix)) {
        throw new TypeError("kernel.store.blobs.temporaryFilePrefix must be a simple prefix");
    }
    return {
        collectionModes,
        defaultCollectionMode,
        digestAlgorithm,
        directorySuffix,
        fanoutCharacters,
        fsync: readRequiredTrue(config.fsync, "kernel.store.blobs.fsync"),
        hexLength,
        idPrefix,
        receiptVersion: readPositiveInteger(
            config.receiptVersion,
            "kernel.store.blobs.receiptVersion",
        ),
        temporaryFilePrefix,
    };
}

/** Validates the semantics-preserving store maintenance contract. */
export function readStoreMaintenanceConfig(
    value: unknown,
): ProtocolConfig["kernel"]["store"]["maintenance"] {
    const config = readObject(
        value,
        ["defaultMode", "modes", "quickCheckMaxIssues", "walCheckpointMode", "walFileSuffix"],
        "kernel.store.maintenance",
    );
    const modes = readUniqueStrings(config.modes, "kernel.store.maintenance.modes").map(
        (mode, index) =>
            readEnum(
                mode,
                STORE_MAINTENANCE_OPERATIONS,
                `kernel.store.maintenance.modes[${index}]`,
            ),
    );
    const defaultMode = readEnum(
        config.defaultMode,
        STORE_MAINTENANCE_OPERATIONS,
        "kernel.store.maintenance.defaultMode",
    );
    if (!modes.includes(defaultMode)) {
        throw new TypeError("kernel.store.maintenance.defaultMode must belong to modes");
    }
    const walFileSuffix = readNonEmptyString(
        config.walFileSuffix,
        "kernel.store.maintenance.walFileSuffix",
    );
    if (!/^[A-Za-z0-9._-]+$/u.test(walFileSuffix)) {
        throw new TypeError("kernel.store.maintenance.walFileSuffix must be a simple suffix");
    }
    return {
        defaultMode,
        modes,
        quickCheckMaxIssues: readPositiveInteger(
            config.quickCheckMaxIssues,
            "kernel.store.maintenance.quickCheckMaxIssues",
        ),
        walCheckpointMode: readEnum(
            config.walCheckpointMode,
            STORE_WAL_CHECKPOINT_MODES,
            "kernel.store.maintenance.walCheckpointMode",
        ),
        walFileSuffix,
    };
}

/** Validates configured protocol artifact destinations. */
export function readArtifacts(value: unknown): ProtocolConfig["kernel"]["artifacts"] {
    const artifacts = readObject(
        value,
        [
            "appendBatchDraftSchema",
            "recordBodySchema",
            "recordEnvelopeSchema",
            "recordValues",
            "recordViewSchema",
            "traceArchiveSchema",
        ],
        "kernel.artifacts",
    );
    return {
        appendBatchDraftSchema: readNonEmptyString(
            artifacts.appendBatchDraftSchema,
            "kernel.artifacts.appendBatchDraftSchema",
        ),
        recordBodySchema: readNonEmptyString(
            artifacts.recordBodySchema,
            "kernel.artifacts.recordBodySchema",
        ),
        recordEnvelopeSchema: readNonEmptyString(
            artifacts.recordEnvelopeSchema,
            "kernel.artifacts.recordEnvelopeSchema",
        ),
        recordValues: readNonEmptyString(artifacts.recordValues, "kernel.artifacts.recordValues"),
        recordViewSchema: readNonEmptyString(
            artifacts.recordViewSchema,
            "kernel.artifacts.recordViewSchema",
        ),
        traceArchiveSchema: readNonEmptyString(
            artifacts.traceArchiveSchema,
            "kernel.artifacts.traceArchiveSchema",
        ),
    };
}

/** Validates configured schema identifiers and dialect. */
export function readSchemas(value: unknown): ProtocolConfig["kernel"]["schemas"] {
    const schemas = readObject(
        value,
        [
            "appendBatchDraftId",
            "dialect",
            "recordBodyId",
            "recordEnvelopeId",
            "recordViewId",
            "traceArchiveId",
        ],
        "kernel.schemas",
    );
    const validated = {
        appendBatchDraftId: readAbsoluteUrl(
            schemas.appendBatchDraftId,
            "kernel.schemas.appendBatchDraftId",
        ),
        dialect: readAbsoluteUrl(schemas.dialect, "kernel.schemas.dialect"),
        recordBodyId: readAbsoluteUrl(schemas.recordBodyId, "kernel.schemas.recordBodyId"),
        recordEnvelopeId: readAbsoluteUrl(
            schemas.recordEnvelopeId,
            "kernel.schemas.recordEnvelopeId",
        ),
        recordViewId: readAbsoluteUrl(schemas.recordViewId, "kernel.schemas.recordViewId"),
        traceArchiveId: readAbsoluteUrl(schemas.traceArchiveId, "kernel.schemas.traceArchiveId"),
    };
    const schemaIds = [
        validated.appendBatchDraftId,
        validated.recordBodyId,
        validated.recordEnvelopeId,
        validated.recordViewId,
        validated.traceArchiveId,
    ];
    if (new Set(schemaIds).size !== schemaIds.length) {
        throw new TypeError("kernel schema identifiers must be unique");
    }
    return validated;
}

/** Validates the configured root witness declaration. */
export function readRootWitness(
    value: unknown,
    recordModes: readonly string[],
): ProtocolConfig["kernel"]["rootWitness"] {
    const root = readObject(
        value,
        ["body", "mode", "schemaRef", "witnessRef"],
        "kernel.rootWitness",
    );
    const mode = readNonEmptyString(root.mode, "kernel.rootWitness.mode");
    if (!recordModes.includes(mode)) {
        throw new TypeError("kernel.rootWitness.mode must be a configured record mode");
    }
    if (root.witnessRef !== "") {
        throw new TypeError("kernel.rootWitness.witnessRef must be empty");
    }
    return {
        body: readJsonObject(root.body, "kernel.rootWitness.body"),
        mode,
        schemaRef: readNonEmptyString(root.schemaRef, "kernel.rootWitness.schemaRef"),
        witnessRef: "",
    };
}

function pathIsUnsafe(value: string): boolean {
    return !/^\.[a-z0-9._-]+$/iu.test(value);
}
