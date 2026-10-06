import {
    readAbsoluteUrl,
    readNonEmptyString,
    readObject,
    readPositiveInteger,
} from "./config-value-readers.ts";

/** Durable device lifecycle identity, physical layout and resource bounds. */
export type RetainedDeviceLayersConfig = {
    /** Versioned lifecycle namespace. */
    readonly compatibilityVersion: string;
    /** Canonical record body version. */
    readonly recordVersion: number;
    /** Canonical lifecycle record schema. */
    readonly traceSchema: string;
    /** Published JSON schema identifier. */
    readonly schemaId: string;
    /** Generated schema destination. */
    readonly schemaPath: string;
    /** Durable world owner prefix. */
    readonly ownerIdPrefix: string;
    /** Globally unique command owner prefix. */
    readonly commandOwnerPrefix: string;
    /** Configuration identity prefix. */
    readonly configurationIdPrefix: string;
    /** Exclusive resource directory prefix. */
    readonly rootDirectoryPrefix: string;
    /** Private ownership marker filename. */
    readonly ownershipFilename: string;
    /** Directory holding frozen snapshots. */
    readonly layersDirectory: string;
    /** Writable generation directory prefix. */
    readonly writableDirectoryPrefix: string;
    /** Partial publication directory prefix. */
    readonly stagingDirectoryPrefix: string;
    /** Payload directory inside each owned tree wrapper. */
    readonly treeDirectory: string;
    /** Private directory permission bits. */
    readonly directoryMode: number;
    /** Private marker permission bits. */
    readonly fileMode: number;
    /** Durable payload-directory ownership receipt. */
    readonly payloadIdentityFilename: string;
    /** Marker format version. */
    readonly markerVersion: number;
    /** Supported adapter names by physical materialization role. */
    readonly adapters: { readonly copy: string; readonly clone: string };
    /** Lifecycle operations by role. */
    readonly actions: {
        readonly open: string;
        readonly checkpoint: string;
        readonly restore: string;
        readonly cleanup: string;
    };
    /** Read-only diagnosis statuses by role. */
    readonly statuses: {
        readonly ready: string;
        readonly pending: string;
        readonly cleaned: string;
        readonly unavailable: string;
    };
    /** Journal publication phases. */
    readonly phases: {
        readonly prepared: string;
        readonly published: string;
        readonly completed: string;
    };
    /** Bounded snapshot traversal. */
    readonly limits: {
        /** Maximum bytes in one ownership receipt. */
        readonly maxMarkerBytes: number;
        /** Maximum entries including directories and links. */
        readonly maxEntries: number;
        /** Maximum bytes in one regular file. */
        readonly maxFileBytes: number;
        /** Maximum aggregate regular-file bytes. */
        readonly maxTotalBytes: number;
    };
};

/** Validates the closed durable lifecycle configuration. @internal */
export function readRetainedDeviceLayersConfig(value: unknown): RetainedDeviceLayersConfig {
    const fields = readObject(
        value,
        [
            "compatibilityVersion",
            "recordVersion",
            "traceSchema",
            "schemaId",
            "schemaPath",
            "ownerIdPrefix",
            "commandOwnerPrefix",
            "configurationIdPrefix",
            "rootDirectoryPrefix",
            "ownershipFilename",
            "layersDirectory",
            "writableDirectoryPrefix",
            "stagingDirectoryPrefix",
            "markerVersion",
            "payloadIdentityFilename",
            "treeDirectory",
            "directoryMode",
            "fileMode",
            "adapters",
            "actions",
            "phases",
            "statuses",
            "limits",
        ],
        "retained device layers",
    );
    const strings = <const Keys extends readonly string[]>(value: unknown, keys: Keys) => {
        const input = readObject(value, keys, "retained device vocabulary");
        return Object.fromEntries(
            keys.map((key) => [key, readNonEmptyString(input[key], key)]),
        ) as { readonly [Key in Keys[number]]: string };
    };
    const limits = readObject(
        fields.limits,
        ["maxEntries", "maxFileBytes", "maxTotalBytes", "maxMarkerBytes"],
        "retained device limits",
    );
    const text = Object.fromEntries(
        [
            "compatibilityVersion",
            "traceSchema",
            "schemaPath",
            "ownerIdPrefix",
            "commandOwnerPrefix",
            "configurationIdPrefix",
            "rootDirectoryPrefix",
            "ownershipFilename",
            "layersDirectory",
            "writableDirectoryPrefix",
            "stagingDirectoryPrefix",
            "treeDirectory",
            "payloadIdentityFilename",
        ].map((key) => [key, readNonEmptyString(fields[key], key)]),
    );
    for (const key of [
        "rootDirectoryPrefix",
        "ownershipFilename",
        "layersDirectory",
        "writableDirectoryPrefix",
        "stagingDirectoryPrefix",
        "treeDirectory",
        "payloadIdentityFilename",
    ]) {
        if (/[/\\\0]|^\.\.?$/u.test(text[key] as string))
            throw new TypeError("retained device layout must use simple names");
    }
    return {
        ...text,
        recordVersion: readPositiveInteger(fields.recordVersion, "retained device version"),
        directoryMode: readPositiveInteger(fields.directoryMode, "retained device directory mode"),
        fileMode: readPositiveInteger(fields.fileMode, "retained device file mode"),
        markerVersion: readPositiveInteger(fields.markerVersion, "retained device marker version"),
        schemaId: readAbsoluteUrl(fields.schemaId, "retained device schema id"),
        adapters: strings(fields.adapters, ["copy", "clone"] as const),
        actions: strings(fields.actions, ["open", "checkpoint", "restore", "cleanup"] as const),
        statuses: strings(fields.statuses, ["ready", "pending", "cleaned", "unavailable"] as const),
        phases: strings(fields.phases, ["prepared", "published", "completed"] as const),
        limits: {
            maxMarkerBytes: readPositiveInteger(
                limits.maxMarkerBytes,
                "retained device marker bound",
            ),
            maxEntries: readPositiveInteger(limits.maxEntries, "retained device entry bound"),
            maxFileBytes: readPositiveInteger(limits.maxFileBytes, "retained device file bound"),
            maxTotalBytes: readPositiveInteger(limits.maxTotalBytes, "retained device byte bound"),
        },
    } as RetainedDeviceLayersConfig;
}
