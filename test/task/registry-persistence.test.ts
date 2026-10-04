import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import {
    SQLiteTaskRegistry,
    TaskRegistryError,
    task,
    UnsupportedTaskRegistrySchemaError,
} from "../../src/index.ts";
import { taskDefinition } from "./registry-fixtures.ts";

test("SQLiteTaskRegistry preserves exact registrations across reopening", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-task-registry-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const databasePath = path.join(directory, "tasks.sqlite");
    const descriptor = task(taskDefinition());
    const first = new SQLiteTaskRegistry(databasePath);
    const registration = first.register(descriptor);
    assert.equal(first.schemaVersion, 2);
    first.close();

    using reopened = new SQLiteTaskRegistry(databasePath);
    assert.deepEqual(
        reopened.resolve({
            taskId: descriptor.artifactLock.task_id,
            version: descriptor.version,
        }),
        registration,
    );
});

test("read-only task registries require current schema without migration", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-read-only-registry-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const databasePath = path.join(directory, "tasks.sqlite");
    const descriptor = task(taskDefinition());
    const writable = new SQLiteTaskRegistry(databasePath);
    writable.register(descriptor);
    writable.close();
    using current = new SQLiteTaskRegistry(databasePath, { readOnly: true });
    assert.ok(
        current.resolve({ taskId: descriptor.artifactLock.task_id, version: descriptor.version }),
    );
    current.close();

    const database = new DatabaseSync(databasePath);
    database.prepare("DELETE FROM task_schema_migrations").run();
    database.close();
    assert.throws(
        () => new SQLiteTaskRegistry(databasePath, { readOnly: true }),
        UnsupportedTaskRegistrySchemaError,
    );
    const inspected = new DatabaseSync(databasePath);
    assert.equal(
        inspected.prepare("SELECT COUNT(*) AS count FROM task_schema_migrations").get()?.count,
        0,
    );
    inspected.close();
    const uninitializedPath = path.join(directory, "uninitialized.sqlite");
    new DatabaseSync(uninitializedPath).close();
    assert.throws(
        () => new SQLiteTaskRegistry(uninitializedPath, { readOnly: true }),
        UnsupportedTaskRegistrySchemaError,
    );
});

test("SQLiteTaskRegistry rejects corrupt retained artifacts through resolution", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-task-corruption-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const databasePath = path.join(directory, "tasks.sqlite");
    const firstDescriptor = task(taskDefinition());
    const secondDescriptor = task({ ...taskDefinition(), version: "2.0.0" });
    const movedDescriptor = task({ ...taskDefinition(), name: "movedNote", version: "3.0.0" });
    const registry = new SQLiteTaskRegistry(databasePath);
    registry.register(firstDescriptor);
    registry.register(secondDescriptor);
    registry.register(movedDescriptor);
    registry.close();
    const database = new DatabaseSync(databasePath);
    database
        .prepare("UPDATE task_registrations SET artifact_digest = ? WHERE task_version = ?")
        .run(`sha256:${"0".repeat(64)}`, firstDescriptor.version);
    database
        .prepare("UPDATE task_registrations SET artifact_json = ? WHERE task_version = ?")
        .run("{", secondDescriptor.version);
    database
        .prepare("UPDATE task_registrations SET task_id = ? WHERE task_version = ?")
        .run(firstDescriptor.artifactLock.task_id, movedDescriptor.version);
    database.close();
    using reopened = new SQLiteTaskRegistry(databasePath);

    for (const reference of [
        { taskId: firstDescriptor.artifactLock.task_id, version: firstDescriptor.version },
        { taskId: secondDescriptor.artifactLock.task_id, version: secondDescriptor.version },
        { taskId: firstDescriptor.artifactLock.task_id, version: movedDescriptor.version },
    ]) {
        assert.throws(() => reopened.resolve(reference), TaskRegistryError);
    }
});

test("SQLiteTaskRegistry rejects future schemas and rolls back failed migrations", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-task-migration-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const futurePath = path.join(directory, "future.sqlite");
    new SQLiteTaskRegistry(futurePath).close();
    const future = new DatabaseSync(futurePath);
    future.prepare("INSERT INTO task_schema_migrations(version) VALUES (?)").run(3);
    future.close();
    assert.throws(() => new SQLiteTaskRegistry(futurePath), UnsupportedTaskRegistrySchemaError);

    const failedPath = path.join(directory, "failed.sqlite");
    const failed = new DatabaseSync(failedPath);
    failed.exec("CREATE TABLE task_registrations (task_id TEXT PRIMARY KEY) STRICT");
    failed.close();
    assert.throws(() => new SQLiteTaskRegistry(failedPath), /already exists/u);
    const inspected = new DatabaseSync(failedPath);
    assert.equal(
        inspected.prepare("SELECT MAX(version) AS version FROM task_schema_migrations").get()
            ?.version,
        null,
    );
    inspected.close();
});
