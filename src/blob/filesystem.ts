import { randomUUID } from "node:crypto";
import {
    closeSync,
    existsSync,
    fsyncSync,
    linkSync,
    lstatSync,
    openSync,
    readFileSync,
    unlinkSync,
    writeFileSync,
} from "node:fs";
import path from "node:path";

import { kernelProtocolConfig } from "../protocol/config.ts";
import { BlobIntegrityError } from "../store/errors.ts";
import type { BlobId, BlobIntegrityIssue } from "../store/types.ts";
import { ensureDurableDirectory, syncDirectory } from "./directory-durability.ts";
import { blobDigest, createBlobId } from "./identity.ts";

/** Filesystem result for one durable content-addressed blob. */
export type StoredBlobFile = {
    readonly storageKey: string;
};

/** Synchronous content-addressed filesystem rooted at one verified directory. */
export class BlobFilesystem {
    readonly #root: string;

    constructor(rootPath: string) {
        this.#root = ensureDurableDirectory(rootPath);
    }

    /** Writes bytes durably without replacing an existing content-addressed object. */
    put(blobId: BlobId, content: Uint8Array): StoredBlobFile {
        const { directory, filePath, storageKey } = this.#location(blobId);
        this.#ensureStorageDirectory(directory);
        const temporaryPath = path.join(directory, `.tmp-${randomUUID()}`);
        try {
            const descriptor = openSync(temporaryPath, "wx", 0o600);
            try {
                writeFileSync(descriptor, content);
                fsyncSync(descriptor);
            } finally {
                closeSync(descriptor);
            }
            try {
                linkSync(temporaryPath, filePath);
            } catch (error) {
                if (!isFileExistsError(error)) {
                    throw error;
                }
            }
            this.#readExpected(filePath, blobId, content.byteLength);
            unlinkSync(temporaryPath);
            syncDirectory(directory);
            return { storageKey };
        } finally {
            if (existsSync(temporaryPath)) {
                unlinkSync(temporaryPath);
            }
        }
    }

    /** Reads and verifies one expected file, or returns undefined when absent. */
    read(blobId: BlobId, expectedByteLength: number): Uint8Array | undefined {
        const { filePath } = this.#location(blobId);
        if (!existsSync(filePath)) {
            return undefined;
        }
        return this.#readExpected(filePath, blobId, expectedByteLength);
    }

    /** Classifies one filesystem object without throwing for ordinary integrity failures. */
    verify(blobId: BlobId, expectedByteLength: number): BlobIntegrityIssue["kind"] | undefined {
        const { filePath } = this.#location(blobId);
        if (!existsSync(filePath)) {
            return "missing";
        }
        if (!lstatSync(filePath).isFile()) {
            return "not_regular_file";
        }
        const content = readFileSync(filePath);
        if (content.byteLength !== expectedByteLength) {
            return "size_mismatch";
        }
        return createBlobId(content) === blobId ? undefined : "digest_mismatch";
    }

    /** Returns the deterministic relative storage key for a blob identifier. */
    storageKey(blobId: BlobId): string {
        return this.#location(blobId).storageKey;
    }

    #ensureStorageDirectory(directory: string): void {
        try {
            ensureDurableDirectory(directory);
        } catch (error) {
            if (error instanceof TypeError) {
                throw new BlobIntegrityError("blob storage directory is not a safe directory", {
                    cause: error,
                });
            }
            throw error;
        }
    }

    #location(blobId: BlobId): {
        readonly directory: string;
        readonly filePath: string;
        readonly storageKey: string;
    } {
        const digest = blobDigest(blobId);
        const bucket = digest.slice(0, kernelProtocolConfig.store.blobs.fanoutCharacters);
        const storageKey = `${bucket}/${digest}`;
        const directory = path.join(this.#root, bucket);
        return { directory, filePath: path.join(directory, digest), storageKey };
    }

    #readExpected(filePath: string, blobId: BlobId, expectedByteLength: number): Uint8Array {
        if (!lstatSync(filePath).isFile()) {
            throw new BlobIntegrityError(`blob ${blobId} is not stored as a regular file`);
        }
        const content = readFileSync(filePath);
        if (content.byteLength !== expectedByteLength || createBlobId(content) !== blobId) {
            throw new BlobIntegrityError(`blob ${blobId} does not match its storage receipt`);
        }
        return new Uint8Array(content);
    }
}

function isFileExistsError(error: unknown): boolean {
    return error instanceof Error && "code" in error && error.code === "EEXIST";
}
