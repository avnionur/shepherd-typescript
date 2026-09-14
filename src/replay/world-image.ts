import { realpathSync } from "node:fs";
import path from "node:path";

import { canonicalizeSemanticValue, type SemanticValue } from "../canonical/canonical-record.ts";
import {
    kernelProtocolConfig,
    replayProtocolConfig,
    workspaceProtocolConfig,
} from "../protocol/config.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import type { BlobId } from "../store/types.ts";
import {
    captureReferenceCopyTreeManifest,
    materializeReferenceCopyManifest,
    readReferenceCopyManifest,
    readReferenceCopyTreeFile,
} from "../workspace/reference-copy-carrier.ts";
import type { WorldManifestEntry } from "../workspace/types.ts";
import { ReplayRestoreError } from "./errors.ts";

/** Verified trace-store image of one managed world. @internal */
export type ReplayWorldImage = {
    /** Copy-carrier content identity of the captured tree. */
    readonly content_id: string;
    /** Manifest entry count. */
    readonly entry_count: number;
    /** Trace-store blob holding the canonical manifest. */
    readonly manifest_blob_id: BlobId;
};

/**
 * Captures one managed world as content-addressed trace-store blobs.
 *
 * The configured entry bound is enforced at capture and again when an image is verified.
 *
 * The tree is double scanned, every regular file is re-read against its manifest entry and stored,
 * and a final scan must reproduce the same content identity, so the image reflects one quiescent
 * state of the directory.
 *
 * @internal
 */
export function captureReplayWorldImage(store: SQLiteTraceStore, root: string): ReplayWorldImage {
    const captured = captureReferenceCopyTreeManifest(root);
    assertReplayWorldEntryBound(captured.manifest.length);
    for (const entry of captured.manifest) {
        if (entry.blob_id !== null) {
            store.putBlob(readReferenceCopyTreeFile(root, entry));
        }
    }
    if (captureReferenceCopyTreeManifest(root).content_id !== captured.content_id) {
        throw new TypeError("managed world changed during image capture");
    }
    const manifest = store.putBlob(
        Buffer.from(
            canonicalizeSemanticValue(captured.manifest as unknown as SemanticValue),
            "utf8",
        ),
    );
    return Object.freeze({
        content_id: captured.content_id,
        entry_count: captured.manifest.length,
        manifest_blob_id: manifest.blob_id,
    });
}

/**
 * Verifies that a retained world image is complete in this store without writing anything.
 *
 * @returns The validated manifest.
 * @throws {ReplayRestoreError} If the manifest or any file blob is absent, corrupt, or inconsistent.
 * @internal
 */
export function verifyReplayWorldImage(
    store: SQLiteTraceStore,
    image: ReplayWorldImage,
    root: string,
): readonly WorldManifestEntry[] {
    try {
        const bytes = store.readBlob(image.manifest_blob_id);
        if (bytes === undefined) {
            throw new TypeError("world manifest blob is absent");
        }
        const value = JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
        if (!Array.isArray(value)) {
            throw new TypeError("world manifest must be an array");
        }
        assertReplayWorldEntryBound(value.length);
        const manifest = readReferenceCopyManifest(root, value);
        if (
            manifest.content_id !== image.content_id ||
            manifest.manifest.length !== image.entry_count
        ) {
            throw new TypeError("world manifest differs from its checkpoint evidence");
        }
        for (const entry of manifest.manifest) {
            if (
                entry.blob_id !== null &&
                store.readBlob(storeBlobId(entry.blob_id)) === undefined
            ) {
                throw new TypeError(`world file blob is absent: ${entry.path}`);
            }
        }
        return manifest.manifest;
    } catch (error) {
        throw new ReplayRestoreError("world image is incomplete or corrupt", { cause: error });
    }
}

/**
 * Materializes a verified world image into an empty canonical root and verifies the result.
 *
 * @throws {ReplayRestoreError} If materialization or the final content identity check fails.
 * @internal
 */
export function restoreReplayWorldImage(
    store: SQLiteTraceStore,
    manifest: readonly WorldManifestEntry[],
    root: string,
): string {
    try {
        return materializeReferenceCopyManifest(root, manifest, (entry) =>
            Buffer.from(store.readBlob(storeBlobId(entry.blob_id as string)) as Uint8Array),
        ).content_id;
    } catch (error) {
        throw new ReplayRestoreError("world image restoration failed verification", {
            cause: error,
        });
    }
}

/**
 * Resolves a caller-supplied world root to its canonical absolute path.
 *
 * @throws {TypeError} If the root is not an existing directory path.
 * @internal
 */
export function readReplayWorldRoot(root: unknown, subject: string): string {
    if (typeof root !== "string" || root.length === 0 || !path.isAbsolute(root)) {
        throw new TypeError(`${subject} must be an absolute directory path`);
    }
    try {
        return realpathSync(root);
    } catch (error) {
        throw new TypeError(`${subject} must name an existing directory`, { cause: error });
    }
}

function assertReplayWorldEntryBound(count: number): void {
    if (count > replayProtocolConfig.limits.maxWorldEntries) {
        throw new RangeError("world image exceeds the configured entry bound");
    }
}

/** Maps a copy-carrier file digest to the trace-store blob identity of the same bytes. */
function storeBlobId(carrierBlobId: string): BlobId {
    return `${kernelProtocolConfig.store.blobs.idPrefix}${carrierBlobId.slice(
        workspaceProtocolConfig.carrier.blobIdPrefix.length,
    )}`;
}
