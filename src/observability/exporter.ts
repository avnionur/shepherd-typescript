import { kernelProtocolConfig, observabilityProtocolConfig } from "../protocol/config.ts";
import { TELEMETRY_BODY_MODES } from "../protocol/values.generated.ts";
import {
    createSchemaClassifier,
    type RetentionClassificationOptions,
} from "../retention/policy.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import { openTraceSubscription } from "../supervision/subscription.ts";
import type {
    OpenTraceSubscriptionOptions,
    TraceSubscriptionCursor,
    TraceSubscriptionDelivery,
} from "../supervision/types.ts";
import {
    buildRunSpan,
    buildTelemetryBatch,
    mapRecord,
    type RunSpanStart,
    type TelemetryBodyMode,
} from "./mapping.ts";
import type { OtlpLogRecord, OtlpSpan, TelemetrySink } from "./otlp-types.ts";

/**
 * Caller-supplied observation clock.
 *
 * Returns the current Unix time in nanoseconds. Records carry no timestamps, so every exported
 * time is exporter observation time and has no trace semantics.
 *
 * @public
 */
export type TelemetryClock = () => bigint;

/**
 * Options of {@link createTraceTelemetryExporter}.
 *
 * @public
 */
export type TraceTelemetryExporterOptions = {
    /**
     * Body mode. Defaults to the configured default (`omit`), which never exports a record body.
     */
    readonly bodies?: TelemetryBodyMode;
    /** Observation clock in Unix nanoseconds. */
    readonly clock: TelemetryClock;
    /** Records per batch. Defaults to the configured default and is bounded by the maximum. */
    readonly maxRecordsPerBatch?: number;
    /** Caller classification of unconfigured schema identifiers for body retention. */
    readonly retention?: RetentionClassificationOptions;
    /** Destination of batches. */
    readonly sink: TelemetrySink;
    /** Open trace store the subscription reads; it is never appended to. */
    readonly store: SQLiteTraceStore;
    /**
     * Subscription the exporter opens and owns. Give it a `subscriptionId` for a durable
     * acknowledged cursor that survives a crash or restart.
     */
    readonly subscription: OpenTraceSubscriptionOptions;
};

/**
 * Result of one export step.
 *
 * @public
 */
export type TelemetryExportReceipt = {
    /** Subscription cursor acknowledged after the sink accepted the batch. */
    readonly acknowledged_cursor: TraceSubscriptionCursor;
    /** Log records written, one per record occurrence. */
    readonly log_record_count: number;
    /** Record occurrences exported; zero when nothing was pending and the sink was not called. */
    readonly record_count: number;
    /** Run spans closed by a terminal record in the batch. */
    readonly span_count: number;
};

/**
 * Passive exporter from committed trace records to OTLP-shaped telemetry.
 *
 * @public
 */
export type TraceTelemetryExporter = {
    /** Cursor acknowledged after the last successful sink write. */
    readonly acknowledgedCursor: TraceSubscriptionCursor;
    /**
     * Closes the owned subscription. Unacknowledged records are exported again by the next
     * exporter that opens the same durable subscription.
     */
    readonly close: () => void;
    /**
     * Exports every record retained now, up to the batch bound, as one batch.
     *
     * Calls are serialized. The batch is handed to the sink, and the cursor is acknowledged only
     * after the sink succeeds. When the sink throws or rejects, the error is rethrown, the cursor
     * is unchanged, and the same records lead the next batch.
     *
     * @returns The export receipt.
     * @throws {TypeError} If the exporter is closed or the clock returns a non-bigint or negative
     * time.
     * @throws {TraceStoreError} If the store is closed.
     * @throws Whatever the sink throws.
     */
    readonly exportPending: () => Promise<TelemetryExportReceipt>;
};

const config = observabilityProtocolConfig;

/**
 * Creates a passive, at-least-once telemetry exporter over one trace subscription.
 *
 * The exporter opens `subscription` with {@link openTraceSubscription}, maps each committed
 * owner occurrence to one OTLP log record, and closes one run span when a configured terminal
 * record follows a configured start record on the same owner. Trace identifiers derive from the
 * owner path and span identifiers from the start record identity, so they are deterministic.
 * Every attribute lives under the configured namespace. A body is exported only in the
 * `retention-policy` body mode, only when its retention disposition is `include`, no configured
 * secret detector matches, and it fits the configured bound.
 *
 * Telemetry is never canonical: the exporter appends nothing, and the trace, its export, and
 * every run are unaffected by the exporter or its sink. Only durable subscription cursor
 * bookkeeping, which lies outside the record graph, is written.
 *
 * @param options - Store, subscription, sink, clock, and optional body mode, bound, and retention
 * classification.
 * @returns A frozen exporter.
 * @throws {TypeError} If an option is malformed.
 * @throws {SupervisionCursorConflictError} If the subscription start conflicts with its cursor.
 * @throws {TraceStoreError} If the store is closed.
 *
 * @example
 * ```ts
 * const exporter = createTraceTelemetryExporter({
 *     clock: () => BigInt(Date.now()) * 1_000_000n,
 *     sink: createJsonLinesTelemetrySink({ logsPath, tracesPath }),
 *     store,
 *     subscription: { owners: [runId], subscriptionId: "telemetry:runs" },
 * });
 * await exporter.exportPending();
 * exporter.close();
 * ```
 *
 * @public
 */
export function createTraceTelemetryExporter(
    options: TraceTelemetryExporterOptions,
): TraceTelemetryExporter {
    if (options === null || typeof options !== "object") {
        throw new TypeError("telemetry exporter options must be an object");
    }
    const { clock, sink, store } = options;
    if (typeof clock !== "function") {
        throw new TypeError("clock must be a function");
    }
    if (sink === null || typeof sink !== "object" || typeof sink.write !== "function") {
        throw new TypeError("sink must declare a write function");
    }
    const bodies = options.bodies ?? (config.bodies.defaultMode as TelemetryBodyMode);
    if (!TELEMETRY_BODY_MODES.includes(bodies)) {
        throw new TypeError("bodies must be a configured telemetry body mode");
    }
    const maxRecords = options.maxRecordsPerBatch ?? config.limits.defaultRecordsPerBatch;
    if (
        !Number.isSafeInteger(maxRecords) ||
        maxRecords < 1 ||
        maxRecords > config.limits.maxRecordsPerBatch
    ) {
        throw new TypeError("maxRecordsPerBatch must be within the configured batch bound");
    }
    const classify = createSchemaClassifier(options.retention ?? {});
    const subscription = openTraceSubscription(store, options.subscription);
    let closed = false;
    let starts = new Map<string, RunSpanStart>();
    let retained: TraceSubscriptionDelivery[] = [];
    let tail: Promise<unknown> = Promise.resolve();

    const observe = (): string => {
        const time: unknown = clock();
        if (typeof time !== "bigint" || time < 0n) {
            throw new TypeError("clock must return a non-negative bigint of Unix nanoseconds");
        }
        return time.toString();
    };

    const recoverStart = (
        ownerId: string,
        terminalOrdinal: number,
        observedTimeUnixNano: string,
    ): RunSpanStart | undefined => {
        for (
            let ordinal = terminalOrdinal - 1;
            ordinal >= kernelProtocolConfig.append.firstOwnerOrdinal;
            ordinal -= 1
        ) {
            const record = store.readOwnerOccurrence(ownerId, ordinal);
            if (config.runSpans.startSchemaRefs.includes(record.envelope.schema_ref)) {
                return {
                    attributes: mapRecord(
                        record,
                        classify(record.envelope.schema_ref),
                        bodies,
                        observedTimeUnixNano,
                    ).attributes,
                    observed: false,
                    observedTimeUnixNano,
                    recordId: record.envelope.record_id,
                    schemaRef: record.envelope.schema_ref,
                };
            }
        }
        return undefined;
    };

    const exportOnce = async (): Promise<TelemetryExportReceipt> => {
        if (closed) {
            throw new TypeError("telemetry exporter is closed");
        }
        const positions = subscription.deliveredCursor.positions;
        const next = store.readOwnerNextOrdinals(positions.map(({ owner_id }) => owner_id));
        let available = positions.reduce(
            (total, position) =>
                total + ((next.get(position.owner_id) as number) - position.next_ordinal),
            0,
        );
        while (retained.length < maxRecords && available > 0) {
            const delivery = await subscription.next();
            if (delivery === undefined) {
                break;
            }
            retained.push(delivery);
            available -= 1;
        }
        if (retained.length === 0) {
            return receipt(0, 0, 0);
        }
        const pendingStarts = new Map(starts);
        const spans: OtlpSpan[] = [];
        const logRecords: OtlpLogRecord[] = [];
        for (const { record } of retained) {
            const observedTimeUnixNano = observe();
            const schemaRef = record.envelope.schema_ref;
            const ownerId = record.view.owner_id;
            const mapped = mapRecord(record, classify(schemaRef), bodies, observedTimeUnixNano);
            logRecords.push(mapped.logRecord);
            if (config.runSpans.startSchemaRefs.includes(schemaRef)) {
                pendingStarts.set(ownerId, {
                    attributes: mapped.attributes,
                    observed: true,
                    observedTimeUnixNano,
                    recordId: record.envelope.record_id,
                    schemaRef,
                });
            } else if (Object.hasOwn(config.runSpans.terminalSchemaRefs, schemaRef)) {
                spans.push(
                    buildRunSpan(
                        ownerId,
                        pendingStarts.get(ownerId) ??
                            recoverStart(ownerId, record.view.owner_ordinal, observedTimeUnixNano),
                        mapped,
                        record.envelope.record_id,
                    ),
                );
                pendingStarts.delete(ownerId);
            }
        }
        await sink.write(buildTelemetryBatch(spans, logRecords));
        const exported = retained;
        subscription.acknowledge((exported.at(-1) as TraceSubscriptionDelivery).cursor);
        retained = [];
        starts = pendingStarts;
        return receipt(exported.length, spans.length, logRecords.length);
    };

    const receipt = (
        recordCount: number,
        spanCount: number,
        logRecordCount: number,
    ): TelemetryExportReceipt =>
        Object.freeze({
            acknowledged_cursor: subscription.acknowledgedCursor,
            log_record_count: logRecordCount,
            record_count: recordCount,
            span_count: spanCount,
        });

    return Object.freeze({
        get acknowledgedCursor() {
            return subscription.acknowledgedCursor;
        },
        close: () => {
            closed = true;
            subscription.close();
        },
        exportPending: () => {
            const result = tail.then(exportOnce);
            tail = result.catch(() => undefined);
            return result;
        },
    });
}
