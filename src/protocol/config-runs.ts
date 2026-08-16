import type { ProtocolConfig } from "./config-types.ts";
import {
    readAbsoluteUrl,
    readNonEmptyString,
    readNonNegativeInteger,
    readObject,
    readPositiveInteger,
    readSafeInteger,
    readUniqueStrings,
} from "./config-value-readers.ts";

/** Validates configured run-outcome versions, statuses, and schema artifacts. */
export function readRunConfig(value: unknown): ProtocolConfig["runs"] {
    const runs = readObject(
        value,
        [
            "artifactContentTypes",
            "artifactVersion",
            "artifacts",
            "control",
            "execution",
            "firstArtifactOrdinal",
            "lastArtifactOrdinal",
            "outcomeVersion",
            "schemas",
            "terminalStatuses",
            "usageVersion",
        ],
        "runs",
    );
    const artifacts = readObject(
        runs.artifacts,
        [
            "artifactSchema",
            "continuationDescriptorSchema",
            "outcomeSchema",
            "runningLifecycleSchema",
            "suspendedLifecycleSchema",
            "usageSchema",
            "waitingLifecycleSchema",
        ],
        "runs.artifacts",
    );
    const schemas = readObject(
        runs.schemas,
        [
            "artifactId",
            "continuationDescriptorId",
            "outcomeId",
            "runningLifecycleId",
            "suspendedLifecycleId",
            "usageId",
            "waitingLifecycleId",
        ],
        "runs.schemas",
    );
    const control = readObject(
        runs.control,
        [
            "budgetMetrics",
            "cancellationReason",
            "disposalReason",
            "maxTimerDurationMilliseconds",
            "reasonTypes",
            "statuses",
        ],
        "runs.control",
    );
    const execution = readObject(
        runs.execution,
        [
            "continuationConstituentKinds",
            "continuationEvidenceStatuses",
            "continuationVerifiedStatus",
            "continuationVersion",
            "controlCommandKinds",
            "controlCommandSchemaId",
            "errors",
            "invocationClaimAppendStatuses",
            "invocationClaimLeaseMilliseconds",
            "invocationClaimStatuses",
            "lifecycleStatuses",
            "lifecycleRunningStatus",
            "lifecycleSuspendedStatus",
            "lifecycleTerminalStatus",
            "lifecycleTerminalTransitions",
            "lifecycleTransitions",
            "lifecycleVersion",
            "lifecycleWaitingStatus",
            "recoveryStatuses",
        ],
        "runs.execution",
    );
    const executionErrors = readObject(
        execution.errors,
        [
            "claimFencedCode",
            "claimFencedMessage",
            "claimLostCode",
            "claimLostMessage",
            "costUnavailableMessage",
            "costUnavailableType",
            "outputValidationMessage",
            "outputValidationType",
            "providerFailureMessage",
            "providerFailureType",
            "recoveryAbsentCode",
            "recoveryAbsentMessage",
            "recoveryCommandRequiredCode",
            "recoveryCommandRequiredMessage",
            "recoveryStartedCode",
            "recoveryStartedMessage",
        ],
        "runs.execution.errors",
    );
    const firstArtifactOrdinal = readNonNegativeInteger(
        runs.firstArtifactOrdinal,
        "runs.firstArtifactOrdinal",
    );
    const lastArtifactOrdinal = readSafeInteger(
        runs.lastArtifactOrdinal,
        "runs.lastArtifactOrdinal",
    );
    if (
        lastArtifactOrdinal < firstArtifactOrdinal ||
        lastArtifactOrdinal >= Number.MAX_SAFE_INTEGER
    ) {
        throw new TypeError(
            "runs.lastArtifactOrdinal must be at least the first ordinal and leave a safe next ordinal",
        );
    }
    const terminalStatuses = readUniqueStrings(runs.terminalStatuses, "runs.terminalStatuses");
    const lifecycleStatuses = readUniqueStrings(
        execution.lifecycleStatuses,
        "runs.execution.lifecycleStatuses",
    );
    const lifecycleTerminalStatus = readNonEmptyString(
        execution.lifecycleTerminalStatus,
        "runs.execution.lifecycleTerminalStatus",
    );
    const lifecycleRunningStatus = readNonEmptyString(
        execution.lifecycleRunningStatus,
        "runs.execution.lifecycleRunningStatus",
    );
    const lifecycleWaitingStatus = readNonEmptyString(
        execution.lifecycleWaitingStatus,
        "runs.execution.lifecycleWaitingStatus",
    );
    const lifecycleSuspendedStatus = readNonEmptyString(
        execution.lifecycleSuspendedStatus,
        "runs.execution.lifecycleSuspendedStatus",
    );
    const lifecycleTransitions = readStringPairs(
        execution.lifecycleTransitions,
        "runs.execution.lifecycleTransitions",
    );
    const lifecycleTerminalTransitions = readStringPairs(
        execution.lifecycleTerminalTransitions,
        "runs.execution.lifecycleTerminalTransitions",
    );
    const continuationEvidenceStatuses = readUniqueStrings(
        execution.continuationEvidenceStatuses,
        "runs.execution.continuationEvidenceStatuses",
    );
    if (continuationEvidenceStatuses.length < 2) {
        throw new TypeError(
            "runs.execution.continuationEvidenceStatuses must include receipt-bearing and receiptless statuses",
        );
    }
    const continuationVerifiedStatus = readNonEmptyString(
        execution.continuationVerifiedStatus,
        "runs.execution.continuationVerifiedStatus",
    );
    if (!continuationEvidenceStatuses.includes(continuationVerifiedStatus)) {
        throw new TypeError(
            "runs.execution.continuationVerifiedStatus must be a configured evidence status",
        );
    }
    if (
        !lifecycleStatuses.includes(lifecycleTerminalStatus) ||
        !lifecycleStatuses.includes(lifecycleRunningStatus) ||
        !lifecycleStatuses.includes(lifecycleWaitingStatus) ||
        !lifecycleStatuses.includes(lifecycleSuspendedStatus) ||
        new Set([
            lifecycleTerminalStatus,
            lifecycleRunningStatus,
            lifecycleWaitingStatus,
            lifecycleSuspendedStatus,
        ]).size !== 4
    ) {
        throw new TypeError(
            "configured terminal, running, waiting, and suspended lifecycle statuses must be distinct known statuses",
        );
    }
    for (const [source, target] of lifecycleTransitions) {
        if (
            !lifecycleStatuses.includes(source) ||
            !lifecycleStatuses.includes(target) ||
            source === lifecycleTerminalStatus ||
            target === lifecycleTerminalStatus
        ) {
            throw new TypeError(
                "runs.execution.lifecycleTransitions must contain known non-terminal statuses",
            );
        }
    }
    for (const [source, terminalStatus] of lifecycleTerminalTransitions) {
        if (
            !lifecycleStatuses.includes(source) ||
            source === lifecycleTerminalStatus ||
            !terminalStatuses.includes(terminalStatus)
        ) {
            throw new TypeError(
                "runs.execution.lifecycleTerminalTransitions must contain a known non-terminal source and terminal outcome",
            );
        }
    }
    return {
        artifactContentTypes: readUniqueStrings(
            runs.artifactContentTypes,
            "runs.artifactContentTypes",
        ),
        artifactVersion: readPositiveInteger(runs.artifactVersion, "runs.artifactVersion"),
        artifacts: {
            artifactSchema: readNonEmptyString(
                artifacts.artifactSchema,
                "runs.artifacts.artifactSchema",
            ),
            continuationDescriptorSchema: readNonEmptyString(
                artifacts.continuationDescriptorSchema,
                "runs.artifacts.continuationDescriptorSchema",
            ),
            outcomeSchema: readNonEmptyString(
                artifacts.outcomeSchema,
                "runs.artifacts.outcomeSchema",
            ),
            runningLifecycleSchema: readNonEmptyString(
                artifacts.runningLifecycleSchema,
                "runs.artifacts.runningLifecycleSchema",
            ),
            suspendedLifecycleSchema: readNonEmptyString(
                artifacts.suspendedLifecycleSchema,
                "runs.artifacts.suspendedLifecycleSchema",
            ),
            usageSchema: readNonEmptyString(artifacts.usageSchema, "runs.artifacts.usageSchema"),
            waitingLifecycleSchema: readNonEmptyString(
                artifacts.waitingLifecycleSchema,
                "runs.artifacts.waitingLifecycleSchema",
            ),
        },
        control: {
            budgetMetrics: readUniqueStrings(control.budgetMetrics, "runs.control.budgetMetrics"),
            cancellationReason: readNonEmptyString(
                control.cancellationReason,
                "runs.control.cancellationReason",
            ),
            disposalReason: readNonEmptyString(
                control.disposalReason,
                "runs.control.disposalReason",
            ),
            maxTimerDurationMilliseconds: readPositiveInteger(
                control.maxTimerDurationMilliseconds,
                "runs.control.maxTimerDurationMilliseconds",
            ),
            reasonTypes: readUniqueStrings(control.reasonTypes, "runs.control.reasonTypes"),
            statuses: readUniqueStrings(control.statuses, "runs.control.statuses"),
        },
        execution: {
            continuationConstituentKinds: readUniqueStrings(
                execution.continuationConstituentKinds,
                "runs.execution.continuationConstituentKinds",
            ),
            continuationEvidenceStatuses,
            continuationVerifiedStatus,
            continuationVersion: readPositiveInteger(
                execution.continuationVersion,
                "runs.execution.continuationVersion",
            ),
            controlCommandKinds: readUniqueStrings(
                execution.controlCommandKinds,
                "runs.execution.controlCommandKinds",
            ),
            controlCommandSchemaId: readNonEmptyString(
                execution.controlCommandSchemaId,
                "runs.execution.controlCommandSchemaId",
            ),
            errors: {
                claimFencedCode: readNonEmptyString(
                    executionErrors.claimFencedCode,
                    "runs.execution.errors.claimFencedCode",
                ),
                claimFencedMessage: readNonEmptyString(
                    executionErrors.claimFencedMessage,
                    "runs.execution.errors.claimFencedMessage",
                ),
                claimLostCode: readNonEmptyString(
                    executionErrors.claimLostCode,
                    "runs.execution.errors.claimLostCode",
                ),
                claimLostMessage: readNonEmptyString(
                    executionErrors.claimLostMessage,
                    "runs.execution.errors.claimLostMessage",
                ),
                costUnavailableMessage: readNonEmptyString(
                    executionErrors.costUnavailableMessage,
                    "runs.execution.errors.costUnavailableMessage",
                ),
                costUnavailableType: readNonEmptyString(
                    executionErrors.costUnavailableType,
                    "runs.execution.errors.costUnavailableType",
                ),
                outputValidationMessage: readNonEmptyString(
                    executionErrors.outputValidationMessage,
                    "runs.execution.errors.outputValidationMessage",
                ),
                outputValidationType: readNonEmptyString(
                    executionErrors.outputValidationType,
                    "runs.execution.errors.outputValidationType",
                ),
                providerFailureMessage: readNonEmptyString(
                    executionErrors.providerFailureMessage,
                    "runs.execution.errors.providerFailureMessage",
                ),
                providerFailureType: readNonEmptyString(
                    executionErrors.providerFailureType,
                    "runs.execution.errors.providerFailureType",
                ),
                recoveryAbsentCode: readNonEmptyString(
                    executionErrors.recoveryAbsentCode,
                    "runs.execution.errors.recoveryAbsentCode",
                ),
                recoveryAbsentMessage: readNonEmptyString(
                    executionErrors.recoveryAbsentMessage,
                    "runs.execution.errors.recoveryAbsentMessage",
                ),
                recoveryCommandRequiredCode: readNonEmptyString(
                    executionErrors.recoveryCommandRequiredCode,
                    "runs.execution.errors.recoveryCommandRequiredCode",
                ),
                recoveryCommandRequiredMessage: readNonEmptyString(
                    executionErrors.recoveryCommandRequiredMessage,
                    "runs.execution.errors.recoveryCommandRequiredMessage",
                ),
                recoveryStartedCode: readNonEmptyString(
                    executionErrors.recoveryStartedCode,
                    "runs.execution.errors.recoveryStartedCode",
                ),
                recoveryStartedMessage: readNonEmptyString(
                    executionErrors.recoveryStartedMessage,
                    "runs.execution.errors.recoveryStartedMessage",
                ),
            },
            invocationClaimAppendStatuses: readUniqueStrings(
                execution.invocationClaimAppendStatuses,
                "runs.execution.invocationClaimAppendStatuses",
            ),
            invocationClaimLeaseMilliseconds: readPositiveInteger(
                execution.invocationClaimLeaseMilliseconds,
                "runs.execution.invocationClaimLeaseMilliseconds",
            ),
            invocationClaimStatuses: readUniqueStrings(
                execution.invocationClaimStatuses,
                "runs.execution.invocationClaimStatuses",
            ),
            lifecycleStatuses,
            lifecycleRunningStatus,
            lifecycleSuspendedStatus,
            lifecycleTerminalStatus,
            lifecycleTerminalTransitions,
            lifecycleTransitions,
            lifecycleVersion: readPositiveInteger(
                execution.lifecycleVersion,
                "runs.execution.lifecycleVersion",
            ),
            lifecycleWaitingStatus,
            recoveryStatuses: readUniqueStrings(
                execution.recoveryStatuses,
                "runs.execution.recoveryStatuses",
            ),
        },
        firstArtifactOrdinal,
        lastArtifactOrdinal,
        outcomeVersion: readPositiveInteger(runs.outcomeVersion, "runs.outcomeVersion"),
        schemas: {
            artifactId: readAbsoluteUrl(schemas.artifactId, "runs.schemas.artifactId"),
            continuationDescriptorId: readAbsoluteUrl(
                schemas.continuationDescriptorId,
                "runs.schemas.continuationDescriptorId",
            ),
            outcomeId: readAbsoluteUrl(schemas.outcomeId, "runs.schemas.outcomeId"),
            runningLifecycleId: readAbsoluteUrl(
                schemas.runningLifecycleId,
                "runs.schemas.runningLifecycleId",
            ),
            suspendedLifecycleId: readAbsoluteUrl(
                schemas.suspendedLifecycleId,
                "runs.schemas.suspendedLifecycleId",
            ),
            usageId: readAbsoluteUrl(schemas.usageId, "runs.schemas.usageId"),
            waitingLifecycleId: readAbsoluteUrl(
                schemas.waitingLifecycleId,
                "runs.schemas.waitingLifecycleId",
            ),
        },
        terminalStatuses,
        usageVersion: readPositiveInteger(runs.usageVersion, "runs.usageVersion"),
    };
}

function readStringPairs(value: unknown, subject: string): readonly (readonly [string, string])[] {
    if (!Array.isArray(value) || value.length === 0) {
        throw new TypeError(`${subject} must be a non-empty array`);
    }
    const pairs = value.map((candidate, index) => {
        if (!Array.isArray(candidate) || candidate.length !== 2) {
            throw new TypeError(`${subject}[${index}] must contain exactly two strings`);
        }
        return Object.freeze([
            readNonEmptyString(candidate[0], `${subject}[${index}][0]`),
            readNonEmptyString(candidate[1], `${subject}[${index}][1]`),
        ] as const);
    });
    const identities = pairs.map(([first, second]) => `${first}\u0000${second}`);
    if (new Set(identities).size !== identities.length) {
        throw new TypeError(`${subject} must not contain duplicate pairs`);
    }
    return Object.freeze(pairs);
}
