import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { promisify } from "node:util";

import {
    captureTaskWorldDurably,
    createReferenceCopyCarrier,
    createRetainedWorldRunner,
    createStaticProvider,
    createWorkspaceBindings,
    executeTask,
    executeTaskDurably,
    initializeWorkspace,
    ORPHAN_REPAIR_VERSIONS,
    runCli,
    SQLiteTaskRegistry,
    SQLiteTraceStore,
    schema,
    task,
} from "../../src/index.ts";

const execFileAsync = promisify(execFile);

test("CLI root help exposes the configured documented command groups without side effects", async () => {
    const output: string[] = [];
    const errors: string[] = [];
    const exitCode = await runCli(["--help"], {
        cwd: process.cwd(),
        stderr: (text) => errors.push(text),
        stdout: (text) => output.push(text),
    });

    assert.equal(exitCode, 0);
    assert.deepEqual(errors, []);
    assert.equal(
        output.join(""),
        "Usage: shepherd-ts <command> [options]\n\nCommands:\n  init\n  doctor\n  run\n  task\n  demo\n  package\n",
    );
    assert.equal((await invoke([])).output, output.join(""));
    assert.equal((await invoke(["-h"])).exitCode, 0);
});

test("CLI group help, usage errors, fenced commands, and source process exit codes are deterministic", async () => {
    assert.deepEqual(await invoke(["run", "--help"]), {
        errors: "",
        exitCode: 0,
        output: "Usage: shepherd-ts run <command> [options]\n\nCommands:\n  list\n  show\n  trace\n  output-citations\n  recovery-records\n  select\n  apply\n  release\n  discard\n  repair\n  start\n",
    });
    assert.equal((await invoke(["init", "--help"])).output, "Usage: shepherd-ts init [options]\n");
    assert.deepEqual(await invoke(["unknown"]), {
        errors: "unknown command: unknown\n",
        exitCode: 2,
        output: "",
    });
    assert.deepEqual(await invoke(["run"]), {
        errors: "missing or unknown run command\n",
        exitCode: 2,
        output: "",
    });
    assert.deepEqual(await invoke(["run", "start"]), {
        errors: "run start is fenced; use the public task execution APIs\n",
        exitCode: 3,
        output: "",
    });
    assert.match((await invoke(["demo", "write"])).errors, /offline quickstart fixture/u);
    assert.match((await invoke(["package", "init"])).errors, /extension scaffold/u);
    assert.match((await invoke(["task", "register"])).errors, /dynamic source modules/u);
    assert.equal((await invoke(["demo", "write", "extra"])).exitCode, 2);

    const processResult = await execFileAsync(process.execPath, [
        new URL("../../src/cli/main.ts", import.meta.url).pathname,
        "--help",
    ]);
    assert.match(processResult.stdout, /^Usage: shepherd-ts/u);
    assert.equal(processResult.stderr, "");
    await assert.rejects(
        execFileAsync(process.execPath, [
            new URL("../../src/cli/main.ts", import.meta.url).pathname,
            "unknown",
        ]),
        (error: NodeJS.ErrnoException & { code?: number; stderr?: string }) =>
            error.code === 2 && error.stderr === "unknown command: unknown\n",
    );
});

test("CLI init and doctor use bounded public workspace and diagnostic seams", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-cli-init-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const initialized = await invoke(["init", directory, "--adopt", "none", "--no-initialize-git"]);
    assert.equal(initialized.exitCode, 0);
    assert.match(initialized.output, /^Initialized /u);
    assert.equal(await fileExists(path.join(directory, ".git")), false);

    const doctor = await invoke(["doctor", "--workspace", directory], directory);
    assert.equal(doctor.exitCode, 0);
    assert.match(doctor.output, /Protocol: shepherd\.cli\.v1/u);
    assert.match(doctor.output, /Trace store: missing/u);
    assert.match(doctor.output, /Task registry: missing/u);
    assert.match(doctor.output, /Workspace: shepherd\.workspace/u);
    assert.match(doctor.output, /Native jail:/u);

    assert.equal((await invoke(["init", directory, "extra"])).exitCode, 2);
    assert.equal(
        (await invoke(["init", directory, "--initialize-git", "--no-initialize-git"])).exitCode,
        2,
    );
    assert.equal((await invoke(["init", directory, "--adopt", "invalid"])).exitCode, 2);
    const gitWorkspace = path.join(directory, "git-workspace");
    await mkdir(gitWorkspace);
    assert.equal((await invoke(["init", gitWorkspace, "--initialize-git"])).exitCode, 0);
    assert.equal(await fileExists(path.join(gitWorkspace, ".git")), true);
    const defaultWorkspace = path.join(directory, "default-workspace");
    await mkdir(defaultWorkspace);
    assert.equal((await invoke(["init"], defaultWorkspace)).exitCode, 0);
});

test("CLI task and run reads resolve real registry and trace evidence", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-cli-ledger-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const registryPath = path.join(directory, "tasks.sqlite");
    const storePath = path.join(directory, "trace.sqlite");
    const descriptor = task({
        input: schema.string(),
        instruction: "Return the CLI fixture input.",
        name: "cli-ledger",
        output: schema.string(),
        version: "1",
    });
    using registry = new SQLiteTaskRegistry(registryPath);
    registry.register(descriptor);
    using store = new SQLiteTraceStore(storePath);
    await executeTaskDurably(store, {
        budget: { maxTurns: 1 },
        input: "cli",
        provider: createStaticProvider({
            descriptor: { id: "provider:cli", model: "offline-v1" },
            exchanges: [
                {
                    request: {
                        input: "cli",
                        instruction: descriptor.instruction,
                        outputSchema: descriptor.artifact.output_schema,
                    },
                    response: {
                        output: "cli",
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
        }),
        runId: "run:cli",
        task: descriptor,
    });
    registry.close();
    store.close();

    const doctor = await invoke(
        ["doctor", "--store", storePath, "--registry", registryPath],
        directory,
    );
    assert.match(doctor.output, /Trace store: schema 8/u);
    assert.match(doctor.output, /Task registry: schema 1/u);

    const taskList = await invoke(["task", "list", "--registry", registryPath], directory);
    assert.equal(taskList.exitCode, 0);
    assert.match(taskList.output, new RegExp(`${descriptor.artifactLock.task_id}@1`, "u"));
    const taskShow = await invoke(
        ["task", "show", `${descriptor.artifactLock.task_id}@1`, "--registry", registryPath],
        directory,
    );
    assert.equal(taskShow.exitCode, 0);
    assert.match(taskShow.output, /Digest: sha256:/u);
    assert.equal(
        (await invoke(["task", "resolve", "@latest", "--registry", registryPath], directory))
            .exitCode,
        0,
    );

    assert.match(
        (await invoke(["run", "list", "--store", storePath], directory)).output,
        /run:cli\tcommitted/u,
    );
    assert.match(
        (await invoke(["run", "show", "run:cli", "--store", storePath], directory)).output,
        /Status: committed/u,
    );
    const traceList = await invoke(["run", "trace", "--store", storePath], directory);
    assert.match(traceList.output, /^sha256:/u);
    const cutId = traceList.output.split("\t")[0] as string;
    assert.match(
        (await invoke(["run", "trace", cutId, "--store", storePath], directory)).output,
        /Records:/u,
    );
    assert.equal(
        (await invoke(["run", "output-citations", "--store", storePath], directory)).output,
        "No output citations.\n",
    );
    assert.match(
        (await invoke(["run", "recovery-records", "--store", storePath], directory)).output,
        /run:cli\tcommitted/u,
    );
    assert.match(
        (
            await invoke(
                ["run", "list", "--store", storePath, "--limit", "1", "--offset", "0"],
                directory,
            )
        ).output,
        /run:cli/u,
    );
    assert.match(
        (await invoke(["run", "recovery-records", "run:cli", "--store", storePath], directory))
            .output,
        /Recovery: committed/u,
    );
    assert.equal(
        (await invoke(["run", "list", "--store", storePath, "--limit", "bad"], directory)).exitCode,
        2,
    );
    assert.equal(
        (await invoke(["run", "list", "--store", storePath, "--offset", "-1"], directory)).exitCode,
        2,
    );
});

test("CLI orphan repair uses exact diagnosis and globally idempotent commands", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-cli-repair-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const storePath = path.join(directory, "trace.sqlite");
    const store = new SQLiteTraceStore(storePath);
    store.recordOpenOperation({
        cause_record_id: null,
        operation_id: "operation:cli",
        operation_version: ORPHAN_REPAIR_VERSIONS.operation,
        owner_id: "run:cli-orphan",
        provider_call_started: false,
        retained_cause: "CLI repair fixture",
        scope_id: null,
        scope_owned: false,
        session_id: "session:cli",
    });
    store.recordOperationSessionDeath({
        death_evidence_id: "session-lock:cli",
        session_id: "session:cli",
    });
    store.close();

    const repaired = await invoke(
        ["run", "repair", "--store", storePath, "--command", "repair:cli"],
        directory,
    );
    assert.deepEqual(repaired, {
        errors: "",
        exitCode: 0,
        output: "Repaired 1 operation(s).\n",
    });
    using inspected = new SQLiteTraceStore(storePath);
    assert.equal(inspected.diagnoseOrphanedOperations().total_count, 0);
    inspected.close();
    assert.equal(
        (
            await invoke(
                ["run", "repair", "--store", storePath, "--command", "repair:cli-empty"],
                directory,
            )
        ).output,
        "Nothing to repair.\n",
    );
});

test("CLI exact settlement commands preserve public select/apply/release/discard authority", async (context) => {
    for (const action of ["select", "apply", "release", "discard"] as const) {
        const fixture = await createSettlementFixture(context, action);
        const citation = await invoke(
            ["run", "output-citations", fixture.outputId, "--store", fixture.storePath],
            fixture.workspaceRoot,
        );
        assert.match(citation.output, new RegExp(`Output: ${fixture.outputId}`, "u"));
        assert.match(
            (
                await invoke(
                    ["run", "output-citations", "--store", fixture.storePath],
                    fixture.workspaceRoot,
                )
            ).output,
            new RegExp(fixture.outputId, "u"),
        );
        if (action === "select") {
            const defaultBinding = await invoke(
                [
                    "run",
                    action,
                    fixture.outputId,
                    "--store",
                    fixture.storePath,
                    "--workspace",
                    fixture.workspaceRoot,
                    "--command",
                    "settlement:cli:default-binding",
                ],
                fixture.workspaceRoot,
            );
            assert.equal(defaultBinding.exitCode, 1);
            const prefix = await invoke(
                [
                    "run",
                    action,
                    fixture.outputId.slice(0, -1),
                    "--store",
                    fixture.storePath,
                    "--workspace",
                    fixture.workspaceRoot,
                    "--binding-name",
                    "source",
                    "--binding-root",
                    "source",
                    "--command",
                    "settlement:cli:prefix",
                ],
                fixture.workspaceRoot,
            );
            assert.equal(prefix.exitCode, 2);
            assert.match(prefix.errors, /exact output identity/u);
        }
        const result = await invoke(
            [
                "run",
                action,
                fixture.outputId,
                "--store",
                fixture.storePath,
                "--workspace",
                fixture.workspaceRoot,
                "--binding-name",
                "source",
                "--binding-root",
                "source",
                "--command",
                `settlement:cli:${action}`,
            ],
            fixture.workspaceRoot,
        );
        assert.equal(result.exitCode, 0, result.errors);
        assert.match(result.output, new RegExp(`^${action}: ${fixture.outputId}`, "u"));
        assert.equal(
            await readFile(fixture.messagePath, "utf8"),
            action === "select" || action === "apply" ? "candidate\n" : "before\n",
        );
    }
});

test("CLI validates options, paths, pagination, argument bounds, and I/O containers", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-cli-empty-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const storePath = path.join(directory, "trace.sqlite");
    const registryPath = path.join(directory, "tasks.sqlite");
    new SQLiteTraceStore(storePath).close();
    new SQLiteTaskRegistry(registryPath).close();
    const oldStorePath = path.join(directory, "old-trace.sqlite");
    new SQLiteTraceStore(oldStorePath).close();
    const oldStore = new DatabaseSync(oldStorePath);
    oldStore.prepare("DELETE FROM schema_migrations WHERE version = 8").run();
    oldStore.close();
    assert.equal((await invoke(["run", "list", "--store", oldStorePath], directory)).exitCode, 1);
    const unchangedOldStore = new DatabaseSync(oldStorePath);
    assert.equal(
        unchangedOldStore.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()
            ?.version,
        7,
    );
    unchangedOldStore.close();
    assert.equal(
        (await invoke(["run", "list", "--store", storePath], directory)).output,
        "No runs.\n",
    );
    assert.equal(
        (await invoke(["run", "trace", "--store", storePath], directory)).output,
        "No trace revisions.\n",
    );
    assert.equal(
        (await invoke(["run", "recovery-records", "--store", storePath], directory)).output,
        "No recovery records.\n",
    );
    assert.equal(
        (await invoke(["task", "list", "--registry", registryPath], directory)).output,
        "No tasks.\n",
    );
    assert.equal((await invoke(["run", "list"])).exitCode, 3);
    assert.equal((await invoke(["task", "list"])).exitCode, 3);
    assert.equal((await invoke(["doctor", "extra"])).exitCode, 2);
    assert.equal((await invoke(["run", "list", "--unknown", "x"])).exitCode, 2);
    assert.equal((await invoke(["run", "list", "--store"])).exitCode, 2);
    assert.equal(
        (await invoke(["run", "list", "--store", storePath, "--store", storePath], directory))
            .exitCode,
        2,
    );
    assert.equal((await invoke(["run", "list", "--limit", "0"])).exitCode, 2);
    assert.equal(
        (await invoke(["run", "list", "--store", storePath, "--limit", "101"], directory)).exitCode,
        2,
    );
    assert.equal((await invoke(["run", "repair", "--store", storePath], directory)).exitCode, 2);
    assert.equal(
        (await invoke(["init", directory, "--initialize-git", "--initialize-git"])).exitCode,
        2,
    );
    assert.equal((await invoke(["run", "show"])).exitCode, 2);
    assert.equal((await invoke(["task", "show", "a", "b"])).exitCode, 2);
    assert.equal(await runCli(null as never, captureIo()), 2);
    await assert.rejects(runCli([], null as never), TypeError);
    await assert.rejects(
        runCli([], { cwd: process.cwd(), stderr: null as never, stdout: () => undefined }),
        /I\/O is invalid/u,
    );
    assert.equal(
        await runCli(
            Array.from({ length: 65 }, () => "x"),
            captureIo(),
        ),
        2,
    );
    assert.equal(await runCli(["x".repeat(4_097)], captureIo()), 2);
    assert.equal(await runCli([1 as never], captureIo()), 2);
    const errors: string[] = [];
    const nonError = await runCli(["--help"], {
        cwd: process.cwd(),
        stderr: (text) => errors.push(text),
        stdout: () => {
            throw "non-error";
        },
    });
    assert.equal(nonError, 1);
    assert.deepEqual(errors, ["command failed\n"]);
});

test("CLI maps unexpected store failures to the configured failure exit without a stack", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-cli-failure-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const invalidStore = path.join(directory, "invalid.sqlite");
    await writeFile(invalidStore, "not sqlite");
    const result = await invoke(["run", "list", "--store", invalidStore], directory);
    assert.equal(result.exitCode, 1);
    assert.equal(result.output, "");
    assert.doesNotMatch(result.errors, /src\/|node:sqlite|at /u);
});

type Invocation = {
    readonly errors: string;
    readonly exitCode: number;
    readonly output: string;
};

async function invoke(args: readonly string[], cwd = process.cwd()): Promise<Invocation> {
    const output: string[] = [];
    const errors: string[] = [];
    const exitCode = await runCli(args, {
        cwd,
        stderr: (text) => errors.push(text),
        stdout: (text) => output.push(text),
    });
    return { errors: errors.join(""), exitCode, output: output.join("") };
}

function captureIo() {
    return {
        cwd: process.cwd(),
        stderr: () => undefined,
        stdout: () => undefined,
    };
}

async function fileExists(value: string): Promise<boolean> {
    try {
        await stat(value);
        return true;
    } catch {
        return false;
    }
}

async function createSettlementFixture(
    context: { after: (callback: () => Promise<void>) => void },
    action: "apply" | "discard" | "release" | "select",
): Promise<{
    readonly messagePath: string;
    readonly outputId: string;
    readonly storePath: string;
    readonly workspaceRoot: string;
}> {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), `shepherd-cli-settlement-${action}-`));
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
        instruction: "Return the CLI settlement fixture.",
        name: `cli-settlement-${action}`,
        output: schema.string(),
        version: "1",
    });
    const runner = createRetainedWorldRunner({
        enforcement: "advisory",
        runnerId: `runner:cli:${action}`,
        run: async (runnerContext) => {
            await runnerContext.world.writeText("message.txt", "candidate\n");
            return executeTask(runnerContext.execution);
        },
    });
    const provider = createStaticProvider({
        descriptor: { id: `provider:cli:${action}`, model: "offline-v1" },
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
    const storePath = path.join(workspaceRoot, "trace.sqlite");
    const store = new SQLiteTraceStore(storePath);
    const captured = await captureTaskWorldDurably({
        baseRevision,
        binding,
        captureId: `capture:cli:${action}`,
        carrier,
        execution: {
            budget: { maxTurns: 1 },
            input: undefined,
            provider,
            runId: `run:cli:${action}`,
            task: descriptor,
        },
        runner,
        store,
    });
    store.close();
    return { messagePath, outputId: captured.output.output_id, storePath, workspaceRoot };
}
