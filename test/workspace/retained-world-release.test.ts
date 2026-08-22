import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
    applyRetainedWorldSettlement,
    type Cut,
    type CutSpec,
    captureTaskWorldDurably,
    createGitRepositoryBindings,
    createReferenceCopyCarrier,
    createRetainedWorldRunner,
    createStaticProvider,
    createWorkspaceBindings,
    discardRetainedWorldSettlement,
    executeTask,
    initializeWorkspace,
    inspectDurableTaskExecution,
    inspectRetainedWorldRelease,
    prepareRetainedWorldSettlement,
    RETAINED_WORLD_RELEASE_COMPATIBILITY_VERSION,
    RETAINED_WORLD_RELEASE_RECEIPT_VERSION,
    RetainedWorldSettlementConflictError,
    RetainedWorldSettlementInvalidError,
    releaseRetainedWorldSettlement,
    SQLiteTraceStore,
    schema,
    selectRetainedWorldSettlement,
    task,
} from "../../src/index.ts";

class InterruptedReleaseTerminalStore extends SQLiteTraceStore {
    interruptTerminal = false;

    override retainRetainedWorldSettlementTerminal(
        ...argumentsValue: Parameters<SQLiteTraceStore["retainRetainedWorldSettlementTerminal"]>
    ): ReturnType<SQLiteTraceStore["retainRetainedWorldSettlementTerminal"]> {
        if (this.interruptTerminal) throw new Error("interrupted before release terminal receipt");
        return super.retainRetainedWorldSettlementTerminal(...argumentsValue);
    }
}

class InterruptedReleaseCitationStore extends SQLiteTraceStore {
    interruptCitation = false;

    override publishCut(spec: CutSpec): Cut {
        if (this.interruptCitation) throw new Error("interrupted before release citation cut");
        return super.publishCut(spec);
    }
}

class MalformedReleaseInspectionStore extends SQLiteTraceStore {
    failJournalRead = false;

    override readRetainedWorldSettlementJournal(
        ...argumentsValue: Parameters<SQLiteTraceStore["readRetainedWorldSettlementJournal"]>
    ): ReturnType<SQLiteTraceStore["readRetainedWorldSettlementJournal"]> {
        if (this.failJournalRead) throw new TypeError("malformed release journal");
        return super.readRetainedWorldSettlementJournal(...argumentsValue);
    }
}

test("public release preserves advanced user bytes and retained custody", async (context) => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "shepherd-world-release-"));
    context.after(() => rm(workspaceRoot, { force: true, recursive: true }));
    initializeWorkspace({ adopt: "none", initializeGit: false, rootPath: workspaceRoot });
    const sourceRoot = path.join(workspaceRoot, "source");
    await mkdir(sourceRoot);
    const messagePath = path.join(sourceRoot, "message.txt");
    await writeFile(messagePath, "before\n");
    const binding = createWorkspaceBindings({
        bindings: [{ name: "source", root: "source" }],
        workspaceRoot,
    }).bindings[0];
    assert.ok(binding);
    const carrier = createReferenceCopyCarrier({ workspaceRoot });
    const baseRevision = await carrier.snapshot(binding);
    const descriptor = task({
        input: schema.void(),
        instruction: "Produce a retained release candidate.",
        name: "release-candidate",
        output: schema.string(),
        version: "1",
    });
    const runner = createRetainedWorldRunner({
        enforcement: "advisory",
        runnerId: "runner:release-candidate",
        run: async (runnerContext) => {
            await runnerContext.world.writeText("message.txt", "candidate\n");
            return executeTask(runnerContext.execution);
        },
    });
    const provider = createStaticProvider({
        descriptor: { id: "release-provider", model: "offline-v1" },
        exchanges: [
            {
                request: {
                    input: null,
                    instruction: descriptor.instruction,
                    outputSchema: descriptor.artifact.output_schema,
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
    using store = new SQLiteTraceStore(path.join(workspaceRoot, "trace.sqlite"));
    const captured = await captureTaskWorldDurably({
        baseRevision,
        binding,
        captureId: "capture:release-candidate",
        carrier,
        execution: {
            budget: { maxTurns: 1 },
            input: undefined,
            provider,
            runId: "run:release-candidate",
            task: descriptor,
        },
        runner,
        store,
    });
    await writeFile(messagePath, "current\n");
    const prepared = await prepareRetainedWorldSettlement({
        action: "release",
        binding,
        carrier,
        commandId: "settlement:release-candidate",
        output: captured.output,
        store,
    });
    const currentRevision = await carrier.snapshot(binding);

    const released = await releaseRetainedWorldSettlement({
        binding,
        carrier,
        outputId: captured.output.output_id,
        store,
    });

    assert.equal(released.action, "release");
    assert.equal(released.state, "released");
    assert.equal(released.base_revision_id, captured.output.base_revision_id);
    assert.equal(released.binding_id, captured.output.binding_id);
    assert.equal(released.custody_id, captured.output.custody_id);
    assert.equal(released.head_revision_id, captured.output.head_revision_id);
    assert.equal(released.changeset_id, captured.output.changeset_id);
    assert.equal(released.compatibility_version, RETAINED_WORLD_RELEASE_COMPATIBILITY_VERSION);
    assert.equal(released.release_receipt_version, RETAINED_WORLD_RELEASE_RECEIPT_VERSION);
    assert.equal(released.user_basis_before, currentRevision.content_id);
    assert.equal(released.user_basis_after, currentRevision.content_id);
    assert.notEqual(released.user_basis_before, prepared.request.user_basis_before);
    assert.equal(await readFile(messagePath, "utf8"), "current\n");
    const custody = await carrier.openCustody(released.custody_id);
    const headRevision = await carrier.openRevision(released.head_revision_id);
    assert.equal(await readFile(path.join(custody.path, "message.txt"), "utf8"), "candidate\n");
    assert.equal(
        (await carrier.verifyCustody(released.custody_id)).content_id,
        headRevision.content_id,
    );
    assert.deepEqual(inspectRetainedWorldRelease(store, captured.output.output_id), released);
    await mkdir(path.join(workspaceRoot, "other"));
    const otherBinding = createWorkspaceBindings({
        bindings: [{ name: "other", root: "other" }],
        workspaceRoot,
    }).bindings[0];
    assert.ok(otherBinding);
    await assert.rejects(
        releaseRetainedWorldSettlement({
            binding: otherBinding,
            carrier,
            outputId: captured.output.output_id,
            store,
        }),
        RetainedWorldSettlementInvalidError,
    );
    const inspected = inspectDurableTaskExecution(store, captured.output.run_id).settlements[0];
    assert.ok(inspected);
    assert.equal(inspected.action, "release");
    assert.equal(inspected.state, "released");
    using imported = new SQLiteTraceStore();
    imported.importTrace(store.exportTrace());
    assert.deepEqual(inspectDurableTaskExecution(imported, captured.output.run_id).settlements, [
        inspected,
    ]);
    for (const settle of [
        () =>
            selectRetainedWorldSettlement({
                binding,
                carrier,
                outputId: captured.output.output_id,
                store,
            }),
        () =>
            applyRetainedWorldSettlement({
                binding,
                carrier,
                outputId: captured.output.output_id,
                store,
            }),
        () =>
            discardRetainedWorldSettlement({
                carrier,
                outputId: captured.output.output_id,
                store,
            }),
    ]) {
        await assert.rejects(settle, RetainedWorldSettlementConflictError);
    }
});

test("public release preserves Git HEAD, index, dirty, untracked, and ignored state", async (context) => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "shepherd-world-release-git-"));
    context.after(() => rm(workspaceRoot, { force: true, recursive: true }));
    initializeWorkspace({ adopt: "none", initializeGit: false, rootPath: workspaceRoot });
    const sourceRoot = path.join(workspaceRoot, "source");
    await mkdir(sourceRoot);
    execFileSync("git", ["init", "--quiet"], { cwd: sourceRoot });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: sourceRoot });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: sourceRoot });
    await writeFile(path.join(sourceRoot, ".gitignore"), "*.ignored\n");
    await writeFile(path.join(sourceRoot, "candidate.txt"), "before-candidate\n");
    await writeFile(path.join(sourceRoot, "current.txt"), "before-current\n");
    execFileSync("git", ["add", ".gitignore", "candidate.txt", "current.txt"], {
        cwd: sourceRoot,
    });
    execFileSync("git", ["commit", "--quiet", "-m", "base"], { cwd: sourceRoot });
    const binding = createGitRepositoryBindings({
        bindings: [{ name: "source", root: "source" }],
        workspaceRoot,
    }).bindings[0];
    assert.ok(binding);
    const carrier = createReferenceCopyCarrier({ workspaceRoot });
    const baseRevision = await carrier.snapshot(binding);
    const descriptor = task({
        input: schema.void(),
        instruction: "Produce a Git release candidate.",
        name: "release-git",
        output: schema.string(),
        version: "1",
    });
    const runner = createRetainedWorldRunner({
        enforcement: "advisory",
        runnerId: "runner:release-git",
        run: async (runnerContext) => {
            await runnerContext.world.writeText("candidate.txt", "candidate\n");
            return executeTask(runnerContext.execution);
        },
    });
    const provider = createStaticProvider({
        descriptor: { id: "release-git-provider", model: "offline-v1" },
        exchanges: [
            {
                request: {
                    input: null,
                    instruction: descriptor.instruction,
                    outputSchema: descriptor.artifact.output_schema,
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
    using store = new SQLiteTraceStore(path.join(workspaceRoot, "trace.sqlite"));
    const captured = await captureTaskWorldDurably({
        baseRevision,
        binding,
        captureId: "capture:release-git",
        carrier,
        execution: {
            budget: { maxTurns: 1 },
            input: undefined,
            provider,
            runId: "run:release-git",
            task: descriptor,
        },
        runner,
        store,
    });
    await writeFile(path.join(sourceRoot, "current.txt"), "current\n");
    await writeFile(path.join(sourceRoot, "untracked.txt"), "untracked\n");
    await writeFile(path.join(sourceRoot, "cache.ignored"), "ignored\n");
    execFileSync("git", ["update-index", "--chmod=+x", "current.txt"], { cwd: sourceRoot });
    const headBefore = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: sourceRoot,
        encoding: "utf8",
    });
    const indexBefore = execFileSync("git", ["ls-files", "--stage"], {
        cwd: sourceRoot,
        encoding: "utf8",
    });
    await prepareRetainedWorldSettlement({
        action: "release",
        binding,
        carrier,
        commandId: "settlement:release-git",
        output: captured.output,
        store,
    });

    await releaseRetainedWorldSettlement({
        binding,
        carrier,
        outputId: captured.output.output_id,
        store,
    });

    assert.equal(
        await readFile(path.join(sourceRoot, "candidate.txt"), "utf8"),
        "before-candidate\n",
    );
    assert.equal(await readFile(path.join(sourceRoot, "current.txt"), "utf8"), "current\n");
    assert.equal(await readFile(path.join(sourceRoot, "untracked.txt"), "utf8"), "untracked\n");
    assert.equal(await readFile(path.join(sourceRoot, "cache.ignored"), "utf8"), "ignored\n");
    assert.equal(
        execFileSync("git", ["rev-parse", "HEAD"], { cwd: sourceRoot, encoding: "utf8" }),
        headBefore,
    );
    assert.equal(
        execFileSync("git", ["ls-files", "--stage"], { cwd: sourceRoot, encoding: "utf8" }),
        indexBefore,
    );
});

test("public release recovers terminal and citation interruptions after reopen", async (context) => {
    const terminal = await createReleaseFixture(
        context,
        "terminal-interruption",
        (databasePath) => new InterruptedReleaseTerminalStore(databasePath),
    );
    assert.equal(inspectRetainedWorldRelease(terminal.store, terminal.outputId), undefined);
    terminal.store.interruptTerminal = true;
    await assert.rejects(
        releaseRetainedWorldSettlement({
            binding: terminal.binding,
            carrier: terminal.carrier,
            outputId: terminal.outputId,
            store: terminal.store,
        }),
        RetainedWorldSettlementInvalidError,
    );
    assert.equal(
        terminal.store.readRetainedWorldSettlementJournal(terminal.outputId)?.state,
        "applying",
    );
    terminal.store.close();
    using reopenedTerminal = new SQLiteTraceStore(terminal.databasePath);
    const recovered = await releaseRetainedWorldSettlement({
        binding: terminal.binding,
        carrier: terminal.carrier,
        outputId: terminal.outputId,
        store: reopenedTerminal,
    });
    await writeFile(path.join(terminal.workspaceRoot, "source", "message.txt"), "later\n");
    assert.deepEqual(
        await releaseRetainedWorldSettlement({
            binding: terminal.binding,
            carrier: terminal.carrier,
            outputId: terminal.outputId,
            store: reopenedTerminal,
        }),
        recovered,
    );
    assert.notEqual(
        (await terminal.carrier.snapshot(terminal.binding)).content_id,
        recovered.user_basis_after,
    );

    const citation = await createReleaseFixture(
        context,
        "citation-interruption",
        (databasePath) => new InterruptedReleaseCitationStore(databasePath),
    );
    citation.store.interruptCitation = true;
    await assert.rejects(
        releaseRetainedWorldSettlement({
            binding: citation.binding,
            carrier: citation.carrier,
            outputId: citation.outputId,
            store: citation.store,
        }),
        RetainedWorldSettlementInvalidError,
    );
    assert.equal(
        citation.store.readRetainedWorldSettlementJournal(citation.outputId)?.state,
        "released",
    );
    citation.store.close();
    using reopenedCitation = new SQLiteTraceStore(citation.databasePath);
    assert.equal(
        (
            await releaseRetainedWorldSettlement({
                binding: citation.binding,
                carrier: citation.carrier,
                outputId: citation.outputId,
                store: reopenedCitation,
            })
        ).state,
        "released",
    );
});

test("concurrent and fresh-process release callers converge on one receipt", async (context) => {
    const fixture = await createReleaseFixture(
        context,
        "concurrent",
        (databasePath) => new SQLiteTraceStore(databasePath),
    );
    using competing = new SQLiteTraceStore(fixture.databasePath);
    const [first, second] = await Promise.all([
        releaseRetainedWorldSettlement({
            binding: fixture.binding,
            carrier: fixture.carrier,
            outputId: fixture.outputId,
            store: fixture.store,
        }),
        releaseRetainedWorldSettlement({
            binding: fixture.binding,
            carrier: fixture.carrier,
            outputId: fixture.outputId,
            store: competing,
        }),
    ]);
    assert.deepEqual(second, first);
    assert.deepEqual(
        releaseInChild(fixture.workspaceRoot, fixture.databasePath, fixture.outputId),
        first,
    );
    assert.deepEqual(inspectRetainedWorldRelease(fixture.store, fixture.outputId), first);
});

test("release cannot replace interrupted select or apply publication", async (context) => {
    for (const action of ["select", "apply"] as const) {
        const fixture = await createReleaseFixture(
            context,
            `interrupted-${action}`,
            (databasePath) => new InterruptedReleaseTerminalStore(databasePath),
            action,
        );
        fixture.store.interruptTerminal = true;
        const settle =
            action === "select"
                ? () =>
                      selectRetainedWorldSettlement({
                          binding: fixture.binding,
                          carrier: fixture.carrier,
                          outputId: fixture.outputId,
                          store: fixture.store,
                      })
                : () =>
                      applyRetainedWorldSettlement({
                          binding: fixture.binding,
                          carrier: fixture.carrier,
                          outputId: fixture.outputId,
                          store: fixture.store,
                      });
        await assert.rejects(settle, RetainedWorldSettlementInvalidError);
        assert.equal(
            fixture.store.readRetainedWorldSettlementJournal(fixture.outputId)?.state,
            "applying",
        );
        await assert.rejects(
            releaseRetainedWorldSettlement({
                binding: fixture.binding,
                carrier: fixture.carrier,
                outputId: fixture.outputId,
                store: fixture.store,
            }),
            RetainedWorldSettlementConflictError,
        );
        fixture.store.interruptTerminal = false;
        assert.equal((await settle()).action, action);
    }
});

test("release refuses missing custody and other settlement actions", async (context) => {
    const missing = await createReleaseFixture(
        context,
        "missing-custody",
        (databasePath) => new SQLiteTraceStore(databasePath),
    );
    await missing.carrier.discard(missing.custodyId);
    await assert.rejects(
        releaseRetainedWorldSettlement({
            binding: missing.binding,
            carrier: missing.carrier,
            outputId: missing.outputId,
            store: missing.store,
        }),
        RetainedWorldSettlementInvalidError,
    );
    assert.equal(
        missing.store.readRetainedWorldSettlementJournal(missing.outputId)?.state,
        "prepared",
    );
    const corrupt = await createReleaseFixture(
        context,
        "corrupt-custody",
        (databasePath) => new SQLiteTraceStore(databasePath),
    );
    const corruptCustody = await corrupt.carrier.openCustody(corrupt.custodyId);
    await writeFile(path.join(corruptCustody.path, "message.txt"), "corrupt\n");
    await assert.rejects(
        releaseRetainedWorldSettlement({
            binding: corrupt.binding,
            carrier: corrupt.carrier,
            outputId: corrupt.outputId,
            store: corrupt.store,
        }),
        RetainedWorldSettlementInvalidError,
    );
    assert.equal(
        corrupt.store.readRetainedWorldSettlementJournal(corrupt.outputId)?.state,
        "prepared",
    );
    const substituted = await createReleaseFixture(
        context,
        "symlink-substitution",
        (databasePath) => new SQLiteTraceStore(databasePath),
    );
    const substitutedCustody = await substituted.carrier.openCustody(substituted.custodyId);
    const movedCustodyPath = `${substitutedCustody.path}-moved`;
    await rename(substitutedCustody.path, movedCustodyPath);
    await symlink(movedCustodyPath, substitutedCustody.path);
    await assert.rejects(
        releaseRetainedWorldSettlement({
            binding: substituted.binding,
            carrier: substituted.carrier,
            outputId: substituted.outputId,
            store: substituted.store,
        }),
        RetainedWorldSettlementInvalidError,
    );
    assert.equal(
        substituted.store.readRetainedWorldSettlementJournal(substituted.outputId)?.state,
        "prepared",
    );

    const selected = await createReleaseFixture(
        context,
        "action-conflict",
        (databasePath) => new SQLiteTraceStore(databasePath),
        "select",
    );
    await assert.rejects(
        releaseRetainedWorldSettlement({
            binding: selected.binding,
            carrier: selected.carrier,
            outputId: selected.outputId,
            store: selected.store,
        }),
        RetainedWorldSettlementConflictError,
    );
    for (const invalid of [
        null,
        [],
        {},
        {
            binding: selected.binding,
            carrier: selected.carrier,
            outputId: selected.outputId,
            store: selected.store,
            extra: true,
        },
        {
            binding: { ...selected.binding },
            carrier: selected.carrier,
            outputId: selected.outputId,
            store: selected.store,
        },
        {
            binding: selected.binding,
            carrier: { ...selected.carrier },
            outputId: selected.outputId,
            store: selected.store,
        },
        {
            binding: selected.binding,
            carrier: selected.carrier,
            outputId: "",
            store: selected.store,
        },
        {
            binding: selected.binding,
            carrier: selected.carrier,
            outputId: "world-output:absent",
            store: selected.store,
        },
    ]) {
        await assert.rejects(
            releaseRetainedWorldSettlement(invalid as never),
            RetainedWorldSettlementInvalidError,
        );
    }
    assert.throws(() => inspectRetainedWorldRelease(selected.store, ""), TypeError);
    assert.equal(inspectRetainedWorldRelease(selected.store, "world-output:absent"), undefined);
    for (const error of [
        new TypeError("malformed release journal"),
        new RetainedWorldSettlementInvalidError("invalid"),
    ]) {
        assert.throws(
            () =>
                inspectRetainedWorldRelease(
                    {
                        readRetainedWorldSettlement: () => {
                            throw error;
                        },
                    } as never,
                    selected.outputId,
                ),
            RetainedWorldSettlementInvalidError,
        );
    }
    const malformed = await createReleaseFixture(
        context,
        "malformed-inspection",
        (databasePath) => new MalformedReleaseInspectionStore(databasePath),
    );
    malformed.store.failJournalRead = true;
    assert.throws(
        () => inspectRetainedWorldRelease(malformed.store, malformed.outputId),
        RetainedWorldSettlementInvalidError,
    );
});

async function createReleaseFixture<T extends SQLiteTraceStore>(
    context: { after: (callback: () => Promise<void> | void) => void },
    suffix: string,
    createStore: (databasePath: string) => T,
    action: "release" | "select" | "apply" = "release",
): Promise<{
    readonly binding: NonNullable<ReturnType<typeof createWorkspaceBindings>["bindings"][number]>;
    readonly carrier: ReturnType<typeof createReferenceCopyCarrier>;
    readonly custodyId: string;
    readonly databasePath: string;
    readonly outputId: string;
    readonly store: T;
    readonly workspaceRoot: string;
}> {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), `shepherd-world-release-${suffix}-`));
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
    const descriptor = task({
        input: schema.void(),
        instruction: "Produce a recoverable release candidate.",
        name: `release-${suffix}`,
        output: schema.string(),
        version: "1",
    });
    const runner = createRetainedWorldRunner({
        enforcement: "advisory",
        runnerId: `runner:release-${suffix}`,
        run: async (runnerContext) => {
            await runnerContext.world.writeText("message.txt", "candidate\n");
            return executeTask(runnerContext.execution);
        },
    });
    const provider = createStaticProvider({
        descriptor: { id: `release-${suffix}-provider`, model: "offline-v1" },
        exchanges: [
            {
                request: {
                    input: null,
                    instruction: descriptor.instruction,
                    outputSchema: descriptor.artifact.output_schema,
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
    const store = createStore(databasePath);
    context.after(() => store.close());
    const captured = await captureTaskWorldDurably({
        baseRevision,
        binding,
        captureId: `capture:release-${suffix}`,
        carrier,
        execution: {
            budget: { maxTurns: 1 },
            input: undefined,
            provider,
            runId: `run:release-${suffix}`,
            task: descriptor,
        },
        runner,
        store,
    });
    await prepareRetainedWorldSettlement({
        action,
        binding,
        carrier,
        commandId: `settlement:release-${suffix}`,
        output: captured.output,
        store,
    });
    return {
        binding,
        carrier,
        custodyId: captured.output.custody_id,
        databasePath,
        outputId: captured.output.output_id,
        store,
        workspaceRoot,
    };
}

function releaseInChild(
    workspaceRoot: string,
    databasePath: string,
    outputId: string,
): Record<string, unknown> {
    const source = `
        import {
            createReferenceCopyCarrier,
            createWorkspaceBindings,
            releaseRetainedWorldSettlement,
            SQLiteTraceStore,
        } from "./src/index.ts";
        const [workspaceRoot, databasePath, outputId] = process.argv.slice(1);
        const carrier = createReferenceCopyCarrier({ workspaceRoot });
        const binding = createWorkspaceBindings({
            bindings: [{ name: "source", root: "source" }],
            workspaceRoot,
        }).bindings[0];
        using store = new SQLiteTraceStore(databasePath);
        const result = await releaseRetainedWorldSettlement({ binding, carrier, outputId, store });
        console.log(JSON.stringify(result));
    `;
    return JSON.parse(
        execFileSync(
            process.execPath,
            ["--input-type=module", "-e", source, workspaceRoot, databasePath, outputId],
            { cwd: process.cwd(), encoding: "utf8" },
        ),
    ) as Record<string, unknown>;
}
