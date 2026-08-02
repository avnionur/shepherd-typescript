import assert from "node:assert/strict";
import { test } from "node:test";

import { UnsupportedTaskRegistrySchemaError } from "../../src/index.ts";
import { validateTaskRegistryMigrationVersions } from "../../src/task/registry-migrations.ts";

test("task-registry migration versions must match configured contiguous support", () => {
    assert.doesNotThrow(() => validateTaskRegistryMigrationVersions([1], 1, [1]));
    assert.throws(
        () => validateTaskRegistryMigrationVersions([1], 2, [1]),
        UnsupportedTaskRegistrySchemaError,
    );
    assert.throws(
        () => validateTaskRegistryMigrationVersions([1], 1, [1, 2]),
        UnsupportedTaskRegistrySchemaError,
    );
    assert.throws(
        () => validateTaskRegistryMigrationVersions([2], 1, [2]),
        UnsupportedTaskRegistrySchemaError,
    );
    assert.throws(
        () => validateTaskRegistryMigrationVersions([1], 1, [2]),
        UnsupportedTaskRegistrySchemaError,
    );
});
