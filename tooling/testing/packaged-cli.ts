import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { testEntryLoading } from "./entry-loading.ts";
import { testPackagedExamples } from "./packaged-examples.ts";

const repositoryRoot = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
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
    readonly files: readonly string[];
    readonly name: string;
};
const apiReferenceConfiguration = JSON.parse(
    readFileSync(path.join(repositoryRoot, "api-reference.config.json"), "utf8"),
) as { readonly artifact: string };
/**
 * Exercises the built package through a fresh archive installation and consumer project.
 *
 * @returns Nothing after every conformance assertion passes.
 * @throws {AssertionError} If build output or installed-package behavior differs from contract.
 * @throws {Error} If packaging, installation, filesystem access, or a consumer process fails.
 */
export function testPackagedCli(): void {
    assert.equal(existsSync(path.join(repositoryRoot, "dist", "scripts")), false);
    assert.equal(existsSync(path.join(repositoryRoot, "dist", "tooling")), false);
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
            [
                "install",
                "--prefix",
                installPath,
                archivePath,
                "--ignore-scripts",
                "--cache",
                cachePath,
            ],
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
        testPackagedExamples({ repositoryRoot, installedPackageRoot, consumerParent: installPath });
        testEntryLoading({ repositoryRoot, installedPackageRoot, consumerParent: installPath });
        for (const entry of Object.values(packageManifest.exports)) {
            for (const target of [entry.import, entry.types]) {
                assertPortableSourceMap(repositoryRoot, target, temporaryRoot);
                assertPortableSourceMap(installedPackageRoot, target, temporaryRoot);
            }
        }
        for (const artifact of Object.values(protocol.cli.artifacts)) {
            assert.equal(
                readFileSync(path.join(installedPackageRoot, artifact), "utf8"),
                readFileSync(path.join(repositoryRoot, artifact), "utf8"),
            );
        }
        assert.equal(packageManifest.files.includes(apiReferenceConfiguration.artifact), true);
        assert.equal(
            readFileSync(
                path.join(installedPackageRoot, apiReferenceConfiguration.artifact),
                "utf8",
            ),
            readFileSync(path.join(repositoryRoot, apiReferenceConfiguration.artifact), "utf8"),
        );
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
        const effectsFacadeProbe = path.join(consumerRoot, "effects-facade-probe.mjs");
        writeFileSync(
            effectsFacadeProbe,
            `import { EffectHandlerNotFoundError, createEffectHandlerStack, createEffectIntent, createEffectOutcome, validateEffectCorrelation } from ${JSON.stringify(`${packageManifest.name}/effects`)};
const intent = createEffectIntent({ effectId: "effect:facade", kind: "tool.call", payload: { command: "verify" }, reversibility: "irreversible" });
const success = createEffectOutcome(intent, { ok: true, value: { exitCode: 0 } });
const failure = createEffectOutcome(intent, { ok: false, error: { code: "denied" } });
validateEffectCorrelation(intent, success);
validateEffectCorrelation(intent, failure);
const handlers = createEffectHandlerStack([{ handlerId: "fallback", kind: "tool.call", handle: () => ({ ok: true, value: "fallback" }) }, { handlerId: "nearest", kind: "tool.call", handle: () => ({ ok: true, value: "nearest" }) }]);
const dispatch = await handlers.dispatch(intent);
let unhandled = false;
try { await handlers.dispatch(createEffectIntent({ effectId: "effect:unhandled", kind: "other", payload: null, reversibility: "reversible" })); } catch (error) { if (!(error instanceof EffectHandlerNotFoundError)) throw error; unhandled = error.effectId === "effect:unhandled" && error.kind === "other"; }
process.stdout.write(dispatch.handlerId + "\\n" + success.result.ok + "\\n" + failure.result.ok + "\\n" + unhandled + "\\n");
`,
        );
        assert.equal(
            execFileSync(process.execPath, [effectsFacadeProbe], {
                cwd: consumerRoot,
                encoding: "utf8",
            }),
            "nearest\ntrue\nfalse\ntrue\n",
        );
        const publicErrorProbe = path.join(consumerRoot, "public-error-probe.mjs");
        writeFileSync(
            publicErrorProbe,
            `import { isPublicError } from ${JSON.stringify(packageManifest.name)};
import { canonicalizeRecord } from ${JSON.stringify(`${packageManifest.name}/canonical`)};
import { EffectHandlerNotFoundError } from ${JSON.stringify(`${packageManifest.name}/effects`)};
import { StaticProviderExhaustedError } from ${JSON.stringify(`${packageManifest.name}/providers`)};
import { RunCancelledError } from ${JSON.stringify(`${packageManifest.name}/runs`)};
import { TaskRegistryError } from ${JSON.stringify(`${packageManifest.name}/tasks`)};
import { TraceStoreError } from ${JSON.stringify(`${packageManifest.name}/trace`)};
import { WorkspaceControlError } from ${JSON.stringify(`${packageManifest.name}/workspace`)};
const cause = new Error("private cause");
const errors = [new EffectHandlerNotFoundError("effect:missing", "tool.call"), new StaticProviderExhaustedError(0), new RunCancelledError("cancelled", cause), new TaskRegistryError("task"), new TraceStoreError("trace"), new WorkspaceControlError()];
const expected = ["EFFECT_HANDLER_NOT_FOUND", "STATIC_PROVIDER_EXHAUSTED", "RUN_CANCELLED", "TASK_REGISTRY_ERROR", "TRACE_STORE_ERROR", "WORKSPACE_CONTROL_ERROR"];
if (!errors.every((error, index) => isPublicError(error) && error.code === expected[index])) throw new Error("public error code mismatch");
if (errors[2].cause !== cause) throw new Error("public error cause mismatch");
let validationUnclassified = false;
try { canonicalizeRecord({ invalid: Infinity }); } catch (error) { validationUnclassified = error instanceof TypeError && !isPublicError(error); }
process.stdout.write(errors.map(({ code }) => code).join(",") + "\\n" + validationUnclassified + "\\n");
`,
        );
        assert.equal(
            execFileSync(process.execPath, [publicErrorProbe], {
                cwd: consumerRoot,
                encoding: "utf8",
            }),
            "EFFECT_HANDLER_NOT_FOUND,STATIC_PROVIDER_EXHAUSTED,RUN_CANCELLED,TASK_REGISTRY_ERROR,TRACE_STORE_ERROR,WORKSPACE_CONTROL_ERROR\ntrue\n",
        );
        const sourceMapProbe = path.join(consumerRoot, "source-map-probe.mjs");
        writeFileSync(
            sourceMapProbe,
            `import { createEffectHandlerStack, createEffectIntent } from ${JSON.stringify(`${packageManifest.name}/effects`)};
import { isPublicError } from ${JSON.stringify(packageManifest.name)};
const intent = createEffectIntent({ effectId: "effect:stack", kind: "tool.call", payload: null, reversibility: "reversible" });
let mappedStack = "";
try { await createEffectHandlerStack([]).dispatch(intent); } catch (error) { mappedStack = error instanceof Error ? error.stack ?? "" : ""; }
const privateCause = new Error("private validation cause");
const causeCarrier = new Error("public wrapper", { cause: privateCause });
let validationCausePreserved = false;
try { createEffectIntent({ effectId: "effect:invalid", kind: "tool.call", payload: { invalid: Infinity }, reversibility: "reversible" }); } catch (error) { validationCausePreserved = error instanceof TypeError && error.cause instanceof Error && !isPublicError(error); }
process.stdout.write(JSON.stringify({ causeIdentity: causeCarrier.cause === privateCause, mappedStack, validationCausePreserved }));
`,
        );
        const sourceMapResult = JSON.parse(
            execFileSync(process.execPath, ["--enable-source-maps", sourceMapProbe], {
                cwd: consumerRoot,
                encoding: "utf8",
            }),
        ) as {
            readonly causeIdentity: boolean;
            readonly mappedStack: string;
            readonly validationCausePreserved: boolean;
        };
        assert.equal(sourceMapResult.causeIdentity, true);
        assert.equal(sourceMapResult.validationCausePreserved, true);
        assert.match(
            sourceMapResult.mappedStack,
            /node_modules[\\/]@avnionur[\\/]shepherd-typescript[\\/]src[\\/]effect[\\/]handlers\.ts:\d+:\d+/u,
        );
        assert.doesNotMatch(
            sourceMapResult.mappedStack,
            /dist[\\/]src[\\/]effect[\\/]handlers\.js/u,
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
        const effectsTypeProbe = path.join(consumerRoot, "effects-facade-probe.ts");
        writeFileSync(
            effectsTypeProbe,
            `import { createEffectHandlerStack, createEffectIntent, type EffectHandler, type EffectHandlerDispatch, type EffectIntent, type EffectOutcome } from ${JSON.stringify(`${packageManifest.name}/effects`)};\nvoid createEffectHandlerStack; void createEffectIntent; const handler: EffectHandler | null = null; const dispatch: EffectHandlerDispatch | null = null; const intent: EffectIntent | null = null; const outcome: EffectOutcome | null = null; void handler; void dispatch; void intent; void outcome;\n`,
        );
        const publicErrorTypeProbe = path.join(consumerRoot, "public-error-probe.ts");
        writeFileSync(
            publicErrorTypeProbe,
            `import { isPublicError, type PublicError, type PublicErrorCode } from ${JSON.stringify(packageManifest.name)};\nvoid isPublicError; const error: PublicError | null = null; const code: PublicErrorCode | null = null; void error; void code;\n`,
        );
        const apiReferenceTypeProbe = path.join(consumerRoot, "api-reference-imports.ts");
        writeFileSync(
            apiReferenceTypeProbe,
            Object.keys(packageManifest.exports)
                .sort()
                .map((entry, index) => {
                    const moduleSpecifier =
                        entry === "."
                            ? packageManifest.name
                            : `${packageManifest.name}/${entry.slice(2)}`;
                    return `import * as Entry${index} from ${JSON.stringify(moduleSpecifier)}; void Entry${index};\n`;
                })
                .join(""),
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
                files: [
                    typeProbe,
                    workspaceTypeProbe,
                    effectsTypeProbe,
                    publicErrorTypeProbe,
                    apiReferenceTypeProbe,
                ],
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

function assertPortableSourceMap(packageRoot: string, target: string, temporaryRoot: string): void {
    const targetPath = path.join(packageRoot, target);
    const mapPath = `${targetPath}.map`;
    assert.equal(readFileSync(targetPath).byteLength > 0, true);
    const rawMap = readFileSync(mapPath, "utf8");
    assert.equal(rawMap.length > 0, true);
    assert.equal(rawMap.includes(repositoryRoot), false);
    assert.equal(rawMap.includes(temporaryRoot), false);
    const sourceMap = JSON.parse(rawMap) as {
        readonly file: string;
        readonly sourceRoot: string;
        readonly sources: readonly string[];
        readonly sourcesContent?: readonly string[];
        readonly version: number;
    };
    assert.equal(sourceMap.version, 3);
    assert.equal(sourceMap.file, path.basename(targetPath));
    assert.equal(sourceMap.sourceRoot, "");
    assert.equal(sourceMap.sources.length > 0, true);
    assert.equal(sourceMap.sourcesContent, undefined);
    for (const source of sourceMap.sources) {
        assert.equal(path.isAbsolute(source), false);
        assert.equal(source.includes("\\"), false);
        const resolved = path.resolve(path.dirname(mapPath), source);
        assert.equal(
            resolved === packageRoot || resolved.startsWith(`${packageRoot}${path.sep}`),
            true,
            `source map escapes package root: ${JSON.stringify({ packageRoot, resolved, source, target })}`,
        );
    }
}
