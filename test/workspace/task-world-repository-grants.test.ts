import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
    type AppendReceipt,
    captureGrantedTaskWorldDurably,
    captureTaskWorldDurably,
    createGitRepositoryBindings,
    createGitRepositoryGrantPlan,
    createReferenceCopyCarrier,
    createRetainedWorldRunner,
    createStaticProvider,
    createWorkspaceBindings,
    executeTask,
    grantTaskRepositories,
    initializeWorkspace,
    inspectTaskWorldCaptureJournal,
    recoverGrantedTaskWorldDurably,
    SQLiteTraceStore,
    type StoreAppendRequest,
    schema,
    task,
} from "../../src/index.ts";
import { workspaceProtocolConfig } from "../../src/protocol/config.ts";

const LEGACY_JOURNAL_SCHEMA_ID = workspaceProtocolConfig.worldTaskCapture.journalReaders[0]
    ?.schemaId as string;

class InterruptedBeforeGrantedClaimStore extends SQLiteTraceStore {
    override claimDurableExecutionInvocation(): never {
        throw new Error("interrupted before granted task-world claim");
    }
}

class InvalidGrantedJournalStore extends InterruptedBeforeGrantedClaimStore {
    readonly #invalidPlanId: number | string;

    constructor(invalidPlanId: number | string) {
        super();
        this.#invalidPlanId = invalidPlanId;
    }

    override append(request: StoreAppendRequest): AppendReceipt {
        return super.append({
            ...request,
            batch: {
                groups: request.batch.groups.map((group) => ({
                    ...group,
                    records: group.records.map((record) =>
                        (record.body as { capture_phase?: unknown }).capture_phase === "prepared"
                            ? {
                                  ...record,
                                  body: {
                                      ...record.body,
                                      repository_grant_plan_id: this.#invalidPlanId,
                                  },
                              }
                            : record,
                    ),
                })),
            },
        });
    }
}

class LegacyJournalStore extends InterruptedBeforeGrantedClaimStore {
    override append(request: StoreAppendRequest): AppendReceipt {
        return super.append({
            ...request,
            batch: {
                groups: request.batch.groups.map((group) => ({
                    ...group,
                    records: group.records.map((record) => {
                        const phase = (record.body as { capture_phase?: unknown }).capture_phase;
                        if (typeof phase !== "string") return record;
                        const {
                            placement_resolution: _removedPlacement,
                            placement_resolution_id: _removedPlacementId,
                            repository_grant_plan: _removedPlan,
                            repository_grant_plan_id: _removedPlanId,
                            ...body
                        } = record.body;
                        return {
                            ...record,
                            body: { ...body, journal_version: 9 },
                            schema_ref: LEGACY_JOURNAL_SCHEMA_ID,
                        };
                    }),
                })),
            },
        });
    }
}

class CrossPairedJournalStore extends InterruptedBeforeGrantedClaimStore {
    readonly #legacySchema: boolean;

    constructor(legacySchema: boolean) {
        super();
        this.#legacySchema = legacySchema;
    }

    override append(request: StoreAppendRequest): AppendReceipt {
        return super.append({
            ...request,
            batch: {
                groups: request.batch.groups.map((group) => ({
                    ...group,
                    records: group.records.map((record) => {
                        const phase = (record.body as { capture_phase?: unknown }).capture_phase;
                        if (typeof phase !== "string") return record;
                        if (this.#legacySchema) {
                            return { ...record, schema_ref: LEGACY_JOURNAL_SCHEMA_ID };
                        }
                        const {
                            placement_resolution: _removedPlacement,
                            placement_resolution_id: _removedPlacementId,
                            repository_grant_plan: _removedPlan,
                            repository_grant_plan_id: _removedPlanId,
                            ...body
                        } = record.body;
                        return { ...record, body: { ...body, journal_version: 9 } };
                    }),
                })),
            },
        });
    }
}

test("granted task-world execution enforces effective authority and exact recovery", async (context) => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "shepherd-task-world-grants-"));
    context.after(() => rm(workspaceRoot, { force: true, recursive: true }));
    initializeWorkspace({ adopt: "none", initializeGit: false, rootPath: workspaceRoot });
    const sourceRoot = path.join(workspaceRoot, "source");
    await mkdir(sourceRoot);
    execFileSync("git", ["init", "--quiet"], { cwd: sourceRoot });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: sourceRoot });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: sourceRoot });
    await writeFile(path.join(sourceRoot, "message.txt"), "before\n");
    execFileSync("git", ["add", "message.txt"], { cwd: sourceRoot });
    execFileSync("git", ["commit", "--quiet", "-m", "initial"], { cwd: sourceRoot });
    const docsRoot = path.join(workspaceRoot, "docs");
    await mkdir(docsRoot);
    execFileSync("git", ["init", "--quiet"], { cwd: docsRoot });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: docsRoot });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: docsRoot });
    await writeFile(path.join(docsRoot, "guide.txt"), "guide\n");
    execFileSync("git", ["add", "guide.txt"], { cwd: docsRoot });
    execFileSync("git", ["commit", "--quiet", "-m", "initial"], { cwd: docsRoot });
    const repositoryBindings = createGitRepositoryBindings({
        bindings: [
            { name: "source", root: "source" },
            { name: "docs", root: "docs" },
        ],
        workspaceRoot,
    });
    const binding = repositoryBindings.bindings.find(({ name }) => name === "source");
    const docsBinding = repositoryBindings.bindings.find(({ name }) => name === "docs");
    assert.ok(binding);
    assert.ok(docsBinding);
    const carrier = createReferenceCopyCarrier({ workspaceRoot });
    const baseRevision = await carrier.snapshot(binding);
    await mkdir(path.join(workspaceRoot, "ordinary"));
    const ordinaryBinding = createWorkspaceBindings({
        bindings: [{ name: "ordinary", root: "ordinary" }],
        workspaceRoot,
    }).bindings[0];
    assert.ok(ordinaryBinding);
    const descriptor = task({
        input: schema.void(),
        instruction: "Complete the repository task.",
        name: "granted-world",
        output: schema.string(),
        version: "1",
    });
    const granted = grantTaskRepositories({
        grants: [
            { binding: "source", profile: "read-write" },
            { binding: "docs", profile: "read-only" },
        ],
        task: descriptor,
    });
    const readonlyPlan = createGitRepositoryGrantPlan({
        authorityCeiling: "read-only",
        bindings: repositoryBindings.bindings,
        task: granted,
    });
    const writablePlan = createGitRepositoryGrantPlan({
        authorityCeiling: "read-write",
        bindings: repositoryBindings.bindings,
        task: granted,
    });
    const provider = createStaticProvider({
        descriptor: { id: "granted-provider", model: "offline-v1" },
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
    let runnerInvocations = 0;
    const runner = createRetainedWorldRunner({
        enforcement: "advisory",
        runnerId: "runner:granted-world",
        run: async (runnerContext) => {
            runnerInvocations += 1;
            assert.equal(await runnerContext.world.readText("message.txt"), "before\n");
            await assert.rejects(
                runnerContext.world.writeText("message.txt", "amplified\n"),
                /does not grant write/u,
            );
            await assert.rejects(runnerContext.world.readText(".git/config"), TypeError);
            return executeTask(runnerContext.execution);
        },
    });
    const storePath = path.join(workspaceRoot, "granted.sqlite");
    const interrupted = new InterruptedBeforeGrantedClaimStore(storePath);
    const captureOptions = {
        baseRevision,
        binding,
        captureId: "capture:granted",
        carrier,
        execution: {
            budget: { maxTurns: 1 },
            input: undefined,
            provider,
            runId: "run:granted",
            task: descriptor,
        },
        repositoryGrantPlan: readonlyPlan,
        runner,
        store: interrupted,
    } as const;

    const freshStorePath = path.join(workspaceRoot, "fresh-granted.sqlite");
    const freshInterrupted = new InterruptedBeforeGrantedClaimStore(freshStorePath);
    await assert.rejects(
        captureGrantedTaskWorldDurably({
            ...captureOptions,
            captureId: "capture:fresh-process-granted",
            execution: {
                ...captureOptions.execution,
                runId: "run:fresh-process-granted",
            },
            store: freshInterrupted,
        }),
        /interrupted before granted task-world claim/u,
    );
    freshInterrupted.close();
    assert.deepEqual(
        recoverGrantedInChild(
            workspaceRoot,
            freshStorePath,
            baseRevision.revision_id,
            readonlyPlan.plan_id,
        ),
        { planId: readonlyPlan.plan_id, status: "finished" },
    );
    using freshReopenedStore = new SQLiteTraceStore(freshStorePath);
    assert.equal(
        inspectTaskWorldCaptureJournal(freshReopenedStore, "run:fresh-process-granted").status,
        "retained",
    );

    using legacyJournalStore = new LegacyJournalStore();
    await assert.rejects(
        captureTaskWorldDurably({
            baseRevision,
            binding,
            captureId: "capture:legacy-journal",
            carrier,
            execution: {
                ...captureOptions.execution,
                runId: "run:legacy-journal",
            },
            runner,
            store: legacyJournalStore,
        }),
        /interrupted before granted task-world claim/u,
    );
    assert.equal(
        inspectTaskWorldCaptureJournal(legacyJournalStore, "run:legacy-journal").status,
        "forked",
    );
    assert.equal(runnerInvocations, 0);

    for (const [index, legacySchema] of [true, false].entries()) {
        using crossPairedStore = new CrossPairedJournalStore(legacySchema);
        const runId = `run:cross-paired-journal:${index}`;
        await assert.rejects(
            captureGrantedTaskWorldDurably({
                ...captureOptions,
                captureId: `capture:cross-paired-journal:${index}`,
                execution: { ...captureOptions.execution, runId },
                store: crossPairedStore,
            }),
            /interrupted before granted task-world claim/u,
        );
        assert.throws(
            () => inspectTaskWorldCaptureJournal(crossPairedStore, runId),
            (error: unknown) =>
                error instanceof Error &&
                error.cause instanceof TypeError &&
                /journal identity is inconsistent/u.test(error.cause.message),
        );
    }

    const docsBaseRevision = await carrier.snapshot(docsBinding);
    const docsProvider = createStaticProvider({
        descriptor: { id: "granted-provider", model: "offline-v1" },
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
    const docsRunner = createRetainedWorldRunner({
        enforcement: "advisory",
        runnerId: "runner:granted-docs",
        run: async (runnerContext) => {
            assert.equal(await runnerContext.world.readText("guide.txt"), "guide\n");
            await assert.rejects(
                runnerContext.world.writeText("guide.txt", "changed\n"),
                /does not grant write/u,
            );
            return executeTask(runnerContext.execution);
        },
    });
    using docsStore = new SQLiteTraceStore();
    const docsResult = await captureGrantedTaskWorldDurably({
        baseRevision: docsBaseRevision,
        binding: docsBinding,
        captureId: "capture:granted-docs",
        carrier,
        execution: {
            budget: { maxTurns: 1 },
            input: undefined,
            provider: docsProvider,
            runId: "run:granted-docs",
            task: descriptor,
        },
        repositoryGrantPlan: writablePlan,
        runner: docsRunner,
        store: docsStore,
    });
    assert.deepEqual(docsResult.changeset.changed_paths, []);

    const writableProvider = createStaticProvider({
        descriptor: { id: "granted-provider", model: "offline-v1" },
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
    const writableRunner = createRetainedWorldRunner({
        enforcement: "advisory",
        runnerId: "runner:granted-writable-source",
        run: async (runnerContext) => {
            await runnerContext.world.writeText("message.txt", "writable\n");
            return executeTask(runnerContext.execution);
        },
    });
    using writableStore = new SQLiteTraceStore();
    const writableResult = await captureGrantedTaskWorldDurably({
        baseRevision,
        binding,
        captureId: "capture:granted-writable-source",
        carrier,
        execution: {
            budget: { maxTurns: 1 },
            input: undefined,
            provider: writableProvider,
            runId: "run:granted-writable-source",
            task: descriptor,
        },
        repositoryGrantPlan: writablePlan,
        runner: writableRunner,
        store: writableStore,
    });
    assert.deepEqual(writableResult.changeset.changed_paths, ["message.txt"]);
    assert.equal(
        await readFile(
            path.join(
                (await carrier.openRevision(writableResult.output.head_revision_id)).path,
                "message.txt",
            ),
            "utf8",
        ),
        "writable\n",
    );

    using wrongBindingStore = new SQLiteTraceStore();
    await assert.rejects(
        captureGrantedTaskWorldDurably({
            ...captureOptions,
            binding: ordinaryBinding as never,
            captureId: "capture:ordinary-binding",
            execution: { ...captureOptions.execution, runId: "run:ordinary-binding" },
            store: wrongBindingStore,
        }),
        /requires an exact repository binding/u,
    );
    const reopenedBinding = createGitRepositoryBindings({
        bindings: [{ name: "source", root: "source" }],
        workspaceRoot,
    }).bindings[0];
    assert.ok(reopenedBinding);
    using mismatchedResourceStore = new SQLiteTraceStore();
    await assert.rejects(
        captureGrantedTaskWorldDurably({
            ...captureOptions,
            binding: reopenedBinding,
            captureId: "capture:mismatched-resource",
            execution: { ...captureOptions.execution, runId: "run:mismatched-resource" },
            store: mismatchedResourceStore,
        }),
        /invalid for the active resource/u,
    );
    const changedTask = task({
        input: schema.void(),
        instruction: "Use a changed task artifact.",
        name: "granted-world",
        output: schema.string(),
        version: "1",
    });
    using mismatchedTaskStore = new SQLiteTraceStore();
    await assert.rejects(
        captureGrantedTaskWorldDurably({
            ...captureOptions,
            captureId: "capture:mismatched-task",
            execution: {
                ...captureOptions.execution,
                runId: "run:mismatched-task",
                task: changedTask,
            },
            store: mismatchedTaskStore,
        }),
        /invalid for the task artifact/u,
    );

    using invalidJournalStore = new InvalidGrantedJournalStore(1);
    await assert.rejects(
        captureGrantedTaskWorldDurably({
            ...captureOptions,
            captureId: "capture:invalid-grant-journal",
            execution: { ...captureOptions.execution, runId: "run:invalid-grant-journal" },
            store: invalidJournalStore,
        }),
        /interrupted before granted task-world claim/u,
    );
    assert.throws(
        () => inspectTaskWorldCaptureJournal(invalidJournalStore, "run:invalid-grant-journal"),
        (error: unknown) =>
            error instanceof Error &&
            error.cause instanceof TypeError &&
            /prepared grant plan is invalid/u.test(error.cause.message),
    );
    assert.equal(runnerInvocations, 0);
    using emptyPlanIdStore = new InvalidGrantedJournalStore("");
    await assert.rejects(
        captureGrantedTaskWorldDurably({
            ...captureOptions,
            captureId: "capture:empty-plan-id",
            execution: { ...captureOptions.execution, runId: "run:empty-plan-id" },
            store: emptyPlanIdStore,
        }),
        /interrupted before granted task-world claim/u,
    );
    assert.throws(
        () => inspectTaskWorldCaptureJournal(emptyPlanIdStore, "run:empty-plan-id"),
        (error: unknown) =>
            error instanceof Error &&
            error.cause instanceof TypeError &&
            /prepared grant plan is invalid/u.test(error.cause.message),
    );

    await assert.rejects(
        captureGrantedTaskWorldDurably(captureOptions),
        /interrupted before granted task-world claim/u,
    );
    assert.equal(runnerInvocations, 0);
    const prepared = inspectTaskWorldCaptureJournal(interrupted, "run:granted").transitions[0];
    assert.equal(prepared?.body.journal_version, 10);
    assert.equal(
        prepared === undefined
            ? undefined
            : interrupted.readRecord(prepared.record_id)?.envelope.schema_ref,
        "https://avnionur.github.io/shepherd-typescript/schemas/world-capture-journal-v2.schema.json",
    );
    assert.equal(prepared?.body.repository_grant_plan_id, readonlyPlan.plan_id);
    assert.deepEqual(prepared?.body.repository_grant_plan, readonlyPlan);
    interrupted.close();

    using store = new SQLiteTraceStore(storePath);
    await assert.rejects(
        recoverGrantedTaskWorldDurably({
            ...captureOptions,
            commandId: "command:changed-grant-plan",
            repositoryGrantPlan: writablePlan,
            store,
        }),
        /recovery contract differs/u,
    );
    assert.equal(runnerInvocations, 0);

    const result = await recoverGrantedTaskWorldDurably({
        ...captureOptions,
        commandId: "command:exact-grant-plan",
        store,
    });
    assert.equal(result.execution.outcome.outcome.status, "finished");
    assert.equal(runnerInvocations, 1);
    assert.deepEqual(result.changeset.changed_paths, []);

    using forgedStore = new SQLiteTraceStore();
    await assert.rejects(
        captureGrantedTaskWorldDurably({
            ...captureOptions,
            captureId: "capture:forged-plan",
            execution: { ...captureOptions.execution, runId: "run:forged-plan" },
            repositoryGrantPlan: { ...readonlyPlan },
            store: forgedStore,
        }),
        TypeError,
    );
    assert.equal(runnerInvocations, 1);

    await rename(path.join(sourceRoot, ".git"), path.join(sourceRoot, ".git-replaced"));
    execFileSync("git", ["init", "--quiet"], { cwd: sourceRoot });
    using staleResourceStore = new SQLiteTraceStore();
    await assert.rejects(
        captureGrantedTaskWorldDurably({
            ...captureOptions,
            captureId: "capture:stale-resource",
            execution: { ...captureOptions.execution, runId: "run:stale-resource" },
            store: staleResourceStore,
        }),
    );
    assert.equal(runnerInvocations, 1);
});

function recoverGrantedInChild(
    workspaceRoot: string,
    storePath: string,
    baseRevisionId: string,
    expectedPlanId: string,
): { readonly planId: string; readonly status: string } {
    const source = `
        import {
            createGitRepositoryBindings,
            createGitRepositoryGrantPlan,
            createReferenceCopyCarrier,
            createRetainedWorldRunner,
            createStaticProvider,
            executeTask,
            grantTaskRepositories,
            recoverGrantedTaskWorldDurably,
            schema,
            SQLiteTraceStore,
            task,
        } from "./src/index.ts";
        const [workspaceRoot, storePath, baseRevisionId] = process.argv.slice(1);
        const resources = createGitRepositoryBindings({
            bindings: [
                { name: "source", root: "source" },
                { name: "docs", root: "docs" },
            ],
            workspaceRoot,
        });
        const binding = resources.bindings.find(({ name }) => name === "source");
        const descriptor = task({
            input: schema.void(),
            instruction: "Complete the repository task.",
            name: "granted-world",
            output: schema.string(),
            version: "1",
        });
        const granted = grantTaskRepositories({
            grants: [
                { binding: "source", profile: "read-write" },
                { binding: "docs", profile: "read-only" },
            ],
            task: descriptor,
        });
        const repositoryGrantPlan = createGitRepositoryGrantPlan({
            authorityCeiling: "read-only",
            bindings: resources.bindings,
            task: granted,
        });
        const provider = createStaticProvider({
            descriptor: { id: "granted-provider", model: "offline-v1" },
            exchanges: [{
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
            }],
        });
        const runner = createRetainedWorldRunner({
            enforcement: "advisory",
            runnerId: "runner:granted-world",
            run: async (context) => {
                await context.world.writeText("message.txt", "invalid\\n").then(
                    () => { throw new Error("read-only grant amplified"); },
                    () => undefined,
                );
                return executeTask(context.execution);
            },
        });
        const carrier = createReferenceCopyCarrier({ workspaceRoot });
        const baseRevision = await carrier.openRevision(baseRevisionId);
        using store = new SQLiteTraceStore(storePath);
        const result = await recoverGrantedTaskWorldDurably({
            baseRevision,
            binding,
            captureId: "capture:fresh-process-granted",
            carrier,
            commandId: "command:fresh-process-granted",
            execution: {
                budget: { maxTurns: 1 },
                input: undefined,
                provider,
                runId: "run:fresh-process-granted",
                task: descriptor,
            },
            repositoryGrantPlan,
            runner,
            store,
        });
        console.log(JSON.stringify({
            planId: repositoryGrantPlan.plan_id,
            status: result.execution.outcome.outcome.status,
        }));
    `;
    const output = execFileSync(
        process.execPath,
        ["--input-type=module", "-e", source, workspaceRoot, storePath, baseRevisionId],
        { cwd: process.cwd(), encoding: "utf8" },
    );
    const parsed = JSON.parse(output) as { readonly planId: string; readonly status: string };
    assert.equal(parsed.planId, expectedPlanId);
    return parsed;
}
