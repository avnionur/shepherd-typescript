import type { DEVICE_LAYER_ADAPTERS } from "../protocol/values.generated.ts";
import type { BackendSelectionMode } from "./types.ts";

/** Configured built-in device-layer adapter name. */
export type DeviceLayerAdapterName = (typeof DEVICE_LAYER_ADAPTERS)[number];

/** Host availability reported by one device-layer adapter probe. */
export type DeviceLayerProbe =
    | {
          /** The adapter can open devices on this host. */
          readonly available: true;
      }
    | {
          /** The adapter cannot open devices on this host. */
          readonly available: false;
          /** Stable availability reason; built-in adapters report configured reasons. */
          readonly reason: string;
          /** Host diagnostic for operators; never part of retained identity. */
          readonly detail: string;
      };

/** Private host locations and seed the engine hands to {@link DeviceLayerAdapter.open}. */
export type DeviceLayerOpenContext = {
    /** Layer identifier the adapter must give the seeded base layer. */
    readonly baseLayer: string;
    /** Engine-assigned device identifier, unique under the caller root. */
    readonly deviceId: string;
    /** Existing empty private host directory the device owns until it is closed. */
    readonly root: string;
    /** Existing host directory copied into the base layer, or null for an empty base. */
    readonly seed: string | null;
};

/** One regular file of a device-layer world. */
export type DeviceLayerFileEntry = {
    /** Configured digest of the file bytes (`sha256:<hex>`). */
    readonly digest: string;
    /** World-relative path using `/` separators. */
    readonly path: string;
};

/** Frozen layers the device flattens while freezing one checkpoint. */
export type DeviceLayerCompactionRequest = {
    /** Engine-assigned identifier of the flattened replacement layer. */
    readonly into: string;
    /** Bottom frozen layers, oldest first, whose merged view the replacement layer holds. */
    readonly layers: readonly string[];
};

/** One freeze instruction the engine gives a device. */
export type DeviceLayerFreezeRequest = {
    /** Optional compaction applied after freezing, before the device resumes writes. */
    readonly compaction: DeviceLayerCompactionRequest | null;
    /** Engine-assigned identifier of the layer receiving the current writable state. */
    readonly layer: string;
};

/**
 * One open device: the physical world an adapter maintains as a stack of frozen layers under one
 * writable layer. Every method is called by the engine one at a time, never concurrently.
 */
export type DeviceLayerDevice = {
    /** Closes the device and releases every host resource; the engine removes its root after. */
    readonly close: () => Promise<void>;
    /**
     * Freezes the writable state as a new top frozen layer, optionally flattens the bottom frozen
     * layers into one replacement layer, and resumes with an empty writable layer.
     *
     * After a compaction every frozen layer above the replacement keeps its exact content.
     */
    readonly freeze: (request: DeviceLayerFreezeRequest) => Promise<void>;
    /** Lists every regular file of the current world, in any order. */
    readonly listFiles: () => Promise<readonly DeviceLayerFileEntry[]>;
    /** Maximum frozen layers, the base included, this device can stack. */
    readonly maxLayers: number;
    /** Host directory exposing the writable world, or null when the world is not on the host. */
    readonly path: string | null;
    /** Reads one regular file of the current world. */
    readonly readFile: (relativePath: string) => Promise<Buffer>;
    /** Removes one path of the current world recursively; absent paths are not an error. */
    readonly removePath: (relativePath: string) => Promise<void>;
    /**
     * Discards the writable state and every frozen layer above `layers`, resuming with an empty
     * writable layer over exactly `layers`, a non-empty prefix of the current stack.
     */
    readonly revert: (layers: readonly string[]) => Promise<void>;
    /** Writes one regular file of the current world, creating missing parent directories. */
    readonly writeFile: (relativePath: string, bytes: Buffer) => Promise<void>;
};

/**
 * Pluggable device-layer adapter contract: the carrier backend contract generalized to any
 * substrate that can freeze a writable layer as a named lower layer. Adapters pass
 * {@link checkDeviceLayerConformance} before use.
 */
export type DeviceLayerAdapter = {
    /** Adapter name; built-in adapters use configured names. */
    readonly name: string;
    /** Opens one device whose base layer holds the seed. */
    readonly open: (context: DeviceLayerOpenContext) => Promise<DeviceLayerDevice>;
    /** Probes host availability inside a private scratch directory without leaving state. */
    readonly probe: (context: Readonly<{ root: string }>) => Promise<DeviceLayerProbe>;
};

/** One adapter tried while selecting the adapter of a device-layer world. */
export type DeviceLayerSelectionAttempt = {
    /** Adapter that was probed. */
    readonly adapter: string;
    /** Whether the probe reported the adapter available. */
    readonly available: boolean;
    /** Probe reason: the configured available reason or the adapter's refusal reason. */
    readonly reason: string;
};

/** Selection evidence naming the requested and the actually used adapter. */
export type DeviceLayerSelection = {
    /** Every adapter probed, in order, ending with the used adapter. */
    readonly attempts: readonly DeviceLayerSelectionAttempt[];
    /** Selection mode applied. */
    readonly mode: BackendSelectionMode;
    /** Adapter the caller requested, or the configured default. */
    readonly requested: string;
    /** Adapter the world uses; equals `requested` in strict mode. */
    readonly used: string;
};

/** One frozen layer of a world's current stack. */
export type DeviceLayerLayer = {
    /** Checkpoint name whose state this layer's merged view holds. */
    readonly checkpoint: string;
    /** Zero-based position in the stack; 0 is the base. */
    readonly index: number;
    /** Engine-assigned layer identifier. */
    readonly layer: string;
};

/** Evidence of one compaction performed while freezing a checkpoint. */
export type DeviceLayerCompaction = {
    /** Replacement layer holding the merged view of the flattened layers. */
    readonly into: string;
    /** Flattened layer identifiers, oldest first. */
    readonly layers: readonly string[];
    /** Checkpoint names no longer restorable; the newest flattened name moves to `into`. */
    readonly retired: readonly string[];
};

/** Result of freezing one named checkpoint. */
export type DeviceLayerCheckpoint = {
    /** Checkpoint name. */
    readonly checkpoint: string;
    /** Compaction performed to respect the depth bound, or null. */
    readonly compaction: DeviceLayerCompaction | null;
    /** Stack depth after the checkpoint, the base included. */
    readonly depth: number;
    /** Layer that froze the writable state. */
    readonly layer: string;
};

/** Result of restoring one named checkpoint. */
export type DeviceLayerRestore = {
    /** Restored checkpoint name. */
    readonly checkpoint: string;
    /** Stack depth after the restore, the base included. */
    readonly depth: number;
    /** Checkpoint names above the restored one that were discarded. */
    readonly discarded: readonly string[];
};

/** Depth bound and compaction retention of one world. */
export type DeviceLayerDepthPolicy = {
    /** Maximum frozen layers, the base included; at most the configured and device limits. */
    readonly maxDepth: number;
    /** Newest frozen layers kept separate by compaction; between 1 and `maxDepth - 2`. */
    readonly retainNewest: number;
};

/** Options for {@link openDeviceLayerWorld}. */
export type DeviceLayerWorldOptions = {
    /** Requested adapter name; omitted uses the configured default adapter. */
    readonly adapter?: string;
    /** Selectable adapters; omitted uses {@link createDeviceLayerAdapters}. */
    readonly adapters?: readonly DeviceLayerAdapter[];
    /** Optional stricter depth policy; omitted fields use the configured depth policy. */
    readonly depth?: Partial<DeviceLayerDepthPolicy>;
    /** Fallback order by adapter name; omitted uses the configured order. */
    readonly fallbackOrder?: readonly string[];
    /** Existing host directory under which the engine creates the private device root. */
    readonly root: string;
    /** Existing host directory seeding the base layer; omitted starts empty. */
    readonly seed?: string;
    /** Selection mode; omitted uses the configured default mode (`strict`). */
    readonly selection?: BackendSelectionMode;
};

/**
 * One open layered world: a writable layer over a bounded stack of named frozen checkpoints.
 * Operations are serialized; callers must quiesce writers that bypass these methods through
 * {@link DeviceLayerWorld.path} before calling {@link DeviceLayerWorld.checkpoint} or
 * {@link DeviceLayerWorld.restore}.
 */
export type DeviceLayerWorld = {
    /** Adapter the world uses. */
    readonly adapter: string;
    /**
     * Freezes the writable layer as a new named frozen layer. When the stack would exceed
     * {@link DeviceLayerWorld.depth}, the device first flattens the oldest layers so that exactly
     * `retainNewest` layers remain above one replacement base.
     *
     * @throws {DeviceLayerError} If the name is invalid or in use, the world is closed, or the
     * adapter fails.
     */
    readonly checkpoint: (name: string) => Promise<DeviceLayerCheckpoint>;
    /** Closes the world and removes its private device root. Idempotent. */
    readonly close: () => Promise<void>;
    /** Effective depth policy. */
    readonly depth: DeviceLayerDepthPolicy;
    /** Engine-assigned device identifier. */
    readonly deviceId: string;
    /** Current frozen stack, base first. */
    readonly layers: () => readonly DeviceLayerLayer[];
    /** Lists every regular file of the current world, sorted by path. */
    readonly listFiles: () => Promise<readonly DeviceLayerFileEntry[]>;
    /** Host directory exposing the writable world, or null when it is not on the host. */
    readonly path: string | null;
    /** Reads one regular file. */
    readonly readFile: (relativePath: string) => Promise<Buffer>;
    /** Removes one path recursively. */
    readonly removePath: (relativePath: string) => Promise<void>;
    /**
     * Discards the writable layer and every checkpoint above `name`, resuming at its state.
     *
     * @throws {DeviceLayerError} With the retired code for a name compacted away, the unknown code
     * for any other name outside the current stack.
     */
    readonly restore: (name: string) => Promise<DeviceLayerRestore>;
    /** Adapter selection evidence. */
    readonly selection: DeviceLayerSelection;
    /** Writes one regular file, creating missing parent directories. */
    readonly writeFile: (relativePath: string, bytes: Buffer) => Promise<void>;
};

/** One case of the device-layer conformance kit. */
export type DeviceLayerConformanceCase = {
    /** Failure diagnostic, or null when the case passed. */
    readonly error: string | null;
    /** Case name. */
    readonly name: string;
    /** Whether the case passed. */
    readonly passed: boolean;
};

/** Result of {@link checkDeviceLayerConformance}. */
export type DeviceLayerConformanceReport = {
    /** Adapter under test. */
    readonly adapter: string;
    /** Every case, in execution order. */
    readonly cases: readonly DeviceLayerConformanceCase[];
    /** Whether every case passed. */
    readonly passed: boolean;
};
