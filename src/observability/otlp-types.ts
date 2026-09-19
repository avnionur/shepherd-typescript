// Hand-written OTLP/JSON subset types for opentelemetry-proto 1.11.0. Only the fields Shepherd
// emits are declared. Field names are lowerCamelCase, trace and span identifiers are lowercase
// hex, 64-bit integers are decimal strings, and enums are integers, as OTLP/JSON requires.

/**
 * OTLP `AnyValue`: exactly one variant, or an empty object for an absent (null) value.
 *
 * @public
 */
export type OtlpAnyValue =
    | { readonly stringValue: string }
    | { readonly boolValue: boolean }
    | { readonly intValue: string }
    | { readonly doubleValue: number }
    | { readonly arrayValue: { readonly values: readonly OtlpAnyValue[] } }
    | { readonly kvlistValue: { readonly values: readonly OtlpKeyValue[] } }
    | { readonly [key: string]: never };

/**
 * OTLP `KeyValue` attribute.
 *
 * @public
 */
export type OtlpKeyValue = {
    /** Attribute key. */
    readonly key: string;
    /** Attribute value. */
    readonly value: OtlpAnyValue;
};

/**
 * OTLP `Resource` subset.
 *
 * @public
 */
export type OtlpResource = {
    /** Resource attributes, such as the configured `service.name`. */
    readonly attributes: readonly OtlpKeyValue[];
};

/**
 * OTLP `InstrumentationScope` subset.
 *
 * @public
 */
export type OtlpInstrumentationScope = {
    /** Configured instrumentation-scope name. */
    readonly name: string;
    /** Observability compatibility version. */
    readonly version: string;
};

/**
 * OTLP `Span.Event` subset.
 *
 * @public
 */
export type OtlpSpanEvent = {
    /** Namespaced record attributes. */
    readonly attributes: readonly OtlpKeyValue[];
    /** Record schema identifier. */
    readonly name: string;
    /** Exporter observation time in Unix nanoseconds, as a decimal string. */
    readonly timeUnixNano: string;
};

/**
 * OTLP `Status` subset.
 *
 * @public
 */
export type OtlpStatus = {
    /** Configured OTLP `StatusCode` integer. */
    readonly code: number;
};

/**
 * OTLP `Span` subset.
 *
 * @public
 */
export type OtlpSpan = {
    /** Namespaced run attributes. */
    readonly attributes: readonly OtlpKeyValue[];
    /** Exporter observation time of the terminal record, in Unix nanoseconds. */
    readonly endTimeUnixNano: string;
    /** Start and terminal lifecycle events. */
    readonly events: readonly OtlpSpanEvent[];
    /** Configured OTLP `SpanKind` integer. */
    readonly kind: number;
    /** Configured run-span name. */
    readonly name: string;
    /** 16 lowercase hex characters (8 bytes). */
    readonly spanId: string;
    /** Exporter observation time of the start record, in Unix nanoseconds. */
    readonly startTimeUnixNano: string;
    /** Terminal status. */
    readonly status: OtlpStatus;
    /** 32 lowercase hex characters (16 bytes). */
    readonly traceId: string;
};

/**
 * OTLP `ScopeSpans` subset.
 *
 * @public
 */
export type OtlpScopeSpans = {
    /** Semantic-conventions schema URL. */
    readonly schemaUrl: string;
    /** Instrumentation scope. */
    readonly scope: OtlpInstrumentationScope;
    /** Spans. */
    readonly spans: readonly OtlpSpan[];
};

/**
 * OTLP `ResourceSpans` subset.
 *
 * @public
 */
export type OtlpResourceSpans = {
    /** Resource. */
    readonly resource: OtlpResource;
    /** Semantic-conventions schema URL. */
    readonly schemaUrl: string;
    /** Scope spans. */
    readonly scopeSpans: readonly OtlpScopeSpans[];
};

/**
 * OTLP `ExportTraceServiceRequest` subset; one JSON line of an OTLP traces file.
 *
 * @public
 */
export type OtlpExportTraceServiceRequest = {
    /** Resource spans. */
    readonly resourceSpans: readonly OtlpResourceSpans[];
};

/**
 * OTLP `LogRecord` subset. `timeUnixNano` is never set because records carry no event time.
 *
 * @public
 */
export type OtlpLogRecord = {
    /** Namespaced record attributes. */
    readonly attributes: readonly OtlpKeyValue[];
    /** Record body, present only when the retention policy and exporter body mode allow it. */
    readonly body?: OtlpAnyValue;
    /** Record schema identifier. */
    readonly eventName: string;
    /** Exporter observation time in Unix nanoseconds, as a decimal string. */
    readonly observedTimeUnixNano: string;
    /** Configured OTLP `SeverityNumber` integer. */
    readonly severityNumber: number;
    /** Configured severity text. */
    readonly severityText: string;
    /** Trace identifier derived from the owner path. */
    readonly traceId: string;
};

/**
 * OTLP `ScopeLogs` subset.
 *
 * @public
 */
export type OtlpScopeLogs = {
    /** Log records. */
    readonly logRecords: readonly OtlpLogRecord[];
    /** Semantic-conventions schema URL. */
    readonly schemaUrl: string;
    /** Instrumentation scope. */
    readonly scope: OtlpInstrumentationScope;
};

/**
 * OTLP `ResourceLogs` subset.
 *
 * @public
 */
export type OtlpResourceLogs = {
    /** Resource. */
    readonly resource: OtlpResource;
    /** Semantic-conventions schema URL. */
    readonly schemaUrl: string;
    /** Scope logs. */
    readonly scopeLogs: readonly OtlpScopeLogs[];
};

/**
 * OTLP `ExportLogsServiceRequest` subset; one JSON line of an OTLP logs file.
 *
 * @public
 */
export type OtlpExportLogsServiceRequest = {
    /** Resource logs. */
    readonly resourceLogs: readonly OtlpResourceLogs[];
};

/**
 * One non-canonical telemetry batch handed to a {@link TelemetrySink}.
 *
 * Validates against `spec/schemas/telemetry-batch-v1.schema.json`. It is derived from committed
 * records and never read back into a trace.
 *
 * @public
 */
export type TelemetryBatch = {
    /** Configured telemetry batch format. */
    readonly format: string;
    /** Configured telemetry batch format version. */
    readonly format_version: number;
    /** Log records, one per delivered record occurrence. */
    readonly logs: OtlpExportLogsServiceRequest;
    /** Run spans closed by a terminal record in this batch. */
    readonly traces: OtlpExportTraceServiceRequest;
};

/**
 * Caller-supplied destination of telemetry batches.
 *
 * The exporter acknowledges a subscription cursor only after `write` returns or its promise
 * resolves, so a sink must make a batch durable (or hand it to a durable collector) before
 * completing. A sink that throws or rejects leaves the cursor where it was; the same records are
 * exported again, which makes delivery at-least-once.
 *
 * @public
 */
export type TelemetrySink = {
    /**
     * Persists or forwards one batch.
     *
     * @param batch - Frozen telemetry batch.
     */
    readonly write: (batch: TelemetryBatch) => Promise<void> | void;
};
