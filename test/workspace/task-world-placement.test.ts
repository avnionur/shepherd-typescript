import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { createRecordId, type SemanticRecord } from "../../src/canonical/canonical-record.ts";
import {
    type AppendReceipt,
    capturePlacedGrantedTaskWorldDurably,
    createGitRepositoryBindings,
    createGitRepositoryGrantPlan,
    createGrantedPlacementResolution,
    createPlacementPlatformEvidence,
    createReferenceCopyCarrier,
    createRetainedWorldRunner,
    createStaticProvider,
    executeTask,
    type GrantedPlacementResolution,
    grantTaskRepositories,
    initializeWorkspace,
    inspectLocalPlacementPlatformEvidence,
    inspectTaskWorldCaptureJournal,
    recoverPlacedGrantedTaskWorldDurably,
    SQLiteTraceStore,
    type StoreAppendRequest,
    schema,
    task,
} from "../../src/index.ts";

class InterruptedBeforePlacementClaimStore extends SQLiteTraceStore {
    override claimDurableExecutionInvocation(): never {
        throw new Error("interrupted before placed task-world claim");
    }
}

class InvalidPlacementJournalStore extends InterruptedBeforePlacementClaimStore {
    readonly #mode: "id" | "missing-grant" | "null-placement";

    constructor(mode: "id" | "missing-grant" | "null-placement") {
        super();
        this.#mode = mode;
    }

    override append(request: StoreAppendRequest): AppendReceipt {
        return super.append({
            ...request,
            batch: {
                groups: request.batch.groups.map((group) => ({
                    ...group,
                    records: group.records.map((record) => {
                        if (
                            (record.body as { capture_phase?: unknown }).capture_phase !==
                            "prepared"
                        ) {
                            return record;
                        }
                        if (this.#mode === "missing-grant") {
                            return {
                                ...record,
                                body: {
                                    ...record.body,
                                    repository_grant_plan: null,
                                    repository_grant_plan_id: null,
                                },
                            };
                        }
                        if (this.#mode === "null-placement") {
                            return {
                                ...record,
                                body: { ...record.body, placement_resolution: null },
                            };
                        }
                        return {
                            ...record,
                            body: { ...record.body, placement_resolution_id: "" },
                        };
                    }),
                })),
            },
        });
    }
}

class SubstitutedPlacementJournalStore extends InterruptedBeforePlacementClaimStore {
    readonly #replacement: GrantedPlacementResolution;

    constructor(replacement: GrantedPlacementResolution) {
        super();
        this.#replacement = replacement;
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
                                      placement_resolution: this.#replacement,
                                      placement_resolution_id: this.#replacement.resolution_id,
                                  },
                              }
                            : record,
                    ),
                })),
            },
        });
    }
}

test("placed granted capture retains visible auto fallback before runner execution", async (context) => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "shepherd-task-world-placement-"));
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
    const binding = createGitRepositoryBindings({
        bindings: [{ name: "source", root: "source" }],
        workspaceRoot,
    }).bindings[0];
    assert.ok(binding);
    const carrier = createReferenceCopyCarrier({ workspaceRoot });
    const baseRevision = await carrier.snapshot(binding);
    const descriptor = task({
        input: schema.void(),
        instruction: "Execute with visible placement.",
        name: "placed-capture",
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
    const platform = inspectLocalPlacementPlatformEvidence();
    const provider = createStaticProvider({
        descriptor: { id: "placed-provider", model: "offline-v1" },
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
    const storePath = path.join(workspaceRoot, "placement.sqlite");
    using store = new SQLiteTraceStore(storePath);
    let placementResolution: GrantedPlacementResolution;
    let runnerInvocations = 0;
    const runner = createRetainedWorldRunner({
        enforcement: "advisory",
        runnerId: "runner:placed-capture",
        run: async (runnerContext) => {
            runnerInvocations += 1;
            const prepared = inspectTaskWorldCaptureJournal(store, "run:placed-capture")
                .transitions[0];
            assert.deepEqual(prepared?.body.placement_resolution, placementResolution);
            assert.equal(prepared?.body.journal_version, 11);
            assert.equal(
                prepared === undefined
                    ? undefined
                    : store.readRecord(prepared.record_id)?.envelope.schema_ref,
                "https://avnionur.github.io/shepherd-typescript/schemas/world-capture-journal-v3.schema.json",
            );
            await runnerContext.world.writeText("message.txt", "placed\n");
            return executeTask(runnerContext.execution);
        },
    });
    placementResolution = createGrantedPlacementResolution({
        captureId: "capture:placed-capture",
        placement: "auto",
        platform,
        repositoryGrantPlan,
        runId: "run:placed-capture",
        runner,
    });

    await assert.rejects(
        capturePlacedGrantedTaskWorldDurably({
            baseRevision,
            binding,
            captureId: "capture:placed-capture",
            carrier,
            execution: {
                budget: { maxTurns: 1 },
                input: undefined,
                provider,
                runId: "run:placed-capture",
                task: descriptor,
            },
            placementResolution: { ...placementResolution },
            repositoryGrantPlan,
            runner,
            store,
        } as never),
        TypeError,
    );
    assert.equal(runnerInvocations, 0);
    assert.deepEqual(store.readOwner("run:placed-capture"), []);

    for (const [index, mode] of (["id", "missing-grant", "null-placement"] as const).entries()) {
        const captureId = `capture:invalid-placement-journal:${index}`;
        const runId = `run:invalid-placement-journal:${index}`;
        const invalidJournalResolution = createGrantedPlacementResolution({
            captureId,
            placement: "auto",
            platform,
            repositoryGrantPlan,
            runId,
            runner,
        });
        using invalidJournalStore = new InvalidPlacementJournalStore(mode);
        await assert.rejects(
            capturePlacedGrantedTaskWorldDurably({
                baseRevision,
                binding,
                captureId,
                carrier,
                execution: {
                    budget: { maxTurns: 1 },
                    input: undefined,
                    provider,
                    runId,
                    task: descriptor,
                },
                placementResolution: invalidJournalResolution,
                repositoryGrantPlan,
                runner,
                store: invalidJournalStore,
            }),
            /interrupted before placed task-world claim/u,
        );
        assert.throws(
            () => inspectTaskWorldCaptureJournal(invalidJournalStore, runId),
            (error: unknown) =>
                error instanceof Error &&
                error.cause instanceof TypeError &&
                /prepared placement is invalid/u.test(error.cause.message),
        );
    }
    assert.equal(runnerInvocations, 0);

    const alternatePlan = createGitRepositoryGrantPlan({
        authorityCeiling: "read-only",
        bindings: [binding],
        task: granted,
    });
    const alternateRunner = createRetainedWorldRunner({
        enforcement: "advisory",
        runnerId: "runner:placement-substitute",
        run: async () => {
            throw new Error("substituted placement runner must not be invoked");
        },
    });
    for (const [index, mismatch] of ["capture", "run", "runner", "plan", "task"].entries()) {
        const captureId = `capture:placement-substitution:${index}`;
        const runId = `run:placement-substitution:${index}`;
        const exact = createGrantedPlacementResolution({
            captureId,
            placement: "auto",
            platform,
            repositoryGrantPlan,
            runId,
            runner,
        });
        const replacement =
            mismatch === "capture"
                ? createGrantedPlacementResolution({
                      captureId: `${captureId}:other`,
                      placement: "auto",
                      platform,
                      repositoryGrantPlan,
                      runId,
                      runner,
                  })
                : mismatch === "run"
                  ? createGrantedPlacementResolution({
                        captureId,
                        placement: "auto",
                        platform,
                        repositoryGrantPlan,
                        runId: `${runId}:other`,
                        runner,
                    })
                  : mismatch === "runner"
                    ? createGrantedPlacementResolution({
                          captureId,
                          placement: "auto",
                          platform,
                          repositoryGrantPlan,
                          runId,
                          runner: alternateRunner,
                      })
                    : mismatch === "plan"
                      ? createGrantedPlacementResolution({
                            captureId,
                            placement: "auto",
                            platform,
                            repositoryGrantPlan: alternatePlan,
                            runId,
                            runner,
                        })
                      : alterPlacementTaskDigest(exact);
        using substitutedStore = new SubstitutedPlacementJournalStore(replacement);
        await assert.rejects(
            capturePlacedGrantedTaskWorldDurably({
                baseRevision,
                binding,
                captureId,
                carrier,
                execution: {
                    budget: { maxTurns: 1 },
                    input: undefined,
                    provider,
                    runId,
                    task: descriptor,
                },
                placementResolution: exact,
                repositoryGrantPlan,
                runner,
                store: substitutedStore,
            }),
            /interrupted before placed task-world claim/u,
        );
        assert.throws(
            () => inspectTaskWorldCaptureJournal(substitutedStore, runId),
            (error: unknown) =>
                error instanceof Error &&
                error.cause instanceof TypeError &&
                /prepared placement is invalid/u.test(error.cause.message),
        );
    }
    assert.equal(runnerInvocations, 0);

    const result = await capturePlacedGrantedTaskWorldDurably({
        baseRevision,
        binding,
        captureId: "capture:placed-capture",
        carrier,
        execution: {
            budget: { maxTurns: 1 },
            input: undefined,
            provider,
            runId: "run:placed-capture",
            task: descriptor,
        },
        placementResolution,
        repositoryGrantPlan,
        runner,
        store,
    });

    assert.deepEqual(result.placement, placementResolution);
    assert.equal(result.placement.requested_placement, "auto");
    assert.equal(result.placement.resolved_placement, "advisory");
    assert.equal(result.placement.reason, "auto-fallback-unavailable");
    assert.deepEqual(result.changeset.changed_paths, ["message.txt"]);
    assert.equal(await readFile(path.join(sourceRoot, "message.txt"), "utf8"), "before\n");
    assert.equal(
        await readFile(
            path.join(
                (await carrier.openRevision(result.output.head_revision_id)).path,
                "message.txt",
            ),
            "utf8",
        ),
        "placed\n",
    );
    const changedPlacement = createGrantedPlacementResolution({
        captureId: "capture:placed-capture",
        placement: "advisory",
        platform,
        repositoryGrantPlan,
        runId: "run:placed-capture",
        runner,
    });
    await assert.rejects(
        recoverPlacedGrantedTaskWorldDurably({
            baseRevision,
            binding,
            captureId: "capture:placed-capture",
            carrier,
            commandId: "command:changed-placement",
            execution: {
                budget: { maxTurns: 1 },
                input: undefined,
                provider,
                runId: "run:placed-capture",
                task: descriptor,
            },
            placementResolution: changedPlacement,
            repositoryGrantPlan,
            runner,
            store,
        }),
        /recovery contract differs/u,
    );
    const changedPlatformResolution = createGrantedPlacementResolution({
        captureId: "capture:placed-capture",
        placement: "auto",
        platform: createPlacementPlatformEvidence({
            environmentVariables: ["WSL_DISTRO_NAME"],
            nodePlatform: "linux",
            osRelease: "microsoft-wsl2",
        }),
        repositoryGrantPlan,
        runId: "run:placed-capture",
        runner,
    });
    await assert.rejects(
        recoverPlacedGrantedTaskWorldDurably({
            baseRevision,
            binding,
            captureId: "capture:placed-capture",
            carrier,
            commandId: "command:changed-platform",
            execution: {
                budget: { maxTurns: 1 },
                input: undefined,
                provider,
                runId: "run:placed-capture",
                task: descriptor,
            },
            placementResolution: changedPlatformResolution,
            repositoryGrantPlan,
            runner,
            store,
        }),
        /local run admission authority/u,
    );
    const replayed = await recoverPlacedGrantedTaskWorldDurably({
        baseRevision,
        binding,
        captureId: "capture:placed-capture",
        carrier,
        commandId: "command:exact-placement",
        execution: {
            budget: { maxTurns: 1 },
            input: undefined,
            provider,
            runId: "run:placed-capture",
            task: descriptor,
        },
        placementResolution,
        repositoryGrantPlan,
        runner,
        store,
    });
    assert.deepEqual(replayed, result);
    assert.equal(runnerInvocations, 1);
    assert.deepEqual(
        recoverPlacedInChild(workspaceRoot, storePath, baseRevision.revision_id),
        placementResolution,
    );
});

function alterPlacementTaskDigest(
    resolution: GrantedPlacementResolution,
): GrantedPlacementResolution {
    const { resolution_id: _resolutionId, ...semantic } = resolution;
    const altered = {
        ...semantic,
        task_artifact_digest: `sha256:${"f".repeat(64)}`,
    };
    const digest = createRecordId({
        placement_resolution: altered as unknown as SemanticRecord,
    });
    return {
        ...altered,
        resolution_id: `${resolution.resolution_id.slice(0, -64)}${digest.slice(-64)}`,
    };
}

function recoverPlacedInChild(
    workspaceRoot: string,
    storePath: string,
    baseRevisionId: string,
): GrantedPlacementResolution {
    const source = `
        import {
            createGitRepositoryBindings,
            createGitRepositoryGrantPlan,
            createGrantedPlacementResolution,
            createReferenceCopyCarrier,
            createRetainedWorldRunner,
            createStaticProvider,
            grantTaskRepositories,
            inspectLocalPlacementPlatformEvidence,
            recoverPlacedGrantedTaskWorldDurably,
            schema,
            SQLiteTraceStore,
            task,
        } from "./src/index.ts";
        const [workspaceRoot, storePath, baseRevisionId] = process.argv.slice(1);
        const binding = createGitRepositoryBindings({
            bindings: [{ name: "source", root: "source" }],
            workspaceRoot,
        }).bindings[0];
        const descriptor = task({
            input: schema.void(),
            instruction: "Execute with visible placement.",
            name: "placed-capture",
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
        const platform = inspectLocalPlacementPlatformEvidence();
        const runner = createRetainedWorldRunner({
            enforcement: "advisory",
            runnerId: "runner:placed-capture",
            run: async () => { throw new Error("committed placement replay invoked runner"); },
        });
        const placementResolution = createGrantedPlacementResolution({
            captureId: "capture:placed-capture",
            placement: "auto",
            platform,
            repositoryGrantPlan,
            runId: "run:placed-capture",
            runner,
        });
        const provider = createStaticProvider({
            descriptor: { id: "placed-provider", model: "offline-v1" },
            exchanges: [],
        });
        const carrier = createReferenceCopyCarrier({ workspaceRoot });
        const baseRevision = await carrier.openRevision(baseRevisionId);
        using store = new SQLiteTraceStore(storePath);
        const result = await recoverPlacedGrantedTaskWorldDurably({
            baseRevision,
            binding,
            captureId: "capture:placed-capture",
            carrier,
            commandId: "command:fresh-process-placement",
            execution: {
                budget: { maxTurns: 1 },
                input: undefined,
                provider,
                runId: "run:placed-capture",
                task: descriptor,
            },
            placementResolution,
            repositoryGrantPlan,
            runner,
            store,
        });
        console.log(JSON.stringify(result.placement));
    `;
    return JSON.parse(
        execFileSync(
            process.execPath,
            ["--input-type=module", "-e", source, workspaceRoot, storePath, baseRevisionId],
            { cwd: process.cwd(), encoding: "utf8" },
        ),
    ) as GrantedPlacementResolution;
}
