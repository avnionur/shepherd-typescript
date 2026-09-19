# Observability

Status: normative from 2.31.0 (Phase 11 slice 7, #184). Configuration: the `observability` section
of [`protocol.config.json`](../protocol.config.json), read by
[`src/protocol/config-observability.ts`](../src/protocol/config-observability.ts). Implementation:
[`src/observability/`](../src/observability) (`otlp-types.ts`, `mapping.ts`, `exporter.ts`,
`jsonl-sink.ts`). Public entry: [`./operations`](./package-exports.md) and the root. Schema:
[`telemetry-batch-v1`](../spec/schemas/telemetry-batch-v1.schema.json). Tests:
[`test/observability/`](../test/observability).

## Telemetry is never canonical

The trace store is the only source of truth. Telemetry is a lossy, derived view of committed
records for operators and dashboards:

- the exporter only reads committed records through
  [`openTraceSubscription`](./trace-subscriptions.md); it appends nothing, and a store's `exportTrace()`
  output is byte-identical before and after any export;
- no run, dispatch, or append waits for telemetry, and a failing sink affects only the exporter;
- telemetry is never imported, replayed, or used to reconstruct a trace, and a telemetry file is
  not evidence of anything the trace does not already record;
- the only state the exporter writes is the durable subscription cursor, which lives in store
  bookkeeping outside the record graph and outside trace export.

Records carry no timestamps by design (decision D-014). Every time in a batch
(`observedTimeUnixNano`, span `startTimeUnixNano`/`endTimeUnixNano`, and event `timeUnixNano`) is
the exporter's observation time from the caller-supplied `clock`. These times are non-semantic:
they depend on when the exporter ran, differ between re-exports of the same record, and must not
be used to order or reason about trace history. Log records never set `timeUnixNano`, which OTLP
reserves for the time an event occurred.

## Exporter

```ts
import {
    createJsonLinesTelemetrySink,
    createTraceTelemetryExporter,
} from "@avnionur/shepherd-typescript/operations";

const exporter = createTraceTelemetryExporter({
    clock: () => BigInt(Date.now()) * 1_000_000n,
    sink: createJsonLinesTelemetrySink({ logsPath, tracesPath }),
    store,
    subscription: { owners: [runId], subscriptionId: "telemetry:runs" },
});
await exporter.exportPending();
exporter.close();
```

`createTraceTelemetryExporter({ store, subscription, sink, clock, bodies?, maxRecordsPerBatch?,
retention? })` opens and owns one subscription. `exportPending()` takes every record retained now,
up to the batch bound (`observability.limits`), builds one `TelemetryBatch`, hands it to the
sink, and only after the sink returns or resolves acknowledges the cursor of the last record.
Calls are serialized. When nothing is pending, the sink is not called. The exporter never polls
on its own; callers decide the cadence.

### Delivery and recovery

Delivery is at-least-once:

- a sink that throws or rejects leaves the acknowledged cursor unchanged; the error is rethrown
  and the same records lead the next batch;
- with a `subscriptionId`, the acknowledged cursor is durable. After a crash or restart a new
  exporter opened with the same subscription resumes strictly after the last acknowledged record,
  so records of a batch whose sink write was not acknowledged are exported again;
- consumers must tolerate duplicates. Trace, span, and record identities are deterministic, so
  duplicates are recognizable.

An ephemeral subscription (no `subscriptionId`) retains nothing across processes.

## Mapping

| Trace concept | OTLP | Rule |
| --- | --- | --- |
| Owner path (for a run, its run id) | `traceId` | First 16 bytes of the configured digest over `ids.traceDomain`, a NUL byte, and the owner path (`deriveTelemetryTraceId`). |
| Run lifecycle | one `Span` | A configured start record (`runSpans.startSchemaRefs`) followed on the same owner by a configured terminal record (`runSpans.terminalSchemaRefs`) closes one span when the terminal record is exported. |
| Start record | `spanId` | First 8 bytes of the configured digest over `ids.spanDomain`, a NUL byte, and the start record id (`deriveTelemetrySpanId`). A terminal record with no retained start names the span instead. |
| Terminal record | span `status.code` | The terminal schema's configured status (`ok` or `error`) mapped through `otlp.statusCodes`. |
| Start and terminal records | span `events` | One event per record, named by `schema_ref`, with the record attributes. |
| Every record occurrence | one `LogRecord` | `eventName` is `schema_ref`; `traceId` is the owner trace; attributes as below. |

Span attributes: `<ns>.owner_id`, `<ns>.start_record_id`, `<ns>.start_observed`,
`<ns>.terminal_record_id`, and `<ns>.terminal_schema_ref`. `start_observed` is `false` when the
start record was acknowledged before this exporter started; the exporter then recovers the start
record from the store (a bounded backwards read on that owner) and uses the terminal observation
time as the start time. A run that has not terminated contributes only its log records.

Record attributes: `<ns>.owner_id`, `<ns>.owner_ordinal`, `<ns>.record_id`, `<ns>.schema_ref`,
`<ns>.mode`, `<ns>.witness_ref`, `<ns>.caused_by_record_ids`, `<ns>.data_class`, and
`<ns>.body_handling`, plus `<ns>.body_digest` and `<ns>.secret_classes` for a redacted body.
`<ns>` is `observability.attributeNamespace` (`shepherd`). The only non-namespaced attributes are
the configured resource attributes (`service.name`).

Each batch holds at most one `ResourceSpans` and one `ResourceLogs`, each with one scope named by
`instrumentationScopeName` and versioned by the observability compatibility version. Resource and
scope `schemaUrl` name the configured semantic-conventions release
(`https://opentelemetry.io/schemas/1.37.0`).

## Bodies

Bodies are withheld by default. The `bodies` option selects a `TELEMETRY_BODY_MODES` entry:

- `omit` (default): no body is exported; `body_handling` is `withheld`;
- `retention-policy`: the [retention](./secrets-and-retention.md) data class of each record decides,
  using the same classifier as redacted export (`retention.schemaDataClasses` classifies
  caller-defined schemas).

| `body_handling` | Meaning |
| --- | --- |
| `included` | Disposition `include`, no configured secret detector matched, and the canonical body fits `limits.maxBodyBytes`; the body is exported as an OTLP `AnyValue` with canonical key order. |
| `withheld` | Body mode `omit`. |
| `redacted` | Disposition `redact`, or any detector matched; only the retention body digest and detected secret classes are exported. |
| `omitted` | Disposition `omit-body`; nothing about the body is exported. |
| `oversized` | The body would be included but exceeds the bound. |

A body a detector matches is never exported in any mode. Detection is pattern-based and
incomplete; envelopes, owner paths, and schema identifiers are exported as attributes and are not
scanned, as in redacted export.

## OTLP/JSON encoding

Batches follow the OTLP/JSON encoding of [OTLP 1.11.0](https://opentelemetry.io/docs/specs/otlp/)
(opentelemetry-proto `v1.11.0`), restricted to the fields in
[`otlp-types.ts`](../src/observability/otlp-types.ts):

- field names are lowerCamelCase;
- `traceId` and `spanId` are lowercase hex strings (32 and 16 characters), not base64;
- 64-bit integers (`*UnixNano`, `intValue`) are decimal strings;
- enums (`kind`, `status.code`, `severityNumber`) are integers;
- a null body member is an empty `AnyValue` object.

No OpenTelemetry SDK is used, no collector is bundled, and the package contains no network
exporter.

## Sinks

`TelemetrySink` is a caller-supplied `{ write(batch) }`. A sink must make the batch durable, or
hand it to something durable, before completing, because completion acknowledges the cursor.

`createJsonLinesTelemetrySink({ tracesPath, logsPath })` implements the
[OTLP file format](https://opentelemetry.io/docs/specs/otel/protocol/file-exporter/) (status:
development): UTF-8, one JSON value per `\n`-terminated line, and one signal type per file. Each
write appends the batch's `ExportTraceServiceRequest` to `tracesPath` when it has a span and its
`ExportLogsServiceRequest` to `logsPath` when it has a log record, then fsyncs each file. Files
are created with the owner-only `retention.storeFiles.mode` (`0600`), and an existing file with
group or other bits is tightened first. The files can be read by the OpenTelemetry Collector
`otlpjsonfile` receiver. A retried batch may repeat lines.

## Configuration

The `observability` section holds the batch identity (`shepherd.telemetry.batch` v1), the schema
destination and identifier, the attribute namespace, the body modes and handlings, identifier
digest and domains, the instrumentation-scope name, the batch and body bounds, OTLP wire constants
(targeted proto release, span kind, status codes, log severity), resource attributes, run-span
name and lifecycle schemas, and the semantic-conventions schema URL prefix and release. The reader
requires run-span schemas to be distinct configured execution-history schemas and every terminal
status to have a status code. The batch identity, schema, identifier derivation, and body
vocabularies are pinned by `OBSERVABILITY_PROTOCOL_V1_CONTRACT`; the rest is tunable policy.

## Limits

- Observation times are non-semantic, and a recovered span start equals its end.
- Open run spans are held in memory per owner until their terminal record; a restart loses the
  observed start time, not the span.
- Only runs whose lifecycle schemas are configured produce spans; other owners produce log records.
- No metrics signal, no sampling, no parent/child span links between delegated runs.
- Telemetry files are local; shipping them is the operator's collector configuration.
