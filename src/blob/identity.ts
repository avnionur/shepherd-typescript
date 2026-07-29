import { createHash } from "node:crypto";

import { kernelProtocolConfig } from "../protocol/config.ts";
import type { BlobId } from "../store/types.ts";

const blobConfig = kernelProtocolConfig.store.blobs;
const blobIdPattern = new RegExp(
    `^${escapeRegExp(blobConfig.idPrefix)}[0-9a-f]{${blobConfig.hexLength}}$`,
    "u",
);

/**
 * Creates the configured content-addressed identity for binary data.
 *
 * @param content - Bytes whose identity is required.
 * @returns The stable configured digest identifier.
 *
 * @internal
 */
export function createBlobId(content: Uint8Array): BlobId {
    return `${blobConfig.idPrefix}${createHash(blobConfig.digestAlgorithm).update(content).digest("hex")}`;
}

/**
 * Validates an untrusted blob identifier.
 *
 * @param value - Candidate identifier.
 * @param path - Diagnostic field path.
 * @throws {TypeError} If the identifier does not match the configured digest format.
 *
 * @internal
 */
export function assertBlobId(value: unknown, path: string): asserts value is BlobId {
    if (typeof value !== "string" || !blobIdPattern.test(value)) {
        throw new TypeError(`${path} must be a configured blob identifier`);
    }
}

/** Returns the lowercase digest component of a validated blob identifier. */
export function blobDigest(blobId: BlobId): string {
    return blobId.slice(blobConfig.idPrefix.length);
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
