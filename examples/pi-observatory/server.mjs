import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { executeTaskDurably, readDurableTaskExecution } from "@avnionur/shepherd-typescript/runs";
import { schema, task } from "@avnionur/shepherd-typescript/tasks";
import {
    listRunLedger,
    ROOT_WITNESS_ID,
    SQLiteTraceStore,
} from "@avnionur/shepherd-typescript/trace";
import { readConfiguration } from "./config.mjs";
import { checkPi, invokePi, readPiModels } from "./pi.mjs";

const [configurationPath, ...extra] = process.argv.slice(2);
if (!configurationPath || extra.length)
    throw new TypeError("Usage: node server.mjs <configuration.json>");
const config = readConfiguration(configurationPath);
if (config.mode === "pi") await checkPi(config);
const availableModels = config.mode === "pi" ? await readPiModels(config) : [config.offline.model];
const configuredModels = availableModels.filter(
    (model) =>
        model.id === config.provider.model ||
        `${model.provider}/${model.id}` === config.provider.model,
);
if (config.provider.model !== null && configuredModels.length !== 1) {
    throw new Error("Configured provider.model is unavailable or ambiguous in the Pi catalog");
}
const defaultModel = config.provider.model === null ? availableModels[0] : configuredModels[0];
const store = new SQLiteTraceStore(config.database);
const chatTask = task({
    ...config.task,
    input: schema.object({
        model: schema.object({ provider: schema.string(), id: schema.string() }),
        messages: schema.array(
            schema.object({ role: schema.enum(["user", "assistant"]), text: schema.string() }),
        ),
    }),
    output: schema.string(),
});
const publicDirectory = fileURLToPath(new URL("./public/", import.meta.url));
const runs = listRunLedger(store, { limit: config.limits.maxRuns })
    .filter((run) => run.run_id.startsWith(config.runPrefix))
    .map((run) => run.run_id)
    .sort();
let active = null;
let closing = false;
let fatal = false;
let serverOrigin;

function snapshot() {
    const nodes = [];
    const messages = [];
    const summaries = [];
    for (const runId of runs) {
        const recovery = readDurableTaskExecution(store, runId);
        const records = store.readOwner(runId);
        const observations = store.readOwner(runId + config.eventOwnerSuffix);
        // The durable creation payload is canonical and contains the exact task input envelope.
        const input = records[0]?.body.payload?.inputs?.value;
        const latest = input?.messages?.at(-1);
        if (latest) messages.push({ role: "user", text: latest.text, runId });
        const outcome =
            recovery.status === "committed" ? recovery.result.execution.outcome.outcome : null;
        if (outcome?.status === "finished")
            messages.push({ role: "assistant", text: outcome.value, runId });
        else if (outcome) messages.push({ role: "status", text: outcome.status, runId });
        else if (active?.runId !== runId)
            messages.push({
                role: "status",
                text: `Interrupted: ${recovery.status}. Inspect evidence; no automatic retry.`,
                runId,
            });
        summaries.push({
            runId,
            provider: records[0]?.body.payload?.provider ?? null,
            origin: observations[0]?.body.origin ?? null,
            budget: records[0]?.body.payload?.budget ?? null,
            taskRef: records[0]?.body.payload?.task_ref ?? null,
            control: recovery.status === "committed" ? recovery.result.execution.control : null,
            status: outcome?.status ?? recovery.status,
            usage: recovery.status === "committed" ? recovery.result.execution.usage : null,
            cut: recovery.status === "committed" ? recovery.result.ledger.cut : null,
        });
        for (const record of [...records, ...observations]) {
            nodes.push({
                id: record.envelope.record_id,
                owner: record.view.owner_id,
                ordinal: record.view.owner_ordinal,
                schema: record.envelope.schema_ref,
                mode: record.envelope.mode,
                parents: record.envelope.caused_by_record_ids,
                witness: record.envelope.witness_ref,
                body: record.body,
                source:
                    record.envelope.schema_ref === config.eventSchema
                        ? "rpc-observation"
                        : "shepherd",
                runId,
            });
        }
    }
    const known = new Set(nodes.map((node) => node.id));
    return {
        title: config.title,
        display: config.display,
        settings: {
            models: availableModels,
            defaultModel: { provider: defaultModel.provider, id: defaultModel.id },
        },
        mode: config.mode,
        pollMilliseconds: config.limits.pollMilliseconds,
        maxMessageBytes: config.limits.maxMessageBytes,
        playground: config.playground.map(({ id, title, description, behavior }) => ({
            id,
            title,
            description,
            enabled: config.mode === "offline" || behavior === "reply",
        })),
        messages,
        runs: summaries,
        nodes,
        edges: nodes.flatMap((node) =>
            node.parents.map((parent) => ({
                source: parent,
                target: node.id,
                external: !known.has(parent),
            })),
        ),
        active: active ? { runId: active.runId, partial: active.partial } : null,
        fatal,
        capacityReached: runs.length >= config.limits.maxRuns,
    };
}

async function startTurn(text, item, model) {
    const runId = `${config.runPrefix + Date.now().toString().padStart(16, "0")}:${randomUUID()}`;
    const previous = snapshot()
        .messages.filter((message) => message.role !== "status")
        .map(({ role, text: content }) => ({ role, text: content }));
    const messages = [...previous, { role: "user", text }].slice(-config.limits.maxHistoryMessages);
    const controller = new AbortController();
    const current = { runId, controller, partial: "", promise: null };
    active = current;
    runs.push(runId);
    const observe = (eventType, sequence) => {
        const start = store.readOwner(runId).at(-1);
        store.append({
            append_intent_id: `${runId}:rpc:${sequence}`,
            batch: {
                groups: [
                    {
                        owner_id: runId + config.eventOwnerSuffix,
                        records: [
                            {
                                mode: "capture",
                                schema_ref: config.eventSchema,
                                witness_ref: ROOT_WITNESS_ID,
                                caused_by_record_ids: [start.envelope.record_id],
                                body: { event_type: eventType, sequence, origin: config.mode },
                            },
                        ],
                    },
                ],
            },
        });
    };
    current.promise = executeTaskDurably(store, {
        task: chatTask,
        input: { messages, model: { provider: model.provider, id: model.id } },
        runId,
        budget: config.budget,
        signal: controller.signal,
        provider: {
            descriptor: () => ({
                ...config.provider,
                model: `${model.provider}/${model.id}`,
                capabilities: { streaming: false, structuredOutput: true, tools: false },
            }),
            invoke: async (_request, signal) => {
                if (config.mode === "offline") {
                    observe("fixture_started", 1);
                    await delay(
                        item?.delayMilliseconds ?? config.offline.delayMilliseconds,
                        undefined,
                        { signal },
                    );
                    if (item?.behavior === "fail")
                        throw new Error("Configured offline playground failure");
                    observe("fixture_settled", 2);
                    return { output: config.offline.prefix + text, usage: config.offline.usage };
                }
                return invokePi(config, messages, model, signal, observe, (piece) => {
                    current.partial += piece;
                    if (Buffer.byteLength(current.partial) > config.limits.maxReplyBytes)
                        throw new Error("Partial reply exceeded its bound");
                });
            },
        },
    })
        .catch(() => {
            fatal = true;
        })
        .finally(() => {
            active = null;
        });
    return runId;
}

function json(response, status, value) {
    response.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
    });
    response.end(JSON.stringify(value));
}

const server = createServer(async (request, response) => {
    try {
        // Host and origin admission protect the loopback example from rebinding and cross-site writes.
        if (
            request.headers.host !== new URL(serverOrigin).host ||
            (request.headers.origin && request.headers.origin !== serverOrigin)
        ) {
            json(response, 403, { error: "Host or origin refused" });
            return;
        }
        const url = new URL(request.url, serverOrigin);
        if (request.method === "GET" && url.pathname === "/api/state") {
            json(response, 200, snapshot());
            return;
        }
        if (request.method === "GET" && url.pathname === "/api/export") {
            response.writeHead(200, {
                "Content-Type": "application/json",
                "Content-Disposition": 'attachment; filename="trace.json"',
                "Cache-Control": "no-store",
            });
            response.end(store.exportTrace());
            return;
        }
        if (request.method === "POST") {
            if (closing || fatal) {
                json(response, 503, { error: "Server requires restart and evidence inspection" });
                return;
            }
            if (request.headers["content-type"] !== "application/json") {
                json(response, 415, { error: "application/json required" });
                return;
            }
            const chunks = [];
            let bytes = 0;
            for await (const chunk of request) {
                bytes += chunk.length;
                if (bytes > config.limits.maxRequestBytes) {
                    json(response, 413, { error: "Request too large" });
                    return;
                }
                chunks.push(chunk);
            }
            if (closing || fatal) {
                json(response, 503, { error: "Server requires restart and evidence inspection" });
                return;
            }
            let body;
            try {
                body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            } catch {
                json(response, 400, { error: "Invalid JSON" });
                return;
            }
            if (url.pathname === "/api/cancel") {
                if (
                    !body ||
                    Object.keys(body).length !== 1 ||
                    typeof body.runId !== "string" ||
                    body.runId !== active?.runId
                ) {
                    json(response, 409, { error: "Active run identity required" });
                    return;
                }
                active.controller.abort();
                json(response, 202, { status: "cancelling" });
                return;
            }
            if (url.pathname === "/api/chat") {
                if (
                    !body ||
                    typeof body !== "object" ||
                    Array.isArray(body) ||
                    Object.keys(body).some((key) => !["text", "itemId", "model"].includes(key)) ||
                    Object.hasOwn(body, "text") === Object.hasOwn(body, "itemId")
                ) {
                    json(response, 400, { error: "Choose exactly one text or playground item" });
                    return;
                }
                const requested = body.model;
                if (
                    requested !== undefined &&
                    (!requested ||
                        typeof requested !== "object" ||
                        Array.isArray(requested) ||
                        Object.keys(requested).length !== 2 ||
                        typeof requested.provider !== "string" ||
                        typeof requested.id !== "string")
                ) {
                    json(response, 400, { error: "Exact catalog model required" });
                    return;
                }
                const model =
                    requested === undefined
                        ? defaultModel
                        : availableModels.find(
                              (candidate) =>
                                  candidate.provider === requested.provider &&
                                  candidate.id === requested.id,
                          );
                if (!model) {
                    json(response, 400, { error: "Selected provider/model unavailable" });
                    return;
                }
                if (typeof body.itemId === "string") {
                    const item = config.playground.find(
                        (candidate) => candidate.id === body.itemId,
                    );
                    if (!item || (config.mode === "pi" && item.behavior !== "reply")) {
                        json(response, 400, { error: "Playground item unavailable in this mode" });
                        return;
                    }
                    if (active || runs.length >= config.limits.maxRuns) {
                        json(response, 409, { error: "Run active or store capacity reached" });
                        return;
                    }
                    const runId = await startTurn(item.text, item, model);
                    json(response, 202, { runId });
                    return;
                }
                if (
                    typeof body.text !== "string" ||
                    !body.text.trim() ||
                    !body.text.isWellFormed() ||
                    Buffer.byteLength(body.text) > config.limits.maxMessageBytes
                ) {
                    json(response, 400, { error: "A bounded, nonempty text message is required" });
                    return;
                }
                if (active || runs.length >= config.limits.maxRuns) {
                    json(response, 409, {
                        error: "Run active or store capacity reached; use a new database",
                    });
                    return;
                }
                const runId = await startTurn(body.text, undefined, model);
                json(response, 202, { runId });
                return;
            }
        }
        const assets = {
            "/": ["index.html", "text/html"],
            "/app.js": ["app.js", "text/javascript"],
            "/graph.mjs": ["graph.mjs", "text/javascript"],
            "/style.css": ["style.css", "text/css"],
        };
        if (request.method === "GET" && assets[url.pathname]) {
            const [filename, contentType] = assets[url.pathname];
            response.writeHead(200, {
                "Content-Type": contentType,
                "X-Content-Type-Options": "nosniff",
                "Content-Security-Policy":
                    "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
            });
            response.end(readFileSync(path.join(publicDirectory, filename)));
            return;
        }
        json(response, 404, { error: "Not found" });
    } catch {
        if (!response.headersSent)
            json(response, 500, { error: "Request failed; inspect local evidence" });
        else response.end();
    }
});
server.requestTimeout = config.limits.timeoutMilliseconds;
server.listen(config.port, config.host, () => {
    serverOrigin = `http://${config.host}:${server.address().port}`;
    process.stdout.write(`${JSON.stringify({ url: serverOrigin, mode: config.mode })}\n`);
});
server.on("error", () => {
    store.close();
    process.exitCode = 1;
});
async function shutdown() {
    if (closing) return;
    closing = true;
    const closed = new Promise((resolve) => server.close(resolve));
    // Stop admitted body readers before closing persistence; only the owned provider may finish.
    server.closeAllConnections();
    if (active) {
        active.controller.abort();
        await active.promise;
    }
    await closed;
    store.close();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
