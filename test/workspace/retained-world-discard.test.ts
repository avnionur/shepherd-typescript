import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
    captureTaskWorldDurably,
    createReferenceCopyCarrier,
    createRetainedWorldRunner,
    createStaticProvider,
    createWorkspaceBindings,
    discardRetainedWorldSettlement,
    executeTask,
    initializeWorkspace,
    prepareRetainedWorldSettlement,
    RETAINED_WORLD_SETTLEMENT_VERSION,
    RetainedWorldSettlementConflictError,
    RetainedWorldSettlementInvalidError,
    SQLiteTraceStore,
    schema,
    task,
    WorldCarrierError,
} from "../../src/index.ts";

class InterruptedSettlementCleanupStore extends SQLiteTraceStore {
    override completeRetainedWorldSettlementCleanup(): never {
        throw new Error("interrupted after physical discard");
    }
}

class MissingSettlementJournalStore extends SQLiteTraceStore {
    override readRetainedWorldSettlementJournal(): undefined {
        return undefined;
    }
}

test("public discard commits terminal authority before cleanup and recovers after reopen", async (context) => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "shepherd-world-discard-"));
    context.after(() => rm(workspaceRoot, { force: true, recursive: true }));
    initializeWorkspace({ adopt: "none", initializeGit: false, rootPath: workspaceRoot });
    const sourceRoot = path.join(workspaceRoot, "source");
    await mkdir(sourceRoot);
    await writeFile(path.join(sourceRoot, "message.txt"), "before\n");
    const binding = createWorkspaceBindings({
        bindings: [{ name: "source", root: "source" }],
        workspaceRoot,
    }).bindings[0];
    assert.ok(binding);
    const carrier = createReferenceCopyCarrier({ workspaceRoot });
    const baseRevision = await carrier.snapshot(binding);
    const fixtureTask = task({
        input: schema.void(),
        instruction: "Return complete.",
        name: "discard-world",
        output: schema.string(),
        version: "1.0.0",
    });
    const runner = createRetainedWorldRunner({
        enforcement: "advisory",
        runnerId: "runner:discard-world",
        run: async (runnerContext) => {
            await runnerContext.world.writeText("message.txt", "retained\n");
            return executeTask(runnerContext.execution);
        },
    });
    const providerFor = (id: string) =>
        createStaticProvider({
            descriptor: { id, model: "offline-v1" },
            exchanges: [
                {
                    request: {
                        input: null,
                        instruction: fixtureTask.instruction,
                        outputSchema: fixtureTask.artifact.output_schema,
                    },
                    response: {
                        output: "complete",
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
    const databasePath = path.join(workspaceRoot, "trace.sqlite");
    const interruptedStore = new InterruptedSettlementCleanupStore(databasePath);
    const captured = await captureTaskWorldDurably({
        baseRevision,
        binding,
        captureId: "capture:discard-world",
        carrier,
        execution: {
            budget: { maxTurns: 1 },
            input: undefined,
            provider: providerFor("discard-provider"),
            runId: "run:discard-world",
            task: fixtureTask,
        },
        runner,
        store: interruptedStore,
    });
    await prepareRetainedWorldSettlement({
        action: "discard",
        binding,
        carrier,
        commandId: "settlement:discard-world",
        output: captured.output,
        store: interruptedStore,
    });
    await assert.rejects(
        discardRetainedWorldSettlement({
            carrier,
            outputId: captured.output.output_id,
            store: interruptedStore,
        }),
        RetainedWorldSettlementInvalidError,
    );
    using missingJournalStore = new MissingSettlementJournalStore(databasePath);
    await assert.rejects(
        discardRetainedWorldSettlement({
            carrier,
            outputId: captured.output.output_id,
            store: missingJournalStore,
        }),
        RetainedWorldSettlementInvalidError,
    );
    const pending = interruptedStore.readRetainedWorldSettlementJournal(captured.output.output_id);
    assert.ok(pending);
    assert.equal(pending.state, "discarded");
    assert.equal(pending.cleanup_completed, false);
    assert.ok(pending.operation);
    assert.ok(pending.receipt);
    await assert.rejects(carrier.openCustody(captured.output.custody_id), WorldCarrierError);
    interruptedStore.close();

    using reopened = new SQLiteTraceStore(databasePath);
    const discarded = await discardRetainedWorldSettlement({
        carrier,
        outputId: captured.output.output_id,
        store: reopened,
    });
    assert.equal(discarded.action, "discard");
    assert.equal(discarded.cleanup_completed, true);
    assert.equal(discarded.output_id, captured.output.output_id);
    assert.equal(discarded.settlement_version, RETAINED_WORLD_SETTLEMENT_VERSION);
    assert.equal(discarded.state, "discarded");
    assert.equal(Object.isFrozen(discarded), true);
    assert.deepEqual(
        await discardRetainedWorldSettlement({
            carrier,
            outputId: captured.output.output_id,
            store: reopened,
        }),
        discarded,
    );
    assert.equal(
        reopened.readRetainedWorldSettlementJournal(captured.output.output_id)?.cleanup_completed,
        true,
    );
    await carrier.openRevision(captured.output.base_revision_id);
    await carrier.openRevision(captured.output.head_revision_id);
    assert.equal(await readFile(path.join(sourceRoot, "message.txt"), "utf8"), "before\n");

    for (const invalid of [null, [], new (class DiscardOptions {})()]) {
        await assert.rejects(
            discardRetainedWorldSettlement(invalid as never),
            RetainedWorldSettlementInvalidError,
        );
    }
    await assert.rejects(
        discardRetainedWorldSettlement({
            carrier,
            outputId: "",
            store: reopened,
        }),
        RetainedWorldSettlementInvalidError,
    );
    await assert.rejects(
        discardRetainedWorldSettlement({
            carrier,
            outputId: "world-output:absent",
            store: reopened,
        }),
        RetainedWorldSettlementInvalidError,
    );
    await assert.rejects(
        discardRetainedWorldSettlement({
            carrier: { ...carrier },
            outputId: captured.output.output_id,
            store: reopened,
        }),
        RetainedWorldSettlementInvalidError,
    );

    const selected = await captureTaskWorldDurably({
        baseRevision,
        binding,
        captureId: "capture:selected-world",
        carrier,
        execution: {
            budget: { maxTurns: 1 },
            input: undefined,
            provider: providerFor("selected-provider"),
            runId: "run:selected-world",
            task: fixtureTask,
        },
        runner,
        store: reopened,
    });
    await prepareRetainedWorldSettlement({
        action: "select",
        binding,
        carrier,
        commandId: "settlement:selected-world",
        output: selected.output,
        store: reopened,
    });
    await assert.rejects(
        discardRetainedWorldSettlement({
            carrier,
            outputId: selected.output.output_id,
            store: reopened,
        }),
        RetainedWorldSettlementConflictError,
    );

    const applying = await captureTaskWorldDurably({
        baseRevision,
        binding,
        captureId: "capture:applying-discard",
        carrier,
        execution: {
            budget: { maxTurns: 1 },
            input: undefined,
            provider: providerFor("applying-discard-provider"),
            runId: "run:applying-discard",
            task: fixtureTask,
        },
        runner,
        store: reopened,
    });
    await prepareRetainedWorldSettlement({
        action: "discard",
        binding,
        carrier,
        commandId: "settlement:applying-discard",
        output: applying.output,
        store: reopened,
    });
    reopened.beginRetainedWorldSettlement(applying.output.output_id);
    using applyingReopened = new SQLiteTraceStore(databasePath);
    assert.equal(
        (
            await discardRetainedWorldSettlement({
                carrier,
                outputId: applying.output.output_id,
                store: applyingReopened,
            })
        ).cleanup_completed,
        true,
    );

    const unsafeCleanup = await captureTaskWorldDurably({
        baseRevision,
        binding,
        captureId: "capture:unsafe-discard",
        carrier,
        execution: {
            budget: { maxTurns: 1 },
            input: undefined,
            provider: providerFor("unsafe-discard-provider"),
            runId: "run:unsafe-discard",
            task: fixtureTask,
        },
        runner,
        store: reopened,
    });
    await prepareRetainedWorldSettlement({
        action: "discard",
        binding,
        carrier,
        commandId: "settlement:unsafe-discard",
        output: unsafeCleanup.output,
        store: reopened,
    });
    reopened.beginRetainedWorldSettlement(unsafeCleanup.output.output_id);
    reopened.retainRetainedWorldSettlementTerminal(unsafeCleanup.output.output_id, {
        action: "discard",
        cleanup_completed: false,
        user_basis_after: unsafeCleanup.output.user_basis_before,
    });
    const unsafeCustody = await carrier.openCustody(unsafeCleanup.output.custody_id);
    await rm(unsafeCustody.path, { force: true, recursive: true });
    await writeFile(unsafeCustody.path, "unsafe custody replacement");
    await assert.rejects(
        discardRetainedWorldSettlement({
            carrier,
            outputId: unsafeCleanup.output.output_id,
            store: reopened,
        }),
        RetainedWorldSettlementInvalidError,
    );
    const unsafeJournal = reopened.readRetainedWorldSettlementJournal(
        unsafeCleanup.output.output_id,
    );
    assert.ok(unsafeJournal);
    assert.equal(unsafeJournal.state, "discarded");
    assert.equal(unsafeJournal.cleanup_completed, false);
});
