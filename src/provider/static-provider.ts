import { canonicalizeRecord, type SemanticRecord } from "../canonical/canonical-record.ts";
import { providerProtocolConfig } from "../protocol/config.ts";
import { StaticProviderExhaustedError, StaticProviderRequestMismatchError } from "./errors.ts";
import type {
    ModelProvider,
    ModelRequest,
    ModelResponse,
    ProviderDescriptor,
    StaticProviderDefinition,
} from "./types.ts";
import {
    readModelRequest,
    readProviderSignal,
    readStaticProviderDefinition,
} from "./validation.ts";

/**
 * Creates a deterministic offline provider backed by exact cassette exchanges.
 *
 * @param definition - Provider identity and ordered request/response exchanges.
 * @returns A single-pass provider-neutral model provider.
 * @throws {TypeError} If the definition is not canonical provider data.
 *
 * @example
 * ```ts
 * const provider = createStaticProvider({
 *     descriptor: { id: "offline-docs", model: "fixture-v1" },
 *     exchanges: [{ request, response }],
 * });
 * await provider.invoke(request, new AbortController().signal);
 * ```
 *
 * @public
 */
export function createStaticProvider(definition: StaticProviderDefinition): ModelProvider {
    const snapshot = readStaticProviderDefinition(definition);
    const descriptor = createDescriptor(snapshot);
    let nextExchange = 0;
    return Object.freeze({
        descriptor: (): ProviderDescriptor => descriptor,
        invoke: async (request: ModelRequest, signal: AbortSignal): Promise<ModelResponse> => {
            readProviderSignal(signal).throwIfAborted();
            const exchange = snapshot.exchanges[nextExchange];
            if (exchange === undefined) {
                throw new StaticProviderExhaustedError(nextExchange);
            }
            const requestSnapshot = readModelRequest(request);
            if (canonicalRequest(requestSnapshot) !== canonicalRequest(exchange.request)) {
                throw new StaticProviderRequestMismatchError(nextExchange);
            }
            nextExchange += 1;
            return exchange.response;
        },
    });
}

function createDescriptor(definition: StaticProviderDefinition): ProviderDescriptor {
    return Object.freeze({
        capabilities: providerProtocolConfig.static.capabilities,
        id: definition.descriptor.id,
        kind: providerProtocolConfig.static.kind,
        model: definition.descriptor.model,
    });
}

function canonicalRequest(request: ModelRequest): string {
    return canonicalizeRecord(request as unknown as SemanticRecord);
}
