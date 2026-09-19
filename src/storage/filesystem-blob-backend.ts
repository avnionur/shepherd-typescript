import { lstatSync, readdirSync, unlinkSync } from "node:fs";
import path from "node:path";

import { syncDirectory } from "../blob/directory-durability.ts";
import { BlobFilesystem } from "../blob/filesystem.ts";
import { assertBlobId, blobDigest } from "../blob/identity.ts";
import { kernelProtocolConfig } from "../protocol/config.ts";
import type { BlobId } from "../store/types.ts";
import { assertBlobContent, pageOf, readBlobListRequest } from "./blob-backend.ts";
import { DURABLE_STORAGE, settle } from "./coordination.ts";
import type {
    BlobStoreBackend,
    BlobStoreListOptions,
    BlobStoreListPage,
    BlobStorePutResult,
} from "./types.ts";

const blobConfig = kernelProtocolConfig.store.blobs;
const bucketPattern = new RegExp(`^[0-9a-f]{${blobConfig.fanoutCharacters}}$`, "u");
const digestPattern = new RegExp(`^[0-9a-f]{${blobConfig.hexLength}}$`, "u");

/**
 * Creates a durable content-addressed blob-store backend over the trace store's filesystem blob
 * layout.
 *
 * Writes go through the same `BlobFilesystem` the trace store uses: a private temporary file is
 * written and flushed, hard-linked into its fan-out directory without replacing an existing
 * object, re-read and verified, and the directory is flushed. Bytes whose digest differs from the
 * identifier are refused before anything touches disk. Reads verify size and digest and raise
 * `BlobIntegrityError` for a corrupt or non-regular object. `list` walks fan-out directories in
 * ascending order and ignores temporary and foreign entries. `delete` unlinks one object and
 * flushes its directory.
 *
 * Root the backend in its own directory. Pointing it at a live trace store's blob directory is
 * supported for reads and writes only: deleting a blob a stored receipt still names breaks that
 * store's integrity; trace-store blob deletion is owned by `collectBlobOrphans`.
 *
 * @param rootPath - Directory to create or open; symlinked or non-directory ancestors are refused.
 * @returns A backend declaring `durable` durability.
 * @throws {TypeError} If `rootPath` has a symlink or non-directory ancestor.
 * @example
 * ```ts
 * const backend = createFilesystemBlobStoreBackend("/var/lib/app/blobs");
 * await backend.put(blobId, bytes);
 * ```
 */
export function createFilesystemBlobStoreBackend(rootPath: string): BlobStoreBackend {
    const filesystem = new BlobFilesystem(rootPath);
    const root = filesystem.rootPath();
    const locate = (blobId: BlobId): string => path.join(root, filesystem.storageKey(blobId));
    const exists = (blobId: BlobId): boolean =>
        lstatSync(locate(blobId), { throwIfNoEntry: false }) !== undefined;
    return Object.freeze({
        delete(blobId: BlobId): Promise<boolean> {
            return settle(() => {
                assertBlobId(blobId, "blobId");
                const filePath = locate(blobId);
                if (lstatSync(filePath, { throwIfNoEntry: false }) === undefined) {
                    return false;
                }
                unlinkSync(filePath);
                syncDirectory(path.dirname(filePath));
                return true;
            });
        },
        durability: DURABLE_STORAGE,
        get(blobId: BlobId): Promise<Uint8Array | undefined> {
            return settle(() => {
                assertBlobId(blobId, "blobId");
                const stats = lstatSync(locate(blobId), { throwIfNoEntry: false });
                return stats === undefined ? undefined : filesystem.read(blobId, stats.size);
            });
        },
        has(blobId: BlobId): Promise<boolean> {
            return settle(() => {
                assertBlobId(blobId, "blobId");
                return exists(blobId);
            });
        },
        list(options?: BlobStoreListOptions): Promise<BlobStoreListPage> {
            return settle(() => {
                const { after, limit } = readBlobListRequest(options);
                return pageOf(listAfter(root, after, limit + 1), limit);
            });
        },
        put(blobId: BlobId, content: Uint8Array): Promise<BlobStorePutResult> {
            return settle(() => {
                assertBlobContent(blobId, content);
                const created = !exists(blobId);
                filesystem.put(blobId, content);
                return Object.freeze({ blobId, byteLength: content.byteLength, created });
            });
        },
    });
}

function listAfter(root: string, after: BlobId | undefined, count: number): readonly BlobId[] {
    const afterDigest = after === undefined ? "" : blobDigest(after);
    const afterBucket = afterDigest.slice(0, blobConfig.fanoutCharacters);
    const found: BlobId[] = [];
    const buckets = readdirSync(root)
        .filter((name) => bucketPattern.test(name) && name >= afterBucket)
        .sort();
    for (const bucket of buckets) {
        const directory = path.join(root, bucket);
        if (!lstatSync(directory).isDirectory()) {
            continue;
        }
        const digests = readdirSync(directory)
            .filter(
                (name) => digestPattern.test(name) && name.startsWith(bucket) && name > afterDigest,
            )
            .sort();
        for (const digest of digests) {
            found.push(`${blobConfig.idPrefix}${digest}`);
            if (found.length === count) {
                return found;
            }
        }
    }
    return found;
}
