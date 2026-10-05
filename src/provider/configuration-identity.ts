import { createRecordId, type SemanticRecord } from "../canonical/canonical-record.ts";
import type { ConversationalModelProvider } from "./types.ts";

const identities = new WeakMap<object, string>();

/** Binds a factory provider to non-credential configuration without retaining its plaintext. @internal */
export function registerProviderConfiguration(
    provider: ConversationalModelProvider,
    configuration: SemanticRecord,
): ConversationalModelProvider {
    identities.set(provider, createRecordId(configuration));
    return provider;
}

/** Reads only the package factory's opaque non-credential configuration digest. @internal */
export function readProviderConfiguration(
    provider: ConversationalModelProvider,
): string | undefined {
    return identities.get(provider);
}
