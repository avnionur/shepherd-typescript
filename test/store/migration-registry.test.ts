import assert from "node:assert/strict";
import { test } from "node:test";

import { UnsupportedStoreSchemaError } from "../../src/index.ts";
import { validateMigrationRegistry } from "../../src/store/migrations.ts";

test("migration registry versions are contiguous and match configured support", () => {
    const versions = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
    assert.doesNotThrow(() => validateMigrationRegistry(versions, versions.length));
    assert.throws(
        () => validateMigrationRegistry([1, 3], versions.length),
        UnsupportedStoreSchemaError,
    );
    assert.throws(
        () => validateMigrationRegistry([...versions, 13], versions.length),
        UnsupportedStoreSchemaError,
    );
    assert.throws(
        () => validateMigrationRegistry([], versions.length),
        UnsupportedStoreSchemaError,
    );
    assert.throws(
        () =>
            validateMigrationRegistry(versions, versions.length, [
                { firstOwnerOrdinal: 0, lastOwnerOrdinal: 1, version: 2 },
            ]),
        UnsupportedStoreSchemaError,
    );
    assert.throws(
        () =>
            validateMigrationRegistry(versions, versions.length, [
                { firstOwnerOrdinal: 0, lastOwnerOrdinal: 1, version: 1 },
                { firstOwnerOrdinal: 1, lastOwnerOrdinal: 2, version: 2 },
                { firstOwnerOrdinal: 1, lastOwnerOrdinal: 2, version: 3 },
                { firstOwnerOrdinal: 1, lastOwnerOrdinal: 2, version: 4 },
                { firstOwnerOrdinal: 1, lastOwnerOrdinal: 2, version: 5 },
                { firstOwnerOrdinal: 1, lastOwnerOrdinal: 2, version: 6 },
                { firstOwnerOrdinal: 1, lastOwnerOrdinal: 2, version: 7 },
                { firstOwnerOrdinal: 1, lastOwnerOrdinal: 2, version: 8 },
                { firstOwnerOrdinal: 1, lastOwnerOrdinal: 2, version: 9 },
                { firstOwnerOrdinal: 1, lastOwnerOrdinal: 2, version: 10 },
                { firstOwnerOrdinal: 1, lastOwnerOrdinal: 2, version: 11 },
                { firstOwnerOrdinal: 1, lastOwnerOrdinal: 2, version: 12 },
            ]),
        UnsupportedStoreSchemaError,
    );
    assert.throws(
        () => validateMigrationRegistry(versions, versions.length, []),
        UnsupportedStoreSchemaError,
    );
});
