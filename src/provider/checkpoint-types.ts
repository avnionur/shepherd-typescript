import type { RecordId } from "../record/types.ts";
import type { ModelMessage, ModelToolDefinition, ProviderDescriptor } from "./types.ts";

/** Exact conversation prefix retained without provider credentials or transport handles. */
export type ProviderConversationCheckpointState = {
    /** Chained replay context identity, or null before any exchange. */
    readonly contextPrefixId: string | null;
    /** Exact ordered messages, including native tool-use and tool-result blocks. */
    readonly messages: readonly ModelMessage[];
    /** Exact system prompt, or null. */
    readonly system: string | null;
    /** Exact ordered tool definitions offered with this prefix. */
    readonly tools: readonly ModelToolDefinition[];
};

/** Host-declared identity required to retain or read one provider checkpoint. */
export type ProviderConversationCheckpointBinding = {
    /** Stable provider-session adapter identity. */
    readonly adapterId: string;
    /** Non-secret provider/configuration version identity; credentials must never be supplied here. */
    readonly configurationId: string;
    /** Exact validated provider descriptor; no credential or transport fields are accepted. */
    readonly provider: ProviderDescriptor;
};

/** Complete prefix and its exact provider/configuration binding. */
export type RetainProviderConversationCheckpointOptions = ProviderConversationCheckpointBinding & {
    /** Immutable prefix to retain under the store's scanning and retention policy. */
    readonly state: ProviderConversationCheckpointState;
};

/** Exact receipt plus the identity and context the caller expects to restore. */
export type ReadProviderConversationCheckpointOptions = ProviderConversationCheckpointBinding & {
    /** Content-addressed retained receipt. */
    readonly receiptId: string;
    /** Expected source context prefix; mismatch refuses before returning state. */
    readonly contextPrefixId: string | null;
};

/** Durable snapshot identity and its canonical causal citation. */
export type ProviderConversationCheckpointReceipt = {
    /** Opaque exact receipt used for read or restoration. */
    readonly receiptId: string;
    /** Canonical record identity required in retained replay checkpoint evidence. */
    readonly recordId: RecordId;
};
