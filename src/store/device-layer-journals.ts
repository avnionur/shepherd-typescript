import { lstatSync, realpathSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import type { AppendBatchDraft } from "../append/types.ts";
import { createRecordId } from "../canonical/canonical-record.ts";
import {
    kernelProtocolConfig,
    recordIdConfig,
    workspaceProtocolConfig,
} from "../protocol/config.ts";
import { RECORD_MODES } from "../protocol/values.generated.ts";
import { assertRecordId } from "../record/guards.ts";
import type { RecordId } from "../record/types.ts";
import { runInSQLiteTransaction } from "../runtime/sqlite-transaction.ts";
import { appendWithinTraceStoreTransaction } from "./append.ts";
import { STORE_TABLES, STORE_TRANSACTION_SQL } from "./constants.ts";
import { AppendIntentConflictError, TraceStoreError } from "./errors.ts";
import { readStoredRecord } from "./read.ts";
import { readScopeHead } from "./scope-registrations.ts";
import type { AppendReceipt, StoreAppendRequest } from "./types.ts";

const config = workspaceProtocolConfig.deviceLayers.retained;

/** Local authority is deliberately absent from native trace exports. @internal */
export type DeviceLayerRegistration = {
    /** Exact creation record in the canonical journal. */
    readonly creation_record_id: RecordId;
    /** Physical SQLite file identity; copied databases do not inherit device authority. */
    readonly database_identity: RecordId;
};

/** Synchronous journal work admitted while the SQLite write lock is held. @internal */
export type DeviceLayerJournalWork<T> = {
    /** Optional canonical publication following the physical stage. */
    readonly request: StoreAppendRequest | null;
    /** Stage result returned only after commit. */
    readonly value: T;
};

/** Refuses ungoverned appends to retained device owners. @internal */
export function assertUnreservedDeviceLayerOwner(owner: string): void {
    if (owner.startsWith(config.ownerIdPrefix) || owner.startsWith(config.commandOwnerPrefix)) {
        throw new TraceStoreError("retained device journals require local lifecycle authority");
    }
}

/** Refuses every reserved device owner in a general batch. @internal */
export function assertUnreservedDeviceLayerOwners(batch: AppendBatchDraft): void {
    for (const group of batch.groups) assertUnreservedDeviceLayerOwner(group.owner_id);
}

/** Reads local device registration without touching resources. @internal */
export function readDeviceLayerRegistration(
    database: DatabaseSync,
    deviceId: string,
): DeviceLayerRegistration | undefined {
    return database
        .prepare(
            `SELECT creation_record_id, database_identity FROM ${STORE_TABLES.deviceLayerRegistrations} WHERE device_id = ?`,
        )
        .get(deviceId) as DeviceLayerRegistration | undefined;
}

/** Verifies registration evidence while allowing a backup's inactive physical-file binding. @internal */
export function verifyDeviceLayerRegistration(database: DatabaseSync, deviceId: string): void {
    const row = readDeviceLayerRegistration(database, deviceId);
    if (row === undefined) throw new TraceStoreError("retained device registration is absent");
    assertRecordId(row.database_identity, "registered database identity");
    const record = readStoredRecord(database, row.creation_record_id);
    const command = record?.body.command_id;
    if (
        record === undefined ||
        typeof command !== "string" ||
        command.length === 0 ||
        record.envelope.schema_ref !== config.traceSchema ||
        record.envelope.mode !== RECORD_MODES[0] ||
        record.body.device_id !== deviceId ||
        record.body.phase !== config.phases.prepared ||
        record.body.operation !== config.actions.open ||
        deviceId !==
            config.ownerIdPrefix +
                createRecordId({ command_id: command }).slice(recordIdConfig.prefix.length) ||
        !record.views.some(
            (view) =>
                view.owner_id === deviceId &&
                view.owner_ordinal === kernelProtocolConfig.append.firstOwnerOrdinal,
        )
    )
        throw new TraceStoreError("retained device registration differs from creation evidence");
}

/** Identifies the current ordinary database file; memory and linked files refuse. @internal */
export function deviceLayerDatabaseIdentity(database: DatabaseSync): RecordId {
    const location = database.location();
    if (location === null)
        throw new TraceStoreError("retained device layers require a file-backed trace store");
    const status = lstatSync(location, { bigint: true });
    if (
        !status.isFile() ||
        status.nlink !== 1n ||
        status.uid !== BigInt(process.getuid?.() ?? -1) ||
        (status.mode & 0o077n) !== 0n
    )
        throw new TraceStoreError("retained device database must be a single-link regular file");
    return createRecordId({
        path: realpathSync(location),
        device: String(status.dev),
        inode: String(status.ino),
    });
}

/**
 * Executes one exact-head synchronous stage while the store owns SQLite's write lock.
 * Registration is admitted only with the first canonical append; imported or copied databases
 * refuse before the callback can touch a physical resource.
 * @internal
 */
export function runDeviceLayerJournalWork<T>(
    database: DatabaseSync,
    deviceId: string,
    expectedHead: RecordId | null,
    work: () => DeviceLayerJournalWork<T>,
): { readonly receipt: AppendReceipt | null; readonly value: T } {
    if (!deviceId.startsWith(config.ownerIdPrefix))
        throw new TypeError("invalid retained device identity");
    return runInSQLiteTransaction(database, STORE_TRANSACTION_SQL, () => {
        const head = readScopeHead(database, deviceId)?.record_id ?? null;
        if (head !== expectedHead)
            throw new AppendIntentConflictError("retained device journal head moved");
        const registration = readDeviceLayerRegistration(database, deviceId);
        const databaseIdentity = deviceLayerDatabaseIdentity(database);
        if (
            (expectedHead !== null && registration === undefined) ||
            (registration !== undefined && registration.database_identity !== databaseIdentity)
        ) {
            throw new TraceStoreError("retained device has no authority in this database file");
        }
        if (registration !== undefined) {
            verifyDeviceLayerRegistration(database, deviceId);
            const first = database
                .prepare(
                    `SELECT record_id FROM ${STORE_TABLES.recordViews} WHERE owner_id = ? ORDER BY owner_ordinal LIMIT 1`,
                )
                .get(deviceId);
            if (expectedHead === null || first?.record_id !== registration.creation_record_id)
                throw new TraceStoreError(
                    "retained device creation registration differs from its journal",
                );
        }
        const result = work();
        const receipt =
            result.request === null
                ? null
                : appendWithinTraceStoreTransaction(database, result.request);
        if (expectedHead === null) {
            const creationRecord = readScopeHead(database, deviceId)?.record_id ?? null;
            if (creationRecord === null || receipt === null)
                throw new TraceStoreError(
                    "retained device registration requires creation evidence",
                );
            database
                .prepare(
                    `INSERT INTO ${STORE_TABLES.deviceLayerRegistrations}(device_id, creation_record_id, database_identity) VALUES (?, ?, ?)`,
                )
                .run(deviceId, creationRecord, databaseIdentity);
        }
        return { receipt, value: result.value };
    });
}
