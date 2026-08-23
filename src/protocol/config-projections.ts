import type {
    KernelProtocolConfig,
    NonEmptyReadonlyArray,
    ProjectionProtocolConfig,
} from "./config-types.ts";
import {
    readAbsoluteUrl,
    readNonEmptyString,
    readObject,
    readPositiveInteger,
    readUniqueStrings,
} from "./config-value-readers.ts";

/** Validates disposable projection contracts against configured query capabilities. */
export function readProjectionConfig(
    value: unknown,
    queries: KernelProtocolConfig["queries"],
): ProjectionProtocolConfig {
    const projections = readObject(value, ["executionHistory", "taskRunLedgers"], "projections");
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
    const ledgers = readObject(
        projections.taskRunLedgers,
        [
            "artifacts",
            "compatibilityVersion",
            "defaultPageSize",
            "errors",
            "latestSelector",
            "maxCanonicalEntryBytes",
            "maxPageSize",
            "maxSelectorBytes",
            "schemas",
            "taskVersionSeparator",
            "version",
        ],
        "projections.taskRunLedgers",
    );
    const artifacts = readObject(
        ledgers.artifacts,
        ["runEntrySchema", "taskEntrySchema"],
        "projections.taskRunLedgers.artifacts",
    );
    const errors = readObject(
        ledgers.errors,
        ["ambiguousCode", "ambiguousMessage", "notFoundCode", "notFoundMessage"],
        "projections.taskRunLedgers.errors",
    );
    const ledgerSchemas = readObject(
        ledgers.schemas,
        ["runEntryId", "taskEntryId"],
        "projections.taskRunLedgers.schemas",
    );
    const defaultPageSize = readPositiveInteger(
        ledgers.defaultPageSize,
        "projections.taskRunLedgers.defaultPageSize",
    );
    const maxPageSize = readPositiveInteger(
        ledgers.maxPageSize,
        "projections.taskRunLedgers.maxPageSize",
    );
    if (defaultPageSize > maxPageSize) {
        throw new TypeError("task/run ledger default page size must not exceed its maximum");
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
        taskRunLedgers: {
            artifacts: {
                runEntrySchema: readNonEmptyString(
                    artifacts.runEntrySchema,
                    "projections.taskRunLedgers.artifacts.runEntrySchema",
                ),
                taskEntrySchema: readNonEmptyString(
                    artifacts.taskEntrySchema,
                    "projections.taskRunLedgers.artifacts.taskEntrySchema",
                ),
            },
            compatibilityVersion: readNonEmptyString(
                ledgers.compatibilityVersion,
                "projections.taskRunLedgers.compatibilityVersion",
            ),
            defaultPageSize,
            errors: {
                ambiguousCode: readNonEmptyString(
                    errors.ambiguousCode,
                    "projections.taskRunLedgers.errors.ambiguousCode",
                ),
                ambiguousMessage: readNonEmptyString(
                    errors.ambiguousMessage,
                    "projections.taskRunLedgers.errors.ambiguousMessage",
                ),
                notFoundCode: readNonEmptyString(
                    errors.notFoundCode,
                    "projections.taskRunLedgers.errors.notFoundCode",
                ),
                notFoundMessage: readNonEmptyString(
                    errors.notFoundMessage,
                    "projections.taskRunLedgers.errors.notFoundMessage",
                ),
            },
            latestSelector: readNonEmptyString(
                ledgers.latestSelector,
                "projections.taskRunLedgers.latestSelector",
            ),
            maxCanonicalEntryBytes: readPositiveInteger(
                ledgers.maxCanonicalEntryBytes,
                "projections.taskRunLedgers.maxCanonicalEntryBytes",
            ),
            maxPageSize,
            maxSelectorBytes: readPositiveInteger(
                ledgers.maxSelectorBytes,
                "projections.taskRunLedgers.maxSelectorBytes",
            ),
            schemas: {
                runEntryId: readAbsoluteUrl(
                    ledgerSchemas.runEntryId,
                    "projections.taskRunLedgers.schemas.runEntryId",
                ),
                taskEntryId: readAbsoluteUrl(
                    ledgerSchemas.taskEntryId,
                    "projections.taskRunLedgers.schemas.taskEntryId",
                ),
            },
            taskVersionSeparator: readNonEmptyString(
                ledgers.taskVersionSeparator,
                "projections.taskRunLedgers.taskVersionSeparator",
            ),
            version: readPositiveInteger(ledgers.version, "projections.taskRunLedgers.version"),
        },
    };
}
