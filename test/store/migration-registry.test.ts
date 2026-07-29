import assert from "node:assert/strict";
import { test } from "node:test";

import { UnsupportedStoreSchemaError } from "../../src/index.ts";
import { validateMigrationRegistry } from "../../src/store/migrations.ts";

test("migration registry versions are contiguous and match configured support", () => {
    assert.doesNotThrow(() => validateMigrationRegistry([1], 1));
    assert.throws(() => validateMigrationRegistry([1, 3], 3), UnsupportedStoreSchemaError);
    assert.throws(() => validateMigrationRegistry([1, 2], 1), UnsupportedStoreSchemaError);
    assert.throws(() => validateMigrationRegistry([], 1), UnsupportedStoreSchemaError);
    assert.throws(
        () =>
            validateMigrationRegistry([1], 1, [
                { firstOwnerOrdinal: 0, lastOwnerOrdinal: 1, version: 2 },
            ]),
        UnsupportedStoreSchemaError,
    );
    assert.throws(
        () =>
            validateMigrationRegistry([1], 1, [
                { firstOwnerOrdinal: 1, lastOwnerOrdinal: 2, version: 1 },
            ]),
        UnsupportedStoreSchemaError,
    );
    assert.throws(() => validateMigrationRegistry([1], 1, []), UnsupportedStoreSchemaError);
});
