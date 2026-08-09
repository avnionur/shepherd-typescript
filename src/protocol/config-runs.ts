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
        ["artifactSchema", "outcomeSchema", "usageSchema"],
        "runs.artifacts",
    );
    const schemas = readObject(
        runs.schemas,
        ["artifactId", "outcomeId", "usageId"],
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
            outcomeSchema: readNonEmptyString(
                artifacts.outcomeSchema,
                "runs.artifacts.outcomeSchema",
            ),
            usageSchema: readNonEmptyString(artifacts.usageSchema, "runs.artifacts.usageSchema"),
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
        firstArtifactOrdinal,
        lastArtifactOrdinal,
        outcomeVersion: readPositiveInteger(runs.outcomeVersion, "runs.outcomeVersion"),
        schemas: {
            artifactId: readAbsoluteUrl(schemas.artifactId, "runs.schemas.artifactId"),
            outcomeId: readAbsoluteUrl(schemas.outcomeId, "runs.schemas.outcomeId"),
            usageId: readAbsoluteUrl(schemas.usageId, "runs.schemas.usageId"),
        },
        terminalStatuses: readUniqueStrings(runs.terminalStatuses, "runs.terminalStatuses"),
        usageVersion: readPositiveInteger(runs.usageVersion, "runs.usageVersion"),
    };
}
