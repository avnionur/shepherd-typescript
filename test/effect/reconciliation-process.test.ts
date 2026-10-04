import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { type TestContext, test } from "node:test";
import { fileURLToPath } from "node:url";
import { publicErrorCodes } from "../../src/errors/public-errors.ts";
import {
    type EffectReconciliationReceipt,
    inspectEffectCompensation,
    inspectEffectReconciliation,
    type ReconcileEffectOptions,
} from "../../src/index.ts";
import { effectProtocolConfig } from "../../src/protocol/config.ts";
import { readRowIds } from "./compensation-fixtures.ts";
import { reconciliationFixture } from "./reconciliation-fixtures.ts";

type Message =
    | { readonly kind: "ready" }
    | { readonly kind: "ok"; readonly receipt: EffectReconciliationReceipt }
    | { readonly kind: "error"; readonly name: string; readonly code: string | null };

function childFor(
    context: TestContext,
    database: string,
    request: ReconcileEffectOptions,
    mode: string,
) {
    const { authority, ...command } = request;
    const child = fork(
        fileURLToPath(new URL("../fixtures/reconciliation-process.ts", import.meta.url)),
        [
            database,
            JSON.stringify({ actorId: authority.actorId, policyId: authority.policyId, command }),
            mode,
        ],
        { silent: true, execArgv: [] },
    );
    const exited = once(child, "exit");
    let errors = "";
    child.stderr?.on("data", (chunk: Buffer) => {
        errors += chunk.toString();
    });
    context.after(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    });
    const message = async (): Promise<Message> => {
        const [value] = await Promise.race([
            once(child, "message"),
            exited.then(() => {
                throw new Error(`fixture exited before message: ${errors}`);
            }),
        ]);
        return value as Message;
    };
    return { child, exited, message };
}

test("operator commands recover in a fresh process across publication SIGKILL boundaries", async (context) => {
    for (const mode of ["before", "after"]) {
        const fixture = await reconciliationFixture(context, mode);
        const killed = childFor(context, fixture.databasePath, fixture.request, mode);
        const [code, signal] = await killed.exited;
        assert.equal(code, null);
        assert.equal(signal, "SIGKILL");
        assert.equal(
            inspectEffectReconciliation(fixture.store, { effectRecordId: fixture.effectRecordId })
                .decisions.length,
            mode === "before" ? 0 : 1,
        );
        const recovered = childFor(context, fixture.databasePath, fixture.request, "run");
        const result = await recovered.message();
        await recovered.exited;
        assert.equal(result.kind, "ok");
        assert.equal(
            inspectEffectReconciliation(fixture.store, { effectRecordId: fixture.effectRecordId })
                .decisions.length,
            1,
        );
        const repeated = childFor(context, fixture.databasePath, fixture.request, "run");
        const replay = await repeated.message();
        await repeated.exited;
        assert.deepEqual(replay, result);
        assert.equal(
            inspectEffectCompensation(fixture.store, {
                compensationId: fixture.inspection.target.compensation_id,
            }).status,
            "failed",
        );
        assert.deepEqual(readRowIds(fixture.worldPath), ["a"]);
        assert.equal(fixture.store.verifyIntegrity().ok, true);
    }
});

test("concurrent resolution publishes one decision, replays equal commands and rejects conflicting ones", async (context) => {
    for (const mode of ["equal", "different-command", "changed-request"]) {
        const fixture = await reconciliationFixture(context, mode);
        const other =
            mode === "equal"
                ? fixture.request
                : mode === "different-command"
                  ? { ...fixture.request, commandId: "competing" }
                  : { ...fixture.request, reason: "A different operator reason." };
        const first = childFor(context, fixture.databasePath, fixture.request, "hold");
        const second = childFor(context, fixture.databasePath, other, "hold");
        assert.deepEqual(await Promise.all([first.message(), second.message()]), [
            { kind: "ready" },
            { kind: "ready" },
        ]);
        const replies = Promise.all([first.message(), second.message()]);
        first.child.send("continue");
        second.child.send("continue");
        const results = await replies;
        await Promise.all([first.exited, second.exited]);
        if (mode === "equal") {
            assert.equal(results[0]?.kind, "ok");
            assert.deepEqual(results[0], results[1]);
        } else {
            assert.equal(results.filter((result) => result.kind === "ok").length, 1);
            const failure = results.find((result) => result.kind === "error");
            assert.ok(failure?.kind === "error");
            assert.ok(
                [
                    effectProtocolConfig.compensation.errors.conflictCode,
                    publicErrorCodes.trace.appendIntentConflict,
                ].includes(failure.code ?? ""),
                JSON.stringify({ mode, results }),
            );
        }
        assert.equal(
            inspectEffectReconciliation(fixture.store, { effectRecordId: fixture.effectRecordId })
                .decisions.length,
            1,
        );
        assert.deepEqual(readRowIds(fixture.worldPath), ["a"]);
        assert.equal(fixture.store.verifyIntegrity().ok, true);
    }
});
