import { createBlobId } from "../blob/identity.ts";
import { storageProtocolConfig } from "../protocol/config.ts";
import {
    STORAGE_DURABILITIES,
    STORAGE_LEASE_STATUSES,
    STORAGE_REF_SWAP_STATUSES,
} from "../protocol/values.generated.ts";
import type { BlobId } from "../store/types.ts";
import type { BlobStoreBackend, StorageCoordinator, StorageDurability } from "./types.ts";

const [ACQUIRED, HELD, RENEWED, RELEASED, LEASE_FENCED] = STORAGE_LEASE_STATUSES;
const [SWAPPED, CONFLICT, SWAP_FENCED] = STORAGE_REF_SWAP_STATUSES;
const CONCURRENT_CALLERS = 8;
const encoder = new TextEncoder();

/** Outcome of one named conformance law. */
export type StorageConformanceLawResult = {
    /** Stable law name. */
    readonly law: string;
    /** Whether the adapter satisfied the law. */
    readonly passed: boolean;
    /** First violated expectation or thrown failure message; absent when the law passed. */
    readonly failure?: string;
};

/** Report of one conformance-kit run over a storage adapter. */
export type StorageConformanceReport = {
    /** Whether every law passed. */
    readonly passed: boolean;
    /** Durability the first adapter instance declared, when a factory call succeeded. */
    readonly durability?: StorageDurability;
    /** Per-law outcomes in execution order. */
    readonly laws: readonly StorageConformanceLawResult[];
};

/** Creates one fresh, empty blob-store backend per conformance law. */
export type BlobStoreBackendFactory = () => BlobStoreBackend | Promise<BlobStoreBackend>;

/** Creates one fresh, empty storage coordinator per conformance law. */
export type StorageCoordinatorFactory = () => StorageCoordinator | Promise<StorageCoordinator>;

type Law<Adapter> = readonly [name: string, check: (adapter: Adapter) => Promise<void>];

/**
 * Runs the named `BlobStoreBackend` laws against fresh backends from a factory.
 *
 * Each law receives a new empty backend, which is closed afterwards when it exposes `close`. A
 * violated expectation, an unexpected throw, or an expected refusal that does not happen marks
 * that law failed; the kit itself never throws for adapter misbehavior. Third-party adapters use
 * it as a self-test; the reference memory and filesystem backends pass every law.
 *
 * @param factory - Creates one fresh, empty backend per law.
 * @returns A frozen report naming every law and whether it passed.
 * @example
 * ```ts
 * const report = await checkBlobStoreBackendConformance(() => createMyBackend());
 * if (!report.passed) console.error(report.laws.filter(({ passed }) => !passed));
 * ```
 */
export function checkBlobStoreBackendConformance(
    factory: BlobStoreBackendFactory,
): Promise<StorageConformanceReport> {
    return runLaws(factory, blobLaws);
}

/**
 * Runs the named `StorageCoordinator` laws against fresh coordinators from a factory.
 *
 * Each law receives a new empty coordinator, which is closed afterwards when it exposes `close`.
 * Laws drive lease time with explicit caller-clock values inside the configured lease bounds, and
 * concurrency laws issue overlapping calls without awaiting between them. A violated expectation,
 * an unexpected throw, or an expected refusal that does not happen marks that law failed.
 *
 * @param factory - Creates one fresh, empty coordinator per law.
 * @returns A frozen report naming every law and whether it passed.
 */
export function checkStorageCoordinatorConformance(
    factory: StorageCoordinatorFactory,
): Promise<StorageConformanceReport> {
    return runLaws(factory, coordinatorLaws);
}

async function runLaws<
    Adapter extends {
        readonly durability: StorageDurability;
        close?(): void | Promise<void>;
    },
>(
    factory: () => Adapter | Promise<Adapter>,
    laws: readonly Law<Adapter>[],
): Promise<StorageConformanceReport> {
    const results: StorageConformanceLawResult[] = [];
    let durability: StorageDurability | undefined;
    for (const [law, check] of laws) {
        try {
            const adapter = await factory();
            durability ??= adapter.durability;
            try {
                await check(adapter);
            } finally {
                await adapter.close?.();
            }
            results.push(Object.freeze({ law, passed: true }));
        } catch (error) {
            results.push(
                Object.freeze({
                    failure: error instanceof Error ? error.message : String(error),
                    law,
                    passed: false,
                }),
            );
        }
    }
    return Object.freeze({
        ...(durability === undefined ? {} : { durability }),
        laws: Object.freeze(results),
        passed: results.every(({ passed }) => passed),
    });
}

function expect(condition: boolean, message: string): void {
    if (!condition) {
        throw new Error(message);
    }
}

async function expectRefusal(operation: () => Promise<unknown>, message: string): Promise<void> {
    let refused = false;
    try {
        await operation();
    } catch {
        refused = true;
    }
    expect(refused, message);
}

function sameBytes(left: Uint8Array | undefined, right: Uint8Array): boolean {
    return (
        left instanceof Uint8Array &&
        left.byteLength === right.byteLength &&
        left.every((byte, index) => byte === right[index])
    );
}

function sample(label: string): { readonly blobId: BlobId; readonly content: Uint8Array } {
    const content = encoder.encode(`storage conformance ${label}`);
    return { blobId: createBlobId(content), content };
}

const blobLaws: readonly Law<BlobStoreBackend>[] = [
    [
        "declares-durability",
        async (backend) => {
            expect(
                (STORAGE_DURABILITIES as readonly string[]).includes(backend.durability),
                "durability must be a configured storage durability",
            );
        },
    ],
    [
        "put-get-round-trip",
        async (backend) => {
            const { blobId, content } = sample("round-trip");
            const put = await backend.put(blobId, content);
            expect(put.created && put.blobId === blobId, "first put must create the object");
            expect(put.byteLength === content.byteLength, "put must report the byte length");
            expect(sameBytes(await backend.get(blobId), content), "get must return stored bytes");
            expect(await backend.has(blobId), "has must report a stored object");
        },
    ],
    [
        "put-idempotent",
        async (backend) => {
            const { blobId, content } = sample("idempotent");
            await backend.put(blobId, content);
            const again = await backend.put(blobId, content.slice());
            expect(!again.created, "an equal second put must not report creation");
            expect(sameBytes(await backend.get(blobId), content), "equal put must keep bytes");
            expect((await backend.list()).blobIds.length === 1, "equal put must not duplicate");
        },
    ],
    [
        "put-refuses-digest-mismatch",
        async (backend) => {
            const expected = sample("expected");
            const other = sample("other");
            await expectRefusal(
                () => backend.put(expected.blobId, other.content),
                "put must refuse bytes that do not hash to the identifier",
            );
            expect(!(await backend.has(expected.blobId)), "a refused put must store nothing");
        },
    ],
    [
        "put-never-replaces",
        async (backend) => {
            const original = sample("original");
            const replacement = sample("replacement");
            await backend.put(original.blobId, original.content);
            await expectRefusal(
                () => backend.put(original.blobId, replacement.content),
                "put must refuse different bytes for an existing identifier",
            );
            expect(
                sameBytes(await backend.get(original.blobId), original.content),
                "a refused put must leave the existing object unchanged",
            );
        },
    ],
    [
        "copies-are-isolated",
        async (backend) => {
            const { blobId, content } = sample("isolated");
            const input = content.slice();
            await backend.put(blobId, input);
            input.fill(0);
            const first = await backend.get(blobId);
            first?.fill(0);
            expect(
                sameBytes(await backend.get(blobId), content),
                "mutating put input or get output must not change stored bytes",
            );
        },
    ],
    [
        "absent-object",
        async (backend) => {
            const { blobId } = sample("absent");
            expect((await backend.get(blobId)) === undefined, "get of an absent id is undefined");
            expect(!(await backend.has(blobId)), "has of an absent id is false");
            expect(!(await backend.delete(blobId)), "delete of an absent id resolves false");
        },
    ],
    [
        "list-ordered-paged",
        async (backend) => {
            const samples = ["d", "a", "e", "c", "b"].map((label) => sample(`list ${label}`));
            for (const { blobId, content } of samples) {
                await backend.put(blobId, content);
            }
            const expected = samples.map(({ blobId }) => blobId).sort();
            const full = await backend.list();
            expect(
                full.next === undefined && full.blobIds.join() === expected.join(),
                "list must return every identifier in ascending order without a cursor",
            );
            const collected: BlobId[] = [];
            let after: BlobId | undefined;
            for (let page = 0; page <= expected.length; page += 1) {
                const result = await backend.list(
                    after === undefined ? { limit: 2 } : { after, limit: 2 },
                );
                expect(result.blobIds.length <= 2, "list must respect the page limit");
                collected.push(...result.blobIds);
                after = result.next;
                if (after === undefined) {
                    break;
                }
                expect(
                    after === result.blobIds[result.blobIds.length - 1],
                    "next must name the last returned identifier",
                );
            }
            expect(collected.join() === expected.join(), "pages must partition the ordered set");
            const [, second] = expected as [BlobId, BlobId];
            const tail = await backend.list({ after: second });
            expect(
                tail.blobIds.join() === expected.slice(2).join(),
                "after must be an exclusive cursor",
            );
            expect(
                (await backend.list()).blobIds.join() === full.blobIds.join(),
                "listing must be stable without writes",
            );
        },
    ],
    [
        "list-bounds",
        async (backend) => {
            for (const limit of [0, -1, 1.5, storageProtocolConfig.blobs.maxListLimit + 1]) {
                await expectRefusal(
                    () => backend.list({ limit }),
                    `list must refuse limit ${limit}`,
                );
            }
            await expectRefusal(
                () => backend.list({ after: "not-a-blob-id" }),
                "list must refuse a malformed cursor",
            );
        },
    ],
    [
        "delete-idempotent",
        async (backend) => {
            const { blobId, content } = sample("delete");
            await backend.put(blobId, content);
            expect(await backend.delete(blobId), "delete of a stored id resolves true");
            expect(!(await backend.delete(blobId)), "repeated delete resolves false");
            expect((await backend.get(blobId)) === undefined, "deleted id reads undefined");
            expect((await backend.list()).blobIds.length === 0, "deleted id is not listed");
            expect((await backend.put(blobId, content)).created, "deleted id can be re-put");
        },
    ],
    [
        "malformed-identifiers",
        async (backend) => {
            const malformed = "not-a-blob-id";
            const { content } = sample("malformed");
            await expectRefusal(() => backend.put(malformed, content), "put must refuse ids");
            await expectRefusal(() => backend.get(malformed), "get must refuse malformed ids");
            await expectRefusal(() => backend.has(malformed), "has must refuse malformed ids");
            await expectRefusal(() => backend.delete(malformed), "delete must refuse ids");
        },
    ],
];

const ttl = storageProtocolConfig.leases.minTtlMilliseconds;
const start = ttl;

const coordinatorLaws: readonly Law<StorageCoordinator>[] = [
    [
        "declares-durability",
        async (coordinator) => {
            expect(
                (STORAGE_DURABILITIES as readonly string[]).includes(coordinator.durability),
                "durability must be a configured storage durability",
            );
        },
    ],
    [
        "ref-create-and-read",
        async (coordinator) => {
            expect((await coordinator.readRef("law/ref")) === undefined, "new ref is absent");
            const created = await coordinator.compareAndSwapRef("law/ref", 0, "one");
            expect(
                created.status === SWAPPED &&
                    created.ref.generation === 1 &&
                    created.ref.value === "one",
                "swap from generation 0 must create generation 1",
            );
            const read = await coordinator.readRef("law/ref");
            expect(
                read?.generation === 1 && read.value === "one" && read.name === "law/ref",
                "readRef must return the committed ref",
            );
        },
    ],
    [
        "ref-generations-monotonic",
        async (coordinator) => {
            for (let generation = 0; generation < 4; generation += 1) {
                const result = await coordinator.compareAndSwapRef(
                    "law/ref",
                    generation,
                    `v${generation}`,
                );
                expect(
                    result.status === SWAPPED && result.ref.generation === generation + 1,
                    "each swap must advance the generation by exactly one",
                );
            }
        },
    ],
    [
        "ref-conflict-unchanged",
        async (coordinator) => {
            const absent = await coordinator.compareAndSwapRef("law/ref", 3, "x");
            expect(
                absent.status === CONFLICT && absent.current === undefined,
                "a stale expectation on an absent ref must conflict",
            );
            await coordinator.compareAndSwapRef("law/ref", 0, "one");
            for (const stale of [0, 2]) {
                const result = await coordinator.compareAndSwapRef("law/ref", stale, "x");
                expect(
                    result.status === CONFLICT &&
                        result.current?.generation === 1 &&
                        result.current.value === "one",
                    "a stale expectation must conflict and report the current ref",
                );
            }
            const read = await coordinator.readRef("law/ref");
            expect(read?.generation === 1 && read.value === "one", "conflicts change nothing");
        },
    ],
    [
        "ref-concurrent-single-winner",
        async (coordinator) => {
            const results = await Promise.all(
                Array.from({ length: CONCURRENT_CALLERS }, (_, index) =>
                    coordinator.compareAndSwapRef("law/ref", 0, `writer-${index}`),
                ),
            );
            const winners = results.filter(({ status }) => status === SWAPPED);
            expect(winners.length === 1, "exactly one concurrent swap may commit");
            const read = await coordinator.readRef("law/ref");
            const [winner] = winners;
            expect(
                read?.generation === 1 &&
                    winner?.status === SWAPPED &&
                    read.value === winner.ref.value,
                "the committed value must be the winner's",
            );
        },
    ],
    [
        "lease-exclusive",
        async (coordinator) => {
            const results = await Promise.all(
                Array.from({ length: CONCURRENT_CALLERS }, (_, index) =>
                    coordinator.acquireLease("law/lease", `owner-${index}`, ttl, start),
                ),
            );
            const acquired = results.filter(({ status }) => status === ACQUIRED);
            expect(acquired.length === 1, "exactly one concurrent acquisition may succeed");
            const [winner] = acquired;
            expect(
                results.every(
                    ({ lease, status }) =>
                        (status === ACQUIRED || status === HELD) &&
                        lease.fencingToken === 1 &&
                        lease.owner === winner?.lease.owner &&
                        lease.expiresAt === start + ttl,
                ),
                "losers must observe the winner's lease with the first fencing token",
            );
        },
    ],
    [
        "lease-reacquire-by-holder",
        async (coordinator) => {
            await coordinator.acquireLease("law/lease", "owner-a", ttl, start);
            const again = await coordinator.acquireLease("law/lease", "owner-a", ttl, start);
            expect(
                again.status === ACQUIRED &&
                    again.lease.fencingToken === 1 &&
                    again.lease.expiresAt === start + ttl,
                "the holder re-acquiring an unexpired lease keeps its token and expiry",
            );
        },
    ],
    [
        "lease-expiry-takeover-fences",
        async (coordinator) => {
            const first = await coordinator.acquireLease("law/lease", "owner-a", ttl, start);
            expect(first.status === ACQUIRED, "a free lease must be acquired");
            const expiry = start + ttl;
            const held = await coordinator.acquireLease("law/lease", "owner-b", ttl, expiry - 1);
            expect(held.status === HELD, "an unexpired lease must be held against others");
            const takeover = await coordinator.acquireLease("law/lease", "owner-b", ttl, expiry);
            expect(
                takeover.status === ACQUIRED && takeover.lease.fencingToken === 2,
                "an expired lease must be re-acquirable with a higher fencing token",
            );
            const renew = await coordinator.renewLease("law/lease", "owner-a", 1, ttl, expiry);
            expect(renew.status === LEASE_FENCED, "the superseded holder must be fenced");
            const release = await coordinator.releaseLease("law/lease", "owner-a", 1);
            expect(release.status === LEASE_FENCED, "the superseded holder cannot release");
            const current = await coordinator.readLease("law/lease");
            expect(
                current?.owner === "owner-b" && current.fencingToken === 2,
                "fenced calls must leave the current grant unchanged",
            );
        },
    ],
    [
        "lease-renew",
        async (coordinator) => {
            await coordinator.acquireLease("law/lease", "owner-a", ttl, start);
            const renewed = await coordinator.renewLease(
                "law/lease",
                "owner-a",
                1,
                ttl,
                start + ttl - 1,
            );
            expect(
                renewed.status === RENEWED &&
                    renewed.lease.fencingToken === 1 &&
                    renewed.lease.expiresAt === start + 2 * ttl - 1,
                "renewal must extend the expiry under the same token",
            );
            const wrongOwner = await coordinator.renewLease("law/lease", "owner-b", 1, ttl, start);
            expect(wrongOwner.status === LEASE_FENCED, "renewal by another owner is fenced");
            const wrongToken = await coordinator.renewLease("law/lease", "owner-a", 2, ttl, start);
            expect(wrongToken.status === LEASE_FENCED, "renewal with another token is fenced");
            const late = await coordinator.renewLease(
                "law/lease",
                "owner-a",
                1,
                ttl,
                start + 2 * ttl - 1,
            );
            expect(late.status === LEASE_FENCED, "renewal at or after expiry is fenced");
            const absent = await coordinator.renewLease("law/other", "owner-a", 1, ttl, start);
            expect(absent.status === LEASE_FENCED, "renewal of an absent lease is fenced");
        },
    ],
    [
        "lease-release",
        async (coordinator) => {
            await coordinator.acquireLease("law/lease", "owner-a", ttl, start);
            const wrong = await coordinator.releaseLease("law/lease", "owner-b", 1);
            expect(wrong.status === LEASE_FENCED, "release by another owner is fenced");
            const released = await coordinator.releaseLease("law/lease", "owner-a", 1);
            expect(released.status === RELEASED, "the holder may release its grant");
            const next = await coordinator.acquireLease("law/lease", "owner-b", ttl, start);
            expect(
                next.status === ACQUIRED && next.lease.fencingToken === 2,
                "a released lease is immediately re-acquirable with a higher token",
            );
            const absent = await coordinator.releaseLease("law/other", "owner-a", 1);
            expect(absent.status === LEASE_FENCED, "release of an absent lease is fenced");
        },
    ],
    [
        "fenced-swap",
        async (coordinator) => {
            await coordinator.acquireLease("law/lease", "owner-a", ttl, start);
            const fence = { fencingToken: 1, key: "law/lease", now: start, owner: "owner-a" };
            const guarded = await coordinator.compareAndSwapRef("law/ref", 0, "a", fence);
            expect(guarded.status === SWAPPED, "a swap under the current fence commits");
            await coordinator.acquireLease("law/lease", "owner-b", ttl, start + ttl);
            const stale = await coordinator.compareAndSwapRef("law/ref", 1, "stale", {
                ...fence,
                now: start + ttl,
            });
            expect(stale.status === SWAP_FENCED, "a swap under a superseded fence is fenced");
            const expired = await coordinator.compareAndSwapRef("law/ref", 1, "late", {
                fencingToken: 2,
                key: "law/lease",
                now: start + 2 * ttl,
                owner: "owner-b",
            });
            expect(expired.status === SWAP_FENCED, "a swap under an expired fence is fenced");
            const unknown = await coordinator.compareAndSwapRef("law/ref", 1, "none", {
                ...fence,
                key: "law/absent",
            });
            expect(unknown.status === SWAP_FENCED, "a swap under an absent lease is fenced");
            const read = await coordinator.readRef("law/ref");
            expect(read?.generation === 1 && read.value === "a", "fenced swaps change nothing");
        },
    ],
    [
        "malformed-requests",
        async (coordinator) => {
            const { maxLength } = storageProtocolConfig.names;
            const { maxTtlMilliseconds, minTtlMilliseconds } = storageProtocolConfig.leases;
            const refusals: readonly (readonly [() => Promise<unknown>, string])[] = [
                [() => coordinator.readRef(""), "empty ref name"],
                [() => coordinator.readRef("x".repeat(maxLength + 1)), "overlong ref name"],
                [() => coordinator.compareAndSwapRef("law/ref", -1, "v"), "negative generation"],
                [
                    () =>
                        coordinator.compareAndSwapRef(
                            "law/ref",
                            0,
                            "v".repeat(storageProtocolConfig.refs.maxValueLength + 1),
                        ),
                    "overlong value",
                ],
                [() => coordinator.readLease(""), "empty lease key"],
                [() => coordinator.acquireLease("law/lease", "", ttl, start), "empty owner"],
                [
                    () => coordinator.acquireLease("law/lease", "o", minTtlMilliseconds - 1, start),
                    "ttl below bound",
                ],
                [
                    () => coordinator.acquireLease("law/lease", "o", maxTtlMilliseconds + 1, start),
                    "ttl above bound",
                ],
                [() => coordinator.acquireLease("law/lease", "o", ttl, -1), "negative clock"],
                [() => coordinator.renewLease("law/lease", "o", 0, ttl, start), "zero token"],
                [() => coordinator.releaseLease("law/lease", "o", 1.5), "fractional token"],
            ];
            for (const [operation, label] of refusals) {
                await expectRefusal(operation, `coordinator must refuse ${label}`);
            }
        },
    ],
];
