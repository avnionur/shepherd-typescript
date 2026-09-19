import {
    assertFencingToken,
    assertLeaseOwner,
    assertLeaseTiming,
    assertNonNegativeInteger,
    assertOptionalFence,
    assertRefValue,
    assertStorageName,
    decideAcquire,
    decideRelease,
    decideRenew,
    decideSwap,
    isFenceCurrent,
    settle,
    VOLATILE_STORAGE,
} from "./coordination.ts";
import type {
    StorageCoordinator,
    StorageFence,
    StorageLease,
    StorageLeaseAcquireResult,
    StorageLeaseReleaseResult,
    StorageLeaseRenewResult,
    StorageRef,
    StorageRefSwapResult,
} from "./types.ts";

/**
 * Creates a volatile in-process storage coordinator.
 *
 * It implements every `StorageCoordinator` law for callers sharing one JavaScript realm: each
 * operation is decided and applied synchronously before its promise settles, so concurrent calls
 * are serialized by the event loop. It is a reference and test double; state is lost with the
 * object and is not shared across processes.
 *
 * @returns A coordinator declaring `volatile` durability.
 * @example
 * ```ts
 * const coordinator = createMemoryStorageCoordinator();
 * const { status } = await coordinator.compareAndSwapRef("heads/main", 0, "sha256:...");
 * ```
 */
export function createMemoryStorageCoordinator(): StorageCoordinator {
    const refs = new Map<string, StorageRef>();
    const leases = new Map<string, StorageLease>();
    return Object.freeze({
        acquireLease(
            key: string,
            owner: string,
            ttlMilliseconds: number,
            nowMilliseconds: number,
        ): Promise<StorageLeaseAcquireResult> {
            return settle(() => {
                assertStorageName(key, "key");
                assertLeaseOwner(owner);
                assertLeaseTiming(ttlMilliseconds, nowMilliseconds);
                return apply(
                    leases,
                    key,
                    decideAcquire(leases.get(key), key, owner, ttlMilliseconds, nowMilliseconds),
                );
            });
        },
        compareAndSwapRef(
            name: string,
            expectedGeneration: number,
            value: string,
            fence?: StorageFence,
        ): Promise<StorageRefSwapResult> {
            return settle(() => {
                assertStorageName(name, "name");
                assertNonNegativeInteger(expectedGeneration, "expectedGeneration");
                assertRefValue(value);
                assertOptionalFence(fence);
                const fenced = fence !== undefined && !isFenceCurrent(leases.get(fence.key), fence);
                return apply(
                    refs,
                    name,
                    decideSwap(refs.get(name), name, expectedGeneration, value, fenced),
                );
            });
        },
        durability: VOLATILE_STORAGE,
        readLease(key: string): Promise<StorageLease | undefined> {
            return settle(() => {
                assertStorageName(key, "key");
                return leases.get(key);
            });
        },
        readRef(name: string): Promise<StorageRef | undefined> {
            return settle(() => {
                assertStorageName(name, "name");
                return refs.get(name);
            });
        },
        releaseLease(
            key: string,
            owner: string,
            fencingToken: number,
        ): Promise<StorageLeaseReleaseResult> {
            return settle(() => {
                assertStorageName(key, "key");
                assertLeaseOwner(owner);
                assertFencingToken(fencingToken);
                return apply(leases, key, decideRelease(leases.get(key), owner, fencingToken));
            });
        },
        renewLease(
            key: string,
            owner: string,
            fencingToken: number,
            ttlMilliseconds: number,
            nowMilliseconds: number,
        ): Promise<StorageLeaseRenewResult> {
            return settle(() => {
                assertStorageName(key, "key");
                assertLeaseOwner(owner);
                assertFencingToken(fencingToken);
                assertLeaseTiming(ttlMilliseconds, nowMilliseconds);
                return apply(
                    leases,
                    key,
                    decideRenew(
                        leases.get(key),
                        owner,
                        fencingToken,
                        ttlMilliseconds,
                        nowMilliseconds,
                    ),
                );
            });
        },
    });
}

function apply<Result, Next>(
    state: Map<string, Next>,
    key: string,
    decision: { readonly next?: Next; readonly result: Result },
): Result {
    if (decision.next !== undefined) {
        state.set(key, decision.next);
    }
    return decision.result;
}
