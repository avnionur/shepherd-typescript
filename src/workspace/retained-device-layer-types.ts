import type { RETAINED_DEVICE_STATUSES } from "../protocol/values.generated.ts";
import type { RecordId } from "../record/types.ts";
import type {
    DeviceLayerCheckpoint,
    DeviceLayerDepthPolicy,
    DeviceLayerFileEntry,
    DeviceLayerLayer,
    DeviceLayerRestore,
} from "./device-layer-types.ts";

/** Creation request for a durable, locally owned layered world. */
export type RetainedDeviceLayerWorldOptions = {
    /** Globally stable creation command; replay must preserve the complete request. */
    readonly commandId: string;
    /** Existing parent directory under which an exclusively owned resource root is created. */
    readonly root: string;
    /** Supported durable adapter; omitted selects the configured reference adapter. */
    readonly adapter?: string;
    /** Optional seed directory, captured when the creation command first executes. */
    readonly seed?: string;
    /** Optional stricter depth and compaction policy. */
    readonly depth?: Partial<DeviceLayerDepthPolicy>;
};

/** Exact retained world selector; record identity is not authority over arbitrary host paths. */
export type RetainedDeviceLayerSelector = {
    /** Durable world identity returned by creation or inspection. */
    readonly deviceId: string;
};

/** Exact named lifecycle command. */
export type RetainedDeviceLayerNamedCommand = {
    /** Stable command identity; reuse with another request refuses. */
    readonly commandId: string;
    /** Checkpoint to create or restore. */
    readonly name: string;
};

/** Exact physical recovery admission derived from a read-only diagnosis. */
export type RetainedDeviceLayerRecoveryOptions = RetainedDeviceLayerSelector & {
    /** Stable recovery command identity. */
    readonly commandId: string;
    /** Exact diagnosed journal head; movement refuses before physical work. */
    readonly expectedHeadRecordId: RecordId;
};

/** Configured durable device diagnosis status. */
export type RetainedDeviceLayerStatus = (typeof RETAINED_DEVICE_STATUSES)[number];

/** Named retained layer with a verified manifest content identity. */
export type RetainedDeviceLayerSnapshot = DeviceLayerLayer & {
    /** Manifest digest of bytes, paths and portable metadata; not a trace-record reference. */
    readonly contentId: string;
};

/** Durable checkpoint result and its exact completion evidence. */
export type RetainedDeviceLayerCheckpoint = DeviceLayerCheckpoint & {
    /** Canonical lifecycle completion record retained in the trace store. */
    readonly recordId: RecordId;
    /** Writable generation after capture. */
    readonly generation: number;
    /** Exact frozen manifest content identity. */
    readonly contentId: string;
};

/** Durable restoration result and its exact completion evidence. */
export type RetainedDeviceLayerRestore = DeviceLayerRestore & {
    /** Canonical lifecycle completion record retained in the trace store. */
    readonly recordId: RecordId;
    /** New writable generation. */
    readonly generation: number;
};

/** Read-only durable lifecycle and physical availability evidence. */
export type RetainedDeviceLayerInspection = {
    /** Durable world identity. */
    readonly deviceId: string;
    /** Exact current journal head. */
    readonly headRecordId: RecordId;
    /** Actual retained adapter identity. */
    readonly adapter: string;
    /** Content identity of the adapter and lifecycle configuration. */
    readonly configurationId: string;
    /** Monotonic writable generation. */
    readonly generation: number;
    /** Current named frozen layers, oldest first. */
    readonly layers: readonly RetainedDeviceLayerSnapshot[];
    /** Names retired by compaction and never reusable. */
    readonly retiredNames: readonly string[];
    /** Ready, interrupted, cleaned, or physically unavailable according to retained evidence. */
    readonly status: RetainedDeviceLayerStatus;
    /** Explicit unavailability diagnosis, or null. */
    readonly reason: string | null;
    /** Pending operation identity, or null when no recovery is required. */
    readonly pendingCommandId: string | null;
};

/**
 * Durable local layered world. Its close method detaches this handle and retains resources;
 * cleanup is an explicit journaled command. Callers must quiesce direct path writers before
 * checkpoint, restore, recovery or cleanup. A stale handle refuses after another handle advances
 * the journal. Imported records alone do not provide local ownership authority.
 */
export type RetainedDeviceLayerWorld = {
    /** Actual supported adapter. */
    readonly adapter: string;
    /** Durable world identity used to reopen or diagnose. */
    readonly deviceId: string;
    /** Effective depth and compaction policy. */
    readonly depth: DeviceLayerDepthPolicy;
    /** Current writable directory; read again after restore rather than retaining an old path. */
    readonly path: string;
    /**
     * Reads this handle's retained layer list; use inspection for another writer's current head.
     * @returns Immutable named layers and their manifest identities, oldest first.
     */
    readonly layers: () => readonly RetainedDeviceLayerSnapshot[];
    /**
     * Reads one bounded regular file without following symbolic links.
     * @param relativePath - Portable path inside the held writable generation.
     * @returns Fresh file bytes.
     * @throws If the handle is closed/stale, ownership changed, or the path/file is unsafe.
     */
    readonly readFile: (relativePath: string) => Promise<Buffer>;
    /**
     * Writes and flushes bytes in the held writable generation; checkpoint separately to freeze them.
     * @param relativePath - Portable path; missing parent directories are created.
     * @param bytes - Bounded file bytes, observed during this synchronous physical operation.
     * @returns Completion after file and parent-directory flushes.
     * @throws If admission, bounds, ownership or filesystem operations fail.
     */
    readonly writeFile: (relativePath: string, bytes: Buffer) => Promise<void>;
    /**
     * Removes one owned current-world path; an absent path is a no-op.
     * @param relativePath - Portable path inside the held writable generation.
     * @returns Completion after removal and directory flushing.
     * @throws If admission, path ownership, mount checks or removal fail.
     */
    readonly removePath: (relativePath: string) => Promise<void>;
    /**
     * Lists regular files through the bounded tree scanner without traversing symlinks.
     * @returns Immutable file paths and byte digests in path order.
     * @throws If the handle is closed/stale or traversal, ownership or bounds fail.
     */
    readonly listFiles: () => Promise<readonly DeviceLayerFileEntry[]>;
    /**
     * Freezes a named checkpoint and performs configured compaction when needed.
     * @param command - Stable command identity and new checkpoint name.
     * @returns Exact retained completion evidence and manifest identity; completed retries replay it.
     * @throws If the command conflicts, the name is invalid, or capture fails; interrupted work stays diagnosable.
     */
    readonly checkpoint: (
        command: RetainedDeviceLayerNamedCommand,
    ) => Promise<RetainedDeviceLayerCheckpoint>;
    /**
     * Publishes a fresh writable directory from one retained checkpoint, then cleans discarded state.
     * @param command - Stable command identity and retained checkpoint name.
     * @returns Exact completion evidence, new generation and discarded names.
     * @throws If the target is unknown/retired, the request conflicts, or verified restoration fails.
     */
    readonly restore: (
        command: RetainedDeviceLayerNamedCommand,
    ) => Promise<RetainedDeviceLayerRestore>;
    /**
     * Cleans only verified owned resources, retains a durable tombstone and detaches this handle.
     * @param command - Globally exact cleanup command identity within this trace store.
     * @returns Completion after owned cleanup; canonical history remains retained.
     * @throws If admission or ownership fails; interrupted cleanup requires exact-head recovery.
     */
    readonly cleanup: (command: Readonly<{ commandId: string }>) => Promise<void>;
    /**
     * Detaches this handle without deleting the world or closing the caller's trace store.
     * @returns Completion; repeated close calls are harmless.
     */
    readonly close: () => Promise<void>;
};
