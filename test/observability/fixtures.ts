import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { TestContext } from "node:test";

import { Ajv2020, type AnySchemaObject, type ValidateFunction } from "ajv/dist/2020.js";

import {
    createStaticProvider,
    executeTaskDurably,
    type ModelRequest,
    ROOT_WITNESS_ID,
    type SQLiteTraceStore,
    schema,
    type TelemetryBatch,
    type TelemetrySink,
    task,
} from "../../src/index.ts";

/** Creates one temporary directory removed after the test. */
export async function temporaryDirectory(context: TestContext, label: string): Promise<string> {
    const directory = await mkdtemp(path.join(tmpdir(), `shepherd-telemetry-${label}-`));
    context.after(() => rm(directory, { force: true, recursive: true }));
    return directory;
}

/** Compiles the generated telemetry-batch schema. */
export function telemetryBatchValidator(): ValidateFunction {
    return new Ajv2020({ strict: true }).compile(
        JSON.parse(
            readFileSync(
                new URL("../../spec/schemas/telemetry-batch-v1.schema.json", import.meta.url),
                "utf8",
            ),
        ) as AnySchemaObject,
    );
}

/** Appends one record with an explicit schema and body; returns its identity. */
export function appendRecord(
    store: SQLiteTraceStore,
    ownerId: string,
    schemaRef: string,
    body: Record<string, unknown>,
): string {
    const receipt = store.append({
        append_intent_id: `intent:${ownerId}:${schemaRef}:${JSON.stringify(body)}`,
        batch: {
            groups: [
                {
                    owner_id: ownerId,
                    records: [
                        {
                            body: body as never,
                            mode: "capture",
                            schema_ref: schemaRef,
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    });
    return receipt.record_ids[0] as string;
}

/** Runs one offline durable task to its terminal record. */
export async function runDurableGreeting(store: SQLiteTraceStore, runId: string): Promise<void> {
    const greet = task({
        input: schema.object({ name: schema.string() }),
        instruction: "Greet the supplied person.",
        name: "telemetry-greet",
        output: schema.object({ greeting: schema.string() }),
        version: "1.0.0",
    });
    const request = {
        input: { name: "Ada" },
        instruction: greet.instruction,
        outputSchema: greet.artifact.output_schema,
    } satisfies ModelRequest;
    await executeTaskDurably(store, {
        budget: { maxTurns: 1 },
        input: { name: "Ada" },
        provider: createStaticProvider({
            descriptor: { id: "telemetry-fixture", model: "offline-v1" },
            exchanges: [
                {
                    request,
                    response: {
                        output: { greeting: "Hello, Ada" },
                        usage: {
                            cacheCreationInputTokens: 0,
                            cacheReadInputTokens: 0,
                            costUsd: 0,
                            inputTokens: 1,
                            outputTokens: 1,
                        },
                    },
                },
            ],
        }),
        runId,
        task: greet,
    });
}

/** Sink that records batches and fails while `failures` is positive. */
export function recordingSink(): TelemetrySink & {
    readonly batches: TelemetryBatch[];
    failures: number;
} {
    const sink = {
        batches: [] as TelemetryBatch[],
        failures: 0,
        write: async (batch: TelemetryBatch) => {
            if (sink.failures > 0) {
                sink.failures -= 1;
                throw new Error("sink unavailable");
            }
            sink.batches.push(batch);
        },
    };
    return sink;
}

/** Deterministic clock advancing one millisecond per observation. */
export function steppingClock(start = 1_700_000_000_000_000_000n): () => bigint {
    let now = start;
    return () => {
        now += 1_000_000n;
        return now;
    };
}
