import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const repositoryRoot = path.resolve(new URL("../", import.meta.url).pathname);
const protocol = JSON.parse(
    readFileSync(path.join(repositoryRoot, "protocol.config.json"), "utf8"),
) as {
    readonly cli: {
        readonly artifacts: {
            readonly commandReference: string;
            readonly jsonOutputSchema: string;
            readonly quickstartDemo: string;
        };
        readonly executableName: string;
        readonly executablePath: string;
        readonly groups: readonly { readonly name: string }[];
        readonly helpAliases: readonly string[];
        readonly machineOutput: {
            readonly compatibilityVersion: string;
            readonly version: number;
        };
        readonly options: { readonly json: string };
    };
};
const packageManifest = JSON.parse(
    readFileSync(path.join(repositoryRoot, "package.json"), "utf8"),
) as {
    readonly exports: Readonly<Record<string, { readonly import: string; readonly types: string }>>;
    readonly name: string;
};
const temporaryRoot = mkdtempSync(path.join(tmpdir(), "shepherd-packaged-cli-"));
const cachePath = path.join(temporaryRoot, "cache");
const installPath = path.join(temporaryRoot, "install");
const packPath = path.join(temporaryRoot, "pack");
mkdirSync(cachePath);
mkdirSync(installPath);
mkdirSync(packPath);

try {
    const helpAlias = protocol.cli.helpAliases[0];
    assert.ok(helpAlias);
    assertStableJsonHelp(process.execPath, [
        path.join(repositoryRoot, protocol.cli.executablePath),
        helpAlias,
        `--${protocol.cli.options.json}`,
    ]);
    const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";
    const archiveName = execFileSync(
        npmExecutable,
        ["pack", "--pack-destination", packPath, "--cache", cachePath],
        { cwd: repositoryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    const archivePath = path.join(packPath, archiveName);
    execFileSync(
        npmExecutable,
        ["install", "--prefix", installPath, archivePath, "--ignore-scripts", "--cache", cachePath],
        { cwd: repositoryRoot, stdio: "ignore" },
    );
    const executable = path.join(
        installPath,
        "node_modules",
        ".bin",
        process.platform === "win32"
            ? `${protocol.cli.executableName}.cmd`
            : protocol.cli.executableName,
    );
    const output = execFileSync(executable, [helpAlias], { encoding: "utf8" });
    assert.equal(
        output,
        `Usage: ${protocol.cli.executableName} <command> [options]\n\nCommands:\n${protocol.cli.groups.map(({ name }) => `  ${name}\n`).join("")}`,
    );
    assertStableJsonHelp(executable, [helpAlias, `--${protocol.cli.options.json}`]);
    const installedPackageRoot = path.join(
        installPath,
        "node_modules",
        ...packageManifest.name.split("/"),
    );
    for (const entry of Object.values(packageManifest.exports)) {
        for (const target of [entry.import, entry.types]) {
            const installedTarget = path.join(installedPackageRoot, target);
            assert.equal(readFileSync(installedTarget).byteLength > 0, true);
            assert.equal(readFileSync(`${installedTarget}.map`).byteLength > 0, true);
        }
    }
    for (const artifact of Object.values(protocol.cli.artifacts)) {
        assert.equal(
            readFileSync(path.join(installedPackageRoot, artifact), "utf8"),
            readFileSync(path.join(repositoryRoot, artifact), "utf8"),
        );
    }
    const consumerRoot = path.join(installPath, "quickstart-consumer");
    mkdirSync(consumerRoot);
    const facadeProbe = path.join(consumerRoot, "facade-probe.mjs");
    writeFileSync(
        facadeProbe,
        `import { canonicalizeRecord as rootCanonical, createStaticProvider as rootStatic, executeTask as rootExecuteTask, runCli as rootRunCli, SQLiteTraceStore as rootTrace, task as rootTask } from ${JSON.stringify(packageManifest.name)};\nimport { canonicalizeRecord } from ${JSON.stringify(`${packageManifest.name}/canonical`)};\nimport { runCli } from ${JSON.stringify(`${packageManifest.name}/cli`)};\nimport { createStaticProvider, StaticProviderRequestMismatchError } from ${JSON.stringify(`${packageManifest.name}/providers`)};\nimport { createRunControl, executeTask, executeTaskDurably, inspectDurableTaskExecution } from ${JSON.stringify(`${packageManifest.name}/runs`)};\nimport { listTaskLedger, resolveTaskLedgerSelector, schema, SQLiteTaskRegistry, task } from ${JSON.stringify(`${packageManifest.name}/tasks`)};\nimport { listTraceRevisions, resolveTraceRevisionSelector, ROOT_WITNESS_ID, SQLiteTraceStore } from ${JSON.stringify(`${packageManifest.name}/trace`)};\nif (canonicalizeRecord !== rootCanonical || createStaticProvider !== rootStatic || executeTask !== rootExecuteTask || runCli !== rootRunCli || SQLiteTraceStore !== rootTrace || task !== rootTask) throw new Error("facade mismatch");\nconst descriptor = task({ input: schema.string(), instruction: "Return input.", name: "facade-probe", output: schema.string(), version: "1" });\nusing registry = new SQLiteTaskRegistry();\nregistry.register(descriptor);\nconst entries = listTaskLedger(registry);\nconst exact = resolveTaskLedgerSelector(registry, descriptor.artifactLock.task_id + "@1");\nif (entries.length !== 1 || exact.artifact_lock.artifact_digest !== descriptor.artifactLock.artifact_digest) throw new Error("task facade mismatch");\nconst request = { input: "input", instruction: "Return input.", outputSchema: { type: "string" } };\nconst makeProvider = (id) => createStaticProvider({ descriptor: { id, model: "offline-v1" }, exchanges: [{ request, response: { output: "output", usage: { cacheCreationInputTokens: 0, cacheReadInputTokens: 0, costUsd: null, inputTokens: 1, outputTokens: 1 } } }] });\nconst provider = makeProvider("provider:facade");\ntry { await provider.invoke({ ...request, input: "mismatch" }, new AbortController().signal); throw new Error("mismatch accepted"); } catch (error) { if (!(error instanceof StaticProviderRequestMismatchError)) throw error; }\nconst response = await provider.invoke(request, new AbortController().signal);\nconst budgetControl = createRunControl({ budget: { maxTurns: 0 } });\nif (budgetControl.consume({ turns: 1 }).status !== "exhausted") throw new Error("run budget mismatch");\nbudgetControl.dispose();\nconst cancellation = new AbortController();\ncancellation.abort("consumer cancellation");\nconst cancellationControl = createRunControl({ budget: {}, signal: cancellation.signal });\nif (cancellationControl.snapshot().status !== "cancelled") throw new Error("run cancellation mismatch");\ncancellationControl.dispose();\nconst offline = await executeTask({ budget: { maxTurns: 1 }, input: "input", provider: makeProvider("provider:offline-run"), runId: "run:offline", task: descriptor });\nif (offline.outcome.outcome.status !== "finished") throw new Error("offline run facade mismatch");\nusing trace = new SQLiteTraceStore();\nconst recordId = trace.append({ append_intent_id: "append:facade", batch: { groups: [{ owner_id: "run:facade", records: [{ body: { phase: "facade" }, mode: "capture", schema_ref: "example.facade.v1", witness_ref: ROOT_WITNESS_ID }] }] } }).record_ids[0];\ntrace.publishCut({ cut_id: "cut:facade", target_owner_id: "run:facade", through_record_id: recordId });\nconst durable = await executeTaskDurably(trace, { budget: { maxTurns: 1 }, input: "input", provider: makeProvider("provider:durable-run"), runId: "run:durable", task: descriptor });\nconst inspection = inspectDurableTaskExecution(trace, "run:durable");\nif (durable.execution.outcome.outcome.status !== "finished" || inspection.status !== "committed") throw new Error("durable run facade mismatch");\nconst revisions = listTraceRevisions(trace);\nusing importedTrace = new SQLiteTraceStore();\nimportedTrace.importTrace(trace.exportTrace());\nif (revisions.length !== 2 || resolveTraceRevisionSelector(importedTrace, "cut:facade").cut.cut_id !== "cut:facade" || inspectDurableTaskExecution(importedTrace, "run:durable").status !== "committed") throw new Error("trace facade mismatch");\nprocess.stdout.write(canonicalizeRecord({ ready: true }) + "\\n" + entries.length + "\\n" + response.output + "\\n" + revisions.length + "\\n" + inspection.status + "\\n");\n`,
    );
    assert.equal(
        execFileSync(process.execPath, [facadeProbe], { cwd: consumerRoot, encoding: "utf8" }),
        '{"ready":true}\n1\noutput\n2\ncommitted\n',
    );
    const workspaceFacadeRoot = path.join(installPath, "workspace-facade-consumer");
    mkdirSync(workspaceFacadeRoot);
    const workspaceFacadeProbe = path.join(workspaceFacadeRoot, "workspace-facade-probe.mjs");
    writeFileSync(
        workspaceFacadeProbe,
        `import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createStaticProvider } from ${JSON.stringify(`${packageManifest.name}/providers`)};
import { executeTask } from ${JSON.stringify(`${packageManifest.name}/runs`)};
import { schema, task } from ${JSON.stringify(`${packageManifest.name}/tasks`)};
import { SQLiteTraceStore } from ${JSON.stringify(`${packageManifest.name}/trace`)};
import { captureTaskWorldDurably, createReferenceCopyCarrier, createRetainedWorldRunner, createWorkspaceBindings, createWorldChangesetInspection, initializeWorkspace, prepareRetainedWorldSettlement, selectRetainedWorldSettlement } from ${JSON.stringify(`${packageManifest.name}/workspace`)};
const outputPath = "WORKSPACE-FACADE.txt";
const outputText = "workspace facade output\\n";
const workspaceRoot = process.cwd();
const workspace = initializeWorkspace({ adopt: "none", initializeGit: false, rootPath: workspaceRoot });
const binding = createWorkspaceBindings({ bindings: [{ name: "workspace", root: "." }], workspaceRoot }).bindings[0];
if (binding === undefined) throw new Error("workspace binding is unavailable");
const carrier = createReferenceCopyCarrier({ workspaceRoot });
const baseRevision = await carrier.snapshot(binding);
const descriptor = task({ input: schema.void(), instruction: "Return the workspace facade result.", name: "workspace-facade", output: schema.string(), version: "1" });
const provider = createStaticProvider({ descriptor: { id: "provider:workspace-facade", model: "offline-v1" }, exchanges: [{ request: { input: null, instruction: descriptor.instruction, outputSchema: descriptor.artifact.output_schema }, response: { output: "complete", usage: { cacheCreationInputTokens: 0, cacheReadInputTokens: 0, costUsd: null, inputTokens: 1, outputTokens: 1 } } }] });
const runner = createRetainedWorldRunner({ enforcement: "advisory", runnerId: "runner:workspace-facade", run: async (context) => { await context.world.writeText(outputPath, outputText); return executeTask(context.execution); } });
using store = new SQLiteTraceStore(path.join(workspace.control_path, "workspace-facade-trace.sqlite"));
const captured = await captureTaskWorldDurably({ baseRevision, binding, captureId: "capture:workspace-facade", carrier, execution: { budget: { maxTurns: 1 }, input: undefined, provider, runId: "run:workspace-facade", task: descriptor }, runner, store });
if (existsSync(path.join(workspaceRoot, outputPath))) throw new Error("workspace changed before settlement");
const headRevision = await carrier.openRevision(captured.output.head_revision_id);
const inspection = await createWorldChangesetInspection({ baseRevision, carrier, headRevision });
const change = inspection.change(outputPath);
if (change?.after?.kind !== "file") throw new Error("retained output is unavailable");
const retained = await inspection.readContent({ contentId: change.after.content_id });
if (new TextDecoder().decode(retained.bytes) !== outputText) throw new Error("retained output differs");
await prepareRetainedWorldSettlement({ action: "select", binding, carrier, commandId: "settlement:workspace-facade", output: captured.output, store });
await selectRetainedWorldSettlement({ binding, carrier, outputId: captured.output.output_id, store });
process.stdout.write(readFileSync(path.join(workspaceRoot, outputPath), "utf8"));
`,
    );
    assert.equal(
        execFileSync(process.execPath, [workspaceFacadeProbe], {
            cwd: workspaceFacadeRoot,
            encoding: "utf8",
        }),
        "workspace facade output\n",
    );
    assert.throws(
        () =>
            execFileSync(
                process.execPath,
                [
                    "--input-type=commonjs",
                    "--eval",
                    `require(${JSON.stringify(packageManifest.name)})`,
                ],
                { cwd: consumerRoot, stdio: "pipe" },
            ),
        /ERR_PACKAGE_PATH_NOT_EXPORTED/u,
    );
    assert.throws(
        () =>
            execFileSync(
                process.execPath,
                [
                    "--input-type=module",
                    "--eval",
                    `import ${JSON.stringify(`${packageManifest.name}/dist/src/index.js`)}`,
                ],
                { cwd: consumerRoot, stdio: "pipe" },
            ),
        /ERR_PACKAGE_PATH_NOT_EXPORTED/u,
    );
    const typeProbe = path.join(consumerRoot, "facade-probe.ts");
    writeFileSync(
        typeProbe,
        `import { task } from ${JSON.stringify(packageManifest.name)};\nimport { canonicalizeRecord } from ${JSON.stringify(`${packageManifest.name}/canonical`)};\nimport { runCli, type CliIo } from ${JSON.stringify(`${packageManifest.name}/cli`)};\nimport { createStaticProvider, type ModelArtifactDefinition, type ModelUsage } from ${JSON.stringify(`${packageManifest.name}/providers`)};\nimport { createRunControl, executeTask, executeTaskDurably, type DurableTaskExecutionResult, type RunControl, type TaskExecutionResult } from ${JSON.stringify(`${packageManifest.name}/runs`)};\nimport { listTaskLedger, schema, SQLiteTaskRegistry, type TaskLedgerEntry } from ${JSON.stringify(`${packageManifest.name}/tasks`)};\nimport { listTraceRevisions, SQLiteTraceStore, type TraceRevisionEntry } from ${JSON.stringify(`${packageManifest.name}/trace`)};\nvoid task; void canonicalizeRecord; void runCli; void createStaticProvider; void createRunControl; void executeTask; void executeTaskDurably; void listTaskLedger; void schema; void SQLiteTaskRegistry; void listTraceRevisions; void SQLiteTraceStore; const io: CliIo | null = null; const entry: TaskLedgerEntry | null = null; const artifact: ModelArtifactDefinition | null = null; const usage: ModelUsage | null = null; const runControl: RunControl | null = null; const execution: TaskExecutionResult | null = null; const durable: DurableTaskExecutionResult | null = null; const revision: TraceRevisionEntry | null = null; void io; void entry; void artifact; void usage; void runControl; void execution; void durable; void revision;\n`,
    );
    const workspaceTypeProbe = path.join(consumerRoot, "workspace-facade-probe.ts");
    writeFileSync(
        workspaceTypeProbe,
        `import { captureTaskWorldDurably, createReferenceCopyCarrier, initializeWorkspace, prepareRetainedWorldSettlement, type RetainedWorldOutput, type TaskWorldCaptureResult, type WorkspaceState } from ${JSON.stringify(`${packageManifest.name}/workspace`)};\nvoid captureTaskWorldDurably; void createReferenceCopyCarrier; void initializeWorkspace; void prepareRetainedWorldSettlement; const workspace: WorkspaceState | null = null; const output: RetainedWorldOutput | null = null; const capture: TaskWorldCaptureResult | null = null; void workspace; void output; void capture;\n`,
    );
    const typeConfig = path.join(consumerRoot, "tsconfig.json");
    writeFileSync(
        typeConfig,
        JSON.stringify({
            compilerOptions: {
                lib: ["ESNext"],
                module: "NodeNext",
                moduleResolution: "NodeNext",
                noEmit: true,
                strict: true,
                target: "ESNext",
                typeRoots: [path.join(repositoryRoot, "node_modules", "@types")],
                types: ["node"],
            },
            files: [typeProbe, workspaceTypeProbe],
        }),
    );
    execFileSync(
        path.join(
            repositoryRoot,
            "node_modules",
            ".bin",
            process.platform === "win32" ? "tsc.cmd" : "tsc",
        ),
        ["--project", typeConfig],
        { cwd: consumerRoot, stdio: "pipe" },
    );
    const quickstartSource = execFileSync(executable, ["demo", "write", "quickstart"], {
        encoding: "utf8",
    });
    assert.equal(
        quickstartSource,
        readFileSync(path.join(repositoryRoot, protocol.cli.artifacts.quickstartDemo), "utf8"),
    );
    const quickstartPath = path.join(consumerRoot, "quickstart.mjs");
    writeFileSync(quickstartPath, quickstartSource);
    const quickstartOutput = execFileSync(process.execPath, [quickstartPath], {
        cwd: consumerRoot,
        encoding: "utf8",
    });
    assert.equal(quickstartOutput, "['NOTE.txt']\nHello from a Shepherd retained output.\n");
    assert.equal(
        readFileSync(path.join(consumerRoot, "NOTE.txt"), "utf8"),
        "Hello from a Shepherd retained output.\n",
    );
    const traceStorePath = path.join(consumerRoot, ".vcscore", "quickstart-trace.sqlite");
    const run = invokeJson(executable, [
        "run",
        "show",
        "run:quickstart",
        "--store",
        traceStorePath,
    ]);
    assert.equal(run.result.run?.run_id, "run:quickstart");
    assert.equal(run.result.run?.inspection.status, "committed");
    const citations = invokeJson(executable, [
        "run",
        "output-citations",
        "--store",
        traceStorePath,
    ]);
    assert.equal(citations.result.output_citations?.length, 1);
    assert.equal(citations.result.output_citations?.[0]?.run_id, "run:quickstart");
    const outputs = invokeJson(executable, ["run", "outputs", "--store", traceStorePath]);
    assert.equal(outputs.result.outputs?.[0]?.run_id, "run:quickstart");
    const outputId = outputs.result.outputs?.[0]?.output.output_id;
    assert.equal(typeof outputId, "string");
    const changeset = invokeJson(executable, [
        "run",
        "changeset",
        outputId as string,
        "--store",
        traceStorePath,
        "--workspace",
        consumerRoot,
    ]);
    assert.deepEqual(
        changeset.result.changeset?.page.changes.map(({ path: changedPath }) => changedPath),
        ["NOTE.txt"],
    );
    const retainedText = execFileSync(
        executable,
        [
            "run",
            "changeset",
            outputId as string,
            "--read",
            "NOTE.txt",
            "--store",
            traceStorePath,
            "--workspace",
            consumerRoot,
        ],
        { encoding: "utf8" },
    );
    assert.equal(retainedText, "Hello from a Shepherd retained output.\n");
    const vcsCore = invokeJson(executable, [
        "run",
        "vcscore",
        outputId as string,
        "--store",
        traceStorePath,
    ]);
    assert.equal(vcsCore.result.vcscore?.output.output_id, outputId);
    const publication = invokeJson(executable, [
        "run",
        "publish-retained-workspace-output",
        "run:quickstart",
        "--store",
        traceStorePath,
    ]);
    assert.equal(publication.result.publication?.output.output_id, outputId);
    const traces = invokeJson(executable, ["run", "trace", "--store", traceStorePath]);
    assert.equal((traces.result.trace_revisions?.length ?? 0) > 0, true);
    const traceRevisions = invokeJson(executable, [
        "run",
        "trace-revision",
        "--store",
        traceStorePath,
    ]);
    assert.deepEqual(traceRevisions.result.trace_revisions, traces.result.trace_revisions);
} finally {
    rmSync(temporaryRoot, { force: true, recursive: true });
}

function invokeJson(executable: string, args: readonly string[]): InstalledJsonEnvelope {
    return JSON.parse(
        execFileSync(executable, [...args, `--${protocol.cli.options.json}`], {
            encoding: "utf8",
        }),
    );
}

type InstalledJsonEnvelope = {
    readonly result: {
        readonly changeset?: {
            readonly page: { readonly changes: readonly { readonly path: string }[] };
        };
        readonly output_citations?: readonly { readonly run_id: string }[];
        readonly publication?: { readonly output: { readonly output_id: string } };
        readonly outputs?: readonly {
            readonly output: { readonly output_id: string };
            readonly run_id: string;
        }[];
        readonly run?: {
            readonly inspection: { readonly status: string };
            readonly run_id: string;
        };
        readonly trace_revisions?: readonly unknown[];
        readonly vcscore?: { readonly output: { readonly output_id: string } };
    };
};

function assertStableJsonHelp(executable: string, args: readonly string[]): void {
    const jsonOutput = execFileSync(executable, args, { encoding: "utf8" });
    assert.deepEqual(JSON.parse(jsonOutput), {
        cli_compatibility_version: protocol.cli.machineOutput.compatibilityVersion,
        cli_output_version: protocol.cli.machineOutput.version,
        command: [],
        ok: true,
        result: { groups: protocol.cli.groups.map(({ name }) => name) },
    });
}
