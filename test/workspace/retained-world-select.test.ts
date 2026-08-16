import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
    type Cut,
    type CutSpec,
    captureTaskWorldDurably,
    createReferenceCopyCarrier,
    createRetainedWorldRunner,
    createStaticProvider,
    createWorkspaceBindings,
    executeTask,
    initializeWorkspace,
    inspectDurableTaskExecution,
    prepareRetainedWorldSettlement,
    RETAINED_WORLD_SETTLEMENT_VERSION,
    RetainedWorldSettlementConflictError,
    RetainedWorldSettlementInvalidError,
    SQLiteTraceStore,
    schema,
    selectRetainedWorldSettlement,
    TraceStoreError,
    task,
} from "../../src/index.ts";

class InterruptedSelectedTerminalStore extends SQLiteTraceStore {
    override retainRetainedWorldSettlementTerminal(): never {
        throw new Error("interrupted after carrier publication");
    }
}

class MissingSettlementJournalStore extends SQLiteTraceStore {
    override readRetainedWorldSettlementJournal(): undefined {
        return undefined;
    }
}

class BasisMovedAfterBeginStore extends SQLiteTraceStore {
    readonly #path: string;

    constructor(databasePath: string, userPath: string) {
        super(databasePath);
        this.#path = userPath;
    }

    override beginRetainedWorldSettlement(outputId: string) {
        const journal = super.beginRetainedWorldSettlement(outputId);
        writeFileSync(this.#path, "moved-after-first-check\n");
        return journal;
    }
}

class InterruptedSettlementCitationStore extends SQLiteTraceStore {
    interruptCitation = false;

    override publishCut(spec: CutSpec): Cut {
        if (this.interruptCitation) {
            throw new Error("interrupted before settlement citation cut publication");
        }
        return super.publishCut(spec);
    }
}

test("public select publishes one exact retained world and replays after reopen", async (context) => {
    const fixture = await createFixture(
        context,
        "success",
        (databasePath) => new SQLiteTraceStore(databasePath),
    );

    const selected = await selectRetainedWorldSettlement({
        binding: fixture.binding,
        carrier: fixture.carrier,
        outputId: fixture.captured.output.output_id,
        store: fixture.store,
    });
    assert.equal(selected.action, "select");
    assert.equal(selected.output_id, fixture.captured.output.output_id);
    assert.equal(selected.settlement_version, RETAINED_WORLD_SETTLEMENT_VERSION);
    assert.equal(selected.state, "selected");
    assert.equal(selected.user_basis_after.length > 0, true);
    assert.equal(selected.publication_id.length > 0, true);
    assert.equal(Object.isFrozen(selected), true);
    const terminal = fixture.store.readRetainedWorldSettlementJournal(
        fixture.captured.output.output_id,
    );
    assert.ok(terminal?.receipt);
    assert.equal(JSON.parse(terminal.receipt.json).publication_id, selected.publication_id);
    const settlement = inspectDurableTaskExecution(fixture.store, fixture.captured.output.run_id)
        .settlements[0];
    assert.ok(settlement);
    assert.equal(settlement.action, "select");
    assert.equal(settlement.command_id, terminal.admission.request.command_id);
    assert.equal(settlement.output_id, fixture.captured.output.output_id);
    assert.deepEqual(settlement.operation, {
        digest: terminal.operation?.digest,
        id: terminal.operation?.id,
        json: terminal.operation?.json,
    });
    assert.deepEqual(settlement.receipt, {
        digest: terminal.receipt.digest,
        json: terminal.receipt.json,
    });
    assert.deepEqual(settlement.trace, {
        capture_record_id: fixture.captured.output.capture_record_id,
        execution_cut_id: fixture.captured.output.execution_cut.cut_id,
        outcome_record_id: fixture.captured.output.execution_outcome_record_id,
        terminal_record_id: fixture.captured.output.execution_cut.through_record_id,
    });
    assert.equal(settlement.citation_cut.target_owner_id, fixture.captured.output.run_id);
    assert.equal(settlement.citation_cut.through_record_id, settlement.citation_record_id);
    assert.equal(Object.isFrozen(settlement), true);
    const retainedCitation = fixture.store.readRecord(settlement.citation_record_id);
    assert.ok(retainedCitation);
    fixture.store.append({
        append_intent_id: "test:duplicate-settlement-citation-view",
        batch: {
            groups: [
                {
                    owner_id: fixture.captured.output.run_id,
                    records: [
                        {
                            body: retainedCitation.body,
                            caused_by_record_ids: retainedCitation.envelope.caused_by_record_ids,
                            mode: retainedCitation.envelope.mode,
                            schema_ref: retainedCitation.envelope.schema_ref,
                            witness_ref: retainedCitation.envelope.witness_ref,
                        },
                    ],
                },
            ],
        },
    });
    assert.equal(
        inspectDurableTaskExecution(fixture.store, fixture.captured.output.run_id).settlements
            .length,
        1,
    );
    using imported = new SQLiteTraceStore();
    imported.importTrace(fixture.store.exportTrace());
    assert.deepEqual(
        inspectDurableTaskExecution(imported, fixture.captured.output.run_id).settlements,
        [settlement],
    );
    const citationRecord = imported.readRecord(settlement.citation_record_id);
    assert.ok(citationRecord);
    imported.append({
        append_intent_id: "test:malformed-settlement-citation",
        batch: {
            groups: [
                {
                    owner_id: fixture.captured.output.run_id,
                    records: [
                        {
                            body: { ...citationRecord.body, operation_json: "null" },
                            caused_by_record_ids: citationRecord.envelope.caused_by_record_ids,
                            mode: citationRecord.envelope.mode,
                            schema_ref: citationRecord.envelope.schema_ref,
                            witness_ref: citationRecord.envelope.witness_ref,
                        },
                    ],
                },
            ],
        },
    });
    assert.throws(
        () => inspectDurableTaskExecution(imported, fixture.captured.output.run_id),
        TraceStoreError,
    );
    assert.equal(await readFile(fixture.messagePath, "utf8"), "selected\n");
    assert.equal(await readFile(path.join(fixture.sourceRoot, "added.txt"), "utf8"), "added\n");
    assert.equal(
        await readFile(path.join(fixture.sourceRoot, "unmanaged.txt"), "utf8"),
        "preserve\n",
    );
    fixture.store.close();

    using reopened = new SQLiteTraceStore(fixture.databasePath);
    const reopenedCarrier = createReferenceCopyCarrier({ workspaceRoot: fixture.workspaceRoot });
    assert.deepEqual(
        await selectRetainedWorldSettlement({
            binding: fixture.binding,
            carrier: reopenedCarrier,
            outputId: fixture.captured.output.output_id,
            store: reopened,
        }),
        selected,
    );
    using missingJournal = new MissingSettlementJournalStore(fixture.databasePath);
    await assert.rejects(
        selectRetainedWorldSettlement({
            binding: fixture.binding,
            carrier: reopenedCarrier,
            outputId: fixture.captured.output.output_id,
            store: missingJournal,
        }),
        RetainedWorldSettlementInvalidError,
    );
    await mkdir(path.join(fixture.workspaceRoot, "other"));
    const otherBinding = createWorkspaceBindings({
        bindings: [{ name: "other", root: "other" }],
        workspaceRoot: fixture.workspaceRoot,
    }).bindings[0];
    assert.ok(otherBinding);
    await assert.rejects(
        selectRetainedWorldSettlement({
            binding: otherBinding,
            carrier: reopenedCarrier,
            outputId: fixture.captured.output.output_id,
            store: reopened,
        }),
        RetainedWorldSettlementInvalidError,
    );
    await writeFile(fixture.messagePath, "later-user-change\n");
    await assert.rejects(
        selectRetainedWorldSettlement({
            binding: fixture.binding,
            carrier: reopenedCarrier,
            outputId: fixture.captured.output.output_id,
            store: reopened,
        }),
        RetainedWorldSettlementInvalidError,
    );
    await assert.rejects(
        selectRetainedWorldSettlement({
            binding: fixture.binding,
            carrier: reopenedCarrier,
            outputId: "world-output:absent",
            store: reopened,
        }),
        RetainedWorldSettlementInvalidError,
    );
    assert.equal(await readFile(fixture.messagePath, "utf8"), "later-user-change\n");

    for (const invalid of [null, [], new (class SelectOptions {})()]) {
        await assert.rejects(
            selectRetainedWorldSettlement(invalid as never),
            RetainedWorldSettlementInvalidError,
        );
    }
    await assert.rejects(
        selectRetainedWorldSettlement({
            binding: fixture.binding,
            carrier: reopenedCarrier,
            outputId: "",
            store: reopened,
        }),
        RetainedWorldSettlementInvalidError,
    );
    await assert.rejects(
        selectRetainedWorldSettlement({
            binding: fixture.binding,
            carrier: { ...reopenedCarrier },
            outputId: fixture.captured.output.output_id,
            store: reopened,
        }),
        RetainedWorldSettlementInvalidError,
    );
});

test("selection custody faults never invent a terminal settlement receipt", async (context) => {
    const beforeWrite = await createFixture(
        context,
        "fault-before-write",
        (databasePath) => new SQLiteTraceStore(databasePath),
    );
    const beforeWriteCarrier = createReferenceCopyCarrier({
        faultInjection: {
            classification: "permission",
            phase: "selection-before-write",
            systemCode: "EACCES",
        },
        workspaceRoot: beforeWrite.workspaceRoot,
    });
    await assert.rejects(
        selectRetainedWorldSettlement({
            binding: beforeWrite.binding,
            carrier: beforeWriteCarrier,
            outputId: beforeWrite.captured.output.output_id,
            store: beforeWrite.store,
        }),
        RetainedWorldSettlementInvalidError,
    );
    const applyingBeforeWrite = beforeWrite.store.readRetainedWorldSettlementJournal(
        beforeWrite.captured.output.output_id,
    );
    assert.equal(applyingBeforeWrite?.state, "applying");
    assert.equal(applyingBeforeWrite?.receipt, null);
    assert.equal(await readFile(beforeWrite.messagePath, "utf8"), "before\n");
    const recoveredBeforeWrite = await selectRetainedWorldSettlement({
        binding: beforeWrite.binding,
        carrier: beforeWrite.carrier,
        outputId: beforeWrite.captured.output.output_id,
        store: beforeWrite.store,
    });
    assert.equal(recoveredBeforeWrite.state, "selected");

    const afterWrite = await createFixture(
        context,
        "fault-after-write",
        (databasePath) => new SQLiteTraceStore(databasePath),
    );
    const afterWriteCarrier = createReferenceCopyCarrier({
        faultInjection: {
            classification: "capacity",
            phase: "selection-after-write",
            systemCode: "ENOSPC",
        },
        workspaceRoot: afterWrite.workspaceRoot,
    });
    await assert.rejects(
        selectRetainedWorldSettlement({
            binding: afterWrite.binding,
            carrier: afterWriteCarrier,
            outputId: afterWrite.captured.output.output_id,
            store: afterWrite.store,
        }),
        RetainedWorldSettlementInvalidError,
    );
    const applyingAfterWrite = afterWrite.store.readRetainedWorldSettlementJournal(
        afterWrite.captured.output.output_id,
    );
    assert.equal(applyingAfterWrite?.state, "applying");
    assert.equal(applyingAfterWrite?.receipt, null);
    assert.equal(await readFile(afterWrite.messagePath, "utf8"), "selected\n");
    const recoveredAfterWrite = await selectRetainedWorldSettlement({
        binding: afterWrite.binding,
        carrier: afterWrite.carrier,
        outputId: afterWrite.captured.output.output_id,
        store: afterWrite.store,
    });
    assert.equal(recoveredAfterWrite.state, "selected");

    const postPublication = await createFixture(
        context,
        "fault-post-publication",
        (databasePath) => new SQLiteTraceStore(databasePath),
    );
    const postPublicationCarrier = createReferenceCopyCarrier({
        faultInjection: {
            classification: "interrupted",
            phase: "selection-post-publication",
            systemCode: "EINTR",
        },
        workspaceRoot: postPublication.workspaceRoot,
    });
    await assert.rejects(
        selectRetainedWorldSettlement({
            binding: postPublication.binding,
            carrier: postPublicationCarrier,
            outputId: postPublication.captured.output.output_id,
            store: postPublication.store,
        }),
        RetainedWorldSettlementInvalidError,
    );
    const applyingPostPublication = postPublication.store.readRetainedWorldSettlementJournal(
        postPublication.captured.output.output_id,
    );
    assert.equal(applyingPostPublication?.state, "applying");
    assert.equal(applyingPostPublication?.receipt, null);
    assert.equal(await readFile(postPublication.messagePath, "utf8"), "selected\n");
    const recoveredPostPublication = await selectRetainedWorldSettlement({
        binding: postPublication.binding,
        carrier: postPublication.carrier,
        outputId: postPublication.captured.output.output_id,
        store: postPublication.store,
    });
    assert.equal(recoveredPostPublication.state, "selected");
});

test("public select refuses movement at both pre-write basis checks", async (context) => {
    const first = await createFixture(
        context,
        "moved-before",
        (databasePath) => new SQLiteTraceStore(databasePath),
    );
    await writeFile(first.messagePath, "moved-before-select\n");
    await assert.rejects(
        selectRetainedWorldSettlement({
            binding: first.binding,
            carrier: first.carrier,
            outputId: first.captured.output.output_id,
            store: first.store,
        }),
        RetainedWorldSettlementInvalidError,
    );
    assert.equal(
        first.store.readRetainedWorldSettlementJournal(first.captured.output.output_id)?.state,
        "prepared",
    );
    assert.equal(await readFile(first.messagePath, "utf8"), "moved-before-select\n");

    const second = await createFixture(
        context,
        "moved-between",
        (databasePath, userPath) => new BasisMovedAfterBeginStore(databasePath, userPath),
    );
    await assert.rejects(
        selectRetainedWorldSettlement({
            binding: second.binding,
            carrier: second.carrier,
            outputId: second.captured.output.output_id,
            store: second.store,
        }),
        RetainedWorldSettlementInvalidError,
    );
    assert.equal(
        second.store.readRetainedWorldSettlementJournal(second.captured.output.output_id)?.state,
        "applying",
    );
    assert.equal(await readFile(second.messagePath, "utf8"), "moved-after-first-check\n");
});

test("public select repairs carrier publication left before store terminal retention", async (context) => {
    const fixture = await createFixture(
        context,
        "terminal-repair",
        (databasePath) => new InterruptedSelectedTerminalStore(databasePath),
    );
    await assert.rejects(
        selectRetainedWorldSettlement({
            binding: fixture.binding,
            carrier: fixture.carrier,
            outputId: fixture.captured.output.output_id,
            store: fixture.store,
        }),
        RetainedWorldSettlementInvalidError,
    );
    assert.equal(
        fixture.store.readRetainedWorldSettlementJournal(fixture.captured.output.output_id)?.state,
        "applying",
    );
    assert.equal(await readFile(fixture.messagePath, "utf8"), "selected\n");
    fixture.store.close();

    using reopened = new SQLiteTraceStore(fixture.databasePath);
    const selected = await selectRetainedWorldSettlement({
        binding: fixture.binding,
        carrier: createReferenceCopyCarrier({ workspaceRoot: fixture.workspaceRoot }),
        outputId: fixture.captured.output.output_id,
        store: reopened,
    });
    assert.equal(selected.state, "selected");
    assert.equal(
        reopened.readRetainedWorldSettlementJournal(fixture.captured.output.output_id)?.state,
        "selected",
    );
    assert.equal(await readFile(fixture.messagePath, "utf8"), "selected\n");

    const discarded = await createFixture(
        context,
        "wrong-action",
        (databasePath) => new SQLiteTraceStore(databasePath),
        "discard",
    );
    await assert.rejects(
        selectRetainedWorldSettlement({
            binding: discarded.binding,
            carrier: discarded.carrier,
            outputId: discarded.captured.output.output_id,
            store: discarded.store,
        }),
        RetainedWorldSettlementConflictError,
    );
});

test("public select repairs interrupted settlement citation publication", async (context) => {
    const fixture = await createFixture(
        context,
        "citation-repair",
        (databasePath) => new InterruptedSettlementCitationStore(databasePath),
    );
    fixture.store.interruptCitation = true;
    await assert.rejects(
        selectRetainedWorldSettlement({
            binding: fixture.binding,
            carrier: fixture.carrier,
            outputId: fixture.captured.output.output_id,
            store: fixture.store,
        }),
        RetainedWorldSettlementInvalidError,
    );
    assert.equal(
        fixture.store.readRetainedWorldSettlementJournal(fixture.captured.output.output_id)?.state,
        "selected",
    );
    assert.throws(
        () => inspectDurableTaskExecution(fixture.store, fixture.captured.output.run_id),
        TraceStoreError,
    );
    assert.equal(await readFile(fixture.messagePath, "utf8"), "selected\n");
    fixture.store.close();

    using reopened = new SQLiteTraceStore(fixture.databasePath);
    const selected = await selectRetainedWorldSettlement({
        binding: fixture.binding,
        carrier: createReferenceCopyCarrier({ workspaceRoot: fixture.workspaceRoot }),
        outputId: fixture.captured.output.output_id,
        store: reopened,
    });
    assert.equal(selected.state, "selected");
    assert.equal(
        inspectDurableTaskExecution(reopened, fixture.captured.output.run_id).settlements.length,
        1,
    );
    assert.equal(await readFile(fixture.messagePath, "utf8"), "selected\n");
});

type StoreFactory<T extends SQLiteTraceStore> = (databasePath: string, userPath: string) => T;

async function createFixture<T extends SQLiteTraceStore>(
    context: { after: (callback: () => Promise<void>) => void },
    suffix: string,
    createStore: StoreFactory<T>,
    action: "select" | "discard" = "select",
) {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), `shepherd-world-select-${suffix}-`));
    context.after(() => rm(workspaceRoot, { force: true, recursive: true }));
    initializeWorkspace({ adopt: "none", initializeGit: false, rootPath: workspaceRoot });
    const sourceRoot = path.join(workspaceRoot, "source");
    await mkdir(sourceRoot);
    const messagePath = path.join(sourceRoot, "message.txt");
    await writeFile(messagePath, "before\n");
    await writeFile(path.join(sourceRoot, "added.txt"), "before-added\n");
    await writeFile(path.join(sourceRoot, "unmanaged.txt"), "preserve\n");
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
        name: `select-world-${suffix}`,
        output: schema.string(),
        version: "1.0.0",
    });
    const runner = createRetainedWorldRunner({
        enforcement: "advisory",
        runnerId: `runner:select-world:${suffix}`,
        run: async (runnerContext) => {
            await runnerContext.world.writeText("message.txt", "selected\n");
            await runnerContext.world.writeText("added.txt", "added\n");
            return executeTask(runnerContext.execution);
        },
    });
    const provider = createStaticProvider({
        descriptor: { id: `select-provider-${suffix}`, model: "offline-v1" },
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
    const store = createStore(databasePath, messagePath);
    const captured = await captureTaskWorldDurably({
        baseRevision,
        binding,
        captureId: `capture:select-world:${suffix}`,
        carrier,
        execution: {
            budget: { maxTurns: 1 },
            input: undefined,
            provider,
            runId: `run:select-world:${suffix}`,
            task: fixtureTask,
        },
        runner,
        store,
    });
    await prepareRetainedWorldSettlement({
        action,
        binding,
        carrier,
        commandId: `settlement:select-world:${suffix}`,
        output: captured.output,
        store,
    });
    return {
        binding,
        captured,
        carrier,
        databasePath,
        messagePath,
        sourceRoot,
        store,
        workspaceRoot,
    };
}
