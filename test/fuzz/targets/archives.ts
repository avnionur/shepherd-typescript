import assert from "node:assert/strict";

import {
    canonicalizeRecord,
    type SemanticRecord,
    SQLiteTraceStore,
    verifyRedactedTraceArchive,
} from "../../../src/index.ts";
import { decodeTraceArchive } from "../../../src/interchange/decode.ts";
import {
    backupDigest,
    encodeBackupManifest,
    parseBackupManifest,
    sealBackupManifest,
    type TraceStoreBackupManifest,
} from "../../../src/operations/backup-manifest.ts";
import { backupProtocolConfig, kernelProtocolConfig } from "../../../src/protocol/config.ts";
import { STORE_BACKUP_BLOB_LOCATIONS } from "../../../src/protocol/values.generated.ts";
import type { FuzzInput, FuzzTarget } from "../harness.ts";
import { assertCanonicalStable } from "./records.ts";
import { archiveSeeds } from "./seeds.ts";

function textOf(input: FuzzInput): string {
    return input.kind === "text" ? input.text : (input.value as string);
}

function fingerprint(decoded: ReturnType<typeof decodeTraceArchive>): string {
    return canonicalizeRecord({
        ...decoded,
        blobs: decoded.blobs.map((blob) => ({
            ...blob,
            content: Buffer.from(blob.content).toString("base64"),
        })),
    } as unknown as SemanticRecord);
}

function textSeeds(values: readonly string[]): readonly FuzzInput[] {
    return values.map((text) => ({ kind: "text", text }));
}

const decode: FuzzTarget = {
    name: "decodeTraceArchive",
    prepare: async () => ({
        execute: (input) => decodeTraceArchive(textOf(input)),
        seeds: textSeeds(archiveSeeds().archives),
        verifyAccepted: (result, input) => {
            const decoded = result as ReturnType<typeof decodeTraceArchive>;
            // Decoding is deterministic and every decoded record re-encodes canonically.
            // Canonical fingerprints instead of deepEqual: node's comparison recurses on the
            // harness stack and would overflow on deep (but accepted) record bodies.
            assert.equal(fingerprint(decodeTraceArchive(textOf(input))), fingerprint(decoded));
            for (const record of decoded.records) {
                assertCanonicalStable(canonicalizeRecord(record.body));
                assertCanonicalStable(
                    canonicalizeRecord(record.envelope as unknown as SemanticRecord),
                );
            }
        },
    }),
};

const importArchive: FuzzTarget = {
    name: "importTrace",
    prepare: async () => ({
        execute: (input) => {
            using store = new SQLiteTraceStore();
            const receipt = store.importTrace(textOf(input));
            const integrity = store.verifyIntegrity();
            return { exported: store.exportTrace(), integrity: integrity.ok, receipt };
        },
        seeds: textSeeds(archiveSeeds().archives),
        verifyAccepted: (result) => {
            const { exported, integrity } = result as { exported: string; integrity: boolean };
            assert.equal(integrity, true);
            // An imported archive exports canonically and imports again to the same export.
            assertCanonicalStable(exported);
            using again = new SQLiteTraceStore();
            again.importTrace(exported);
            assert.equal(again.exportTrace(), exported);
        },
    }),
};

const redacted: FuzzTarget = {
    name: "verifyRedactedTraceArchive",
    prepare: async () => ({
        execute: (input) => verifyRedactedTraceArchive(textOf(input)),
        seeds: textSeeds(archiveSeeds().redactedArchives),
        verifyAccepted: (result, input) => {
            assert.deepEqual(verifyRedactedTraceArchive(textOf(input)), result);
        },
    }),
};

function manifestSeed(): string {
    const layout = backupProtocolConfig.layout;
    const digest = backupDigest("fuzz");
    return encodeBackupManifest(
        sealBackupManifest({
            archive_format: kernelProtocolConfig.interchange.format,
            archive_format_version: kernelProtocolConfig.interchange.formatVersion,
            backup_compatibility_version: backupProtocolConfig.compatibilityVersion,
            blobs: {
                byte_length: 14,
                count: 1,
                directory: layout.blobDirectory,
                list_digest: digest,
                location: STORE_BACKUP_BLOB_LOCATIONS[0],
            },
            cut_count: 1,
            cut_heads: [
                { owner_id: "run:fuzz", owner_ordinal: 1, record_id: `sha256:${"a".repeat(64)}` },
            ],
            database: { byte_length: 4096, digest, file: layout.database },
            export_digest: digest,
            format: backupProtocolConfig.manifest.format,
            format_version: backupProtocolConfig.manifest.formatVersion,
            package_version: "2.31.0",
            record_count: 3,
            store_schema_version: kernelProtocolConfig.store.schemaVersion,
        }),
    );
}

const backupManifest: FuzzTarget = {
    name: "parseBackupManifest",
    prepare: async () => ({
        execute: (input) => parseBackupManifest(textOf(input)),
        seeds: textSeeds([manifestSeed()]),
        verifyAccepted: (result, input) => {
            // Only the exact canonical encoding is accepted, so re-encoding reproduces the input.
            const encoded = encodeBackupManifest(result as TraceStoreBackupManifest);
            assert.equal(encoded, textOf(input));
            assertCanonicalStable(encoded.trimEnd());
        },
    }),
};

/** Native archive decode and import, redacted verification, and backup manifest targets. */
export const ARCHIVE_TARGETS: readonly FuzzTarget[] = [
    decode,
    importArchive,
    redacted,
    backupManifest,
];
