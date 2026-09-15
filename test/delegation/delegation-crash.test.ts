import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { type TestContext, test } from "node:test";

import {
    acceptChildRunResult,
    acknowledgeDurableTaskCancellation,
    DelegationStatusError,
    DurableExecutionRecoveryError,
    discardChildRun,
    inspectChildRun,
    inspectDurableTaskExecution,
    type OwnerRecord,
    openChildRun,
    type ProviderDescriptor,
    projectChildRunResult,
    recoverTaskDurably,
    requestDurableTaskCancellation,
    retryChildRun,
    runChildRun,
    SQLiteTraceStore,
    schema,
} from "../../src/index.ts";
import { echoTask, openOptions, temporaryDatabasePath } from "./fixtures.ts";

const FIXTURE = new URL("../fixtures/delegation-process.ts", import.meta.url).pathname;
const LEAD = "supervisor:lead";

test("a child killed after its durable start is running and fail-closed until cancelled through durable control", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "crash-before-terminal");
    new SQLiteTraceStore(databasePath).close();
    const { child, line } = await runUntil(context, ["before-terminal", databasePath], "started ");
    await kill(child);
    const [, claimId, fencingToken, startedRecordId] = line.split(" ");
    assert.ok(claimId !== undefined && fencingToken !== undefined && startedRecordId !== undefined);
    using store = new SQLiteTraceStore(databasePath);
    const { handle } = openChildRun(store, openOptions("delegate:before-terminal"));
    const crashed = inspectChildRun(store, handle.handle_id);
    // Handle status follows the child's durable recovery classification.
    assert.equal(crashed.status, "running");
    assert.equal(crashed.completion, null);
    assert.equal(crashed.child?.status, "started");
    assert.equal(crashed.child?.lifecycle.started_record_id, startedRecordId);
    assert.equal(inspectDurableTaskExecution(store, handle.child_run_id).status, "started");
    // A started child without terminal evidence is never re-executed or discarded live.
    assert.throws(
        () =>
            discardChildRun(store, {
                commandId: "discard:crashed",
                handle,
                reason: "worker died",
                supervisorId: LEAD,
            }),
        (error: unknown) => error instanceof DelegationStatusError && error.status === "running",
    );
    let invoked = 0;
    await assert.rejects(
        runChildRun(store, {
            handle,
            program: () => {
                invoked += 1;
                return "never";
            },
        }),
        (error: unknown) => error instanceof DelegationStatusError && error.status === "running",
    );
    // Durable recovery of the exact retained execution (the program provider descriptor the
    // creation record retains) fails closed: provider invocation may already have occurred.
    const [creation] = store.readOwner(handle.child_run_id);
    const retainedProvider = (
        (creation as OwnerRecord).body.payload as { readonly provider: ProviderDescriptor }
    ).provider;
    await assert.rejects(
        recoverTaskDurably(store, {
            commandId: "recover:crashed",
            execution: {
                budget: handle.budget.effective,
                input: "hello",
                provider: {
                    descriptor: () => retainedProvider,
                    invoke: () => {
                        invoked += 1;
                        throw new Error("must not run");
                    },
                },
                runId: handle.child_run_id,
                task: echoTask,
            },
        }),
        DurableExecutionRecoveryError,
    );
    assert.equal(invoked, 0);
    assert.equal(store.readOwner(handle.handle_id).length, 1);

    // The documented durable control path: a cancellation request bound to the exact running
    // head, acknowledged with the dead worker's retained claim authority.
    const command = requestDurableTaskCancellation(store, {
        commandId: "cancel:crashed",
        expectedLifecycleRecordId: startedRecordId,
        fencingToken: Number(fencingToken),
        reason: "worker process died",
        runId: handle.child_run_id,
    });
    const cancelled = acknowledgeDurableTaskCancellation(store, {
        cancelCommandRecordId: command.record_id,
        claimId,
        expectedLifecycleRecordId: startedRecordId,
        fencingToken: Number(fencingToken),
        runId: handle.child_run_id,
    });
    assert.equal(cancelled.execution.outcome.outcome.status, "cancelled");
    assert.equal(inspectChildRun(store, handle.handle_id).status, "settling");
    const settled = await runChildRun(store, {
        handle,
        program: () => {
            invoked += 1;
            return "never";
        },
    });
    assert.equal(invoked, 0);
    assert.equal(settled.inspection.completion?.status, "cancelled");
    assert.equal(settled.inspection.completion?.execution_kind, "program");
    const discarded = discardChildRun(store, {
        commandId: "discard:crashed",
        handle,
        reason: "worker died",
        supervisorId: LEAD,
    });
    assert.equal(discarded.inspection.status, "discarded");
    const successor = retryChildRun(store, {
        commandId: "delegate:before-terminal:retry",
        handle,
        supervisorId: LEAD,
    });
    assert.equal(successor.inspection.predecessor?.decision_record_id, discarded.record_id);
    const retried = await runChildRun(store, {
        handle: successor.handle,
        program: ({ input }) => `${String(input)} again`,
    });
    assert.equal(retried.inspection.completion?.status, "finished");
    acceptChildRunResult(store, {
        commandId: "accept:retry",
        handle: successor.handle,
        supervisorId: LEAD,
    });
    assert.equal(
        projectChildRunResult(store, successor.handle.handle_id, { schema: schema.string() }).value,
        "hello again",
    );
    assert.equal(projectChildRunResult(store, handle.handle_id).value, null);
    assert.equal(store.verifyIntegrity().ok, true);
});

test("a child killed after its terminal but before the completion settles without re-execution", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "crash-before-completion");
    new SQLiteTraceStore(databasePath).close();
    const { child } = await runUntil(context, ["before-completion", databasePath], "terminal");
    await kill(child);
    using store = new SQLiteTraceStore(databasePath);
    const { handle } = openChildRun(store, openOptions("delegate:before-completion"));
    const crashed = inspectChildRun(store, handle.handle_id);
    assert.equal(crashed.status, "settling");
    assert.equal(crashed.completion, null);
    assert.equal(crashed.child?.status, "committed");
    assert.equal(inspectDurableTaskExecution(store, handle.child_run_id).status, "committed");
    assert.equal(store.readOwner(handle.handle_id).length, 1);
    const childRecords = store.readOwner(handle.child_run_id).length;
    let invoked = 0;
    const settled = await runChildRun(store, {
        handle,
        program: () => {
            invoked += 1;
            return "never";
        },
    });
    assert.equal(invoked, 0);
    assert.equal(settled.inspection.status, "settling");
    assert.equal(settled.inspection.completion?.status, "finished");
    assert.equal(settled.inspection.completion?.execution_kind, "program");
    assert.equal(settled.inspection.completion?.child_cut_id, crashed.child?.cut?.cut_id);
    assert.equal(
        settled.inspection.completion?.child_terminal_record_id,
        crashed.child?.lifecycle.terminal_record_id,
    );
    assert.equal(store.readOwner(handle.handle_id).length, 2);
    assert.equal(store.readOwner(handle.child_run_id).length, childRecords);
    const accepted = acceptChildRunResult(store, {
        commandId: "accept:crashed-terminal",
        handle,
        supervisorId: LEAD,
    });
    assert.equal(accepted.inspection.status, "accepted");
    assert.equal(
        projectChildRunResult(store, handle.handle_id, { schema: schema.string() }).value,
        "terminal before completion",
    );
    assert.equal(store.verifyIntegrity().ok, true);
});

async function runUntil(
    context: TestContext,
    args: readonly string[],
    prefix: string,
): Promise<{ readonly child: ChildProcess; readonly line: string }> {
    const child = spawn(process.execPath, [FIXTURE, ...args], {
        stdio: ["ignore", "pipe", "pipe"],
    });
    context.after(() => {
        if (child.exitCode === null && child.signalCode === null) {
            child.kill("SIGKILL");
        }
    });
    let output = "";
    let errors = "";
    child.stderr?.on("data", (chunk: Buffer) => {
        errors += chunk.toString();
    });
    for (;;) {
        const line = output.split("\n").find((candidate) => candidate.startsWith(prefix));
        if (line !== undefined) {
            return { child, line };
        }
        const [chunk] = (await Promise.race([
            once(child.stdout as NonNullable<typeof child.stdout>, "data"),
            once(child, "exit").then(() => {
                throw new Error(`fixture exited before ${prefix}: ${errors}`);
            }),
        ])) as [Buffer];
        output += chunk.toString();
    }
}

async function kill(child: ChildProcess): Promise<void> {
    const exit = once(child, "exit");
    assert.equal(child.kill("SIGKILL"), true);
    const [, signal] = (await exit) as [number | null, NodeJS.Signals | null];
    assert.equal(signal, "SIGKILL");
}
