import {
    type ProtocolConfig,
    STORE_JOURNAL_MODES,
    STORE_SYNCHRONOUS_LEVELS,
    STORE_TRANSACTION_MODES,
} from "./config-types.ts";
import {
    readArray,
    readEnum,
    readNonEmptyString,
    readNonNegativeInteger,
    readObject,
    readPositiveInteger,
    readRequiredTrue,
    readUniqueStrings,
} from "./config-value-readers.ts";

/**
 * Validates the storage section: listing bounds, the shared reference-name and lease-key
 * grammar, lease bounds, closed status and durability vocabularies, and the SQLite coordinator
 * durability contract.
 *
 * @param value - Untrusted `storage` section.
 * @returns The validated storage configuration.
 * @throws {TypeError} If a field is missing, malformed, out of bounds, or inconsistent.
 */
export function readStorageConfig(value: unknown): ProtocolConfig["storage"] {
    const storage = readObject(
        value,
        [
            "blobs",
            "compatibilityVersion",
            "coordinator",
            "durabilities",
            "leases",
            "names",
            "refs",
            "statuses",
        ],
        "storage",
    );
    const blobs = readObject(storage.blobs, ["defaultListLimit", "maxListLimit"], "storage.blobs");
    const defaultListLimit = readPositiveInteger(
        blobs.defaultListLimit,
        "storage.blobs.defaultListLimit",
    );
    const maxListLimit = readPositiveInteger(blobs.maxListLimit, "storage.blobs.maxListLimit");
    if (defaultListLimit > maxListLimit) {
        throw new TypeError("storage.blobs.defaultListLimit must not exceed maxListLimit");
    }
    const leases = readObject(
        storage.leases,
        ["maxOwnerLength", "maxTtlMilliseconds", "minTtlMilliseconds"],
        "storage.leases",
    );
    const minTtlMilliseconds = readPositiveInteger(
        leases.minTtlMilliseconds,
        "storage.leases.minTtlMilliseconds",
    );
    const maxTtlMilliseconds = readPositiveInteger(
        leases.maxTtlMilliseconds,
        "storage.leases.maxTtlMilliseconds",
    );
    if (minTtlMilliseconds > maxTtlMilliseconds) {
        throw new TypeError("storage.leases.minTtlMilliseconds must not exceed maxTtlMilliseconds");
    }
    const names = readObject(storage.names, ["maxLength", "pattern"], "storage.names");
    const pattern = readNonEmptyString(names.pattern, "storage.names.pattern");
    let expression: RegExp;
    try {
        expression = new RegExp(pattern, "u");
    } catch (error) {
        throw new TypeError("storage.names.pattern must be a valid regular expression", {
            cause: error,
        });
    }
    if (!pattern.startsWith("^") || !pattern.endsWith("$") || expression.test("")) {
        throw new TypeError(
            "storage.names.pattern must be anchored and must not match the empty string",
        );
    }
    const refs = readObject(storage.refs, ["maxValueLength"], "storage.refs");
    const statuses = readObject(storage.statuses, ["lease", "refSwap"], "storage.statuses");
    return {
        blobs: { defaultListLimit, maxListLimit },
        compatibilityVersion: readNonEmptyString(
            storage.compatibilityVersion,
            "storage.compatibilityVersion",
        ),
        coordinator: readCoordinatorConfig(storage.coordinator),
        durabilities: readUniqueStrings(storage.durabilities, "storage.durabilities"),
        leases: {
            maxOwnerLength: readPositiveInteger(
                leases.maxOwnerLength,
                "storage.leases.maxOwnerLength",
            ),
            maxTtlMilliseconds,
            minTtlMilliseconds,
        },
        names: {
            maxLength: readPositiveInteger(names.maxLength, "storage.names.maxLength"),
            pattern,
        },
        refs: {
            maxValueLength: readPositiveInteger(refs.maxValueLength, "storage.refs.maxValueLength"),
        },
        statuses: {
            lease: readUniqueStrings(statuses.lease, "storage.statuses.lease"),
            refSwap: readUniqueStrings(statuses.refSwap, "storage.statuses.refSwap"),
        },
    };
}

function readCoordinatorConfig(value: unknown): ProtocolConfig["storage"]["coordinator"] {
    const coordinator = readObject(
        value,
        [
            "busyTimeoutMilliseconds",
            "defensive",
            "foreignKeys",
            "journalMode",
            "migrations",
            "schemaVersion",
            "synchronous",
            "transactionMode",
        ],
        "storage.coordinator",
    );
    const migrations = readArray(coordinator.migrations, "storage.coordinator.migrations").map(
        (version, index) =>
            readPositiveInteger(version, `storage.coordinator.migrations[${index}]`),
    );
    const [first, ...rest] = migrations;
    if (first === undefined || migrations.some((version, index) => version !== index + 1)) {
        throw new TypeError("storage.coordinator.migrations must be contiguous from version 1");
    }
    const schemaVersion = readPositiveInteger(
        coordinator.schemaVersion,
        "storage.coordinator.schemaVersion",
    );
    if (migrations.at(-1) !== schemaVersion) {
        throw new TypeError("storage.coordinator.schemaVersion must match the latest migration");
    }
    return {
        busyTimeoutMilliseconds: readNonNegativeInteger(
            coordinator.busyTimeoutMilliseconds,
            "storage.coordinator.busyTimeoutMilliseconds",
        ),
        defensive: readRequiredTrue(coordinator.defensive, "storage.coordinator.defensive"),
        foreignKeys: readRequiredTrue(coordinator.foreignKeys, "storage.coordinator.foreignKeys"),
        journalMode: readEnum(
            coordinator.journalMode,
            STORE_JOURNAL_MODES,
            "storage.coordinator.journalMode",
        ),
        migrations: [first, ...rest],
        schemaVersion,
        synchronous: readEnum(
            coordinator.synchronous,
            STORE_SYNCHRONOUS_LEVELS,
            "storage.coordinator.synchronous",
        ),
        transactionMode: readEnum(
            coordinator.transactionMode,
            STORE_TRANSACTION_MODES,
            "storage.coordinator.transactionMode",
        ),
    };
}
