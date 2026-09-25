import { REQUIRED_KERNEL_FRAMING_DEPTH } from "../canonical/framing.ts";
import { readApplicationsConfig } from "./config-applications.ts";
import { readBackupConfig } from "./config-backup.ts";
import { readCliConfig } from "./config-cli.ts";
import { assertSupportedProtocolCompatibility } from "./config-compatibility.ts";
import { readDelegationConfig } from "./config-delegation.ts";
import { readEffectConfig } from "./config-effects.ts";
import { readFormalAssuranceConfig } from "./config-formal-assurance.ts";
import { readObservabilityConfig } from "./config-observability.ts";
import { readOrphanRepairConfig } from "./config-orphan-repair.ts";
import { readProjectionConfig } from "./config-projections.ts";
import { readProviderConfig } from "./config-providers.ts";
import { readReplayConfig } from "./config-replay.ts";
import { readRetentionConfig } from "./config-retention.ts";
import { readRunConfig } from "./config-runs.ts";
import { readScopeConfig } from "./config-scopes.ts";
import {
    readArtifacts,
    readBlobConfig,
    readRecordIdConfig,
    readRootWitness,
    readSchemas,
    readStoreMaintenanceConfig,
} from "./config-sections.ts";
import { readStorageConfig } from "./config-storage.ts";
import { readSupervisionConfig } from "./config-supervision.ts";
import { readTaskConfig } from "./config-tasks.ts";
import {
    type NonEmptyReadonlyArray,
    type ProtocolConfig,
    SECURE_HASH_ALGORITHMS,
    STORE_JOURNAL_MODES,
    STORE_SYNCHRONOUS_LEVELS,
    STORE_TRANSACTION_MODES,
    type StoreMigrationConfig,
} from "./config-types.ts";
import {
    deepFreeze,
    readArray,
    readEnum,
    readNonEmptyString,
    readNonNegativeInteger,
    readObject,
    readPositiveInteger,
    readRequiredTrue,
    readSafeInteger,
    readUniqueStrings,
    sameStrings,
} from "./config-value-readers.ts";
import { readWorkspaceConfig } from "./config-workspaces.ts";

type ParseProtocolConfigOptions = {
    readonly enforceCompatibility?: boolean;
    readonly expectedRecordModes?: readonly string[];
};

/** Validates, copies, and deeply freezes an untrusted protocol configuration. */
export function parseProtocolConfig(
    value: unknown,
    options: ParseProtocolConfigOptions = {},
): ProtocolConfig {
    const root = readObject(
        value,
        [
            "applications",
            "backup",
            "effects",
            "cli",
            "delegation",
            "formalAssurance",
            "kernel",
            "observability",
            "orphanRepair",
            "projections",
            "providers",
            "recordId",
            "replay",
            "retention",
            "runs",
            "scopes",
            "storage",
            "supervision",
            "tasks",
            "workspaces",
        ],
        "protocol configuration",
    );
    const recordId = readRecordIdConfig(root.recordId);
    const kernel = readKernelConfig(root.kernel);
    const projections = readProjectionConfig(root.projections, kernel.queries);
    if (
        options.expectedRecordModes !== undefined &&
        !sameStrings(kernel.recordModes, options.expectedRecordModes)
    ) {
        throw new TypeError("kernel.recordModes is not synchronized with generated constants");
    }
    const workspaces = readWorkspaceConfig(root.workspaces);
    const effects = readEffectConfig(root.effects);
    const replay = readReplayConfig(root.replay, effects.reversibilityTiers);
    const config = {
        applications: readApplicationsConfig(root.applications),
        backup: readBackupConfig(root.backup, kernel.interchange.format, kernel.store.blobs),
        cli: readCliConfig(root.cli),
        delegation: readDelegationConfig(root.delegation),
        effects,
        formalAssurance: readFormalAssuranceConfig(root.formalAssurance, {
            dispositions: replay.effects.dispositions,
            modes: replay.modes,
            stepKinds: replay.steps.kinds,
            terminalStatuses: replay.terminal.statuses,
        }),
        kernel,
        observability: readObservabilityConfig(
            root.observability,
            kernel.interchange.format,
            Object.values(projections.executionHistory.executionSchemas),
        ),
        orphanRepair: readOrphanRepairConfig(root.orphanRepair),
        projections,
        providers: readProviderConfig(root.providers, effects.reversibilityTiers),
        recordId,
        replay,
        retention: readRetentionConfig(root.retention, root, kernel.interchange.format),
        runs: readRunConfig(root.runs),
        scopes: readScopeConfig(root.scopes, workspaces.repositoryGrants.atoms),
        storage: readStorageConfig(root.storage),
        supervision: readSupervisionConfig(root.supervision, effects.reversibilityTiers),
        tasks: readTaskConfig(root.tasks),
        workspaces,
    };
    if (options.enforceCompatibility !== false) {
        assertSupportedProtocolCompatibility(config);
    }
    return deepFreeze(config);
}

function readKernelConfig(value: unknown): ProtocolConfig["kernel"] {
    const kernel = readObject(
        value,
        [
            "abiVersion",
            "append",
            "artifacts",
            "canonicalVersion",
            "canonicalization",
            "interchange",
            "queries",
            "recordKind",
            "recordModes",
            "rootWitness",
            "schemas",
            "store",
        ],
        "kernel",
    );
    const append = readOrdinalBounds(kernel.append, "kernel.append");
    const recordModes = readUniqueStrings(kernel.recordModes, "kernel.recordModes");
    const canonicalization = readCanonicalizationConfig(kernel.canonicalization);
    const interchange = readInterchangeConfig(kernel.interchange);
    if (
        interchange.limits.maxNestingDepth <
        canonicalization.maxNestingDepth + canonicalization.framingDepth
    ) {
        throw new TypeError(
            "kernel.interchange.limits.maxNestingDepth must admit kernel.canonicalization.maxNestingDepth plus framingDepth",
        );
    }
    return {
        abiVersion: readNonEmptyString(kernel.abiVersion, "kernel.abiVersion"),
        append,
        artifacts: readArtifacts(kernel.artifacts),
        canonicalization,
        canonicalVersion: readNonEmptyString(kernel.canonicalVersion, "kernel.canonicalVersion"),
        interchange,
        queries: readQueryConfig(kernel.queries),
        recordKind: readNonEmptyString(kernel.recordKind, "kernel.recordKind"),
        recordModes,
        rootWitness: readRootWitness(kernel.rootWitness, recordModes),
        schemas: readSchemas(kernel.schemas),
        store: readStoreConfig(kernel.store, append),
    };
}

function readCanonicalizationConfig(value: unknown): ProtocolConfig["kernel"]["canonicalization"] {
    const canonicalization = readObject(
        value,
        ["framingDepth", "maxNestingDepth"],
        "kernel.canonicalization",
    );
    const framingDepth = readPositiveInteger(
        canonicalization.framingDepth,
        "kernel.canonicalization.framingDepth",
    );
    // Smaller framing would refuse a body at maxNestingDepth inside the deepest kernel frame.
    if (framingDepth < REQUIRED_KERNEL_FRAMING_DEPTH) {
        throw new TypeError(
            `kernel.canonicalization.framingDepth must be at least ${REQUIRED_KERNEL_FRAMING_DEPTH}, the deepest kernel frame body location`,
        );
    }
    return {
        framingDepth,
        maxNestingDepth: readPositiveInteger(
            canonicalization.maxNestingDepth,
            "kernel.canonicalization.maxNestingDepth",
        ),
    };
}

function readInterchangeConfig(value: unknown): ProtocolConfig["kernel"]["interchange"] {
    const interchange = readObject(
        value,
        ["blobEncoding", "format", "formatVersion", "limits", "staging"],
        "kernel.interchange",
    );
    if (interchange.blobEncoding !== "base64") {
        throw new TypeError("kernel.interchange.blobEncoding must be base64");
    }
    const staging = readObject(
        interchange.staging,
        ["directoryPrefix"],
        "kernel.interchange.staging",
    );
    const directoryPrefix = readNonEmptyString(
        staging.directoryPrefix,
        "kernel.interchange.staging.directoryPrefix",
    );
    if (!/^[A-Za-z0-9._-]+$/u.test(directoryPrefix) || /^\.{1,2}$/u.test(directoryPrefix)) {
        throw new TypeError("kernel.interchange.staging.directoryPrefix must be one path segment");
    }
    const limitKeys = [
        "maxAppendIntents",
        "maxArchiveBytes",
        "maxBlobBytes",
        "maxBlobs",
        "maxCuts",
        "maxNestingDepth",
        "maxRecordViews",
        "maxRecords",
    ] as const;
    const limits = readObject(interchange.limits, limitKeys, "kernel.interchange.limits");
    return {
        blobEncoding: "base64",
        format: readNonEmptyString(interchange.format, "kernel.interchange.format"),
        formatVersion: readPositiveInteger(
            interchange.formatVersion,
            "kernel.interchange.formatVersion",
        ),
        limits: Object.fromEntries(
            limitKeys.map((key) => [
                key,
                readPositiveInteger(limits[key], `kernel.interchange.limits.${key}`),
            ]),
        ) as ProtocolConfig["kernel"]["interchange"]["limits"],
        staging: { directoryPrefix },
    };
}

function readQueryConfig(value: unknown): ProtocolConfig["kernel"]["queries"] {
    const query = readObject(
        value,
        [
            "closurePolicies",
            "cutAppendIntentPrefix",
            "cutSchemaRef",
            "defaultClosurePolicy",
            "defaultModeFilter",
            "defaultVisibilityProfile",
            "modeFilters",
            "visibilityProfiles",
            "witnessSchemaRef",
        ],
        "kernel.queries",
    );
    const closurePolicies = readUniqueStrings(
        query.closurePolicies,
        "kernel.queries.closurePolicies",
    );
    const modeFilters = readUniqueStrings(query.modeFilters, "kernel.queries.modeFilters");
    const visibilityProfiles = readUniqueStrings(
        query.visibilityProfiles,
        "kernel.queries.visibilityProfiles",
    );
    const defaultClosurePolicy = readNonEmptyString(
        query.defaultClosurePolicy,
        "kernel.queries.defaultClosurePolicy",
    );
    const defaultModeFilter = readNonEmptyString(
        query.defaultModeFilter,
        "kernel.queries.defaultModeFilter",
    );
    const defaultVisibilityProfile = readNonEmptyString(
        query.defaultVisibilityProfile,
        "kernel.queries.defaultVisibilityProfile",
    );
    if (
        !closurePolicies.includes(defaultClosurePolicy) ||
        !modeFilters.includes(defaultModeFilter) ||
        !visibilityProfiles.includes(defaultVisibilityProfile)
    ) {
        throw new TypeError("kernel query defaults must belong to their configured value sets");
    }
    return {
        closurePolicies,
        cutAppendIntentPrefix: readNonEmptyString(
            query.cutAppendIntentPrefix,
            "kernel.queries.cutAppendIntentPrefix",
        ),
        cutSchemaRef: readNonEmptyString(query.cutSchemaRef, "kernel.queries.cutSchemaRef"),
        defaultClosurePolicy,
        defaultModeFilter,
        defaultVisibilityProfile,
        modeFilters,
        visibilityProfiles,
        witnessSchemaRef: readNonEmptyString(
            query.witnessSchemaRef,
            "kernel.queries.witnessSchemaRef",
        ),
    };
}

function readStoreConfig(
    value: unknown,
    append: ProtocolConfig["kernel"]["append"],
): ProtocolConfig["kernel"]["store"] {
    const store = readObject(
        value,
        [
            "appendIntentDigestAlgorithm",
            "blobs",
            "busyTimeoutMilliseconds",
            "defensive",
            "foreignKeys",
            "journalMode",
            "maintenance",
            "migrations",
            "schemaVersion",
            "synchronous",
            "transactionMode",
        ],
        "kernel.store",
    );
    const migrations = readMigrations(store.migrations);
    const schemaVersion = readPositiveInteger(store.schemaVersion, "kernel.store.schemaVersion");
    let latestMigration = migrations[0];
    for (const migration of migrations) {
        latestMigration = migration;
    }
    if (latestMigration.version !== schemaVersion) {
        throw new TypeError("kernel.store.schemaVersion must match the latest migration");
    }
    if (
        latestMigration.firstOwnerOrdinal !== append.firstOwnerOrdinal ||
        latestMigration.lastOwnerOrdinal !== append.lastOwnerOrdinal
    ) {
        throw new TypeError("kernel.append ordinal bounds require a matching store migration");
    }
    return {
        appendIntentDigestAlgorithm: readEnum(
            store.appendIntentDigestAlgorithm,
            SECURE_HASH_ALGORITHMS,
            "kernel.store.appendIntentDigestAlgorithm",
        ),
        blobs: readBlobConfig(store.blobs),
        busyTimeoutMilliseconds: readNonNegativeInteger(
            store.busyTimeoutMilliseconds,
            "kernel.store.busyTimeoutMilliseconds",
        ),
        defensive: readRequiredTrue(store.defensive, "kernel.store.defensive"),
        foreignKeys: readRequiredTrue(store.foreignKeys, "kernel.store.foreignKeys"),
        journalMode: readEnum(store.journalMode, STORE_JOURNAL_MODES, "kernel.store.journalMode"),
        maintenance: readStoreMaintenanceConfig(store.maintenance),
        migrations,
        schemaVersion,
        synchronous: readEnum(
            store.synchronous,
            STORE_SYNCHRONOUS_LEVELS,
            "kernel.store.synchronous",
        ),
        transactionMode: readEnum(
            store.transactionMode,
            STORE_TRANSACTION_MODES,
            "kernel.store.transactionMode",
        ),
    };
}

function readMigrations(value: unknown): NonEmptyReadonlyArray<StoreMigrationConfig> {
    const migrations = readArray(value, "kernel.store.migrations").map((migrationValue, index) => {
        const path = `kernel.store.migrations[${index}]`;
        const migration = readObject(
            migrationValue,
            ["firstOwnerOrdinal", "lastOwnerOrdinal", "version"],
            path,
        );
        return {
            ...readOrdinalBounds(migration, path),
            version: readPositiveInteger(migration.version, `${path}.version`),
        };
    });
    const [firstMigration, ...remainingMigrations] = migrations;
    if (firstMigration === undefined) {
        throw new TypeError("kernel.store.migrations must not be empty");
    }
    for (const [index, migration] of migrations.entries()) {
        if (migration.version !== index + 1) {
            throw new TypeError("kernel.store.migrations must be contiguous from version 1");
        }
    }
    return [firstMigration, ...remainingMigrations];
}

function readOrdinalBounds(value: unknown, path: string): ProtocolConfig["kernel"]["append"] {
    const bounds = readObject(value, ["firstOwnerOrdinal", "lastOwnerOrdinal"], path, true);
    const firstOwnerOrdinal = readNonNegativeInteger(
        bounds.firstOwnerOrdinal,
        `${path}.firstOwnerOrdinal`,
    );
    const lastOwnerOrdinal = readSafeInteger(bounds.lastOwnerOrdinal, `${path}.lastOwnerOrdinal`);
    if (lastOwnerOrdinal < firstOwnerOrdinal || lastOwnerOrdinal >= Number.MAX_SAFE_INTEGER) {
        throw new TypeError(
            `${path}.lastOwnerOrdinal must be at least the first ordinal and leave a safe next ordinal`,
        );
    }
    return { firstOwnerOrdinal, lastOwnerOrdinal };
}
