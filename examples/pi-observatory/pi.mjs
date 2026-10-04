import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

/** Check the configured executable version without installing or authenticating it. */
export async function checkPi(config) {
    await new Promise((resolve, reject) => {
        const child = spawn(config.pi.command, config.pi.versionArgs, {
            cwd: config.pi.cwd,
            shell: false,
            stdio: ["ignore", "pipe", "ignore"],
        });
        let output = "";
        let failure;
        const timer = setTimeout(() => {
            failure = new Error("Pi version check timed out");
            child.kill("SIGKILL");
        }, config.limits.startupMilliseconds);
        child.on("error", () => {
            failure = new Error("Configured Pi executable is unavailable");
        });
        child.stdout.on("data", (chunk) => {
            output += chunk.toString();
            if (Buffer.byteLength(output) > config.limits.maxRpcLineBytes) {
                failure = new Error("Pi version response exceeded its bound");
                child.kill("SIGKILL");
            }
        });
        child.on("close", (code) => {
            clearTimeout(timer);
            if (failure) reject(failure);
            else if (code !== 0 || output.trim() !== config.pi.expectedVersion)
                reject(new Error("Configured Pi version does not match expectedVersion"));
            else resolve();
        });
    });
}

// Shared transport keeps catalog queries and model invocations on the same framing/cleanup seam.
function runRpc(config, signal, timeoutMilliseconds, initial, handle) {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
        const child = spawn(config.pi.command, config.pi.args, {
            cwd: config.pi.cwd,
            shell: false,
            stdio: ["pipe", "pipe", "ignore"],
        });
        const decoder = new StringDecoder("utf8");
        let buffer = "";
        let count = 0;
        let failure;
        let result;
        let settled = false;
        let stopping = false;
        let killTimer;
        const send = (value) => {
            if (!child.stdin.destroyed && !child.stdin.writableEnded)
                child.stdin.write(`${JSON.stringify(value)}\n`);
        };
        const stop = () => {
            if (stopping) return;
            stopping = true;
            child.stdin.end();
            killTimer = setTimeout(() => child.kill("SIGKILL"), config.limits.shutdownMilliseconds);
        };
        const fail = (error) => {
            failure ??= error;
            stop();
        };
        const finish = (value) => {
            result = value;
            settled = true;
            stop();
        };
        const cancel = () => {
            send({ id: "clear", type: "clear_queue" });
            send({ id: "abort", type: "abort" });
            fail(new Error("RPC invocation cancelled; process closed before returning"));
        };
        const timer = setTimeout(
            () => fail(new Error("RPC invocation timed out")),
            timeoutMilliseconds,
        );
        signal.addEventListener("abort", cancel, { once: true });
        child.on("error", () => fail(new Error("RPC executable failed to start")));
        child.stdin.on("error", () => fail(new Error("RPC input channel failed")));
        child.stdout.on("data", (chunk) => {
            if (stopping) return;
            try {
                buffer += decoder.write(chunk);
                while (buffer.includes("\n")) {
                    const newline = buffer.indexOf("\n");
                    const line = buffer.slice(0, newline);
                    buffer = buffer.slice(newline + 1);
                    if (Buffer.byteLength(line) > config.limits.maxRpcLineBytes)
                        throw new Error("RPC line exceeded its bound");
                    if (!line.trim()) continue;
                    const event = JSON.parse(line);
                    if (
                        !event ||
                        typeof event !== "object" ||
                        Array.isArray(event) ||
                        typeof event.type !== "string"
                    )
                        throw new Error("Malformed RPC event");
                    if (++count > config.limits.maxRpcEvents)
                        throw new Error("RPC event limit exceeded");
                    if (event.type === "extension_ui_request")
                        send({ type: "extension_ui_response", id: event.id, cancelled: true });
                    handle(event, count, send, finish);
                    if (stopping) break;
                }
                if (Buffer.byteLength(buffer) > config.limits.maxRpcLineBytes)
                    throw new Error("RPC line exceeded its bound");
            } catch {
                fail(new Error("Pi RPC rejected invalid, failed or out-of-bounds output"));
            }
        });
        child.on("close", (code, terminationSignal) => {
            clearTimeout(timer);
            clearTimeout(killTimer);
            signal.removeEventListener("abort", cancel);
            if (failure) reject(failure);
            else if (!settled || code !== 0 || terminationSignal || buffer.trim())
                reject(
                    new Error(
                        "Pi exited without a clean settled response; invocation is not retried",
                    ),
                );
            else resolve(result);
        });
        send(initial);
        if (signal.aborted) cancel();
    });
}

/** Read configured available Pi models without returning headers, credentials or endpoints.
 * Availability is a cached authentication/catalog snapshot, not a live entitlement check.
 * @param {object} config Validated server configuration.
 * @returns {Promise<Array<object>>} Whitelisted provider/id/name choices.
 * @throws {Error} If the catalog query fails, exceeds bounds or contains invalid model identity.
 */
export async function readPiModels(config) {
    return runRpc(
        config,
        new AbortController().signal,
        config.limits.startupMilliseconds,
        { id: "catalog", type: "get_available_models" },
        (event, _sequence, _send, finish) => {
            if (event.type !== "response" || event.id !== "catalog") return;
            if (
                event.success !== true ||
                !Array.isArray(event.data?.models) ||
                !event.data.models.length ||
                event.data.models.length > config.limits.maxModels
            )
                throw new Error("Available model catalog refused");
            const identities = new Set();
            const models = event.data.models.map((model) => {
                if (
                    !model ||
                    [model.provider, model.id, model.name].some(
                        (value) =>
                            typeof value !== "string" || !value.trim() || !value.isWellFormed(),
                    )
                )
                    throw new Error("Invalid model identity");
                const identity = JSON.stringify([model.provider, model.id]);
                if (identities.has(identity)) throw new Error("Duplicate model identity");
                identities.add(identity);
                return { provider: model.provider, id: model.id, name: model.name };
            });
            finish(models);
        },
    );
}

/** Invoke a fresh Pi session, selecting an exact catalog model before submitting one prompt.
 * @param {object} config Validated server configuration.
 * @param {Array<object>} messages Bounded conversation transcript.
 * @param {object} model Exact server-side catalog selection.
 * @param {AbortSignal} signal Cancellation composed by Shepherd execution.
 * @param {Function} observe Retain event type/sequence observations.
 * @param {Function} delta Update non-semantic streaming preview.
 * @returns {Promise<object>} Authoritative text and measured usage after actual child closure.
 * @throws {Error} On selection, framing, provider, bound, timeout or process cleanup failure.
 */
export async function invokePi(config, messages, model, signal, observe, delta) {
    let output = "";
    let accepted = false;
    let selected = false;
    let observedUsage = false;
    let costAvailable = true;
    let lastStopReason;
    const usage = {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        costUsd: 0,
    };
    return runRpc(
        config,
        signal,
        config.limits.timeoutMilliseconds,
        { id: "selection", type: "set_model", provider: model.provider, modelId: model.id },
        (event, sequence, send, finish) => {
            observe(event.type, sequence);
            if (event.type === "response" && event.id === "selection") {
                if (
                    selected ||
                    event.success !== true ||
                    event.data?.provider !== model.provider ||
                    event.data?.id !== model.id
                )
                    throw new Error("Exact model selection refused");
                selected = true;
                send({
                    id: "prompt",
                    type: "prompt",
                    message: JSON.stringify({ instruction: config.task.instruction, messages }),
                });
            }
            if (event.type === "response" && event.id === "prompt") {
                if (!selected || event.success !== true) throw new Error("Pi refused the prompt");
                accepted = true;
            }
            if (
                event.type === "message_update" &&
                event.assistantMessageEvent?.type === "text_delta"
            ) {
                const text = event.assistantMessageEvent.delta;
                if (typeof text !== "string") throw new Error("Malformed text delta");
                delta(text);
            }
            if (event.type === "message_end" && event.message?.role === "assistant") {
                const message = event.message;
                lastStopReason = message.stopReason;
                if (!Array.isArray(message.content))
                    throw new Error("Assistant content unavailable");
                const text = message.content
                    .filter((block) => block.type === "text")
                    .map((block) => {
                        if (typeof block.text !== "string")
                            throw new Error("Malformed assistant text");
                        return block.text;
                    })
                    .join("");
                if (message.stopReason !== "error" && message.stopReason !== "aborted")
                    output += text;
                if (Buffer.byteLength(output) > config.limits.maxReplyBytes)
                    throw new Error("Reply exceeded its bound");
                const measured = message.usage;
                if (!measured) throw new Error("Pi usage unavailable; no zero usage is fabricated");
                for (const [target, source] of [
                    ["inputTokens", "input"],
                    ["outputTokens", "output"],
                    ["cacheCreationInputTokens", "cacheWrite"],
                    ["cacheReadInputTokens", "cacheRead"],
                ]) {
                    if (!Number.isSafeInteger(measured[source]) || measured[source] < 0)
                        throw new Error("Invalid measured usage");
                    usage[target] += measured[source];
                    if (!Number.isSafeInteger(usage[target])) throw new Error("Usage overflow");
                }
                if (
                    typeof measured.cost?.total === "number" &&
                    Number.isFinite(measured.cost.total) &&
                    measured.cost.total >= 0
                )
                    usage.costUsd += measured.cost.total;
                else costAvailable = false;
                observedUsage = true;
            }
            if (event.type === "agent_settled") {
                if (
                    !accepted ||
                    !observedUsage ||
                    !output ||
                    lastStopReason === "error" ||
                    lastStopReason === "aborted"
                )
                    throw new Error(
                        "Pi settled without an acknowledged text response and measured usage",
                    );
                finish({
                    output,
                    usage: { ...usage, costUsd: costAvailable ? usage.costUsd : null },
                });
            }
        },
    );
}
