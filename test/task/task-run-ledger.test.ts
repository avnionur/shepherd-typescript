import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import { Ajv2020, type AnySchemaObject, type ValidateFunction } from "ajv/dist/2020.js";

import {
    createStaticProvider,
    executeTaskDurably,
    grantTaskRepositories,
    LedgerSelectorAmbiguousError,
    LedgerSelectorNotFoundError,
    listRunLedger,
    listTaskLedger,
    type OwnerRecord,
    resolveRunLedgerSelector,
    resolveTaskLedgerSelector,
    SQLiteTaskRegistry,
    SQLiteTraceStore,
    schema,
    TASK_RUN_LEDGER_LATEST_SELECTOR,
    TASK_RUN_LEDGER_LIMITS,
    task,
} from "../../src/index.ts";

class InterruptedBeforeClaimStore extends SQLiteTraceStore {
    override claimDurableExecutionInvocation(): never {
        throw new Error("provider claim interrupted");
    }
}

class CorruptingCreatedPayloadStore extends InterruptedBeforeClaimStore {
    corruptCreation: "accessor" | "absent" | "none" = "none";

    override readOwner(ownerId: string): readonly OwnerRecord[] {
        const records = super.readOwner(ownerId);
        if (this.corruptCreation === "none") return records;
        return records.map((record) =>
            Object.hasOwn(record.body, "payload")
                ? ({
                      ...record,
                      body:
                          this.corruptCreation === "absent"
                              ? Object.freeze({})
                              : Object.defineProperty({}, "payload", { get: () => null }),
                  } as OwnerRecord)
                : record,
        );
    }
}

test("task ledger lists canonical registrations and resolves read selectors", () => {
    using registry = new SQLiteTaskRegistry();
    const second = task({
        input: schema.void(),
        instruction: "Second canonical task.",
        name: "second-ledger-task",
        output: schema.string(),
        version: "1",
    });
    const first = task({
        input: schema.void(),
        instruction: "First canonical task.",
        name: "first-ledger-task",
        output: schema.string(),
        version: "1",
    });
    registry.register(second);
    registry.register(first);
    const granted = grantTaskRepositories({
        grants: [{ binding: "source", profile: "read-only" }],
        task: first,
    });

    const entries = listTaskLedger(registry, undefined, [granted]);
    const { validateTask } = ledgerSchemaValidators();
    assert.equal(validateTask(entries[0]), true, JSON.stringify(validateTask.errors));
    assert.equal(validateTask({ ...entries[0], ledger_version: 2 }), false);
    assert.equal(entries.length, 2);
    assert.equal(Object.isFrozen(entries), true);
    assert.equal(entries[0]?.compatibility_version, "shepherd.task-run-ledgers.v1");
    assert.deepEqual(
        entries.map((entry) => entry.artifact_lock.task_id),
        [...entries.map((entry) => entry.artifact_lock.task_id)].sort(),
    );
    const exact = resolveTaskLedgerSelector(registry, `${first.artifactLock.task_id}@1`, [granted]);
    assert.equal(exact.artifact_lock.artifact_digest, first.artifactLock.artifact_digest);
    assert.equal(
        exact.repository_grant?.artifact_lock.task_grant_id,
        granted.artifactLock.task_grant_id,
    );
    const uniquePrefix = shortestUniquePrefix(
        first.artifactLock.task_id,
        second.artifactLock.task_id,
    );
    assert.equal(
        resolveTaskLedgerSelector(registry, uniquePrefix).artifact_lock.task_id,
        first.artifactLock.task_id,
    );
    assert.deepEqual(
        resolveTaskLedgerSelector(registry, TASK_RUN_LEDGER_LATEST_SELECTOR, [granted]),
        entries.at(-1),
    );
    assert.throws(
        () => resolveTaskLedgerSelector(registry, "task:sha256:"),
        (error: unknown) => {
            assert.equal(error instanceof LedgerSelectorAmbiguousError, true);
            assert.equal((error as LedgerSelectorAmbiguousError).code, "LEDGER_SELECTOR_AMBIGUOUS");
            return true;
        },
    );
    assert.throws(
        () => resolveTaskLedgerSelector(registry, "task:sha256:missing"),
        (error: unknown) => {
            assert.equal(error instanceof LedgerSelectorNotFoundError, true);
            assert.equal((error as LedgerSelectorNotFoundError).code, "LEDGER_SELECTOR_NOT_FOUND");
            return true;
        },
    );
    assert.deepEqual(listTaskLedger(registry, { limit: 1, offset: 1 }, [granted]), [entries[1]]);
    assert.throws(
        () => registry.resolve({ taskId: TASK_RUN_LEDGER_LATEST_SELECTOR, version: "1" }),
        TypeError,
    );
    assert.throws(() => listTaskLedger(registry, undefined, [granted, granted]), /ambiguous/u);
    assert.throws(
        () => listTaskLedger(registry, undefined, [{}] as never),
        /must be created by this package instance/u,
    );
    assert.throws(
        () => listTaskLedger(registry, undefined, {} as never),
        /exceeds configured bounds/u,
    );
    assert.throws(
        () =>
            listTaskLedger(
                registry,
                undefined,
                Array.from({ length: TASK_RUN_LEDGER_LIMITS.maxPageSize + 1 }, () => granted),
            ),
        /exceeds configured bounds/u,
    );
});

test("ledger selectors and pagination reject malformed or open inputs", () => {
    using registry = new SQLiteTaskRegistry();
    const descriptor = task({
        input: schema.void(),
        instruction: "Validate ledger bounds.",
        name: "ledger-bounds",
        output: schema.void(),
        version: "1",
    });
    registry.register(descriptor);

    for (const options of [
        null,
        1,
        "options",
        [],
        new Date(),
        { extra: true },
        { limit: 0 },
        { limit: 1.5 },
        { limit: "1" },
        { limit: TASK_RUN_LEDGER_LIMITS.maxPageSize + 1 },
        { offset: -1 },
        { offset: 0.5 },
        { offset: "0" },
        Object.defineProperty({}, "limit", { get: () => 1 }),
        { [Symbol("open")]: true },
    ]) {
        assert.throws(() => listTaskLedger(registry, options as never), TypeError);
    }
    for (const selector of [
        null,
        "",
        "has whitespace",
        "x".repeat(TASK_RUN_LEDGER_LIMITS.maxSelectorBytes + 1),
        "@",
        "@1",
        `${descriptor.artifactLock.task_id}@`,
    ]) {
        assert.throws(() => resolveTaskLedgerSelector(registry, selector as never), TypeError);
    }
    assert.throws(
        () => resolveTaskLedgerSelector(registry, `${descriptor.artifactLock.task_id}@2`),
        LedgerSelectorNotFoundError,
    );
    assert.deepEqual(listTaskLedger(registry, {}), listTaskLedger(registry));
    assert.deepEqual(
        listTaskLedger(registry, Object.create(null) as object),
        listTaskLedger(registry),
    );
    using oversizedRegistry = new SQLiteTaskRegistry();
    oversizedRegistry.register(
        task({
            input: schema.void(),
            instruction: "x".repeat(TASK_RUN_LEDGER_LIMITS.maxCanonicalEntryBytes),
            name: "oversized-ledger-entry",
            output: schema.void(),
            version: "1",
        }),
    );
    assert.throws(() => listTaskLedger(oversizedRegistry), /canonical JSON bound/u);
    using candidateRegistry = new SQLiteTaskRegistry();
    let candidateTaskId = "";
    for (let version = 0; version <= TASK_RUN_LEDGER_LIMITS.maxPageSize; version += 1) {
        const candidate = task({
            input: schema.void(),
            instruction: `Bound selector candidate ${version}.`,
            name: "bounded-selector-candidates",
            output: schema.void(),
            version: String(version),
        });
        candidateTaskId = candidate.artifactLock.task_id;
        candidateRegistry.register(candidate);
    }
    assert.throws(
        () => resolveTaskLedgerSelector(candidateRegistry, candidateTaskId),
        LedgerSelectorAmbiguousError,
    );
    using empty = new SQLiteTaskRegistry();
    assert.throws(
        () => resolveTaskLedgerSelector(empty, TASK_RUN_LEDGER_LATEST_SELECTOR),
        LedgerSelectorNotFoundError,
    );
});

test("run ledger composes durable evidence and resolves import-stable selectors", async () => {
    using store = new SQLiteTraceStore();
    const descriptor = task({
        input: schema.string(),
        instruction: "Return the supplied ledger value.",
        name: "run-ledger-task",
        output: schema.string(),
        version: "1",
    });
    for (const [runId, value] of [
        ["run:ledger:beta", "beta"],
        ["run:ledger:alpha", "alpha"],
    ] as const) {
        const provider = createStaticProvider({
            descriptor: { id: `provider:${value}`, model: "offline-v1" },
            exchanges: [
                {
                    request: {
                        input: value,
                        instruction: descriptor.instruction,
                        outputSchema: descriptor.artifact.output_schema,
                    },
                    response: {
                        output: value,
                        usage: {
                            cacheCreationInputTokens: 0,
                            cacheReadInputTokens: 0,
                            costUsd: null,
                            inputTokens: 1,
                            outputTokens: 1,
                        },
                    },
                },
            ],
        });
        await executeTaskDurably(store, {
            budget: { maxTurns: 1 },
            input: value,
            provider,
            runId,
            task: descriptor,
        });
    }

    const entries = listRunLedger(store);
    assert.equal(entries.length, 2);
    assert.equal(Object.isFrozen(entries), true);
    assert.deepEqual(listRunLedger(store, { limit: 1, offset: 1 }), [entries[1]]);
    assert.deepEqual(
        entries.map(({ created_record_id: recordId, run_id: runId }) => `${recordId}\0${runId}`),
        [...entries]
            .sort((left, right) =>
                Buffer.from(`${left.created_record_id}\0${left.run_id}`).compare(
                    Buffer.from(`${right.created_record_id}\0${right.run_id}`),
                ),
            )
            .map(({ created_record_id: recordId, run_id: runId }) => `${recordId}\0${runId}`),
    );
    const alpha = resolveRunLedgerSelector(store, "run:ledger:alpha");
    const { validateRun } = ledgerSchemaValidators();
    assert.equal(validateRun(alpha), true, JSON.stringify(validateRun.errors));
    assert.equal(validateRun({ ...alpha, ledger_version: 2 }), false);
    assert.equal(validateRun({ ...alpha, provider: { ...alpha.provider, extra: true } }), false);
    assert.equal(alpha.input, "alpha");
    assert.equal(alpha.inspection.status, "committed");
    assert.equal(alpha.world_capture.status, "absent");
    assert.equal(alpha.task_artifact_lock.task_id, descriptor.artifactLock.task_id);
    assert.equal(resolveRunLedgerSelector(store, "run:ledger:a").run_id, alpha.run_id);
    assert.deepEqual(
        resolveRunLedgerSelector(store, TASK_RUN_LEDGER_LATEST_SELECTOR),
        entries.at(-1),
    );
    assert.throws(
        () => resolveRunLedgerSelector(store, "run:ledger:"),
        LedgerSelectorAmbiguousError,
    );
    assert.throws(
        () => resolveRunLedgerSelector(store, "run:missing"),
        LedgerSelectorNotFoundError,
    );

    using imported = new SQLiteTraceStore();
    imported.importTrace(store.exportTrace());
    assert.deepEqual(listRunLedger(imported), entries);
    using empty = new SQLiteTraceStore();
    assert.deepEqual(listRunLedger(empty), []);
    assert.throws(
        () => resolveRunLedgerSelector(empty, TASK_RUN_LEDGER_LATEST_SELECTOR),
        LedgerSelectorNotFoundError,
    );

    using collision = new SQLiteTraceStore();
    await executeTaskDurably(collision, {
        budget: { maxTurns: 1 },
        input: "alpha",
        provider: createStaticProvider({
            descriptor: { id: "provider:latest-collision", model: "offline-v1" },
            exchanges: [
                {
                    request: {
                        input: "alpha",
                        instruction: descriptor.instruction,
                        outputSchema: descriptor.artifact.output_schema,
                    },
                    response: {
                        output: "alpha",
                        usage: {
                            cacheCreationInputTokens: 0,
                            cacheReadInputTokens: 0,
                            costUsd: null,
                            inputTokens: 1,
                            outputTokens: 1,
                        },
                    },
                },
            ],
        }),
        runId: TASK_RUN_LEDGER_LATEST_SELECTOR,
        task: descriptor,
    });
    assert.equal(
        resolveRunLedgerSelector(collision, TASK_RUN_LEDGER_LATEST_SELECTOR).run_id,
        TASK_RUN_LEDGER_LATEST_SELECTOR,
    );
});

test("run ledger exposes incomplete creation and rejects duplicate creation evidence", async () => {
    using interrupted = new InterruptedBeforeClaimStore();
    const descriptor = task({
        input: schema.void(),
        instruction: "Retain an incomplete ledger run.",
        name: "incomplete-ledger-run",
        output: schema.void(),
        version: "1",
    });
    const provider = createStaticProvider({
        descriptor: { id: "provider:never-invoked", model: "offline-v1" },
        exchanges: [],
    });
    await assert.rejects(
        executeTaskDurably(interrupted, {
            budget: { maxTurns: 1 },
            input: undefined,
            provider,
            runId: "run:ledger:incomplete",
            task: descriptor,
        }),
        /provider claim interrupted/u,
    );
    const [entry] = listRunLedger(interrupted);
    assert.equal(entry?.inspection.status, "created");
    assert.equal(entry?.inspection.outcome, null);
    assert.equal(entry?.inspection.cut, null);
    assert.equal(entry?.input, null);
    assert.equal(entry?.world_capture.recovery_status, "created");

    const created = interrupted
        .readOwner("run:ledger:incomplete")
        .find((record) => Object.hasOwn(record.body, "payload"));
    assert.notEqual(created, undefined);
    interrupted.append({
        append_intent_id: "append:duplicate-ledger-creation",
        batch: {
            groups: [
                {
                    owner_id: "run:ledger:incomplete",
                    records: [
                        {
                            body: created?.body ?? {},
                            mode: created?.envelope.mode ?? "capture",
                            schema_ref: created?.envelope.schema_ref ?? "",
                            witness_ref: created?.envelope.witness_ref ?? "",
                        },
                    ],
                },
            ],
        },
    });
    assert.throws(() => listRunLedger(interrupted), /creation evidence is absent or ambiguous/u);

    using corrupt = new CorruptingCreatedPayloadStore();
    await assert.rejects(
        executeTaskDurably(corrupt, {
            budget: { maxTurns: 1 },
            input: undefined,
            provider,
            runId: "run:ledger:corrupt-created",
            task: descriptor,
        }),
        /provider claim interrupted/u,
    );
    corrupt.corruptCreation = "absent";
    assert.throws(() => listRunLedger(corrupt), /creation payload is absent/u);
    corrupt.corruptCreation = "accessor";
    assert.throws(() => listRunLedger(corrupt), /creation payload is absent/u);

    using candidates = new InterruptedBeforeClaimStore();
    for (let index = 0; index <= TASK_RUN_LEDGER_LIMITS.maxPageSize; index += 1) {
        await assert.rejects(
            executeTaskDurably(candidates, {
                budget: { maxTurns: 1 },
                input: undefined,
                provider,
                runId: `run:ledger:bounded:${index}`,
                task: descriptor,
            }),
            /provider claim interrupted/u,
        );
    }
    assert.throws(
        () => resolveRunLedgerSelector(candidates, "run:ledger:bounded:"),
        LedgerSelectorAmbiguousError,
    );
});

test("task and run ledgers reopen in a fresh process and reject corrupt task keys", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-ledger-fresh-process-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const taskPath = path.join(directory, "tasks.sqlite");
    const tracePath = path.join(directory, "trace.sqlite");
    const descriptor = task({
        input: schema.string(),
        instruction: "Persist a fresh-process ledger value.",
        name: "fresh-process-ledger",
        output: schema.string(),
        version: "1",
    });
    const registry = new SQLiteTaskRegistry(taskPath);
    registry.register(descriptor);
    registry.close();
    const store = new SQLiteTraceStore(tracePath);
    await executeTaskDurably(store, {
        budget: { maxTurns: 1 },
        input: "fresh",
        provider: createStaticProvider({
            descriptor: { id: "provider:fresh", model: "offline-v1" },
            exchanges: [
                {
                    request: {
                        input: "fresh",
                        instruction: descriptor.instruction,
                        outputSchema: descriptor.artifact.output_schema,
                    },
                    response: {
                        output: "fresh",
                        usage: {
                            cacheCreationInputTokens: 0,
                            cacheReadInputTokens: 0,
                            costUsd: null,
                            inputTokens: 1,
                            outputTokens: 1,
                        },
                    },
                },
            ],
        }),
        runId: "run:ledger:fresh-process",
        task: descriptor,
    });
    store.close();
    const program = `
        import {
            listRunLedger,
            listTaskLedger,
            resolveRunLedgerSelector,
            SQLiteTaskRegistry,
            SQLiteTraceStore,
        } from "./src/index.ts";
        using tasks = new SQLiteTaskRegistry(process.argv[1]);
        using runs = new SQLiteTraceStore(process.argv[2]);
        process.stdout.write(JSON.stringify({
            run: resolveRunLedgerSelector(runs, "@latest").run_id,
            runCount: listRunLedger(runs).length,
            taskCount: listTaskLedger(tasks).length,
        }));
    `;
    const output = execFileSync(
        process.execPath,
        ["--experimental-strip-types", "--input-type=module", "-e", program, taskPath, tracePath],
        { cwd: path.resolve("."), encoding: "utf8" },
    );
    assert.deepEqual(JSON.parse(output), {
        run: "run:ledger:fresh-process",
        runCount: 1,
        taskCount: 1,
    });

    const database = new DatabaseSync(taskPath);
    database.prepare("UPDATE task_registrations SET task_id = ?").run("task:sha256:corrupt");
    database.close();
    using corruptRegistry = new SQLiteTaskRegistry(taskPath);
    assert.throws(() => listTaskLedger(corruptRegistry), /key disagrees/u);
});

function shortestUniquePrefix(value: string, other: string): string {
    for (let length = 1; length <= value.length; length += 1) {
        const prefix = value.slice(0, length);
        if (!other.startsWith(prefix)) return prefix;
    }
    throw new Error("task identities are equal");
}

function ledgerSchemaValidators(): {
    readonly validateRun: ValidateFunction;
    readonly validateTask: ValidateFunction;
} {
    const validator = new Ajv2020({ strict: true });
    validator.addKeyword("x-shepherd-max-canonical-bytes");
    const schemaDirectory = new URL("../../spec/schemas/", import.meta.url);
    for (const name of readdirSync(schemaDirectory).filter((candidate) =>
        candidate.endsWith(".schema.json"),
    )) {
        validator.addSchema(readJson(new URL(name, schemaDirectory)));
    }
    const validateRun = validator.getSchema(
        "https://avnionur.github.io/shepherd-typescript/schemas/run-ledger-entry-v1.schema.json",
    );
    const validateTask = validator.getSchema(
        "https://avnionur.github.io/shepherd-typescript/schemas/task-ledger-entry-v1.schema.json",
    );
    assert.ok(validateRun);
    assert.ok(validateTask);
    return {
        validateRun,
        validateTask,
    };
}

function readJson(url: URL): AnySchemaObject {
    return JSON.parse(readFileSync(url, "utf8")) as AnySchemaObject;
}
