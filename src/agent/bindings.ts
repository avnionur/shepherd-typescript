import type { SemanticRecord, SemanticValue } from "../canonical/canonical-record.ts";
import type { EffectHandlerStack } from "../effect/handler-types.ts";
import type { EffectIntent } from "../effect/types.ts";
import { providerProtocolConfig } from "../protocol/config.ts";
import { SUPERVISION_DISPOSITIONS, TOOL_CALL_DISPOSITIONS } from "../protocol/values.generated.ts";
import {
    readModelConversationRequest,
    readModelConversationResponse,
} from "../provider/messages.ts";
import type {
    ConversationalModelProvider,
    ModelConversationRequest,
    ModelConversationResponse,
    ModelProvider,
    ModelRequest,
    ModelResponse,
    ProviderDescriptor,
} from "../provider/types.ts";
import { readModelRequest, readProviderSignal } from "../provider/validation.ts";
import { ReplayEffectRefusedError, ReplayStepFailureError } from "../replay/errors.ts";
import type { ReplaySessionContext } from "../replay/types.ts";
import { dispatchSupervisedEffect } from "../supervision/dispatch.ts";
import { runInToolEffectScope } from "./tool-effect-scope.ts";
import type {
    ReplayToolLoopBindings,
    SupervisedToolLoopEffectsOptions,
    ToolLoopEffectResult,
    ToolLoopEffects,
} from "./types.ts";

const turn = providerProtocolConfig.tools.turn;
const [MATERIALIZED, DENIED, , FAILED] = TOOL_CALL_DISPOSITIONS;
const [SUPERVISED_MATERIALIZED, MATERIALIZATION_FAILED, , , CANCELLED] = SUPERVISION_DISPOSITIONS;

/**
 * Creates the in-process effect boundary: every tool-call intent is dispatched through an
 * ordinary effect handler stack and is always `materialized`. Handler failures and a missing
 * handler propagate unchanged, as they do from the stack.
 *
 * @param handlers - Handler stack holding one handler per tool effect kind.
 * @returns A tool-loop effect boundary.
 * @throws {TypeError} If `handlers` is not a handler stack.
 *
 * @example
 * ```ts
 * const effects = createHandlerToolLoopEffects(createEffectHandlerStack(metaTools.handlers));
 * ```
 *
 * @public
 */
export function createHandlerToolLoopEffects(handlers: EffectHandlerStack): ToolLoopEffects {
    const stack = readStack(handlers);
    return Object.freeze({
        dispatch: async (intent: EffectIntent, signal: AbortSignal) => {
            readProviderSignal(signal).throwIfAborted();
            const { outcome } = await stack.dispatch(intent);
            return Object.freeze({ disposition: MATERIALIZED, outcome }) as ToolLoopEffectResult;
        },
    });
}

/**
 * Creates the supervised effect boundary: every tool-call intent is durably supervised by
 * `dispatchSupervisedEffect` under the command identity equal to its effect identity, so each
 * interceptor decision, approval, admission, and resolution is retained before any outcome.
 *
 * A `materialized` resolution returns its correlated outcome; `denied` and `rejected` resolve the
 * call as `denied` with the deciding reason and no outcome; `materialization_failed` resolves it as
 * `failed`. A `cancelled` resolution rethrows the signal's reason.
 *
 * @param options - Store, claim, handler stack, and optional interceptors, clock, and approval wait.
 * @returns A tool-loop effect boundary.
 * @throws {TypeError} If options are malformed.
 *
 * @example
 * ```ts
 * const effects = createSupervisedToolLoopEffects({
 *     claimId: "meta-agent",
 *     handlers,
 *     interceptors: [policy],
 *     store,
 * });
 * ```
 *
 * @public
 */
export function createSupervisedToolLoopEffects(
    options: SupervisedToolLoopEffectsOptions,
): ToolLoopEffects {
    if (options === null || typeof options !== "object") {
        throw new TypeError("supervised tool loop effects options must be an object");
    }
    const { approvalTimeoutMilliseconds, claimId, clock, interceptors, store } = options;
    const handlers = readStack(options.handlers);
    return Object.freeze({
        dispatch: async (intent: EffectIntent, signal: AbortSignal) => {
            readProviderSignal(signal).throwIfAborted();
            const inspection = await dispatchSupervisedEffect(store, {
                claimId,
                commandId: intent.effect_id,
                handlers,
                intent,
                signal,
                ...(approvalTimeoutMilliseconds === undefined
                    ? {}
                    : { approvalTimeoutMilliseconds }),
                ...(clock === undefined ? {} : { clock }),
                ...(interceptors === undefined ? {} : { interceptors }),
            });
            const disposition = inspection.resolution?.disposition;
            if (disposition === SUPERVISED_MATERIALIZED && inspection.resolution?.outcome) {
                return Object.freeze({
                    disposition: MATERIALIZED,
                    outcome: inspection.resolution.outcome,
                }) as ToolLoopEffectResult;
            }
            if (disposition === CANCELLED) {
                signal.throwIfAborted();
            }
            if (disposition === MATERIALIZATION_FAILED) {
                return Object.freeze({
                    disposition: FAILED,
                    reason: `${disposition}: the handler failed and the world state is unknown`,
                }) as ToolLoopEffectResult;
            }
            const deciding = inspection.decisions.at(-1)?.reason ?? null;
            const verdict = inspection.approvals.at(-1)?.verdict?.reason ?? null;
            return Object.freeze({
                disposition: DENIED,
                reason: `${disposition}: ${verdict ?? deciding ?? "no reason retained"}`,
            }) as ToolLoopEffectResult;
        },
    });
}

/**
 * Creates the model and effect boundaries of a tool-use loop running inside a replay session
 * program. Each turn becomes one provider step whose request is the encoded turn (see
 * {@link encodeToolTurnRequest}) and whose output is the encoded response; each tool-call intent
 * becomes one effect step. A rewind or replay of the session therefore serves the recorded prefix
 * of the loop, turn requests and tool outcomes alike, byte-identically without invoking the model
 * or any handler. The session provider must be a {@link createToolTurnProvider} wrapper.
 *
 * A branch-suffix effect refused by replay policy resolves the call as `denied`, and a retained
 * handler failure as `failed`; a failed provider step propagates. Every dispatch runs with the
 * executing session's identity in scope, so the meta-agent tool handlers derive substrate command
 * identities that are distinct in each branch that runs a call live.
 *
 * @param context - Replay session context of the running program.
 * @returns The loop's model and effect boundaries.
 * @throws {TypeError} If the context is malformed.
 *
 * @example
 * ```ts
 * await runReplaySession(store, {
 *     ...options,
 *     provider: createToolTurnProvider(model),
 *     program: (context) => runToolLoop({ ...loop, ...createReplayToolLoopBindings(context) }),
 * });
 * ```
 *
 * @public
 */
export function createReplayToolLoopBindings(
    context: ReplaySessionContext,
): ReplayToolLoopBindings {
    if (
        context === null ||
        typeof context !== "object" ||
        typeof context.invokeProvider !== "function" ||
        typeof context.dispatchEffect !== "function"
    ) {
        throw new TypeError("replay tool loop bindings require a replay session context");
    }
    return Object.freeze({
        effects: Object.freeze({
            dispatch: async (intent: EffectIntent, signal: AbortSignal) => {
                readProviderSignal(signal).throwIfAborted();
                try {
                    const step = await runInToolEffectScope(context.session_id, () =>
                        context.dispatchEffect(intent),
                    );
                    return Object.freeze({
                        disposition: MATERIALIZED,
                        outcome: step.outcome,
                    }) as ToolLoopEffectResult;
                } catch (error) {
                    if (error instanceof ReplayEffectRefusedError) {
                        return Object.freeze({
                            disposition: DENIED,
                            reason: error.message,
                        }) as ToolLoopEffectResult;
                    }
                    if (error instanceof ReplayStepFailureError) {
                        return Object.freeze({
                            disposition: FAILED,
                            reason: `${error.failure_name}: ${error.failure_message}`,
                        }) as ToolLoopEffectResult;
                    }
                    throw error;
                }
            },
        }),
        model: Object.freeze({
            converse: async (request: ModelConversationRequest, signal: AbortSignal) => {
                readProviderSignal(signal).throwIfAborted();
                const step = await context.invokeProvider(encodeToolTurnRequest(request));
                return decodeToolTurnOutput(step.response.output, step.response.usage);
            },
        }),
    });
}

/**
 * Wraps a conversational provider as the replay session provider of a tool-use loop. Its `invoke`
 * accepts only encoded turn requests, sends the decoded multi-turn request through `converse`, and
 * returns the encoded response as the step output with the provider's usage.
 *
 * @param provider - Conversational provider answering every turn.
 * @returns A model provider with the wrapped provider's descriptor.
 * @throws {TypeError} If `provider` is not conversational; returned calls throw `TypeError` for a
 *   request that is not an encoded turn.
 *
 * @example
 * ```ts
 * const provider = createToolTurnProvider(createLiveProvider({ id, kind, model }));
 * ```
 *
 * @public
 */
export function createToolTurnProvider(provider: ConversationalModelProvider): ModelProvider {
    if (
        provider === null ||
        typeof provider !== "object" ||
        typeof provider.converse !== "function" ||
        typeof provider.descriptor !== "function"
    ) {
        throw new TypeError("tool turn provider requires a conversational provider");
    }
    return Object.freeze({
        descriptor: (): ProviderDescriptor => provider.descriptor(),
        invoke: async (request: ModelRequest, signal: AbortSignal): Promise<ModelResponse> => {
            readProviderSignal(signal).throwIfAborted();
            const response = await provider.converse(decodeToolTurnRequest(request), signal);
            return Object.freeze({
                output: encodeToolTurnOutput(
                    readModelConversationResponse(response, "tool turn provider response"),
                ),
                usage: response.usage,
            });
        },
    });
}

/**
 * Encodes one multi-turn request as a replayable provider request: the configured turn
 * instruction, the canonical `{ cache_prefix_messages, messages, output_schema, system, tools }`
 * input, and the configured turn output schema. Equal requests encode to equal prompt identities.
 *
 * @param request - Multi-turn request.
 * @returns The encoded provider request.
 * @throws {TypeError} If the request is malformed.
 *
 * @public
 */
export function encodeToolTurnRequest(request: ModelConversationRequest): ModelRequest {
    const snapshot = readModelConversationRequest(request);
    return readModelRequest({
        input: {
            cache_prefix_messages: snapshot.cachePrefixMessages,
            messages: snapshot.messages as unknown as SemanticValue,
            output_schema: snapshot.outputSchema,
            system: snapshot.system,
            tools: snapshot.tools as unknown as SemanticValue,
        },
        instruction: turn.instruction,
        outputSchema: turn.outputSchema as SemanticRecord,
    });
}

function decodeToolTurnRequest(value: ModelRequest): ModelConversationRequest {
    const request = readModelRequest(value);
    const input = request.input as Readonly<Record<string, unknown>> | null;
    if (request.instruction !== turn.instruction || input === null || typeof input !== "object") {
        throw new TypeError("tool turn provider accepts only encoded tool-use turn requests");
    }
    return readModelConversationRequest({
        cachePrefixMessages: input.cache_prefix_messages,
        messages: input.messages,
        outputSchema: input.output_schema,
        system: input.system,
        tools: input.tools,
    });
}

function encodeToolTurnOutput(response: ModelConversationResponse): SemanticValue {
    return {
        message: response.message as unknown as SemanticValue,
        output: response.output,
        stop_reason: response.stopReason,
    };
}

function decodeToolTurnOutput(
    output: SemanticValue,
    usage: ModelResponse["usage"],
): ModelConversationResponse {
    const fields = output as Readonly<Record<string, unknown>> | null;
    if (fields === null || typeof fields !== "object" || Array.isArray(fields)) {
        throw new TypeError("tool turn step output must be an encoded turn response");
    }
    return readModelConversationResponse(
        {
            message: fields.message,
            output: fields.output,
            stopReason: fields.stop_reason,
            usage,
        },
        "tool turn step output",
    );
}

function readStack(value: unknown): EffectHandlerStack {
    if (typeof (value as { readonly dispatch?: unknown } | null)?.dispatch !== "function") {
        throw new TypeError("tool loop effects require an effect handler stack");
    }
    return value as EffectHandlerStack;
}
