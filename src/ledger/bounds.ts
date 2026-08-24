import { canonicalizeSemanticValue, type SemanticValue } from "../canonical/canonical-record.ts";
import { projectionProtocolConfig } from "../protocol/config.ts";
import type { LedgerListOptions } from "./types.ts";

type LedgerBoundPolicy = {
    readonly defaultPageSize: number;
    readonly maxPageSize: number;
    readonly maxSelectorBytes: number;
};

/** Reads one closed bounded pagination container. @internal */
export function readLedgerListOptions(
    value: LedgerListOptions | undefined,
    policy: LedgerBoundPolicy = projectionProtocolConfig.taskRunLedgers,
): {
    readonly limit: number;
    readonly offset: number;
} {
    if (value === undefined) return { limit: policy.defaultPageSize, offset: 0 };
    if (
        value === null ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
        Reflect.ownKeys(value).some((key) => typeof key === "symbol") ||
        Object.keys(value).some((key) => key !== "limit" && key !== "offset")
    ) {
        throw new TypeError("ledger list options must be a closed pagination object");
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (
        Object.values(descriptors).some((descriptor) => !("value" in descriptor)) ||
        (descriptors.limit !== undefined &&
            (!Number.isSafeInteger(descriptors.limit.value) ||
                Number(descriptors.limit.value) <= 0 ||
                Number(descriptors.limit.value) > policy.maxPageSize)) ||
        (descriptors.offset !== undefined &&
            (!Number.isSafeInteger(descriptors.offset.value) ||
                Number(descriptors.offset.value) < 0))
    ) {
        throw new TypeError("ledger list options exceed configured pagination bounds");
    }
    return {
        limit:
            descriptors.limit === undefined
                ? policy.defaultPageSize
                : Number(descriptors.limit.value),
        offset: descriptors.offset === undefined ? 0 : Number(descriptors.offset.value),
    };
}

/** Validates and bounds one configured read selector. @internal */
export function readLedgerSelector(
    value: unknown,
    subject: string,
    policy: LedgerBoundPolicy = projectionProtocolConfig.taskRunLedgers,
): string {
    if (
        typeof value !== "string" ||
        value.length === 0 ||
        /\s/u.test(value) ||
        Buffer.byteLength(value) > policy.maxSelectorBytes
    ) {
        throw new TypeError(`${subject} must be a bounded non-empty string without whitespace`);
    }
    return value;
}

/** Rejects a projection entry exceeding the configured canonical JSON bound. @internal */
export function assertLedgerEntryBounded(
    value: object,
    maximumBytes = projectionProtocolConfig.taskRunLedgers.maxCanonicalEntryBytes,
): void {
    const canonical = canonicalizeSemanticValue(value as unknown as SemanticValue);
    if (Buffer.byteLength(canonical) > maximumBytes) {
        throw new TypeError("ledger projection entry exceeds its configured canonical JSON bound");
    }
}
