import { open } from "node:fs/promises";

import { retentionProtocolConfig } from "../protocol/config.ts";
import type { TelemetryBatch, TelemetrySink } from "./otlp-types.ts";

/**
 * Destination files of {@link createJsonLinesTelemetrySink}. The OTLP file format holds exactly
 * one signal type per file, so traces and logs are written to separate files.
 *
 * @public
 */
export type JsonLinesTelemetrySinkOptions = {
    /** File that receives one OTLP/JSON `ExportLogsServiceRequest` per line. */
    readonly logsPath: string;
    /** File that receives one OTLP/JSON `ExportTraceServiceRequest` per line. */
    readonly tracesPath: string;
};

const PERMISSION_BITS = 0o777;

/**
 * Creates a sink that appends OTLP/JSON lines ingestible by an OpenTelemetry Collector file
 * receiver (`otlpjsonfile`).
 *
 * Each write appends at most one `\n`-terminated line to each file: the batch's traces request
 * when it holds a span, and its logs request when it holds a log record. Files are created with
 * the configured owner-only store-file mode, and an existing file with group or other permission
 * bits is tightened before anything is appended. Each file is flushed to stable storage before
 * the write resolves, so an acknowledged cursor never passes telemetry that was not persisted. A
 * batch retried after a failure may repeat lines already written; consumers must tolerate
 * at-least-once delivery.
 *
 * @param options - Distinct traces and logs file paths.
 * @returns A frozen sink.
 * @throws {TypeError} If a path is empty or both paths are equal.
 *
 * @example
 * ```ts
 * const sink = createJsonLinesTelemetrySink({
 *     logsPath: "telemetry/logs.jsonl",
 *     tracesPath: "telemetry/traces.jsonl",
 * });
 * ```
 *
 * @public
 */
export function createJsonLinesTelemetrySink(
    options: JsonLinesTelemetrySinkOptions,
): TelemetrySink {
    const { logsPath, tracesPath } = options;
    if (
        typeof logsPath !== "string" ||
        typeof tracesPath !== "string" ||
        logsPath.length === 0 ||
        tracesPath.length === 0 ||
        logsPath === tracesPath
    ) {
        throw new TypeError("logsPath and tracesPath must be distinct non-empty paths");
    }
    return Object.freeze({
        write: async (batch: TelemetryBatch) => {
            if (batch.traces.resourceSpans.length > 0) {
                await appendLine(tracesPath, JSON.stringify(batch.traces));
            }
            if (batch.logs.resourceLogs.length > 0) {
                await appendLine(logsPath, JSON.stringify(batch.logs));
            }
        },
    });
}

async function appendLine(filePath: string, line: string): Promise<void> {
    const mode = retentionProtocolConfig.storeFiles.mode;
    const handle = await open(filePath, "a", mode);
    try {
        const stats = await handle.stat();
        if ((stats.mode & PERMISSION_BITS & ~mode) !== 0) {
            await handle.chmod(mode);
        }
        await handle.appendFile(`${line}\n`, "utf8");
        await handle.sync();
    } finally {
        await handle.close();
    }
}
