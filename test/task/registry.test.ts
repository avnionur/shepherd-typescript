import assert from "node:assert/strict";
import { test } from "node:test";

import {
    SQLiteTaskRegistry,
    TaskRegistryError,
    TaskVersionConflictError,
    task,
} from "../../src/index.ts";
import { taskDefinition } from "./registry-fixtures.ts";

test("SQLiteTaskRegistry registers and exactly resolves a task artifact", () => {
    using registry = new SQLiteTaskRegistry();
    const descriptor = task(taskDefinition());

    const registration = registry.register(descriptor);

    assert.deepEqual(registration, {
        artifact: descriptor.artifact,
        artifactLock: descriptor.artifactLock,
    });
    assert.deepEqual(
        registry.resolve({
            taskId: descriptor.artifactLock.task_id,
            version: descriptor.version,
        }),
        registration,
    );
    assert.equal(Object.isFrozen(registration), true);
});

test("SQLiteTaskRegistry replays equal registration and rejects version conflicts", () => {
    using registry = new SQLiteTaskRegistry();
    const original = task(taskDefinition());
    const conflicting = task({
        ...taskDefinition(),
        instruction: "Write two notes about the topic.",
    });

    const retained = registry.register(original);

    assert.deepEqual(registry.register(original), retained);
    assert.throws(() => registry.register(conflicting), TaskVersionConflictError);
    assert.deepEqual(
        registry.resolve({
            taskId: original.artifactLock.task_id,
            version: original.version,
        }),
        retained,
    );
});

test("SQLiteTaskRegistry returns undefined for an absent exact version", () => {
    using registry = new SQLiteTaskRegistry();
    const descriptor = task(taskDefinition());

    assert.equal(
        registry.resolve({
            taskId: descriptor.artifactLock.task_id,
            version: "2.0.0",
        }),
        undefined,
    );
});

test("SQLiteTaskRegistry closes idempotently and guards public operations", () => {
    const registry = new SQLiteTaskRegistry();
    const descriptor = task(taskDefinition());
    registry.close();
    registry.close();

    assert.throws(() => registry.register(descriptor), TaskRegistryError);
    assert.throws(
        () =>
            registry.resolve({
                taskId: descriptor.artifactLock.task_id,
                version: descriptor.version,
            }),
        TaskRegistryError,
    );
});
