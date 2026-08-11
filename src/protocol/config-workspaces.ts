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
            "controlDirectory",
            "defaultAdoptionMode",
            "defaultInitializeGit",
            "digestAlgorithm",
            "errors",
            "format",
            "formatVersion",
            "gitExecutable",
            "gitHeadRefPrefix",
            "gitMetadataName",
            "hexLength",
            "manifestFile",
            "worktreeRefPrefix",
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
        gitHeadRefPrefix: readNonEmptyString(
            config.gitHeadRefPrefix,
            "workspaces.gitHeadRefPrefix",
        ),
        gitMetadataName,
        hexLength,
        manifestFile,
        worktreeRefPrefix,
    };
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
