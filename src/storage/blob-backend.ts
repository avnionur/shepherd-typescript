import { assertBlobId, createBlobId } from "../blob/identity.ts";
import { storageProtocolConfig } from "../protocol/config.ts";
import type { BlobId } from "../store/types.ts";
import { StorageBlobContentMismatchError } from "./errors.ts";
import type { BlobStoreListOptions, BlobStoreListPage } from "./types.ts";

/** Validated list request. @internal */
export type BlobListRequest = {
    readonly after: BlobId | undefined;
    readonly limit: number;
};

/**
 * Validates a put request and proves the bytes hash to the requested identifier.
 *
 * @throws {TypeError} If the identifier or bytes are malformed.
 * @throws {StorageBlobContentMismatchError} If the bytes hash to a different identifier.
 * @internal
 */
export function assertBlobContent(blobId: unknown, content: unknown): asserts blobId is BlobId {
    assertBlobId(blobId, "blobId");
    if (!(content instanceof Uint8Array)) {
        throw new TypeError("content must be a Uint8Array");
    }
    if (createBlobId(content) !== blobId) {
        throw new StorageBlobContentMismatchError(
            `content does not match blob ${blobId}; the existing object, if any, is unchanged`,
        );
    }
}

/**
 * Validates a list request against the configured bounds.
 *
 * @throws {TypeError} If the options, cursor, or limit are malformed or out of bounds.
 * @internal
 */
export function readBlobListRequest(options: BlobStoreListOptions | undefined): BlobListRequest {
    if (options === undefined) {
        return { after: undefined, limit: storageProtocolConfig.blobs.defaultListLimit };
    }
    if (options === null || typeof options !== "object") {
        throw new TypeError("list options must be an object");
    }
    const { after, limit = storageProtocolConfig.blobs.defaultListLimit } = options;
    if (after !== undefined) {
        assertBlobId(after, "after");
    }
    if (
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > storageProtocolConfig.blobs.maxListLimit
    ) {
        throw new TypeError("limit must be a positive integer within the configured list bound");
    }
    return { after, limit };
}

/**
 * Builds one page from identifiers already sorted in ascending code-unit order.
 *
 * @param sorted - Ascending identifiers strictly after the cursor; only the first `limit + 1`
 * entries are inspected.
 * @param limit - Validated page size.
 * @returns A frozen page whose `next` is present exactly when more identifiers exist.
 * @internal
 */
export function pageOf(sorted: readonly BlobId[], limit: number): BlobStoreListPage {
    const blobIds = Object.freeze(sorted.slice(0, limit));
    const next = blobIds[limit - 1];
    return sorted.length > limit && next !== undefined
        ? Object.freeze({ blobIds, next })
        : Object.freeze({ blobIds });
}
