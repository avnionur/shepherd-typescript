import { type ProtocolConfig, SECURE_HASH_ALGORITHMS } from "./config-types.ts";
import {
    readAbsoluteUrl,
    readEnum,
    readNonEmptyString,
    readObject,
    readPositiveInteger,
    readUniqueStrings,
} from "./config-value-readers.ts";

const ATTRIBUTE_KEY = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/u;
const RELEASE_VERSION = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u;

/**
 * Validates the observability section: telemetry batch identity, attribute namespace, body
 * vocabulary, identifier derivation, OTLP wire constants, run-span lifecycle schemas, and bounds.
 *
 * @param value - Untrusted `observability` section.
 * @param archiveFormat - Validated importable native archive format, which the telemetry batch
 * format must never reuse.
 * @param executionSchemas - Configured execution-history schema identifiers; run-span start and
 * terminal schemas must be drawn from them.
 * @returns The validated observability configuration.
 * @throws {TypeError} If a field is missing, malformed, or inconsistent.
 */
export function readObservabilityConfig(
    value: unknown,
    archiveFormat: string,
    executionSchemas: readonly string[],
): ProtocolConfig["observability"] {
    const section = readObject(
        value,
        [
            "artifacts",
            "attributeNamespace",
            "batch",
            "bodies",
            "compatibilityVersion",
            "ids",
            "instrumentationScopeName",
            "limits",
            "otlp",
            "resourceAttributes",
            "runSpans",
            "schemas",
            "semanticConventions",
        ],
        "observability",
    );
    const artifacts = readObject(section.artifacts, ["batchSchema"], "observability.artifacts");
    const attributeNamespace = readNonEmptyString(
        section.attributeNamespace,
        "observability.attributeNamespace",
    );
    if (!ATTRIBUTE_KEY.test(attributeNamespace)) {
        throw new TypeError("observability.attributeNamespace must be a dotted lowercase key");
    }
    const batch = readObject(section.batch, ["format", "formatVersion"], "observability.batch");
    const format = readNonEmptyString(batch.format, "observability.batch.format");
    if (format === archiveFormat) {
        throw new TypeError(
            "observability.batch.format must differ from the importable archive format",
        );
    }
    const bodies = readObject(
        section.bodies,
        ["defaultMode", "handlings", "modes"],
        "observability.bodies",
    );
    const modes = readUniqueStrings(bodies.modes, "observability.bodies.modes");
    const ids = readObject(
        section.ids,
        ["digestAlgorithm", "spanDomain", "traceDomain"],
        "observability.ids",
    );
    const spanDomain = readNonEmptyString(ids.spanDomain, "observability.ids.spanDomain");
    const traceDomain = readNonEmptyString(ids.traceDomain, "observability.ids.traceDomain");
    if (spanDomain === traceDomain) {
        throw new TypeError("observability.ids domains must differ");
    }
    const limits = readObject(
        section.limits,
        ["defaultRecordsPerBatch", "maxBodyBytes", "maxRecordsPerBatch"],
        "observability.limits",
    );
    const defaultRecordsPerBatch = readPositiveInteger(
        limits.defaultRecordsPerBatch,
        "observability.limits.defaultRecordsPerBatch",
    );
    const maxRecordsPerBatch = readPositiveInteger(
        limits.maxRecordsPerBatch,
        "observability.limits.maxRecordsPerBatch",
    );
    if (defaultRecordsPerBatch > maxRecordsPerBatch) {
        throw new TypeError(
            "observability.limits.defaultRecordsPerBatch must not exceed the maximum",
        );
    }
    const otlp = readObject(
        section.otlp,
        ["logSeverityNumber", "logSeverityText", "protoVersion", "spanKind", "statusCodes"],
        "observability.otlp",
    );
    const statusCodes = readStringMap(
        otlp.statusCodes,
        "observability.otlp.statusCodes",
        (entry, path) => readPositiveInteger(entry, path),
    );
    const semanticConventions = readObject(
        section.semanticConventions,
        ["schemaUrlPrefix", "version"],
        "observability.semanticConventions",
    );
    const schemas = readObject(section.schemas, ["batchId"], "observability.schemas");
    return {
        artifacts: {
            batchSchema: readNonEmptyString(
                artifacts.batchSchema,
                "observability.artifacts.batchSchema",
            ),
        },
        attributeNamespace,
        batch: {
            format,
            formatVersion: readPositiveInteger(
                batch.formatVersion,
                "observability.batch.formatVersion",
            ),
        },
        bodies: {
            defaultMode: readEnum(bodies.defaultMode, modes, "observability.bodies.defaultMode"),
            handlings: readUniqueStrings(bodies.handlings, "observability.bodies.handlings"),
            modes,
        },
        compatibilityVersion: readNonEmptyString(
            section.compatibilityVersion,
            "observability.compatibilityVersion",
        ),
        ids: {
            digestAlgorithm: readEnum(
                ids.digestAlgorithm,
                SECURE_HASH_ALGORITHMS,
                "observability.ids.digestAlgorithm",
            ),
            spanDomain,
            traceDomain,
        },
        instrumentationScopeName: readNonEmptyString(
            section.instrumentationScopeName,
            "observability.instrumentationScopeName",
        ),
        limits: {
            defaultRecordsPerBatch,
            maxBodyBytes: readPositiveInteger(
                limits.maxBodyBytes,
                "observability.limits.maxBodyBytes",
            ),
            maxRecordsPerBatch,
        },
        otlp: {
            logSeverityNumber: readPositiveInteger(
                otlp.logSeverityNumber,
                "observability.otlp.logSeverityNumber",
            ),
            logSeverityText: readNonEmptyString(
                otlp.logSeverityText,
                "observability.otlp.logSeverityText",
            ),
            protoVersion: readRelease(otlp.protoVersion, "observability.otlp.protoVersion"),
            spanKind: readPositiveInteger(otlp.spanKind, "observability.otlp.spanKind"),
            statusCodes,
        },
        resourceAttributes: readStringMap(
            section.resourceAttributes,
            "observability.resourceAttributes",
            (entry, path) => readNonEmptyString(entry, path),
        ),
        runSpans: readRunSpans(section.runSpans, executionSchemas, Object.keys(statusCodes)),
        schemas: {
            batchId: readAbsoluteUrl(schemas.batchId, "observability.schemas.batchId"),
        },
        semanticConventions: {
            schemaUrlPrefix: readSchemaUrlPrefix(semanticConventions.schemaUrlPrefix),
            version: readRelease(
                semanticConventions.version,
                "observability.semanticConventions.version",
            ),
        },
    };
}

function readRunSpans(
    value: unknown,
    executionSchemas: readonly string[],
    statuses: readonly string[],
): ProtocolConfig["observability"]["runSpans"] {
    const runSpans = readObject(
        value,
        ["name", "startSchemaRefs", "terminalSchemaRefs"],
        "observability.runSpans",
    );
    const startSchemaRefs = readUniqueStrings(
        runSpans.startSchemaRefs,
        "observability.runSpans.startSchemaRefs",
    );
    const terminalSchemaRefs = readStringMap(
        runSpans.terminalSchemaRefs,
        "observability.runSpans.terminalSchemaRefs",
        (entry, path) => readEnum(entry, statuses, path),
    );
    const lifecycle = [...startSchemaRefs, ...Object.keys(terminalSchemaRefs)];
    if (
        new Set(lifecycle).size !== lifecycle.length ||
        lifecycle.some((schemaRef) => !executionSchemas.includes(schemaRef))
    ) {
        throw new TypeError(
            "observability.runSpans schemas must be distinct configured execution schemas",
        );
    }
    return {
        name: readNonEmptyString(runSpans.name, "observability.runSpans.name"),
        startSchemaRefs,
        terminalSchemaRefs,
    };
}

function readStringMap<T>(
    value: unknown,
    path: string,
    readEntry: (entry: unknown, path: string) => T,
): Readonly<Record<string, T>> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError(`${path} must be an object`);
    }
    const entries = Object.entries(value);
    if (entries.length === 0) {
        throw new TypeError(`${path} must not be empty`);
    }
    const map = Object.create(null) as Record<string, T>;
    for (const [key, entry] of entries) {
        map[readNonEmptyString(key, `${path} key`)] = readEntry(entry, `${path}.${key}`);
    }
    return map;
}

function readRelease(value: unknown, path: string): string {
    const version = readNonEmptyString(value, path);
    if (!RELEASE_VERSION.test(version)) {
        throw new TypeError(`${path} must be a MAJOR.MINOR.PATCH release`);
    }
    return version;
}

function readSchemaUrlPrefix(value: unknown): string {
    const prefix = readAbsoluteUrl(value, "observability.semanticConventions.schemaUrlPrefix");
    if (!prefix.endsWith("/")) {
        throw new TypeError("observability.semanticConventions.schemaUrlPrefix must end with /");
    }
    return prefix;
}
