import type { SemanticRecord, SemanticValue } from "../canonical/canonical-record.ts";
import type { PROVIDER_KINDS } from "../protocol/config-types.ts";
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

/** Configured provider-kind vocabulary implemented by provider protocol v1. */
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
