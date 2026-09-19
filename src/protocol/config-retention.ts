import { createHash } from "node:crypto";

import {
    type ProtocolConfig,
    type SchemaFamilyConfig,
    SECURE_HASH_ALGORITHMS,
    type SecretClassConfig,
} from "./config-types.ts";
import {
    readAbsoluteUrl,
    readArray,
    readEnum,
    readNonEmptyString,
    readObject,
    readPositiveInteger,
    readUniqueStrings,
} from "./config-value-readers.ts";

/**
 * Validates the retention section and resolves every configured schema identifier to a data
 * class.
 *
 * @param value - Untrusted `retention` section.
 * @param root - Complete untrusted protocol configuration used to discover and resolve schema
 * families; every object under a configured family key must be mapped.
 * @param archiveFormat - Validated importable native archive format, which retention wire
 * formats must never reuse.
 * @returns The validated retention configuration with its resolved schema classification.
 * @throws {TypeError} If a field is malformed, a detector is unsafe, a store-file mode is not
 * owner-only, or a schema family is unmapped, unresolvable, or classified inconsistently.
 */
export function readRetentionConfig(
    value: unknown,
    root: Readonly<Record<string, unknown>>,
    archiveFormat: string,
): ProtocolConfig["retention"] {
    const retention = readObject(
        value,
        [
            "artifacts",
            "compatibilityVersion",
            "dataClasses",
            "defaultDataClass",
            "digestAlgorithm",
            "digestPrefix",
            "dispositions",
            "exportDispositions",
            "familyKeys",
            "limits",
            "redactedArchive",
            "report",
            "scanning",
            "schemaFamilies",
            "schemas",
            "secretClasses",
            "storeFiles",
        ],
        "retention",
    );
    const artifacts = readObject(
        retention.artifacts,
        ["redactedArchiveSchema", "reportSchema"],
        "retention.artifacts",
    );
    const schemas = readObject(
        retention.schemas,
        ["redactedArchiveId", "reportId"],
        "retention.schemas",
    );
    const dataClasses = readUniqueStrings(retention.dataClasses, "retention.dataClasses");
    const defaultDataClass = readEnum(
        retention.defaultDataClass,
        dataClasses,
        "retention.defaultDataClass",
    );
    const dispositions = readUniqueStrings(retention.dispositions, "retention.dispositions");
    const exportDispositionValues = readObject(
        retention.exportDispositions,
        dataClasses,
        "retention.exportDispositions",
    );
    const exportDispositions = Object.create(null) as Record<string, string>;
    for (const dataClass of dataClasses) {
        exportDispositions[dataClass] = readEnum(
            exportDispositionValues[dataClass],
            dispositions,
            `retention.exportDispositions.${dataClass}`,
        );
    }
    const digestAlgorithm = readEnum(
        retention.digestAlgorithm,
        SECURE_HASH_ALGORITHMS,
        "retention.digestAlgorithm",
    );
    const digestPrefix = readNonEmptyString(retention.digestPrefix, "retention.digestPrefix");
    if (digestPrefix !== `${digestAlgorithm}:`) {
        throw new TypeError("retention.digestPrefix must identify the configured hash algorithm");
    }
    const limits = readObject(
        retention.limits,
        ["maxFindings", "maxReportedRecords"],
        "retention.limits",
    );
    const redactedArchive = readWireIdentity(
        retention.redactedArchive,
        "retention.redactedArchive",
    );
    const report = readWireIdentity(retention.report, "retention.report");
    if (new Set([redactedArchive.format, report.format, archiveFormat]).size !== 3) {
        throw new TypeError(
            "retention wire formats must differ from each other and the importable archive format",
        );
    }
    const scanning = readObject(
        retention.scanning,
        ["defaultMode", "findingDigestPrefix", "modes"],
        "retention.scanning",
    );
    const modes = readUniqueStrings(scanning.modes, "retention.scanning.modes");
    const findingDigestPrefix = readNonEmptyString(
        scanning.findingDigestPrefix,
        "retention.scanning.findingDigestPrefix",
    );
    if (findingDigestPrefix !== `hmac-${digestAlgorithm}:`) {
        throw new TypeError(
            "retention.scanning.findingDigestPrefix must identify a keyed digest under the configured hash algorithm",
        );
    }
    const familyKeys = readUniqueStrings(retention.familyKeys, "retention.familyKeys");
    const schemaFamilies = readSchemaFamilies(retention.schemaFamilies, dataClasses);
    return {
        artifacts: {
            redactedArchiveSchema: readNonEmptyString(
                artifacts.redactedArchiveSchema,
                "retention.artifacts.redactedArchiveSchema",
            ),
            reportSchema: readNonEmptyString(
                artifacts.reportSchema,
                "retention.artifacts.reportSchema",
            ),
        },
        compatibilityVersion: readNonEmptyString(
            retention.compatibilityVersion,
            "retention.compatibilityVersion",
        ),
        dataClasses,
        defaultDataClass,
        digestAlgorithm,
        digestPrefix,
        dispositions,
        exportDispositions,
        familyKeys,
        limits: {
            maxFindings: readPositiveInteger(limits.maxFindings, "retention.limits.maxFindings"),
            maxReportedRecords: readPositiveInteger(
                limits.maxReportedRecords,
                "retention.limits.maxReportedRecords",
            ),
        },
        redactedArchive,
        report,
        scanning: {
            defaultMode: readEnum(scanning.defaultMode, modes, "retention.scanning.defaultMode"),
            findingDigestPrefix,
            modes,
        },
        schemaDataClasses: resolveSchemaDataClasses(root, familyKeys, schemaFamilies),
        schemaFamilies,
        schemas: {
            redactedArchiveId: readAbsoluteUrl(
                schemas.redactedArchiveId,
                "retention.schemas.redactedArchiveId",
            ),
            reportId: readAbsoluteUrl(schemas.reportId, "retention.schemas.reportId"),
        },
        secretClasses: readSecretClasses(retention.secretClasses),
        storeFiles: readStoreFiles(retention.storeFiles),
    };
}

function readWireIdentity(
    value: unknown,
    path: string,
): { readonly format: string; readonly formatVersion: number } {
    const identity = readObject(value, ["format", "formatVersion"], path);
    return {
        format: readNonEmptyString(identity.format, `${path}.format`),
        formatVersion: readPositiveInteger(identity.formatVersion, `${path}.formatVersion`),
    };
}

function readSecretClasses(value: unknown): readonly SecretClassConfig[] {
    const detectors = readArray(value, "retention.secretClasses").map((entry, index) => {
        const path = `retention.secretClasses[${index}]`;
        const detector = readObject(entry, ["flags", "name", "pattern"], path);
        const flags = readNonEmptyString(detector.flags, `${path}.flags`);
        const pattern = readNonEmptyString(detector.pattern, `${path}.pattern`);
        if (!/^[ims]*u[ims]*$/u.test(flags)) {
            throw new TypeError(`${path}.flags must use Unicode mode and only i, m, or s`);
        }
        let expression: RegExp;
        try {
            expression = new RegExp(pattern, flags);
        } catch (error) {
            throw new TypeError(`${path}.pattern must be a valid regular expression`, {
                cause: error,
            });
        }
        if (expression.test("")) {
            throw new TypeError(`${path}.pattern must not match the empty string`);
        }
        return { flags, name: readNonEmptyString(detector.name, `${path}.name`), pattern };
    });
    const names = detectors.map(({ name }) => name);
    if (names.length === 0 || new Set(names).size !== names.length) {
        throw new TypeError("retention.secretClasses must contain uniquely named detectors");
    }
    return detectors;
}

function readSchemaFamilies(
    value: unknown,
    dataClasses: readonly string[],
): readonly SchemaFamilyConfig[] {
    const families = readArray(value, "retention.schemaFamilies").map((entry, index) => {
        const path = `retention.schemaFamilies[${index}]`;
        const family = readObject(entry, ["dataClass", "path"], path);
        return {
            dataClass: readEnum(family.dataClass, dataClasses, `${path}.dataClass`),
            path: readNonEmptyString(family.path, `${path}.path`),
        };
    });
    const paths = families.map(({ path }) => path);
    if (paths.length === 0 || new Set(paths).size !== paths.length) {
        throw new TypeError("retention.schemaFamilies must contain unique paths");
    }
    return families;
}

function readStoreFiles(value: unknown): ProtocolConfig["retention"]["storeFiles"] {
    const storeFiles = readObject(value, ["mode", "sidecarSuffixes"], "retention.storeFiles");
    const modeText = readNonEmptyString(storeFiles.mode, "retention.storeFiles.mode");
    const mode = Number.parseInt(modeText, 8);
    // Owner read and write are required; any group or other bit would expose record bodies.
    if (!/^0[0-7]{3}$/u.test(modeText) || (mode & 0o600) !== 0o600 || (mode & 0o077) !== 0) {
        throw new TypeError(
            "retention.storeFiles.mode must be an owner-only read-write octal mode",
        );
    }
    return {
        mode,
        sidecarSuffixes: readUniqueStrings(
            storeFiles.sidecarSuffixes,
            "retention.storeFiles.sidecarSuffixes",
        ),
    };
}

function resolveSchemaDataClasses(
    root: Readonly<Record<string, unknown>>,
    familyKeys: readonly string[],
    families: readonly SchemaFamilyConfig[],
): Readonly<Record<string, string>> {
    const mapped = new Set(families.map(({ path }) => path));
    for (const familyPath of discoverFamilyPaths(root, familyKeys, "")) {
        if (!mapped.has(familyPath)) {
            throw new TypeError(`retention.schemaFamilies must map ${familyPath}`);
        }
    }
    const assigned = new Map<string, SchemaFamilyConfig>();
    const ordered = [...families].sort(
        (left, right) => left.path.split(".").length - right.path.split(".").length,
    );
    for (const family of ordered) {
        for (const schemaRef of readSchemaIdentifiers(root, family.path)) {
            const previous = assigned.get(schemaRef);
            if (
                previous !== undefined &&
                previous.dataClass !== family.dataClass &&
                !family.path.startsWith(`${previous.path}.`)
            ) {
                throw new TypeError(
                    `retention.schemaFamilies classify ${schemaRef} inconsistently`,
                );
            }
            assigned.set(schemaRef, family);
        }
    }
    const classes = Object.create(null) as Record<string, string>;
    for (const schemaRef of [...assigned.keys()].sort()) {
        classes[schemaRef] = (assigned.get(schemaRef) as SchemaFamilyConfig).dataClass;
    }
    return classes;
}

function discoverFamilyPaths(
    value: unknown,
    familyKeys: readonly string[],
    prefix: string,
): readonly string[] {
    if (value === null || typeof value !== "object") {
        return [];
    }
    return Object.entries(value).flatMap(([key, child]) => {
        const path = prefix === "" ? key : `${prefix}.${key}`;
        const nested = discoverFamilyPaths(child, familyKeys, path);
        return familyKeys.includes(key) && isPlainObject(child) ? [path, ...nested] : nested;
    });
}

function readSchemaIdentifiers(
    root: Readonly<Record<string, unknown>>,
    familyPath: string,
): readonly string[] {
    let value: unknown = root;
    for (const segment of familyPath.split(".")) {
        value = isPlainObject(value) && Object.hasOwn(value, segment) ? value[segment] : undefined;
    }
    return collectSchemaIdentifiers(value, familyPath);
}

function collectSchemaIdentifiers(value: unknown, path: string): readonly string[] {
    if (typeof value === "string" && value.length > 0) {
        return [value];
    }
    if (!isPlainObject(value) || Object.keys(value).length === 0) {
        throw new TypeError(`retention.schemaFamilies path ${path} must name configured schemas`);
    }
    return Object.entries(value).flatMap(([key, child]) =>
        collectSchemaIdentifiers(child, `${path}.${key}`),
    );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Digest length check shared by retention digests and their generated schemas. @internal */
export function retentionDigestHexLength(
    algorithm: ProtocolConfig["retention"]["digestAlgorithm"],
): number {
    return createHash(algorithm).digest("hex").length;
}
