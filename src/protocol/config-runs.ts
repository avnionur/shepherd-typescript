import type { ProtocolConfig } from "./config-types.ts";
import {
    readAbsoluteUrl,
    readNonEmptyString,
    readObject,
    readPositiveInteger,
    readUniqueStrings,
} from "./config-value-readers.ts";

/** Validates configured run-outcome versions, statuses, and schema artifacts. */
export function readRunConfig(value: unknown): ProtocolConfig["runs"] {
    const runs = readObject(
        value,
        ["artifacts", "outcomeVersion", "schemas", "terminalStatuses"],
        "runs",
    );
    const artifacts = readObject(runs.artifacts, ["outcomeSchema"], "runs.artifacts");
    const schemas = readObject(runs.schemas, ["outcomeId"], "runs.schemas");
    return {
        artifacts: {
            outcomeSchema: readNonEmptyString(
                artifacts.outcomeSchema,
                "runs.artifacts.outcomeSchema",
            ),
        },
        outcomeVersion: readPositiveInteger(runs.outcomeVersion, "runs.outcomeVersion"),
        schemas: {
            outcomeId: readAbsoluteUrl(schemas.outcomeId, "runs.schemas.outcomeId"),
        },
        terminalStatuses: readUniqueStrings(runs.terminalStatuses, "runs.terminalStatuses"),
    };
}
