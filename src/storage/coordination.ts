import { storageProtocolConfig } from "../protocol/config.ts";
import {
    STORAGE_DURABILITIES,
    STORAGE_LEASE_STATUSES,
    STORAGE_REF_SWAP_STATUSES,
} from "../protocol/values.generated.ts";
import type {
    StorageDurability,
    StorageFence,
    StorageLease,
    StorageLeaseAcquireResult,
    StorageLeaseReleaseResult,
    StorageLeaseRenewResult,
    StorageRef,
    StorageRefSwapResult,
} from "./types.ts";

const [ACQUIRED, HELD, RENEWED, RELEASED, LEASE_FENCED] = STORAGE_LEASE_STATUSES;
const [SWAPPED, CONFLICT, SWAP_FENCED] = STORAGE_REF_SWAP_STATUSES;
const namePattern = new RegExp(storageProtocolConfig.names.pattern, "u");

/** Durability every durable reference adapter declares. @internal */
export const DURABLE_STORAGE: StorageDurability = STORAGE_DURABILITIES[0];

/** Durability every in-memory reference adapter declares. @internal */
export const VOLATILE_STORAGE: StorageDurability = STORAGE_DURABILITIES[1];

/** A decided transition: the result to return and the record to persist, if any. @internal */
export type StorageDecision<Result, Next> = {
    readonly next?: Next;
    readonly result: Result;
};

/** Runs a synchronous operation and reports its value or failure through a promise. @internal */
export function settle<T>(operation: () => T): Promise<T> {
    try {
        return Promise.resolve(operation());
    } catch (error) {
        return Promise.reject(error);
    }
}

/**
 * Validates a reference name or lease key against the configured grammar.
 *
 * @throws {TypeError} If the value is not a configured storage name.
 * @internal
 */
export function assertStorageName(value: unknown, subject: string): asserts value is string {
    if (
        typeof value !== "string" ||
        value.length > storageProtocolConfig.names.maxLength ||
        !namePattern.test(value)
    ) {
        throw new TypeError(`${subject} must match the configured storage name grammar`);
    }
}

/** Validates a bounded reference value. @internal */
export function assertRefValue(value: unknown): asserts value is string {
    if (typeof value !== "string" || value.length > storageProtocolConfig.refs.maxValueLength) {
        throw new TypeError("value must be a string within the configured length bound");
    }
}

/** Validates a non-negative safe-integer generation or clock value. @internal */
export function assertNonNegativeInteger(value: unknown, subject: string): asserts value is number {
    if (!Number.isSafeInteger(value) || (value as number) < 0) {
        throw new TypeError(`${subject} must be a non-negative safe integer`);
    }
}

/** Validates a lease owner identity. @internal */
export function assertLeaseOwner(value: unknown): asserts value is string {
    if (
        typeof value !== "string" ||
        value.length === 0 ||
        value.length > storageProtocolConfig.leases.maxOwnerLength
    ) {
        throw new TypeError("owner must be a non-empty string within the configured bound");
    }
}

/** Validates a positive safe-integer fencing token. @internal */
export function assertFencingToken(value: unknown): asserts value is number {
    if (!Number.isSafeInteger(value) || (value as number) <= 0) {
        throw new TypeError("fencingToken must be a positive safe integer");
    }
}

/** Validates a lease time-to-live against the configured bounds and a safe expiry. @internal */
export function assertLeaseTiming(ttlMilliseconds: unknown, nowMilliseconds: unknown): void {
    const { maxTtlMilliseconds, minTtlMilliseconds } = storageProtocolConfig.leases;
    if (
        !Number.isSafeInteger(ttlMilliseconds) ||
        (ttlMilliseconds as number) < minTtlMilliseconds ||
        (ttlMilliseconds as number) > maxTtlMilliseconds
    ) {
        throw new TypeError("ttlMilliseconds must be within the configured lease bounds");
    }
    assertNonNegativeInteger(nowMilliseconds, "nowMilliseconds");
    if (!Number.isSafeInteger((nowMilliseconds as number) + (ttlMilliseconds as number))) {
        throw new TypeError("lease expiry exceeds safe integer bounds");
    }
}

/** Validates an optional swap fence. @internal */
export function assertOptionalFence(fence: unknown): asserts fence is StorageFence | undefined {
    if (fence === undefined) {
        return;
    }
    if (fence === null || typeof fence !== "object") {
        throw new TypeError("fence must be an object when present");
    }
    const candidate = fence as Partial<StorageFence>;
    assertStorageName(candidate.key, "fence.key");
    assertLeaseOwner(candidate.owner);
    assertFencingToken(candidate.fencingToken);
    assertNonNegativeInteger(candidate.now, "fence.now");
}

/** Reports whether a lease record is the exact unexpired grant a fence names. @internal */
export function isFenceCurrent(current: StorageLease | undefined, fence: StorageFence): boolean {
    return (
        current !== undefined &&
        current.owner === fence.owner &&
        current.fencingToken === fence.fencingToken &&
        fence.now < current.expiresAt
    );
}

/** Decides one reference swap from the current reference and fence authority. @internal */
export function decideSwap(
    current: StorageRef | undefined,
    name: string,
    expectedGeneration: number,
    value: string,
    fenced: boolean,
): StorageDecision<StorageRefSwapResult, StorageRef> {
    if (fenced) {
        return { result: Object.freeze({ status: SWAP_FENCED }) };
    }
    const generation = current?.generation ?? 0;
    if (generation !== expectedGeneration) {
        return { result: Object.freeze({ current, status: CONFLICT }) };
    }
    const ref = Object.freeze({ generation: generation + 1, name, value });
    return { next: ref, result: Object.freeze({ ref, status: SWAPPED }) };
}

/** Decides one lease acquisition from the current record. @internal */
export function decideAcquire(
    current: StorageLease | undefined,
    key: string,
    owner: string,
    ttlMilliseconds: number,
    nowMilliseconds: number,
): StorageDecision<StorageLeaseAcquireResult, StorageLease> {
    if (current !== undefined && nowMilliseconds < current.expiresAt) {
        return current.owner === owner
            ? { result: Object.freeze({ lease: current, status: ACQUIRED }) }
            : { result: Object.freeze({ lease: current, status: HELD }) };
    }
    const lease = Object.freeze({
        expiresAt: nowMilliseconds + ttlMilliseconds,
        fencingToken: (current?.fencingToken ?? 0) + 1,
        key,
        owner,
    });
    return { next: lease, result: Object.freeze({ lease, status: ACQUIRED }) };
}

/** Decides one lease renewal from the current record. @internal */
export function decideRenew(
    current: StorageLease | undefined,
    owner: string,
    fencingToken: number,
    ttlMilliseconds: number,
    nowMilliseconds: number,
): StorageDecision<StorageLeaseRenewResult, StorageLease> {
    if (
        current === undefined ||
        !isFenceCurrent(current, { fencingToken, key: current.key, now: nowMilliseconds, owner })
    ) {
        return { result: Object.freeze({ status: LEASE_FENCED }) };
    }
    const lease = Object.freeze({ ...current, expiresAt: nowMilliseconds + ttlMilliseconds });
    return { next: lease, result: Object.freeze({ lease, status: RENEWED }) };
}

/** Decides one lease release from the current record. @internal */
export function decideRelease(
    current: StorageLease | undefined,
    owner: string,
    fencingToken: number,
): StorageDecision<StorageLeaseReleaseResult, StorageLease> {
    if (current === undefined || current.owner !== owner || current.fencingToken !== fencingToken) {
        return { result: Object.freeze({ status: LEASE_FENCED }) };
    }
    return {
        next: Object.freeze({ ...current, expiresAt: 0 }),
        result: Object.freeze({ status: RELEASED }),
    };
}
