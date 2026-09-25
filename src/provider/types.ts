import type { SemanticRecord, SemanticValue } from "../canonical/canonical-record.ts";
import type {
    MODEL_CONTENT_BLOCK_TYPES,
    MODEL_MESSAGE_ROLES,
    PROVIDER_KINDS,
} from "../protocol/values.generated.ts";
import type { ReplayProviderSessionAdapter, ReplayStepInspection } from "../replay/types.ts";
import type { RunArtifactContentDefinition } from "../run/artifact-types.ts";

/** One side-channel artifact emitted with a provider response. */
export type ModelArtifactDefinition = {
    /** Inline text or an existing durable blob receipt. */
    readonly content: RunArtifactContentDefinition;
    /** Application-defined artifact family. */
    readonly kind: string;
    /** Canonical provider-specific metadata. */
    readonly metadata: SemanticRecord;
    /** Caller-visible artifact name. */
    readonly name: string;
};

/** Configured provider-kind vocabulary: static, program, and every configured live kind. */
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

/** Provider capabilities visible to provider-neutral execution code. */
export type ProviderCapabilities = {
    /** Whether the provider exposes streaming responses. */
    readonly streaming: boolean;
    /** Whether the provider returns structured values. */
    readonly structuredOutput: boolean;
    /** Whether the provider can invoke tools. */
    readonly tools: boolean;
};

/** Immutable identity and capabilities of one model provider. */
export type ProviderDescriptor = {
    /** Capabilities supported by this provider. */
    readonly capabilities: ProviderCapabilities;
    /** Caller-selected provider instance identity. */
    readonly id: string;
    /** Configured provider-kind discriminant. */
    readonly kind: ProviderKind;
    /** Provider-specific model identity, or `null` when no model applies. */
    readonly model: string | null;
};

/** Descriptor fields accepted by {@link createStaticProvider}. */
export type StaticProviderDescriptorDefinition = {
    /** Caller-selected provider instance identity. */
    readonly id: string;
    /** Provider-specific model identity. */
    readonly model: string;
};

/** Provider-neutral request for one structured model invocation. */
export type ModelRequest = {
    /** Canonical task or application input. */
    readonly input: SemanticValue;
    /** Behavioral instruction sent to the provider. */
    readonly instruction: string;
    /** Canonical JSON Schema describing the required output. */
    readonly outputSchema: SemanticRecord;
};

/** Usage measured for one provider invocation. */
export type ModelUsage = {
    /** Tokens written into provider caches. */
    readonly cacheCreationInputTokens: number;
    /** Tokens read from provider caches. */
    readonly cacheReadInputTokens: number;
    /** Invocation cost in US dollars, or `null` when unavailable. */
    readonly costUsd: number | null;
    /** Input tokens consumed by the invocation. */
    readonly inputTokens: number;
    /** Output tokens produced by the invocation. */
    readonly outputTokens: number;
};

/** Provider-neutral response from one structured model invocation. */
export type ModelResponse = {
    /** Ordered side-channel artifacts emitted with the response. */
    readonly artifacts?: readonly ModelArtifactDefinition[];
    /** Canonical structured output returned by the provider. */
    readonly output: SemanticValue;
    /** Resource usage measured for this invocation. */
    readonly usage: ModelUsage;
};

/** One exact deterministic request and its configured response. */
export type StaticProviderExchange = {
    /** Exact request admitted at this cassette position. */
    readonly request: ModelRequest;
    /** Response returned for the exact request. */
    readonly response: ModelResponse;
};

/** Definition accepted by {@link createStaticProvider}. */
export type StaticProviderDefinition = {
    /** Public static-provider identity. */
    readonly descriptor: StaticProviderDescriptorDefinition;
    /** Ordered deterministic request/response cassette. */
    readonly exchanges: readonly StaticProviderExchange[];
};

/** Provider-neutral structured invocation boundary. */
export type ModelProvider = {
    /** @returns The immutable provider identity and capability declaration. */
    readonly descriptor: () => ProviderDescriptor;
    /**
     * Invokes the provider for one structured request.
     *
     * @param request - Provider-neutral instruction, input, and output contract.
     * @param signal - Cooperative caller cancellation signal.
     * @returns The immutable provider response.
     * @throws {TypeError} If the request or signal is malformed.
     * @throws A provider-specific invocation error when execution fails.
     * @throws The signal's reason when it is already aborted.
     */
    readonly invoke: (request: ModelRequest, signal: AbortSignal) => Promise<ModelResponse>;
};

/** Configured provider-neutral message role. */
export type ModelMessageRole = (typeof MODEL_MESSAGE_ROLES)[number];

/** Configured provider-neutral content block type. */
export type ModelContentBlockType = (typeof MODEL_CONTENT_BLOCK_TYPES)[number];

/** One text content block of a provider-neutral message. */
export type ModelTextBlock = {
    /** Exact text sent to or returned by the provider. */
    readonly text: string;
    /** Configured text block discriminant. */
    readonly type: (typeof MODEL_CONTENT_BLOCK_TYPES)[0];
};

/** One tool call requested by the model in an assistant message. */
export type ModelToolUseBlock = {
    /** Provider-assigned call identity that the correlated tool result cites. */
    readonly id: string;
    /** Canonical tool input object. */
    readonly input: SemanticRecord;
    /** Name of the called tool. */
    readonly name: string;
    /** Configured tool-use block discriminant. */
    readonly type: (typeof MODEL_CONTENT_BLOCK_TYPES)[1];
};

/** One tool result returned to the model in a user message. */
export type ModelToolResultBlock = {
    /** Result text sent to the model. */
    readonly content: string;
    /** Whether the tool call was refused or failed. */
    readonly isError: boolean;
    /** Configured tool-result block discriminant. */
    readonly type: (typeof MODEL_CONTENT_BLOCK_TYPES)[2];
    /** Identity of the tool-use block this result answers. */
    readonly toolUseId: string;
};

/**
 * One content block of a provider-neutral message: text, a model tool call (assistant messages
 * only), or a tool result (user messages only).
 */
export type ModelContentBlock = ModelTextBlock | ModelToolUseBlock | ModelToolResultBlock;

/** One tool offered to the model in a multi-turn request. */
export type ModelToolDefinition = {
    /** Description sent to the model. */
    readonly description: string;
    /** Canonical JSON Schema of the tool input object. */
    readonly inputSchema: SemanticRecord;
    /** Tool name the model calls. */
    readonly name: string;
};

/** One provider-neutral conversation message. */
export type ModelMessage = {
    /** Ordered content blocks. */
    readonly content: readonly ModelContentBlock[];
    /** Configured message role. */
    readonly role: ModelMessageRole;
};

/** Provider-neutral multi-turn request sent through {@link ConversationalModelProvider.converse}. */
export type ModelConversationRequest = {
    /**
     * Number of leading messages forming the reusable prompt-cache prefix. A provider whose kind
     * configures a cache-control marker places it on the last content block of the last prefix
     * message; `0` places none.
     */
    readonly cachePrefixMessages: number;
    /** Ordered conversation messages; the first is a user message. */
    readonly messages: readonly ModelMessage[];
    /** Canonical output JSON Schema, or null for unstructured text output. */
    readonly outputSchema: SemanticRecord | null;
    /** Stable system prompt, or null. */
    readonly system: string | null;
    /** Tools offered to the model; omitted or empty offers none. */
    readonly tools?: readonly ModelToolDefinition[];
};

/** Provider-neutral response of one multi-turn request. */
export type ModelConversationResponse = {
    /** Assistant message exactly as the provider returned its content. */
    readonly message: ModelMessage;
    /**
     * Parsed structured output, or the response text when the request had no output schema; null
     * when the turn requests tool calls.
     */
    readonly output: SemanticValue;
    /** Provider stop reason: a configured complete or tool-use stop reason of the kind. */
    readonly stopReason: string;
    /** Normalized usage including prompt-cache read and creation tokens. */
    readonly usage: ModelUsage;
};

/** Model provider that also accepts multi-turn message-list requests. */
export type ConversationalModelProvider = ModelProvider & {
    /**
     * Sends one multi-turn request.
     *
     * @param request - Message list, cache prefix length, output schema, and system prompt.
     * @param signal - Cooperative caller cancellation signal observed while the request is pending.
     * @returns The assistant message, parsed output, stop reason, and usage.
     * @throws {TypeError} If the request or signal is malformed.
     * @throws {LiveProviderError} If the credential, transport, HTTP status, or response fails.
     * @throws The signal's reason when it aborts before the response arrives.
     */
    readonly converse: (
        request: ModelConversationRequest,
        signal: AbortSignal,
    ) => Promise<ModelConversationResponse>;
};

/** One HTTP request a live provider hands to its transport. */
export type LiveProviderHttpRequest = {
    /** Exact serialized JSON request body. */
    readonly body: string;
    /** Request headers, including the credential header. */
    readonly headers: Readonly<Record<string, string>>;
    /** Absolute request URL. */
    readonly url: string;
};

/** One HTTP response returned by a live provider transport. */
export type LiveProviderHttpResponse = {
    /** Response body text. */
    readonly body: string;
    /** HTTP status code. */
    readonly status: number;
};

/**
 * Injectable HTTP transport of a live provider. The default posts with the global `fetch`.
 *
 * @param request - Serialized request with headers.
 * @param signal - Cancellation signal the transport must observe while pending.
 * @returns The response status and body text.
 */
export type LiveProviderTransport = (
    request: LiveProviderHttpRequest,
    signal: AbortSignal,
) => Promise<LiveProviderHttpResponse>;

/** Definition accepted by {@link createLiveProvider}. */
export type LiveProviderDefinition = {
    /**
     * Credential supplied from caller configuration. When absent the provider reads the kind's
     * configured environment variable. The credential is held only in the provider closure.
     */
    readonly credential?: string;
    /** Absolute endpoint overriding the kind's configured endpoint. */
    readonly endpoint?: string;
    /** Environment read for the credential; defaults to `process.env`. */
    readonly environment?: Readonly<Record<string, string | undefined>>;
    /** Caller-selected provider instance identity. */
    readonly id: string;
    /** Configured live provider kind. */
    readonly kind: ProviderKind;
    /** Maximum output tokens overriding the kind's configured default. */
    readonly maxOutputTokens?: number;
    /** Provider model identity. */
    readonly model: string;
    /** HTTP transport; defaults to the global `fetch`. */
    readonly transport?: LiveProviderTransport;
};

/** Definition accepted by {@link createProviderConversation}. */
export type ProviderConversationDefinition = {
    /** Stable provider-session adapter identity retained in replay evidence. */
    readonly adapterId: string;
    /** Conversational provider that receives every turn. */
    readonly provider: ConversationalModelProvider;
    /** Stable system prompt sent with every turn. */
    readonly system?: string;
};

/** Stateful multi-turn conversation bound to a replay provider-session adapter. */
export type ProviderConversation = {
    /** @returns The chained context prefix identity of the held conversation, or null. */
    readonly contextPrefixId: () => string | null;
    /** @returns The held conversation messages, oldest first. */
    readonly messages: () => readonly ModelMessage[];
    /**
     * Model provider that sends each request as the next user turn over the held conversation
     * and appends the canonical assistant turn after a successful response.
     */
    readonly provider: ModelProvider;
    /**
     * Rebuilds the held conversation from retained replay steps, for example after a process
     * restart or a step-count target without a verified provider-session receipt.
     *
     * @param steps - Retained steps of one session prefix in index order.
     * @throws {TypeError} If the steps are not a well-formed session prefix.
     */
    readonly rebuild: (steps: readonly ReplayStepInspection[]) => void;
    /** Provider-session adapter capturing and restoring the held conversation. */
    readonly session: ReplayProviderSessionAdapter;
};

/** Definition accepted by {@link createProgramConversationProvider}. */
export type ProgramConversationProviderDefinition = {
    /** Caller-selected provider instance identity. */
    readonly id: string;
    /** Provider-specific model identity, or omitted when none applies. */
    readonly model?: string;
    /**
     * Deterministic caller program answering one multi-turn request, for example a scripted
     * meta-agent that emits tool calls.
     *
     * @param request - Validated immutable multi-turn request, including offered tools.
     * @param signal - Cooperative cancellation signal.
     * @returns The assistant message, output, stop reason, and usage.
     */
    readonly respond: (
        request: ModelConversationRequest,
        signal: AbortSignal,
    ) => ModelConversationResponse | Promise<ModelConversationResponse>;
};
