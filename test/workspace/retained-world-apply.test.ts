import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import {
    chmod,
    lstat,
    mkdir,
    mkdtemp,
    readFile,
    readlink,
    rm,
    symlink,
    unlink,
    writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
    applyRetainedWorldSettlement,
    type Cut,
    type CutSpec,
    captureGrantedTaskWorldDurably,
    captureTaskWorldDurably,
    createGitRepositoryBindings,
    createGitRepositoryGrantPlan,
    createReferenceCopyCarrier,
    createRetainedWorldRunner,
    createStaticProvider,
    createWorkspaceBindings,
    discardRetainedWorldSettlement,
    executeTask,
    grantTaskRepositories,
    initializeWorkspace,
    inspectDurableTaskExecution,
    inspectRetainedWorldApplicationConflicts,
    inspectRetainedWorldApplicationPlan,
    inspectRetainedWorldSettlement,
    inspectTaskWorldCaptureJournal,
    prepareRetainedWorldSettlement,
    RetainedWorldApplicationConflictError,
    RetainedWorldSettlementConflictError,
    RetainedWorldSettlementInvalidError,
    SQLiteTraceStore,
    schema,
    selectRetainedWorldSettlement,
    task,
    WorldCarrierError,
} from "../../src/index.ts";
import { workspaceProtocolConfig } from "../../src/protocol/config.ts";

const applicationConfig = workspaceProtocolConfig.settlement.application;

class InterruptedAppliedTerminalStore extends SQLiteTraceStore {
    interruptTerminal = false;

    override retainRetainedWorldSettlementTerminal(
        ...argumentsValue: Parameters<SQLiteTraceStore["retainRetainedWorldSettlementTerminal"]>
    ): ReturnType<SQLiteTraceStore["retainRetainedWorldSettlementTerminal"]> {
        if (this.interruptTerminal) throw new Error("interrupted after apply publication");
        return super.retainRetainedWorldSettlementTerminal(...argumentsValue);
    }
}

class BasisMovedAfterApplyPlanStore extends SQLiteTraceStore {
    readonly #userPath: string;

    constructor(databasePath: string, userPath: string) {
        super(databasePath);
        this.#userPath = userPath;
    }

    override beginRetainedWorldSettlement(
        ...argumentsValue: Parameters<SQLiteTraceStore["beginRetainedWorldSettlement"]>
    ): ReturnType<SQLiteTraceStore["beginRetainedWorldSettlement"]> {
        const journal = super.beginRetainedWorldSettlement(...argumentsValue);
        writeFileSync(this.#userPath, "moved-after-plan\n");
        return journal;
    }
}

class InterruptedApplyCitationStore extends SQLiteTraceStore {
    interruptCitation = false;

    override publishCut(spec: CutSpec): Cut {
        if (this.interruptCitation) throw new Error("interrupted before apply citation cut");
        return super.publishCut(spec);
    }
}

test("application conflict inspection classifies equal, prefix, alias, and disjoint paths", () => {
    assert.equal(
        inspectRetainedWorldApplicationConflicts({
            candidatePaths: ["candidate.txt"],
            currentPaths: ["current.txt"],
        }),
        null,
    );
    const equal = inspectRetainedWorldApplicationConflicts({
        candidatePaths: ["same.txt"],
        currentPaths: ["same.txt"],
    });
    assert.deepEqual(equal?.conflicts, [
        { candidate_path: "same.txt", current_path: "same.txt", kind: "equal-path" },
    ]);
    const prefix = inspectRetainedWorldApplicationConflicts({
        candidatePaths: ["directory"],
        currentPaths: ["directory/child.txt"],
    });
    assert.deepEqual(prefix?.conflicts, [
        {
            candidate_path: "directory",
            current_path: "directory/child.txt",
            kind: "ancestor-descendant",
        },
    ]);
    const reversePrefix = inspectRetainedWorldApplicationConflicts({
        candidatePaths: ["directory/child.txt"],
        currentPaths: ["directory"],
    });
    assert.deepEqual(reversePrefix?.conflicts, [
        {
            candidate_path: "directory/child.txt",
            current_path: "directory",
            kind: "ancestor-descendant",
        },
    ]);
    const alias = inspectRetainedWorldApplicationConflicts({
        candidatePaths: ["Résumé.md"],
        currentPaths: ["re\u0301sume\u0301.md"],
    });
    assert.deepEqual(alias?.conflicts, [
        {
            candidate_path: "Résumé.md",
            current_path: "re\u0301sume\u0301.md",
            kind: "portable-alias",
        },
    ]);
    assert.deepEqual(
        inspectRetainedWorldApplicationConflicts({
            candidatePaths: ["b.txt", "a.txt"],
            currentPaths: ["a.txt", "b.txt"],
        })?.conflicts,
        [
            { candidate_path: "a.txt", current_path: "a.txt", kind: "equal-path" },
            { candidate_path: "b.txt", current_path: "b.txt", kind: "equal-path" },
        ],
    );
    assert.equal(
        inspectRetainedWorldApplicationConflicts(
            Object.assign(Object.create(null), {
                candidatePaths: ["candidate.txt"],
                currentPaths: ["current.txt"],
            }),
        ),
        null,
    );
    const aliases = Array.from({ length: 1 << 10 }, (_, ordinal) =>
        [..."abcdefghij"]
            .map((character, index) =>
                (ordinal & (1 << index)) === 0 ? character : character.toUpperCase(),
            )
            .join(""),
    );
    assert.equal(
        inspectRetainedWorldApplicationConflicts({
            candidatePaths: ["ABCDEFGHIJ"],
            currentPaths: aliases,
        })?.conflicts.length,
        applicationConfig.maxConflicts,
    );
    assert.deepEqual(
        inspectRetainedWorldApplicationConflicts({
            candidatePaths: ["ABCDEFGHIJ"],
            currentPaths: [...aliases].reverse(),
        }),
        inspectRetainedWorldApplicationConflicts({
            candidatePaths: ["ABCDEFGHIJ"],
            currentPaths: aliases,
        }),
    );
    const sparsePaths = ["one"];
    sparsePaths.length = 2;
    for (const invalid of [
        null,
        [],
        {},
        new Date(),
        { candidatePaths: [], currentPaths: [], extra: true },
        { candidatePaths: [], wrong: [] },
        Object.defineProperty({ candidatePaths: [], currentPaths: [] }, "candidatePaths", {
            get: () => [],
        }),
        { candidatePaths: {}, currentPaths: [] },
        { candidatePaths: [1], currentPaths: [] },
        { candidatePaths: sparsePaths, currentPaths: [] },
        {
            candidatePaths: Array.from(
                { length: workspaceProtocolConfig.changesets.maxChanges + 1 },
                (_, ordinal) => `path-${ordinal}`,
            ),
            currentPaths: [],
        },
        { candidatePaths: ["../escape"], currentPaths: [] },
        { candidatePaths: ["same", "same"], currentPaths: [] },
    ]) {
        assert.throws(() => inspectRetainedWorldApplicationConflicts(invalid as never), TypeError);
    }
});

test("public apply preserves current Git dirty, untracked, ignored, and index state", async (context) => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "shepherd-world-apply-git-"));
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
        instruction: "Produce a repository apply candidate.",
        name: "apply-git",
        output: schema.string(),
        version: "1",
    });
    const granted = grantTaskRepositories({
        grants: [{ binding: "source", profile: "read-write" }],
        task: descriptor,
    });
    const repositoryGrantPlan = createGitRepositoryGrantPlan({
        authorityCeiling: "read-write",
        bindings: [binding],
        task: granted,
    });
    const runner = createRetainedWorldRunner({
        enforcement: "advisory",
        runnerId: "runner:apply-git",
        run: async (runnerContext) => {
            await runnerContext.world.writeText("candidate.txt", "candidate\n");
            return executeTask(runnerContext.execution);
        },
    });
    const provider = createStaticProvider({
        descriptor: { id: "apply-git-provider", model: "offline-v1" },
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
    const captured = await captureGrantedTaskWorldDurably({
        baseRevision,
        binding,
        captureId: "capture:apply-git",
        carrier,
        execution: {
            budget: { maxTurns: 1 },
            input: undefined,
            provider,
            runId: "run:apply-git",
            task: descriptor,
        },
        repositoryGrantPlan,
        runner,
        store,
    });
    const administrativeRunner = createRetainedWorldRunner({
        enforcement: "advisory",
        runnerId: "runner:apply-git-administrative",
        run: async (runnerContext) => {
            const forked = inspectTaskWorldCaptureJournal(store, "run:apply-git-administrative")
                .transitions[1];
            assert.ok(forked);
            const custody = await carrier.openCustody(forked.body.custody_id as string);
            await writeFile(path.join(custody.path, ".git", "config"), "malicious\n");
            return executeTask(runnerContext.execution);
        },
    });
    const administrativeProvider = createStaticProvider({
        descriptor: { id: "apply-git-administrative-provider", model: "offline-v1" },
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
    const administrative = await captureGrantedTaskWorldDurably({
        baseRevision,
        binding,
        captureId: "capture:apply-git-administrative",
        carrier,
        execution: {
            budget: { maxTurns: 1 },
            input: undefined,
            provider: administrativeProvider,
            runId: "run:apply-git-administrative",
            task: descriptor,
        },
        repositoryGrantPlan,
        runner: administrativeRunner,
        store,
    });
    await writeFile(path.join(sourceRoot, "current.txt"), "current\n");
    await writeFile(path.join(sourceRoot, "untracked.txt"), "untracked\n");
    await writeFile(path.join(sourceRoot, "cache.ignored"), "ignored\n");
    execFileSync("git", ["update-index", "--chmod=+x", "current.txt"], { cwd: sourceRoot });
    const indexBefore = execFileSync("git", ["ls-files", "--stage"], {
        cwd: sourceRoot,
        encoding: "utf8",
    });
    await prepareRetainedWorldSettlement({
        action: "apply",
        binding,
        carrier,
        commandId: "settlement:apply-git",
        output: captured.output,
        store,
    });

    await applyRetainedWorldSettlement({
        binding,
        carrier,
        outputId: captured.output.output_id,
        store,
    });

    assert.equal(await readFile(path.join(sourceRoot, "candidate.txt"), "utf8"), "candidate\n");
    assert.equal(await readFile(path.join(sourceRoot, "current.txt"), "utf8"), "current\n");
    assert.equal(await readFile(path.join(sourceRoot, "untracked.txt"), "utf8"), "untracked\n");
    assert.equal(await readFile(path.join(sourceRoot, "cache.ignored"), "utf8"), "ignored\n");
    assert.equal(
        execFileSync("git", ["ls-files", "--stage"], { cwd: sourceRoot, encoding: "utf8" }),
        indexBefore,
    );
    await assert.rejects(
        prepareRetainedWorldSettlement({
            action: "apply",
            binding,
            carrier,
            commandId: "settlement:apply-git-administrative",
            output: administrative.output,
            store,
        }),
        RetainedWorldSettlementInvalidError,
    );
    assert.match(await readFile(path.join(sourceRoot, ".git", "config"), "utf8"), /Test/u);
});

test("public apply preserves independent edits across structural candidate effects", async (context) => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "shepherd-world-apply-structural-"));
    context.after(() => rm(workspaceRoot, { force: true, recursive: true }));
    initializeWorkspace({ adopt: "none", initializeGit: false, rootPath: workspaceRoot });
    const sourceRoot = path.join(workspaceRoot, "source");
    await mkdir(sourceRoot);
    await writeFile(path.join(sourceRoot, "delete.txt"), "delete\n");
    await writeFile(path.join(sourceRoot, "mode.txt"), "mode\n", { mode: 0o644 });
    const currentPath = path.join(sourceRoot, "current.txt");
    await writeFile(currentPath, "before-current\n");
    const binding = createWorkspaceBindings({
        bindings: [{ name: "source", root: "source" }],
        workspaceRoot,
    }).bindings[0];
    assert.ok(binding);
    const carrier = createReferenceCopyCarrier({ workspaceRoot });
    const baseRevision = await carrier.snapshot(binding);
    const descriptor = task({
        input: schema.void(),
        instruction: "Produce structural apply effects.",
        name: "apply-structural",
        output: schema.string(),
        version: "1",
    });
    const provider = createStaticProvider({
        descriptor: { id: "apply-structural-provider", model: "offline-v1" },
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
    using store = new SQLiteTraceStore(databasePath);
    const runner = createRetainedWorldRunner({
        enforcement: "advisory",
        runnerId: "runner:apply-structural",
        run: async (runnerContext) => {
            const forked = inspectTaskWorldCaptureJournal(store, "run:apply-structural")
                .transitions[1];
            assert.ok(forked);
            const custody = await carrier.openCustody(forked.body.custody_id as string);
            await unlink(path.join(custody.path, "delete.txt"));
            await chmod(path.join(custody.path, "mode.txt"), 0o755);
            await mkdir(path.join(custody.path, "directory"));
            await writeFile(path.join(custody.path, "directory", "added.txt"), "added\n");
            await symlink("mode.txt", path.join(custody.path, "link.txt"));
            return executeTask(runnerContext.execution);
        },
    });
    const captured = await captureTaskWorldDurably({
        baseRevision,
        binding,
        captureId: "capture:apply-structural",
        carrier,
        execution: {
            budget: { maxTurns: 1 },
            input: undefined,
            provider,
            runId: "run:apply-structural",
            task: descriptor,
        },
        runner,
        store,
    });
    await writeFile(currentPath, "independent-current\n");
    await prepareRetainedWorldSettlement({
        action: "apply",
        binding,
        carrier,
        commandId: "settlement:apply-structural",
        output: captured.output,
        store,
    });

    await applyRetainedWorldSettlement({
        binding,
        carrier,
        outputId: captured.output.output_id,
        store,
    });

    await assert.rejects(readFile(path.join(sourceRoot, "delete.txt")));
    assert.equal((await lstat(path.join(sourceRoot, "mode.txt"))).mode & 0o777, 0o755);
    assert.equal(
        await readFile(path.join(sourceRoot, "directory", "added.txt"), "utf8"),
        "added\n",
    );
    assert.equal(await readlink(path.join(sourceRoot, "link.txt")), "mode.txt");
    assert.equal(await readFile(currentPath, "utf8"), "independent-current\n");
});

test("public apply on an unmoved basis publishes candidate bytes and records applied", async (context) => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "shepherd-world-apply-degenerate-"));
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
        instruction: "Produce one apply candidate.",
        name: "apply-degenerate",
        output: schema.string(),
        version: "1",
    });
    const runner = createRetainedWorldRunner({
        enforcement: "advisory",
        runnerId: "runner:apply-degenerate",
        run: async (runnerContext) => {
            await runnerContext.world.writeText("message.txt", "applied\n");
            return executeTask(runnerContext.execution);
        },
    });
    const provider = createStaticProvider({
        descriptor: { id: "apply-degenerate-provider", model: "offline-v1" },
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
    const store = new InterruptedAppliedTerminalStore(databasePath);
    context.after(async () => store.close());
    const captured = await captureTaskWorldDurably({
        baseRevision,
        binding,
        captureId: "capture:apply-degenerate",
        carrier,
        execution: {
            budget: { maxTurns: 1 },
            input: undefined,
            provider,
            runId: "run:apply-degenerate",
            task: descriptor,
        },
        runner,
        store,
    });
    await prepareRetainedWorldSettlement({
        action: "apply",
        binding,
        carrier,
        commandId: "settlement:apply-degenerate",
        output: captured.output,
        store,
    });

    store.interruptTerminal = true;
    await assert.rejects(
        applyRetainedWorldSettlement({
            binding,
            carrier,
            outputId: captured.output.output_id,
            store,
        }),
        RetainedWorldSettlementInvalidError,
    );
    assert.equal(
        store.readRetainedWorldSettlementJournal(captured.output.output_id)?.state,
        "applying",
    );
    assert.equal(await readFile(messagePath, "utf8"), "applied\n");
    store.close();
    using reopened = new SQLiteTraceStore(databasePath);
    const applied = await applyRetainedWorldSettlement({
        binding,
        carrier,
        outputId: captured.output.output_id,
        store: reopened,
    });

    assert.equal(applied.action, "apply");
    assert.equal(applied.state, "applied");
    assert.equal(applied.applied_revision_id, captured.output.head_revision_id);
    assert.equal(applied.plan_reason, applicationConfig.reasonRoles.unmoved);
    assert.equal(applied.plan_status, applicationConfig.statuses[0]);
    assert.equal(await readFile(messagePath, "utf8"), "applied\n");
    assert.throws(() => inspectRetainedWorldApplicationPlan(reopened, ""), TypeError);
    assert.equal(inspectRetainedWorldApplicationPlan(reopened, "world-output:absent"), undefined);
    assert.throws(
        () =>
            inspectRetainedWorldApplicationPlan(
                {
                    readRetainedWorldSettlementJournal: () => {
                        throw new TypeError("malformed application journal");
                    },
                } as never,
                captured.output.output_id,
            ),
        RetainedWorldSettlementInvalidError,
    );
    assert.throws(
        () =>
            inspectRetainedWorldApplicationPlan(
                {
                    readRetainedWorldSettlementJournal: () => {
                        throw new RetainedWorldSettlementInvalidError("invalid");
                    },
                } as never,
                captured.output.output_id,
            ),
        RetainedWorldSettlementInvalidError,
    );
    const otherRoot = path.join(workspaceRoot, "other");
    await mkdir(otherRoot);
    const otherBinding = createWorkspaceBindings({
        bindings: [{ name: "other", root: "other" }],
        workspaceRoot,
    }).bindings[0];
    assert.ok(otherBinding);
    await assert.rejects(
        applyRetainedWorldSettlement({
            binding: otherBinding,
            carrier,
            outputId: captured.output.output_id,
            store: reopened,
        }),
        RetainedWorldSettlementInvalidError,
    );
    for (const invalid of [
        null,
        [],
        {},
        { binding, carrier, outputId: captured.output.output_id, store: reopened, extra: true },
        { binding: { ...binding }, carrier, outputId: captured.output.output_id, store: reopened },
        { binding, carrier: { ...carrier }, outputId: captured.output.output_id, store: reopened },
        { binding, carrier, outputId: "", store: reopened },
        { binding, carrier, outputId: "world-output:absent", store: reopened },
    ]) {
        await assert.rejects(
            applyRetainedWorldSettlement(invalid as never),
            RetainedWorldSettlementInvalidError,
        );
    }
});

test("public apply refuses basis movement after durable planning and recovers exactly", async (context) => {
    const fixture = await createSingleFileApplyFixture(
        context,
        "basis-moved",
        (databasePath, messagePath) => new BasisMovedAfterApplyPlanStore(databasePath, messagePath),
    );

    await assert.rejects(
        applyRetainedWorldSettlement({
            binding: fixture.binding,
            carrier: fixture.carrier,
            outputId: fixture.outputId,
            store: fixture.store,
        }),
        RetainedWorldSettlementInvalidError,
    );
    assert.equal(
        fixture.store.readRetainedWorldSettlementJournal(fixture.outputId)?.state,
        "applying",
    );
    const retainedPlan = inspectRetainedWorldApplicationPlan(fixture.store, fixture.outputId);
    assert.ok(retainedPlan);
    assert.equal(Object.isFrozen(retainedPlan), true);
    assert.equal(await readFile(fixture.messagePath, "utf8"), "moved-after-plan\n");
    await writeFile(fixture.messagePath, "before\n");
    const recovered = await applyRetainedWorldSettlement({
        binding: fixture.binding,
        carrier: fixture.carrier,
        outputId: fixture.outputId,
        store: fixture.store,
    });
    assert.equal(recovered.state, "applied");
    assert.equal(await readFile(fixture.messagePath, "utf8"), "candidate\n");
});

test("concurrent apply callers converge on one plan, publication, and terminal receipt", async (context) => {
    const fixture = await createSingleFileApplyFixture(
        context,
        "concurrent",
        (databasePath) => new SQLiteTraceStore(databasePath),
    );
    using competing = new SQLiteTraceStore(fixture.databasePath);
    const options = {
        binding: fixture.binding,
        carrier: fixture.carrier,
        outputId: fixture.outputId,
    } as const;

    const [first, second] = await Promise.all([
        applyRetainedWorldSettlement({ ...options, store: fixture.store }),
        applyRetainedWorldSettlement({ ...options, store: competing }),
    ]);

    assert.deepEqual(first, second);
    assert.equal(await readFile(fixture.messagePath, "utf8"), "candidate\n");
    assert.equal(
        fixture.store.readRetainedWorldSettlementJournal(fixture.outputId)?.state,
        "applied",
    );
});

test("public apply repairs interrupted settlement citation after reopen", async (context) => {
    const fixture = await createSingleFileApplyFixture(
        context,
        "citation",
        (databasePath) => new InterruptedApplyCitationStore(databasePath),
    );
    fixture.store.interruptCitation = true;
    await assert.rejects(
        applyRetainedWorldSettlement({
            binding: fixture.binding,
            carrier: fixture.carrier,
            outputId: fixture.outputId,
            store: fixture.store,
        }),
        RetainedWorldSettlementInvalidError,
    );
    assert.equal(
        fixture.store.readRetainedWorldSettlementJournal(fixture.outputId)?.state,
        "applied",
    );
    fixture.store.close();
    using reopened = new SQLiteTraceStore(fixture.databasePath);
    const repaired = await applyRetainedWorldSettlement({
        binding: fixture.binding,
        carrier: fixture.carrier,
        outputId: fixture.outputId,
        store: reopened,
    });
    assert.equal(repaired.state, "applied");
    assert.equal(await readFile(fixture.messagePath, "utf8"), "candidate\n");
});

test("public apply recovers a carrier interruption after planned path writes", async (context) => {
    const fixture = await createSingleFileApplyFixture(
        context,
        "carrier-interruption",
        (databasePath) => new SQLiteTraceStore(databasePath),
    );
    const interruptedCarrier = createReferenceCopyCarrier({
        faultInjection: {
            classification: "capacity",
            phase: "selection-after-write",
            systemCode: "ENOSPC",
        },
        workspaceRoot: fixture.workspaceRoot,
    });
    await assert.rejects(
        applyRetainedWorldSettlement({
            binding: fixture.binding,
            carrier: interruptedCarrier,
            outputId: fixture.outputId,
            store: fixture.store,
        }),
        RetainedWorldSettlementInvalidError,
    );
    const applying = fixture.store.readRetainedWorldSettlementJournal(fixture.outputId);
    assert.equal(applying?.state, "applying");
    assert.equal(applying?.receipt, null);
    assert.equal(await readFile(fixture.messagePath, "utf8"), "candidate\n");
    const recovered = await applyRetainedWorldSettlement({
        binding: fixture.binding,
        carrier: fixture.carrier,
        outputId: fixture.outputId,
        store: fixture.store,
    });
    assert.equal(recovered.state, "applied");
});

test("public apply three-way merges disjoint candidate and current deltas", async (context) => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "shepherd-world-apply-disjoint-"));
    context.after(() => rm(workspaceRoot, { force: true, recursive: true }));
    initializeWorkspace({ adopt: "none", initializeGit: false, rootPath: workspaceRoot });
    const sourceRoot = path.join(workspaceRoot, "source");
    await mkdir(sourceRoot);
    const firstPath = path.join(sourceRoot, "a.txt");
    const secondPath = path.join(sourceRoot, "b.txt");
    await writeFile(firstPath, "before-a\n");
    await writeFile(secondPath, "before-b\n");
    const binding = createWorkspaceBindings({
        bindings: [{ name: "source", root: "source" }],
        workspaceRoot,
    }).bindings[0];
    assert.ok(binding);
    const carrier = createReferenceCopyCarrier({ workspaceRoot });
    const baseRevision = await carrier.snapshot(binding);
    const descriptor = task({
        input: schema.void(),
        instruction: "Produce one parallel candidate.",
        name: "apply-disjoint",
        output: schema.string(),
        version: "1",
    });
    const providerFor = (id: string) =>
        createStaticProvider({
            descriptor: { id, model: "offline-v1" },
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
    const runnerFor = (id: string, relativePath: string, text: string) =>
        createRetainedWorldRunner({
            enforcement: "advisory",
            runnerId: id,
            run: async (runnerContext) => {
                await runnerContext.world.writeText(relativePath, text);
                return executeTask(runnerContext.execution);
            },
        });
    const databasePath = path.join(workspaceRoot, "trace.sqlite");
    using store = new SQLiteTraceStore(databasePath);
    const first = await captureTaskWorldDurably({
        baseRevision,
        binding,
        captureId: "capture:apply-disjoint:a",
        carrier,
        execution: {
            budget: { maxTurns: 1 },
            input: undefined,
            provider: providerFor("apply-disjoint-provider-a"),
            runId: "run:apply-disjoint:a",
            task: descriptor,
        },
        runner: runnerFor("runner:apply-disjoint:a", "a.txt", "A\n"),
        store,
    });
    const second = await captureTaskWorldDurably({
        baseRevision,
        binding,
        captureId: "capture:apply-disjoint:b",
        carrier,
        execution: {
            budget: { maxTurns: 1 },
            input: undefined,
            provider: providerFor("apply-disjoint-provider-b"),
            runId: "run:apply-disjoint:b",
            task: descriptor,
        },
        runner: runnerFor("runner:apply-disjoint:b", "b.txt", "B\n"),
        store,
    });
    const conflicting = await captureTaskWorldDurably({
        baseRevision,
        binding,
        captureId: "capture:apply-disjoint:conflict",
        carrier,
        execution: {
            budget: { maxTurns: 1 },
            input: undefined,
            provider: providerFor("apply-disjoint-provider-conflict"),
            runId: "run:apply-disjoint:conflict",
            task: descriptor,
        },
        runner: runnerFor("runner:apply-disjoint:conflict", "a.txt", "conflict\n"),
        store,
    });
    await prepareRetainedWorldSettlement({
        action: "select",
        binding,
        carrier,
        commandId: "settlement:apply-disjoint:a",
        output: first.output,
        store,
    });
    await selectRetainedWorldSettlement({
        binding,
        carrier,
        outputId: first.output.output_id,
        store,
    });
    await assert.rejects(
        applyRetainedWorldSettlement({
            binding,
            carrier,
            outputId: first.output.output_id,
            store,
        }),
        RetainedWorldSettlementConflictError,
    );
    await prepareRetainedWorldSettlement({
        action: "apply",
        binding,
        carrier,
        commandId: "settlement:apply-disjoint:b",
        output: second.output,
        store,
    });

    const applied = await applyRetainedWorldSettlement({
        binding,
        carrier,
        outputId: second.output.output_id,
        store,
    });

    assert.notEqual(applied.applied_revision_id, second.output.head_revision_id);
    assert.equal(applied.plan_reason, applicationConfig.reasonRoles.disjoint);
    const applicationPlan = inspectRetainedWorldApplicationPlan(store, second.output.output_id);
    assert.ok(applicationPlan);
    await assert.rejects(
        carrier.openCustody(applicationPlan.application_custody_id),
        WorldCarrierError,
    );
    assert.equal(await readFile(firstPath, "utf8"), "A\n");
    assert.equal(await readFile(secondPath, "utf8"), "B\n");
    assert.deepEqual(
        await applyRetainedWorldSettlement({
            binding,
            carrier,
            outputId: second.output.output_id,
            store,
        }),
        applied,
    );
    assert.deepEqual(applyInChild(workspaceRoot, databasePath, second.output.output_id), applied);
    const inspected = inspectDurableTaskExecution(store, second.output.run_id).settlements[0];
    assert.ok(inspected);
    assert.equal(inspected.action, "apply");
    assert.equal(inspected.state, "applied");
    assert.equal(
        (JSON.parse(inspected.receipt.json) as Record<string, unknown>).application_plan_id,
        applied.application_plan_id,
    );
    await assert.rejects(
        selectRetainedWorldSettlement({
            binding,
            carrier,
            outputId: second.output.output_id,
            store,
        }),
        RetainedWorldSettlementConflictError,
    );
    await assert.rejects(
        discardRetainedWorldSettlement({
            carrier,
            outputId: second.output.output_id,
            store,
        }),
        RetainedWorldSettlementConflictError,
    );

    await assert.rejects(
        prepareRetainedWorldSettlement({
            action: "apply",
            binding,
            carrier,
            commandId: "settlement:apply-disjoint:conflict",
            output: conflicting.output,
            store,
        }),
        (error: unknown) => {
            assert.ok(error instanceof RetainedWorldApplicationConflictError);
            assert.deepEqual(error.evidence.conflicts, [
                {
                    candidate_path: "a.txt",
                    current_path: "a.txt",
                    kind: "equal-path",
                },
            ]);
            assert.equal(Object.isFrozen(error.evidence), true);
            return true;
        },
    );
    assert.equal(inspectRetainedWorldSettlement(store, conflicting.output.output_id), undefined);
    await prepareRetainedWorldSettlement({
        action: "discard",
        binding,
        carrier,
        commandId: "settlement:discard-disjoint:conflict",
        output: conflicting.output,
        store,
    });
    assert.equal(
        (
            await discardRetainedWorldSettlement({
                carrier,
                outputId: conflicting.output.output_id,
                store,
            })
        ).state,
        "discarded",
    );
    assert.equal(await readFile(firstPath, "utf8"), "A\n");
    assert.equal(await readFile(secondPath, "utf8"), "B\n");
});

async function createSingleFileApplyFixture<T extends SQLiteTraceStore>(
    context: { after: (callback: () => Promise<void>) => void },
    suffix: string,
    createStore: (databasePath: string, messagePath: string) => T,
): Promise<{
    readonly binding: NonNullable<ReturnType<typeof createWorkspaceBindings>["bindings"][number]>;
    readonly carrier: ReturnType<typeof createReferenceCopyCarrier>;
    readonly databasePath: string;
    readonly messagePath: string;
    readonly outputId: string;
    readonly store: T;
    readonly workspaceRoot: string;
}> {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), `shepherd-world-apply-${suffix}-`));
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
        instruction: "Produce a recoverable apply candidate.",
        name: `apply-${suffix}`,
        output: schema.string(),
        version: "1",
    });
    const runner = createRetainedWorldRunner({
        enforcement: "advisory",
        runnerId: `runner:apply-${suffix}`,
        run: async (runnerContext) => {
            await runnerContext.world.writeText("message.txt", "candidate\n");
            return executeTask(runnerContext.execution);
        },
    });
    const provider = createStaticProvider({
        descriptor: { id: `apply-${suffix}-provider`, model: "offline-v1" },
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
    const store = createStore(databasePath, messagePath);
    context.after(async () => store.close());
    const captured = await captureTaskWorldDurably({
        baseRevision,
        binding,
        captureId: `capture:apply-${suffix}`,
        carrier,
        execution: {
            budget: { maxTurns: 1 },
            input: undefined,
            provider,
            runId: `run:apply-${suffix}`,
            task: descriptor,
        },
        runner,
        store,
    });
    await prepareRetainedWorldSettlement({
        action: "apply",
        binding,
        carrier,
        commandId: `settlement:apply-${suffix}`,
        output: captured.output,
        store,
    });
    return {
        binding,
        carrier,
        databasePath,
        messagePath,
        outputId: captured.output.output_id,
        store,
        workspaceRoot,
    };
}

function applyInChild(
    workspaceRoot: string,
    databasePath: string,
    outputId: string,
): Record<string, unknown> {
    const source = `
        import {
            applyRetainedWorldSettlement,
            createReferenceCopyCarrier,
            createWorkspaceBindings,
            SQLiteTraceStore,
        } from "./src/index.ts";
        const [workspaceRoot, databasePath, outputId] = process.argv.slice(1);
        const binding = createWorkspaceBindings({
            bindings: [{ name: "source", root: "source" }],
            workspaceRoot,
        }).bindings[0];
        const carrier = createReferenceCopyCarrier({ workspaceRoot });
        using store = new SQLiteTraceStore(databasePath);
        const result = await applyRetainedWorldSettlement({
            binding,
            carrier,
            outputId,
            store,
        });
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
