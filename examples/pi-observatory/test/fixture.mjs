import { appendFileSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";

const [scenario, marker] = process.argv.slice(2);
if (scenario === "--version") {
    process.stdout.write("1.0.2\n");
    process.exit(0);
}
const decoder = new StringDecoder("utf8");
let buffer = "";
let selectedModel;
let promptSeen = false;
const emit = (value) => process.stdout.write(`${JSON.stringify(value)}\r\n`);
process.stdin.on("data", (chunk) => {
    buffer += decoder.write(chunk);
    while (buffer.includes("\n")) {
        const index = buffer.indexOf("\n");
        const command = JSON.parse(buffer.slice(0, index));
        buffer = buffer.slice(index + 1);
        appendFileSync(marker, `${command.type}\n`);
        if (command.type === "get_available_models") {
            emit({
                id: command.id,
                type: "response",
                command: command.type,
                success: true,
                data: {
                    models: [
                        {
                            provider: "fixture-a",
                            id: "model-one",
                            name: "First fixture model",
                            headers: { Authorization: "secret-catalog-header" },
                            baseUrl: "https://private.example",
                        },
                        { provider: "fixture-a", id: "model-two", name: "Second fixture model" },
                        { provider: "fixture-b", id: "model-three", name: "Third fixture model" },
                    ],
                },
            });
            continue;
        }
        if (command.type === "set_model") {
            appendFileSync(marker, `selection:${command.provider}/${command.modelId}\n`);
            if (scenario === "selection-refused") {
                emit({ type: "response", id: command.id, success: false });
                continue;
            }
            setTimeout(() => {
                selectedModel = { provider: command.provider, id: command.modelId };
                emit({
                    type: "response",
                    id: command.id,
                    command: command.type,
                    success: true,
                    data: selectedModel,
                });
            }, 20);
            continue;
        }
        if (command.type !== "prompt") continue;
        promptSeen = true;
        if (!selectedModel) {
            emit({ type: "response", id: "prompt", success: false });
            continue;
        }
        if (scenario === "exit") process.exit(2);
        if (scenario === "malformed") {
            process.stdout.write("not json\n");
            continue;
        }
        if (scenario === "oversized") {
            process.stdout.write("x".repeat(2048));
            continue;
        }
        if (scenario === "refused") {
            emit({
                type: "response",
                id: "prompt",
                success: false,
                error: "secret-provider-diagnostic",
            });
            continue;
        }
        emit({
            type: "response",
            id: "prompt",
            command: "prompt",
            success: true,
            data: { disposition: "started" },
        });
        emit({ type: "agent_start" });
        if (scenario === "hang" || scenario === "uncooperative") continue;
        if (scenario === "retry") {
            emit({
                type: "message_end",
                message: {
                    role: "assistant",
                    content: [],
                    stopReason: "error",
                    usage: { input: 1, output: 0, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } },
                },
            });
            emit({ type: "auto_retry_start" });
        }
        emit({
            type: "message_update",
            assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "provisional" },
        });
        emit({ type: "agent_end" });
        // Delayed authoritative completion proves agent_end is not a completion boundary.
        setTimeout(() => {
            emit({ type: "unknown_future_event" });
            const text = "Authoritative café \u2028 line \u2029 <script>alert(1)</script>";
            const message = {
                type: "message_end",
                message: {
                    role: "assistant",
                    content: [{ type: "text", text }],
                    stopReason: "stop",
                    usage: {
                        input: 4,
                        output: 2,
                        cacheRead: 1,
                        cacheWrite: 0,
                        cost: { total: 0.01 },
                    },
                },
            };
            const bytes = Buffer.from(`${JSON.stringify(message)}\n`);
            const split = bytes.indexOf(Buffer.from("é")) + 1;
            process.stdout.write(bytes.subarray(0, split));
            setTimeout(() => {
                process.stdout.write(bytes.subarray(split));
                emit({ type: "agent_settled" });
            }, 10);
        }, 80);
    }
});
process.stdin.on("end", () => {
    if (scenario === "uncooperative" && promptSeen) {
        setInterval(() => {}, 1000);
        return;
    }
    appendFileSync(marker, "closed\n");
    process.exit(0);
});
