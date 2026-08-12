import { createHash } from "node:crypto";

import { type ProtocolConfig, SECURE_HASH_ALGORITHMS } from "./config-types.ts";
import {
    readEnum,
    readNonEmptyString,
    readObject,
    readPositiveInteger,
    readUniqueStrings,
} from "./config-value-readers.ts";

/** Validates workspace initialization and adoption configuration. */
export function readWorkspaceConfig(value: unknown): ProtocolConfig["workspaces"] {
    const config = readObject(
        value,
        [
            "adoptionModes",
            "bindingErrors",
            "bindingIdentityKind",
            "bindingVersion",
            "carrier",
            "changesets",
            "controlDirectory",
            "defaultAdoptionMode",
            "defaultInitializeGit",
            "digestAlgorithm",
            "errors",
            "format",
            "formatVersion",
            "gitExecutable",
            "gitCustody",
            "gitHeadRefPrefix",
            "gitMetadataName",
            "hexLength",
            "manifestFile",
            "worktreeRefPrefix",
            "worldCapture",
        ],
        "workspaces",
    );
    const errors = readObject(
        config.errors,
        ["conflictCode", "conflictMessage", "controlCode", "controlMessage"],
        "workspaces.errors",
    );
    const bindingErrors = readObject(
        config.bindingErrors,
        [
            "authorityEscapeCode",
            "authorityEscapeMessage",
            "duplicateNameCode",
            "duplicateNameMessage",
            "invalidNameCode",
            "invalidNameMessage",
            "invalidRootCode",
            "invalidRootMessage",
            "rootOverlapCode",
            "rootOverlapMessage",
        ],
        "workspaces.bindingErrors",
    );
    const carrier = readObject(
        config.carrier,
        [
            "backendKind",
            "blobIdPrefix",
            "carrierDirectory",
            "captureKind",
            "custodiesDirectory",
            "custodyDescriptorFile",
            "custodyIdPrefix",
            "descriptorFormat",
            "descriptorVersion",
            "discardDescriptorSuffix",
            "discardStatus",
            "discardedDirectory",
            "entryKinds",
            "errors",
            "manifestVersion",
            "revisionsDirectory",
            "revisionDescriptorFile",
            "revisionIdPrefix",
            "stagingDirectory",
            "worldContentIdPrefix",
            "worldDirectory",
        ],
        "workspaces.carrier",
    );
    const carrierErrors = readObject(
        carrier.errors,
        [
            "conflictCode",
            "conflictMessage",
            "controlCode",
            "controlMessage",
            "unsupportedCode",
            "unsupportedMessage",
        ],
        "workspaces.carrier.errors",
    );
    const changesets = readObject(
        config.changesets,
        [
            "errors",
            "idPrefix",
            "maxAggregateReferencedBytes",
            "maxChanges",
            "maxManifestEntries",
            "maxManifestRecordBytes",
            "maxPathBytes",
            "maxRecordBytes",
            "maxSingleBlobBytes",
            "maxSymlinkTargetBytes",
            "operations",
            "version",
        ],
        "workspaces.changesets",
    );
    const changesetErrors = readObject(
        changesets.errors,
        ["invalidCode", "invalidMessage", "limitCode", "limitMessage"],
        "workspaces.changesets.errors",
    );
    const gitCustody = readObject(
        config.gitCustody,
        [
            "archiveExecutable",
            "basisIdPrefix",
            "descriptorFile",
            "descriptorFormat",
            "descriptorVersion",
            "errors",
            "headKinds",
            "identityFile",
            "identityFormat",
            "indexIdPrefix",
            "indexReceiptFile",
            "maxCommandBytes",
            "objectPackFile",
            "objectPackIdPrefix",
            "objectFormats",
            "repositoryIdPrefix",
            "repositoryIdentityFile",
            "repositoryLockAttempts",
            "repositoryLockDelayMs",
            "repositoryLockPrefix",
            "stagingDirectory",
            "version",
            "worktreeIdPrefix",
        ],
        "workspaces.gitCustody",
    );
    const gitCustodyErrors = readObject(
        gitCustody.errors,
        [
            "baselineUnavailableCode",
            "baselineUnavailableMessage",
            "controlCode",
            "controlMessage",
            "movementCode",
            "movementMessage",
            "unsupportedCode",
            "unsupportedMessage",
        ],
        "workspaces.gitCustody.errors",
    );
    const worldCapture = readObject(
        config.worldCapture,
        ["maxRevisionDepth", "version"],
        "workspaces.worldCapture",
    );
    const adoptionModes = readUniqueStrings(config.adoptionModes, "workspaces.adoptionModes");
    const defaultAdoptionMode = readNonEmptyString(
        config.defaultAdoptionMode,
        "workspaces.defaultAdoptionMode",
    );
    if (!adoptionModes.includes(defaultAdoptionMode)) {
        throw new TypeError("workspaces.defaultAdoptionMode must belong to adoptionModes");
    }
    if (typeof config.defaultInitializeGit !== "boolean") {
        throw new TypeError("workspaces.defaultInitializeGit must be boolean");
    }
    const controlDirectory = readSimpleName(config.controlDirectory, "workspaces.controlDirectory");
    const manifestFile = readSimpleName(config.manifestFile, "workspaces.manifestFile");
    const gitMetadataName = readSimpleName(config.gitMetadataName, "workspaces.gitMetadataName");
    if (
        controlDirectory === manifestFile ||
        controlDirectory === gitMetadataName ||
        manifestFile === gitMetadataName
    ) {
        throw new TypeError("workspace reserved path names must differ");
    }
    const digestAlgorithm = readEnum(
        config.digestAlgorithm,
        SECURE_HASH_ALGORITHMS,
        "workspaces.digestAlgorithm",
    );
    const hexLength = readPositiveInteger(config.hexLength, "workspaces.hexLength");
    if (hexLength !== createHash(digestAlgorithm).digest("hex").length) {
        throw new TypeError("workspaces.hexLength must match digestAlgorithm");
    }
    const worktreeRefPrefix = readNonEmptyString(
        config.worktreeRefPrefix,
        "workspaces.worktreeRefPrefix",
    );
    if (!worktreeRefPrefix.endsWith(`${digestAlgorithm}:`)) {
        throw new TypeError("workspaces.worktreeRefPrefix must identify digestAlgorithm");
    }
    const carrierDirectory = readSimpleName(
        carrier.carrierDirectory,
        "workspaces.carrier.carrierDirectory",
    );
    const carrierCollectionDirectories = [
        readSimpleName(carrier.custodiesDirectory, "workspaces.carrier.custodiesDirectory"),
        readSimpleName(carrier.discardedDirectory, "workspaces.carrier.discardedDirectory"),
        readSimpleName(carrier.revisionsDirectory, "workspaces.carrier.revisionsDirectory"),
        readSimpleName(carrier.stagingDirectory, "workspaces.carrier.stagingDirectory"),
    ] as const;
    if (
        carrierDirectory === manifestFile ||
        new Set(carrierCollectionDirectories).size !== carrierCollectionDirectories.length
    ) {
        throw new TypeError("workspace carrier path names must not collide");
    }
    const blobIdPrefix = readNonEmptyString(
        carrier.blobIdPrefix,
        "workspaces.carrier.blobIdPrefix",
    );
    const revisionIdPrefix = readNonEmptyString(
        carrier.revisionIdPrefix,
        "workspaces.carrier.revisionIdPrefix",
    );
    const worldContentIdPrefix = readNonEmptyString(
        carrier.worldContentIdPrefix,
        "workspaces.carrier.worldContentIdPrefix",
    );
    if (
        ![blobIdPrefix, revisionIdPrefix, worldContentIdPrefix].every((prefix) =>
            prefix.endsWith(`${digestAlgorithm}:`),
        )
    ) {
        throw new TypeError("workspace carrier digest prefixes must identify digestAlgorithm");
    }
    const discardDescriptorSuffix = readNonEmptyString(
        carrier.discardDescriptorSuffix,
        "workspaces.carrier.discardDescriptorSuffix",
    );
    if (
        discardDescriptorSuffix.includes("/") ||
        discardDescriptorSuffix.includes("\\") ||
        discardDescriptorSuffix.includes("\0")
    ) {
        throw new TypeError("workspaces.carrier.discardDescriptorSuffix must be a path suffix");
    }
    return {
        adoptionModes,
        bindingErrors: {
            authorityEscapeCode: readNonEmptyString(
                bindingErrors.authorityEscapeCode,
                "workspaces.bindingErrors.authorityEscapeCode",
            ),
            authorityEscapeMessage: readNonEmptyString(
                bindingErrors.authorityEscapeMessage,
                "workspaces.bindingErrors.authorityEscapeMessage",
            ),
            duplicateNameCode: readNonEmptyString(
                bindingErrors.duplicateNameCode,
                "workspaces.bindingErrors.duplicateNameCode",
            ),
            duplicateNameMessage: readNonEmptyString(
                bindingErrors.duplicateNameMessage,
                "workspaces.bindingErrors.duplicateNameMessage",
            ),
            invalidNameCode: readNonEmptyString(
                bindingErrors.invalidNameCode,
                "workspaces.bindingErrors.invalidNameCode",
            ),
            invalidNameMessage: readNonEmptyString(
                bindingErrors.invalidNameMessage,
                "workspaces.bindingErrors.invalidNameMessage",
            ),
            invalidRootCode: readNonEmptyString(
                bindingErrors.invalidRootCode,
                "workspaces.bindingErrors.invalidRootCode",
            ),
            invalidRootMessage: readNonEmptyString(
                bindingErrors.invalidRootMessage,
                "workspaces.bindingErrors.invalidRootMessage",
            ),
            rootOverlapCode: readNonEmptyString(
                bindingErrors.rootOverlapCode,
                "workspaces.bindingErrors.rootOverlapCode",
            ),
            rootOverlapMessage: readNonEmptyString(
                bindingErrors.rootOverlapMessage,
                "workspaces.bindingErrors.rootOverlapMessage",
            ),
        },
        bindingIdentityKind: readNonEmptyString(
            config.bindingIdentityKind,
            "workspaces.bindingIdentityKind",
        ),
        bindingVersion: readPositiveInteger(config.bindingVersion, "workspaces.bindingVersion"),
        carrier: {
            backendKind: readNonEmptyString(carrier.backendKind, "workspaces.carrier.backendKind"),
            blobIdPrefix,
            carrierDirectory,
            captureKind: readNonEmptyString(carrier.captureKind, "workspaces.carrier.captureKind"),
            custodiesDirectory: carrierCollectionDirectories[0],
            custodyDescriptorFile: readSimpleName(
                carrier.custodyDescriptorFile,
                "workspaces.carrier.custodyDescriptorFile",
            ),
            custodyIdPrefix: readNonEmptyString(
                carrier.custodyIdPrefix,
                "workspaces.carrier.custodyIdPrefix",
            ),
            descriptorFormat: readNonEmptyString(
                carrier.descriptorFormat,
                "workspaces.carrier.descriptorFormat",
            ),
            descriptorVersion: readPositiveInteger(
                carrier.descriptorVersion,
                "workspaces.carrier.descriptorVersion",
            ),
            discardDescriptorSuffix,
            discardStatus: readNonEmptyString(
                carrier.discardStatus,
                "workspaces.carrier.discardStatus",
            ),
            discardedDirectory: carrierCollectionDirectories[1],
            entryKinds: readUniqueStrings(carrier.entryKinds, "workspaces.carrier.entryKinds"),
            errors: {
                conflictCode: readNonEmptyString(
                    carrierErrors.conflictCode,
                    "workspaces.carrier.errors.conflictCode",
                ),
                conflictMessage: readNonEmptyString(
                    carrierErrors.conflictMessage,
                    "workspaces.carrier.errors.conflictMessage",
                ),
                controlCode: readNonEmptyString(
                    carrierErrors.controlCode,
                    "workspaces.carrier.errors.controlCode",
                ),
                controlMessage: readNonEmptyString(
                    carrierErrors.controlMessage,
                    "workspaces.carrier.errors.controlMessage",
                ),
                unsupportedCode: readNonEmptyString(
                    carrierErrors.unsupportedCode,
                    "workspaces.carrier.errors.unsupportedCode",
                ),
                unsupportedMessage: readNonEmptyString(
                    carrierErrors.unsupportedMessage,
                    "workspaces.carrier.errors.unsupportedMessage",
                ),
            },
            manifestVersion: readPositiveInteger(
                carrier.manifestVersion,
                "workspaces.carrier.manifestVersion",
            ),
            revisionsDirectory: carrierCollectionDirectories[2],
            revisionDescriptorFile: readSimpleName(
                carrier.revisionDescriptorFile,
                "workspaces.carrier.revisionDescriptorFile",
            ),
            revisionIdPrefix,
            stagingDirectory: carrierCollectionDirectories[3],
            worldContentIdPrefix,
            worldDirectory: readSimpleName(
                carrier.worldDirectory,
                "workspaces.carrier.worldDirectory",
            ),
        },
        changesets: {
            errors: {
                invalidCode: readNonEmptyString(
                    changesetErrors.invalidCode,
                    "workspaces.changesets.errors.invalidCode",
                ),
                invalidMessage: readNonEmptyString(
                    changesetErrors.invalidMessage,
                    "workspaces.changesets.errors.invalidMessage",
                ),
                limitCode: readNonEmptyString(
                    changesetErrors.limitCode,
                    "workspaces.changesets.errors.limitCode",
                ),
                limitMessage: readNonEmptyString(
                    changesetErrors.limitMessage,
                    "workspaces.changesets.errors.limitMessage",
                ),
            },
            idPrefix: readDigestPrefix(
                changesets.idPrefix,
                digestAlgorithm,
                "workspaces.changesets.idPrefix",
            ),
            maxAggregateReferencedBytes: readPositiveInteger(
                changesets.maxAggregateReferencedBytes,
                "workspaces.changesets.maxAggregateReferencedBytes",
            ),
            maxChanges: readPositiveInteger(
                changesets.maxChanges,
                "workspaces.changesets.maxChanges",
            ),
            maxManifestEntries: readPositiveInteger(
                changesets.maxManifestEntries,
                "workspaces.changesets.maxManifestEntries",
            ),
            maxManifestRecordBytes: readPositiveInteger(
                changesets.maxManifestRecordBytes,
                "workspaces.changesets.maxManifestRecordBytes",
            ),
            maxPathBytes: readPositiveInteger(
                changesets.maxPathBytes,
                "workspaces.changesets.maxPathBytes",
            ),
            maxRecordBytes: readPositiveInteger(
                changesets.maxRecordBytes,
                "workspaces.changesets.maxRecordBytes",
            ),
            maxSingleBlobBytes: readPositiveInteger(
                changesets.maxSingleBlobBytes,
                "workspaces.changesets.maxSingleBlobBytes",
            ),
            maxSymlinkTargetBytes: readPositiveInteger(
                changesets.maxSymlinkTargetBytes,
                "workspaces.changesets.maxSymlinkTargetBytes",
            ),
            operations: readUniqueStrings(
                changesets.operations,
                "workspaces.changesets.operations",
            ),
            version: readPositiveInteger(changesets.version, "workspaces.changesets.version"),
        },
        controlDirectory,
        defaultAdoptionMode,
        defaultInitializeGit: config.defaultInitializeGit,
        digestAlgorithm,
        errors: {
            conflictCode: readNonEmptyString(errors.conflictCode, "workspaces.errors.conflictCode"),
            conflictMessage: readNonEmptyString(
                errors.conflictMessage,
                "workspaces.errors.conflictMessage",
            ),
            controlCode: readNonEmptyString(errors.controlCode, "workspaces.errors.controlCode"),
            controlMessage: readNonEmptyString(
                errors.controlMessage,
                "workspaces.errors.controlMessage",
            ),
        },
        format: readNonEmptyString(config.format, "workspaces.format"),
        formatVersion: readPositiveInteger(config.formatVersion, "workspaces.formatVersion"),
        gitExecutable: readNonEmptyString(config.gitExecutable, "workspaces.gitExecutable"),
        gitCustody: {
            archiveExecutable: readNonEmptyString(
                gitCustody.archiveExecutable,
                "workspaces.gitCustody.archiveExecutable",
            ),
            basisIdPrefix: readDigestPrefix(
                gitCustody.basisIdPrefix,
                digestAlgorithm,
                "workspaces.gitCustody.basisIdPrefix",
            ),
            descriptorFile: readSimpleName(
                gitCustody.descriptorFile,
                "workspaces.gitCustody.descriptorFile",
            ),
            descriptorFormat: readNonEmptyString(
                gitCustody.descriptorFormat,
                "workspaces.gitCustody.descriptorFormat",
            ),
            descriptorVersion: readPositiveInteger(
                gitCustody.descriptorVersion,
                "workspaces.gitCustody.descriptorVersion",
            ),
            errors: {
                baselineUnavailableCode: readNonEmptyString(
                    gitCustodyErrors.baselineUnavailableCode,
                    "workspaces.gitCustody.errors.baselineUnavailableCode",
                ),
                baselineUnavailableMessage: readNonEmptyString(
                    gitCustodyErrors.baselineUnavailableMessage,
                    "workspaces.gitCustody.errors.baselineUnavailableMessage",
                ),
                controlCode: readNonEmptyString(
                    gitCustodyErrors.controlCode,
                    "workspaces.gitCustody.errors.controlCode",
                ),
                controlMessage: readNonEmptyString(
                    gitCustodyErrors.controlMessage,
                    "workspaces.gitCustody.errors.controlMessage",
                ),
                movementCode: readNonEmptyString(
                    gitCustodyErrors.movementCode,
                    "workspaces.gitCustody.errors.movementCode",
                ),
                movementMessage: readNonEmptyString(
                    gitCustodyErrors.movementMessage,
                    "workspaces.gitCustody.errors.movementMessage",
                ),
                unsupportedCode: readNonEmptyString(
                    gitCustodyErrors.unsupportedCode,
                    "workspaces.gitCustody.errors.unsupportedCode",
                ),
                unsupportedMessage: readNonEmptyString(
                    gitCustodyErrors.unsupportedMessage,
                    "workspaces.gitCustody.errors.unsupportedMessage",
                ),
            },
            headKinds: readUniqueStrings(gitCustody.headKinds, "workspaces.gitCustody.headKinds"),
            identityFile: readSimpleName(
                gitCustody.identityFile,
                "workspaces.gitCustody.identityFile",
            ),
            identityFormat: readNonEmptyString(
                gitCustody.identityFormat,
                "workspaces.gitCustody.identityFormat",
            ),
            indexIdPrefix: readDigestPrefix(
                gitCustody.indexIdPrefix,
                digestAlgorithm,
                "workspaces.gitCustody.indexIdPrefix",
            ),
            indexReceiptFile: readSimpleName(
                gitCustody.indexReceiptFile,
                "workspaces.gitCustody.indexReceiptFile",
            ),
            maxCommandBytes: readPositiveInteger(
                gitCustody.maxCommandBytes,
                "workspaces.gitCustody.maxCommandBytes",
            ),
            objectPackFile: readSimpleName(
                gitCustody.objectPackFile,
                "workspaces.gitCustody.objectPackFile",
            ),
            objectPackIdPrefix: readDigestPrefix(
                gitCustody.objectPackIdPrefix,
                digestAlgorithm,
                "workspaces.gitCustody.objectPackIdPrefix",
            ),
            objectFormats: readUniqueStrings(
                gitCustody.objectFormats,
                "workspaces.gitCustody.objectFormats",
            ),
            repositoryIdPrefix: readNonEmptyString(
                gitCustody.repositoryIdPrefix,
                "workspaces.gitCustody.repositoryIdPrefix",
            ),
            repositoryIdentityFile: readSimpleName(
                gitCustody.repositoryIdentityFile,
                "workspaces.gitCustody.repositoryIdentityFile",
            ),
            repositoryLockAttempts: readPositiveInteger(
                gitCustody.repositoryLockAttempts,
                "workspaces.gitCustody.repositoryLockAttempts",
            ),
            repositoryLockDelayMs: readPositiveInteger(
                gitCustody.repositoryLockDelayMs,
                "workspaces.gitCustody.repositoryLockDelayMs",
            ),
            repositoryLockPrefix: readNonEmptyString(
                gitCustody.repositoryLockPrefix,
                "workspaces.gitCustody.repositoryLockPrefix",
            ),
            stagingDirectory: readSimpleName(
                gitCustody.stagingDirectory,
                "workspaces.gitCustody.stagingDirectory",
            ),
            version: readPositiveInteger(gitCustody.version, "workspaces.gitCustody.version"),
            worktreeIdPrefix: readNonEmptyString(
                gitCustody.worktreeIdPrefix,
                "workspaces.gitCustody.worktreeIdPrefix",
            ),
        },
        gitHeadRefPrefix: readNonEmptyString(
            config.gitHeadRefPrefix,
            "workspaces.gitHeadRefPrefix",
        ),
        gitMetadataName,
        hexLength,
        manifestFile,
        worktreeRefPrefix,
        worldCapture: {
            maxRevisionDepth: readPositiveInteger(
                worldCapture.maxRevisionDepth,
                "workspaces.worldCapture.maxRevisionDepth",
            ),
            version: readPositiveInteger(worldCapture.version, "workspaces.worldCapture.version"),
        },
    };
}

function readDigestPrefix(value: unknown, algorithm: string, context: string): string {
    const prefix = readNonEmptyString(value, context);
    if (!prefix.endsWith(`${algorithm}:`)) {
        throw new TypeError(`${context} must identify digestAlgorithm`);
    }
    return prefix;
}

function readSimpleName(value: unknown, context: string): string {
    const name = readNonEmptyString(value, context);
    if (
        name === "." ||
        name === ".." ||
        name.includes("/") ||
        name.includes("\\") ||
        name.includes("\0")
    ) {
        throw new TypeError(`${context} must be a simple path name`);
    }
    return name;
}
