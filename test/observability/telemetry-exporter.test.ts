import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { serializeJsonText } from "../../src/canonical/json-text.ts";
import {
    classifyTraceSchema,
    createJsonLinesTelemetrySink,
    createTraceTelemetryExporter,
    deriveTelemetrySpanId,
    deriveTelemetryTraceId,
    type OtlpKeyValue,
    type OtlpLogRecord,
    SQLiteTraceStore,
    TELEMETRY_BODY_HANDLINGS,
    TELEMETRY_BODY_MODES,
    type TelemetryBatch,
} from "../../src/index.ts";
import { buildTelemetryBatch, mapRecord } from "../../src/observability/mapping.ts";
import { kernelProtocolConfig } from "../../src/protocol/config.ts";
import {
    appendRecord,
    recordingSink,
    runDurableGreeting,
    steppingClock,
    telemetryBatchValidator,
    temporaryDirectory,
} from "./fixtures.ts";

const [OMIT_MODE, POLICY_MODE] = TELEMETRY_BODY_MODES;
const [INCLUDED, WITHHELD, REDACTED, OMITTED, OVERSIZED] = TELEMETRY_BODY_HANDLINGS;
const CREATED = "shepherd2.execution.created.v1";
const COMPLETED = "shepherd2.execution.completed.v1";
const FAILED = "shepherd2.execution.failed.v1";
const CONTEXT_SCHEMA = "shepherd.supervision.context.v1";

const logsOf = (batch: TelemetryBatch | undefined): readonly OtlpLogRecord[] =>
    batch?.logs.resourceLogs[0]?.scopeLogs[0]?.logRecords ?? [];
const spansOf = (batch: TelemetryBatch | undefined) =>
    batch?.traces.resourceSpans[0]?.scopeSpans[0]?.spans ?? [];
const attributeOf = (attributes: readonly OtlpKeyValue[], name: string): unknown =>
    attributes.find((attribute) => attribute.key === `shepherd.${name}`)?.value;

test("a durable run exports one deterministic span and schema-valid log records passively", async () => {
    using store = new SQLiteTraceStore();
    const runId = "run:telemetry:1";
    await runDurableGreeting(store, runId);
    const before = store.exportTrace();
    const sink = recordingSink();
    const exporter = createTraceTelemetryExporter({
        clock: steppingClock(),
        sink,
        store,
        subscription: { owners: [runId], subscriptionId: "telemetry:passive" },
    });
    const receipt = await exporter.exportPending();
    assert.equal(receipt.record_count, 6);
    assert.equal(receipt.log_record_count, 6);
    assert.equal(receipt.span_count, 1);
    assert.equal(Object.isFrozen(receipt), true);
    assert.deepEqual(exporter.acknowledgedCursor.positions, [{ next_ordinal: 6, owner_id: runId }]);
    assert.equal(store.exportTrace(), before);
    const [batch] = sink.batches;
    const validate = telemetryBatchValidator();
    assert.equal(validate(batch), true, JSON.stringify(validate.errors));
    assert.equal(serializeJsonText(batch), JSON.stringify(batch));
    assert.equal(Object.isFrozen(batch), true);
    const [span] = spansOf(batch);
    const created = store.readOwner(runId)[0];
    assert.equal(span?.traceId, deriveTelemetryTraceId(runId));
    assert.equal(span?.spanId, deriveTelemetrySpanId(created?.envelope.record_id as string));
    assert.equal(span?.status.code, 1);
    assert.deepEqual(
        span?.events.map((event) => event.name),
        [CREATED, COMPLETED],
    );
    assert.deepEqual(attributeOf(span?.attributes ?? [], "start_observed"), { boolValue: true });
    assert.equal(
        BigInt(span?.startTimeUnixNano as string) < BigInt(span?.endTimeUnixNano as string),
        true,
    );
    for (const log of logsOf(batch)) {
        assert.equal(log.body, undefined);
        assert.equal(log.traceId, span?.traceId);
        assert.deepEqual(attributeOf(log.attributes, "body_handling"), { stringValue: WITHHELD });
    }
    assert.deepEqual(
        logsOf(batch).map((log) => log.eventName),
        store.readOwner(runId).map((record) => record.envelope.schema_ref),
    );
    const idle = await exporter.exportPending();
    assert.equal(idle.record_count, 0);
    assert.equal(sink.batches.length, 1);
    exporter.close();
    await assert.rejects(exporter.exportPending(), /telemetry exporter is closed/u);
    assert.equal(store.exportTrace(), before);
});

test("a throwing sink affects no run and does not advance the cursor", async () => {
    using store = new SQLiteTraceStore();
    appendRecord(store, "run:a", CREATED, { label: "start" });
    const sink = recordingSink();
    sink.failures = 1;
    const exporter = createTraceTelemetryExporter({
        clock: steppingClock(),
        sink,
        store,
        subscription: { owners: ["run:a", "run:b"], subscriptionId: "telemetry:failing" },
    });
    const origin = exporter.acknowledgedCursor;
    const exported = store.exportTrace();
    await assert.rejects(exporter.exportPending(), /sink unavailable/u);
    assert.equal(exporter.acknowledgedCursor, origin);
    assert.equal(store.exportTrace(), exported);
    await runDurableGreeting(store, "run:b");
    assert.equal(store.verifyIntegrity().ok, true);
    appendRecord(store, "run:a", COMPLETED, { label: "done" });
    const retried = await exporter.exportPending();
    assert.equal(retried.record_count, 8);
    assert.equal(retried.span_count, 2);
    const [batch] = sink.batches;
    const aSpan = spansOf(batch).find((span) => span.traceId === deriveTelemetryTraceId("run:a"));
    assert.deepEqual(
        aSpan?.events.map((event) => event.name),
        [CREATED, COMPLETED],
    );
    assert.deepEqual(retried.acknowledged_cursor.positions, [
        { next_ordinal: 2, owner_id: "run:a" },
        { next_ordinal: 6, owner_id: "run:b" },
    ]);
    exporter.close();
});

test("a restarted exporter resumes at-least-once from the acknowledged cursor", async (context) => {
    const databasePath = path.join(await temporaryDirectory(context, "restart"), "trace.sqlite");
    const runId = "run:telemetry:restart";
    const subscription = { owners: [runId], subscriptionId: "telemetry:restart" };
    let recordIds: readonly string[];
    {
        using store = new SQLiteTraceStore(databasePath);
        await runDurableGreeting(store, runId);
        recordIds = store.readOwner(runId).map((record) => record.envelope.record_id);
        const sink = recordingSink();
        const exporter = createTraceTelemetryExporter({
            clock: steppingClock(),
            maxRecordsPerBatch: 2,
            sink,
            store,
            subscription,
        });
        assert.equal((await exporter.exportPending()).record_count, 2);
        sink.failures = 1;
        await assert.rejects(exporter.exportPending(), /sink unavailable/u);
        exporter.close();
    }
    using reopened = new SQLiteTraceStore(databasePath);
    const sink = recordingSink();
    const exporter = createTraceTelemetryExporter({
        clock: steppingClock(),
        sink,
        store: reopened,
        subscription,
    });
    assert.deepEqual(exporter.acknowledgedCursor.positions, [{ next_ordinal: 2, owner_id: runId }]);
    const receipt = await exporter.exportPending();
    assert.equal(receipt.record_count, 4);
    const [batch] = sink.batches;
    assert.deepEqual(
        logsOf(batch).map((log) => attributeOf(log.attributes, "record_id")),
        recordIds.slice(2).map((stringValue) => ({ stringValue })),
    );
    const [span] = spansOf(batch);
    assert.equal(span?.spanId, deriveTelemetrySpanId(recordIds[0] as string));
    assert.deepEqual(attributeOf(span?.attributes ?? [], "start_observed"), { boolValue: false });
    assert.equal(span?.startTimeUnixNano, span?.endTimeUnixNano);
    exporter.close();
});

test("bodies follow the retention policy and secret-bearing bodies are never emitted", async () => {
    using store = new SQLiteTraceStore();
    const secret = ["gh", "p_", "Q".repeat(36)].join("");
    appendRecord(store, "worker", "example.clean.v1", {
        flag: true,
        items: [1.5, null, "x"],
        nested: { count: 2 },
    });
    appendRecord(store, "worker", "example.secret.v1", { credential: secret });
    appendRecord(store, "worker", CONTEXT_SCHEMA, { note: "context" });
    appendRecord(store, "worker", "example.memory.v1", { memory: "private" });
    appendRecord(store, "worker", "example.large.v1", { text: "x".repeat(70_000) });
    const sink = recordingSink();
    const exporter = createTraceTelemetryExporter({
        bodies: POLICY_MODE,
        clock: steppingClock(),
        retention: { schemaDataClasses: { "example.memory.v1": "memory-adapter" } },
        sink,
        store,
        subscription: { owners: ["worker"] },
    });
    await exporter.exportPending();
    const [batch] = sink.batches;
    const validate = telemetryBatchValidator();
    assert.equal(validate(batch), true, JSON.stringify(validate.errors));
    assert.equal(JSON.stringify(batch).includes(secret), false);
    const logs = logsOf(batch);
    assert.deepEqual(
        logs.map((log) => attributeOf(log.attributes, "body_handling")),
        [INCLUDED, REDACTED, REDACTED, OMITTED, OVERSIZED].map((stringValue) => ({
            stringValue,
        })),
    );
    assert.deepEqual(logs[0]?.body, {
        kvlistValue: {
            values: [
                { key: "flag", value: { boolValue: true } },
                {
                    key: "items",
                    value: {
                        arrayValue: {
                            values: [{ doubleValue: 1.5 }, {}, { stringValue: "x" }],
                        },
                    },
                },
                {
                    key: "nested",
                    value: {
                        kvlistValue: { values: [{ key: "count", value: { intValue: "2" } }] },
                    },
                },
            ],
        },
    });
    assert.deepEqual(
        logs.slice(1).map((log) => log.body),
        [undefined, undefined, undefined, undefined],
    );
    assert.deepEqual(attributeOf(logs[1]?.attributes ?? [], "secret_classes"), {
        arrayValue: { values: [{ stringValue: "github-token" }] },
    });
    assert.deepEqual(attributeOf(logs[2]?.attributes ?? [], "secret_classes"), {
        arrayValue: { values: [] },
    });
    assert.match(
        (attributeOf(logs[1]?.attributes ?? [], "body_digest") as { stringValue: string })
            .stringValue,
        /^sha256:[0-9a-f]{64}$/u,
    );
    assert.deepEqual(attributeOf(logs[3]?.attributes ?? [], "data_class"), {
        stringValue: "memory-adapter",
    });
    exporter.close();
});

test("a terminal record without a start closes a span named by the terminal record", async () => {
    using store = new SQLiteTraceStore();
    appendRecord(store, "run:orphan", "example.other.v1", { step: 1 });
    const failed = appendRecord(store, "run:orphan", FAILED, { error: "boom" });
    const sink = recordingSink();
    const exporter = createTraceTelemetryExporter({
        bodies: OMIT_MODE,
        clock: steppingClock(),
        sink,
        store,
        subscription: { owners: ["run:orphan"] },
    });
    await exporter.exportPending();
    const [span] = spansOf(sink.batches[0]);
    assert.equal(span?.spanId, deriveTelemetrySpanId(failed));
    assert.equal(span?.status.code, 2);
    assert.deepEqual(
        span?.events.map((event) => event.name),
        [FAILED],
    );
    assert.equal(attributeOf(span?.attributes ?? [], "start_record_id"), undefined);
    assert.equal(telemetryBatchValidator()(sink.batches[0]), true);
    exporter.close();
});

test("export calls are serialized and batches respect the record bound", async () => {
    using store = new SQLiteTraceStore();
    for (const step of [1, 2, 3]) {
        appendRecord(store, "worker", "example.step.v1", { step });
    }
    const sink = recordingSink();
    const exporter = createTraceTelemetryExporter({
        clock: steppingClock(),
        maxRecordsPerBatch: 2,
        sink,
        store,
        subscription: { owners: ["worker"] },
    });
    const [first, second, third] = await Promise.all([
        exporter.exportPending(),
        exporter.exportPending(),
        exporter.exportPending(),
    ]);
    assert.deepEqual([first.record_count, second.record_count, third.record_count], [2, 1, 0]);
    assert.deepEqual(
        sink.batches.map((batch) => batch.traces.resourceSpans.length),
        [0, 0],
    );
    exporter.close();
});

test("an aborted subscription exports nothing", async () => {
    using store = new SQLiteTraceStore();
    appendRecord(store, "worker", "example.step.v1", { step: 1 });
    const sink = recordingSink();
    const exporter = createTraceTelemetryExporter({
        clock: steppingClock(),
        sink,
        store,
        subscription: { owners: ["worker"], signal: AbortSignal.abort() },
    });
    assert.equal((await exporter.exportPending()).record_count, 0);
    assert.equal(sink.batches.length, 0);
    exporter.close();
});

test("invalid clocks fail the batch without acknowledgement", async () => {
    using store = new SQLiteTraceStore();
    appendRecord(store, "worker", "example.step.v1", { step: 1 });
    for (const clock of [() => 1 as unknown as bigint, () => -1n]) {
        const exporter = createTraceTelemetryExporter({
            clock,
            sink: recordingSink(),
            store,
            subscription: { owners: ["worker"] },
        });
        await assert.rejects(exporter.exportPending(), /non-negative bigint/u);
        assert.deepEqual(exporter.acknowledgedCursor.positions, [
            { next_ordinal: 0, owner_id: "worker" },
        ]);
        exporter.close();
    }
});

test("exporter options are validated", () => {
    using store = new SQLiteTraceStore();
    const valid = {
        clock: steppingClock(),
        sink: recordingSink(),
        store,
        subscription: { owners: ["worker"] },
    };
    const cases: readonly [unknown, RegExp][] = [
        [null, /options must be an object/u],
        [{ ...valid, clock: 1 }, /clock must be a function/u],
        [{ ...valid, sink: null }, /sink must declare a write function/u],
        [{ ...valid, sink: {} }, /sink must declare a write function/u],
        [{ ...valid, bodies: "all" }, /configured telemetry body mode/u],
        [{ ...valid, maxRecordsPerBatch: 0 }, /configured batch bound/u],
        [{ ...valid, maxRecordsPerBatch: 1.5 }, /configured batch bound/u],
        [{ ...valid, maxRecordsPerBatch: 1_000_000 }, /configured batch bound/u],
        [{ ...valid, subscription: { owners: [] } }, /owners must be distinct/u],
    ];
    for (const [options, message] of cases) {
        assert.throws(() => createTraceTelemetryExporter(options as never), message);
    }
});

test("trace and span identifiers are deterministic and domain-separated", () => {
    assert.equal(deriveTelemetryTraceId("run:1"), deriveTelemetryTraceId("run:1"));
    assert.match(deriveTelemetryTraceId("run:1"), /^[0-9a-f]{32}$/u);
    assert.match(deriveTelemetrySpanId("run:1"), /^[0-9a-f]{16}$/u);
    assert.notEqual(deriveTelemetryTraceId("run:1").slice(0, 16), deriveTelemetrySpanId("run:1"));
    assert.throws(() => deriveTelemetryTraceId(""), /ownerId must be a non-empty string/u);
    assert.throws(() => deriveTelemetrySpanId(1 as never), /recordId must be a non-empty string/u);
});

/** Runs `action` below `frames` extra stack frames of an ordinary recursive caller. */
function atStackDepth<T>(frames: number, action: () => T): T {
    return frames === 0 ? action() : atStackDepth(frames - 1, action);
}

test("an included body at the canonical nesting bound exports independent of the caller's stack", async (context) => {
    // Mapping a body to OTLP, freezing the batch, and writing a JSON line walk the whole body;
    // like the canonical encoder, they must not depend on how much call stack the caller has
    // left. The OTLP shape spends several levels per body level, so an at-bound body is nested
    // deeper than native JSON.stringify accepts on Linux even from a shallow stack.
    const { maxNestingDepth } = kernelProtocolConfig.canonicalization;
    let deep: unknown = "leaf";
    for (let level = 1; level < maxNestingDepth; level += 1) {
        deep = level % 2 === 0 ? { a: deep } : [deep];
    }
    using store = new SQLiteTraceStore();
    appendRecord(store, "worker", "example.deep.v1", { a: deep });
    const [record] = store.readOwner("worker");
    assert.ok(record !== undefined);
    const classification = classifyTraceSchema(record.envelope.schema_ref);
    assert.equal(classification.disposition, "include");
    const shallow = buildTelemetryBatch(
        [],
        [mapRecord(record, classification, POLICY_MODE, "1").logRecord],
    );
    const deepCaller = atStackDepth(6_000, () =>
        buildTelemetryBatch([], [mapRecord(record, classification, POLICY_MODE, "1").logRecord]),
    );
    const shallowLogs = serializeJsonText(shallow.logs);
    assert.equal(serializeJsonText(deepCaller), serializeJsonText(shallow));
    assert.equal(Object.isFrozen(logsOf(deepCaller)[0]?.body), true);

    const directory = await temporaryDirectory(context, "deep-jsonl");
    const logsPath = path.join(directory, "logs.jsonl");
    const tracesPath = path.join(directory, "traces.jsonl");
    const sink = createJsonLinesTelemetrySink({ logsPath, tracesPath });
    // The logs line is serialized before the first await, so it runs on the deep caller's stack.
    await atStackDepth(6_000, () => sink.write(shallow));
    const exporter = createTraceTelemetryExporter({
        bodies: POLICY_MODE,
        clock: steppingClock(),
        sink,
        store,
        subscription: { owners: ["worker"] },
    });
    await exporter.exportPending();
    exporter.close();
    const [written, exportedLine, ...rest] = readFileSync(logsPath, "utf8").split("\n");
    assert.deepEqual(rest, [""]);
    assert.equal(written, shallowLogs);
    const exported = JSON.parse(exportedLine as string) as TelemetryBatch["logs"];
    const exportedRecord = exported.resourceLogs[0]?.scopeLogs[0]?.logRecords[0];
    assert.deepEqual(attributeOf(exportedRecord?.attributes ?? [], "body_handling"), {
        stringValue: INCLUDED,
    });
    assert.equal(
        serializeJsonText(exportedRecord?.body),
        serializeJsonText(logsOf(shallow)[0]?.body),
    );
    assert.equal(serializeJsonText(exported), exportedLine);
});
