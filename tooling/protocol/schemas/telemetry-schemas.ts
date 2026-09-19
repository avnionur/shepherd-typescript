import type { ProtocolConfig } from "../../../src/protocol/config-types.ts";

const UNIX_NANOS = { type: "string", pattern: "^(0|[1-9][0-9]{0,19})$" };

/**
 * Renders the configured telemetry-batch JSON Schema: a Shepherd envelope around one OTLP/JSON
 * `ExportTraceServiceRequest` and one `ExportLogsServiceRequest` subset.
 *
 * @param config - Validated protocol configuration.
 * @returns The closed `telemetry-batch-v1` schema.
 */
export function renderTelemetryBatchSchema(
    config: ProtocolConfig,
): Readonly<Record<string, unknown>> {
    const observability = config.observability;
    const schemaUrl = {
        const: `${observability.semanticConventions.schemaUrlPrefix}${observability.semanticConventions.version}`,
    };
    const scope = closedObject(["name", "version"], {
        name: { const: observability.instrumentationScopeName },
        version: { const: observability.compatibilityVersion },
    });
    const resource = closedObject(["attributes"], {
        attributes: { type: "array", items: { $ref: "#/$defs/keyValue" } },
    });
    const namespacedAttributes = {
        type: "array",
        items: {
            allOf: [
                { $ref: "#/$defs/keyValue" },
                {
                    type: "object",
                    properties: {
                        key: {
                            type: "string",
                            pattern: `^${escapePattern(observability.attributeNamespace)}\\.`,
                        },
                    },
                },
            ],
        },
    };
    const traceId = { type: "string", pattern: "^[0-9a-f]{32}$" };
    const span = closedObject(
        [
            "attributes",
            "endTimeUnixNano",
            "events",
            "kind",
            "name",
            "spanId",
            "startTimeUnixNano",
            "status",
            "traceId",
        ],
        {
            attributes: namespacedAttributes,
            endTimeUnixNano: UNIX_NANOS,
            events: {
                type: "array",
                items: closedObject(["attributes", "name", "timeUnixNano"], {
                    attributes: namespacedAttributes,
                    name: { type: "string", minLength: 1 },
                    timeUnixNano: UNIX_NANOS,
                }),
            },
            kind: { const: observability.otlp.spanKind },
            name: { const: observability.runSpans.name },
            spanId: { type: "string", pattern: "^[0-9a-f]{16}$" },
            startTimeUnixNano: UNIX_NANOS,
            status: closedObject(["code"], {
                code: {
                    enum: [...new Set(Object.values(observability.otlp.statusCodes))].sort(
                        (left, right) => left - right,
                    ),
                },
            }),
            traceId,
        },
    );
    const logRecord = closedObject(
        [
            "attributes",
            "eventName",
            "observedTimeUnixNano",
            "severityNumber",
            "severityText",
            "traceId",
        ],
        {
            attributes: namespacedAttributes,
            body: { $ref: "#/$defs/anyValue" },
            eventName: { type: "string", minLength: 1 },
            observedTimeUnixNano: UNIX_NANOS,
            severityNumber: { const: observability.otlp.logSeverityNumber },
            severityText: { const: observability.otlp.logSeverityText },
            traceId,
        },
    );
    return {
        $schema: config.kernel.schemas.dialect,
        $id: observability.schemas.batchId,
        $comment: "Generated from protocol.config.json. Do not edit directly.",
        title: "Shepherd Telemetry Batch v1",
        description: `Non-canonical telemetry derived from committed trace records. traces and logs are OTLP/JSON ExportTraceServiceRequest and ExportLogsServiceRequest subsets (opentelemetry-proto ${observability.otlp.protoVersion}); timestamps are exporter observation time and carry no trace semantics.`,
        ...closedObject(["format", "format_version", "logs", "traces"], {
            format: { const: observability.batch.format },
            format_version: { const: observability.batch.formatVersion },
            logs: closedObject(["resourceLogs"], {
                resourceLogs: {
                    type: "array",
                    items: closedObject(["resource", "schemaUrl", "scopeLogs"], {
                        resource,
                        schemaUrl,
                        scopeLogs: {
                            type: "array",
                            items: closedObject(["logRecords", "schemaUrl", "scope"], {
                                logRecords: { type: "array", items: logRecord },
                                schemaUrl,
                                scope,
                            }),
                        },
                    }),
                },
            }),
            traces: closedObject(["resourceSpans"], {
                resourceSpans: {
                    type: "array",
                    items: closedObject(["resource", "schemaUrl", "scopeSpans"], {
                        resource,
                        schemaUrl,
                        scopeSpans: {
                            type: "array",
                            items: closedObject(["schemaUrl", "scope", "spans"], {
                                schemaUrl,
                                scope,
                                spans: { type: "array", items: span },
                            }),
                        },
                    }),
                },
            }),
        }),
        $defs: {
            anyValue: {
                oneOf: [
                    closedObject(["stringValue"], { stringValue: { type: "string" } }),
                    closedObject(["boolValue"], { boolValue: { type: "boolean" } }),
                    closedObject(["intValue"], {
                        intValue: { type: "string", pattern: "^-?(0|[1-9][0-9]{0,18})$" },
                    }),
                    closedObject(["doubleValue"], { doubleValue: { type: "number" } }),
                    closedObject(["arrayValue"], {
                        arrayValue: closedObject(["values"], {
                            values: { type: "array", items: { $ref: "#/$defs/anyValue" } },
                        }),
                    }),
                    closedObject(["kvlistValue"], {
                        kvlistValue: closedObject(["values"], {
                            values: { type: "array", items: { $ref: "#/$defs/keyValue" } },
                        }),
                    }),
                    { type: "object", maxProperties: 0 },
                ],
            },
            keyValue: closedObject(["key", "value"], {
                key: { type: "string" },
                value: { $ref: "#/$defs/anyValue" },
            }),
        },
    };
}

function escapePattern(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function closedObject(
    required: readonly string[],
    properties: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
    return { type: "object", required, properties, additionalProperties: false };
}
