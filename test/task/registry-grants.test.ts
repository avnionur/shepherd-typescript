import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
    grantTaskRepositories,
    listTaskLedger,
    resolveTaskLedgerSelector,
    runCli,
    SQLiteTaskRegistry,
    schema,
    TaskRegistryError,
    TaskVersionConflictError,
    task,
    UnsupportedTaskRegistrySchemaError,
} from "../../src/index.ts";

test("registered repository declarations survive read-only reopen for the exact task version", (context) => {
    const root = mkdtempSync(path.join(tmpdir(), "registry-grants-"));
    context.after(() => rmSync(root, { recursive: true, force: true }));
    const database = path.join(root, "tasks.sqlite");
    const descriptor = task({
        name: "mixed-repositories",
        version: "1",
        instruction: "Read docs and update source.",
        input: schema.string(),
        output: schema.string(),
    });
    const granted = grantTaskRepositories({
        task: descriptor,
        grants: [
            { binding: "docs", profile: "read-only" },
            { binding: "source", profile: "read-write" },
        ],
    });
    const registry = new SQLiteTaskRegistry(database);
    registry.registerGranted(granted);
    registry.close();
    using reopened = new SQLiteTaskRegistry(database, { readOnly: true });
    const entry = resolveTaskLedgerSelector(reopened, `${descriptor.artifactLock.task_id}@1`);
    assert.deepEqual(entry.repository_grant, {
        artifact: granted.artifact,
        artifact_lock: granted.artifactLock,
    });
    assert.deepEqual(listTaskLedger(reopened), [entry]);
    assert.equal(entry.artifact.instruction, descriptor.instruction);
});

test("registration authenticates handles and refuses grant changes without altering retained evidence", () => {
    using registry = new SQLiteTaskRegistry();
    const descriptor = task({
        name: "immutable-grants",
        version: "1",
        instruction: "Inspect.",
        input: schema.string(),
        output: schema.string(),
    });
    const granted = grantTaskRepositories({
        task: descriptor,
        grants: [{ binding: "source", profile: "read-only" }],
    });
    assert.throws(() => registry.registerGranted({ ...granted }), TypeError);
    const retained = registry.registerGranted(granted);
    assert.deepEqual(registry.registerGranted(granted), retained);
    assert.deepEqual(registry.register(descriptor), retained);
    const changed = grantTaskRepositories({
        task: descriptor,
        grants: [{ binding: "source", profile: "read-write" }],
    });
    assert.throws(() => registry.registerGranted(changed), TaskVersionConflictError);
    assert.throws(() => listTaskLedger(registry, undefined, [changed]), /differs from persisted/u);
    assert.deepEqual(
        listTaskLedger(registry, undefined, [granted])[0]?.repository_grant,
        retained.repositoryGrant,
    );
    const next = task({
        name: "immutable-grants",
        version: "2",
        instruction: "Inspect.",
        input: schema.string(),
        output: schema.string(),
    });
    registry.register(next);
    assert.throws(
        () =>
            registry.registerGranted(grantTaskRepositories({ task: next, grants: granted.grants })),
        TaskVersionConflictError,
    );
    assert.equal(
        resolveTaskLedgerSelector(registry, `${next.artifactLock.task_id}@2`).repository_grant,
        null,
    );
    registry.close();
    assert.throws(() => registry.registerGranted(granted), TaskRegistryError);
});

test("corrupt, stale and mismatched registry companions refuse task show and ledger reads", async (context) => {
    const root = mkdtempSync(path.join(tmpdir(), "registry-grant-corrupt-"));
    context.after(() => rmSync(root, { recursive: true, force: true }));
    const databasePath = path.join(root, "tasks.sqlite");
    const descriptor = task({
        name: "grant-corruption",
        version: "1",
        instruction: "Inspect.",
        input: schema.string(),
        output: schema.string(),
    });
    const granted = grantTaskRepositories({
        task: descriptor,
        grants: [{ binding: "source", profile: "read-only" }],
    });
    const original = { artifact: granted.artifact, artifact_lock: granted.artifactLock };
    const registry = new SQLiteTaskRegistry(databasePath);
    registry.registerGranted(granted);
    registry.close();
    using raw = new DatabaseSync(databasePath);
    const cases = [
        "{",
        "null",
        JSON.stringify({ ...original, extra: true }),
        JSON.stringify({
            ...original,
            artifact: { ...granted.artifact, task_artifact_digest: `sha256:${"0".repeat(64)}` },
        }),
        JSON.stringify({ ...original, artifact: { ...granted.artifact, grant_version: 0 } }),
        JSON.stringify({
            ...original,
            artifact: {
                ...granted.artifact,
                grants: [{ binding: "source", profile: "read-write" }],
            },
        }),
        JSON.stringify({
            ...original,
            artifact_lock: { ...granted.artifactLock, task_grant_id: "forged" },
        }),
        JSON.stringify({ ...original, artifact: { ...granted.artifact, grants: [] } }),
    ];
    for (const value of cases) {
        raw.prepare("UPDATE task_registrations SET repository_grant_json = ?").run(value);
        using reopened = new SQLiteTaskRegistry(databasePath, { readOnly: true });
        assert.throws(() => listTaskLedger(reopened), TaskRegistryError);
        assert.throws(
            () => resolveTaskLedgerSelector(reopened, `${descriptor.artifactLock.task_id}@1`),
            TaskRegistryError,
        );
        let output = "";
        let error = "";
        assert.equal(
            await runCli(
                [
                    "task",
                    "show",
                    `${descriptor.artifactLock.task_id}@1`,
                    "--registry",
                    databasePath,
                    "--json",
                ],
                {
                    cwd: root,
                    stdout: (text) => {
                        output += text;
                    },
                    stderr: (text) => {
                        error += text;
                    },
                },
            ),
            1,
        );
        assert.equal(output, "");
        assert.equal(JSON.parse(error).ok, false);
    }
});

test("task show reports declared profiles, instructions and schemas without claiming run authority", async (context) => {
    const root = mkdtempSync(path.join(tmpdir(), "task-show-grants-"));
    context.after(() => rmSync(root, { recursive: true, force: true }));
    const database = path.join(root, "tasks.sqlite");
    const descriptor = task({
        name: "inspection",
        version: "1",
        instruction: "Read docs and update source.",
        input: schema.string(),
        output: schema.string(),
    });
    const granted = grantTaskRepositories({
        task: descriptor,
        grants: [
            { binding: "docs", profile: "read-only" },
            { binding: "source", profile: "read-write" },
        ],
    });
    const registry = new SQLiteTaskRegistry(database);
    registry.registerGranted(granted);
    registry.close();
    for (const json of [false, true]) {
        let output = "";
        assert.equal(
            await runCli(
                [
                    "task",
                    "show",
                    `${descriptor.artifactLock.task_id}@1`,
                    "--registry",
                    database,
                    ...(json ? ["--json"] : []),
                ],
                {
                    cwd: root,
                    stdout: (text) => {
                        output += text;
                    },
                    stderr: (text) => assert.fail(text),
                },
            ),
            0,
        );
        if (json) {
            const entry = JSON.parse(output).result.task;
            assert.deepEqual(entry.repository_grant, {
                artifact: granted.artifact,
                artifact_lock: granted.artifactLock,
            });
            assert.deepEqual(entry.artifact, descriptor.artifact);
        } else {
            assert.match(output, /read-only/u);
            assert.match(output, /read-write/u);
            assert.match(output, /Instruction: "Read docs and update source\."/u);
            assert.match(output, /Input schema:/u);
            assert.match(output, /Output schema:/u);
            assert.match(output, /declarations only/u);
        }
    }
});

test("registry schema one upgrades atomically without inventing repository declarations", (context) => {
    const root = mkdtempSync(path.join(tmpdir(), "registry-grant-migration-"));
    context.after(() => rmSync(root, { recursive: true, force: true }));
    const databasePath = path.join(root, "tasks.sqlite");
    const descriptor = task({
        name: "legacy",
        version: "1",
        instruction: "Inspect.",
        input: schema.string(),
        output: schema.string(),
    });
    const raw = new DatabaseSync(databasePath);
    raw.exec(`CREATE TABLE task_schema_migrations (version INTEGER PRIMARY KEY) STRICT;
        INSERT INTO task_schema_migrations VALUES (1);
        CREATE TABLE task_registrations (task_id TEXT NOT NULL, task_version TEXT NOT NULL, artifact_digest TEXT NOT NULL, artifact_json TEXT NOT NULL, artifact_lock_json TEXT NOT NULL, PRIMARY KEY(task_id, task_version)) STRICT;`);
    raw.prepare("INSERT INTO task_registrations VALUES (?, ?, ?, ?, ?)").run(
        descriptor.artifactLock.task_id,
        descriptor.version,
        descriptor.artifactLock.artifact_digest,
        JSON.stringify(descriptor.artifact),
        JSON.stringify(descriptor.artifactLock),
    );
    raw.close();
    assert.throws(
        () => new SQLiteTaskRegistry(databasePath, { readOnly: true }),
        UnsupportedTaskRegistrySchemaError,
    );
    const migrated = new SQLiteTaskRegistry(databasePath);
    assert.equal(migrated.schemaVersion, 2);
    assert.deepEqual(
        migrated.resolve({ taskId: descriptor.artifactLock.task_id, version: descriptor.version }),
        { artifact: descriptor.artifact, artifactLock: descriptor.artifactLock },
    );
    migrated.close();
    using readonly = new SQLiteTaskRegistry(databasePath, { readOnly: true });
    assert.equal(listTaskLedger(readonly)[0]?.repository_grant, null);
});
