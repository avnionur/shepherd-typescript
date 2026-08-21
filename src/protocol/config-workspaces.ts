import { createHash } from "node:crypto";

import { type ProtocolConfig, SECURE_HASH_ALGORITHMS } from "./config-types.ts";
import {
    readAbsoluteUrl,
    readArray,
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
            "changesetInspection",
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
            "placements",
            "platformConformance",
            "protectedPaths",
            "repositoryBindings",
            "repositoryGrants",
            "selectionPublication",
            "settlement",
            "worktreeRefPrefix",
            "worldCapture",
            "worldExecution",
            "worldTaskCapture",
        ],
        "workspaces",
    );
    const errors = readObject(
        config.errors,
        ["conflictCode", "conflictMessage", "controlCode", "controlMessage"],
        "workspaces.errors",
    );
    const protectedPaths = readObject(
        config.protectedPaths,
        [
            "alternateNameSeparators",
            "caseFold",
            "errorCode",
            "errorMessage",
            "normalizationForm",
            "roots",
            "trailingCharacters",
            "version",
        ],
        "workspaces.protectedPaths",
    );
    const repositoryBindings = readObject(
        config.repositoryBindings,
        ["errors", "identityDirectory", "identityKind", "resourceType", "version"],
        "workspaces.repositoryBindings",
    );
    const repositoryBindingErrors = readObject(
        repositoryBindings.errors,
        ["invalidRepositoryCode", "invalidRepositoryMessage"],
        "workspaces.repositoryBindings.errors",
    );
    const repositoryGrants = readObject(
        config.repositoryGrants,
        [
            "artifactVersion",
            "artifacts",
            "atoms",
            "compatibilityVersion",
            "enforcement",
            "journalVersion",
            "journalVersions",
            "operations",
            "planIdPrefix",
            "planVersion",
            "profiles",
            "schemas",
            "taskGrantIdPrefix",
        ],
        "workspaces.repositoryGrants",
    );
    const repositoryGrantArtifacts = readObject(
        repositoryGrants.artifacts,
        ["grantPlanSchema", "taskGrantArtifactLockSchema", "taskGrantArtifactSchema"],
        "workspaces.repositoryGrants.artifacts",
    );
    const repositoryGrantSchemas = readObject(
        repositoryGrants.schemas,
        ["grantPlanId", "taskGrantArtifactId", "taskGrantArtifactLockId"],
        "workspaces.repositoryGrants.schemas",
    );
    const repositoryGrantOperations = readObject(
        repositoryGrants.operations,
        ["readText", "writeText"],
        "workspaces.repositoryGrants.operations",
    );
    const repositoryGrantAtoms = readUniqueStrings(
        repositoryGrants.atoms,
        "workspaces.repositoryGrants.atoms",
    );
    const repositoryGrantJournalVersions = readProtocolVersions(
        repositoryGrants.journalVersions,
        "workspaces.repositoryGrants.journalVersions",
    );
    const repositoryGrantJournalVersion = readPositiveInteger(
        repositoryGrants.journalVersion,
        "workspaces.repositoryGrants.journalVersion",
    );
    if (!repositoryGrantJournalVersions.includes(repositoryGrantJournalVersion)) {
        throw new TypeError(
            "workspaces.repositoryGrants.journalVersion must be a configured grant journal version",
        );
    }
    const repositoryGrantProfiles = readArray(
        repositoryGrants.profiles,
        "workspaces.repositoryGrants.profiles",
    ).map((value, index) => {
        const context = `workspaces.repositoryGrants.profiles[${index}]`;
        const profile = readObject(value, ["atoms", "name"], context);
        const atoms = readUniqueStrings(profile.atoms, `${context}.atoms`);
        if (atoms.length === 0 || atoms.some((atom) => !repositoryGrantAtoms.includes(atom))) {
            throw new TypeError(`${context}.atoms must be a non-empty configured subset`);
        }
        return {
            atoms,
            name: readNonEmptyString(profile.name, `${context}.name`),
        };
    });
    if (
        repositoryGrantAtoms.length === 0 ||
        repositoryGrantProfiles.length === 0 ||
        new Set(repositoryGrantProfiles.map(({ name }) => name)).size !==
            repositoryGrantProfiles.length
    ) {
        throw new TypeError("workspace repository grant contracts must be non-empty and unique");
    }
    const placements = readObject(
        config.placements,
        [
            "artifactVersion",
            "artifacts",
            "compatibilityVersion",
            "enforcement",
            "journalVersion",
            "journalVersions",
            "nativeJails",
            "platform",
            "reasons",
            "requests",
            "resolutionIdPrefix",
            "resolvedPlacements",
            "rules",
            "schemas",
            "statuses",
        ],
        "workspaces.placements",
    );
    const nativeJails = readObject(
        placements.nativeJails,
        [
            "artifacts",
            "backends",
            "compatibilityVersion",
            "compilerArguments",
            "compilerExecutables",
            "compilerOutputArgument",
            "commandIdPrefix",
            "commandVersion",
            "descriptorIdPrefix",
            "descriptorVersion",
            "enforcement",
            "journalVersion",
            "journalVersions",
            "maxArgumentBytes",
            "maxArguments",
            "maxEnvironmentEntries",
            "maxEnvironmentValueBytes",
            "maxOutputBytes",
            "maxTimeoutMilliseconds",
            "planIdPrefix",
            "planVersion",
            "placementReasonRoles",
            "placementReasons",
            "placementStatus",
            "placementVersion",
            "probeIdPrefix",
            "probeReasonRoles",
            "probeReasons",
            "probeStatuses",
            "probeVersion",
            "process",
            "resolutionIdPrefix",
            "resolvedPlacement",
            "schemas",
            "temporaryDirectoryPrefix",
        ],
        "workspaces.placements.nativeJails",
    );
    const nativeJailArtifacts = readObject(
        nativeJails.artifacts,
        [
            "backendSchema",
            "commandSchema",
            "planSchema",
            "probeSchema",
            "processSchema",
            "resolutionSchema",
        ],
        "workspaces.placements.nativeJails.artifacts",
    );
    const nativeJailSchemas = readObject(
        nativeJails.schemas,
        ["backendId", "commandId", "planId", "probeId", "processId", "resolutionId"],
        "workspaces.placements.nativeJails.schemas",
    );
    const nativeJailProbeReasonRoles = readObject(
        nativeJails.probeReasonRoles,
        [
            "deniedWriteFailed",
            "executableUnavailable",
            "helperCompilerUnavailable",
            "helperIntegrityFailed",
            "grantedWriteFailed",
            "platformUnsupported",
            "probeError",
            "succeeded",
        ],
        "workspaces.placements.nativeJails.probeReasonRoles",
    );
    const nativeJailPlacementReasonRoles = readObject(
        nativeJails.placementReasonRoles,
        ["auto", "explicit"],
        "workspaces.placements.nativeJails.placementReasonRoles",
    );
    const nativeJailProcess = readObject(
        nativeJails.process,
        [
            "killSignal",
            "launchIdPrefix",
            "quiescenceAttempts",
            "quiescenceDelayMilliseconds",
            "quiescenceStatuses",
            "quiescenceStatusRoles",
            "receiptIdPrefix",
            "receiptVersion",
            "startIdPrefix",
            "statusRoles",
            "statuses",
        ],
        "workspaces.placements.nativeJails.process",
    );
    const nativeJailQuiescenceStatusRoles = readObject(
        nativeJailProcess.quiescenceStatusRoles,
        ["proven", "uncertain"],
        "workspaces.placements.nativeJails.process.quiescenceStatusRoles",
    );
    const nativeJailProcessStatusRoles = readObject(
        nativeJailProcess.statusRoles,
        ["cancelled", "exited", "launchFailed", "outputLimit", "quiescenceUncertain", "timedOut"],
        "workspaces.placements.nativeJails.process.statusRoles",
    );
    const placementArtifacts = readObject(
        placements.artifacts,
        ["platformEvidenceSchema", "resolutionSchema"],
        "workspaces.placements.artifacts",
    );
    const placementSchemas = readObject(
        placements.schemas,
        ["platformEvidenceId", "resolutionId"],
        "workspaces.placements.schemas",
    );
    const placementPlatform = readObject(
        placements.platform,
        [
            "environments",
            "evidenceIdPrefix",
            "families",
            "nativeEnvironment",
            "nodePlatforms",
            "unsupportedEnvironment",
            "unsupportedFamily",
            "version",
            "wslEnvironment",
            "wslEnvironmentVariables",
            "wslFamily",
            "wslNodePlatform",
            "wslReleasePattern",
        ],
        "workspaces.placements.platform",
    );
    const placementEnvironments = readUniqueStrings(
        placementPlatform.environments,
        "workspaces.placements.platform.environments",
    );
    const placementJournalVersions = readProtocolVersions(
        placements.journalVersions,
        "workspaces.placements.journalVersions",
    );
    const placementJournalVersion = readPositiveInteger(
        placements.journalVersion,
        "workspaces.placements.journalVersion",
    );
    const nativeJailJournalVersions = readProtocolVersions(
        nativeJails.journalVersions,
        "workspaces.placements.nativeJails.journalVersions",
    );
    const nativeJailJournalVersion = readPositiveInteger(
        nativeJails.journalVersion,
        "workspaces.placements.nativeJails.journalVersion",
    );
    if (!nativeJailJournalVersions.includes(nativeJailJournalVersion)) {
        throw new TypeError("workspaces.placements.nativeJails.journalVersion must be configured");
    }
    if (!placementJournalVersions.includes(placementJournalVersion)) {
        throw new TypeError(
            "workspaces.placements.journalVersion must be a configured placement journal version",
        );
    }
    const placementFamilies = readUniqueStrings(
        placementPlatform.families,
        "workspaces.placements.platform.families",
    );
    const placementRequests = readUniqueStrings(
        placements.requests,
        "workspaces.placements.requests",
    );
    const placementReasons = readUniqueStrings(placements.reasons, "workspaces.placements.reasons");
    const resolvedPlacements = readUniqueStrings(
        placements.resolvedPlacements,
        "workspaces.placements.resolvedPlacements",
    );
    const placementStatuses = readUniqueStrings(
        placements.statuses,
        "workspaces.placements.statuses",
    );
    const nativeJailProbeReasons = readUniqueStrings(
        nativeJails.probeReasons,
        "workspaces.placements.nativeJails.probeReasons",
    );
    const nativeJailProbeStatuses = readUniqueStrings(
        nativeJails.probeStatuses,
        "workspaces.placements.nativeJails.probeStatuses",
    );
    const nativeJailPlacementReasons = readUniqueStrings(
        nativeJails.placementReasons,
        "workspaces.placements.nativeJails.placementReasons",
    );
    const nativeJailPlacementReasonRoleValues = {
        auto: readNonEmptyString(
            nativeJailPlacementReasonRoles.auto,
            "workspaces.placements.nativeJails.placementReasonRoles.auto",
        ),
        explicit: readNonEmptyString(
            nativeJailPlacementReasonRoles.explicit,
            "workspaces.placements.nativeJails.placementReasonRoles.explicit",
        ),
    };
    if (
        Object.values(nativeJailPlacementReasonRoleValues).some(
            (reason) => !nativeJailPlacementReasons.includes(reason),
        )
    ) {
        throw new TypeError("workspace native jail placement reasons are inconsistent");
    }
    const nativeJailReasonRoles = {
        deniedWriteFailed: readNonEmptyString(
            nativeJailProbeReasonRoles.deniedWriteFailed,
            "workspaces.placements.nativeJails.probeReasonRoles.deniedWriteFailed",
        ),
        executableUnavailable: readNonEmptyString(
            nativeJailProbeReasonRoles.executableUnavailable,
            "workspaces.placements.nativeJails.probeReasonRoles.executableUnavailable",
        ),
        helperCompilerUnavailable: readNonEmptyString(
            nativeJailProbeReasonRoles.helperCompilerUnavailable,
            "workspaces.placements.nativeJails.probeReasonRoles.helperCompilerUnavailable",
        ),
        helperIntegrityFailed: readNonEmptyString(
            nativeJailProbeReasonRoles.helperIntegrityFailed,
            "workspaces.placements.nativeJails.probeReasonRoles.helperIntegrityFailed",
        ),
        grantedWriteFailed: readNonEmptyString(
            nativeJailProbeReasonRoles.grantedWriteFailed,
            "workspaces.placements.nativeJails.probeReasonRoles.grantedWriteFailed",
        ),
        platformUnsupported: readNonEmptyString(
            nativeJailProbeReasonRoles.platformUnsupported,
            "workspaces.placements.nativeJails.probeReasonRoles.platformUnsupported",
        ),
        probeError: readNonEmptyString(
            nativeJailProbeReasonRoles.probeError,
            "workspaces.placements.nativeJails.probeReasonRoles.probeError",
        ),
        succeeded: readNonEmptyString(
            nativeJailProbeReasonRoles.succeeded,
            "workspaces.placements.nativeJails.probeReasonRoles.succeeded",
        ),
    };
    if (
        nativeJailProbeReasons.length === 0 ||
        nativeJailProbeStatuses.length !== 2 ||
        Object.values(nativeJailReasonRoles).some(
            (reason) => !nativeJailProbeReasons.includes(reason),
        )
    ) {
        throw new TypeError("workspace native jail probe vocabularies are inconsistent");
    }
    const nodePlatforms = readArray(
        placementPlatform.nodePlatforms,
        "workspaces.placements.platform.nodePlatforms",
    ).map((value, index) => {
        const context = `workspaces.placements.platform.nodePlatforms[${index}]`;
        const entry = readObject(value, ["family", "name"], context);
        const family = readNonEmptyString(entry.family, `${context}.family`);
        if (!placementFamilies.includes(family)) {
            throw new TypeError(`${context}.family must be configured`);
        }
        return {
            family,
            name: readNonEmptyString(entry.name, `${context}.name`),
        };
    });
    const nativeJailBackends = readArray(
        nativeJails.backends,
        "workspaces.placements.nativeJails.backends",
    ).map((value, index) => {
        const context = `workspaces.placements.nativeJails.backends[${index}]`;
        const backend = readObject(
            value,
            ["environments", "executable", "family", "name", "nodePlatforms", "profileArgument"],
            context,
        );
        const environments = readUniqueStrings(backend.environments, `${context}.environments`);
        const family = readNonEmptyString(backend.family, `${context}.family`);
        if (
            environments.length === 0 ||
            environments.some((environment) => !placementEnvironments.includes(environment)) ||
            !placementFamilies.includes(family)
        ) {
            throw new TypeError(`${context} platform support is inconsistent`);
        }
        return {
            environments,
            executable:
                backend.executable === null
                    ? null
                    : readNonEmptyString(backend.executable, `${context}.executable`),
            family,
            name: readNonEmptyString(backend.name, `${context}.name`),
            nodePlatforms: readUniqueStrings(backend.nodePlatforms, `${context}.nodePlatforms`),
            profileArgument:
                backend.profileArgument === null
                    ? null
                    : readNonEmptyString(backend.profileArgument, `${context}.profileArgument`),
        };
    });
    if (
        nativeJailBackends.length === 0 ||
        new Set(nativeJailBackends.map(({ name }) => name)).size !== nativeJailBackends.length
    ) {
        throw new TypeError("workspace native jail backends must be non-empty and unique");
    }
    if (
        nodePlatforms.length === 0 ||
        new Set(nodePlatforms.map(({ name }) => name)).size !== nodePlatforms.length
    ) {
        throw new TypeError("workspace placement node platforms must be non-empty and unique");
    }
    const placementRules = readArray(placements.rules, "workspaces.placements.rules").map(
        (value, index) => {
            const context = `workspaces.placements.rules[${index}]`;
            const rule = readObject(
                value,
                ["reason", "request", "resolved", "status", "supported"],
                context,
            );
            const reason = readNonEmptyString(rule.reason, `${context}.reason`);
            const request = readNonEmptyString(rule.request, `${context}.request`);
            const status = readNonEmptyString(rule.status, `${context}.status`);
            if (typeof rule.supported !== "boolean") {
                throw new TypeError(`${context}.supported must be boolean`);
            }
            const resolved =
                rule.resolved === null
                    ? null
                    : readNonEmptyString(rule.resolved, `${context}.resolved`);
            if (
                !placementReasons.includes(reason) ||
                !placementRequests.includes(request) ||
                !placementStatuses.includes(status) ||
                (rule.supported
                    ? resolved === null || !resolvedPlacements.includes(resolved)
                    : resolved !== null)
            ) {
                throw new TypeError(`${context} is inconsistent with placement vocabularies`);
            }
            return { reason, request, resolved, status, supported: rule.supported };
        },
    );
    if (
        placementRules.length !== placementRequests.length ||
        new Set(placementRules.map(({ request }) => request)).size !== placementRules.length
    ) {
        throw new TypeError("workspace placement rules must cover each request exactly once");
    }
    const placementRoleValues = {
        nativeEnvironment: readNonEmptyString(
            placementPlatform.nativeEnvironment,
            "workspaces.placements.platform.nativeEnvironment",
        ),
        unsupportedEnvironment: readNonEmptyString(
            placementPlatform.unsupportedEnvironment,
            "workspaces.placements.platform.unsupportedEnvironment",
        ),
        unsupportedFamily: readNonEmptyString(
            placementPlatform.unsupportedFamily,
            "workspaces.placements.platform.unsupportedFamily",
        ),
        wslEnvironment: readNonEmptyString(
            placementPlatform.wslEnvironment,
            "workspaces.placements.platform.wslEnvironment",
        ),
        wslFamily: readNonEmptyString(
            placementPlatform.wslFamily,
            "workspaces.placements.platform.wslFamily",
        ),
        wslNodePlatform: readNonEmptyString(
            placementPlatform.wslNodePlatform,
            "workspaces.placements.platform.wslNodePlatform",
        ),
    };
    if (
        !placementEnvironments.includes(placementRoleValues.nativeEnvironment) ||
        !placementEnvironments.includes(placementRoleValues.unsupportedEnvironment) ||
        !placementEnvironments.includes(placementRoleValues.wslEnvironment) ||
        !placementFamilies.includes(placementRoleValues.unsupportedFamily) ||
        !placementFamilies.includes(placementRoleValues.wslFamily) ||
        !nodePlatforms.some(({ name }) => name === placementRoleValues.wslNodePlatform)
    ) {
        throw new TypeError("workspace placement platform roles are inconsistent");
    }
    const wslEnvironmentVariables = readUniqueStrings(
        placementPlatform.wslEnvironmentVariables,
        "workspaces.placements.platform.wslEnvironmentVariables",
    );
    const wslReleasePattern = readNonEmptyString(
        placementPlatform.wslReleasePattern,
        "workspaces.placements.platform.wslReleasePattern",
    );
    const placementEnforcement = readNonEmptyString(
        placements.enforcement,
        "workspaces.placements.enforcement",
    );
    const platformConformance = readObject(
        config.platformConformance,
        [
            "caseCollisionPolicy",
            "faults",
            "git",
            "metadataPolicy",
            "metadataPathToken",
            "metadataProbeMaxBytes",
            "metadataProbeTimeoutMs",
            "metadataProbes",
            "modePolicy",
            "optimizedCarrierParity",
            "supportedPlatforms",
            "symlinkPolicy",
            "unsupportedMetadata",
            "version",
        ],
        "workspaces.platformConformance",
    );
    const platformGit = readObject(
        platformConformance.git,
        ["coreSymlinksFalse", "gitlinks", "sparseIndex"],
        "workspaces.platformConformance.git",
    );
    const platformFaults = readObject(
        platformConformance.faults,
        ["classifications", "metadataClassification", "phases", "platformClassification"],
        "workspaces.platformConformance.faults",
    );
    const faultClassifications = readArray(
        platformFaults.classifications,
        "workspaces.platformConformance.faults.classifications",
    ).map((value, index) => {
        const context = `workspaces.platformConformance.faults.classifications[${index}]`;
        const classification = readObject(value, ["code", "message", "name"], context);
        return {
            code: readNonEmptyString(classification.code, `${context}.code`),
            message: readNonEmptyString(classification.message, `${context}.message`),
            name: readNonEmptyString(classification.name, `${context}.name`),
        };
    });
    const faultPhases = readArray(
        platformFaults.phases,
        "workspaces.platformConformance.faults.phases",
    ).map((value, index) => {
        const context = `workspaces.platformConformance.faults.phases[${index}]`;
        const phase = readObject(value, ["name", "recovery"], context);
        return {
            name: readNonEmptyString(phase.name, `${context}.name`),
            recovery: readNonEmptyString(phase.recovery, `${context}.recovery`),
        };
    });
    if (
        faultClassifications.length === 0 ||
        new Set(faultClassifications.map(({ name }) => name)).size !==
            faultClassifications.length ||
        new Set(faultClassifications.map(({ code }) => code)).size !==
            faultClassifications.length ||
        faultPhases.length === 0 ||
        new Set(faultPhases.map(({ name }) => name)).size !== faultPhases.length
    ) {
        throw new TypeError("workspace platform fault contracts must be non-empty and unique");
    }
    const metadataClassification = readNonEmptyString(
        platformFaults.metadataClassification,
        "workspaces.platformConformance.faults.metadataClassification",
    );
    const platformClassification = readNonEmptyString(
        platformFaults.platformClassification,
        "workspaces.platformConformance.faults.platformClassification",
    );
    if (
        !faultClassifications.some(({ name }) => name === metadataClassification) ||
        !faultClassifications.some(({ name }) => name === platformClassification)
    ) {
        throw new TypeError("workspace platform fault classification mapping is invalid");
    }
    const metadataPathToken = readNonEmptyString(
        platformConformance.metadataPathToken,
        "workspaces.platformConformance.metadataPathToken",
    );
    const metadataProbes = readArray(
        platformConformance.metadataProbes,
        "workspaces.platformConformance.metadataProbes",
    ).map((value, index) => {
        const context = `workspaces.platformConformance.metadataProbes[${index}]`;
        const probe = readObject(
            value,
            [
                "arguments",
                "executable",
                "kind",
                "matchPattern",
                "patternFlags",
                "platform",
                "separateLineBreakPaths",
                "symlinkArguments",
            ],
            context,
        );
        const arguments_ = readArray(probe.arguments, `${context}.arguments`).map(
            (argument, argumentIndex) =>
                readNonEmptyString(argument, `${context}.arguments[${argumentIndex}]`),
        );
        if (!arguments_.includes(metadataPathToken)) {
            throw new TypeError(`${context}.arguments must contain metadataPathToken`);
        }
        const symlinkArguments = readArray(
            probe.symlinkArguments,
            `${context}.symlinkArguments`,
        ).map((argument, argumentIndex) =>
            readNonEmptyString(argument, `${context}.symlinkArguments[${argumentIndex}]`),
        );
        if (!symlinkArguments.includes(metadataPathToken)) {
            throw new TypeError(`${context}.symlinkArguments must contain metadataPathToken`);
        }
        const matchPattern = readNonEmptyString(probe.matchPattern, `${context}.matchPattern`);
        const patternFlags = readNonEmptyString(probe.patternFlags, `${context}.patternFlags`);
        if (typeof probe.separateLineBreakPaths !== "boolean") {
            throw new TypeError(`${context}.separateLineBreakPaths must be a boolean`);
        }
        try {
            new RegExp(matchPattern, patternFlags);
        } catch {
            throw new TypeError(`${context} must contain a valid regular expression`);
        }
        return {
            arguments: arguments_,
            executable: readNonEmptyString(probe.executable, `${context}.executable`),
            kind: readNonEmptyString(probe.kind, `${context}.kind`),
            matchPattern,
            patternFlags,
            platform: readNonEmptyString(probe.platform, `${context}.platform`),
            separateLineBreakPaths: probe.separateLineBreakPaths,
            symlinkArguments,
        };
    });
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
    const changesetInspection = readObject(
        config.changesetInspection,
        [
            "defaultPageSize",
            "defaultPreviewBytes",
            "defaultPreviewLines",
            "defaultReadBytes",
            "encoding",
            "gitlinkEntryKind",
            "gitlinkMode",
            "maxPageSize",
            "maxPreviewBytes",
            "maxPreviewLines",
            "maxReadBytes",
            "maxDerivedMoveCandidates",
            "maxVerificationConcurrency",
            "moveKinds",
            "previewClassifications",
            "symlinkMode",
            "version",
        ],
        "workspaces.changesetInspection",
    );
    const settlement = readObject(
        config.settlement,
        [
            "actions",
            "citationAppendIntentPrefix",
            "citationCutIdPrefix",
            "citationSchemaId",
            "citationSchemaPath",
            "citationVersion",
            "errors",
            "operationIdPrefix",
            "operationVersion",
            "receiptVersion",
            "requestIdPrefix",
            "states",
            "version",
        ],
        "workspaces.settlement",
    );
    const settlementErrors = readObject(
        settlement.errors,
        ["conflictCode", "conflictMessage", "invalidCode", "invalidMessage"],
        "workspaces.settlement.errors",
    );
    const selectionPublication = readObject(
        config.selectionPublication,
        [
            "atomicityKinds",
            "descriptorFormat",
            "errors",
            "maxPlanBytes",
            "maxReceiptBytes",
            "maxScheduleBytes",
            "maxStepBytes",
            "maxSteps",
            "planFile",
            "planIdPrefix",
            "planVersion",
            "publicationFile",
            "publicationIdPrefix",
            "publicationVersion",
            "publicationsDirectory",
            "schemaId",
            "schemaPath",
            "scheduleFile",
            "scheduleIdPrefix",
            "scheduleKinds",
            "scheduleVersion",
            "scheduledPublicationIdPrefix",
            "scheduledPublicationVersion",
            "scheduledStepIdPrefix",
            "scheduledStepVersion",
            "stagingDirectory",
            "stagingIdPrefix",
            "stepIdPrefix",
            "stepStatuses",
            "stepsDirectory",
            "stepVersion",
            "version",
        ],
        "workspaces.selectionPublication",
    );
    const selectionPublicationErrors = readObject(
        selectionPublication.errors,
        [
            "basisMovedCode",
            "basisMovedMessage",
            "recoveryRequiredCode",
            "recoveryRequiredMessage",
            "unsupportedCode",
            "unsupportedMessage",
        ],
        "workspaces.selectionPublication.errors",
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
    const worldExecution = readObject(
        config.worldExecution,
        ["enforcementKinds", "maxRunnerIdBytes", "runnerVersion"],
        "workspaces.worldExecution",
    );
    if (
        !readUniqueStrings(
            worldExecution.enforcementKinds,
            "workspaces.worldExecution.enforcementKinds",
        ).includes(placementEnforcement)
    ) {
        throw new TypeError(
            "workspaces.placements.enforcement must be a configured world execution enforcement",
        );
    }
    const worldTaskCapture = readObject(
        config.worldTaskCapture,
        [
            "captureSchemaId",
            "captureSchemaPath",
            "custodyIdentityKind",
            "journalPhases",
            "journalReaders",
            "journalSchemaId",
            "journalSchemaPath",
            "journalVersion",
            "maxCaptureIdBytes",
            "maxTextBytes",
            "outputIdPrefix",
            "ordinaryJournalVersion",
            "statuses",
            "version",
        ],
        "workspaces.worldTaskCapture",
    );
    const journalVersion = readPositiveInteger(
        worldTaskCapture.journalVersion,
        "workspaces.worldTaskCapture.journalVersion",
    );
    const ordinaryJournalVersion = readPositiveInteger(
        worldTaskCapture.ordinaryJournalVersion,
        "workspaces.worldTaskCapture.ordinaryJournalVersion",
    );
    const journalSchemaId = readAbsoluteUrl(
        worldTaskCapture.journalSchemaId,
        "workspaces.worldTaskCapture.journalSchemaId",
    );
    const journalReaders = readArray(
        worldTaskCapture.journalReaders,
        "workspaces.worldTaskCapture.journalReaders",
    ).map((value, index) => {
        const context = `workspaces.worldTaskCapture.journalReaders[${index}]`;
        const reader = readObject(value, ["schemaId", "version"], context);
        return {
            schemaId: readAbsoluteUrl(reader.schemaId, `${context}.schemaId`),
            version: readPositiveInteger(reader.version, `${context}.version`),
        };
    });
    if (
        journalReaders.length === 0 ||
        new Set(journalReaders.map(({ schemaId }) => schemaId)).size !== journalReaders.length ||
        new Set(journalReaders.map(({ version }) => version)).size !== journalReaders.length ||
        !journalReaders.some(
            (reader) => reader.schemaId === journalSchemaId && reader.version === journalVersion,
        )
    ) {
        throw new TypeError(
            "workspaces.worldTaskCapture.journalReaders must be unique and include the current schema/version pair",
        );
    }
    const readableJournalVersions = journalReaders.map(({ version }) => version);
    if (
        repositoryGrantJournalVersions.some(
            (version) => !readableJournalVersions.includes(version),
        ) ||
        placementJournalVersions.some((version) => !readableJournalVersions.includes(version)) ||
        nativeJailJournalVersions.some((version) => !readableJournalVersions.includes(version))
    ) {
        throw new TypeError(
            "workspace prepared-evidence journal versions must have configured readers",
        );
    }
    if (
        !readableJournalVersions.includes(ordinaryJournalVersion) ||
        new Set([
            ordinaryJournalVersion,
            repositoryGrantJournalVersion,
            placementJournalVersion,
            nativeJailJournalVersion,
        ]).size !== 4
    ) {
        throw new TypeError(
            "workspace task-world writer journal versions must be readable and distinct",
        );
    }
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
    const protectedRoots = readUniqueStrings(
        protectedPaths.roots,
        "workspaces.protectedPaths.roots",
    ).map((root, index) => readSimpleName(root, `workspaces.protectedPaths.roots[${index}]`));
    if (!protectedRoots.includes(controlDirectory)) {
        throw new TypeError("workspaces.protectedPaths.roots must protect controlDirectory");
    }
    const alternateNameSeparators = readSingleCharacters(
        protectedPaths.alternateNameSeparators,
        "workspaces.protectedPaths.alternateNameSeparators",
    );
    const trailingCharacters = readSingleCharacters(
        protectedPaths.trailingCharacters,
        "workspaces.protectedPaths.trailingCharacters",
    );
    if (typeof protectedPaths.caseFold !== "boolean") {
        throw new TypeError("workspaces.protectedPaths.caseFold must be boolean");
    }
    const normalizationForm = readEnum(
        protectedPaths.normalizationForm,
        ["NFC", "NFD", "NFKC", "NFKD"] as const,
        "workspaces.protectedPaths.normalizationForm",
    );
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
    const gitIdentityFile = readSimpleName(
        gitCustody.identityFile,
        "workspaces.gitCustody.identityFile",
    );
    const gitRepositoryIdentityFile = readSimpleName(
        gitCustody.repositoryIdentityFile,
        "workspaces.gitCustody.repositoryIdentityFile",
    );
    const gitStagingDirectory = readSimpleName(
        gitCustody.stagingDirectory,
        "workspaces.gitCustody.stagingDirectory",
    );
    const repositoryIdentityDirectory = readSimpleName(
        repositoryBindings.identityDirectory,
        "workspaces.repositoryBindings.identityDirectory",
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
    const maxChanges = readPositiveInteger(
        changesets.maxChanges,
        "workspaces.changesets.maxChanges",
    );
    const maxSelectionSteps = readPositiveInteger(
        selectionPublication.maxSteps,
        "workspaces.selectionPublication.maxSteps",
    );
    if (maxSelectionSteps > maxChanges) {
        throw new TypeError("workspace selection-publication steps must fit changeset limits");
    }
    const selectionPublicationPathNames = [
        readSimpleName(
            selectionPublication.publicationsDirectory,
            "workspaces.selectionPublication.publicationsDirectory",
        ),
        readSimpleName(
            selectionPublication.stagingDirectory,
            "workspaces.selectionPublication.stagingDirectory",
        ),
        readSimpleName(
            selectionPublication.stepsDirectory,
            "workspaces.selectionPublication.stepsDirectory",
        ),
        readSimpleName(selectionPublication.planFile, "workspaces.selectionPublication.planFile"),
        readSimpleName(
            selectionPublication.publicationFile,
            "workspaces.selectionPublication.publicationFile",
        ),
        readSimpleName(
            selectionPublication.scheduleFile,
            "workspaces.selectionPublication.scheduleFile",
        ),
    ] as const;
    if (new Set(selectionPublicationPathNames).size !== selectionPublicationPathNames.length) {
        throw new TypeError("workspace selection-publication path names must not collide");
    }
    const controlPathNames = [
        carrierDirectory,
        gitIdentityFile,
        gitRepositoryIdentityFile,
        gitStagingDirectory,
        manifestFile,
        repositoryIdentityDirectory,
        selectionPublicationPathNames[0],
        selectionPublicationPathNames[1],
    ];
    if (new Set(controlPathNames).size !== controlPathNames.length) {
        throw new TypeError("workspace control path names must not collide");
    }
    if (
        new Set([
            ...carrierCollectionDirectories,
            selectionPublicationPathNames[0],
            selectionPublicationPathNames[1],
        ]).size !==
        carrierCollectionDirectories.length + 2
    ) {
        throw new TypeError("workspace carrier and selection-publication directories must differ");
    }
    const selectionPublicationDigestPrefixes = [
        readDigestPrefix(
            selectionPublication.planIdPrefix,
            digestAlgorithm,
            "workspaces.selectionPublication.planIdPrefix",
        ),
        readDigestPrefix(
            selectionPublication.publicationIdPrefix,
            digestAlgorithm,
            "workspaces.selectionPublication.publicationIdPrefix",
        ),
        readDigestPrefix(
            selectionPublication.stagingIdPrefix,
            digestAlgorithm,
            "workspaces.selectionPublication.stagingIdPrefix",
        ),
        readDigestPrefix(
            selectionPublication.stepIdPrefix,
            digestAlgorithm,
            "workspaces.selectionPublication.stepIdPrefix",
        ),
        readDigestPrefix(
            selectionPublication.scheduleIdPrefix,
            digestAlgorithm,
            "workspaces.selectionPublication.scheduleIdPrefix",
        ),
        readDigestPrefix(
            selectionPublication.scheduledPublicationIdPrefix,
            digestAlgorithm,
            "workspaces.selectionPublication.scheduledPublicationIdPrefix",
        ),
        readDigestPrefix(
            selectionPublication.scheduledStepIdPrefix,
            digestAlgorithm,
            "workspaces.selectionPublication.scheduledStepIdPrefix",
        ),
    ] as const;
    if (
        new Set(selectionPublicationDigestPrefixes).size !==
        selectionPublicationDigestPrefixes.length
    ) {
        throw new TypeError("workspace selection-publication digest prefixes must differ");
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
            maxChanges,
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
        changesetInspection: {
            defaultPageSize: readPositiveInteger(
                changesetInspection.defaultPageSize,
                "workspaces.changesetInspection.defaultPageSize",
            ),
            defaultPreviewBytes: readPositiveInteger(
                changesetInspection.defaultPreviewBytes,
                "workspaces.changesetInspection.defaultPreviewBytes",
            ),
            defaultPreviewLines: readPositiveInteger(
                changesetInspection.defaultPreviewLines,
                "workspaces.changesetInspection.defaultPreviewLines",
            ),
            defaultReadBytes: readPositiveInteger(
                changesetInspection.defaultReadBytes,
                "workspaces.changesetInspection.defaultReadBytes",
            ),
            encoding: readNonEmptyString(
                changesetInspection.encoding,
                "workspaces.changesetInspection.encoding",
            ),
            gitlinkEntryKind: readNonEmptyString(
                changesetInspection.gitlinkEntryKind,
                "workspaces.changesetInspection.gitlinkEntryKind",
            ),
            gitlinkMode: readNonEmptyString(
                changesetInspection.gitlinkMode,
                "workspaces.changesetInspection.gitlinkMode",
            ),
            maxPageSize: readPositiveInteger(
                changesetInspection.maxPageSize,
                "workspaces.changesetInspection.maxPageSize",
            ),
            maxPreviewBytes: readPositiveInteger(
                changesetInspection.maxPreviewBytes,
                "workspaces.changesetInspection.maxPreviewBytes",
            ),
            maxPreviewLines: readPositiveInteger(
                changesetInspection.maxPreviewLines,
                "workspaces.changesetInspection.maxPreviewLines",
            ),
            maxReadBytes: readPositiveInteger(
                changesetInspection.maxReadBytes,
                "workspaces.changesetInspection.maxReadBytes",
            ),
            maxDerivedMoveCandidates: readPositiveInteger(
                changesetInspection.maxDerivedMoveCandidates,
                "workspaces.changesetInspection.maxDerivedMoveCandidates",
            ),
            maxVerificationConcurrency: readPositiveInteger(
                changesetInspection.maxVerificationConcurrency,
                "workspaces.changesetInspection.maxVerificationConcurrency",
            ),
            moveKinds: readUniqueStrings(
                changesetInspection.moveKinds,
                "workspaces.changesetInspection.moveKinds",
            ),
            previewClassifications: readUniqueStrings(
                changesetInspection.previewClassifications,
                "workspaces.changesetInspection.previewClassifications",
            ),
            symlinkMode: readNonEmptyString(
                changesetInspection.symlinkMode,
                "workspaces.changesetInspection.symlinkMode",
            ),
            version: readPositiveInteger(
                changesetInspection.version,
                "workspaces.changesetInspection.version",
            ),
        },
        settlement: {
            actions: readUniqueStrings(settlement.actions, "workspaces.settlement.actions"),
            citationAppendIntentPrefix: readNonEmptyString(
                settlement.citationAppendIntentPrefix,
                "workspaces.settlement.citationAppendIntentPrefix",
            ),
            citationCutIdPrefix: readNonEmptyString(
                settlement.citationCutIdPrefix,
                "workspaces.settlement.citationCutIdPrefix",
            ),
            citationSchemaId: readNonEmptyString(
                settlement.citationSchemaId,
                "workspaces.settlement.citationSchemaId",
            ),
            citationSchemaPath: readNonEmptyString(
                settlement.citationSchemaPath,
                "workspaces.settlement.citationSchemaPath",
            ),
            citationVersion: readPositiveInteger(
                settlement.citationVersion,
                "workspaces.settlement.citationVersion",
            ),
            errors: {
                conflictCode: readNonEmptyString(
                    settlementErrors.conflictCode,
                    "workspaces.settlement.errors.conflictCode",
                ),
                conflictMessage: readNonEmptyString(
                    settlementErrors.conflictMessage,
                    "workspaces.settlement.errors.conflictMessage",
                ),
                invalidCode: readNonEmptyString(
                    settlementErrors.invalidCode,
                    "workspaces.settlement.errors.invalidCode",
                ),
                invalidMessage: readNonEmptyString(
                    settlementErrors.invalidMessage,
                    "workspaces.settlement.errors.invalidMessage",
                ),
            },
            operationIdPrefix: readNonEmptyString(
                settlement.operationIdPrefix,
                "workspaces.settlement.operationIdPrefix",
            ),
            operationVersion: readPositiveInteger(
                settlement.operationVersion,
                "workspaces.settlement.operationVersion",
            ),
            receiptVersion: readPositiveInteger(
                settlement.receiptVersion,
                "workspaces.settlement.receiptVersion",
            ),
            requestIdPrefix: readNonEmptyString(
                settlement.requestIdPrefix,
                "workspaces.settlement.requestIdPrefix",
            ),
            states: readUniqueStrings(settlement.states, "workspaces.settlement.states"),
            version: readPositiveInteger(settlement.version, "workspaces.settlement.version"),
        },
        selectionPublication: {
            atomicityKinds: readUniqueStrings(
                selectionPublication.atomicityKinds,
                "workspaces.selectionPublication.atomicityKinds",
            ),
            descriptorFormat: readNonEmptyString(
                selectionPublication.descriptorFormat,
                "workspaces.selectionPublication.descriptorFormat",
            ),
            errors: {
                basisMovedCode: readNonEmptyString(
                    selectionPublicationErrors.basisMovedCode,
                    "workspaces.selectionPublication.errors.basisMovedCode",
                ),
                basisMovedMessage: readNonEmptyString(
                    selectionPublicationErrors.basisMovedMessage,
                    "workspaces.selectionPublication.errors.basisMovedMessage",
                ),
                recoveryRequiredCode: readNonEmptyString(
                    selectionPublicationErrors.recoveryRequiredCode,
                    "workspaces.selectionPublication.errors.recoveryRequiredCode",
                ),
                recoveryRequiredMessage: readNonEmptyString(
                    selectionPublicationErrors.recoveryRequiredMessage,
                    "workspaces.selectionPublication.errors.recoveryRequiredMessage",
                ),
                unsupportedCode: readNonEmptyString(
                    selectionPublicationErrors.unsupportedCode,
                    "workspaces.selectionPublication.errors.unsupportedCode",
                ),
                unsupportedMessage: readNonEmptyString(
                    selectionPublicationErrors.unsupportedMessage,
                    "workspaces.selectionPublication.errors.unsupportedMessage",
                ),
            },
            maxPlanBytes: readPositiveInteger(
                selectionPublication.maxPlanBytes,
                "workspaces.selectionPublication.maxPlanBytes",
            ),
            maxReceiptBytes: readPositiveInteger(
                selectionPublication.maxReceiptBytes,
                "workspaces.selectionPublication.maxReceiptBytes",
            ),
            maxScheduleBytes: readPositiveInteger(
                selectionPublication.maxScheduleBytes,
                "workspaces.selectionPublication.maxScheduleBytes",
            ),
            maxStepBytes: readPositiveInteger(
                selectionPublication.maxStepBytes,
                "workspaces.selectionPublication.maxStepBytes",
            ),
            maxSteps: maxSelectionSteps,
            planFile: selectionPublicationPathNames[3],
            planIdPrefix: selectionPublicationDigestPrefixes[0],
            planVersion: readPositiveInteger(
                selectionPublication.planVersion,
                "workspaces.selectionPublication.planVersion",
            ),
            publicationFile: selectionPublicationPathNames[4],
            publicationIdPrefix: selectionPublicationDigestPrefixes[1],
            publicationVersion: readPositiveInteger(
                selectionPublication.publicationVersion,
                "workspaces.selectionPublication.publicationVersion",
            ),
            publicationsDirectory: selectionPublicationPathNames[0],
            schemaId: readNonEmptyString(
                selectionPublication.schemaId,
                "workspaces.selectionPublication.schemaId",
            ),
            schemaPath: readNonEmptyString(
                selectionPublication.schemaPath,
                "workspaces.selectionPublication.schemaPath",
            ),
            scheduleFile: selectionPublicationPathNames[5],
            scheduleIdPrefix: selectionPublicationDigestPrefixes[4],
            scheduleKinds: readUniqueStrings(
                selectionPublication.scheduleKinds,
                "workspaces.selectionPublication.scheduleKinds",
            ),
            scheduleVersion: readPositiveInteger(
                selectionPublication.scheduleVersion,
                "workspaces.selectionPublication.scheduleVersion",
            ),
            scheduledPublicationIdPrefix: selectionPublicationDigestPrefixes[5],
            scheduledPublicationVersion: readPositiveInteger(
                selectionPublication.scheduledPublicationVersion,
                "workspaces.selectionPublication.scheduledPublicationVersion",
            ),
            scheduledStepIdPrefix: selectionPublicationDigestPrefixes[6],
            scheduledStepVersion: readPositiveInteger(
                selectionPublication.scheduledStepVersion,
                "workspaces.selectionPublication.scheduledStepVersion",
            ),
            stagingDirectory: selectionPublicationPathNames[1],
            stagingIdPrefix: selectionPublicationDigestPrefixes[2],
            stepIdPrefix: selectionPublicationDigestPrefixes[3],
            stepStatuses: readUniqueStrings(
                selectionPublication.stepStatuses,
                "workspaces.selectionPublication.stepStatuses",
            ),
            stepsDirectory: selectionPublicationPathNames[2],
            stepVersion: readPositiveInteger(
                selectionPublication.stepVersion,
                "workspaces.selectionPublication.stepVersion",
            ),
            version: readPositiveInteger(
                selectionPublication.version,
                "workspaces.selectionPublication.version",
            ),
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
            identityFile: gitIdentityFile,
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
            repositoryIdentityFile: gitRepositoryIdentityFile,
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
            stagingDirectory: gitStagingDirectory,
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
        placements: {
            artifactVersion: readPositiveInteger(
                placements.artifactVersion,
                "workspaces.placements.artifactVersion",
            ),
            artifacts: {
                platformEvidenceSchema: readNonEmptyString(
                    placementArtifacts.platformEvidenceSchema,
                    "workspaces.placements.artifacts.platformEvidenceSchema",
                ),
                resolutionSchema: readNonEmptyString(
                    placementArtifacts.resolutionSchema,
                    "workspaces.placements.artifacts.resolutionSchema",
                ),
            },
            compatibilityVersion: readNonEmptyString(
                placements.compatibilityVersion,
                "workspaces.placements.compatibilityVersion",
            ),
            enforcement: placementEnforcement,
            journalVersion: placementJournalVersion,
            journalVersions: placementJournalVersions,
            nativeJails: {
                artifacts: {
                    backendSchema: readNonEmptyString(
                        nativeJailArtifacts.backendSchema,
                        "workspaces.placements.nativeJails.artifacts.backendSchema",
                    ),
                    commandSchema: readNonEmptyString(
                        nativeJailArtifacts.commandSchema,
                        "workspaces.placements.nativeJails.artifacts.commandSchema",
                    ),
                    planSchema: readNonEmptyString(
                        nativeJailArtifacts.planSchema,
                        "workspaces.placements.nativeJails.artifacts.planSchema",
                    ),
                    probeSchema: readNonEmptyString(
                        nativeJailArtifacts.probeSchema,
                        "workspaces.placements.nativeJails.artifacts.probeSchema",
                    ),
                    processSchema: readNonEmptyString(
                        nativeJailArtifacts.processSchema,
                        "workspaces.placements.nativeJails.artifacts.processSchema",
                    ),
                    resolutionSchema: readNonEmptyString(
                        nativeJailArtifacts.resolutionSchema,
                        "workspaces.placements.nativeJails.artifacts.resolutionSchema",
                    ),
                },
                backends: nativeJailBackends,
                compatibilityVersion: readNonEmptyString(
                    nativeJails.compatibilityVersion,
                    "workspaces.placements.nativeJails.compatibilityVersion",
                ),
                compilerArguments: readUniqueStrings(
                    nativeJails.compilerArguments,
                    "workspaces.placements.nativeJails.compilerArguments",
                ),
                compilerExecutables: readUniqueStrings(
                    nativeJails.compilerExecutables,
                    "workspaces.placements.nativeJails.compilerExecutables",
                ),
                compilerOutputArgument: readNonEmptyString(
                    nativeJails.compilerOutputArgument,
                    "workspaces.placements.nativeJails.compilerOutputArgument",
                ),
                commandIdPrefix: readNonEmptyString(
                    nativeJails.commandIdPrefix,
                    "workspaces.placements.nativeJails.commandIdPrefix",
                ),
                commandVersion: readPositiveInteger(
                    nativeJails.commandVersion,
                    "workspaces.placements.nativeJails.commandVersion",
                ),
                descriptorIdPrefix: readNonEmptyString(
                    nativeJails.descriptorIdPrefix,
                    "workspaces.placements.nativeJails.descriptorIdPrefix",
                ),
                descriptorVersion: readPositiveInteger(
                    nativeJails.descriptorVersion,
                    "workspaces.placements.nativeJails.descriptorVersion",
                ),
                enforcement: readNonEmptyString(
                    nativeJails.enforcement,
                    "workspaces.placements.nativeJails.enforcement",
                ),
                journalVersion: nativeJailJournalVersion,
                journalVersions: nativeJailJournalVersions,
                maxArgumentBytes: readPositiveInteger(
                    nativeJails.maxArgumentBytes,
                    "workspaces.placements.nativeJails.maxArgumentBytes",
                ),
                maxArguments: readPositiveInteger(
                    nativeJails.maxArguments,
                    "workspaces.placements.nativeJails.maxArguments",
                ),
                maxEnvironmentEntries: readPositiveInteger(
                    nativeJails.maxEnvironmentEntries,
                    "workspaces.placements.nativeJails.maxEnvironmentEntries",
                ),
                maxEnvironmentValueBytes: readPositiveInteger(
                    nativeJails.maxEnvironmentValueBytes,
                    "workspaces.placements.nativeJails.maxEnvironmentValueBytes",
                ),
                maxOutputBytes: readPositiveInteger(
                    nativeJails.maxOutputBytes,
                    "workspaces.placements.nativeJails.maxOutputBytes",
                ),
                maxTimeoutMilliseconds: readPositiveInteger(
                    nativeJails.maxTimeoutMilliseconds,
                    "workspaces.placements.nativeJails.maxTimeoutMilliseconds",
                ),
                planIdPrefix: readNonEmptyString(
                    nativeJails.planIdPrefix,
                    "workspaces.placements.nativeJails.planIdPrefix",
                ),
                planVersion: readPositiveInteger(
                    nativeJails.planVersion,
                    "workspaces.placements.nativeJails.planVersion",
                ),
                placementReasonRoles: nativeJailPlacementReasonRoleValues,
                placementReasons: nativeJailPlacementReasons,
                placementStatus: readNonEmptyString(
                    nativeJails.placementStatus,
                    "workspaces.placements.nativeJails.placementStatus",
                ),
                placementVersion: readPositiveInteger(
                    nativeJails.placementVersion,
                    "workspaces.placements.nativeJails.placementVersion",
                ),
                probeIdPrefix: readNonEmptyString(
                    nativeJails.probeIdPrefix,
                    "workspaces.placements.nativeJails.probeIdPrefix",
                ),
                probeReasonRoles: nativeJailReasonRoles,
                probeReasons: nativeJailProbeReasons,
                probeStatuses: nativeJailProbeStatuses,
                probeVersion: readPositiveInteger(
                    nativeJails.probeVersion,
                    "workspaces.placements.nativeJails.probeVersion",
                ),
                process: {
                    killSignal: readNonEmptyString(
                        nativeJailProcess.killSignal,
                        "workspaces.placements.nativeJails.process.killSignal",
                    ),
                    launchIdPrefix: readNonEmptyString(
                        nativeJailProcess.launchIdPrefix,
                        "workspaces.placements.nativeJails.process.launchIdPrefix",
                    ),
                    quiescenceAttempts: readPositiveInteger(
                        nativeJailProcess.quiescenceAttempts,
                        "workspaces.placements.nativeJails.process.quiescenceAttempts",
                    ),
                    quiescenceDelayMilliseconds: readPositiveInteger(
                        nativeJailProcess.quiescenceDelayMilliseconds,
                        "workspaces.placements.nativeJails.process.quiescenceDelayMilliseconds",
                    ),
                    quiescenceStatuses: readUniqueStrings(
                        nativeJailProcess.quiescenceStatuses,
                        "workspaces.placements.nativeJails.process.quiescenceStatuses",
                    ),
                    quiescenceStatusRoles: {
                        proven: readNonEmptyString(
                            nativeJailQuiescenceStatusRoles.proven,
                            "workspaces.placements.nativeJails.process.quiescenceStatusRoles.proven",
                        ),
                        uncertain: readNonEmptyString(
                            nativeJailQuiescenceStatusRoles.uncertain,
                            "workspaces.placements.nativeJails.process.quiescenceStatusRoles.uncertain",
                        ),
                    },
                    receiptIdPrefix: readNonEmptyString(
                        nativeJailProcess.receiptIdPrefix,
                        "workspaces.placements.nativeJails.process.receiptIdPrefix",
                    ),
                    receiptVersion: readPositiveInteger(
                        nativeJailProcess.receiptVersion,
                        "workspaces.placements.nativeJails.process.receiptVersion",
                    ),
                    startIdPrefix: readNonEmptyString(
                        nativeJailProcess.startIdPrefix,
                        "workspaces.placements.nativeJails.process.startIdPrefix",
                    ),
                    statusRoles: {
                        cancelled: readNonEmptyString(
                            nativeJailProcessStatusRoles.cancelled,
                            "workspaces.placements.nativeJails.process.statusRoles.cancelled",
                        ),
                        exited: readNonEmptyString(
                            nativeJailProcessStatusRoles.exited,
                            "workspaces.placements.nativeJails.process.statusRoles.exited",
                        ),
                        launchFailed: readNonEmptyString(
                            nativeJailProcessStatusRoles.launchFailed,
                            "workspaces.placements.nativeJails.process.statusRoles.launchFailed",
                        ),
                        outputLimit: readNonEmptyString(
                            nativeJailProcessStatusRoles.outputLimit,
                            "workspaces.placements.nativeJails.process.statusRoles.outputLimit",
                        ),
                        quiescenceUncertain: readNonEmptyString(
                            nativeJailProcessStatusRoles.quiescenceUncertain,
                            "workspaces.placements.nativeJails.process.statusRoles.quiescenceUncertain",
                        ),
                        timedOut: readNonEmptyString(
                            nativeJailProcessStatusRoles.timedOut,
                            "workspaces.placements.nativeJails.process.statusRoles.timedOut",
                        ),
                    },
                    statuses: readUniqueStrings(
                        nativeJailProcess.statuses,
                        "workspaces.placements.nativeJails.process.statuses",
                    ),
                },
                resolutionIdPrefix: readNonEmptyString(
                    nativeJails.resolutionIdPrefix,
                    "workspaces.placements.nativeJails.resolutionIdPrefix",
                ),
                resolvedPlacement: readNonEmptyString(
                    nativeJails.resolvedPlacement,
                    "workspaces.placements.nativeJails.resolvedPlacement",
                ),
                schemas: {
                    backendId: readAbsoluteUrl(
                        nativeJailSchemas.backendId,
                        "workspaces.placements.nativeJails.schemas.backendId",
                    ),
                    commandId: readAbsoluteUrl(
                        nativeJailSchemas.commandId,
                        "workspaces.placements.nativeJails.schemas.commandId",
                    ),
                    planId: readAbsoluteUrl(
                        nativeJailSchemas.planId,
                        "workspaces.placements.nativeJails.schemas.planId",
                    ),
                    probeId: readAbsoluteUrl(
                        nativeJailSchemas.probeId,
                        "workspaces.placements.nativeJails.schemas.probeId",
                    ),
                    processId: readAbsoluteUrl(
                        nativeJailSchemas.processId,
                        "workspaces.placements.nativeJails.schemas.processId",
                    ),
                    resolutionId: readAbsoluteUrl(
                        nativeJailSchemas.resolutionId,
                        "workspaces.placements.nativeJails.schemas.resolutionId",
                    ),
                },
                temporaryDirectoryPrefix: readNonEmptyString(
                    nativeJails.temporaryDirectoryPrefix,
                    "workspaces.placements.nativeJails.temporaryDirectoryPrefix",
                ),
            },
            platform: {
                environments: placementEnvironments,
                evidenceIdPrefix: readNonEmptyString(
                    placementPlatform.evidenceIdPrefix,
                    "workspaces.placements.platform.evidenceIdPrefix",
                ),
                families: placementFamilies,
                nativeEnvironment: placementRoleValues.nativeEnvironment,
                nodePlatforms,
                unsupportedEnvironment: placementRoleValues.unsupportedEnvironment,
                unsupportedFamily: placementRoleValues.unsupportedFamily,
                version: readPositiveInteger(
                    placementPlatform.version,
                    "workspaces.placements.platform.version",
                ),
                wslEnvironment: placementRoleValues.wslEnvironment,
                wslEnvironmentVariables,
                wslFamily: placementRoleValues.wslFamily,
                wslNodePlatform: placementRoleValues.wslNodePlatform,
                wslReleasePattern,
            },
            reasons: placementReasons,
            requests: placementRequests,
            resolutionIdPrefix: readNonEmptyString(
                placements.resolutionIdPrefix,
                "workspaces.placements.resolutionIdPrefix",
            ),
            resolvedPlacements,
            rules: placementRules,
            schemas: {
                platformEvidenceId: readAbsoluteUrl(
                    placementSchemas.platformEvidenceId,
                    "workspaces.placements.schemas.platformEvidenceId",
                ),
                resolutionId: readAbsoluteUrl(
                    placementSchemas.resolutionId,
                    "workspaces.placements.schemas.resolutionId",
                ),
            },
            statuses: placementStatuses,
        },
        platformConformance: {
            caseCollisionPolicy: readNonEmptyString(
                platformConformance.caseCollisionPolicy,
                "workspaces.platformConformance.caseCollisionPolicy",
            ),
            faults: {
                classifications: faultClassifications,
                metadataClassification,
                phases: faultPhases,
                platformClassification,
            },
            git: {
                coreSymlinksFalse: readNonEmptyString(
                    platformGit.coreSymlinksFalse,
                    "workspaces.platformConformance.git.coreSymlinksFalse",
                ),
                gitlinks: readNonEmptyString(
                    platformGit.gitlinks,
                    "workspaces.platformConformance.git.gitlinks",
                ),
                sparseIndex: readNonEmptyString(
                    platformGit.sparseIndex,
                    "workspaces.platformConformance.git.sparseIndex",
                ),
            },
            metadataPolicy: readNonEmptyString(
                platformConformance.metadataPolicy,
                "workspaces.platformConformance.metadataPolicy",
            ),
            metadataPathToken,
            metadataProbeMaxBytes: readPositiveInteger(
                platformConformance.metadataProbeMaxBytes,
                "workspaces.platformConformance.metadataProbeMaxBytes",
            ),
            metadataProbeTimeoutMs: readPositiveInteger(
                platformConformance.metadataProbeTimeoutMs,
                "workspaces.platformConformance.metadataProbeTimeoutMs",
            ),
            metadataProbes,
            modePolicy: readNonEmptyString(
                platformConformance.modePolicy,
                "workspaces.platformConformance.modePolicy",
            ),
            optimizedCarrierParity: readNonEmptyString(
                platformConformance.optimizedCarrierParity,
                "workspaces.platformConformance.optimizedCarrierParity",
            ),
            supportedPlatforms: readUniqueStrings(
                platformConformance.supportedPlatforms,
                "workspaces.platformConformance.supportedPlatforms",
            ),
            symlinkPolicy: readNonEmptyString(
                platformConformance.symlinkPolicy,
                "workspaces.platformConformance.symlinkPolicy",
            ),
            unsupportedMetadata: readUniqueStrings(
                platformConformance.unsupportedMetadata,
                "workspaces.platformConformance.unsupportedMetadata",
            ),
            version: readPositiveInteger(
                platformConformance.version,
                "workspaces.platformConformance.version",
            ),
        },
        protectedPaths: {
            alternateNameSeparators,
            caseFold: protectedPaths.caseFold,
            errorCode: readNonEmptyString(
                protectedPaths.errorCode,
                "workspaces.protectedPaths.errorCode",
            ),
            errorMessage: readNonEmptyString(
                protectedPaths.errorMessage,
                "workspaces.protectedPaths.errorMessage",
            ),
            normalizationForm,
            roots: Object.freeze(protectedRoots),
            trailingCharacters,
            version: readPositiveInteger(
                protectedPaths.version,
                "workspaces.protectedPaths.version",
            ),
        },
        repositoryBindings: {
            errors: {
                invalidRepositoryCode: readNonEmptyString(
                    repositoryBindingErrors.invalidRepositoryCode,
                    "workspaces.repositoryBindings.errors.invalidRepositoryCode",
                ),
                invalidRepositoryMessage: readNonEmptyString(
                    repositoryBindingErrors.invalidRepositoryMessage,
                    "workspaces.repositoryBindings.errors.invalidRepositoryMessage",
                ),
            },
            identityDirectory: repositoryIdentityDirectory,
            identityKind: readNonEmptyString(
                repositoryBindings.identityKind,
                "workspaces.repositoryBindings.identityKind",
            ),
            resourceType: readNonEmptyString(
                repositoryBindings.resourceType,
                "workspaces.repositoryBindings.resourceType",
            ),
            version: readPositiveInteger(
                repositoryBindings.version,
                "workspaces.repositoryBindings.version",
            ),
        },
        repositoryGrants: {
            artifactVersion: readPositiveInteger(
                repositoryGrants.artifactVersion,
                "workspaces.repositoryGrants.artifactVersion",
            ),
            artifacts: {
                grantPlanSchema: readNonEmptyString(
                    repositoryGrantArtifacts.grantPlanSchema,
                    "workspaces.repositoryGrants.artifacts.grantPlanSchema",
                ),
                taskGrantArtifactLockSchema: readNonEmptyString(
                    repositoryGrantArtifacts.taskGrantArtifactLockSchema,
                    "workspaces.repositoryGrants.artifacts.taskGrantArtifactLockSchema",
                ),
                taskGrantArtifactSchema: readNonEmptyString(
                    repositoryGrantArtifacts.taskGrantArtifactSchema,
                    "workspaces.repositoryGrants.artifacts.taskGrantArtifactSchema",
                ),
            },
            atoms: repositoryGrantAtoms,
            compatibilityVersion: readNonEmptyString(
                repositoryGrants.compatibilityVersion,
                "workspaces.repositoryGrants.compatibilityVersion",
            ),
            enforcement: readNonEmptyString(
                repositoryGrants.enforcement,
                "workspaces.repositoryGrants.enforcement",
            ),
            journalVersion: repositoryGrantJournalVersion,
            journalVersions: repositoryGrantJournalVersions,
            operations: {
                readText: readRepositoryGrantOperation(
                    repositoryGrantOperations.readText,
                    repositoryGrantAtoms,
                    "workspaces.repositoryGrants.operations.readText",
                ),
                writeText: readRepositoryGrantOperation(
                    repositoryGrantOperations.writeText,
                    repositoryGrantAtoms,
                    "workspaces.repositoryGrants.operations.writeText",
                ),
            },
            planIdPrefix: readNonEmptyString(
                repositoryGrants.planIdPrefix,
                "workspaces.repositoryGrants.planIdPrefix",
            ),
            planVersion: readPositiveInteger(
                repositoryGrants.planVersion,
                "workspaces.repositoryGrants.planVersion",
            ),
            profiles: repositoryGrantProfiles,
            schemas: {
                grantPlanId: readAbsoluteUrl(
                    repositoryGrantSchemas.grantPlanId,
                    "workspaces.repositoryGrants.schemas.grantPlanId",
                ),
                taskGrantArtifactId: readAbsoluteUrl(
                    repositoryGrantSchemas.taskGrantArtifactId,
                    "workspaces.repositoryGrants.schemas.taskGrantArtifactId",
                ),
                taskGrantArtifactLockId: readAbsoluteUrl(
                    repositoryGrantSchemas.taskGrantArtifactLockId,
                    "workspaces.repositoryGrants.schemas.taskGrantArtifactLockId",
                ),
            },
            taskGrantIdPrefix: readNonEmptyString(
                repositoryGrants.taskGrantIdPrefix,
                "workspaces.repositoryGrants.taskGrantIdPrefix",
            ),
        },
        worktreeRefPrefix,
        worldCapture: {
            maxRevisionDepth: readPositiveInteger(
                worldCapture.maxRevisionDepth,
                "workspaces.worldCapture.maxRevisionDepth",
            ),
            version: readPositiveInteger(worldCapture.version, "workspaces.worldCapture.version"),
        },
        worldExecution: {
            enforcementKinds: readUniqueStrings(
                worldExecution.enforcementKinds,
                "workspaces.worldExecution.enforcementKinds",
            ),
            maxRunnerIdBytes: readPositiveInteger(
                worldExecution.maxRunnerIdBytes,
                "workspaces.worldExecution.maxRunnerIdBytes",
            ),
            runnerVersion: readPositiveInteger(
                worldExecution.runnerVersion,
                "workspaces.worldExecution.runnerVersion",
            ),
        },
        worldTaskCapture: {
            captureSchemaId: readNonEmptyString(
                worldTaskCapture.captureSchemaId,
                "workspaces.worldTaskCapture.captureSchemaId",
            ),
            captureSchemaPath: readNonEmptyString(
                worldTaskCapture.captureSchemaPath,
                "workspaces.worldTaskCapture.captureSchemaPath",
            ),
            custodyIdentityKind: readNonEmptyString(
                worldTaskCapture.custodyIdentityKind,
                "workspaces.worldTaskCapture.custodyIdentityKind",
            ),
            journalPhases: readUniqueStrings(
                worldTaskCapture.journalPhases,
                "workspaces.worldTaskCapture.journalPhases",
            ),
            journalReaders,
            journalSchemaId,
            journalSchemaPath: readNonEmptyString(
                worldTaskCapture.journalSchemaPath,
                "workspaces.worldTaskCapture.journalSchemaPath",
            ),
            journalVersion,
            maxCaptureIdBytes: readPositiveInteger(
                worldTaskCapture.maxCaptureIdBytes,
                "workspaces.worldTaskCapture.maxCaptureIdBytes",
            ),
            maxTextBytes: readPositiveInteger(
                worldTaskCapture.maxTextBytes,
                "workspaces.worldTaskCapture.maxTextBytes",
            ),
            outputIdPrefix: readDigestPrefix(
                worldTaskCapture.outputIdPrefix,
                digestAlgorithm,
                "workspaces.worldTaskCapture.outputIdPrefix",
            ),
            ordinaryJournalVersion,
            statuses: readUniqueStrings(
                worldTaskCapture.statuses,
                "workspaces.worldTaskCapture.statuses",
            ),
            version: readPositiveInteger(
                worldTaskCapture.version,
                "workspaces.worldTaskCapture.version",
            ),
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

function readRepositoryGrantOperation(
    value: unknown,
    atoms: readonly string[],
    context: string,
): string {
    const atom = readNonEmptyString(value, context);
    if (!atoms.includes(atom)) {
        throw new TypeError(`${context} must identify a configured repository grant atom`);
    }
    return atom;
}

function readProtocolVersions(value: unknown, context: string): readonly number[] {
    const versions = readArray(value, context).map((version, index) =>
        readPositiveInteger(version, `${context}[${index}]`),
    );
    if (versions.length === 0 || new Set(versions).size !== versions.length) {
        throw new TypeError(`${context} must be non-empty and unique`);
    }
    return versions;
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

function readSingleCharacters(value: unknown, context: string): readonly string[] {
    const characters = readUniqueStrings(value, context);
    if (
        characters.some(
            (character) =>
                [...character].length !== 1 ||
                character === "/" ||
                character === "\\" ||
                character === "\0",
        )
    ) {
        throw new TypeError(`${context} must contain portable single characters`);
    }
    return characters;
}
