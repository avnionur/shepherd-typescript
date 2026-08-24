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
    const projections = readObject(
        value,
        ["evidenceRecords", "executionHistory", "taskRunLedgers"],
        "projections",
    );
    const evidenceRecords = readEvidenceRecordConfig(projections.evidenceRecords);
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
        evidenceRecords,
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

function readEvidenceRecordConfig(value: unknown): ProjectionProtocolConfig["evidenceRecords"] {
    const evidence = readObject(
        value,
        [
            "artifacts",
            "compatibilityVersion",
            "defaultPageSize",
            "errors",
            "latestSelector",
            "maxCanonicalEntryBytes",
            "maxPageSize",
            "maxSelectorBytes",
            "outputIdJsonPath",
            "schemas",
            "version",
        ],
        "projections.evidenceRecords",
    );
    const artifacts = readObject(
        evidence.artifacts,
        ["outputCitationSchema", "recoveryRecordSchema", "traceRevisionSchema"],
        "projections.evidenceRecords.artifacts",
    );
    const errors = readObject(
        evidence.errors,
        ["ambiguousCode", "ambiguousMessage", "notFoundCode", "notFoundMessage"],
        "projections.evidenceRecords.errors",
    );
    const schemas = readObject(
        evidence.schemas,
        ["outputCitationId", "recoveryRecordId", "traceRevisionId"],
        "projections.evidenceRecords.schemas",
    );
    const defaultPageSize = readPositiveInteger(
        evidence.defaultPageSize,
        "projections.evidenceRecords.defaultPageSize",
    );
    const maxPageSize = readPositiveInteger(
        evidence.maxPageSize,
        "projections.evidenceRecords.maxPageSize",
    );
    if (defaultPageSize > maxPageSize) {
        throw new TypeError("evidence record default page size must not exceed its maximum");
    }
    return {
        artifacts: {
            outputCitationSchema: readNonEmptyString(
                artifacts.outputCitationSchema,
                "projections.evidenceRecords.artifacts.outputCitationSchema",
            ),
            recoveryRecordSchema: readNonEmptyString(
                artifacts.recoveryRecordSchema,
                "projections.evidenceRecords.artifacts.recoveryRecordSchema",
            ),
            traceRevisionSchema: readNonEmptyString(
                artifacts.traceRevisionSchema,
                "projections.evidenceRecords.artifacts.traceRevisionSchema",
            ),
        },
        compatibilityVersion: readNonEmptyString(
            evidence.compatibilityVersion,
            "projections.evidenceRecords.compatibilityVersion",
        ),
        defaultPageSize,
        errors: {
            ambiguousCode: readNonEmptyString(
                errors.ambiguousCode,
                "projections.evidenceRecords.errors.ambiguousCode",
            ),
            ambiguousMessage: readNonEmptyString(
                errors.ambiguousMessage,
                "projections.evidenceRecords.errors.ambiguousMessage",
            ),
            notFoundCode: readNonEmptyString(
                errors.notFoundCode,
                "projections.evidenceRecords.errors.notFoundCode",
            ),
            notFoundMessage: readNonEmptyString(
                errors.notFoundMessage,
                "projections.evidenceRecords.errors.notFoundMessage",
            ),
        },
        latestSelector: readNonEmptyString(
            evidence.latestSelector,
            "projections.evidenceRecords.latestSelector",
        ),
        maxCanonicalEntryBytes: readPositiveInteger(
            evidence.maxCanonicalEntryBytes,
            "projections.evidenceRecords.maxCanonicalEntryBytes",
        ),
        maxPageSize,
        maxSelectorBytes: readPositiveInteger(
            evidence.maxSelectorBytes,
            "projections.evidenceRecords.maxSelectorBytes",
        ),
        outputIdJsonPath: readNonEmptyString(
            evidence.outputIdJsonPath,
            "projections.evidenceRecords.outputIdJsonPath",
        ),
        schemas: {
            outputCitationId: readAbsoluteUrl(
                schemas.outputCitationId,
                "projections.evidenceRecords.schemas.outputCitationId",
            ),
            recoveryRecordId: readAbsoluteUrl(
                schemas.recoveryRecordId,
                "projections.evidenceRecords.schemas.recoveryRecordId",
            ),
            traceRevisionId: readAbsoluteUrl(
                schemas.traceRevisionId,
                "projections.evidenceRecords.schemas.traceRevisionId",
            ),
        },
        version: readPositiveInteger(evidence.version, "projections.evidenceRecords.version"),
    };
}
