import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import {
    type ApplicationProtocolDefinition,
    type ApplicationWorldCustody,
    createEffectHandlerStack,
    createHandlerToolLoopEffects,
    createProgramConversationProvider,
    type ModelContentBlock,
    type ModelConversationRequest,
    type ModelUsage,
    type RuntimeSupervisorPolicy,
    type RuntimeSupervisorPolicyContext,
    type RuntimeSupervisorWait,
    type RuntimeSupervisorWorkerDefinition,
    readApplicationProtocol,
    type SemanticRecord,
    type ToolLoopTool,
} from "../../src/index.ts";
import { researchApplications } from "./fixtures.ts";

/** Usage every scripted turn reports. */
export const TURN_USAGE: ModelUsage = Object.freeze({
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 2,
    costUsd: null,
    inputTokens: 5,
    outputTokens: 3,
});

/** The repository's runtime supervision protocol with optional budget overrides, validated. */
export function runtimeProtocol(
    budgets: Readonly<Record<string, number>> = {},
): ApplicationProtocolDefinition {
    const base = (researchApplications as unknown as Record<string, Record<string, unknown>>)
        .runtimeSupervision as Record<string, unknown>;
    return readApplicationProtocol({
        ...base,
        budgets: { ...(base.budgets as Record<string, number>), ...budgets },
    });
}

/** Tools every fixture worker offers: write one file and read one file of its custody. */
export const FILE_TOOLS: readonly ToolLoopTool[] = [
    {
        description: "Write text into one file of the worker's tree.",
        effectKind: "test.runtime.write_file",
        inputSchema: {
            additionalProperties: false,
            properties: { path: { minLength: 1, type: "string" }, text: { type: "string" } },
            required: ["path", "text"],
            type: "object",
        },
        name: "write_file",
        reversibility: "compensable",
    },
    {
        description: "Read one file of the worker's tree.",
        effectKind: "test.runtime.read_file",
        inputSchema: {
            additionalProperties: false,
            properties: { path: { minLength: 1, type: "string" } },
            required: ["path"],
            type: "object",
        },
        name: "read_file",
        reversibility: "reversible",
    },
];

/** Handler-backed effects that write and read files under one custody root. */
export function fileEffects({ custody }: { readonly custody: ApplicationWorldCustody }) {
    const target = (intent: { readonly payload: unknown }) =>
        path.join(
            custody.root,
            (intent.payload as { readonly input: { readonly path: string } }).input.path,
        );
    return createHandlerToolLoopEffects(
        createEffectHandlerStack([
            {
                handle: async (intent) => {
                    const input = (intent.payload as { readonly input: { readonly text: string } })
                        .input;
                    await writeFile(target(intent), input.text);
                    return { ok: true, value: null };
                },
                handlerId: "handler:test.runtime.write_file",
                kind: "test.runtime.write_file",
            },
            {
                handle: (intent) => {
                    const file = target(intent);
                    return existsSync(file)
                        ? { ok: true, value: readFileSync(file, "utf8") }
                        : { error: { reason: "missing file" }, ok: false };
                },
                handlerId: "handler:test.runtime.read_file",
                kind: "test.runtime.read_file",
            },
        ]),
    );
}

/** One scripted worker turn: content blocks, possibly awaited or derived from the request. */
export type WorkerTurn = (
    request: ModelConversationRequest,
    signal: AbortSignal,
) => Promise<readonly ModelContentBlock[]> | readonly ModelContentBlock[];

/**
 * Scripted worker model: the n-th request of a session (counted by assistant messages already in
 * the conversation) is answered by the n-th turn of the script for the session's attempt, where the
 * attempt is read from the number of sessions started so far, or from `select` when supplied (as a
 * fresh process must). Every request is recorded.
 */
export function scriptedWorker(
    id: string,
    sessions: readonly (readonly WorkerTurn[])[],
    select?: (request: ModelConversationRequest) => number,
): {
    readonly model: ReturnType<typeof createProgramConversationProvider>;
    readonly requests: ModelConversationRequest[];
} {
    const requests: ModelConversationRequest[] = [];
    let session = -1;
    const model = createProgramConversationProvider({
        id,
        model: "scripted-worker-v1",
        respond: async (request, signal) => {
            requests.push(request);
            const index = request.messages.filter((message) => message.role === "assistant").length;
            if (index === 0) {
                session += 1;
            }
            const turn = sessions[select?.(request) ?? Math.max(0, session)]?.[index];
            if (turn === undefined) {
                throw new Error(`worker ${id} has no turn ${index} in session ${session}`);
            }
            const content = await turn(request, signal);
            const calls = content.some((block) => block.type === "tool_use");
            return {
                message: { content, role: "assistant" },
                output: calls
                    ? null
                    : content.map((block) => (block.type === "text" ? block.text : "")).join(""),
                stopReason: calls ? "tool_use" : "end_turn",
                usage: TURN_USAGE,
            };
        },
    });
    return { model, requests };
}

/** Builds one fixture worker definition over the file tools. */
export function runtimeWorker(
    workerId: string,
    model: RuntimeSupervisorWorkerDefinition["model"],
    feature = `Implement feature ${workerId}.`,
): RuntimeSupervisorWorkerDefinition {
    return {
        effects: fileEffects,
        feature,
        model,
        system: `You are worker ${workerId}.`,
        tools: FILE_TOOLS,
        workerId,
    };
}

/** Builds one tool-use block. */
export function use(id: string, name: string, input: SemanticRecord): ModelContentBlock {
    return { id, input, name, type: "tool_use" };
}

/** Builds one text block. */
export function say(text: string): ModelContentBlock {
    return { text, type: "text" };
}

/** A promise released by the test, rejecting with the signal's reason when it aborts first. */
export function gate(): {
    readonly open: () => void;
    readonly wait: (signal: AbortSignal) => Promise<void>;
} {
    let release = () => {};
    const opened = new Promise<void>((resolve) => {
        release = resolve;
    });
    return {
        open: () => release(),
        wait: (signal) =>
            new Promise<void>((resolve, reject) => {
                signal.throwIfAborted();
                const onAbort = () => reject(signal.reason);
                signal.addEventListener("abort", onAbort, { once: true });
                void opened.then(() => {
                    signal.removeEventListener("abort", onAbort);
                    resolve();
                });
            }),
    };
}

/**
 * Test-driven tick scheduler: every wait blocks until `advance` releases it, or immediately once
 * `release` was called. The cadences each wait received are recorded.
 */
export function ticker(): {
    readonly advance: () => Promise<void>;
    readonly cadences: number[];
    readonly release: () => void;
    readonly wait: RuntimeSupervisorWait;
} {
    const cadences: number[] = [];
    const waiting: (() => void)[] = [];
    let released = false;
    return {
        advance: async () => {
            await until(() => waiting.length > 0);
            (waiting.shift() as () => void)();
        },
        cadences,
        release: () => {
            released = true;
            for (const resume of waiting.splice(0)) {
                resume();
            }
        },
        wait: (milliseconds, signal) => {
            cadences.push(milliseconds);
            if (released) {
                return new Promise((resolve) => setImmediate(resolve));
            }
            return new Promise((resolve, reject) => {
                if (signal.aborted) {
                    reject(signal.reason);
                    return;
                }
                const onAbort = () => reject(signal.reason);
                signal.addEventListener("abort", onAbort, { once: true });
                waiting.push(() => {
                    signal.removeEventListener("abort", onAbort);
                    resolve();
                });
            });
        },
    };
}

/** Policy returning scripted decision objects in tick order, then `{ decisions: [] }`. */
export function scriptedPolicy(
    outputs: readonly unknown[],
): RuntimeSupervisorPolicy & { readonly contexts: RuntimeSupervisorPolicyContext[] } {
    const contexts: RuntimeSupervisorPolicyContext[] = [];
    const policy: RuntimeSupervisorPolicy = (context) => {
        contexts.push(context);
        return { output: outputs[context.tick - 1] ?? { decisions: [] }, usage: null };
    };
    return Object.assign(policy, { contexts });
}

/** Polls until the predicate holds, failing after a bounded number of event-loop turns. */
export async function until(predicate: () => boolean, label = "condition"): Promise<void> {
    for (let attempt = 0; attempt < 20_000; attempt += 1) {
        if (predicate()) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1));
    }
    throw new Error(`timed out waiting for ${label}`);
}

/** Parses the first tool result of the last user message of one recorded request. */
export function firstToolResult(request: ModelConversationRequest | undefined): {
    readonly result: { readonly ok: boolean; readonly value?: unknown };
} {
    const block = request?.messages.at(-1)?.content[0];
    if (block?.type !== "tool_result") {
        throw new Error("the request does not end with a tool result");
    }
    return JSON.parse(block.content) as { readonly result: { readonly ok: boolean } };
}
