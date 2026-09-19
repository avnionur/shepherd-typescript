import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    statSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { testInstalledBundles } from "./bundles.ts";
import { testEntryLoading } from "./entry-loading.ts";
import { testPackagedExamples } from "./packaged-examples.ts";
import { testInstalledRuntimeBoundaries } from "./runtime-boundaries.ts";

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
        readonly exitCodes: { readonly failure: number };
        readonly options: { readonly json: string };
    };
    readonly kernel: { readonly store: { readonly schemaVersion: number } };
    readonly retention: { readonly redactedArchive: { readonly format: string } };
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
 * @param runtimeBoundaries - Require the configured additional Node boundary executables.
 * @returns A promise resolving after every conformance assertion passes.
 * @throws {AssertionError} If build output or installed-package behavior differs from contract.
 * @throws {Error} If packaging, installation, filesystem access, or a consumer process fails.
 */
export async function testPackagedCli(runtimeBoundaries = false): Promise<void> {
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
        testInstalledRuntimeBoundaries(
            repositoryRoot,
            installedPackageRoot,
            installPath,
            runtimeBoundaries,
        );
        testPackagedExamples({ repositoryRoot, installedPackageRoot, consumerParent: installPath });
        testEntryLoading({ repositoryRoot, installedPackageRoot, consumerParent: installPath });
        await testInstalledBundles({
            repositoryRoot,
            installedPackageRoot,
            consumerParent: installPath,
        });
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
        const operationsFacadeProbe = path.join(consumerRoot, "operations-facade-probe.mjs");
        writeFileSync(
            operationsFacadeProbe,
            `import { statSync } from "node:fs";
import { exportRedactedTraceArchive as rootExportRedactedTraceArchive, ROOT_WITNESS_ID } from ${JSON.stringify(packageManifest.name)};
import { RedactedTraceArchiveError, RETENTION_DATA_CLASSES, SECRET_SCANNING_MODES, TraceSecretDetectedError, classifyTraceSchema, exportRedactedTraceArchive, inspectTraceRetention, readRetentionPolicy, scanSemanticValueForSecrets, verifyRedactedTraceArchive } from ${JSON.stringify(`${packageManifest.name}/operations`)};
import { SQLiteTraceStore } from ${JSON.stringify(`${packageManifest.name}/trace`)};
if (exportRedactedTraceArchive !== rootExportRedactedTraceArchive) throw new Error("operations facade mismatch");
const secret = ["gh", "p_", "Q".repeat(36)].join("");
const databasePath = "operations-probe.sqlite";
const request = (body) => ({ append_intent_id: "operations:probe", batch: { groups: [{ owner_id: "operations", records: [{ body, mode: "capture", schema_ref: "operations.probe.v1", witness_ref: ROOT_WITNESS_ID }] }] } });
using store = new SQLiteTraceStore(databasePath, { secretScanning: SECRET_SCANNING_MODES[1] });
let refused = "";
try { store.append(request({ credential: secret })); } catch (error) { if (!(error instanceof TraceSecretDetectedError) || error.message.includes(secret) || JSON.stringify(error.findings).includes(secret)) throw error; refused = error.code + " " + error.findings[0].path; }
store.append(request({ credential: "redacted-by-caller" }));
const options = { schemaDataClasses: { "operations.probe.v1": RETENTION_DATA_CLASSES[3] } };
const redacted = exportRedactedTraceArchive(store, options);
const summary = verifyRedactedTraceArchive(redacted, options);
let importRefused = false;
using target = new SQLiteTraceStore();
try { target.importTrace(redacted); } catch (error) { importRefused = error instanceof RedactedTraceArchiveError && target.verifyIntegrity().ok; }
const report = inspectTraceRetention(store);
const policy = readRetentionPolicy();
if (scanSemanticValueForSecrets({ key: secret }).findings.length !== 1 || classifyTraceSchema("operations.probe.v1").data_class !== policy.default_data_class) throw new Error("scan or classification mismatch");
process.stdout.write(refused + "\\n" + summary.omitted_body_count + " " + importRefused + "\\n" + report.record_count + " " + report.secret_record_count + "\\n" + (statSync(databasePath).mode & 0o777).toString(8) + "\\n");
`,
        );
        assert.equal(
            execFileSync(process.execPath, [operationsFacadeProbe], {
                cwd: consumerRoot,
                encoding: "utf8",
            }),
            "TRACE_SECRET_DETECTED /batch/groups/0/records/0/body/credential\n1 true\n2 0\n600\n",
        );
        const telemetryFacadeProbe = path.join(consumerRoot, "telemetry-facade-probe.mjs");
        writeFileSync(
            telemetryFacadeProbe,
            `import { existsSync, readFileSync, statSync } from "node:fs";
import { createTraceTelemetryExporter as rootCreateTraceTelemetryExporter, ROOT_WITNESS_ID } from ${JSON.stringify(packageManifest.name)};
import { TELEMETRY_BODY_MODES, createJsonLinesTelemetrySink, createTraceTelemetryExporter, deriveTelemetryTraceId } from ${JSON.stringify(`${packageManifest.name}/operations`)};
import { SQLiteTraceStore } from ${JSON.stringify(`${packageManifest.name}/trace`)};
if (createTraceTelemetryExporter !== rootCreateTraceTelemetryExporter) throw new Error("telemetry facade mismatch");
using store = new SQLiteTraceStore();
store.append({ append_intent_id: "telemetry:probe", batch: { groups: [{ owner_id: "telemetry", records: [{ body: { note: "probe" }, mode: "capture", schema_ref: "telemetry.probe.v1", witness_ref: ROOT_WITNESS_ID }] }] } });
const before = store.exportTrace();
const exporter = createTraceTelemetryExporter({ bodies: TELEMETRY_BODY_MODES[1], clock: () => 1n, sink: createJsonLinesTelemetrySink({ logsPath: "telemetry-logs.jsonl", tracesPath: "telemetry-traces.jsonl" }), store, subscription: { owners: ["telemetry"] } });
const receipt = await exporter.exportPending();
exporter.close();
const [line] = readFileSync("telemetry-logs.jsonl", "utf8").trim().split("\\n").map((text) => JSON.parse(text));
const log = line.resourceLogs[0].scopeLogs[0].logRecords[0];
if (log.traceId !== deriveTelemetryTraceId("telemetry") || log.body.kvlistValue.values[0].value.stringValue !== "probe") throw new Error("telemetry mapping mismatch");
process.stdout.write(receipt.record_count + " " + existsSync("telemetry-traces.jsonl") + " " + (statSync("telemetry-logs.jsonl").mode & 0o777).toString(8) + " " + (store.exportTrace() === before) + " " + existsSync(${JSON.stringify(path.join(installedPackageRoot, "spec", "schemas", "telemetry-batch-v1.schema.json"))}) + "\\n");
`,
        );
        assert.equal(
            execFileSync(process.execPath, [telemetryFacadeProbe], {
                cwd: consumerRoot,
                encoding: "utf8",
            }),
            "1 false 600 true true\n",
        );
        const storageFacadeProbe = path.join(consumerRoot, "storage-facade-probe.mjs");
        writeFileSync(
            storageFacadeProbe,
            `import { mkdtempSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { createSQLiteStorageCoordinator as rootCreateSQLiteStorageCoordinator } from ${JSON.stringify(packageManifest.name)};
import { STORAGE_DURABILITIES, StorageBlobContentMismatchError, checkBlobStoreBackendConformance, checkStorageCoordinatorConformance, createFilesystemBlobStoreBackend, createMemoryBlobStoreBackend, createMemoryStorageCoordinator, createSQLiteStorageCoordinator } from ${JSON.stringify(`${packageManifest.name}/operations`)};
if (createSQLiteStorageCoordinator !== rootCreateSQLiteStorageCoordinator) throw new Error("storage facade mismatch");
const root = realpathSync(mkdtempSync("storage-probe-"));
let instance = 0;
const reports = [
    await checkBlobStoreBackendConformance(createMemoryBlobStoreBackend),
    await checkBlobStoreBackendConformance(() => createFilesystemBlobStoreBackend(path.join(root, "blobs-" + ++instance))),
    await checkStorageCoordinatorConformance(createMemoryStorageCoordinator),
    await checkStorageCoordinatorConformance(() => createSQLiteStorageCoordinator(path.join(root, "coordinator-" + ++instance + ".sqlite"))),
];
let mismatch = "";
try { await createMemoryBlobStoreBackend().put("sha256:" + "0".repeat(64), new Uint8Array([1])); } catch (error) { if (error instanceof StorageBlobContentMismatchError) mismatch = error.code; }
const coordinatorPath = path.join(root, "coordinator-" + instance + ".sqlite");
process.stdout.write(reports.map(({ passed, durability }) => passed + " " + STORAGE_DURABILITIES.includes(durability)).join("\\n") + "\\n" + mismatch + "\\n" + (statSync(coordinatorPath).mode & 0o777).toString(8) + "\\n");
`,
        );
        assert.equal(
            execFileSync(process.execPath, [storageFacadeProbe], {
                cwd: consumerRoot,
                encoding: "utf8",
            }),
            "true true\ntrue true\ntrue true\ntrue true\nSTORAGE_BLOB_CONTENT_MISMATCH\n600\n",
        );
        const backupFacadeProbe = path.join(consumerRoot, "backup-facade-probe.mjs");
        writeFileSync(
            backupFacadeProbe,
            `import { mkdtempSync, realpathSync } from "node:fs";
import path from "node:path";
import { backupTraceStore as rootBackupTraceStore } from ${JSON.stringify(packageManifest.name)};
import { STORE_BACKUP_FAILURE_REASONS, TraceStoreBackupError, backupTraceStore, createMemoryBlobStoreBackend, createMemoryStorageCoordinator, fetchReplicatedTraceStoreBackup, replicateTraceStoreBackup, restoreTraceStoreBackup, verifyTraceStoreBackup } from ${JSON.stringify(`${packageManifest.name}/operations`)};
import { SQLiteTraceStore } from ${JSON.stringify(`${packageManifest.name}/trace`)};
if (backupTraceStore !== rootBackupTraceStore) throw new Error("backup facade mismatch");
const root = realpathSync(mkdtempSync("backup-probe-"));
using store = new SQLiteTraceStore(path.join(root, "trace.sqlite"));
store.putBlob(new TextEncoder().encode("probe"));
const manifest = await backupTraceStore(store, { destination: path.join(root, "backup") });
const verified = await verifyTraceStoreBackup(path.join(root, "backup"), { expectedManifestId: manifest.manifest_id });
let interrupted = "";
try { await verifyTraceStoreBackup(root); } catch (error) { if (error instanceof TraceStoreBackupError) interrupted = error.reason; }
const backend = createMemoryBlobStoreBackend();
const coordinator = createMemoryStorageCoordinator();
const replica = await replicateTraceStoreBackup(path.join(root, "backup"), { backend, coordinator, expectedGeneration: 0, refName: "backups/probe" });
const fetched = await fetchReplicatedTraceStoreBackup({ backend, coordinator, destination: path.join(root, "fetched"), refName: "backups/probe" });
const receipt = await restoreTraceStoreBackup(path.join(root, "fetched"), path.join(root, "restored.sqlite"), { expectedManifestId: fetched.manifest.manifest_id });
process.stdout.write([verified.manifest.blobs.count, interrupted, STORE_BACKUP_FAILURE_REASONS.includes(interrupted), replica.swap.status, receipt.export_digest === manifest.export_digest].join(" ") + "\\n");
`,
        );
        assert.equal(
            execFileSync(process.execPath, [backupFacadeProbe], {
                cwd: consumerRoot,
                encoding: "utf8",
            }),
            "1 manifest-missing true swapped true\n",
        );
        const delegationFacadeProbe = path.join(consumerRoot, "delegation-facade-probe.mjs");
        writeFileSync(
            delegationFacadeProbe,
            `import { inspectChildRun as rootInspectChildRun, openChildRun as rootOpenChildRun, readTaskValue as rootReadTaskValue } from ${JSON.stringify(packageManifest.name)};
import { DELEGATION_STATUSES, acceptChildRunResult, inspectChildRun, openChildRun, projectChildRunResult, projectDelegationTree, readTaskValue, runChildRun, taskDescriptorOf, taskValueOf } from ${JSON.stringify(`${packageManifest.name}/delegation`)};
import { schema, task } from ${JSON.stringify(`${packageManifest.name}/tasks`)};
import { SQLiteTraceStore } from ${JSON.stringify(`${packageManifest.name}/trace`)};
if (inspectChildRun !== rootInspectChildRun || openChildRun !== rootOpenChildRun || readTaskValue !== rootReadTaskValue) throw new Error("delegation facade mismatch");
const descriptor = task({ input: schema.string(), instruction: "Echo the input.", name: "delegation-probe", output: schema.string(), version: "1" });
const value = readTaskValue(JSON.parse(JSON.stringify(taskValueOf(descriptor))));
if (taskDescriptorOf(value).artifactLock.artifact_digest !== descriptor.artifactLock.artifact_digest) throw new Error("task value round trip mismatch");
using store = new SQLiteTraceStore();
const { handle } = openChildRun(store, { budget: { maxTurns: 1 }, commandId: "delegate:probe", grant: [], input: "probe", parent: { budget: { maxTurns: 2 }, ceiling: [], kind: "root" }, provenance: { kind: "declared" }, supervisorId: "supervisor:probe", task: value });
const { inspection } = await runChildRun(store, { handle, program: ({ input }) => input + "!" });
if (inspection.status !== DELEGATION_STATUSES[2] || inspection.completion === null || inspection.child?.outcome?.outcome.outcome.value !== "probe!") throw new Error("child run mismatch");
acceptChildRunResult(store, { commandId: "accept:probe", handle, supervisorId: "supervisor:probe" });
const tree = projectDelegationTree(store, { kind: "supervisor", supervisorId: "supervisor:probe" });
if (tree.entries.length !== 1 || tree.entries[0].result.value !== "probe!" || projectChildRunResult(store, handle.handle_id, { schema: schema.string() }).value !== "probe!") throw new Error("projection mismatch");
process.stdout.write(inspection.status + "\\n" + inspection.depth + "\\n" + tree.entries[0].status + "\\n");
`,
        );
        assert.equal(
            execFileSync(process.execPath, [delegationFacadeProbe], {
                cwd: consumerRoot,
                encoding: "utf8",
            }),
            "settling\n1\naccepted\n",
        );
        const applicationsFacadeProbe = path.join(consumerRoot, "applications-facade-probe.mjs");
        writeFileSync(
            applicationsFacadeProbe,
            `import { readApplicationProtocol as rootReadApplicationProtocol, runCodingSupervisor as rootRunCodingSupervisor } from ${JSON.stringify(packageManifest.name)};
import { APPLICATION_KINDS, APPLICATION_SUPERVISION_POLICY_KINDS, applicationProtocolId, deriveApplicationOwnerId, inspectApplicationManifest, inspectCodingSupervisorRun, readApplicationProtocol, runCodingSupervisor, validateApplicationManifest } from ${JSON.stringify(`${packageManifest.name}/applications`)};
import { schema, task } from ${JSON.stringify(`${packageManifest.name}/tasks`)};
import { SQLiteTraceStore } from ${JSON.stringify(`${packageManifest.name}/trace`)};
if (readApplicationProtocol !== rootReadApplicationProtocol || runCodingSupervisor !== rootRunCodingSupervisor) throw new Error("applications facade mismatch");
const protocol = readApplicationProtocol({ budgets: { maxProviderCalls: 2, maxRounds: 4, maxTurnsPerWorker: 1 }, dataset: { id: "probe", items: ["file.txt"], revision: "1" }, kind: APPLICATION_KINDS[0], protocolVersion: "probe.v1", seeds: [1], surfaces: [{ content: "observe", id: "observe", kind: "prompt", role: "observation" }, { content: "act", id: "act", kind: "prompt", role: "action" }, { content: { type: "object" }, id: "observation-schema", kind: "schema", role: "observation" }, { content: { type: "object" }, id: "action-schema", kind: "schema", role: "action" }, { content: { name: "accept" }, id: "tool", kind: "tool", role: "action" }] });
const descriptor = task({ input: schema.object({ path: schema.string() }), instruction: "Edit the path.", name: "applications-probe", output: schema.object({ path: schema.string() }), version: "1" });
const worker = (workerId) => ({ budget: { maxTurns: 1 }, grant: [], input: { path: "file.txt" }, program: ({ input }) => input, task: descriptor, workerId });
using store = new SQLiteTraceStore();
const { manifest, inspection } = await runCodingSupervisor(store, { changedPaths: ({ output }) => [output.path], commandId: "application:probe", parent: { budget: { maxTurns: 2 }, ceiling: [], kind: "root" }, policy: ({ round }) => (round === 1 ? { kind: APPLICATION_SUPERVISION_POLICY_KINDS[0] } : { kind: "accept", worker_id: "a" }), protocol, supervisorId: "supervisor:probe", workers: [worker("a"), worker("b")] });
const applicationId = deriveApplicationOwnerId("application:probe");
if (manifest.protocol_id !== applicationProtocolId(protocol) || validateApplicationManifest(JSON.parse(JSON.stringify(manifest))).manifest_id !== manifest.manifest_id) throw new Error("manifest mismatch");
if (inspectApplicationManifest(store, applicationId).manifest.manifest_id !== manifest.manifest_id || inspectCodingSupervisorRun(store, applicationId).decisions.length !== inspection.decisions.length) throw new Error("inspection mismatch");
process.stdout.write(inspection.decisions.map((decision) => decision.decision.kind).join(",") + "\\n" + inspection.decisions[1].conflict.kind + "\\n" + inspection.workers.map((entry) => entry.attempts[0].status).join(",") + "\\n");
`,
        );
        assert.equal(
            execFileSync(process.execPath, [applicationsFacadeProbe], {
                cwd: consumerRoot,
                encoding: "utf8",
            }),
            "observe,accept\npath_overlap\naccepted,discarded\n",
        );
        const counterfactualProbe = path.join(consumerRoot, "counterfactual-probe.mjs");
        writeFileSync(
            counterfactualProbe,
            `import { runCounterfactualOptimization as rootRunCounterfactualOptimization } from ${JSON.stringify(packageManifest.name)};
import { APPLICATION_CRO_CANDIDATE_STATUSES, deriveApplicationOwnerId, inspectCounterfactualOptimization, readApplicationProtocol, runCounterfactualOptimization } from ${JSON.stringify(`${packageManifest.name}/applications`)};
import { createStaticProvider } from ${JSON.stringify(`${packageManifest.name}/providers`)};
import { SQLiteTraceStore } from ${JSON.stringify(`${packageManifest.name}/trace`)};
if (runCounterfactualOptimization !== rootRunCounterfactualOptimization) throw new Error("counterfactual facade mismatch");
const provider = (label) => ({ descriptor: createStaticProvider({ descriptor: { id: label, model: "probe" }, exchanges: [] }).descriptor, invoke: async (request) => ({ output: { text: label + ":" + request.input.stage }, usage: { cacheCreationInputTokens: 0, cacheReadInputTokens: 0, costUsd: null, inputTokens: 1, outputTokens: 1 } }) });
const request = (stage, prior) => ({ input: { prior, stage }, instruction: stage, outputSchema: { type: "object" } });
const program = async (context) => { const plan = await context.invokeProvider(request("plan", null)); await context.invokeProvider(request("aside", null), { dependsOn: [] }); const draft = await context.invokeProvider(request("draft", plan.response.output), { dependsOn: [plan.handle] }); return draft.response.output; };
const protocol = readApplicationProtocol({ budgets: { maxCandidates: 2, maxProviderCalls: 20, minPromotionScore: 1 }, dataset: { id: "probe", items: ["workflow"], revision: "1" }, kind: "counterfactual_optimization", protocolVersion: "probe.v1", seeds: [1], surfaces: [{ content: "propose", id: "propose", kind: "prompt", role: "proposer" }, { content: { name: "propose_candidate" }, id: "tool", kind: "tool", role: "proposer" }, { content: { type: "object" }, id: "reflection", kind: "schema", role: "reflection" }, { content: { type: "object" }, id: "handoff", kind: "schema", role: "handoff" }] });
using store = new SQLiteTraceStore();
const { inspection, manifest } = await runCounterfactualOptimization(store, { baseline: { program, programId: "probe.v1", provider: provider("base") }, baselines: ["full_replay"], candidates: [{ changes: ["provider"], name: "plan", provider: provider("alt"), stepIndex: 0 }, { changes: ["provider"], name: "aside", provider: provider("aside"), stepIndex: 1 }], claimId: "probe", commandId: "application:cro:probe", evaluate: ({ candidate }) => ({ passed: true, reason: "ok", score: candidate.name === "plan" ? 2 : 1 }), protocol });
if (inspectCounterfactualOptimization(store, deriveApplicationOwnerId("application:cro:probe")).promotion?.name !== "plan" || !APPLICATION_CRO_CANDIDATE_STATUSES.includes(inspection.promotion.status)) throw new Error("promotion mismatch");
process.stdout.write(inspection.candidates.map((candidate) => candidate.outcome.target.step_index + "/" + candidate.outcome.divergence.live_steps + "/" + candidate.outcome.baseline.provider_calls).join(",") + "\\n" + manifest.costs.provider_calls + "\\n");
`,
        );
        assert.equal(
            execFileSync(process.execPath, [counterfactualProbe], {
                cwd: consumerRoot,
                encoding: "utf8",
            }),
            "2/1/3,3/0/3\n10\n",
        );
        const compressionProbe = path.join(consumerRoot, "compression-probe.mjs");
        writeFileSync(
            compressionProbe,
            `import { runTrajectoryCompression as rootRunTrajectoryCompression } from ${JSON.stringify(packageManifest.name)};
import { APPLICATION_COMPRESSION_OUTCOMES, deriveApplicationOwnerId, inspectTrajectoryCompression, readApplicationProtocol, runTrajectoryCompression } from ${JSON.stringify(`${packageManifest.name}/applications`)};
import { createStaticProvider } from ${JSON.stringify(`${packageManifest.name}/providers`)};
import { schema, task } from ${JSON.stringify(`${packageManifest.name}/tasks`)};
import { SQLiteTraceStore } from ${JSON.stringify(`${packageManifest.name}/trace`)};
if (runTrajectoryCompression !== rootRunTrajectoryCompression) throw new Error("compression facade mismatch");
const provider = { descriptor: createStaticProvider({ descriptor: { id: "base", model: "probe" }, exchanges: [] }).descriptor, invoke: async (request) => ({ output: { text: "base:" + request.input.stage }, usage: { cacheCreationInputTokens: 0, cacheReadInputTokens: 0, costUsd: null, inputTokens: 1, outputTokens: 1 } }) };
const request = (stage) => ({ input: { stage }, instruction: stage, outputSchema: { type: "object" } });
const program = (guidance) => async (context) => { const plan = await context.invokeProvider(request("plan")); if (guidance === null || guidance.hint === null) await context.invokeProvider(request("explore"), { dependsOn: [plan.handle] }); const answer = await context.invokeProvider(request("answer"), { dependsOn: [plan.handle] }); return answer.response.output; };
const child = (name, run) => ({ budget: { maxTurns: 1 }, grant: [], program: run, task: task({ input: schema.object({ evidence: schema.string() }), instruction: name, name, output: schema.object({ result: schema.string() }), version: "1" }) });
const protocol = readApplicationProtocol({ budgets: { bestOfN: 1, maxProviderCalls: 20 }, dataset: { id: "probe", items: ["workflow"], revision: "1" }, kind: "trajectory_compression", protocolVersion: "probe.v1", seeds: [1], surfaces: [{ content: "compress", id: "compress", kind: "prompt", role: "compressor" }, { content: { type: "object" }, id: "fork-hint", kind: "schema", role: "compression" }, { content: "verify", id: "verify", kind: "prompt", role: "verifier" }] });
using store = new SQLiteTraceStore();
const { inspection, manifest } = await runTrajectoryCompression(store, { claimId: "probe", commandId: "application:compression:probe", compressor: child("compressor", ({ source }) => ({ result: JSON.stringify({ fork_point: { prefix_id: source.steps[0].prefix_id, session_id: source.session_id, step_index: 1 }, hint: { cited_step_indices: [1], text: "skip exploring" } }) })), parent: { budget: { maxTurns: 8 }, ceiling: [], kind: "root" }, protocol, supervisorId: "supervisor:probe", verifier: child("verifier", ({ compressed, original }) => ({ result: JSON.stringify({ reason: "same result", score: 1, verdict: JSON.stringify(compressed.terminal.result) === JSON.stringify(original.terminal.result) ? "accepted" : "rejected" }) })), workflow: { program, programId: "probe.v1", provider } });
if (inspectTrajectoryCompression(store, deriveApplicationOwnerId("application:compression:probe")).outcome.outcome !== APPLICATION_COMPRESSION_OUTCOMES[0]) throw new Error("outcome mismatch");
process.stdout.write(inspection.outcome.outcome + "\\n" + inspection.outcome.original_step_count + "/" + inspection.outcome.result_step_count + "\\n" + inspection.controls[0].outcome.verdict + "\\n" + manifest.costs.provider_calls + "\\n");
`,
        );
        assert.equal(
            execFileSync(process.execPath, [compressionProbe], {
                cwd: consumerRoot,
                encoding: "utf8",
            }),
            "pruned\n3/2\naccepted\n10\n",
        );
        const treeRlProbe = path.join(consumerRoot, "tree-rl-probe.mjs");
        writeFileSync(
            treeRlProbe,
            `import { runTreeRlRollouts as rootRunTreeRlRollouts } from ${JSON.stringify(packageManifest.name)};
import { APPLICATION_TREE_RL_BATCH_FORMATS, deriveApplicationOwnerId, exportTreeRlTrainingBatch, readApplicationProtocol, runTreeRlRollouts } from ${JSON.stringify(`${packageManifest.name}/applications`)};
import { createStaticProvider } from ${JSON.stringify(`${packageManifest.name}/providers`)};
import { runReplaySession } from ${JSON.stringify(`${packageManifest.name}/replay`)};
import { SQLiteTraceStore } from ${JSON.stringify(`${packageManifest.name}/trace`)};
if (runTreeRlRollouts !== rootRunTreeRlRollouts) throw new Error("tree-rl facade mismatch");
const provider = (label) => ({ descriptor: createStaticProvider({ descriptor: { id: label, model: "probe" }, exchanges: [] }).descriptor, invoke: async (request) => ({ output: { text: label + ":" + request.input.stage }, usage: { cacheCreationInputTokens: 0, cacheReadInputTokens: 0, costUsd: null, inputTokens: 1, outputTokens: 1 } }) });
const request = (stage) => ({ input: { stage }, instruction: stage, outputSchema: { type: "object" } });
const program = async (context) => { const plan = await context.invokeProvider(request("plan")); const answer = await context.invokeProvider(request("answer"), { dependsOn: [plan.handle] }); return answer.response.output; };
const protocol = readApplicationProtocol({ budgets: { branches: 2, maxForkPoints: 2, maxProviderCalls: 8, minDependents: 1 }, dataset: { id: "probe", items: ["workflow"], revision: "1" }, kind: "tree_rl", protocolVersion: "probe.v1", seeds: [1, 2], surfaces: [{ content: "continue", id: "rollout", kind: "prompt", role: "rollout" }, { content: { type: "object" }, id: "line", kind: "schema", role: "training_batch" }] });
using store = new SQLiteTraceStore();
const source = await runReplaySession(store, { claimId: "probe", commandId: "source:probe", program, programId: "probe.v1", provider: provider("base") });
const { batch, manifest } = await runTreeRlRollouts(store, { claimId: "probe", commandId: "application:tree-rl:probe", program, protocol, provider: ({ seed }) => provider("s" + seed), reward: ({ seed }) => seed, sourceSessionId: source.inspection.session_id });
using imported = new SQLiteTraceStore();
imported.importTrace(store.exportTrace());
if (exportTreeRlTrainingBatch(imported, deriveApplicationOwnerId("application:tree-rl:probe")).batch_digest !== batch.batch_digest || batch.format !== APPLICATION_TREE_RL_BATCH_FORMATS[0]) throw new Error("batch mismatch");
process.stdout.write(batch.line_count + "\\n" + batch.lines.map((line) => line.intra_branch_advantage).join(",") + "\\n" + batch.lines.map((line) => line.inter_branch_advantage).join(",") + "\\n" + manifest.costs.provider_calls + "\\n");
`,
        );
        assert.equal(
            execFileSync(process.execPath, [treeRlProbe], {
                cwd: consumerRoot,
                encoding: "utf8",
            }),
            "2\n-0.5,0.5\n0,0\n4\n",
        );
        const evaluationProbe = path.join(consumerRoot, "evaluation-probe.mjs");
        writeFileSync(
            evaluationProbe,
            `import { runApplicationEvaluation as rootRunApplicationEvaluation } from ${JSON.stringify(packageManifest.name)};
import { APPLICATION_EVALUATION_METRICS, compareApplicationBaseline, runApplicationEvaluation, validateApplicationEvaluationReport } from ${JSON.stringify(`${packageManifest.name}/applications`)};
import { createStaticProvider } from ${JSON.stringify(`${packageManifest.name}/providers`)};
import { SQLiteTraceStore } from ${JSON.stringify(`${packageManifest.name}/trace`)};
if (runApplicationEvaluation !== rootRunApplicationEvaluation) throw new Error("evaluation facade mismatch");
const provider = (label) => ({ descriptor: createStaticProvider({ descriptor: { id: label, model: "probe" }, exchanges: [] }).descriptor, invoke: async (request) => ({ output: { text: label + ":" + request.input.stage }, usage: { cacheCreationInputTokens: 0, cacheReadInputTokens: 0, costUsd: 0.5, inputTokens: 1, outputTokens: 1 } }) });
const request = (stage) => ({ input: { stage }, instruction: stage, outputSchema: { type: "object" } });
const program = async (context) => { const plan = await context.invokeProvider(request("plan")); const answer = await context.invokeProvider(request("answer"), { dependsOn: [plan.handle] }); return answer.response.output; };
const protocol = { budgets: { branches: 2, maxForkPoints: 2, maxProviderCalls: 8, minDependents: 1 }, dataset: { id: "probe", items: ["workflow"], revision: "1" }, kind: "tree_rl", protocolVersion: "probe.v1", seeds: [1, 2], surfaces: [{ content: "continue", id: "rollout", kind: "prompt", role: "rollout" }, { content: { type: "object" }, id: "line", kind: "schema", role: "training_batch" }] };
const definition = { evaluationId: "probe", experiments: [{ baseline: { kind: "single_rollout" }, commandId: "evaluation:probe", id: "tree-rl", protocol, sourceCommandId: "evaluation:probe:source" }], limitations: [{ id: "probe", text: "Synthetic probe." }], revision: "1" };
const bind = () => ({ kind: "tree_rl", options: { claimId: "probe", program, provider: ({ seed }) => provider("s" + seed), reward: ({ seed }) => seed }, source: { claimId: "probe", program, programId: "probe.v1", provider: provider("base") } });
using store = new SQLiteTraceStore();
const report = await runApplicationEvaluation(store, { bind, definition });
using other = new SQLiteTraceStore();
const again = await runApplicationEvaluation(other, { bind, definition });
if (again.report_id !== report.report_id || validateApplicationEvaluationReport(JSON.parse(JSON.stringify(report))).report_id !== report.report_id) throw new Error("report mismatch");
const values = compareApplicationBaseline(report.runs[0].metrics, report.baselines[0].metrics);
process.stdout.write(values.map((value) => value.metric + "=" + value.delta).join(",") + "\\n" + (values.length === APPLICATION_EVALUATION_METRICS.length) + "\\n");
`,
        );
        assert.equal(
            execFileSync(process.execPath, [evaluationProbe], {
                cwd: consumerRoot,
                encoding: "utf8",
            }),
            "cost_usd=1,provider_calls=2,input_tokens=2,output_tokens=2,steps=2,success=null\ntrue\n",
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
        const cutIterationProbe = path.join(consumerRoot, "cut-iteration.mts");
        writeFileSync(
            cutIterationProbe,
            `import assert from "node:assert/strict";
import { ROOT_WITNESS_ID, SQLiteTraceStore } from ${JSON.stringify(`${packageManifest.name}/trace`)};
import type { OwnerRecord } from ${JSON.stringify(`${packageManifest.name}/read`)};
using store = new SQLiteTraceStore();
const ids = store.append({ append_intent_id: "intent:iteration", batch: { groups: [{ owner_id: "run:iteration", records: ["first", "second", "first"].map(value => ({ body: { value }, mode: "capture" as const, schema_ref: "example.iteration.v1", witness_ref: ROOT_WITNESS_ID })) }] } }).record_ids;
store.publishCut({ cut_id: "cut:iteration", target_owner_id: "run:iteration", through_record_id: ids[2] });
const archive = store.exportTrace();
const iterator: AsyncGenerator<OwnerRecord, void, unknown> = store.iterateCutRecords("cut:iteration");
const values: unknown[] = [];
for await (const record of iterator) values.push(record.body.value);
assert.deepEqual(values, ["first", "second", "first"]);
assert.equal(store.exportTrace(), archive);
process.stdout.write(values.join(",") + "\\n");
`,
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
                    cutIterationProbe,
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
        assert.equal(
            execFileSync(process.execPath, [cutIterationProbe], {
                cwd: consumerRoot,
                encoding: "utf8",
            }),
            "first,second,first\n",
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
        const storeVerification = invokeJson(executable, [
            "store",
            "verify",
            "--store",
            traceStorePath,
        ]);
        assert.equal(
            storeVerification.result.store_verification?.schema_version,
            protocol.kernel.store.schemaVersion,
        );
        const backupPath = path.join(consumerRoot, "quickstart-backup");
        const backup = invokeJson(executable, [
            "store",
            "backup",
            "--store",
            traceStorePath,
            "--output",
            backupPath,
        ]);
        const manifestId = backup.result.backup?.manifest_id as string;
        assert.match(manifestId, /^sha256:[0-9a-f]{64}$/u);
        assert.equal((statSync(backupPath).mode & 0o777).toString(8), "700");
        assert.equal(
            (statSync(path.join(backupPath, "manifest.json")).mode & 0o777).toString(8),
            "600",
        );
        const backupVerification = invokeJson(executable, [
            "store",
            "verify",
            "--backup",
            backupPath,
            "--manifest",
            manifestId,
        ]);
        assert.equal(backupVerification.result.backup_verification?.manifest_id, manifestId);
        const restoredPath = path.join(consumerRoot, "restored-trace.sqlite");
        const restoreArgs = [
            "store",
            "restore",
            "--backup",
            backupPath,
            "--manifest",
            manifestId,
            "--store",
            restoredPath,
        ];
        const restored = invokeJson(executable, restoreArgs);
        assert.equal(restored.result.restore?.export_digest, backup.result.backup?.export_digest);
        assert.throws(
            () => execFileSync(executable, restoreArgs, { stdio: "pipe" }),
            (error: unknown) =>
                (error as { readonly status?: number }).status === protocol.cli.exitCodes.failure,
        );
        const tracePath = path.join(consumerRoot, "quickstart-archive.json");
        const sourceExport = invokeJson(executable, [
            "store",
            "export",
            "--store",
            traceStorePath,
            "--output",
            tracePath,
        ]);
        const redactedExport = invokeJson(executable, [
            "store",
            "export",
            "--store",
            traceStorePath,
            "--output",
            path.join(consumerRoot, "quickstart-redacted.json"),
            "--redacted",
        ]);
        assert.equal(
            redactedExport.result.export?.format,
            protocol.retention.redactedArchive.format,
        );
        const imported = invokeJson(executable, [
            "store",
            "import",
            "--store",
            path.join(consumerRoot, "imported-trace.sqlite"),
            "--input",
            tracePath,
        ]);
        assert.equal(
            imported.result.import?.imported_record_count,
            backup.result.backup?.record_count,
        );
        const maintained = invokeJson(executable, [
            "store",
            "maintain",
            "--store",
            path.join(consumerRoot, "imported-trace.sqlite"),
            "--mode",
            "vacuum",
        ]);
        assert.equal(maintained.result.maintenance?.quick_check.ok, true);
        assert.equal(maintained.result.maintenance?.after.wal_bytes, 0);
        const maintainedExport = invokeJson(executable, [
            "store",
            "export",
            "--store",
            path.join(consumerRoot, "imported-trace.sqlite"),
            "--output",
            path.join(consumerRoot, "maintained-archive.json"),
        ]);
        assert.equal(maintainedExport.result.export?.digest, sourceExport.result.export?.digest);
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
        readonly backup?: {
            readonly export_digest: string;
            readonly manifest_id: string;
            readonly record_count: number;
        };
        readonly backup_verification?: { readonly manifest_id: string };
        readonly export?: { readonly digest: string; readonly format: string };
        readonly import?: { readonly imported_record_count: number };
        readonly maintenance?: {
            readonly after: { readonly wal_bytes: number };
            readonly quick_check: { readonly ok: boolean };
        };
        readonly restore?: { readonly export_digest: string };
        readonly store_verification?: { readonly schema_version: number };
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
