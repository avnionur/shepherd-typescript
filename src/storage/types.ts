import type {
    STORAGE_DURABILITIES,
    STORAGE_LEASE_STATUSES,
    STORAGE_REF_SWAP_STATUSES,
} from "../protocol/values.generated.ts";
import type { BlobId } from "../store/types.ts";

/**
 * Configured durability a backend or coordinator declares.
 *
 * `durable` state survives process exit and host crash once an operation resolves; `volatile`
 * state lives only as long as the adapter object.
 */
export type StorageDurability = (typeof STORAGE_DURABILITIES)[number];

/** Configured lease result status. */
export type StorageLeaseStatus = (typeof STORAGE_LEASE_STATUSES)[number];

/** Configured reference compare-and-swap result status. */
export type StorageRefSwapStatus = (typeof STORAGE_REF_SWAP_STATUSES)[number];

/** Result of one content-addressed blob write. */
export type BlobStorePutResult = {
    /** Content-addressed identifier that now names the stored bytes. */
    readonly blobId: BlobId;
    /** Stored byte length. */
    readonly byteLength: number;
    /**
     * Whether this call stored the object. `false` means an equal object already existed; under
     * concurrent writers of the same bytes more than one caller may observe `true`.
     */
    readonly created: boolean;
};

/** Bounded page request over stored blob identifiers. */
export type BlobStoreListOptions = {
    /** Exclusive lower bound; only identifiers ordering strictly after it are returned. */
    readonly after?: BlobId;
    /** Positive page size no larger than the configured maximum; defaults to the configured default. */
    readonly limit?: number;
};

/** One page of stored blob identifiers in ascending code-unit order. */
export type BlobStoreListPage = {
    /** Identifiers in strictly ascending order. */
    readonly blobIds: readonly BlobId[];
    /** Present exactly when more identifiers exist; pass it as `after` to read the next page. */
    readonly next?: BlobId;
};

/**
 * Content-addressed object storage an adapter implements for local or remote bytes.
 *
 * Laws (checked by `checkBlobStoreBackendConformance`): `put` verifies that the bytes hash to the
 * identifier, is idempotent for equal bytes, and never replaces an existing object; `get` returns
 * an independent copy of exactly the stored bytes or `undefined`; `has` agrees with `get`; `list`
 * is ordered, stable, exclusive after its cursor, and bounded; `delete` is idempotent. Every
 * method may return a promise so a network adapter can implement the same contract.
 */
export type BlobStoreBackend = {
    /** Declared durability of resolved writes. */
    readonly durability: StorageDurability;
    /**
     * Stores bytes under their content-addressed identifier without replacing an existing object.
     *
     * @throws {StorageBlobContentMismatchError} If the bytes do not hash to `blobId`.
     * @throws {TypeError} If the identifier or bytes are malformed.
     */
    put(blobId: BlobId, content: Uint8Array): Promise<BlobStorePutResult>;
    /** Reads an independent copy of the stored bytes, or `undefined` when absent. */
    get(blobId: BlobId): Promise<Uint8Array | undefined>;
    /** Reports whether an object is stored under the identifier. */
    has(blobId: BlobId): Promise<boolean>;
    /** Lists one bounded ascending page of stored identifiers. */
    list(options?: BlobStoreListOptions): Promise<BlobStoreListPage>;
    /** Removes an object; returns whether one was removed. Repeated calls resolve `false`. */
    delete(blobId: BlobId): Promise<boolean>;
    /** Optionally releases adapter resources; conformance kits call it after each law. */
    close?(): void | Promise<void>;
};

/** One named compare-and-swap reference. */
export type StorageRef = {
    /** Reference name matching the configured grammar. */
    readonly name: string;
    /** Positive generation, incremented by exactly one on every successful swap. */
    readonly generation: number;
    /** Opaque bounded value, such as a blob or record identifier. */
    readonly value: string;
};

/** One lease record and its monotonic fencing token. */
export type StorageLease = {
    /** Lease key matching the configured grammar. */
    readonly key: string;
    /** Caller-chosen holder identity. */
    readonly owner: string;
    /** Positive token, incremented whenever a different grant replaces an expired or released one. */
    readonly fencingToken: number;
    /** Caller-clock millisecond at which the lease stops granting authority; `0` once released. */
    readonly expiresAt: number;
};

/** Lease authority a guarded reference swap requires. */
export type StorageFence = {
    /** Lease key that guards the write. */
    readonly key: string;
    /** Holder identity that acquired the lease. */
    readonly owner: string;
    /** Fencing token returned when the lease was acquired. */
    readonly fencingToken: number;
    /** Caller-clock millisecond at which authority is evaluated. */
    readonly now: number;
};

/** Result of one reference compare-and-swap. */
export type StorageRefSwapResult =
    | {
          /** The swap committed. */
          readonly status: (typeof STORAGE_REF_SWAP_STATUSES)[0];
          /** The committed reference. */
          readonly ref: StorageRef;
      }
    | {
          /** The expected generation was not current; nothing changed. */
          readonly status: (typeof STORAGE_REF_SWAP_STATUSES)[1];
          /** The current reference, or `undefined` when it does not exist. */
          readonly current: StorageRef | undefined;
      }
    | {
          /** The supplied fence no longer grants authority; nothing changed. */
          readonly status: (typeof STORAGE_REF_SWAP_STATUSES)[2];
      };

/** Result of one lease acquisition. */
export type StorageLeaseAcquireResult =
    | {
          /** The caller holds the lease. */
          readonly status: (typeof STORAGE_LEASE_STATUSES)[0];
          /** The granted lease. */
          readonly lease: StorageLease;
      }
    | {
          /** Another owner holds an unexpired lease; nothing changed. */
          readonly status: (typeof STORAGE_LEASE_STATUSES)[1];
          /** The current holder's lease. */
          readonly lease: StorageLease;
      };

/** Result of one lease renewal. */
export type StorageLeaseRenewResult =
    | {
          /** The lease was extended under the same fencing token. */
          readonly status: (typeof STORAGE_LEASE_STATUSES)[2];
          /** The renewed lease. */
          readonly lease: StorageLease;
      }
    | {
          /** The owner and token are not the current unexpired grant; nothing changed. */
          readonly status: (typeof STORAGE_LEASE_STATUSES)[4];
      };

/** Result of one lease release. */
export type StorageLeaseReleaseResult =
    | {
          /** The current grant was released; the next acquisition receives a higher token. */
          readonly status: (typeof STORAGE_LEASE_STATUSES)[3];
      }
    | {
          /** The owner and token are not the current grant; nothing changed. */
          readonly status: (typeof STORAGE_LEASE_STATUSES)[4];
      };

/**
 * Reference and lease coordination an adapter implements for local or remote state.
 *
 * Laws (checked by `checkStorageCoordinatorConformance`): reference generations start at `1`
 * and increase by exactly one per successful swap; a swap whose expected generation is not
 * current reports a conflict and changes nothing; among concurrent swaps from one generation
 * exactly one commits. At most one unexpired lease exists per key; a different grant always
 * receives a strictly higher fencing token; renewal and release require the exact current owner
 * and token; and a fenced swap, renewal, or release from a superseded or expired grant changes
 * nothing. Time is the caller's clock: adapters compare the supplied milliseconds and never read
 * their own clock. Every method may return a promise so a network adapter can implement the
 * same contract.
 */
export type StorageCoordinator = {
    /** Declared durability of resolved swaps and lease changes. */
    readonly durability: StorageDurability;
    /** Reads one reference, or `undefined` when it has never been created. */
    readRef(name: string): Promise<StorageRef | undefined>;
    /**
     * Atomically replaces a reference when its generation equals `expectedGeneration` (`0` creates
     * it) and, when `fence` is given, the fence is the current unexpired lease grant.
     */
    compareAndSwapRef(
        name: string,
        expectedGeneration: number,
        value: string,
        fence?: StorageFence,
    ): Promise<StorageRefSwapResult>;
    /** Reads the latest lease record for a key, including expired or released grants. */
    readLease(key: string): Promise<StorageLease | undefined>;
    /** Grants the lease when it is free, expired, released, or already held by `owner`. */
    acquireLease(
        key: string,
        owner: string,
        ttlMilliseconds: number,
        nowMilliseconds: number,
    ): Promise<StorageLeaseAcquireResult>;
    /** Extends the exact current unexpired grant under the same token. */
    renewLease(
        key: string,
        owner: string,
        fencingToken: number,
        ttlMilliseconds: number,
        nowMilliseconds: number,
    ): Promise<StorageLeaseRenewResult>;
    /** Releases the exact current grant so the next acquisition is immediate. */
    releaseLease(
        key: string,
        owner: string,
        fencingToken: number,
    ): Promise<StorageLeaseReleaseResult>;
    /** Optionally releases adapter resources; conformance kits call it after each law. */
    close?(): void | Promise<void>;
};
