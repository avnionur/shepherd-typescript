import assert from "node:assert/strict";
import { chmodSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
    createJsonLinesTelemetrySink,
    createTraceTelemetryExporter,
    SQLiteTraceStore,
} from "../../src/index.ts";
import { appendRecord, runDurableGreeting, steppingClock, temporaryDirectory } from "./fixtures.ts";

const readLines = (file: string): readonly Record<string, unknown>[] =>
    readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as Record<string, unknown>);

test("the JSON-lines sink appends one owner-only OTLP request per signal and batch", async (context) => {
    const directory = await temporaryDirectory(context, "jsonl");
    const tracesPath = path.join(directory, "traces.jsonl");
    const logsPath = path.join(directory, "logs.jsonl");
    writeFileSync(logsPath, "");
    chmodSync(logsPath, 0o644);
    using store = new SQLiteTraceStore();
    appendRecord(store, "worker", "example.step.v1", { step: 1 });
    const sink = createJsonLinesTelemetrySink({ logsPath, tracesPath });
    assert.equal(Object.isFrozen(sink), true);
    const exporter = createTraceTelemetryExporter({
        clock: steppingClock(),
        sink,
        store,
        subscription: { owners: ["worker", "run:jsonl"] },
    });
    await exporter.exportPending();
    assert.equal(statSync(tracesPath, { throwIfNoEntry: false }), undefined);
    assert.equal(statSync(logsPath).mode & 0o777, 0o600);
    await runDurableGreeting(store, "run:jsonl");
    await exporter.exportPending();
    exporter.close();
    assert.equal(statSync(tracesPath).mode & 0o777, 0o600);
    const traces = readLines(tracesPath);
    const logs = readLines(logsPath);
    assert.equal(traces.length, 1);
    assert.equal(logs.length, 2);
    assert.deepEqual(Object.keys(traces[0] as object), ["resourceSpans"]);
    assert.deepEqual(
        logs.map((line) => Object.keys(line)),
        [["resourceLogs"], ["resourceLogs"]],
    );
    await sink.write({
        format: "shepherd.telemetry.batch",
        format_version: 1,
        logs: { resourceLogs: [] },
        traces: { resourceSpans: [] },
    });
    assert.equal(readLines(logsPath).length, 2);
    assert.equal(readLines(tracesPath).length, 1);
});

test("the JSON-lines sink requires distinct non-empty paths", () => {
    for (const options of [
        { logsPath: "", tracesPath: "traces.jsonl" },
        { logsPath: "logs.jsonl", tracesPath: "" },
        { logsPath: "same.jsonl", tracesPath: "same.jsonl" },
        { logsPath: 1, tracesPath: "traces.jsonl" },
        { logsPath: "logs.jsonl", tracesPath: null },
    ]) {
        assert.throws(
            () => createJsonLinesTelemetrySink(options as never),
            /distinct non-empty paths/u,
        );
    }
});
