import { lstatSync, readdirSync, realpathSync, unlinkSync } from "node:fs";
import path from "node:path";

import { kernelProtocolConfig } from "../protocol/config.ts";
import { BlobIntegrityError } from "../store/errors.ts";
import type { BlobId } from "../store/types.ts";
import { syncDirectory } from "./directory-durability.ts";

/** Internal filesystem candidates discovered under the configured blob layout. */
export type BlobOrphanCandidates = {
    /** Sorted unregistered blob identities. */
    readonly blobIds: readonly BlobId[];
    /** Sorted root-relative temporary-file storage keys. */
    readonly temporaryStorageKeys: readonly string[];
};

const blobConfig = kernelProtocolConfig.store.blobs;
const bucketPattern = new RegExp(`^[0-9a-f]{${blobConfig.fanoutCharacters}}$`, "u");
const digestPattern = new RegExp(`^[0-9a-f]{${blobConfig.hexLength}}$`, "u");

/**
 * Finds exact-layout objects not named by the retained blob set.
 *
 * @param rootPath - Canonical store-controlled blob root.
 * @param retainedBlobIds - Blob identities protected by durable registrations.
 * @returns Frozen, sorted deletion candidates.
 * @throws {BlobIntegrityError} If a store-layout entry is unsafe or malformed.
 * @throws {Error} If the filesystem cannot be enumerated.
 *
 * @internal
 */
export function findBlobOrphans(
    rootPath: string,
    retainedBlobIds: ReadonlySet<BlobId>,
): BlobOrphanCandidates {
    assertCanonicalDirectory(rootPath, rootPath, "blob root");
    const blobIds: BlobId[] = [];
    const temporaryStorageKeys: string[] = [];
    for (const bucketEntry of readdirSync(rootPath, { withFileTypes: true })) {
        if (!bucketPattern.test(bucketEntry.name)) {
            continue;
        }
        const bucketPath = path.join(rootPath, bucketEntry.name);
        assertCanonicalDirectory(bucketPath, bucketPath, "blob fanout entry");
        for (const objectEntry of readdirSync(bucketPath, { withFileTypes: true })) {
            const storageKey = `${bucketEntry.name}/${objectEntry.name}`;
            if (!objectEntry.isFile()) {
                throw new BlobIntegrityError("blob collection found an unsafe storage object");
            }
            if (objectEntry.name.startsWith(blobConfig.temporaryFilePrefix)) {
                temporaryStorageKeys.push(storageKey);
                continue;
            }
            if (
                !digestPattern.test(objectEntry.name) ||
                !objectEntry.name.startsWith(bucketEntry.name)
            ) {
                throw new BlobIntegrityError("blob collection found an unexpected storage object");
            }
            const blobId = `${blobConfig.idPrefix}${objectEntry.name}`;
            if (!retainedBlobIds.has(blobId)) {
                blobIds.push(blobId);
            }
        }
    }
    return Object.freeze({
        blobIds: Object.freeze(blobIds.sort()),
        temporaryStorageKeys: Object.freeze(temporaryStorageKeys.sort()),
    });
}

/**
 * Deletes previously discovered candidates without traversing outside the blob root.
 *
 * @param rootPath - Canonical store-controlled blob root.
 * @param candidates - Candidates returned by `findBlobOrphans` under the same store lock.
 * @throws {Error} If deletion or directory flushing fails.
 *
 * @internal
 */
export function deleteBlobOrphans(rootPath: string, candidates: BlobOrphanCandidates): void {
    assertCanonicalDirectory(rootPath, rootPath, "blob root");
    for (const storageKey of [
        ...candidates.blobIds.map((blobId) => storageKeyForBlobId(blobId)),
        ...candidates.temporaryStorageKeys,
    ]) {
        const [bucket, fileName] = storageKey.split("/");
        /* node:coverage disable */
        if (bucket === undefined || fileName === undefined) {
            throw new BlobIntegrityError("blob collection candidate has an invalid storage key");
        }
        /* node:coverage enable */
        const bucketPath = path.join(rootPath, bucket);
        assertCanonicalDirectory(bucketPath, bucketPath, "blob fanout entry");
        const filePath = path.join(bucketPath, fileName);
        /* node:coverage disable */
        if (!lstatSync(filePath).isFile()) {
            throw new BlobIntegrityError("blob collection candidate changed before deletion");
        }
        /* node:coverage enable */
        unlinkSync(filePath);
        syncDirectory(bucketPath);
    }
}

function assertCanonicalDirectory(
    directoryPath: string,
    expectedPath: string,
    subject: string,
): void {
    const status = lstatSync(directoryPath);
    if (status.isSymbolicLink() || !status.isDirectory()) {
        throw new BlobIntegrityError(`${subject} is not a safe canonical directory`);
    }
    /* node:coverage disable */
    if (realpathSync(directoryPath) !== expectedPath) {
        throw new BlobIntegrityError(`${subject} resolves outside its canonical directory`);
    }
    /* node:coverage enable */
}

function storageKeyForBlobId(blobId: BlobId): string {
    const digest = blobId.slice(blobConfig.idPrefix.length);
    return `${digest.slice(0, blobConfig.fanoutCharacters)}/${digest}`;
}
