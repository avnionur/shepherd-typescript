import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
    createRetainedWorldRunner,
    DurableExecutionRecoveryError,
    inspectTaskWorldEffects,
    recoverTaskWorldDurably,
    SQLiteTraceStore,
} from "../../src/index.ts";
import { createWorldEffectFixture } from "./world-effect-fixtures.ts";

test("process interruption distinguishes pre-materialization intent from an uncertain completed write", async (context) => {
    for (const stage of ["before", "after"] as const) {
        const fixture = await createWorldEffectFixture(context);
        const child = spawnSync(
            process.execPath,
            [
                fileURLToPath(new URL("../fixtures/world-effect-process.ts", import.meta.url)),
                stage,
                fixture.workspaceRoot,
            ],
            { encoding: "utf8", timeout: 30_000 },
        );
        assert.equal(child.signal, "SIGKILL", child.stderr);
        using store = new SQLiteTraceStore(fixture.storePath);
        const evidence = inspectTaskWorldEffects(store, fixture.options.execution.runId);
        assert.equal(evidence.recovery_status, "started");
        assert.equal(evidence.status, stage === "before" ? "not_materialized" : "uncertain");
        assert.equal(evidence.operations.length, 1);
        const operation = evidence.operations[0];
        assert.ok(operation);
        assert.equal(operation.outcome, null);
        assert.equal(operation.admission_record_id === null, stage === "before");
        const custodyId = evidence.authority?.custody_id;
        assert.ok(custodyId);
        const custody = await fixture.options.carrier.openCustody(custodyId);
        assert.equal(
            await readFile(path.join(custody.path, "value.txt"), "utf8"),
            stage === "before" ? "original" : "changed",
        );
        assert.equal(
            await readFile(path.join(fixture.sourceRoot, "value.txt"), "utf8"),
            "original",
        );
        using imported = new SQLiteTraceStore();
        imported.importTrace(store.exportTrace());
        assert.deepEqual(
            inspectTaskWorldEffects(imported, fixture.options.execution.runId),
            evidence,
        );
        const runner = createRetainedWorldRunner({
            enforcement: "advisory",
            runnerId: "crash-world-effect",
            run: async () => {
                throw new Error("uncertain runner must never repeat");
            },
        });
        await assert.rejects(
            recoverTaskWorldDurably({
                ...fixture.options,
                runner,
                store,
                commandId: "recovery:world-effect",
            }),
            DurableExecutionRecoveryError,
        );
        assert.equal(
            await readFile(path.join(custody.path, "value.txt"), "utf8"),
            stage === "before" ? "original" : "changed",
        );
    }
});
