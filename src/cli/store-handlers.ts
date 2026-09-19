import {
    closeSync,
    existsSync,
    fsyncSync,
    openSync,
    readFileSync,
    statSync,
    writeFileSync,
} from "node:fs";
import path from "node:path";

import type { SemanticRecord } from "../canonical/canonical-record.ts";
import { TraceArchiveLimitError } from "../interchange/errors.ts";
import { backupTraceStore } from "../operations/backup.ts";
import { backupDigest } from "../operations/backup-manifest.ts";
import { TraceStoreBackupError } from "../operations/errors.ts";
import { restoreTraceStoreBackup, verifyTraceStoreBackup } from "../operations/restore.ts";
import {
    cliProtocolConfig,
    kernelProtocolConfig,
    retentionProtocolConfig,
} from "../protocol/config.ts";
import { exportRedactedTraceArchive } from "../retention/redacted-archive.ts";
import { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import type { TraceStoreMaintenanceMode } from "../store/types.ts";
import {
    type ParsedOptions,
    parseOptions,
    requireNoPositionals,
    requireOption,
    resolveOptionPath,
} from "./arguments.ts";
import { CliUnavailableError, CliUsageError } from "./errors.ts";
import type { CliHandler, CliHandlerIo } from "./types.ts";

const HANDLERS = cliProtocolConfig.handlerRoles;
const OPTIONS = cliProtocolConfig.options;
const MAX_REPORTED_ISSUES = cliProtocolConfig.limits.defaultPageSize;

/** @internal Creates the `store` command handlers addressed by configured handler IDs. */
export function createStoreCliHandlers(): readonly (readonly [string, CliHandler])[] {
    return [
        [HANDLERS.storeVerify, classified(storeVerify)],
        [HANDLERS.storeBackup, classified(storeBackup)],
        [HANDLERS.storeRestore, classified(storeRestore)],
        [HANDLERS.storeExport, storeExport],
        [HANDLERS.storeImport, storeImport],
        [HANDLERS.storeMaintain, storeMaintain],
    ];
}

async function storeMaintain(args: readonly string[], io: CliHandlerIo): Promise<void> {
    const parsed = parseOptions(args, HANDLERS.storeMaintain);
    requireNoPositionals(parsed);
    const configured = kernelProtocolConfig.store.maintenance;
    const mode = parsed.options.get(OPTIONS.mode) ?? configured.defaultMode;
    if (!(configured.modes as readonly string[]).includes(mode)) {
        throw new CliUsageError(`--${OPTIONS.mode} must be one of: ${configured.modes.join(", ")}`);
    }
    const storePath = resolveOptionPath(
        parsed,
        OPTIONS.store,
        io,
        cliProtocolConfig.defaults.traceStorePath,
    );
    if (!existsSync(storePath))
        throw new CliUnavailableError(`trace store is unavailable: ${storePath}`);
    using store = new SQLiteTraceStore(storePath);
    const report = store.maintain({ mode: mode as TraceStoreMaintenanceMode });
    if (!report.quick_check.ok) {
        throw new Error(
            `trace store failed quick_check with ${report.quick_check.issues.length}${report.quick_check.truncated ? "+" : ""} issue(s): ${report.quick_check.issues.slice(0, MAX_REPORTED_ISSUES).join(", ")}`,
        );
    }
    const { after, before } = report;
    io.output(
        `Maintenance: ${report.mode}\nSchema: ${report.schema_version}\nPages: ${before.page_count} -> ${after.page_count} (free ${before.freelist_count} -> ${after.freelist_count})\nWAL bytes: ${before.wal_bytes} -> ${after.wal_bytes}\n`,
        { maintenance: report as unknown as SemanticRecord },
    );
}

async function storeVerify(args: readonly string[], io: CliHandlerIo): Promise<void> {
    const parsed = parseOptions(args, HANDLERS.storeVerify);
    requireNoPositionals(parsed);
    const backupPath = parsed.options.get(OPTIONS.backup);
    if (backupPath === undefined) {
        if (parsed.options.has(OPTIONS.manifest)) {
            throw new CliUsageError(`--${OPTIONS.manifest} requires --${OPTIONS.backup}`);
        }
        verifyStore(parsed, io);
        return;
    }
    if (parsed.options.has(OPTIONS.store)) {
        throw new CliUsageError(`--${OPTIONS.store} and --${OPTIONS.backup} are exclusive`);
    }
    const expectedManifestId = parsed.options.get(OPTIONS.manifest);
    const verification = await verifyTraceStoreBackup(path.resolve(io.cwd, backupPath), {
        ...(expectedManifestId === undefined ? {} : { expectedManifestId }),
    });
    const manifest = verification.manifest;
    io.output(
        `Backup verified: ${manifest.manifest_id}\nSchema: ${manifest.store_schema_version}\nRecords: ${manifest.record_count}\nBlobs: ${manifest.blobs.count}\n`,
        {
            backup_verification: {
                blob_count: manifest.blobs.count,
                export_digest: manifest.export_digest,
                manifest_id: manifest.manifest_id,
                package_version: manifest.package_version,
                record_count: manifest.record_count,
                store_schema_version: manifest.store_schema_version,
                verified_store_schema_version: verification.verified_store_schema_version,
            },
        },
    );
}

function verifyStore(parsed: ParsedOptions, io: CliHandlerIo): void {
    using store = openExistingStore(parsed, io);
    const integrity = store.verifyIntegrity();
    const blobs = store.verifyBlobs();
    // The whole-store integrity scan includes every blob issue that `verifyBlobs` reports.
    if (!integrity.ok || !blobs.ok) {
        const issues = integrity.issues.map(({ kind, subject_id }) => `${kind} ${subject_id}`);
        throw new Error(
            `trace store failed verification with ${issues.length} issue(s): ${issues.slice(0, MAX_REPORTED_ISSUES).join(", ")}`,
        );
    }
    io.output(
        `Trace store verified.\nSchema: ${store.schemaVersion}\nRecords: ${integrity.checked_record_count}\nBlobs: ${blobs.checked_blob_count}\n`,
        {
            store_verification: {
                checked_append_intent_count: integrity.checked_append_intent_count,
                checked_blob_count: blobs.checked_blob_count,
                checked_cut_count: integrity.checked_cut_count,
                checked_owner_count: integrity.checked_owner_count,
                checked_record_count: integrity.checked_record_count,
                checked_scope_count: integrity.checked_scope_count,
                schema_version: store.schemaVersion,
            },
        },
    );
}

async function storeBackup(args: readonly string[], io: CliHandlerIo): Promise<void> {
    const parsed = parseOptions(args, HANDLERS.storeBackup);
    requireNoPositionals(parsed);
    const destination = requirePath(parsed, OPTIONS.output, io);
    using store = openExistingStore(parsed, io);
    const manifest = await backupTraceStore(store, { destination });
    io.output(
        `Backup: ${manifest.manifest_id}\nSchema: ${manifest.store_schema_version}\nRecords: ${manifest.record_count}\nBlobs: ${manifest.blobs.count}\n`,
        {
            backup: {
                blob_count: manifest.blobs.count,
                export_digest: manifest.export_digest,
                manifest_id: manifest.manifest_id,
                package_version: manifest.package_version,
                record_count: manifest.record_count,
                store_schema_version: manifest.store_schema_version,
            },
        },
    );
}

async function storeRestore(args: readonly string[], io: CliHandlerIo): Promise<void> {
    const parsed = parseOptions(args, HANDLERS.storeRestore);
    requireNoPositionals(parsed);
    const backupPath = requirePath(parsed, OPTIONS.backup, io);
    const expectedManifestId = requireOption(parsed, OPTIONS.manifest);
    const target = requirePath(parsed, OPTIONS.store, io);
    const receipt = await restoreTraceStoreBackup(backupPath, target, { expectedManifestId });
    io.output(
        `Restored: ${receipt.manifest_id}\nSchema: ${receipt.store_schema_version}\nRecords: ${receipt.record_count}\nBlobs: ${receipt.blob_count}\n`,
        { restore: receipt as unknown as SemanticRecord },
    );
}

async function storeExport(args: readonly string[], io: CliHandlerIo): Promise<void> {
    const parsed = parseOptions(args, HANDLERS.storeExport);
    requireNoPositionals(parsed);
    const outputPath = requirePath(parsed, OPTIONS.output, io);
    const redacted = parsed.flags.has(OPTIONS.redacted);
    using store = openExistingStore(parsed, io);
    const archive = redacted ? exportRedactedTraceArchive(store) : store.exportTrace();
    let descriptor: number;
    try {
        descriptor = openSync(outputPath, "wx", retentionProtocolConfig.storeFiles.mode);
    } catch (error) {
        throw new CliUsageError(
            `export output cannot be created without overwriting: ${(error as Error).message}`,
        );
    }
    try {
        writeFileSync(descriptor, archive);
        fsyncSync(descriptor);
    } finally {
        closeSync(descriptor);
    }
    const identity = redacted
        ? retentionProtocolConfig.redactedArchive
        : kernelProtocolConfig.interchange;
    const byteLength = Buffer.byteLength(archive, "utf8");
    io.output(`Exported ${identity.format} v${identity.formatVersion} (${byteLength} bytes).\n`, {
        export: {
            byte_length: byteLength,
            digest: backupDigest(archive),
            format: identity.format,
            format_version: identity.formatVersion,
        },
    });
}

async function storeImport(args: readonly string[], io: CliHandlerIo): Promise<void> {
    const parsed = parseOptions(args, HANDLERS.storeImport);
    requireNoPositionals(parsed);
    const inputPath = requirePath(parsed, OPTIONS.input, io);
    const stats = statSync(inputPath, { throwIfNoEntry: false });
    if (stats === undefined) {
        throw new CliUnavailableError(`import archive is unavailable: ${inputPath}`);
    }
    const { maxArchiveBytes } = kernelProtocolConfig.interchange.limits;
    // Refuse before reading so an oversized file is never loaded into memory.
    if (stats.size > maxArchiveBytes) {
        throw new TraceArchiveLimitError("maxArchiveBytes", maxArchiveBytes);
    }
    const archive = readFileSync(inputPath, "utf8");
    using store = new SQLiteTraceStore(
        resolveOptionPath(parsed, OPTIONS.store, io, cliProtocolConfig.defaults.traceStorePath),
    );
    const receipt = store.importTrace(archive);
    io.output(
        `Imported ${receipt.imported_record_count} record(s) and ${receipt.imported_blob_count} blob(s).\n`,
        { import: receipt as unknown as SemanticRecord },
    );
}

function openExistingStore(parsed: ParsedOptions, io: CliHandlerIo): SQLiteTraceStore {
    const storePath = resolveOptionPath(
        parsed,
        OPTIONS.store,
        io,
        cliProtocolConfig.defaults.traceStorePath,
    );
    if (!existsSync(storePath))
        throw new CliUnavailableError(`trace store is unavailable: ${storePath}`);
    return new SQLiteTraceStore(storePath, { readOnly: true });
}

function requirePath(parsed: ParsedOptions, name: string, io: CliHandlerIo): string {
    return path.resolve(io.cwd, requireOption(parsed, name));
}

function classified(handler: CliHandler): CliHandler {
    return async (args, io) => {
        try {
            await handler(args, io);
        } catch (error) {
            if (error instanceof TraceStoreBackupError) {
                throw new Error(`${error.reason}: ${error.message}`, { cause: error });
            }
            throw error;
        }
    };
}
