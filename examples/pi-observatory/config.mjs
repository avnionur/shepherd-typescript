import { readFileSync } from "node:fs";
import path from "node:path";
import { schema } from "@avnionur/shepherd-typescript/tasks";

/** Read a closed configuration; paths resolve against the configuration file, never the browser. */
export function readConfiguration(filename) {
    const text = schema.string();
    const integer = schema.integer();
    const value = schema
        .object({
            title: text,
            mode: schema.enum(["offline", "pi"]),
            host: text,
            port: integer,
            database: text,
            runPrefix: text,
            eventOwnerSuffix: text,
            eventSchema: text,
            task: schema.object({ name: text, version: text, instruction: text }),
            provider: schema.object({
                id: text,
                kind: schema.enum(["program"]),
                model: schema.union([text, schema.null()]),
            }),
            offline: schema.object({
                prefix: text,
                model: schema.object({ provider: text, id: text, name: text }),
                delayMilliseconds: integer,
                usage: schema.object({
                    inputTokens: integer,
                    outputTokens: integer,
                    cacheCreationInputTokens: integer,
                    cacheReadInputTokens: integer,
                    costUsd: schema.number(),
                }),
            }),
            pi: schema.object({
                command: text,
                args: schema.array(text),
                cwd: text,
                expectedVersion: text,
                versionArgs: schema.array(text),
            }),
            limits: schema.object({
                maxRuns: integer,
                startupMilliseconds: integer,
                maxModels: integer,
                maxMessageBytes: integer,
                maxRequestBytes: integer,
                maxHistoryMessages: integer,
                maxRpcLineBytes: integer,
                maxRpcEvents: integer,
                maxReplyBytes: integer,
                timeoutMilliseconds: integer,
                shutdownMilliseconds: integer,
                pollMilliseconds: integer,
            }),
            display: schema.object({
                schemaLabelPrefix: text,
                settingsStorageKey: text,
                overviewText: text,
                statusDescriptions: schema.object({
                    finished: text,
                    failed: text,
                    cancelled: text,
                    exhausted: text,
                    created: text,
                    started: text,
                    committed: text,
                    absent: text,
                    terminal_pending_cut: text,
                }),
                recordDescriptions: schema.array(
                    schema.object({ schema: text, title: text, description: text }),
                ),
                highlightMilliseconds: integer,
                edgeAnimationMilliseconds: integer,
                playbackStepMilliseconds: integer,
            }),
            playground: schema.array(
                schema.object({
                    id: text,
                    title: text,
                    description: text,
                    text,
                    behavior: schema.enum(["reply", "fail"]),
                    delayMilliseconds: integer,
                }),
            ),
            budget: schema.object({ maxTurns: integer, maxDurationMilliseconds: integer }),
        })
        .parse(JSON.parse(readFileSync(filename, "utf8")));
    if (value.host !== "127.0.0.1" || value.port < 0 || value.port > 65535) {
        throw new TypeError("This example requires IPv4 loopback and a valid port");
    }
    if (
        Object.values(value.limits).some((limit) => limit <= 0) ||
        value.limits.maxRuns > 100 ||
        [
            value.display.highlightMilliseconds,
            value.display.edgeAnimationMilliseconds,
            value.display.playbackStepMilliseconds,
        ].some((duration) => duration <= 0) ||
        value.limits.maxHistoryMessages < 2 ||
        value.offline.delayMilliseconds < 0 ||
        Object.values(value.offline.usage).some((count) => count < 0) ||
        value.budget.maxTurns !== 1 ||
        value.budget.maxDurationMilliseconds <= 0 ||
        [
            value.runPrefix,
            value.eventOwnerSuffix,
            value.eventSchema,
            value.pi.command,
            value.pi.expectedVersion,
            value.title,
        ].some((item) => !item.trim())
    ) {
        throw new TypeError("Invalid example identity, bounds or budget");
    }
    if (
        new Set(value.playground.map((item) => item.id)).size !== value.playground.length ||
        value.playground.some(
            (item) =>
                !item.id.trim() ||
                !item.text.trim() ||
                Buffer.byteLength(item.text) > value.limits.maxMessageBytes ||
                item.delayMilliseconds < 0 ||
                item.delayMilliseconds >= value.budget.maxDurationMilliseconds,
        )
    ) {
        throw new TypeError("Playground items require distinct IDs, bounded text and delay");
    }
    const directory = path.dirname(path.resolve(filename));
    return {
        ...value,
        database: path.resolve(directory, value.database),
        pi: { ...value.pi, cwd: path.resolve(directory, value.pi.cwd) },
    };
}
