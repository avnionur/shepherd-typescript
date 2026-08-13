import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
    captureTaskWorldDurably,
    createReferenceCopyCarrier,
    createRetainedWorldRunner,
    createRunArtifact,
    createRunOutcome,
    createStaticProvider,
    createWorkspaceBindings,
    executeTask,
    initializeWorkspace,
    type OwnerRecord,
    RETAINED_WORLD_MAX_CAPTURE_ID_BYTES,
    RETAINED_WORLD_MAX_TEXT_BYTES,
    type RetainedWorldCapability,
    readDurableTaskExecution,
    SQLiteTraceStore,
    schema,
    task,
} from "../../src/index.ts";

class RetainedWorldEvidenceStore extends SQLiteTraceStore {
    readonly #records: readonly OwnerRecord[];

    constructor(records: readonly OwnerRecord[]) {
        super();
        this.#records = records;
    }

    override readOwner(_ownerId: string): readonly OwnerRecord[] {
        return this.#records;
    }
}

class LostCaptureFenceStore extends SQLiteTraceStore {
    override hasDurableExecutionInvocationAuthority(): boolean {
        return false;
    }
}

test("captureTaskWorldDurably retains isolated runner changes inside the terminal cut", async (context) => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "shepherd-task-world-"));
    context.after(() => rm(workspaceRoot, { force: true, recursive: true }));
    initializeWorkspace({ adopt: "none", initializeGit: false, rootPath: workspaceRoot });
    const sourceRoot = path.join(workspaceRoot, "source");
    await mkdir(sourceRoot);
    await writeFile(path.join(sourceRoot, "message.txt"), "before\n");
    await mkdir(path.join(sourceRoot, "directory"));
    await writeFile(path.join(sourceRoot, "invalid-utf8.bin"), Uint8Array.of(0xff));
    const oversizedText = "x".repeat(RETAINED_WORLD_MAX_TEXT_BYTES + 1);
    await writeFile(path.join(sourceRoot, "oversized.txt"), oversizedText);
    await symlink("message.txt", path.join(sourceRoot, "message-link"));
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
        name: "captured-world",
        output: schema.string(),
        version: "1.0.0",
    });
    const provider = createStaticProvider({
        descriptor: { id: "captured-world-provider", model: "offline-v1" },
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
    for (const invalidOptions of [null, [], new (class CaptureOptions {})()]) {
        await assert.rejects(captureTaskWorldDurably(invalidOptions as never), TypeError);
    }
    const baseOptions = {
        baseRevision,
        binding,
        captureId: "capture:validation",
        carrier,
        execution: {
            budget: { maxTurns: 1 },
            input: undefined,
            provider,
            runId: "run:validation",
            task: fixtureTask,
        },
        runner: null as never,
        store: new SQLiteTraceStore(),
    };
    await assert.rejects(
        captureTaskWorldDurably({ ...baseOptions, extra: true } as never),
        TypeError,
    );
    const wrongKeyOptions = { ...baseOptions, another: true } as Record<string, unknown>;
    delete wrongKeyOptions.captureId;
    await assert.rejects(captureTaskWorldDurably(wrongKeyOptions as never), TypeError);
    const accessorOptions = { ...baseOptions };
    Object.defineProperty(accessorOptions, "captureId", { get: () => "capture:accessor" });
    await assert.rejects(captureTaskWorldDurably(accessorOptions), TypeError);
    baseOptions.store.close();
    const runner = createRetainedWorldRunner({
        enforcement: "advisory",
        runnerId: "runner:captured-world",
        run: async (runnerContext) => {
            leakedWorld = runnerContext.world;
            await assert.rejects(runnerContext.world.readText(1 as never), TypeError);
            await assert.rejects(runnerContext.world.readText(""), TypeError);
            await assert.rejects(runnerContext.world.readText("directory\\file"), TypeError);
            await assert.rejects(runnerContext.world.readText("directory//file"), TypeError);
            await assert.rejects(runnerContext.world.readText("./message.txt"), TypeError);
            await assert.rejects(runnerContext.world.readText("../message.txt"), TypeError);
            await assert.rejects(runnerContext.world.readText(".vcscore/secret"), TypeError);
            await assert.rejects(runnerContext.world.readText(sourceRoot), TypeError);
            await assert.rejects(runnerContext.world.readText("directory"), TypeError);
            await assert.rejects(runnerContext.world.readText("missing.txt"), TypeError);
            await assert.rejects(runnerContext.world.readText("message-link"), TypeError);
            await assert.rejects(runnerContext.world.readText("invalid-utf8.bin"), TypeError);
            await assert.rejects(runnerContext.world.readText("oversized.txt"), TypeError);
            await assert.rejects(runnerContext.world.writeText("message.txt", "\uD800"), TypeError);
            await assert.rejects(
                runnerContext.world.writeText("message.txt", 1 as never),
                TypeError,
            );
            await assert.rejects(
                runnerContext.world.writeText("message.txt", oversizedText),
                TypeError,
            );
            assert.equal(await runnerContext.world.readText("message.txt"), "before\n");
            await runnerContext.world.writeText("message.txt", "after\n");
            return executeTask(runnerContext.execution);
        },
    });
    for (const [index, captureId] of [
        "",
        "capture\0invalid",
        "\uD800",
        "x".repeat(RETAINED_WORLD_MAX_CAPTURE_ID_BYTES + 1),
    ].entries()) {
        using invalidCaptureIdStore = new SQLiteTraceStore();
        await assert.rejects(
            captureTaskWorldDurably({
                ...baseOptions,
                captureId,
                execution: { ...baseOptions.execution, runId: `run:invalid-capture-id:${index}` },
                runner,
                store: invalidCaptureIdStore,
            }),
            TypeError,
        );
    }
    using nonTextCaptureIdStore = new SQLiteTraceStore();
    await assert.rejects(
        captureTaskWorldDurably({
            ...baseOptions,
            captureId: 1 as never,
            execution: { ...baseOptions.execution, runId: "run:non-text-capture-id" },
            runner,
            store: nonTextCaptureIdStore,
        }),
        TypeError,
    );
    let leakedWorld: RetainedWorldCapability | null = null;
    using store = new SQLiteTraceStore();
    assert.throws(
        () => store.hasDurableExecutionInvocationAuthority("run:test", "claim:test", 0),
        TypeError,
    );

    const result = await captureTaskWorldDurably({
        baseRevision,
        binding,
        captureId: "capture:world:1",
        carrier,
        execution: {
            budget: { maxTurns: 1 },
            input: undefined,
            provider,
            runId: "run:captured-world:1",
            signal: new AbortController().signal,
            task: fixtureTask,
        },
        runner,
        store,
    });

    assert.equal(result.output.base_revision_id, baseRevision.revision_id);
    assert.equal(result.output.binding_id, binding.binding_id);
    assert.equal(result.output.capture_id, "capture:world:1");
    assert.equal(result.output.execution_cut.cut_id, result.ledger.cut.cut_id);
    assert.equal(result.output.execution_outcome_record_id, result.ledger.outcome_record_id);
    assert.equal(result.output.run_id, "run:captured-world:1");
    assert.equal(result.output.status, "retained");
    assert.equal(result.output.user_basis_before, result.output.user_basis_after);
    assert.equal(await readFile(path.join(sourceRoot, "message.txt"), "utf8"), "before\n");
    assert.equal(
        await readFile(
            path.join(
                (await carrier.openRevision(result.output.head_revision_id)).path,
                "message.txt",
            ),
            "utf8",
        ),
        "after\n",
    );
    assert.equal(result.changeset.changed_paths[0], "message.txt");
    assert.equal(result.execution.outcome.outcome.status, "finished");
    const staleWorld = leakedWorld as RetainedWorldCapability | null;
    assert.ok(staleWorld);
    await assert.rejects(staleWorld.readText("message.txt"), TypeError);
    await assert.rejects(staleWorld.writeText("message.txt", "stale\n"), TypeError);
    assert.equal(
        store.readCut(result.ledger.cut.cut_id).through_record_id,
        result.ledger.lifecycle_record_id,
    );
    assert.equal(
        store.readOwnerPrefix(
            result.ledger.cut.target_owner_id,
            result.ledger.cut.through_owner_ordinal,
        ).visible_records_by_id[result.output.capture_record_id] !== undefined,
        true,
    );
    assert.deepEqual(readDurableTaskExecution(store, "run:captured-world:1"), {
        result: { execution: result.execution, ledger: result.ledger },
        run_id: "run:captured-world:1",
        status: "committed",
    });
    const retainedRecords = store.readOwner("run:captured-world:1");
    const captureRecord = retainedRecords.find(
        (record) => record.envelope.record_id === result.output.capture_record_id,
    );
    assert.ok(captureRecord);
    const inconsistentBasis = retainedRecords.map((record) =>
        record.envelope.record_id === captureRecord.envelope.record_id
            ? {
                  ...record,
                  body: { ...record.body, user_basis_after: "world-content:sha256:corrupt" },
              }
            : record,
    );
    using inconsistentBasisStore = new RetainedWorldEvidenceStore(inconsistentBasis);
    assert.throws(
        () => readDurableTaskExecution(inconsistentBasisStore, "run:captured-world:1"),
        /malformed/u,
    );
    const inconsistentCause = retainedRecords.map((record) =>
        record.envelope.record_id === captureRecord.envelope.record_id
            ? {
                  ...record,
                  envelope: { ...record.envelope, caused_by_record_ids: [] },
              }
            : record,
    );
    using inconsistentCauseStore = new RetainedWorldEvidenceStore(inconsistentCause);
    assert.throws(
        () => readDurableTaskExecution(inconsistentCauseStore, "run:captured-world:1"),
        /malformed/u,
    );
    const inconsistentOutputIdentity = retainedRecords.map((record) =>
        record.envelope.record_id === captureRecord.envelope.record_id
            ? { ...record, body: { ...record.body, output_id: "world-output:sha256:corrupt" } }
            : record,
    );
    using inconsistentOutputStore = new RetainedWorldEvidenceStore(inconsistentOutputIdentity);
    assert.throws(
        () => readDurableTaskExecution(inconsistentOutputStore, "run:captured-world:1"),
        /malformed/u,
    );
    using duplicateCaptureStore = new RetainedWorldEvidenceStore([
        ...retainedRecords,
        captureRecord,
    ]);
    assert.throws(
        () => readDurableTaskExecution(duplicateCaptureStore, "run:captured-world:1"),
        /malformed/u,
    );

    const custodiesRoot = path.join(workspaceRoot, ".vcscore", "worlds", "custodies");
    const custodiesAfterSuccess = await readdir(custodiesRoot);
    await assert.rejects(
        captureTaskWorldDurably({
            baseRevision,
            binding,
            captureId: "capture:repeat-existing-run",
            carrier,
            execution: {
                budget: { maxTurns: 1 },
                input: undefined,
                provider,
                runId: "run:captured-world:1",
                task: fixtureTask,
            },
            runner,
            store,
        }),
    );
    assert.deepEqual(await readdir(custodiesRoot), custodiesAfterSuccess);

    using invalidInputStore = new SQLiteTraceStore();
    await assert.rejects(
        captureTaskWorldDurably({
            baseRevision,
            binding,
            captureId: "capture:invalid-input",
            carrier,
            execution: {
                budget: { maxTurns: 1 },
                input: "invalid" as never,
                provider,
                runId: "run:invalid-input",
                task: fixtureTask,
            },
            runner,
            store: invalidInputStore,
        }),
        TypeError,
    );
    assert.deepEqual(await readdir(custodiesRoot), custodiesAfterSuccess);
    assert.deepEqual(invalidInputStore.readOwner("run:invalid-input"), []);

    const noOperationRunner = createRetainedWorldRunner({
        enforcement: "advisory",
        runnerId: "runner:lost-capture-fence",
        run: (runnerContext) => executeTask(runnerContext.execution),
    });
    using lostCaptureFenceStore = new LostCaptureFenceStore();
    await assert.rejects(
        captureTaskWorldDurably({
            baseRevision,
            binding,
            captureId: "capture:lost-fence",
            carrier,
            execution: {
                budget: { maxTurns: 1 },
                input: undefined,
                provider,
                runId: "run:lost-fence",
                task: fixtureTask,
            },
            runner: noOperationRunner,
            store: lostCaptureFenceStore,
        }),
        TypeError,
    );

    await writeFile(path.join(sourceRoot, "message.txt"), "moved-before\n");
    using movedBeforeStore = new SQLiteTraceStore();
    await assert.rejects(
        captureTaskWorldDurably({
            baseRevision,
            binding,
            captureId: "capture:moved-before",
            carrier,
            execution: {
                budget: { maxTurns: 1 },
                input: undefined,
                provider,
                runId: "run:moved-before",
                task: fixtureTask,
            },
            runner,
            store: movedBeforeStore,
        }),
        TypeError,
    );
    assert.equal(readDurableTaskExecution(movedBeforeStore, "run:moved-before").status, "started");
    await writeFile(path.join(sourceRoot, "message.txt"), "before\n");

    const movingRunner = createRetainedWorldRunner({
        enforcement: "advisory",
        runnerId: "runner:moves-user-basis",
        run: async (runnerContext) => {
            await writeFile(path.join(sourceRoot, "message.txt"), "moved-during\n");
            return executeTask(runnerContext.execution);
        },
    });
    using movedDuringStore = new SQLiteTraceStore();
    await assert.rejects(
        captureTaskWorldDurably({
            baseRevision,
            binding,
            captureId: "capture:moved-during",
            carrier,
            execution: {
                budget: { maxTurns: 1 },
                input: undefined,
                provider,
                runId: "run:moved-during",
                task: fixtureTask,
            },
            runner: movingRunner,
            store: movedDuringStore,
        }),
        TypeError,
    );
    assert.equal(readDurableTaskExecution(movedDuringStore, "run:moved-during").status, "started");
    await writeFile(path.join(sourceRoot, "message.txt"), "before\n");

    using forgedStore = new SQLiteTraceStore();
    await assert.rejects(
        captureTaskWorldDurably({
            baseRevision,
            binding,
            captureId: "capture:forged",
            carrier,
            execution: {
                budget: { maxTurns: 1 },
                input: undefined,
                provider,
                runId: "run:forged-world",
                task: fixtureTask,
            },
            runner: { ...runner } as never,
            store: forgedStore,
        }),
        TypeError,
    );
    assert.deepEqual(forgedStore.readOwner("run:forged-world"), []);

    using forgedBindingStore = new SQLiteTraceStore();
    await assert.rejects(
        captureTaskWorldDurably({
            baseRevision,
            binding: { ...binding },
            captureId: "capture:forged-binding",
            carrier,
            execution: {
                budget: { maxTurns: 1 },
                input: undefined,
                provider,
                runId: "run:forged-binding",
                task: fixtureTask,
            },
            runner,
            store: forgedBindingStore,
        }),
        TypeError,
    );
    assert.deepEqual(forgedBindingStore.readOwner("run:forged-binding"), []);

    using forgedCarrierStore = new SQLiteTraceStore();
    await assert.rejects(
        captureTaskWorldDurably({
            baseRevision,
            binding,
            captureId: "capture:forged-carrier",
            carrier: { ...carrier } as never,
            execution: {
                budget: { maxTurns: 1 },
                input: undefined,
                provider,
                runId: "run:forged-carrier",
                task: fixtureTask,
            },
            runner,
            store: forgedCarrierStore,
        }),
        TypeError,
    );
    assert.deepEqual(forgedCarrierStore.readOwner("run:forged-carrier"), []);

    using forgedBaseStore = new SQLiteTraceStore();
    await assert.rejects(
        captureTaskWorldDurably({
            baseRevision: { ...baseRevision, content_id: "world-content:sha256:forged" },
            binding,
            captureId: "capture:forged-base",
            carrier,
            execution: {
                budget: { maxTurns: 1 },
                input: undefined,
                provider,
                runId: "run:forged-base",
                task: fixtureTask,
            },
            runner,
            store: forgedBaseStore,
        }),
        TypeError,
    );
    assert.deepEqual(forgedBaseStore.readOwner("run:forged-base"), []);

    const malformedRunner = createRetainedWorldRunner({
        enforcement: "advisory",
        runnerId: "runner:malformed-world",
        run: async () => ({ outcome: { run_id: "run:malformed-world" } }) as never,
    });
    using malformedRunnerStore = new SQLiteTraceStore();
    await assert.rejects(
        captureTaskWorldDurably({
            baseRevision,
            binding,
            captureId: "capture:malformed-runner",
            carrier,
            execution: {
                budget: { maxTurns: 1 },
                input: undefined,
                provider,
                runId: "run:malformed-world",
                task: fixtureTask,
            },
            runner: malformedRunner,
            store: malformedRunnerStore,
        }),
        TypeError,
    );
    assert.equal(
        readDurableTaskExecution(malformedRunnerStore, "run:malformed-world").status,
        "started",
    );

    const anotherTask = task({
        input: schema.void(),
        instruction: "Return complete.",
        name: "another-captured-world",
        output: schema.string(),
        version: "1.0.0",
    });
    const wrongTaskRunner = createRetainedWorldRunner({
        enforcement: "advisory",
        runnerId: "runner:wrong-task",
        run: async (runnerContext) => {
            const valid = await executeTask(runnerContext.execution);
            return Object.freeze({
                ...valid,
                outcome: createRunOutcome({
                    outcome: { status: "finished", value: "complete" },
                    runId: runnerContext.execution.runId,
                    taskArtifactLock: anotherTask.artifactLock,
                }),
            });
        },
    });
    using wrongTaskStore = new SQLiteTraceStore();
    await assert.rejects(
        captureTaskWorldDurably({
            baseRevision,
            binding,
            captureId: "capture:wrong-task",
            carrier,
            execution: {
                budget: { maxTurns: 1 },
                input: undefined,
                provider,
                runId: "run:wrong-task",
                task: fixtureTask,
            },
            runner: wrongTaskRunner,
            store: wrongTaskStore,
        }),
        TypeError,
    );

    const invalidOutputRunner = createRetainedWorldRunner({
        enforcement: "advisory",
        runnerId: "runner:invalid-output",
        run: async (runnerContext) => {
            const valid = await executeTask(runnerContext.execution);
            return Object.freeze({
                ...valid,
                outcome: createRunOutcome({
                    outcome: { status: "finished", value: 42 },
                    runId: runnerContext.execution.runId,
                    taskArtifactLock: runnerContext.execution.task.artifactLock,
                }),
            });
        },
    });
    using invalidOutputStore = new SQLiteTraceStore();
    await assert.rejects(
        captureTaskWorldDurably({
            baseRevision,
            binding,
            captureId: "capture:invalid-output",
            carrier,
            execution: {
                budget: { maxTurns: 1 },
                input: undefined,
                provider,
                runId: "run:invalid-output",
                task: fixtureTask,
            },
            runner: invalidOutputRunner,
            store: invalidOutputStore,
        }),
        TypeError,
    );
    assert.equal(
        readDurableTaskExecution(invalidOutputStore, "run:invalid-output").status,
        "started",
    );

    const unavailableBlobRunner = createRetainedWorldRunner({
        enforcement: "advisory",
        runnerId: "runner:unavailable-blob",
        run: async (runnerContext) => {
            const valid = await executeTask(runnerContext.execution);
            return Object.freeze({
                ...valid,
                artifacts: Object.freeze([
                    createRunArtifact({
                        artifactOrdinal: 0,
                        content: {
                            receipt: {
                                blob_id: `blob:sha256:${"0".repeat(64)}`,
                                byte_length: 1,
                            },
                            type: "blob",
                        },
                        kind: "attachment",
                        metadata: {},
                        name: "missing.bin",
                        runId: runnerContext.execution.runId,
                    }),
                ]),
            });
        },
    });
    const revisionsRoot = path.join(workspaceRoot, ".vcscore", "worlds", "revisions");
    const revisionsBeforeUnavailableBlob = await readdir(revisionsRoot);
    using unavailableBlobStore = new SQLiteTraceStore();
    await assert.rejects(
        captureTaskWorldDurably({
            baseRevision,
            binding,
            captureId: "capture:unavailable-blob",
            carrier,
            execution: {
                budget: { maxTurns: 1 },
                input: undefined,
                provider,
                runId: "run:unavailable-blob",
                task: fixtureTask,
            },
            runner: unavailableBlobRunner,
            store: unavailableBlobStore,
        }),
        TypeError,
    );
    assert.deepEqual(await readdir(revisionsRoot), revisionsBeforeUnavailableBlob);
    assert.equal(
        readDurableTaskExecution(unavailableBlobStore, "run:unavailable-blob").status,
        "started",
    );

    using wrongBlobSizeStore = new SQLiteTraceStore();
    const availableBlob = wrongBlobSizeStore.putBlob(Uint8Array.of(1, 2));
    const wrongBlobSizeRunner = createRetainedWorldRunner({
        enforcement: "advisory",
        runnerId: "runner:wrong-blob-size",
        run: async (runnerContext) => {
            const valid = await executeTask(runnerContext.execution);
            return Object.freeze({
                ...valid,
                artifacts: Object.freeze([
                    createRunArtifact({
                        artifactOrdinal: 0,
                        content: {
                            receipt: { blob_id: availableBlob.blob_id, byte_length: 1 },
                            type: "blob",
                        },
                        kind: "attachment",
                        metadata: {},
                        name: "wrong-size.bin",
                        runId: runnerContext.execution.runId,
                    }),
                ]),
            });
        },
    });
    await assert.rejects(
        captureTaskWorldDurably({
            baseRevision,
            binding,
            captureId: "capture:wrong-blob-size",
            carrier,
            execution: {
                budget: { maxTurns: 1 },
                input: undefined,
                provider,
                runId: "run:wrong-blob-size",
                task: fixtureTask,
            },
            runner: wrongBlobSizeRunner,
            store: wrongBlobSizeStore,
        }),
        TypeError,
    );

    const wrongProviderRunner = createRetainedWorldRunner({
        enforcement: "advisory",
        runnerId: "runner:wrong-provider",
        run: async (runnerContext) => {
            const valid = await executeTask(runnerContext.execution);
            return Object.freeze({
                ...valid,
                provider: Object.freeze({ ...valid.provider, id: "another-provider" }),
            });
        },
    });
    using wrongProviderStore = new SQLiteTraceStore();
    await assert.rejects(
        captureTaskWorldDurably({
            baseRevision,
            binding,
            captureId: "capture:wrong-provider",
            carrier,
            execution: {
                budget: { maxTurns: 1 },
                input: undefined,
                provider,
                runId: "run:wrong-provider",
                task: fixtureTask,
            },
            runner: wrongProviderRunner,
            store: wrongProviderStore,
        }),
        TypeError,
    );

    for (const [suffix, malformedResult] of [
        ["null", null],
        ["array", []],
    ] as const) {
        const malformedShapeRunner = createRetainedWorldRunner({
            enforcement: "advisory",
            runnerId: `runner:malformed-${suffix}`,
            run: async () => malformedResult as never,
        });
        using malformedShapeStore = new SQLiteTraceStore();
        await assert.rejects(
            captureTaskWorldDurably({
                baseRevision,
                binding,
                captureId: `capture:malformed-${suffix}`,
                carrier,
                execution: {
                    budget: { maxTurns: 1 },
                    input: undefined,
                    provider,
                    runId: `run:malformed-${suffix}`,
                    task: fixtureTask,
                },
                runner: malformedShapeRunner,
                store: malformedShapeStore,
            }),
            TypeError,
        );
    }

    const accessorResultRunner = createRetainedWorldRunner({
        enforcement: "advisory",
        runnerId: "runner:accessor-result",
        run: async (runnerContext) => {
            const valid = await executeTask(runnerContext.execution);
            const result = { ...valid };
            Object.defineProperty(result, "usage", { get: () => valid.usage });
            return result;
        },
    });
    using accessorResultStore = new SQLiteTraceStore();
    await assert.rejects(
        captureTaskWorldDurably({
            baseRevision,
            binding,
            captureId: "capture:accessor-result",
            carrier,
            execution: {
                budget: { maxTurns: 1 },
                input: undefined,
                provider,
                runId: "run:accessor-result",
                task: fixtureTask,
            },
            runner: accessorResultRunner,
            store: accessorResultStore,
        }),
        TypeError,
    );

    const textArtifactRunner = createRetainedWorldRunner({
        enforcement: "advisory",
        runnerId: "runner:text-artifact",
        run: async (runnerContext) => {
            const valid = await executeTask(runnerContext.execution);
            return Object.freeze({
                ...valid,
                artifacts: Object.freeze([
                    createRunArtifact({
                        artifactOrdinal: 0,
                        content: { text: "report", type: "text" },
                        kind: "report",
                        metadata: {},
                        name: "report.txt",
                        runId: runnerContext.execution.runId,
                    }),
                ]),
            });
        },
    });
    using textArtifactStore = new SQLiteTraceStore();
    const textArtifactResult = await captureTaskWorldDurably({
        baseRevision,
        binding,
        captureId: "capture:text-artifact",
        carrier,
        execution: {
            budget: { maxTurns: 1 },
            input: undefined,
            provider,
            runId: "run:text-artifact",
            task: fixtureTask,
        },
        runner: textArtifactRunner,
        store: textArtifactStore,
    });
    assert.equal(textArtifactResult.execution.artifacts[0]?.content.type, "text");

    const failingProvider = {
        descriptor: () => ({
            capabilities: { streaming: false, structuredOutput: true, tools: false },
            id: "failing-world-provider",
            kind: "static" as const,
            model: "offline-v1",
        }),
        invoke: () => {
            throw new Error("expected failure");
        },
    };
    using failedOutcomeStore = new SQLiteTraceStore();
    const failedOutcome = await captureTaskWorldDurably({
        baseRevision,
        binding,
        captureId: "capture:failed-outcome",
        carrier,
        execution: {
            budget: { maxTurns: 1 },
            input: undefined,
            provider: failingProvider,
            runId: "run:failed-outcome",
            task: fixtureTask,
        },
        runner,
        store: failedOutcomeStore,
    });
    assert.equal(failedOutcome.execution.outcome.outcome.status, "failed");

    using extendedOptionsStore = new SQLiteTraceStore();
    const extendedOptions = {
        baseRevision,
        binding,
        captureId: "capture:extended-options",
        carrier,
        execution: {
            budget: { maxTurns: 1 },
            input: undefined,
            provider,
            runId: "run:extended-options",
            task: fixtureTask,
        },
        runner,
        store: extendedOptionsStore,
        [Symbol("extension")]: true,
    };
    await assert.rejects(captureTaskWorldDurably(extendedOptions), TypeError);
    assert.deepEqual(extendedOptionsStore.readOwner("run:extended-options"), []);

    using substitutedOptionsStore = new SQLiteTraceStore();
    let captureIdReads = 0;
    const substitutedOptions = new Proxy(
        {
            baseRevision,
            binding,
            captureId: "capture:substituted-options",
            carrier,
            execution: {
                budget: { maxTurns: 1 },
                input: undefined,
                provider,
                runId: "run:substituted-options",
                task: fixtureTask,
            },
            runner,
            store: substitutedOptionsStore,
        },
        {
            get(target, property, receiver) {
                if (property === "captureId") {
                    captureIdReads += 1;
                    return "capture:substituted";
                }
                return Reflect.get(target, property, receiver);
            },
        },
    );
    const substitutedResult = await captureTaskWorldDurably(substitutedOptions);
    assert.equal(substitutedResult.output.capture_id, "capture:substituted-options");
    assert.equal(captureIdReads, 0);
});
