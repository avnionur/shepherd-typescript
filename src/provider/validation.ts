import type { SemanticRecord, SemanticValue } from "../canonical/canonical-record.ts";
import { createCanonicalSnapshot } from "../canonical/snapshot.ts";
import { providerProtocolConfig } from "../protocol/config.ts";
import { readRunArtifactPayloadDefinition } from "../run/artifact-validation.ts";
import type {
    ModelArtifactDefinition,
    ModelRequest,
    ModelResponse,
    ModelUsage,
    ProviderDescriptor,
    StaticProviderDefinition,
    StaticProviderDescriptorDefinition,
    StaticProviderExchange,
} from "./types.ts";

/** Validates and snapshots one provider-neutral descriptor. @internal */
export function readProviderDescriptor(value: unknown): ProviderDescriptor {
    const fields = readDataObject(
        value,
        ["capabilities", "id", "kind", "model"],
        "provider descriptor",
    );
    const capabilities = readDataObject(
        fields.capabilities,
        ["streaming", "structuredOutput", "tools"],
        "provider descriptor capabilities",
    );
    if (
        ![capabilities.streaming, capabilities.structuredOutput, capabilities.tools].every(
            (capability) => typeof capability === "boolean",
        )
    ) {
        throw new TypeError("provider descriptor capabilities must be booleans");
    }
    if (!providerProtocolConfig.kinds.includes(fields.kind as string)) {
        throw new TypeError("provider descriptor kind is not configured");
    }
    return Object.freeze({
        capabilities: Object.freeze({
            streaming: capabilities.streaming as boolean,
            structuredOutput: capabilities.structuredOutput as boolean,
            tools: capabilities.tools as boolean,
        }),
        id: readNonEmptyString(fields.id, "provider descriptor id"),
        kind: fields.kind as ProviderDescriptor["kind"],
        model:
            fields.model === null
                ? null
                : readNonEmptyString(fields.model, "provider descriptor model"),
    });
}

/** Validates and snapshots one complete static-provider definition. @internal */
export function readStaticProviderDefinition(value: unknown): StaticProviderDefinition {
    const fields = readDataObject(value, ["descriptor", "exchanges"], "static provider definition");
    return Object.freeze({
        descriptor: readDescriptor(fields.descriptor),
        exchanges: Object.freeze(
            readDataArray(fields.exchanges, "static provider exchanges").map((exchange, index) =>
                readExchange(exchange, index),
            ),
        ),
    });
}

/** Validates and snapshots one provider-neutral request. @internal */
export function readModelRequest(value: unknown): ModelRequest {
    const fields = readDataObject(value, ["input", "instruction", "outputSchema"], "model request");
    return Object.freeze({
        input: snapshotSemanticValue(fields.input, "model request input"),
        instruction: readNonEmptyString(fields.instruction, "model request instruction"),
        outputSchema: snapshotSemanticRecord(fields.outputSchema, "model request outputSchema"),
    });
}

/** Validates one caller cancellation signal. @internal */
export function readProviderSignal(value: unknown): AbortSignal {
    if (!(value instanceof AbortSignal)) {
        throw new TypeError("provider signal must be an AbortSignal");
    }
    return value;
}

function readDescriptor(value: unknown): StaticProviderDescriptorDefinition {
    const fields = readDataObject(value, ["id", "model"], "static provider descriptor");
    return Object.freeze({
        id: readNonEmptyString(fields.id, "static provider descriptor id"),
        model: readNonEmptyString(fields.model, "static provider descriptor model"),
    });
}

function readExchange(value: unknown, index: number): StaticProviderExchange {
    const fields = readDataObject(
        value,
        ["request", "response"],
        `static provider exchange[${index}]`,
    );
    return Object.freeze({
        request: readModelRequest(fields.request),
        response: readModelResponse(fields.response, `static provider exchange[${index}] response`),
    });
}

/** Validates and snapshots one provider-neutral response. @internal */
export function readModelResponse(value: unknown, subject = "model response"): ModelResponse {
    const includesArtifacts =
        value !== null && typeof value === "object" && Object.hasOwn(value, "artifacts");
    const fields = readDataObject(
        value,
        includesArtifacts ? ["artifacts", "output", "usage"] : ["output", "usage"],
        subject,
    );
    return Object.freeze({
        ...(includesArtifacts
            ? { artifacts: readModelArtifacts(fields.artifacts, `${subject} artifacts`) }
            : {}),
        output: snapshotSemanticValue(fields.output, `${subject} output`),
        usage: readModelUsage(fields.usage, subject),
    });
}

function readModelArtifacts(value: unknown, subject: string): readonly ModelArtifactDefinition[] {
    const artifacts = readDataArray(value, subject).map((candidate, index) =>
        readRunArtifactPayloadDefinition(candidate, `${subject}[${index}]`),
    );
    return Object.freeze(artifacts);
}

function readModelUsage(value: unknown, subject: string): ModelUsage {
    const fields = readDataObject(
        value,
        [
            "cacheCreationInputTokens",
            "cacheReadInputTokens",
            "costUsd",
            "inputTokens",
            "outputTokens",
        ],
        `${subject} usage`,
    );
    return Object.freeze({
        cacheCreationInputTokens: readNonNegativeInteger(
            fields.cacheCreationInputTokens,
            `${subject} usage cacheCreationInputTokens`,
        ),
        cacheReadInputTokens: readNonNegativeInteger(
            fields.cacheReadInputTokens,
            `${subject} usage cacheReadInputTokens`,
        ),
        costUsd: readNullableCost(fields.costUsd, `${subject} usage costUsd`),
        inputTokens: readNonNegativeInteger(fields.inputTokens, `${subject} usage inputTokens`),
        outputTokens: readNonNegativeInteger(fields.outputTokens, `${subject} usage outputTokens`),
    });
}

function snapshotSemanticRecord(value: unknown, subject: string): SemanticRecord {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError(`${subject} must be a canonical semantic record`);
    }
    return snapshotSemanticValue(value, subject) as SemanticRecord;
}

function snapshotSemanticValue(value: unknown, subject: string): SemanticValue {
    if (value === undefined) {
        throw new TypeError(`${subject} must be a canonical semantic value`);
    }
    try {
        return createCanonicalSnapshot({ value: value as SemanticValue }).value as SemanticValue;
    } catch (error) {
        throw new TypeError(`${subject} must be a canonical semantic value`, { cause: error });
    }
}

function readNonEmptyString(value: unknown, subject: string): string {
    if (typeof value !== "string" || value.length === 0 || /[\uD800-\uDFFF]/u.test(value)) {
        throw new TypeError(`${subject} must be a non-empty well-formed string`);
    }
    return value;
}

function readNonNegativeInteger(value: unknown, subject: string): number {
    if (!Number.isSafeInteger(value) || (value as number) < 0) {
        throw new TypeError(`${subject} must be a non-negative safe integer`);
    }
    return value as number;
}

function readNullableCost(value: unknown, subject: string): number | null {
    if (value === null) {
        return null;
    }
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        throw new TypeError(`${subject} must be null or a non-negative finite number`);
    }
    return value;
}

function readDataArray(value: unknown, subject: string): readonly unknown[] {
    if (!Array.isArray(value) || Object.getOwnPropertySymbols(value).length > 0) {
        throw new TypeError(`${subject} must be a dense data array`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const allowedKeys = new Set(["length"]);
    const result: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
        const key = String(index);
        allowedKeys.add(key);
        const descriptor = descriptors[key];
        if (descriptor === undefined || !("value" in descriptor)) {
            throw new TypeError(`${subject}[${index}] must be a data element`);
        }
        result.push(descriptor.value);
    }
    if (Object.keys(descriptors).some((key) => !allowedKeys.has(key))) {
        throw new TypeError(`${subject} must not contain custom properties`);
    }
    return result;
}

function readDataObject(
    value: unknown,
    keys: readonly string[],
    subject: string,
): Record<string, unknown> {
    if (
        value === null ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        (Object.getPrototypeOf(value) !== Object.prototype &&
            Object.getPrototypeOf(value) !== null) ||
        Object.getOwnPropertySymbols(value).length > 0
    ) {
        throw new TypeError(`${subject} must be a plain data object`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (
        Object.keys(descriptors).length !== keys.length ||
        keys.some((key) => descriptors[key] === undefined)
    ) {
        throw new TypeError(`${subject} must contain exactly its declared fields`);
    }
    const result = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
        const descriptor = descriptors[key];
        if (descriptor === undefined || !("value" in descriptor)) {
            throw new TypeError(`${subject} ${key} must be a data property`);
        }
        result[key] = descriptor.value;
    }
    return result;
}
