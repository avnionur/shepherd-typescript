import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { ROOT_WITNESS_ID, type SQLiteTraceStore } from "../../src/index.ts";
import { kernelProtocolConfig } from "../../src/protocol/config.ts";

/** Size of one synthetic trace dataset used by the scale tier and the kernel benchmark. */
export type KernelDatasetShape = {
    /** Records appended per append intent. */
    readonly batchRecords: number;
    /** Bytes of each registered blob. */
    readonly blobBytes: number;
    /** Registered blobs. */
    readonly blobs: number;
    /** Cuts published on each owner, spread evenly along its path. */
    readonly cutsPerOwner: number;
    /** Records on the single deep-chain owner, each citing its predecessor. */
    readonly deepChainRecords: number;
    /** Content-addressed blob objects written without a durable registration. */
    readonly orphanBlobs: number;
    /** Owners holding the regular records. */
    readonly owners: number;
    /** Records on each regular owner, each citing its predecessor. */
    readonly recordsPerOwner: number;
    /** Abandoned temporary files written into blob fanout directories. */
    readonly temporaryFiles: number;
};

/** Identities of one built dataset. */
export type KernelDataset = {
    /** Registered blob identities in insertion order. */
    readonly blobIds: readonly string[];
    /** Published cut identities in publication order. */
    readonly cutIds: readonly string[];
    /** Owner holding the deep causal chain. */
    readonly deepOwnerId: string;
    /** Last record identity on each owner path. */
    readonly heads: ReadonlyMap<string, string>;
    /** Regular owner identities in creation order. */
    readonly ownerIds: readonly string[];
    /** Planted unregistered blob identities, sorted. */
    readonly orphanBlobIds: readonly string[];
    /** Semantic records appended by the builder, excluding cut publications. */
    readonly recordCount: number;
    /** Schema identifier of every appended record. */
    readonly schemaRef: string;
    /** Planted abandoned temporary files. */
    readonly temporaryFileCount: number;
};

/** Stable naming and payload options of a dataset build. */
export type KernelDatasetNaming = {
    /** Prefix of append-intent, owner, and cut identities. */
    readonly prefix: string;
    /** Characters of padding in every record body. */
    readonly recordPaddingCharacters: number;
    /** Schema identifier of every appended record. */
    readonly schemaRef: string;
};

/**
 * Appends a deterministic dataset: regular owners and one deep owner whose records each cite
 * their predecessor, evenly spaced cuts, registered blobs, and planted blob orphans and
 * abandoned temporary files in the store's blob directory.
 *
 * @param store - Writable, otherwise empty store.
 * @param blobDirectory - Blob root directory of `store`.
 * @param shape - Dataset size.
 * @param naming - Identity prefix, schema, and record padding.
 * @returns Identities needed to read, verify, and collect the dataset.
 * @throws {RangeError} If a count is negative or not an integer, or a batch is empty.
 */
export function buildKernelDataset(
    store: SQLiteTraceStore,
    blobDirectory: string,
    shape: KernelDatasetShape,
    naming: KernelDatasetNaming,
): KernelDataset {
    for (const [name, value] of Object.entries(shape)) {
        if (!Number.isSafeInteger(value) || value < 0) {
            throw new RangeError(`dataset ${name} must be a non-negative integer`);
        }
    }
    if (shape.batchRecords === 0) throw new RangeError("dataset batchRecords must be positive");
    const padding = "x".repeat(naming.recordPaddingCharacters);
    const heads = new Map<string, string>();
    const ownerIds = Array.from(
        { length: shape.owners },
        (_, index) => `${naming.prefix}owner:${index}`,
    );
    const deepOwnerId = `${naming.prefix}deep`;
    const cutIds: string[] = [];
    let intent = 0;
    let recordCount = 0;
    const appendPath = (ownerId: string, records: number, cuts: number): void => {
        const cutEvery = cuts === 0 ? 0 : Math.max(1, Math.floor(records / cuts));
        let written = 0;
        while (written < records) {
            const size = Math.min(shape.batchRecords, records - written);
            const previous = heads.get(ownerId);
            const receipt = store.append({
                append_intent_id: `${naming.prefix}append:${intent}`,
                batch: {
                    groups: [
                        {
                            owner_id: ownerId,
                            records: Array.from({ length: size }, (_, index) => ({
                                append_local_id: `r${index}`,
                                body: { ordinal: written + index, owner: ownerId, padding },
                                ...(index > 0
                                    ? { caused_by_local_refs: [`r${index - 1}`] }
                                    : previous === undefined
                                      ? {}
                                      : { caused_by_record_ids: [previous] }),
                                mode: "capture" as const,
                                schema_ref: naming.schemaRef,
                                witness_ref: ROOT_WITNESS_ID,
                            })),
                        },
                    ],
                },
            });
            intent += 1;
            for (const [index, recordId] of receipt.record_ids.entries()) {
                const ordinal = written + index + 1;
                if (cutEvery > 0 && ordinal % cutEvery === 0 && ordinal / cutEvery <= cuts) {
                    const cutId = `${naming.prefix}cut:${ownerId}:${ordinal}`;
                    store.publishCut({
                        cut_id: cutId,
                        target_owner_id: ownerId,
                        through_record_id: recordId,
                    });
                    cutIds.push(cutId);
                }
            }
            heads.set(ownerId, receipt.record_ids.at(-1) as string);
            written += size;
            recordCount += size;
        }
    };
    for (const ownerId of ownerIds) appendPath(ownerId, shape.recordsPerOwner, shape.cutsPerOwner);
    appendPath(deepOwnerId, shape.deepChainRecords, shape.cutsPerOwner);

    const blobIds = Array.from(
        { length: shape.blobs },
        (_, index) =>
            store.putBlob(blobContent(`${naming.prefix}blob:${index}`, shape.blobBytes)).blob_id,
    );
    const blobConfig = kernelProtocolConfig.store.blobs;
    const orphanBlobIds: string[] = [];
    for (let index = 0; index < shape.orphanBlobs; index += 1) {
        const content = blobContent(`${naming.prefix}orphan:${index}`, shape.blobBytes);
        const digest = createHash(blobConfig.digestAlgorithm).update(content).digest("hex");
        writeBlobObject(
            blobDirectory,
            digest.slice(0, blobConfig.fanoutCharacters),
            digest,
            content,
        );
        orphanBlobIds.push(`${blobConfig.idPrefix}${digest}`);
    }
    for (let index = 0; index < shape.temporaryFiles; index += 1) {
        const digest = createHash(blobConfig.digestAlgorithm)
            .update(`${naming.prefix}temporary:${index}`)
            .digest("hex");
        writeBlobObject(
            blobDirectory,
            digest.slice(0, blobConfig.fanoutCharacters),
            `${blobConfig.temporaryFilePrefix}${digest}`,
            new Uint8Array(0),
        );
    }
    return Object.freeze({
        blobIds: Object.freeze(blobIds),
        cutIds: Object.freeze(cutIds),
        deepOwnerId,
        heads,
        orphanBlobIds: Object.freeze(orphanBlobIds.sort()),
        ownerIds: Object.freeze(ownerIds),
        recordCount,
        schemaRef: naming.schemaRef,
        temporaryFileCount: shape.temporaryFiles,
    });
}

function blobContent(seed: string, bytes: number): Uint8Array {
    const content = new Uint8Array(bytes);
    let block = createHash("sha256").update(seed).digest();
    for (let offset = 0; offset < bytes; offset += block.length) {
        content.set(block.subarray(0, Math.min(block.length, bytes - offset)), offset);
        block = createHash("sha256").update(block).digest();
    }
    return content;
}

function writeBlobObject(root: string, bucket: string, name: string, content: Uint8Array): void {
    const bucketPath = path.join(root, bucket);
    mkdirSync(bucketPath, { mode: 0o700, recursive: true });
    writeFileSync(path.join(bucketPath, name), content, { mode: 0o600 });
}
