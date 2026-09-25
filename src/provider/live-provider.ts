import type { SemanticValue } from "../canonical/canonical-record.ts";
import { createCanonicalSnapshot } from "../canonical/snapshot.ts";
import { providerProtocolConfig } from "../protocol/config.ts";
import type { LiveProviderKindConfig } from "../protocol/config-types.ts";
import { MODEL_CONTENT_BLOCK_TYPES, MODEL_MESSAGE_ROLES } from "../protocol/values.generated.ts";
import { LiveProviderError } from "./errors.ts";
import { LIVE_DIALECTS, type LiveDialectSettings } from "./live-dialects.ts";
import {
    isWellFormedText,
    readModelConversationRequest,
    readModelMessage,
    renderModelRequestMessage,
    textMessage,
} from "./messages.ts";
import type {
    ConversationalModelProvider,
    LiveProviderDefinition,
    LiveProviderTransport,
    ModelConversationRequest,
    ModelConversationResponse,
    ModelRequest,
    ModelResponse,
    ProviderDescriptor,
    ProviderKind,
} from "./types.ts";
import { readModelRequest, readProviderSignal } from "./validation.ts";

const live = providerProtocolConfig.live;
const [, ASSISTANT_ROLE] = MODEL_MESSAGE_ROLES;
const [, TOOL_USE_BLOCK] = MODEL_CONTENT_BLOCK_TYPES;

/**
 * Creates a live model provider for one configured live kind.
 *
 * Endpoint, headers, credential header and environment variable, prompt-cache marker, output-token
 * field, and complete stop reasons all come from the kind's `providers.live.kinds` entry in
 * `protocol.config.json`; the kind's wire dialect encodes requests and decodes responses. The
 * credential is read once from `definition.credential` or the configured environment variable and
 * is held only in the provider closure: it is never part of the descriptor, a request other than
 * its credential header, a response, or an error message.
 *
 * `invoke` sends one request as a single user turn. `converse` sends a multi-turn message list and
 * places the configured cache-control marker on the last content block of the last prefix
 * message. When the request offers tools they are sent under the kind's configured
 * `toolUse.requestField`; a response whose stop reason is one of the kind's `toolUse.stopReasons`
 * returns the assistant message with its text and tool-use blocks and a null output. Both observe
 * the signal while the request is pending and reject with its reason.
 *
 * @param definition - Kind, identity, model, and optional credential, endpoint, environment,
 *   output-token limit, and transport.
 * @returns A conversational provider.
 * @throws {TypeError} If the definition is malformed or the kind is not a configured live kind.
 * @throws {LiveProviderError} With reason `credential` when no credential is configured.
 *
 * @example
 * ```ts
 * const provider = createLiveProvider({ id: "reviewer", kind, model });
 * const response = await provider.invoke(request, new AbortController().signal);
 * ```
 *
 * @public
 */
export function createLiveProvider(
    definition: LiveProviderDefinition,
): ConversationalModelProvider {
    const fields = readDefinition(definition);
    const kind = live.kinds[fields.kind] as LiveProviderKindConfig;
    const credential =
        fields.credential ??
        readCredential(fields.environment, kind.credential.environmentVariable);
    const dialect = LIVE_DIALECTS[kind.dialect];
    const settings: LiveDialectSettings = Object.freeze({
        cacheControl: kind.cacheControl,
        maxOutputTokens: fields.maxOutputTokens ?? kind.maxOutputTokens,
        maxTokensField: kind.maxTokensField,
        model: fields.model,
        outputFormat: kind.outputFormat,
        toolsField: kind.toolUse.requestField,
    });
    const headers = Object.freeze({
        ...kind.headers,
        [kind.credential.header]:
            kind.credential.scheme === null
                ? credential
                : `${kind.credential.scheme} ${credential}`,
    });
    const url = fields.endpoint ?? kind.endpoint;
    const transport = fields.transport ?? fetchTransport;
    const descriptor: ProviderDescriptor = Object.freeze({
        capabilities: kind.capabilities,
        id: fields.id,
        kind: fields.kind,
        model: fields.model,
    });
    const redact = (text: string): string =>
        boundDetail(text.replaceAll(credential, live.redaction));
    const converse = async (
        requestValue: ModelConversationRequest,
        signalValue: AbortSignal,
    ): Promise<ModelConversationResponse> => {
        const signal = readProviderSignal(signalValue);
        signal.throwIfAborted();
        const request = readModelConversationRequest(requestValue);
        const body = JSON.stringify(dialect.encode(request, settings));
        let response: Awaited<ReturnType<LiveProviderTransport>>;
        try {
            response = await raceAbort(transport({ body, headers, url }, signal), signal);
        } catch (error) {
            if (signal.aborted) {
                throw signal.reason;
            }
            throw new LiveProviderError("transport", null, null, { cause: error });
        }
        signal.throwIfAborted();
        if (!Number.isSafeInteger(response?.status) || typeof response.body !== "string") {
            throw new LiveProviderError("transport", null);
        }
        if (response.status < 200 || response.status > 299) {
            throw new LiveProviderError(
                "http",
                redact(`${response.status} ${readErrorDetail(response.body)}`),
                response.status,
            );
        }
        let parsed: unknown;
        try {
            parsed = JSON.parse(response.body);
        } catch {
            throw new LiveProviderError("response", "response body is not JSON");
        }
        const decoded = dialect.decode(parsed);
        if (typeof decoded === "string") {
            throw new LiveProviderError("response", decoded);
        }
        const calls = decoded.content.filter((block) => block.type === TOOL_USE_BLOCK);
        if (kind.toolUse.stopReasons.includes(decoded.stopReason)) {
            if (calls.length === 0) {
                throw new LiveProviderError("response", "tool-use response has no tool calls");
            }
            return Object.freeze({
                message: readModelMessage(
                    { content: decoded.content, role: ASSISTANT_ROLE },
                    "live provider response message",
                ),
                output: null,
                stopReason: decoded.stopReason,
                usage: Object.freeze({ ...decoded.usage }),
            });
        }
        if (!kind.completeStopReasons.includes(decoded.stopReason)) {
            throw new LiveProviderError(
                "response",
                redact(`incomplete stop reason ${decoded.stopReason}`),
            );
        }
        if (calls.length > 0) {
            throw new LiveProviderError("response", "complete response carries tool calls");
        }
        if (!isWellFormedText(decoded.text)) {
            throw new LiveProviderError("response", "response has no text content");
        }
        return Object.freeze({
            message: textMessage(ASSISTANT_ROLE, decoded.text),
            output:
                request.outputSchema === null ? decoded.text : parseStructuredOutput(decoded.text),
            stopReason: decoded.stopReason,
            usage: Object.freeze({ ...decoded.usage }),
        });
    };
    return Object.freeze({
        converse,
        descriptor: (): ProviderDescriptor => descriptor,
        invoke: async (request: ModelRequest, signal: AbortSignal): Promise<ModelResponse> => {
            readProviderSignal(signal).throwIfAborted();
            const snapshot = readModelRequest(request);
            const response = await converse(
                {
                    cachePrefixMessages: 1,
                    messages: [renderModelRequestMessage(snapshot)],
                    outputSchema: snapshot.outputSchema,
                    system: null,
                },
                signal,
            );
            return Object.freeze({ output: response.output, usage: response.usage });
        },
    });
}

/** Default transport posting the serialized body with the global `fetch`. */
async function fetchTransport(
    request: Parameters<LiveProviderTransport>[0],
    signal: AbortSignal,
): ReturnType<LiveProviderTransport> {
    const response = await fetch(request.url, {
        body: request.body,
        headers: request.headers,
        method: "POST",
        signal,
    });
    return { body: await response.text(), status: response.status };
}

function raceAbort<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const abort = () => reject(signal.reason);
        signal.addEventListener("abort", abort, { once: true });
        pending.then(
            (value) => {
                signal.removeEventListener("abort", abort);
                resolve(value);
            },
            (error: unknown) => {
                signal.removeEventListener("abort", abort);
                reject(error);
            },
        );
    });
}

function parseStructuredOutput(text: string): SemanticValue {
    try {
        return createCanonicalSnapshot({ value: JSON.parse(text) as SemanticValue })
            .value as SemanticValue;
    } catch {
        throw new LiveProviderError("response", "structured output is not canonical JSON");
    }
}

function readErrorDetail(body: string): string {
    try {
        const parsed = JSON.parse(body) as { readonly error?: unknown };
        const error = parsed.error;
        if (typeof error === "string") {
            return error;
        }
        if (error !== null && typeof error === "object") {
            const { message, type } = error as {
                readonly message?: unknown;
                readonly type?: unknown;
            };
            return [type, message].filter((part) => typeof part === "string").join(" ");
        }
    } catch {
        // A non-JSON error body is summarized by its status only.
    }
    return "";
}

function boundDetail(text: string): string {
    const bytes = Buffer.from(text.trim(), "utf8");
    if (bytes.length <= live.limits.maxErrorDetailBytes) {
        return text.trim();
    }
    return new TextDecoder()
        .decode(bytes.subarray(0, live.limits.maxErrorDetailBytes))
        .replace(/�+$/u, "");
}

function readCredential(
    environment: Readonly<Record<string, string | undefined>>,
    variable: string,
): string {
    const value = environment[variable];
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new LiveProviderError("credential", variable);
    }
    return value;
}

function readDefinition(value: unknown): {
    readonly credential: string | undefined;
    readonly endpoint: string | undefined;
    readonly environment: Readonly<Record<string, string | undefined>>;
    readonly id: string;
    readonly kind: ProviderKind;
    readonly maxOutputTokens: number | undefined;
    readonly model: string;
    readonly transport: LiveProviderTransport | undefined;
} {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError("live provider definition must be an object");
    }
    const allowed = [
        "credential",
        "endpoint",
        "environment",
        "id",
        "kind",
        "maxOutputTokens",
        "model",
        "transport",
    ];
    if (Object.keys(value).some((key) => !allowed.includes(key))) {
        throw new TypeError("live provider definition must contain only its declared fields");
    }
    const definition = value as Partial<LiveProviderDefinition>;
    if (typeof definition.kind !== "string" || !Object.hasOwn(live.kinds, definition.kind)) {
        throw new TypeError("live provider kind is not a configured live kind");
    }
    for (const [key, text] of [
        ["id", definition.id],
        ["model", definition.model],
    ] as const) {
        if (!isWellFormedText(text)) {
            throw new TypeError(`live provider ${key} must be a non-empty well-formed string`);
        }
    }
    if (
        definition.credential !== undefined &&
        (typeof definition.credential !== "string" || definition.credential.trim().length === 0)
    ) {
        throw new TypeError("live provider credential must be a non-empty string");
    }
    if (definition.endpoint !== undefined && URL.parse(String(definition.endpoint)) === null) {
        throw new TypeError("live provider endpoint must be an absolute URL");
    }
    if (
        definition.maxOutputTokens !== undefined &&
        (!Number.isSafeInteger(definition.maxOutputTokens) || definition.maxOutputTokens < 1)
    ) {
        throw new TypeError("live provider maxOutputTokens must be a positive safe integer");
    }
    if (definition.transport !== undefined && typeof definition.transport !== "function") {
        throw new TypeError("live provider transport must be a function");
    }
    if (
        definition.environment !== undefined &&
        (definition.environment === null || typeof definition.environment !== "object")
    ) {
        throw new TypeError("live provider environment must be an object");
    }
    return {
        credential: definition.credential,
        endpoint: definition.endpoint,
        environment: definition.environment ?? process.env,
        id: definition.id as string,
        kind: definition.kind,
        maxOutputTokens: definition.maxOutputTokens,
        model: definition.model as string,
        transport: definition.transport,
    };
}
