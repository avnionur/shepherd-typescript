import {
    BACKUP_JOURNAL_MODES,
    type ProtocolConfig,
    SECURE_HASH_ALGORITHMS,
} from "./config-types.ts";
import {
    readAbsoluteUrl,
    readEnum,
    readNonEmptyString,
    readObject,
    readPositiveInteger,
    readUniqueStrings,
} from "./config-value-readers.ts";

const SINGLE_SEGMENT = /^[A-Za-z0-9._-]+$/u;

/**
 * Validates the backup section: manifest identity, digest algorithm, owner-only directory mode,
 * failure and blob-location vocabularies, backup layout names, and resource bounds.
 *
 * @param value - Untrusted `backup` section.
 * @param archiveFormat - Validated importable native archive format, which the manifest format
 * must never reuse.
 * @param blobs - Validated store blob identity; the backup database digest is used as a blob
 * identifier by replication, so its algorithm and prefix must equal the blob identity's.
 * @returns The validated backup configuration.
 * @throws {TypeError} If a field is missing, malformed, not owner-only, or inconsistent.
 */
export function readBackupConfig(
    value: unknown,
    archiveFormat: string,
    blobs: Pick<ProtocolConfig["kernel"]["store"]["blobs"], "digestAlgorithm" | "idPrefix">,
): ProtocolConfig["backup"] {
    const backup = readObject(
        value,
        [
            "artifacts",
            "blobLocations",
            "compatibilityVersion",
            "databaseJournalMode",
            "digestAlgorithm",
            "digestPrefix",
            "directoryMode",
            "failureReasons",
            "layout",
            "limits",
            "manifest",
            "schemas",
        ],
        "backup",
    );
    const artifacts = readObject(backup.artifacts, ["manifestSchema"], "backup.artifacts");
    const digestAlgorithm = readEnum(
        backup.digestAlgorithm,
        SECURE_HASH_ALGORITHMS,
        "backup.digestAlgorithm",
    );
    const digestPrefix = readNonEmptyString(backup.digestPrefix, "backup.digestPrefix");
    if (digestPrefix !== `${digestAlgorithm}:`) {
        throw new TypeError("backup.digestPrefix must identify the configured hash algorithm");
    }
    if (digestAlgorithm !== blobs.digestAlgorithm || digestPrefix !== blobs.idPrefix) {
        throw new TypeError(
            "backup.digestAlgorithm and backup.digestPrefix must equal kernel.store.blobs.digestAlgorithm and idPrefix",
        );
    }
    const modeText = readNonEmptyString(backup.directoryMode, "backup.directoryMode");
    const directoryMode = Number.parseInt(modeText, 8);
    // Owner read, write, and search are required; any group or other bit would expose the copy.
    if (
        !/^0[0-7]{3}$/u.test(modeText) ||
        (directoryMode & 0o700) !== 0o700 ||
        (directoryMode & 0o077) !== 0
    ) {
        throw new TypeError("backup.directoryMode must be an owner-only octal directory mode");
    }
    const layout = readObject(
        backup.layout,
        ["blobDirectory", "database", "manifest", "stagingPrefix", "temporarySuffix"],
        "backup.layout",
    );
    const names = {
        blobDirectory: readLayoutName(layout.blobDirectory, "backup.layout.blobDirectory"),
        database: readLayoutName(layout.database, "backup.layout.database"),
        manifest: readLayoutName(layout.manifest, "backup.layout.manifest"),
        stagingPrefix: readLayoutName(layout.stagingPrefix, "backup.layout.stagingPrefix"),
        temporarySuffix: readLayoutName(layout.temporarySuffix, "backup.layout.temporarySuffix"),
    };
    if (
        new Set([
            names.blobDirectory,
            names.database,
            names.manifest,
            `${names.manifest}${names.temporarySuffix}`,
        ]).size !== 4
    ) {
        throw new TypeError("backup.layout names must be distinct");
    }
    const limits = readObject(backup.limits, ["maxManifestBytes", "pagesPerStep"], "backup.limits");
    const manifest = readObject(backup.manifest, ["format", "formatVersion"], "backup.manifest");
    const format = readNonEmptyString(manifest.format, "backup.manifest.format");
    if (format === archiveFormat) {
        throw new TypeError(
            "backup.manifest.format must differ from the importable archive format",
        );
    }
    const schemas = readObject(backup.schemas, ["manifestId"], "backup.schemas");
    return {
        artifacts: {
            manifestSchema: readNonEmptyString(
                artifacts.manifestSchema,
                "backup.artifacts.manifestSchema",
            ),
        },
        blobLocations: readUniqueStrings(backup.blobLocations, "backup.blobLocations"),
        compatibilityVersion: readNonEmptyString(
            backup.compatibilityVersion,
            "backup.compatibilityVersion",
        ),
        databaseJournalMode: readEnum(
            backup.databaseJournalMode,
            BACKUP_JOURNAL_MODES,
            "backup.databaseJournalMode",
        ),
        digestAlgorithm,
        digestPrefix,
        directoryMode,
        failureReasons: readUniqueStrings(backup.failureReasons, "backup.failureReasons"),
        layout: names,
        limits: {
            maxManifestBytes: readPositiveInteger(
                limits.maxManifestBytes,
                "backup.limits.maxManifestBytes",
            ),
            pagesPerStep: readPositiveInteger(limits.pagesPerStep, "backup.limits.pagesPerStep"),
        },
        manifest: {
            format,
            formatVersion: readPositiveInteger(
                manifest.formatVersion,
                "backup.manifest.formatVersion",
            ),
        },
        schemas: {
            manifestId: readAbsoluteUrl(schemas.manifestId, "backup.schemas.manifestId"),
        },
    };
}

function readLayoutName(value: unknown, path: string): string {
    const name = readNonEmptyString(value, path);
    if (!SINGLE_SEGMENT.test(name) || name === "." || name === "..") {
        throw new TypeError(`${path} must be one portable path segment`);
    }
    return name;
}
