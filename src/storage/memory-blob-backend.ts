import { assertBlobId } from "../blob/identity.ts";
import type { BlobId } from "../store/types.ts";
import { assertBlobContent, pageOf, readBlobListRequest } from "./blob-backend.ts";
import { settle, VOLATILE_STORAGE } from "./coordination.ts";
import type {
    BlobStoreBackend,
    BlobStoreListOptions,
    BlobStoreListPage,
    BlobStorePutResult,
} from "./types.ts";

/**
 * Creates a volatile in-process content-addressed blob-store backend.
 *
 * It implements every `BlobStoreBackend` law: bytes are verified against their identifier,
 * copied on write and read, never replaced, listed in ascending identifier order, and deleted
 * idempotently. It is a reference and test double; objects are lost with the backend object.
 *
 * @returns A backend declaring `volatile` durability.
 * @example
 * ```ts
 * const backend = createMemoryBlobStoreBackend();
 * const { created } = await backend.put(blobId, bytes);
 * ```
 */
export function createMemoryBlobStoreBackend(): BlobStoreBackend {
    const objects = new Map<BlobId, Uint8Array>();
    return Object.freeze({
        delete(blobId: BlobId): Promise<boolean> {
            return settle(() => {
                assertBlobId(blobId, "blobId");
                return objects.delete(blobId);
            });
        },
        durability: VOLATILE_STORAGE,
        get(blobId: BlobId): Promise<Uint8Array | undefined> {
            return settle(() => {
                assertBlobId(blobId, "blobId");
                const content = objects.get(blobId);
                return content === undefined ? undefined : content.slice();
            });
        },
        has(blobId: BlobId): Promise<boolean> {
            return settle(() => {
                assertBlobId(blobId, "blobId");
                return objects.has(blobId);
            });
        },
        list(options?: BlobStoreListOptions): Promise<BlobStoreListPage> {
            return settle(() => {
                const { after, limit } = readBlobListRequest(options);
                const sorted = [...objects.keys()]
                    .filter((blobId) => after === undefined || blobId > after)
                    .sort();
                return pageOf(sorted, limit);
            });
        },
        put(blobId: BlobId, content: Uint8Array): Promise<BlobStorePutResult> {
            return settle(() => {
                assertBlobContent(blobId, content);
                const created = !objects.has(blobId);
                if (created) {
                    objects.set(blobId, content.slice());
                }
                return Object.freeze({ blobId, byteLength: content.byteLength, created });
            });
        },
    });
}
