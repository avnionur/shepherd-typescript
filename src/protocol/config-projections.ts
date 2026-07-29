import type {
    KernelProtocolConfig,
    NonEmptyReadonlyArray,
    ProjectionProtocolConfig,
} from "./config-types.ts";
import { readNonEmptyString, readObject, readUniqueStrings } from "./config-value-readers.ts";

/** Validates disposable projection contracts against configured query capabilities. */
export function readProjectionConfig(
    value: unknown,
    queries: KernelProtocolConfig["queries"],
): ProjectionProtocolConfig {
    const projections = readObject(value, ["executionHistory"], "projections");
    const history = readObject(
        projections.executionHistory,
        [
            "activeRelationKinds",
            "executionSchemas",
            "modeRequirement",
            "payloadVisibilityProfiles",
            "publishedRecordSchemaRef",
            "relationKinds",
            "relationSchemaRef",
        ],
        "projections.executionHistory",
    );
    const schemas = readObject(
        history.executionSchemas,
        ["completed", "created", "failed", "started"],
        "projections.executionHistory.executionSchemas",
    );
    const modeRequirement = readNonEmptyString(
        history.modeRequirement,
        "projections.executionHistory.modeRequirement",
    );
    const payloadVisibilityProfiles = readUniqueStrings(
        history.payloadVisibilityProfiles,
        "projections.executionHistory.payloadVisibilityProfiles",
    );
    const relationKinds = readUniqueStrings(
        history.relationKinds,
        "projections.executionHistory.relationKinds",
    );
    const activeRelationKinds = readUniqueStrings(
        history.activeRelationKinds,
        "projections.executionHistory.activeRelationKinds",
    );
    if (
        payloadVisibilityProfiles.length === 0 ||
        !queries.modeFilters.includes(modeRequirement) ||
        payloadVisibilityProfiles.some(
            (profile) => !queries.visibilityProfiles.includes(profile),
        ) ||
        activeRelationKinds.some((kind) => !relationKinds.includes(kind))
    ) {
        throw new TypeError(
            "execution-history projection requirements must use configured queries",
        );
    }
    return {
        executionHistory: {
            activeRelationKinds,
            executionSchemas: {
                completed: readNonEmptyString(
                    schemas.completed,
                    "projections.executionHistory.executionSchemas.completed",
                ),
                created: readNonEmptyString(
                    schemas.created,
                    "projections.executionHistory.executionSchemas.created",
                ),
                failed: readNonEmptyString(
                    schemas.failed,
                    "projections.executionHistory.executionSchemas.failed",
                ),
                started: readNonEmptyString(
                    schemas.started,
                    "projections.executionHistory.executionSchemas.started",
                ),
            },
            modeRequirement,
            payloadVisibilityProfiles: payloadVisibilityProfiles as NonEmptyReadonlyArray<string>,
            publishedRecordSchemaRef: readNonEmptyString(
                history.publishedRecordSchemaRef,
                "projections.executionHistory.publishedRecordSchemaRef",
            ),
            relationKinds,
            relationSchemaRef: readNonEmptyString(
                history.relationSchemaRef,
                "projections.executionHistory.relationSchemaRef",
            ),
        },
    };
}
