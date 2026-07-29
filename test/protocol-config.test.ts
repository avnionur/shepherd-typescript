import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { KERNEL_ABI_V0_CONTRACT } from "../src/protocol/compatibility-constants.ts";
import { parseProtocolConfig } from "../src/protocol/config-validation.ts";

type Mutation = (config: Record<string, unknown>) => void;

const validConfig = JSON.parse(
    readFileSync(new URL("../protocol.config.json", import.meta.url), "utf8"),
) as Record<string, unknown>;

test("protocol configuration validates and freezes every critical section", () => {
    const config = structuredClone(validConfig);
    const parsed = parseProtocolConfig(config, {
        expectedRecordModes: ["capture", "declaration"],
    });

    assert.equal(parsed.recordId.algorithm, "sha256");
    assert.equal(parsed.kernel.store.transactionMode, "IMMEDIATE");
    assert.equal(parsed.kernel.store.blobs.fanoutCharacters, 2);
    assert.equal(parsed.kernel.store.defensive, true);
    assert.equal(Object.isFrozen(parsed), true);
    assert.equal(Object.isFrozen(parsed.kernel.store), true);
    assert.equal(Object.isFrozen(parsed.kernel.store.migrations), true);
    assert.equal(Object.isFrozen(KERNEL_ABI_V0_CONTRACT), true);
    assert.equal(Object.isFrozen(KERNEL_ABI_V0_CONTRACT.store.migrations), true);
    assert.notEqual(
        parsed.kernel.rootWitness.body,
        objectAt(objectAt(config, "kernel"), "rootWitness").body,
    );
    assert.throws(
        () =>
            parseProtocolConfig(structuredClone(validConfig), {
                expectedRecordModes: ["capture"],
            }),
        /generated constants/,
    );
});

test("protocol configuration rejects invalid record identity and kernel constants", () => {
    assertInvalid([
        (config) => {
            objectAt(config, "recordId").algorithm = "md5";
        },
        (config) => {
            objectAt(config, "recordId").hexLength = 63;
        },
        (config) => {
            objectAt(config, "recordId").prefix = "";
        },
        (config) => {
            objectAt(config, "recordId").prefix = "digest:";
        },
        (config) => {
            const recordId = objectAt(config, "recordId");
            recordId.algorithm = "sha512";
            recordId.hexLength = 128;
            recordId.prefix = "sha512:";
        },
        (config) => {
            objectAt(config, "kernel").abiVersion = "";
        },
        (config) => {
            objectAt(config, "kernel").abiVersion = "shepherd.kernel.abi.v1";
        },
        (config) => {
            objectAt(config, "kernel").canonicalVersion = "";
        },
        (config) => {
            objectAt(config, "kernel").recordKind = "";
        },
        (config) => {
            objectAt(config, "kernel").recordModes = [];
        },
        (config) => {
            objectAt(config, "kernel").recordModes = null;
        },
        (config) => {
            objectAt(config, "kernel").recordModes = ["capture", "capture"];
        },
        (config) => {
            objectAt(config, "kernel").recordModes = ["capture", 1];
        },
    ]);
});

test("protocol configuration rejects invalid append and migration bounds", () => {
    assertInvalid([
        (config) => {
            objectAt(objectAt(config, "kernel"), "append").firstOwnerOrdinal = -1;
        },
        (config) => {
            objectAt(objectAt(config, "kernel"), "append").lastOwnerOrdinal = -1;
        },
        (config) => {
            objectAt(objectAt(config, "kernel"), "append").lastOwnerOrdinal =
                Number.MAX_SAFE_INTEGER;
        },
        (config) => {
            objectAt(objectAt(config, "kernel"), "store").schemaVersion = 0;
        },
        (config) => {
            objectAt(objectAt(config, "kernel"), "store").migrations = [];
        },
        (config) => {
            firstMigrationOf(config).version = 2;
        },
        (config) => {
            objectAt(objectAt(config, "kernel"), "store").schemaVersion = 4;
        },
        (config) => {
            firstMigrationOf(config).firstOwnerOrdinal = 1;
        },
        (config) => {
            firstMigrationOf(config).lastOwnerOrdinal = Number.MAX_SAFE_INTEGER;
        },
        (config) => {
            objectAt(objectAt(config, "kernel"), "append").firstOwnerOrdinal = 5;
            firstMigrationOf(config).firstOwnerOrdinal = 5;
        },
    ]);
});

test("protocol configuration rejects weakened or unsafe store settings", () => {
    assertInvalid([
        (config) => {
            objectAt(objectAt(config, "kernel"), "store").appendIntentDigestAlgorithm = "md5";
        },
        (config) => {
            objectAt(objectAt(config, "kernel"), "store").appendIntentDigestAlgorithm = "sha512";
        },
        (config) => {
            objectAt(objectAt(config, "kernel"), "store").busyTimeoutMilliseconds = -1;
        },
        (config) => {
            objectAt(objectAt(config, "kernel"), "store").busyTimeoutMilliseconds = 1.5;
        },
        (config) => {
            objectAt(objectAt(config, "kernel"), "store").defensive = false;
        },
        (config) => {
            objectAt(objectAt(config, "kernel"), "store").foreignKeys = false;
        },
        (config) => {
            objectAt(objectAt(config, "kernel"), "store").journalMode = "WAL; DROP TABLE records";
        },
        (config) => {
            objectAt(objectAt(config, "kernel"), "store").synchronous = "NORMAL";
        },
        (config) => {
            objectAt(objectAt(config, "kernel"), "store").transactionMode = "DEFERRED";
        },
        (config) => {
            blobConfigOf(config).digestAlgorithm = "md5";
        },
        (config) => {
            blobConfigOf(config).digestAlgorithm = "sha512";
            blobConfigOf(config).hexLength = 128;
            blobConfigOf(config).idPrefix = "sha512:";
        },
        (config) => {
            blobConfigOf(config).hexLength = 63;
        },
        (config) => {
            blobConfigOf(config).idPrefix = "blob:";
        },
        (config) => {
            blobConfigOf(config).fanoutCharacters = 0;
        },
        (config) => {
            blobConfigOf(config).fanoutCharacters = 64;
        },
        (config) => {
            blobConfigOf(config).fsync = false;
        },
        (config) => {
            blobConfigOf(config).directorySuffix = "../blobs";
        },
        (config) => {
            blobConfigOf(config).directorySuffix = ".blob\u0000s";
        },
        (config) => {
            blobConfigOf(config).receiptVersion = 0;
        },
        (config) => {
            blobConfigOf(config).receiptVersion = 2;
        },
    ]);
});

test("protocol configuration rejects invalid root witnesses and JSON bodies", () => {
    assertInvalid([
        (config) => {
            objectAt(objectAt(config, "kernel"), "rootWitness").mode = "unknown";
        },
        (config) => {
            objectAt(objectAt(config, "kernel"), "rootWitness").witnessRef = "not-empty";
        },
        (config) => {
            objectAt(objectAt(config, "kernel"), "rootWitness").schemaRef = "";
        },
        (config) => {
            objectAt(objectAt(config, "kernel"), "rootWitness").body = null;
        },
        (config) => {
            objectAt(objectAt(objectAt(config, "kernel"), "rootWitness"), "body").invalid =
                Number.NaN;
        },
        (config) => {
            objectAt(objectAt(objectAt(config, "kernel"), "rootWitness"), "body").invalid =
                undefined;
        },
        (config) => {
            objectAt(objectAt(objectAt(config, "kernel"), "rootWitness"), "body").invalid =
                "\uD800";
        },
        (config) => {
            objectAt(objectAt(objectAt(config, "kernel"), "rootWitness"), "body").complex = {
                enabled: true,
                list: ["value"],
                optional: null,
                ratio: 1,
            };
        },
        (config) => {
            Object.defineProperty(
                objectAt(objectAt(objectAt(config, "kernel"), "rootWitness"), "body"),
                "\uD800",
                { enumerable: true, value: "invalid-key" },
            );
        },
    ]);
});

test("protocol configuration rejects invalid or drifted query contracts", () => {
    assertInvalid([
        (config) => {
            queryConfigOf(config).closurePolicies = [];
        },
        (config) => {
            queryConfigOf(config).modeFilters = ["both", "both"];
        },
        (config) => {
            queryConfigOf(config).visibilityProfiles = ["payload", 1];
        },
        (config) => {
            queryConfigOf(config).defaultClosurePolicy = "unknown";
        },
        (config) => {
            queryConfigOf(config).defaultModeFilter = "unknown";
        },
        (config) => {
            queryConfigOf(config).defaultVisibilityProfile = "unknown";
        },
        (config) => {
            queryConfigOf(config).cutSchemaRef = "";
        },
        (config) => {
            queryConfigOf(config).witnessSchemaRef = "changed.witness.v1";
        },
    ]);
});

test("protocol configuration rejects invalid schema, artifact, and object shapes", () => {
    assertInvalid([
        (config) => {
            objectAt(objectAt(config, "kernel"), "schemas").dialect = "relative";
        },
        (config) => {
            objectAt(objectAt(config, "kernel"), "schemas").dialect =
                "http://json-schema.org/draft-07/schema#";
        },
        (config) => {
            const schemas = objectAt(objectAt(config, "kernel"), "schemas");
            schemas.recordViewId = schemas.recordBodyId;
        },
        (config) => {
            objectAt(objectAt(config, "kernel"), "artifacts").recordValues = "";
        },
        (config) => {
            config.extra = true;
        },
        (config) => {
            delete config.kernel;
        },
        (config) => {
            config.kernel = [];
        },
    ]);
    assert.throws(() => parseProtocolConfig(null), /must be an object/);
});

function assertInvalid(mutations: readonly Mutation[]): void {
    for (const mutate of mutations) {
        const config = structuredClone(validConfig);
        mutate(config);
        assert.throws(() => parseProtocolConfig(config), TypeError);
    }
}

function queryConfigOf(config: Record<string, unknown>): Record<string, unknown> {
    return objectAt(objectAt(config, "kernel"), "queries");
}

function objectAt(value: Record<string, unknown>, key: string): Record<string, unknown> {
    return value[key] as Record<string, unknown>;
}

function migrationsOf(config: Record<string, unknown>): Record<string, unknown>[] {
    return objectAt(objectAt(config, "kernel"), "store").migrations as Record<string, unknown>[];
}

function firstMigrationOf(config: Record<string, unknown>): Record<string, unknown> {
    const [migration] = migrationsOf(config);
    if (migration === undefined) {
        throw new Error("test fixture must contain a migration");
    }
    return migration;
}

function blobConfigOf(config: Record<string, unknown>): Record<string, unknown> {
    return objectAt(objectAt(config, "kernel"), "store").blobs as Record<string, unknown>;
}
