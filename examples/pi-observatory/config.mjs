import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { schema } from "@avnionur/shepherd-typescript/tasks";

/** Read a closed configuration; paths resolve against the configuration file, never the browser. */
export function readConfiguration(filename) {
    const text = schema.string();
    const integer = schema.integer();
    const input = JSON.parse(readFileSync(filename, "utf8"));
    const defaults = JSON.parse(readFileSync(new URL("./config.json", import.meta.url), "utf8"));
    const value = schema
        .object({
            connection: schema.object({
                command: text,
                helperScript: text,
                cliScript: text,
                expectedVersion: text,
                agentDirectory: text,
                agentDirectoryEnvironment: text,
                selectionFile: text,
                maxKeyBytes: integer,
                maxOutputBytes: integer,
                localProviders: schema.array(
                    schema.object({
                        id: text,
                        name: text,
                        discoveryUrl: text,
                        showUrl: text,
                        baseUrl: text,
                        api: text,
                        placeholderKey: text,
                        cloudLabel: text,
                        compat: schema.object({ maxTokensField: text }),
                        modelDefaults: schema.object({
                            reasoning: schema.boolean(),
                            input: schema.array(text),
                            cost: schema.object({
                                input: schema.number(),
                                output: schema.number(),
                                cacheRead: schema.number(),
                                cacheWrite: schema.number(),
                            }),
                            contextWindow: integer,
                            maxTokens: integer,
                        }),
                    }),
                ),
            }),
            traceSelectionFile: text,
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
                panStepPixels: integer,
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
        .parse({
            ...input,
            traceSelectionFile: input.traceSelectionFile ?? defaults.traceSelectionFile,
            display: {
                ...input.display,
                panStepPixels: input.display?.panStepPixels ?? defaults.display.panStepPixels,
            },
            connection: { ...defaults.connection, ...input.connection },
        });
    if (value.host !== "127.0.0.1" || value.port < 0 || value.port > 65535) {
        throw new TypeError("This example requires IPv4 loopback and a valid port");
    }
    if (
        Object.values(value.limits).some((limit) => limit <= 0) ||
        value.limits.maxRuns > 100 ||
        [
            value.display.panStepPixels,
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
    if (
        value.connection.maxKeyBytes <= 0 ||
        value.connection.maxOutputBytes <= 0 ||
        path.basename(value.connection.selectionFile) !== value.connection.selectionFile ||
        path.basename(value.traceSelectionFile) !== value.traceSelectionFile
    )
        throw new TypeError("Invalid connection configuration");
    const exampleDirectory = fileURLToPath(new URL("./", import.meta.url));
    const directory = path.dirname(path.resolve(filename));
    return {
        ...value,
        database: path.resolve(directory, value.database),
        connection: {
            ...value.connection,
            args: [path.resolve(exampleDirectory, value.connection.helperScript)],
            cwd: exampleDirectory,
            rpcCommand: value.connection.command,
            rpcArgs: [path.resolve(exampleDirectory, value.connection.cliScript)],
            agentDirectory: path.resolve(directory, value.connection.agentDirectory),
        },
        pi: { ...value.pi, cwd: path.resolve(directory, value.pi.cwd) },
    };
}
