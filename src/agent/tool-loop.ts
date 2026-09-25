import {
    canonicalizeSemanticValue,
    type SemanticRecord,
    type SemanticValue,
} from "../canonical/canonical-record.ts";
import { createEffectIntent } from "../effect/records.ts";
import { providerProtocolConfig } from "../protocol/config.ts";
import {
    EFFECT_REVERSIBILITY_TIERS,
    MODEL_CONTENT_BLOCK_TYPES,
    MODEL_MESSAGE_ROLES,
    TOOL_CALL_DISPOSITIONS,
    TOOL_LOOP_STATUSES,
} from "../protocol/values.generated.ts";
import {
    isWellFormedText,
    readModelConversationRequest,
    readModelConversationResponse,
    readModelMessage,
    toolUseBlocks,
} from "../provider/messages.ts";
import type {
    ModelContentBlock,
    ModelConversationRequest,
    ModelMessage,
    ModelToolDefinition,
    ModelToolResultBlock,
    ModelToolUseBlock,
} from "../provider/types.ts";
import { readProviderSignal } from "../provider/validation.ts";
import { compileJSONSchema, type JSONSchemaValidator } from "../schema/json-schema-validator.ts";
import type {
    RunToolLoopOptions,
    ToolLoopCall,
    ToolLoopEffectResult,
    ToolLoopResult,
    ToolLoopTool,
    ToolLoopTurn,
} from "./types.ts";

const loopConfig = providerProtocolConfig.tools.loop;
const [MATERIALIZED, DENIED, INVALID, FAILED] = TOOL_CALL_DISPOSITIONS;
const [COMPLETED, TURN_LIMIT] = TOOL_LOOP_STATUSES;
const [USER_ROLE] = MODEL_MESSAGE_ROLES;
const [TEXT_BLOCK, , TOOL_RESULT_BLOCK] = MODEL_CONTENT_BLOCK_TYPES;

type BoundTool = {
    readonly tool: ToolLoopTool;
    readonly validator: JSONSchemaValidator;
};

/**
 * Runs a bounded multi-turn tool-use loop in which every admissible model tool call becomes a typed
 * effect intent dispatched through the supplied effect boundary.
 *
 * Each turn sends the whole conversation, the offered tools, the output schema, and the system
 * prompt as one {@link ModelConversationRequest}, with the whole conversation as the cacheable
 * prefix. A response without tool-use blocks ends the loop as `completed` with its output. Otherwise
 * each tool call, in the order requested, is resolved as follows:
 *
 * - An unknown tool, or an input that fails the tool's JSON Schema, is `invalid`: no intent is
 *   created and the model receives the validation issues.
 * - Otherwise the loop creates an intent of the tool's `effectKind` and `reversibility`, with the
 *   payload `{ input, tool, tool_use_id }` and the runtime-derived effect identity
 *   `<effectIdPrefix><loopId>:<turn>:<call>`, and dispatches it. The boundary reports it
 *   `materialized` with its correlated outcome, `denied` before any outcome, or `failed`.
 *
 * Every call receives exactly one tool-result block carrying the canonical JSON of its disposition
 * and result, bounded by `providers.tools.loop.maxResultBytes`. The next user message holds the tool
 * results followed by the optional guidance text. The loop stops as `turn_limit` with a null output
 * after `maxTurns` turns that all requested tools.
 *
 * @param options - Loop identity, initial messages, tools, model and effect boundaries, and optional
 *   bound, output schema, system prompt, guidance hook, turn observer, and signal.
 * @returns The final conversation, output, status, and turns.
 * @throws {TypeError} If options, a tool definition, a request, or a response are malformed.
 * @throws The signal's reason when it aborts, and model, effect-boundary, guidance, and observer
 *   errors unchanged.
 *
 * @example
 * ```ts
 * const result = await runToolLoop({
 *     effects: createHandlerToolLoopEffects(handlers),
 *     loopId: "meta-agent:1",
 *     messages: [{ content: [{ text: "Fix the failing worker.", type: "text" }], role: "user" }],
 *     model: provider,
 *     tools,
 * });
 * ```
 *
 * @public
 */
export async function runToolLoop(options: RunToolLoopOptions): Promise<ToolLoopResult> {
    const fields = readOptions(options);
    const signal = fields.signal;
    const definitions: readonly ModelToolDefinition[] = Object.freeze(
        [...fields.tools.values()].map(({ tool }) =>
            Object.freeze({
                description: tool.description,
                inputSchema: tool.inputSchema,
                name: tool.name,
            }),
        ),
    );
    const messages: ModelMessage[] = [...fields.messages];
    const turns: ToolLoopTurn[] = [];
    for (let index = 0; index < fields.maxTurns; index += 1) {
        signal.throwIfAborted();
        const request: ModelConversationRequest = readModelConversationRequest({
            cachePrefixMessages: messages.length,
            messages: [...messages],
            outputSchema: fields.outputSchema,
            system: fields.system,
            tools: definitions,
        });
        const response = readModelConversationResponse(
            await fields.model.converse(request, signal),
            "tool loop model response",
        );
        signal.throwIfAborted();
        messages.push(response.message);
        const uses = toolUseBlocks(response.message);
        if (uses.length === 0) {
            const turn = freezeTurn({ calls: [], guidance: null, index, request, response });
            turns.push(turn);
            await fields.onTurn?.(turn);
            return freezeResult(messages, response.output, COMPLETED, turns);
        }
        const calls: ToolLoopCall[] = [];
        for (const [position, use] of uses.entries()) {
            calls.push(await resolveCall(fields, index, position, use));
        }
        const pending = freezeTurn({ calls, guidance: null, index, request, response });
        const guidance =
            fields.guidance === undefined || index + 1 >= fields.maxTurns
                ? null
                : readGuidance(
                      await fields.guidance({
                          messages: Object.freeze([...messages]),
                          signal,
                          turn: pending,
                      }),
                  );
        signal.throwIfAborted();
        const content: ModelContentBlock[] = calls.map((call) => call.result);
        if (guidance !== null) {
            content.push(Object.freeze({ text: guidance, type: TEXT_BLOCK }));
        }
        messages.push(readModelMessage({ content, role: USER_ROLE }, "tool loop result message"));
        const turn = guidance === null ? pending : freezeTurn({ ...pending, guidance });
        turns.push(turn);
        await fields.onTurn?.(turn);
    }
    return freezeResult(messages, null, TURN_LIMIT, turns);
}

async function resolveCall(
    fields: LoopFields,
    turn: number,
    position: number,
    use: ModelToolUseBlock,
): Promise<ToolLoopCall> {
    const bound = fields.tools.get(use.name);
    const base = { input: use.input, name: use.name, toolUseId: use.id };
    if (bound === undefined) {
        return invalidCall(base, [`tool ${use.name} is not offered`]);
    }
    const issues = bound.validator.validate(use.input);
    if (issues.length > 0) {
        return invalidCall(
            base,
            issues.map((issue) => `${issue.path}: ${issue.message}`),
        );
    }
    const intent = createEffectIntent({
        effectId: `${loopConfig.effectIdPrefix}${fields.loopId}:${turn}:${position}`,
        kind: bound.tool.effectKind,
        payload: { input: use.input, tool: use.name, tool_use_id: use.id },
        reversibility: bound.tool.reversibility,
    });
    const dispatched = readEffectResult(await fields.effects.dispatch(intent, fields.signal));
    if (dispatched.disposition === MATERIALIZED) {
        const outcome = dispatched.outcome;
        if (outcome.effect_id !== intent.effect_id || outcome.kind !== intent.kind) {
            throw new TypeError("tool loop effect boundary returned an uncorrelated outcome");
        }
        return freezeCall({
            ...base,
            disposition: MATERIALIZED,
            intent,
            outcome,
            reason: null,
            result: resultBlock(
                use.id,
                { disposition: MATERIALIZED, result: outcome.result as SemanticValue },
                !outcome.result.ok,
            ),
        });
    }
    return freezeCall({
        ...base,
        disposition: dispatched.disposition,
        intent,
        outcome: null,
        reason: dispatched.reason,
        result: resultBlock(
            use.id,
            { disposition: dispatched.disposition, reason: dispatched.reason },
            true,
        ),
    });
}

function invalidCall(
    base: Pick<ToolLoopCall, "input" | "name" | "toolUseId">,
    issues: readonly string[],
): ToolLoopCall {
    const reason = issues.join("; ");
    return freezeCall({
        ...base,
        disposition: INVALID,
        intent: null,
        outcome: null,
        reason,
        result: resultBlock(base.toolUseId, { disposition: INVALID, issues: [...issues] }, true),
    });
}

function resultBlock(
    toolUseId: string,
    value: SemanticRecord,
    isError: boolean,
): ModelToolResultBlock {
    return Object.freeze({
        content: boundResult(canonicalizeSemanticValue(value)),
        isError,
        toolUseId,
        type: TOOL_RESULT_BLOCK,
    });
}

function boundResult(text: string): string {
    const bytes = Buffer.from(text, "utf8");
    if (bytes.length <= loopConfig.maxResultBytes) {
        return text;
    }
    const kept = new TextDecoder()
        .decode(bytes.subarray(0, loopConfig.maxResultBytes))
        .replace(/�+$/u, "");
    return `${kept}${loopConfig.truncationMarker}`;
}

function readEffectResult(value: unknown): ToolLoopEffectResult {
    const result = value as Partial<Record<string, unknown>> | null;
    if (result === null || typeof result !== "object") {
        throw new TypeError("tool loop effect boundary must return a disposition");
    }
    if (result.disposition === MATERIALIZED && result.outcome !== null) {
        return result as ToolLoopEffectResult;
    }
    if (
        (result.disposition === DENIED || result.disposition === FAILED) &&
        isWellFormedText(result.reason)
    ) {
        return result as ToolLoopEffectResult;
    }
    throw new TypeError("tool loop effect boundary returned a malformed disposition");
}

function readGuidance(value: unknown): string | null {
    if (value === null) {
        return null;
    }
    if (!isWellFormedText(value)) {
        throw new TypeError("tool loop guidance must be non-empty text or null");
    }
    return value;
}

function freezeCall(call: ToolLoopCall): ToolLoopCall {
    return Object.freeze(call);
}

function freezeTurn(turn: {
    readonly calls: readonly ToolLoopCall[];
    readonly guidance: string | null;
    readonly index: number;
    readonly request: ToolLoopTurn["request"];
    readonly response: ToolLoopTurn["response"];
}): ToolLoopTurn {
    return Object.freeze({ ...turn, calls: Object.freeze([...turn.calls]) });
}

function freezeResult(
    messages: readonly ModelMessage[],
    output: SemanticValue,
    status: ToolLoopResult["status"],
    turns: readonly ToolLoopTurn[],
): ToolLoopResult {
    return Object.freeze({
        messages: Object.freeze([...messages]),
        output,
        status,
        turns: Object.freeze([...turns]),
    });
}

type LoopFields = {
    readonly effects: RunToolLoopOptions["effects"];
    readonly guidance: RunToolLoopOptions["guidance"];
    readonly loopId: string;
    readonly maxTurns: number;
    readonly messages: readonly ModelMessage[];
    readonly model: RunToolLoopOptions["model"];
    readonly onTurn: RunToolLoopOptions["onTurn"];
    readonly outputSchema: SemanticRecord | null;
    readonly signal: AbortSignal;
    readonly system: string | null;
    readonly tools: ReadonlyMap<string, BoundTool>;
};

const OPTION_KEYS = [
    "effects",
    "guidance",
    "loopId",
    "maxTurns",
    "messages",
    "model",
    "onTurn",
    "outputSchema",
    "signal",
    "system",
    "tools",
];

function readOptions(value: unknown): LoopFields {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError("tool loop options must be an object");
    }
    if (Object.keys(value).some((key) => !OPTION_KEYS.includes(key))) {
        throw new TypeError("tool loop options must contain only their declared fields");
    }
    const options = value as RunToolLoopOptions;
    if (!isWellFormedText(options.loopId)) {
        throw new TypeError("tool loop loopId must be non-empty well-formed text");
    }
    if (typeof options.model?.converse !== "function") {
        throw new TypeError("tool loop model must provide converse");
    }
    if (typeof options.effects?.dispatch !== "function") {
        throw new TypeError("tool loop effects must provide dispatch");
    }
    for (const key of ["guidance", "onTurn"] as const) {
        if (options[key] !== undefined && typeof options[key] !== "function") {
            throw new TypeError(`tool loop ${key} must be a function`);
        }
    }
    const maxTurns = options.maxTurns ?? loopConfig.defaultMaxTurns;
    if (!Number.isSafeInteger(maxTurns) || maxTurns < 1 || maxTurns > loopConfig.maxTurns) {
        throw new TypeError(
            `tool loop maxTurns must be an integer from 1 to ${loopConfig.maxTurns}`,
        );
    }
    if (!Array.isArray(options.messages) || options.messages.length === 0) {
        throw new TypeError("tool loop messages must be a non-empty array");
    }
    const messages = Object.freeze(
        options.messages.map((message, index) =>
            readModelMessage(message, `tool loop messages[${index}]`),
        ),
    );
    if (!Array.isArray(options.tools)) {
        throw new TypeError("tool loop tools must be an array");
    }
    const tools = new Map<string, BoundTool>();
    for (const [index, tool] of options.tools.entries()) {
        const bound = readTool(tool, `tool loop tools[${index}]`);
        if (tools.has(bound.tool.name)) {
            throw new TypeError("tool loop tool names must be unique");
        }
        tools.set(bound.tool.name, bound);
    }
    return {
        effects: options.effects,
        guidance: options.guidance,
        loopId: options.loopId,
        maxTurns,
        messages,
        model: options.model,
        onTurn: options.onTurn,
        outputSchema: options.outputSchema ?? null,
        signal: readProviderSignal(options.signal ?? new AbortController().signal),
        system: options.system ?? null,
        tools,
    };
}

function readTool(value: unknown, subject: string): BoundTool {
    const tool = value as Partial<ToolLoopTool> | null;
    if (tool === null || typeof tool !== "object") {
        throw new TypeError(`${subject} must be an object`);
    }
    if (
        !isWellFormedText(tool.name) ||
        !isWellFormedText(tool.description) ||
        !isWellFormedText(tool.effectKind)
    ) {
        throw new TypeError(`${subject} requires a name, description, and effect kind`);
    }
    if (!(EFFECT_REVERSIBILITY_TIERS as readonly unknown[]).includes(tool.reversibility)) {
        throw new TypeError(`${subject} reversibility is not a configured tier`);
    }
    const validator = compileJSONSchema(tool.inputSchema);
    return {
        tool: Object.freeze({
            description: tool.description,
            effectKind: tool.effectKind,
            inputSchema: validator.document as SemanticRecord,
            name: tool.name,
            reversibility: tool.reversibility as ToolLoopTool["reversibility"],
        }),
        validator,
    };
}
