import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { promisify } from "node:util";

import {
    canonicalizeRecord,
    type OperationBookkeepingDefinition,
    ORPHAN_REPAIR_BLOCKERS,
    ORPHAN_REPAIR_LIMITS,
    ORPHAN_REPAIR_VERSIONS,
    type OrphanRepairCommand,
    OrphanRepairError,
    ROOT_WITNESS_ID,
    SQLiteTraceStore,
} from "../../src/index.ts";

const execFileAsync = promisify(execFile);

test("public diagnosis is read-only, bounded, canonical, and distinguishes repair blockers", () => {
    using store = new SQLiteTraceStore();
    store.recordOpenOperation(operation("operation:b", "session:dead"));
    store.recordOpenOperation(
        operation("operation:a", "session:live", {
            provider_call_started: true,
            scope_id: "scope:retained",
            scope_owned: true,
        }),
    );
    store.recordOperationSessionDeath({
        death_evidence_id: "session-lock:dead",
        session_id: "session:dead",
    });

    const first = store.diagnoseOrphanedOperations({ limit: 1, offset: 0 });
    const second = store.diagnoseOrphanedOperations({ limit: 1, offset: 1 });
    assert.equal(first.basis_id, second.basis_id);
    assert.equal(first.total_count, 2);
    assert.equal(first.repairable_count, 1);
    assert.equal(first.blocked_count, 1);
    assert.deepEqual(
        first.operations.map(({ operation_id }) => operation_id),
        ["operation:a"],
    );
    assert.deepEqual(
        second.operations.map(({ operation_id }) => operation_id),
        ["operation:b"],
    );
    assert.deepEqual(first.operations[0]?.blockers, [
        ORPHAN_REPAIR_BLOCKERS.liveSession,
        ORPHAN_REPAIR_BLOCKERS.providerStarted,
        ORPHAN_REPAIR_BLOCKERS.scopeOwned,
    ]);
    assert.equal(first.operations[0]?.repairable, false);
    assert.equal(first.operations[0]?.session_status, "live");
    assert.equal(second.operations[0]?.repairable, true);
    assert.equal(second.operations[0]?.session_status, "dead");
    assert.equal(second.operations[0]?.death_evidence_id, "session-lock:dead");
    assert.deepEqual(store.diagnoseOrphanedOperations({ limit: 1, offset: 9 }).operations, []);
});

test("explicit repair removes only exact proven-dead bookkeeping and retains audit records", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-orphan-repair-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const databasePath = path.join(directory, "trace.sqlite");
    const userFile = path.join(directory, "user.txt");
    await writeFile(userFile, "unchanged\n");
    const source = new SQLiteTraceStore(databasePath);
    const causeRecordId = source.append({
        append_intent_id: "intent:repair-cause",
        batch: {
            groups: [
                {
                    owner_id: "run:repair",
                    records: [
                        {
                            body: { retained: "cause" },
                            mode: "capture",
                            schema_ref: "example.repair.cause.v1",
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    }).record_ids[0];
    assert.ok(causeRecordId);
    const blob = source.putBlob(new TextEncoder().encode("retained custody"));
    source.recordOpenOperation(
        operation("operation:repair", "session:repair", { cause_record_id: causeRecordId }),
    );
    source.recordOperationSessionDeath({
        death_evidence_id: "session-lock:repair",
        session_id: "session:repair",
    });
    const diagnosis = source.diagnoseOrphanedOperations();
    const command = repairCommand("repair:one", diagnosis);

    const receipt = source.repairOrphanedOperations(command);
    assert.equal(receipt.repaired_count, 1);
    assert.deepEqual(receipt.operation_ids, ["operation:repair"]);
    assert.equal(source.diagnoseOrphanedOperations().total_count, 0);
    assert.deepEqual(source.readBlob(blob.blob_id), new TextEncoder().encode("retained custody"));
    assert.ok(source.readRecord(receipt.command_record_id));
    assert.ok(source.readRecord(receipt.receipt_record_id));
    assert.equal(await readFile(userFile, "utf8"), "unchanged\n");
    const archive = source.exportTrace();
    source.close();

    using reopened = new SQLiteTraceStore(databasePath);
    assert.deepEqual(reopened.repairOrphanedOperations(command), receipt);
    assert.equal(reopened.diagnoseOrphanedOperations().total_count, 0);

    using imported = new SQLiteTraceStore(path.join(directory, "imported.sqlite"));
    imported.importTrace(archive);
    assert.ok(imported.readRecord(receipt.command_record_id));
    assert.ok(imported.readRecord(receipt.receipt_record_id));
    assert.equal(imported.diagnoseOrphanedOperations().total_count, 0);
});

test("empty repair is a globally idempotent no-op with canonical evidence", () => {
    using store = new SQLiteTraceStore();
    const diagnosis = store.diagnoseOrphanedOperations();
    const command = repairCommand("repair:empty", diagnosis);
    const first = store.repairOrphanedOperations(command);
    const second = store.repairOrphanedOperations(command);

    assert.deepEqual(second, first);
    assert.equal(first.repaired_count, 0);
    assert.deepEqual(first.operation_ids, []);
    assert.ok(store.readRecord(first.command_record_id));
    assert.ok(store.readRecord(first.receipt_record_id));
});

test("prepared interrupted repair converges after reopen and rejects conflicting command reuse", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-orphan-interrupt-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const databasePath = path.join(directory, "trace.sqlite");
    const first = new SQLiteTraceStore(databasePath);
    first.recordOpenOperation(operation("operation:interrupted", "session:interrupted"));
    first.recordOperationSessionDeath({
        death_evidence_id: "session-lock:interrupted",
        session_id: "session:interrupted",
    });
    const command = repairCommand("repair:interrupted", first.diagnoseOrphanedOperations());
    const prepared = first.prepareOrphanedOperationRepair(command);
    assert.ok(first.readRecord(prepared.command_record_id));
    assert.equal(first.diagnoseOrphanedOperations().total_count, 1);
    first.close();

    using reopened = new SQLiteTraceStore(databasePath);
    const receipt = reopened.repairOrphanedOperations(command);
    assert.equal(receipt.command_record_id, prepared.command_record_id);
    assert.equal(reopened.diagnoseOrphanedOperations().total_count, 0);
    assert.throws(
        () =>
            reopened.prepareOrphanedOperationRepair({
                ...command,
                operation_ids: ["operation:different"],
            }),
        (error) =>
            error instanceof OrphanRepairError && error.code === "ORPHAN_REPAIR_COMMAND_CONFLICT",
    );
});

test("SIGKILL after durable prepare leaves no false receipt and converges on retry", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-orphan-kill-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const databasePath = path.join(directory, "trace.sqlite");
    const commandPath = path.join(directory, "command.json");
    const fixturePath = new URL("../fixtures/orphan-repair-process.ts", import.meta.url).pathname;
    const setup = new SQLiteTraceStore(databasePath);
    setup.recordOpenOperation(operation("operation:killed", "session:killed"));
    setup.recordOperationSessionDeath({
        death_evidence_id: "session-lock:killed",
        session_id: "session:killed",
    });
    const command = repairCommand("repair:killed", setup.diagnoseOrphanedOperations());
    await writeFile(commandPath, JSON.stringify(command));
    setup.close();

    await assert.rejects(
        execFileAsync(process.execPath, [fixturePath, databasePath, commandPath, "prepare-crash"]),
        (error: NodeJS.ErrnoException & { signal?: string }) => error.signal === "SIGKILL",
    );
    using reopened = new SQLiteTraceStore(databasePath);
    assert.equal(reopened.diagnoseOrphanedOperations().total_count, 1);
    const receipt = reopened.repairOrphanedOperations(command);
    assert.equal(receipt.repaired_count, 1);
    assert.equal(reopened.diagnoseOrphanedOperations().total_count, 0);
});

test("receipt-marker failure rolls back deletion and receipt before retry", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-orphan-marker-failure-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const databasePath = path.join(directory, "trace.sqlite");
    const store = new SQLiteTraceStore(databasePath);
    store.recordOpenOperation(operation("operation:marker-failure", "session:marker-failure"));
    store.recordOperationSessionDeath({
        death_evidence_id: "session-lock:marker-failure",
        session_id: "session:marker-failure",
    });
    const command = repairCommand("repair:marker-failure", store.diagnoseOrphanedOperations());
    store.prepareOrphanedOperationRepair(command);
    store.close();
    const database = new DatabaseSync(databasePath);
    database.exec(`
        CREATE TRIGGER fail_orphan_repair_marker
        BEFORE INSERT ON orphan_operation_repairs
        BEGIN
            SELECT RAISE(ABORT, 'synthetic marker failure');
        END;
    `);
    database.close();

    const failing = new SQLiteTraceStore(databasePath);
    assert.throws(() => failing.repairOrphanedOperations(command), /synthetic marker failure/);
    assert.equal(failing.diagnoseOrphanedOperations().total_count, 1);
    failing.close();
    const inspected = new DatabaseSync(databasePath);
    assert.equal(
        inspected
            .prepare("SELECT COUNT(*) AS count FROM append_intents WHERE append_intent_id = ?")
            .get(`orphan-repair-receipt:${command.command_id}`)?.count,
        0,
    );
    inspected.exec("DROP TRIGGER fail_orphan_repair_marker");
    inspected.close();

    using retried = new SQLiteTraceStore(databasePath);
    assert.equal(retried.repairOrphanedOperations(command).repaired_count, 1);
    assert.equal(retried.diagnoseOrphanedOperations().total_count, 0);
});

test("repair fails closed for live, provider-started, scope-owned, stale, and incomplete evidence", () => {
    using store = new SQLiteTraceStore();
    store.recordOpenOperation(operation("operation:live", "session:live"));
    let diagnosis = store.diagnoseOrphanedOperations();
    assertRepairCode(
        () => store.repairOrphanedOperations(repairCommand("repair:live", diagnosis)),
        "ORPHAN_REPAIR_BLOCKED",
    );
    assert.equal(store.diagnoseOrphanedOperations().total_count, 1);

    assert.equal(store.completeOpenOperation("operation:live", "session:wrong"), false);
    assert.equal(store.completeOpenOperation("operation:live", "session:live"), true);
    assert.equal(store.completeOpenOperation("operation:live", "session:live"), false);

    store.recordOpenOperation(
        operation("operation:provider", "session:provider", { provider_call_started: true }),
    );
    store.recordOperationSessionDeath({
        death_evidence_id: "session-lock:provider",
        session_id: "session:provider",
    });
    diagnosis = store.diagnoseOrphanedOperations();
    assertRepairCode(
        () => store.repairOrphanedOperations(repairCommand("repair:provider", diagnosis)),
        "ORPHAN_REPAIR_BLOCKED",
    );

    store.recordOpenOperation(
        operation("operation:scope", "session:scope", {
            scope_id: "scope:wip",
            scope_owned: true,
        }),
    );
    store.recordOperationSessionDeath({
        death_evidence_id: "session-lock:scope",
        session_id: "session:scope",
    });
    diagnosis = store.diagnoseOrphanedOperations();
    assertRepairCode(
        () => store.repairOrphanedOperations(repairCommand("repair:scope", diagnosis)),
        "ORPHAN_REPAIR_BLOCKED",
    );

    using staleStore = new SQLiteTraceStore();
    staleStore.recordOpenOperation(operation("operation:stale", "session:stale"));
    staleStore.recordOperationSessionDeath({
        death_evidence_id: "session-lock:stale",
        session_id: "session:stale",
    });
    const staleDiagnosis = staleStore.diagnoseOrphanedOperations();
    const staleCommand = repairCommand("repair:stale", staleDiagnosis);
    staleStore.recordOpenOperation(operation("operation:changed", "session:changed"));
    assertRepairCode(
        () => staleStore.repairOrphanedOperations(staleCommand),
        "ORPHAN_REPAIR_STALE_BASIS",
    );
    const current = staleStore.diagnoseOrphanedOperations();
    assertRepairCode(
        () =>
            staleStore.repairOrphanedOperations({
                ...repairCommand("repair:incomplete", current),
                operation_ids: ["operation:stale"],
            }),
        "ORPHAN_REPAIR_BLOCKED",
    );
});

test("same and competing connections converge without conflicting success", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-orphan-concurrent-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const databasePath = path.join(directory, "trace.sqlite");
    using first = new SQLiteTraceStore(databasePath);
    using second = new SQLiteTraceStore(databasePath);
    first.recordOpenOperation(operation("operation:concurrent", "session:concurrent"));
    first.recordOperationSessionDeath({
        death_evidence_id: "session-lock:concurrent",
        session_id: "session:concurrent",
    });
    const diagnosis = first.diagnoseOrphanedOperations();
    const command = repairCommand("repair:concurrent", diagnosis);
    const one = first.repairOrphanedOperations(command);
    const two = second.repairOrphanedOperations({
        ...command,
        operation_ids: [...command.operation_ids].reverse(),
    });
    assert.deepEqual(two, one);

    first.recordOpenOperation(operation("operation:competition", "session:competition"));
    first.recordOperationSessionDeath({
        death_evidence_id: "session-lock:competition",
        session_id: "session:competition",
    });
    const competition = first.diagnoseOrphanedOperations();
    const winner = repairCommand("repair:winner", competition);
    const loser = repairCommand("repair:loser", competition);
    first.prepareOrphanedOperationRepair(loser);
    first.repairOrphanedOperations(winner);
    assertRepairCode(() => second.repairOrphanedOperations(loser), "ORPHAN_REPAIR_STALE_BASIS");
});

test("fresh processes concurrently applying an identical command converge on one receipt", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-orphan-process-race-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const databasePath = path.join(directory, "trace.sqlite");
    const commandPath = path.join(directory, "command.json");
    const fixturePath = new URL("../fixtures/orphan-repair-process.ts", import.meta.url).pathname;
    const setup = new SQLiteTraceStore(databasePath);
    setup.recordOpenOperation(operation("operation:process-race", "session:process-race"));
    setup.recordOperationSessionDeath({
        death_evidence_id: "session-lock:process-race",
        session_id: "session:process-race",
    });
    const command = repairCommand("repair:process-race", setup.diagnoseOrphanedOperations());
    await writeFile(commandPath, JSON.stringify(command));
    setup.close();

    const [first, second] = await Promise.all([
        execFileAsync(process.execPath, [fixturePath, databasePath, commandPath]),
        execFileAsync(process.execPath, [fixturePath, databasePath, commandPath]),
    ]);
    assert.deepEqual(JSON.parse(second.stdout), JSON.parse(first.stdout));
    using inspected = new SQLiteTraceStore(databasePath);
    assert.equal(inspected.diagnoseOrphanedOperations().total_count, 0);
});

test("pre-run reclaim is fail-soft and preserves exact evidence for manual repair", () => {
    using store = new SQLiteTraceStore();
    store.recordOpenOperation(
        operation("operation:blocked-pre-run", "session:blocked-pre-run", {
            scope_id: "scope:blocked-pre-run",
            scope_owned: true,
        }),
    );
    store.recordOperationSessionDeath({
        death_evidence_id: "session-lock:blocked-pre-run",
        session_id: "session:blocked-pre-run",
    });
    const declined = store.reclaimOrphanedOperationsBeforeRun("repair:pre-run-declined");
    assert.equal(declined.status, "declined");
    assert.equal(declined.error_code, "ORPHAN_REPAIR_BLOCKED");
    assert.equal(declined.diagnosis?.total_count, 1);

    store.completeOpenOperation("operation:blocked-pre-run", "session:blocked-pre-run");
    store.recordOpenOperation(operation("operation:pre-run", "session:pre-run"));
    store.recordOperationSessionDeath({
        death_evidence_id: "session-lock:pre-run",
        session_id: "session:pre-run",
    });
    const repaired = store.reclaimOrphanedOperationsBeforeRun("repair:pre-run");
    assert.equal(repaired.status, "repaired");
    assert.equal(repaired.receipt.repaired_count, 1);
});

test("operation inputs and command containers reject malformed, open, bounded, and unsupported evidence", () => {
    using store = new SQLiteTraceStore();
    const valid = operation("operation:validation", "session:validation");
    assert.deepEqual(store.recordOpenOperation(valid), valid);
    assert.deepEqual(store.recordOpenOperation({ ...valid }), valid);
    assert.throws(
        () => store.recordOpenOperation({ ...valid, retained_cause: "changed" }),
        (error) => error instanceof OrphanRepairError && error.code === "ORPHAN_REPAIR_CORRUPT",
    );
    assert.throws(
        () => store.recordOpenOperation({ ...valid, extra: true } as never),
        /declared data fields/,
    );
    assert.throws(
        () =>
            store.recordOpenOperation(
                Object.defineProperty({ ...valid }, "owner_id", { get: () => "run:accessor" }),
            ),
        /declared data fields/,
    );
    assert.throws(
        () => store.recordOpenOperation({ ...valid, operation_version: 99 }),
        (error) =>
            error instanceof OrphanRepairError &&
            error.code === "ORPHAN_REPAIR_UNSUPPORTED_VERSION",
    );
    assert.throws(
        () =>
            store.recordOpenOperation({
                ...valid,
                operation_id: "x".repeat(ORPHAN_REPAIR_LIMITS.maxIdentifierBytes + 1),
            }),
        /configured byte limit/,
    );
    assert.throws(
        () =>
            store.recordOpenOperation({
                ...valid,
                retained_cause: "x".repeat(ORPHAN_REPAIR_LIMITS.maxCauseBytes + 1),
            }),
        /configured byte limit/,
    );
    assert.throws(
        () =>
            store.recordOpenOperation({
                ...valid,
                cause_record_id: `sha256:${"1".repeat(64)}`,
                operation_id: "operation:missing-cause",
            }),
        /retained canonical evidence/,
    );
    assert.throws(() => store.diagnoseOrphanedOperations({ limit: 0 }), /configured bounds/);
    assert.throws(() => store.diagnoseOrphanedOperations({ offset: -1 }), /configured bounds/);
    assert.throws(
        () =>
            store.diagnoseOrphanedOperations({
                offset: ORPHAN_REPAIR_LIMITS.maxOperations + 1,
            }),
        /configured bounds/,
    );
    assert.throws(() => store.diagnoseOrphanedOperations(null as never), /must be an object/);
    assert.throws(() => store.diagnoseOrphanedOperations(new Date() as never), /plain object/);
    assert.throws(
        () => store.diagnoseOrphanedOperations({ unknown: true } as never),
        /declared data fields/,
    );
    assert.throws(() => store.recordOpenOperation({} as never), /exactly its declared fields/);
    assert.throws(() => store.recordOpenOperation(null as never), /must be an object/);
    assert.throws(
        () => store.recordOpenOperation(Object.assign(new Date(), valid)),
        /plain object/,
    );
    const symbolOperation = { ...valid } as OperationBookkeepingDefinition & {
        [key: symbol]: true;
    };
    symbolOperation[Symbol("extra")] = true;
    assert.throws(() => store.recordOpenOperation(symbolOperation), /declared data fields/);
    assert.throws(
        () => store.recordOpenOperation({ ...valid, operation_id: "" }),
        /non-empty well-formed string/,
    );
    assert.throws(
        () => store.recordOpenOperation({ ...valid, operation_id: "\ud800" }),
        /well-formed string/,
    );
    assert.throws(
        () => store.recordOpenOperation({ ...valid, operation_version: 0 }),
        /positive safe integer/,
    );
    assert.throws(
        () => store.recordOpenOperation({ ...valid, operation_version: 1.5 }),
        /positive safe integer/,
    );
    assert.throws(
        () => store.recordOpenOperation({ ...valid, provider_call_started: "no" as never }),
        /must be a boolean/,
    );
    assert.throws(
        () =>
            store.recordOpenOperation({
                ...valid,
                cause_record_id: "invalid",
                operation_id: "operation:invalid-cause",
            }),
        /configured record identifier/,
    );
    const diagnosis = store.diagnoseOrphanedOperations();
    assert.throws(
        () =>
            store.repairOrphanedOperations({
                ...repairCommand("repair:unsupported", diagnosis),
                command_version: 2,
            }),
        (error) =>
            error instanceof OrphanRepairError &&
            error.code === "ORPHAN_REPAIR_UNSUPPORTED_VERSION",
    );
    assert.throws(
        () =>
            store.repairOrphanedOperations({
                ...repairCommand("repair:duplicates", diagnosis),
                operation_ids: ["operation:validation", "operation:validation"],
            }),
        /unique identities/,
    );
    assert.throws(
        () =>
            store.repairOrphanedOperations({
                ...repairCommand("repair:bad-basis", diagnosis),
                basis_id: "invalid",
            }),
        /configured digest identifier/,
    );
    assert.throws(
        () =>
            store.repairOrphanedOperations({
                ...repairCommand("repair:short-basis", diagnosis),
                basis_id: "orphan-diagnosis:sha256:0",
            }),
        /configured digest identifier/,
    );
    assert.throws(
        () =>
            store.repairOrphanedOperations({
                ...repairCommand("repair:nonhex-basis", diagnosis),
                basis_id: `orphan-diagnosis:sha256:${"z".repeat(64)}`,
            }),
        /configured digest identifier/,
    );
    using exactSetStore = new SQLiteTraceStore();
    const emptyDiagnosis = exactSetStore.diagnoseOrphanedOperations();
    assertRepairCode(
        () =>
            exactSetStore.repairOrphanedOperations({
                ...repairCommand("repair:inexact-set", emptyDiagnosis),
                operation_ids: ["operation:not-in-basis"],
            }),
        "ORPHAN_REPAIR_STALE_BASIS",
    );
    assert.throws(
        () =>
            store.repairOrphanedOperations({
                ...repairCommand("repair:not-array", diagnosis),
                operation_ids: null as never,
            }),
        /must be an array/,
    );
    assert.throws(
        () =>
            store.repairOrphanedOperations({
                ...repairCommand("repair:empty-id", diagnosis),
                operation_ids: [""],
            }),
        /non-empty well-formed string/,
    );
    assert.throws(
        () =>
            store.repairOrphanedOperations({
                ...repairCommand("repair:too-many", diagnosis),
                operation_ids: Array.from(
                    { length: ORPHAN_REPAIR_LIMITS.maxOperations + 1 },
                    (_, index) => `operation:${index}`,
                ),
            }),
        /configured maximum/,
    );
    store.completeOpenOperation("operation:validation", "session:validation");
    const failSoftMalformed = store.reclaimOrphanedOperationsBeforeRun("");
    assert.equal(failSoftMalformed.status, "declined");
    assert.equal(failSoftMalformed.error_code, "ORPHAN_REPAIR_CORRUPT");
    assert.equal(
        store.recordOperationSessionDeath({
            death_evidence_id: "session-lock:absent",
            session_id: "session:absent",
        }),
        0,
    );
    assert.throws(
        () =>
            store.recordOperationSessionDeath({
                death_evidence_id: "",
                session_id: "session:x",
            }),
        /non-empty well-formed string/,
    );
    assert.throws(
        () => store.completeOpenOperation("", "session:x"),
        /non-empty well-formed string/,
    );
});

test("fail-soft reclaim reports a prepared command conflict without throwing", () => {
    using store = new SQLiteTraceStore();
    const initial = store.diagnoseOrphanedOperations();
    store.prepareOrphanedOperationRepair(repairCommand("repair:fail-soft-conflict", initial));
    store.recordOpenOperation(
        operation("operation:fail-soft-conflict", "session:fail-soft-conflict"),
    );
    store.recordOperationSessionDeath({
        death_evidence_id: "session-lock:fail-soft-conflict",
        session_id: "session:fail-soft-conflict",
    });
    const result = store.reclaimOrphanedOperationsBeforeRun("repair:fail-soft-conflict");
    assert.equal(result.status, "declined");
    assert.equal(result.error_code, "ORPHAN_REPAIR_COMMAND_CONFLICT");
});

test("fail-soft reclaim converts operational diagnosis failures into corruption evidence", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-orphan-diagnosis-failure-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const databasePath = path.join(directory, "trace.sqlite");
    const store = new SQLiteTraceStore(databasePath);
    const database = new DatabaseSync(databasePath);
    database.exec("DROP TABLE orphan_operations");
    database.close();
    const result = store.reclaimOrphanedOperationsBeforeRun("repair:diagnosis-failure");
    assert.equal(result.status, "declined");
    assert.equal(result.error_code, "ORPHAN_REPAIR_CORRUPT");
    assert.equal(result.diagnosis, null);
    store.close();
});

test("command preparation propagates non-conflict store failures", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-orphan-append-failure-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const databasePath = path.join(directory, "trace.sqlite");
    const commandId = "repair:append-failure";
    const initial = new SQLiteTraceStore(databasePath);
    const command = repairCommand(commandId, initial.diagnoseOrphanedOperations());
    initial.close();
    const database = new DatabaseSync(databasePath);
    database
        .prepare("INSERT INTO owner_ordinals(owner_id, next_ordinal) VALUES (?, ?)")
        .run(`orphan-repair:${commandId}`, Number.MAX_SAFE_INTEGER);
    database.close();
    using reopened = new SQLiteTraceStore(databasePath);
    assert.throws(() => reopened.prepareOrphanedOperationRepair(command), RangeError);
});

test("configured total-operation bounds fail closed on admission and retained overflow", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-orphan-limit-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const databasePath = path.join(directory, "trace.sqlite");
    const store = new SQLiteTraceStore(databasePath);
    for (let index = 0; index < ORPHAN_REPAIR_LIMITS.maxOperations; index += 1) {
        store.recordOpenOperation(operation(`operation:limit:${index}`, `session:limit:${index}`));
    }
    assert.throws(
        () =>
            store.recordOpenOperation(
                operation("operation:limit:overflow", "session:limit:overflow"),
            ),
        /configured maximum/,
    );
    store.close();

    const overflow = operation(
        "operation:limit:retained-overflow",
        "session:limit:retained-overflow",
    );
    const operationJson = canonicalizeRecord(overflow);
    const database = new DatabaseSync(databasePath);
    database
        .prepare(
            `INSERT INTO orphan_operations(
                operation_id, owner_id, session_id, operation_digest, operation_json
             ) VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
            overflow.operation_id,
            overflow.owner_id,
            overflow.session_id,
            createHash("sha256").update(operationJson).digest("hex"),
            operationJson,
        );
    database.close();
    using reopened = new SQLiteTraceStore(databasePath);
    assertRepairCode(() => reopened.diagnoseOrphanedOperations(), "ORPHAN_REPAIR_CORRUPT");
});

test("retained corruption and death-evidence conflict fail closed without mutation", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-orphan-corruption-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const databasePath = path.join(directory, "trace.sqlite");
    const store = new SQLiteTraceStore(databasePath);
    store.recordOpenOperation(operation("operation:corrupt", "session:corrupt"));
    assert.equal(
        store.recordOperationSessionDeath({
            death_evidence_id: "session-lock:corrupt",
            session_id: "session:corrupt",
        }),
        1,
    );
    assert.equal(
        store.recordOperationSessionDeath({
            death_evidence_id: "session-lock:corrupt",
            session_id: "session:corrupt",
        }),
        1,
    );
    assert.throws(
        () =>
            store.recordOperationSessionDeath({
                death_evidence_id: "session-lock:different",
                session_id: "session:corrupt",
            }),
        (error) => error instanceof OrphanRepairError && error.code === "ORPHAN_REPAIR_CORRUPT",
    );
    store.close();
    const database = new DatabaseSync(databasePath);
    database
        .prepare("UPDATE orphan_operations SET operation_digest = ? WHERE operation_id = ?")
        .run("corrupt", "operation:corrupt");
    database.close();

    using reopened = new SQLiteTraceStore(databasePath);
    assert.throws(
        () => reopened.diagnoseOrphanedOperations(),
        (error) => error instanceof OrphanRepairError && error.code === "ORPHAN_REPAIR_CORRUPT",
    );
    const failSoft = reopened.reclaimOrphanedOperationsBeforeRun("repair:corrupt-pre-run");
    assert.equal(failSoft.status, "declined");
    assert.equal(failSoft.error_code, "ORPHAN_REPAIR_CORRUPT");
    assert.equal(failSoft.diagnosis, null);
});

test("malformed retained JSON and forged repair commit evidence fail closed", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-orphan-forgery-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const malformedPath = path.join(directory, "malformed.sqlite");
    const malformed = new SQLiteTraceStore(malformedPath);
    malformed.recordOpenOperation(operation("operation:malformed-json", "session:malformed-json"));
    malformed.close();
    const database = new DatabaseSync(malformedPath);
    database
        .prepare("UPDATE orphan_operations SET operation_json = ? WHERE operation_id = ?")
        .run("{", "operation:malformed-json");
    database.close();
    using malformedReopened = new SQLiteTraceStore(malformedPath);
    assertRepairCode(() => malformedReopened.diagnoseOrphanedOperations(), "ORPHAN_REPAIR_CORRUPT");

    for (const variant of ["count", "identity", "command", "version"] as const) {
        const databasePath = path.join(directory, `${variant}.sqlite`);
        const store = new SQLiteTraceStore(databasePath);
        const diagnosis = store.diagnoseOrphanedOperations();
        const command = repairCommand(`repair:forged-${variant}`, diagnosis);
        const prepared = store.prepareOrphanedOperationRepair(command);
        const base = {
            basis_id: diagnosis.basis_id,
            command_id: variant === "command" ? "repair:other" : command.command_id,
            command_record_id: prepared.command_record_id,
            operation_ids: [] as string[],
            repaired_count: variant === "count" ? 1 : 0,
            receipt_version: variant === "version" ? 2 : ORPHAN_REPAIR_VERSIONS.receipt,
        };
        const receiptId =
            variant === "identity"
                ? `orphan-repair-receipt:sha256:${"0".repeat(64)}`
                : canonicalReceiptId(base);
        const body = { ...base, receipt_id: receiptId };
        const forged = store.append({
            append_intent_id: `orphan-repair-receipt:${command.command_id}`,
            batch: {
                groups: [
                    {
                        owner_id: `orphan-repair:${command.command_id}`,
                        records: [
                            {
                                body,
                                mode: "capture",
                                schema_ref: "shepherd.orphan-repair.receipt.v1",
                                witness_ref: ROOT_WITNESS_ID,
                            },
                        ],
                    },
                ],
            },
        });
        const forgedRecordId = forged.record_ids[0];
        assert.ok(forgedRecordId);
        store.close();
        const markerDatabase = new DatabaseSync(databasePath);
        markerDatabase
            .prepare(
                `INSERT INTO orphan_operation_repairs(
                    command_id, basis_id, command_record_id, receipt_record_id, receipt_json
                 ) VALUES (?, ?, ?, ?, ?)`,
            )
            .run(
                command.command_id,
                command.basis_id,
                prepared.command_record_id,
                forgedRecordId,
                canonicalizeRecord(body),
            );
        markerDatabase.close();
        using reopened = new SQLiteTraceStore(databasePath);
        assertRepairCode(
            () => reopened.repairOrphanedOperations(command),
            variant === "version" ? "ORPHAN_REPAIR_UNSUPPORTED_VERSION" : "ORPHAN_REPAIR_CORRUPT",
        );
    }
});

test("a valid public receipt forgery cannot report success without the atomic commit marker", () => {
    using store = new SQLiteTraceStore();
    store.recordOpenOperation(operation("operation:forged-valid", "session:forged-valid"));
    store.recordOperationSessionDeath({
        death_evidence_id: "session-lock:forged-valid",
        session_id: "session:forged-valid",
    });
    const diagnosis = store.diagnoseOrphanedOperations();
    const command = repairCommand("repair:forged-valid", diagnosis);
    const prepared = store.prepareOrphanedOperationRepair(command);
    const base = {
        basis_id: diagnosis.basis_id,
        command_id: command.command_id,
        command_record_id: prepared.command_record_id,
        operation_ids: ["operation:forged-valid"],
        repaired_count: 1,
        receipt_version: ORPHAN_REPAIR_VERSIONS.receipt,
    };
    store.append({
        append_intent_id: "forged:valid-wrong-provenance",
        batch: {
            groups: [
                {
                    caused_by_record_ids: [prepared.command_record_id],
                    owner_id: `orphan-repair:${command.command_id}`,
                    records: [
                        {
                            body: { ...base, receipt_id: canonicalReceiptId(base) },
                            mode: "capture",
                            schema_ref: "shepherd.orphan-repair.receipt.v1",
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    });

    const actual = store.repairOrphanedOperations(command);
    assert.equal(actual.repaired_count, 1);
    assert.equal(store.diagnoseOrphanedOperations().total_count, 0);
    assert.deepEqual(store.repairOrphanedOperations(command), actual);
});

test("repair commit markers fail closed when command or receipt provenance disagrees", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-orphan-marker-corruption-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    for (const variant of ["basis", "command", "receipt"] as const) {
        const databasePath = path.join(directory, `${variant}.sqlite`);
        const store = new SQLiteTraceStore(databasePath);
        const command = repairCommand(
            `repair:marker-corrupt-${variant}`,
            store.diagnoseOrphanedOperations(),
        );
        const prepared = store.prepareOrphanedOperationRepair(command);
        store.close();
        const database = new DatabaseSync(databasePath);
        database
            .prepare(
                `INSERT INTO orphan_operation_repairs(
                    command_id, basis_id, command_record_id, receipt_record_id, receipt_json
                 ) VALUES (?, ?, ?, ?, ?)`,
            )
            .run(
                command.command_id,
                variant === "basis" ? "basis:wrong" : command.basis_id,
                variant === "command" ? ROOT_WITNESS_ID : prepared.command_record_id,
                prepared.command_record_id,
                "{}",
            );
        database.close();
        using reopened = new SQLiteTraceStore(databasePath);
        assertRepairCode(() => reopened.repairOrphanedOperations(command), "ORPHAN_REPAIR_CORRUPT");
    }
});

test("every retained operation-column disagreement fails closed", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-orphan-column-corruption-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const mutations = [
        "UPDATE orphan_operations SET operation_id = 'operation:changed'",
        "UPDATE orphan_operations SET owner_id = 'run:changed'",
        "UPDATE orphan_operations SET session_id = 'session:changed'",
        "UPDATE orphan_operations SET operation_json = operation_json || ' '",
        "UPDATE orphan_operations SET operation_digest = 'changed'",
        "UPDATE orphan_operations SET session_dead = 2",
        "UPDATE orphan_operations SET death_evidence_id = 'unexpected'",
        "UPDATE orphan_operations SET session_dead = 1, death_evidence_id = NULL",
    ] as const;
    for (const [index, mutation] of mutations.entries()) {
        const databasePath = path.join(directory, `${index}.sqlite`);
        const store = new SQLiteTraceStore(databasePath);
        store.recordOpenOperation(operation("operation:column", "session:column"));
        store.close();
        const database = new DatabaseSync(databasePath);
        database.exec("PRAGMA ignore_check_constraints = ON");
        database.exec(mutation);
        database.close();
        using reopened = new SQLiteTraceStore(databasePath);
        assertRepairCode(() => reopened.diagnoseOrphanedOperations(), "ORPHAN_REPAIR_CORRUPT");
    }
});

test("closed stores guard every orphan repair operation", () => {
    const store = new SQLiteTraceStore();
    const diagnosis = store.diagnoseOrphanedOperations();
    const command = repairCommand("repair:closed", diagnosis);
    store.close();
    assert.throws(() => store.recordOpenOperation(operation("operation:closed", "session:closed")));
    assert.throws(() =>
        store.recordOperationSessionDeath({ death_evidence_id: "dead", session_id: "closed" }),
    );
    assert.throws(() => store.completeOpenOperation("operation:closed", "session:closed"));
    assert.throws(() => store.diagnoseOrphanedOperations());
    assert.throws(() => store.prepareOrphanedOperationRepair(command));
    assert.throws(() => store.repairOrphanedOperations(command));
    assert.throws(() => store.reclaimOrphanedOperationsBeforeRun("repair:closed"));
});

function operation(
    operationId: string,
    sessionId: string,
    overrides: Partial<OperationBookkeepingDefinition> = {},
): OperationBookkeepingDefinition {
    return {
        cause_record_id: null,
        operation_id: operationId,
        operation_version: ORPHAN_REPAIR_VERSIONS.operation,
        owner_id: `run:${operationId}`,
        provider_call_started: false,
        retained_cause: "runtime operation remained open after session loss",
        scope_id: null,
        scope_owned: false,
        session_id: sessionId,
        ...overrides,
    };
}

function repairCommand(
    commandId: string,
    diagnosis: ReturnType<SQLiteTraceStore["diagnoseOrphanedOperations"]>,
): OrphanRepairCommand {
    return {
        basis_id: diagnosis.basis_id,
        command_id: commandId,
        command_version: ORPHAN_REPAIR_VERSIONS.command,
        operation_ids: diagnosis.operations.map(({ operation_id }) => operation_id),
    };
}

function assertRepairCode(callback: () => unknown, code: string): void {
    assert.throws(callback, (error) => error instanceof OrphanRepairError && error.code === code);
}

function canonicalReceiptId(value: Parameters<typeof canonicalizeRecord>[0]): string {
    return `orphan-repair-receipt:sha256:${createHash("sha256")
        .update(canonicalizeRecord(value))
        .digest("hex")}`;
}
