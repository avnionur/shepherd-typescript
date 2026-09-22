import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import { canonicalizeRecord, type SemanticValue } from "../canonical/canonical-record.ts";
import { observabilityProtocolConfig } from "../protocol/config.ts";
import { deepFreeze } from "../protocol/config-value-readers.ts";
import { TELEMETRY_BODY_HANDLINGS, TELEMETRY_BODY_MODES } from "../protocol/values.generated.ts";
import type { TraceSchemaClassification } from "../retention/policy.ts";
import { retentionDigest, scanSemanticValueForSecrets } from "../retention/secret-scan.ts";
import type { OwnerRecord } from "../store/types.ts";
import type {
    OtlpAnyValue,
    OtlpKeyValue,
    OtlpLogRecord,
    OtlpSpan,
    OtlpSpanEvent,
    TelemetryBatch,
} from "./otlp-types.ts";

/**
 * Exporter body mode. `omit` (the default) never exports a body; `retention-policy` exports a
 * body only when its retention data class disposition is `include`, no configured secret
 * detector matches it, and its canonical form fits the configured body bound.
 *
 * @public
 */
export type TelemetryBodyMode = (typeof TELEMETRY_BODY_MODES)[number];

/**
 * How one record body was handled in exported telemetry.
 *
 * `included` exported the body; `withheld` did not because the exporter body mode is `omit`;
 * `redacted` did not because the data class redacts bodies or a secret detector matched;
 * `omitted` did not because the data class omits bodies; `oversized` did not because the
 * canonical body exceeds the configured bound.
 *
 * @public
 */
export type TelemetryBodyHandling = (typeof TELEMETRY_BODY_HANDLINGS)[number];

const config = observabilityProtocolConfig;
const [INCLUDED, WITHHELD, REDACTED, OMITTED, OVERSIZED] = TELEMETRY_BODY_HANDLINGS;
const [OMIT_MODE] = TELEMETRY_BODY_MODES;
const TRACE_ID_HEX_LENGTH = 32;
const SPAN_ID_HEX_LENGTH = 16;

/**
 * Derives the deterministic OTLP trace identifier of one owner path.
 *
 * The identifier is the first 16 bytes of the configured digest over the configured trace domain
 * and the owner path, so every exporter maps the same owner (for a run, its run identifier) to
 * the same trace.
 *
 * @param ownerId - Exact owner path.
 * @returns 32 lowercase hex characters.
 * @throws {TypeError} If the owner path is empty.
 *
 * @example
 * ```ts
 * const traceId = deriveTelemetryTraceId(runId);
 * ```
 *
 * @public
 */
export function deriveTelemetryTraceId(ownerId: string): string {
    return deriveId(config.ids.traceDomain, ownerId, "ownerId", TRACE_ID_HEX_LENGTH);
}

/**
 * Derives the deterministic OTLP span identifier of one record.
 *
 * A run span uses the identifier of its start record. The identifier is the first 8 bytes of the
 * configured digest over the configured span domain and the record identity.
 *
 * @param recordId - Record identity.
 * @returns 16 lowercase hex characters.
 * @throws {TypeError} If the record identity is empty.
 *
 * @public
 */
export function deriveTelemetrySpanId(recordId: string): string {
    return deriveId(config.ids.spanDomain, recordId, "recordId", SPAN_ID_HEX_LENGTH);
}

function deriveId(domain: string, value: string, subject: string, length: number): string {
    if (typeof value !== "string" || value.length === 0) {
        throw new TypeError(`${subject} must be a non-empty string`);
    }
    return createHash(config.ids.digestAlgorithm)
        .update(`${domain}\0${value}`, "utf8")
        .digest("hex")
        .slice(0, length);
}

/**
 * Converts a canonical JSON value to an OTLP `AnyValue`. @internal
 *
 * Containers are converted with an explicit work list instead of recursion, so exporting a body
 * at the configured canonical nesting bound does not depend on the caller's remaining stack. Each
 * container's `values` array is filled in source order, so the result is identical to a recursive
 * conversion.
 */
export function toOtlpAnyValue(value: unknown): OtlpAnyValue {
    const pending: PendingOtlpContainer[] = [];
    const root = shallowOtlpAnyValue(value, pending);
    for (let job = pending.pop(); job !== undefined; job = pending.pop()) {
        if (job.kind === "array") {
            for (const child of job.source) {
                job.values.push(shallowOtlpAnyValue(child, pending));
            }
        } else {
            for (const [key, child] of Object.entries(job.source)) {
                job.values.push({
                    key,
                    value: shallowOtlpAnyValue(child, pending),
                });
            }
        }
    }
    return root;
}

/** A converted container whose `values` still have to be filled from its source. */
type PendingOtlpContainer =
    | {
          readonly kind: "array";
          readonly source: readonly unknown[];
          readonly values: OtlpAnyValue[];
      }
    | { readonly kind: "object"; readonly source: object; readonly values: OtlpKeyValue[] };

function shallowOtlpAnyValue(value: unknown, pending: PendingOtlpContainer[]): OtlpAnyValue {
    if (typeof value === "string") {
        return { stringValue: value };
    }
    if (typeof value === "boolean") {
        return { boolValue: value };
    }
    if (typeof value === "number") {
        return Number.isSafeInteger(value) ? { intValue: String(value) } : { doubleValue: value };
    }
    if (value === null) {
        return {};
    }
    if (Array.isArray(value)) {
        const values: OtlpAnyValue[] = [];
        pending.push({ kind: "array", source: value, values });
        return { arrayValue: { values } };
    }
    const values: OtlpKeyValue[] = [];
    pending.push({ kind: "object", source: value as object, values });
    return { kvlistValue: { values } };
}

function attribute(name: string, value: OtlpAnyValue): OtlpKeyValue {
    return { key: `${config.attributeNamespace}.${name}`, value };
}

function text(value: string): OtlpAnyValue {
    return { stringValue: value };
}

/** Exported form of one delivered record occurrence. @internal */
export type MappedRecord = {
    /** Namespaced attributes without the body. */
    readonly attributes: readonly OtlpKeyValue[];
    /** Log record carrying the attributes and, when allowed, the body. */
    readonly logRecord: OtlpLogRecord;
};

/**
 * Maps one committed owner occurrence to its attributes and log record. @internal
 */
export function mapRecord(
    record: OwnerRecord,
    classification: TraceSchemaClassification,
    mode: TelemetryBodyMode,
    observedTimeUnixNano: string,
): MappedRecord {
    const { envelope, view } = record;
    const handled = handleBody(record.body, classification, mode);
    const attributes: OtlpKeyValue[] = [
        attribute("owner_id", text(view.owner_id)),
        attribute("owner_ordinal", { intValue: String(view.owner_ordinal) }),
        attribute("record_id", text(envelope.record_id)),
        attribute("schema_ref", text(envelope.schema_ref)),
        attribute("mode", text(envelope.mode)),
        attribute("witness_ref", text(envelope.witness_ref)),
        attribute("caused_by_record_ids", {
            arrayValue: { values: envelope.caused_by_record_ids.map(text) },
        }),
        attribute("data_class", text(classification.data_class)),
        attribute("body_handling", text(handled.handling)),
        ...handled.attributes,
    ];
    return {
        attributes,
        logRecord: {
            attributes,
            ...(handled.body === undefined ? {} : { body: handled.body }),
            eventName: envelope.schema_ref,
            observedTimeUnixNano,
            severityNumber: config.otlp.logSeverityNumber,
            severityText: config.otlp.logSeverityText,
            traceId: deriveTelemetryTraceId(view.owner_id),
        },
    };
}

function handleBody(
    body: OwnerRecord["body"],
    classification: TraceSchemaClassification,
    mode: TelemetryBodyMode,
): {
    readonly attributes: readonly OtlpKeyValue[];
    readonly body?: OtlpAnyValue;
    readonly handling: TelemetryBodyHandling;
} {
    if (mode === OMIT_MODE) {
        return { attributes: [], handling: WITHHELD };
    }
    if (classification.disposition === "omit-body") {
        return { attributes: [], handling: OMITTED };
    }
    const canonical = canonicalizeRecord(body);
    const scan = scanSemanticValueForSecrets(body);
    if (classification.disposition !== "include" || scan.findings.length > 0) {
        return {
            attributes: [
                attribute("body_digest", text(retentionDigest(canonical))),
                attribute("secret_classes", {
                    arrayValue: { values: scan.secret_classes.map(text) },
                }),
            ],
            handling: REDACTED,
        };
    }
    if (Buffer.byteLength(canonical, "utf8") > config.limits.maxBodyBytes) {
        return { attributes: [], handling: OVERSIZED };
    }
    return {
        attributes: [],
        body: toOtlpAnyValue(JSON.parse(canonical) as SemanticValue),
        handling: INCLUDED,
    };
}

/** Observed start of an open run span. @internal */
export type RunSpanStart = {
    /** Attributes of the start record. */
    readonly attributes: readonly OtlpKeyValue[];
    /** Whether the start was observed by this exporter, rather than recovered from the store. */
    readonly observed: boolean;
    /** Observation time, or the terminal observation time when recovered. */
    readonly observedTimeUnixNano: string;
    /** Start record identity. */
    readonly recordId: string;
    /** Start record schema identifier. */
    readonly schemaRef: string;
};

/** Builds one closed run span from its start and terminal records. @internal */
export function buildRunSpan(
    ownerId: string,
    start: RunSpanStart | undefined,
    terminal: MappedRecord,
    terminalRecordId: string,
): OtlpSpan {
    const terminalSchemaRef = terminal.logRecord.eventName;
    const endTimeUnixNano = terminal.logRecord.observedTimeUnixNano;
    const status = config.runSpans.terminalSchemaRefs[terminalSchemaRef] as string;
    const attributes = [attribute("owner_id", text(ownerId))];
    const events: OtlpSpanEvent[] = [];
    if (start !== undefined) {
        attributes.push(
            attribute("start_record_id", text(start.recordId)),
            attribute("start_observed", { boolValue: start.observed }),
        );
        events.push({
            attributes: start.attributes,
            name: start.schemaRef,
            timeUnixNano: start.observedTimeUnixNano,
        });
    }
    attributes.push(
        attribute("terminal_record_id", text(terminalRecordId)),
        attribute("terminal_schema_ref", text(terminalSchemaRef)),
    );
    events.push({
        attributes: terminal.attributes,
        name: terminalSchemaRef,
        timeUnixNano: endTimeUnixNano,
    });
    return {
        attributes,
        endTimeUnixNano,
        events,
        kind: config.otlp.spanKind,
        name: config.runSpans.name,
        spanId: deriveTelemetrySpanId(start?.recordId ?? terminalRecordId),
        startTimeUnixNano: start?.observedTimeUnixNano ?? endTimeUnixNano,
        status: { code: config.otlp.statusCodes[status] as number },
        traceId: deriveTelemetryTraceId(ownerId),
    };
}

/** Wraps spans and log records in one frozen configured telemetry batch. @internal */
export function buildTelemetryBatch(
    spans: readonly OtlpSpan[],
    logRecords: readonly OtlpLogRecord[],
): TelemetryBatch {
    const schemaUrl = `${config.semanticConventions.schemaUrlPrefix}${config.semanticConventions.version}`;
    const resource = {
        attributes: Object.entries(config.resourceAttributes).map(([key, value]) => ({
            key,
            value: text(value),
        })),
    };
    const scope = { name: config.instrumentationScopeName, version: config.compatibilityVersion };
    return deepFreeze({
        format: config.batch.format,
        format_version: config.batch.formatVersion,
        logs: {
            resourceLogs: [{ resource, schemaUrl, scopeLogs: [{ logRecords, schemaUrl, scope }] }],
        },
        traces: {
            resourceSpans:
                spans.length === 0
                    ? []
                    : [{ resource, schemaUrl, scopeSpans: [{ schemaUrl, scope, spans }] }],
        },
    });
}
