import { retentionProtocolConfig } from "../protocol/config.ts";
import { deepFreeze } from "../protocol/config-value-readers.ts";
import type {
    RETENTION_DATA_CLASSES,
    RETENTION_EXPORT_DISPOSITIONS,
    SECRET_SCANNING_MODES,
} from "../protocol/values.generated.ts";

/**
 * Configured retention class of a record, derived from its schema identifier.
 *
 * @public
 */
export type RetentionDataClass = (typeof RETENTION_DATA_CLASSES)[number];

/**
 * How a redacted export treats the body of a record in one data class.
 *
 * `include` exports the body verbatim unless a configured detector matches it; `redact` replaces
 * the body with a marker carrying the detected secret classes and a body digest; `omit-body`
 * replaces the body with a marker that discloses neither.
 *
 * @public
 */
export type RetentionExportDisposition = (typeof RETENTION_EXPORT_DISPOSITIONS)[number];

/**
 * Trace-store append scanning mode. `off` (the default) scans nothing; `refuse` rejects an append
 * whose record bodies match a configured detector before anything is written.
 *
 * @public
 */
export type SecretScanningMode = (typeof SECRET_SCANNING_MODES)[number];

/**
 * Caller classification of schema identifiers the protocol configuration does not name.
 *
 * @public
 */
export type RetentionClassificationOptions = {
    /**
     * Data class for caller-defined schema identifiers, such as memory-adapter records. A
     * configured protocol schema cannot be reclassified.
     */
    readonly schemaDataClasses?: Readonly<Record<string, RetentionDataClass>>;
};

/**
 * Data class and export disposition resolved for one schema identifier.
 *
 * @public
 */
export type TraceSchemaClassification = {
    /** Resolved retention data class. */
    readonly data_class: RetentionDataClass;
    /** Export disposition configured for the data class. */
    readonly disposition: RetentionExportDisposition;
};

/**
 * Frozen summary of the configured retention policy.
 *
 * @public
 */
export type RetentionPolicy = {
    /** Every configured data class with its export disposition, in configuration order. */
    readonly data_classes: readonly TraceSchemaClassification[];
    /** Data class of schema identifiers no configured family or caller option names. */
    readonly default_data_class: RetentionDataClass;
    /** Default trace-store scanning mode. */
    readonly default_scanning_mode: SecretScanningMode;
    /** Configured secret-class names, in detector order. Patterns stay in configuration. */
    readonly secret_classes: readonly string[];
    /** Configured trace-store scanning modes. */
    readonly scanning_modes: readonly SecretScanningMode[];
};

/**
 * Reads the configured retention policy.
 *
 * @returns Frozen data classes with dispositions, default class, secret-class names, and scanning
 * modes.
 *
 * @example
 * ```ts
 * const policy = readRetentionPolicy();
 * console.log(policy.data_classes.map(({ data_class, disposition }) => `${data_class}:${disposition}`));
 * ```
 *
 * @public
 */
export function readRetentionPolicy(): RetentionPolicy {
    return deepFreeze({
        data_classes: retentionProtocolConfig.dataClasses.map((dataClass) =>
            classification(dataClass as RetentionDataClass),
        ),
        default_data_class: retentionProtocolConfig.defaultDataClass as RetentionDataClass,
        default_scanning_mode: retentionProtocolConfig.scanning.defaultMode as SecretScanningMode,
        secret_classes: retentionProtocolConfig.secretClasses.map(({ name }) => name),
        scanning_modes: [...retentionProtocolConfig.scanning.modes] as SecretScanningMode[],
    });
}

/**
 * Resolves the data class and export disposition of one record schema identifier.
 *
 * Configured protocol schema families take precedence; a caller-classified schema is used next;
 * every other schema identifier receives the configured default data class.
 *
 * @param schemaRef - Exact record `schema_ref`.
 * @param options - Optional caller classification of unconfigured schema identifiers.
 * @returns The frozen data class and disposition.
 * @throws {TypeError} If the schema identifier is empty or the options are malformed or try to
 * reclassify a configured schema.
 *
 * @example
 * ```ts
 * classifyTraceSchema("example.memory.v1", {
 *     schemaDataClasses: { "example.memory.v1": "memory-adapter" },
 * });
 * ```
 *
 * @public
 */
export function classifyTraceSchema(
    schemaRef: string,
    options: RetentionClassificationOptions = {},
): TraceSchemaClassification {
    if (typeof schemaRef !== "string" || schemaRef.length === 0) {
        throw new TypeError("schemaRef must be a non-empty string");
    }
    return createSchemaClassifier(options)(schemaRef);
}

/** Validates caller options once and returns a schema classifier. @internal */
export function createSchemaClassifier(
    options: RetentionClassificationOptions,
): (schemaRef: string) => TraceSchemaClassification {
    const callerClasses = readCallerClasses(options);
    const cache = new Map<string, TraceSchemaClassification>();
    return (schemaRef) => {
        let resolved = cache.get(schemaRef);
        if (resolved === undefined) {
            const dataClass =
                retentionProtocolConfig.schemaDataClasses[schemaRef] ??
                callerClasses.get(schemaRef) ??
                retentionProtocolConfig.defaultDataClass;
            resolved = classification(dataClass as RetentionDataClass);
            cache.set(schemaRef, resolved);
        }
        return resolved;
    };
}

/** Returns whether a string is a configured data class. @internal */
export function isRetentionDataClass(value: unknown): value is RetentionDataClass {
    return typeof value === "string" && retentionProtocolConfig.dataClasses.includes(value);
}

function classification(dataClass: RetentionDataClass): TraceSchemaClassification {
    return Object.freeze({
        data_class: dataClass,
        disposition: retentionProtocolConfig.exportDispositions[
            dataClass
        ] as RetentionExportDisposition,
    });
}

function readCallerClasses(options: RetentionClassificationOptions): ReadonlyMap<string, string> {
    if (options === null || typeof options !== "object" || Array.isArray(options)) {
        throw new TypeError("retention options must be an object");
    }
    if (Object.keys(options).some((key) => key !== "schemaDataClasses")) {
        throw new TypeError("retention options must contain only schemaDataClasses");
    }
    const classes = new Map<string, string>();
    if (options.schemaDataClasses === undefined) {
        return classes;
    }
    const value: unknown = options.schemaDataClasses;
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError("schemaDataClasses must be an object");
    }
    for (const [schemaRef, dataClass] of Object.entries(value)) {
        const configured = retentionProtocolConfig.schemaDataClasses[schemaRef];
        if (
            schemaRef.length === 0 ||
            !isRetentionDataClass(dataClass) ||
            (configured !== undefined && configured !== dataClass)
        ) {
            throw new TypeError(
                "schemaDataClasses must map non-empty unconfigured schema identifiers to configured data classes",
            );
        }
        classes.set(schemaRef, dataClass);
    }
    return classes;
}
