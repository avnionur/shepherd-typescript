import { createInterface } from "node:readline";

// Cooperative checkpoint test worker: a counter whose state is captured and restored through the
// structured stdin/stdout protocol. Request operations also drive protocol-violation paths.
let count = 0;
let nextCheckpoint = "valid";
const lines = createInterface({ input: process.stdin });

const send = (message: Record<string, unknown>) => {
    process.stdout.write(`${JSON.stringify(message)}\n`);
};

lines.on("line", (line) => {
    const message = JSON.parse(line) as {
        readonly data?: string;
        readonly id: number;
        readonly payload?: { readonly op?: string };
        readonly type: string;
    };
    if (message.type === "checkpoint") {
        const data = Buffer.from(JSON.stringify({ count })).toString("base64");
        if (nextCheckpoint === "corrupt") {
            send({ data: `${data}!`, id: message.id, type: "image" });
        } else if (nextCheckpoint === "empty") {
            send({ id: message.id, type: "image" });
        } else {
            send({ data, id: message.id, type: "image" });
        }
        nextCheckpoint = "valid";
    } else if (message.type === "restore") {
        count = (
            JSON.parse(Buffer.from(message.data as string, "base64").toString("utf8")) as {
                readonly count: number;
            }
        ).count;
        send({ id: message.id, type: "restored" });
    } else {
        const op = message.payload?.op;
        if (op === "increment") {
            count += 1;
            send({ id: message.id, payload: { count }, type: "response" });
        } else if (op === "read") {
            send({ id: message.id, payload: { count }, type: "response" });
        } else if (op === "error") {
            send({ id: message.id, message: "worker refused", type: "error" });
        } else if (op === "error-without-message") {
            send({ id: message.id, type: "error" });
        } else if (op === "garbage") {
            process.stdout.write("not json\n");
        } else if (op === "wrong-id") {
            send({ id: message.id + 100, payload: null, type: "response" });
        } else if (op === "wrong-type") {
            send({ id: message.id, type: "restored" });
        } else if (op === "corrupt-next-checkpoint" || op === "empty-next-checkpoint") {
            nextCheckpoint = op === "corrupt-next-checkpoint" ? "corrupt" : "empty";
            send({ id: message.id, payload: null, type: "response" });
        } else if (op === "huge") {
            process.stdout.write("x".repeat(Number(process.env.HUGE_BYTES ?? "0")));
        } else if (op === "exit") {
            process.exit(3);
        }
        // Any other operation never answers, exercising the response timeout.
    }
});
