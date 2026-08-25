import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { SemanticRecord } from "../canonical/canonical-record.ts";
import { listOutputCitations, resolveOutputCitationSelector } from "../ledger/output-citations.ts";
import { listRecoveryRecords, resolveRecoveryRecordSelector } from "../ledger/recovery-records.ts";
import { listRunLedger, resolveRunLedgerSelector } from "../ledger/run-ledger.ts";
import { listTaskLedger, resolveTaskLedgerSelector } from "../ledger/task-ledger.ts";
import { listTraceRevisions, resolveTraceRevisionSelector } from "../ledger/trace-revisions.ts";
import { cliProtocolConfig } from "../protocol/config.ts";
import {
    ORPHAN_REPAIR_LIMITS,
    ORPHAN_REPAIR_VERSIONS,
    RETAINED_WORLD_SETTLEMENT_ACTIONS,
    WORKSPACE_ADOPTION_MODES,
} from "../protocol/values.generated.ts";
import { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import { SQLiteTaskRegistry } from "../task/sqlite-task-registry.ts";
import { createWorkspaceBindings } from "../workspace/bindings.ts";
import { createWorldChangesetInspection } from "../workspace/changeset-inspection.ts";
import { initializeWorkspace, openWorkspace } from "../workspace/initialization.ts";
import { inspectLocalNativeJailBackend } from "../workspace/native-jail.ts";
import { createReferenceCopyCarrier } from "../workspace/reference-copy-carrier.ts";
import {
    applyRetainedWorldSettlement,
    discardRetainedWorldSettlement,
    prepareRetainedWorldSettlement,
    releaseRetainedWorldSettlement,
    selectRetainedWorldSettlement,
} from "../workspace/retained-world-settlement.ts";
import { CliUnavailableError, CliUsageError } from "./errors.ts";
import type { CliHandler, CliHandlerIo } from "./types.ts";

const [SELECT_ACTION, DISCARD_ACTION, APPLY_ACTION, RELEASE_ACTION] =
    RETAINED_WORLD_SETTLEMENT_ACTIONS;
const HANDLERS = cliProtocolConfig.handlerRoles;
const OPTIONS = cliProtocolConfig.options;

type ParsedOptions = {
    readonly flags: ReadonlySet<string>;
    readonly options: ReadonlyMap<string, string>;
    readonly positionals: readonly string[];
};

type SettlementAction = (typeof RETAINED_WORLD_SETTLEMENT_ACTIONS)[number];

/** @internal Creates the fixed implementation registry addressed by configured handler IDs. */
export function createCliHandlers(): ReadonlyMap<string, CliHandler> {
    return new Map<string, CliHandler>([
        [HANDLERS.workspaceInit, initialize],
        [HANDLERS.doctor, doctor],
        [HANDLERS.runList, runList],
        [HANDLERS.runShow, runShow],
        [HANDLERS.runChangeset, runChangeset],
        [HANDLERS.runTrace, runTrace],
        [HANDLERS.runTraceRevision, runTrace],
        [HANDLERS.runVcsCore, runVcsCore],
        [HANDLERS.runOutputCitations, runOutputCitations],
        [HANDLERS.runOutputs, runOutputs],
        [HANDLERS.runPublishRetainedWorkspaceOutput, runPublishRetainedWorkspaceOutput],
        [HANDLERS.runRecoveryRecords, runRecoveryRecords],
        [HANDLERS.runSelect, settle(SELECT_ACTION)],
        [HANDLERS.runApply, settle(APPLY_ACTION)],
        [HANDLERS.runRelease, settle(RELEASE_ACTION)],
        [HANDLERS.runDiscard, settle(DISCARD_ACTION)],
        [HANDLERS.runRepair, runRepair],
        [HANDLERS.taskList, taskList],
        [HANDLERS.taskShow, taskShow],
        [HANDLERS.taskResolve, taskShow],
        [HANDLERS.unsupportedStart, unsupported(cliProtocolConfig.remedies.fencedStart)],
        [HANDLERS.unsupportedTaskRegister, unsupported(cliProtocolConfig.remedies.taskRegister)],
        [HANDLERS.demoWrite, demoWrite],
        [HANDLERS.unsupportedPackageInit, unsupported(cliProtocolConfig.remedies.packageInit)],
    ]);
}

async function initialize(args: readonly string[], io: CliHandlerIo): Promise<void> {
    const parsed = parseOptions(
        args,
        new Set([OPTIONS.adopt]),
        new Set([OPTIONS.initializeGit, OPTIONS.noInitializeGit]),
    );
    if (parsed.positionals.length > 1)
        throw new CliUsageError("command accepts at most one workspace path");
    if (parsed.flags.has(OPTIONS.initializeGit) && parsed.flags.has(OPTIONS.noInitializeGit)) {
        throw new CliUsageError("Git options are mutually exclusive");
    }
    const rootPath = path.resolve(
        io.cwd,
        parsed.positionals[0] ?? cliProtocolConfig.defaults.workspacePath,
    );
    const initializeGit = parsed.flags.has(OPTIONS.initializeGit)
        ? true
        : parsed.flags.has(OPTIONS.noInitializeGit)
          ? false
          : undefined;
    const adopt = parsed.options.get(OPTIONS.adopt);
    const configuredAdopt = WORKSPACE_ADOPTION_MODES.find((mode) => mode === adopt);
    if (adopt !== undefined && configuredAdopt === undefined) {
        throw new CliUsageError(`--${OPTIONS.adopt} must name a configured adoption mode`);
    }
    const state = initializeWorkspace({
        ...(configuredAdopt === undefined ? {} : { adopt: configuredAdopt }),
        ...(initializeGit === undefined ? {} : { initializeGit }),
        rootPath,
    });
    io.output(`Initialized ${state.root_path}\nAdoption: ${state.adoption.mode}\n`, {
        adoption: state.adoption as unknown as SemanticRecord,
        format: state.format,
    });
}

async function doctor(args: readonly string[], io: CliHandlerIo): Promise<void> {
    const parsed = parseOptions(
        args,
        new Set([OPTIONS.registry, OPTIONS.store, OPTIONS.workspace]),
    );
    requireNoPositionals(parsed);
    const storePath = resolveOptionPath(
        parsed,
        OPTIONS.store,
        io,
        cliProtocolConfig.defaults.traceStorePath,
    );
    const registryPath = resolveOptionPath(
        parsed,
        OPTIONS.registry,
        io,
        cliProtocolConfig.defaults.taskRegistryPath,
    );
    const workspacePath = resolveOptionPath(
        parsed,
        OPTIONS.workspace,
        io,
        cliProtocolConfig.defaults.workspacePath,
    );
    const lines = [
        `Node: ${process.versions.node}`,
        `Protocol: ${cliProtocolConfig.compatibilityVersion}`,
        `Trace store: ${inspectStore(storePath)}`,
        `Task registry: ${inspectRegistry(registryPath)}`,
        `Workspace: ${inspectWorkspace(workspacePath)}`,
    ];
    const native = await inspectLocalNativeJailBackend();
    lines.push(`Native jail: ${native.status} (${native.reason})`);
    io.output(`${lines.join("\n")}\n`, {
        native_jail: native as unknown as SemanticRecord,
        node_version: process.versions.node,
        protocol: cliProtocolConfig.compatibilityVersion,
        task_registry: inspectRegistry(registryPath),
        trace_store: inspectStore(storePath),
        workspace: inspectWorkspace(workspacePath),
    });
}

async function runList(args: readonly string[], io: CliHandlerIo): Promise<void> {
    const parsed = parseOptions(args, new Set([OPTIONS.limit, OPTIONS.offset, OPTIONS.store]));
    requireNoPositionals(parsed);
    const page = pagination(parsed);
    using store = openStore(parsed, io);
    const entries = listRunLedger(store, page);
    io.output(
        entries.length === 0
            ? "No runs.\n"
            : entries.map((entry) => `${entry.run_id}\t${entry.inspection.status}\n`).join(""),
        { runs: entries as unknown as SemanticRecord["runs"] },
    );
}

async function runShow(args: readonly string[], io: CliHandlerIo): Promise<void> {
    const parsed = parseOptions(args, new Set([OPTIONS.store]));
    const selector = requireOnePositional(parsed);
    using store = openStore(parsed, io);
    const entry = resolveRunLedgerSelector(store, selector);
    io.output(
        `Run: ${entry.run_id}\nStatus: ${entry.inspection.status}\nTask: ${entry.task_artifact_lock.task_id}@${entry.task_artifact_lock.task_version}\n`,
        { run: entry } as unknown as SemanticRecord,
    );
}

async function runTrace(args: readonly string[], io: CliHandlerIo): Promise<void> {
    const parsed = parseOptions(args, new Set([OPTIONS.limit, OPTIONS.offset, OPTIONS.store]));
    const page = pagination(parsed);
    using store = openStore(parsed, io);
    if (parsed.positionals.length === 0) {
        const entries = listTraceRevisions(store, page);
        io.output(
            entries.length === 0
                ? "No trace revisions.\n"
                : entries.map(({ cut }) => `${cut.cut_id}\t${cut.target_owner_id}\n`).join(""),
            { trace_revisions: entries } as unknown as SemanticRecord,
        );
        return;
    }
    const selector = requireOnePositional(parsed);
    const entry = resolveTraceRevisionSelector(store, selector);
    io.output(
        `Trace: ${entry.cut.cut_id}\nOwner: ${entry.cut.target_owner_id}\nRecords: ${Object.keys(entry.slice.visible_records_by_id).length}\n`,
        { trace_revision: entry } as unknown as SemanticRecord,
    );
}

async function runOutputCitations(args: readonly string[], io: CliHandlerIo): Promise<void> {
    const parsed = parseOptions(args, new Set([OPTIONS.limit, OPTIONS.offset, OPTIONS.store]));
    const page = pagination(parsed);
    using store = openStore(parsed, io);
    if (parsed.positionals.length === 0) {
        const entries = listOutputCitations(store, page);
        io.output(
            entries.length === 0
                ? "No output citations.\n"
                : entries.map(({ output, run_id }) => `${output.output_id}\t${run_id}\n`).join(""),
            { output_citations: entries } as unknown as SemanticRecord,
        );
        return;
    }
    const selector = requireOnePositional(parsed);
    const entry = resolveOutputCitationSelector(store, selector);
    io.output(
        `Output: ${entry.output.output_id}\nRun: ${entry.run_id}\nSettlements: ${entry.settlements.length}\n`,
        { output_citation: entry } as unknown as SemanticRecord,
    );
}

async function runOutputs(args: readonly string[], io: CliHandlerIo): Promise<void> {
    const parsed = parseOptions(args, new Set([OPTIONS.limit, OPTIONS.offset, OPTIONS.store]));
    const page = pagination(parsed);
    using store = openStore(parsed, io);
    if (parsed.positionals.length === 0) {
        const entries = listOutputCitations(store, page);
        io.output(
            entries.length === 0
                ? "No retained outputs.\n"
                : entries
                      .map(
                          (entry) =>
                              `${entry.output.output_id}\t${entry.run_id}\t${outputState(entry)}\n`,
                      )
                      .join(""),
            { outputs: entries as unknown as SemanticRecord },
        );
        return;
    }
    const entry = resolveOutputCitationSelector(store, requireOnePositional(parsed));
    io.output(
        `Output: ${entry.output.output_id}\nRun: ${entry.run_id}\nChangeset: ${entry.output.changeset_id}\nState: ${outputState(entry)}\n`,
        { output: entry as unknown as SemanticRecord },
    );
}

function outputState(entry: ReturnType<typeof resolveOutputCitationSelector>): string {
    return entry.settlements.at(-1)?.state ?? entry.output.status;
}

async function runPublishRetainedWorkspaceOutput(
    args: readonly string[],
    io: CliHandlerIo,
): Promise<void> {
    const parsed = parseOptions(args, new Set([OPTIONS.store]));
    const selector = requireOnePositional(parsed);
    using store = openStore(parsed, io);
    const run = resolveRunLedgerSelector(store, selector);
    if (run.run_id !== selector) {
        throw new CliUsageError(cliProtocolConfig.messages.publicationExactRun);
    }
    if (run.output === null) {
        throw new CliUnavailableError(cliProtocolConfig.messages.publicationUnavailable);
    }
    const citation = resolveOutputCitationSelector(store, run.output.output_id);
    io.output(
        `Output citation already published.\nRun: ${citation.run_id}\nOutput: ${citation.output.output_id}\nCut: ${citation.output.execution_cut.cut_id}\n`,
        { publication: citation as unknown as SemanticRecord },
    );
}

async function runChangeset(args: readonly string[], io: CliHandlerIo): Promise<void> {
    const parsed = parseOptions(
        args,
        new Set([
            OPTIONS.limit,
            OPTIONS.maxBytes,
            OPTIONS.offset,
            OPTIONS.read,
            OPTIONS.store,
            OPTIONS.workspace,
        ]),
    );
    const selector = requireOnePositional(parsed);
    using store = openStore(parsed, io);
    const citation = resolveOutputCitationSelector(store, selector);
    const workspaceRoot = resolveOptionPath(
        parsed,
        OPTIONS.workspace,
        io,
        cliProtocolConfig.defaults.workspacePath,
    );
    const inspection = await openChangesetInspection(citation, workspaceRoot);
    const readPath = parsed.options.get(OPTIONS.read);
    if (readPath !== undefined) {
        const change = inspection.change(readPath);
        if (change?.after?.kind !== "file") {
            throw new CliUsageError(cliProtocolConfig.messages.changesetPathUnavailable);
        }
        const maxBytes = retainedReadBytes(parsed);
        let preview: Awaited<ReturnType<typeof inspection.previewText>>;
        try {
            preview = await inspection.previewText({
                contentId: change.after.content_id,
                maxBytes,
            });
            /* Retained blob/revision corruption is covered at the public inspection seam. */
            /* node:coverage disable */
        } catch {
            throw new CliUnavailableError(cliProtocolConfig.messages.changesetUnavailable);
        }
        /* node:coverage enable */
        if (preview.classification !== "text" || preview.text === null) {
            throw new CliUnavailableError(cliProtocolConfig.messages.changesetBinary);
        }
        io.output(preview.text, {
            changeset_read: {
                output_id: citation.output.output_id,
                path: readPath,
                preview: preview as unknown as SemanticRecord,
            },
        });
        return;
    }
    if (parsed.options.has(OPTIONS.maxBytes)) {
        throw new CliUsageError(`--${OPTIONS.maxBytes} requires --${OPTIONS.read}`);
    }
    const page = inspection.page(pagination(parsed));
    const changeset = inspection.changeset;
    const view = {
        binding_id: citation.output.binding_id,
        changeset: {
            base_revision_id: changeset.base_revision_id,
            binding_id: changeset.binding_id,
            changeset_id: changeset.changeset_id,
            head_revision_id: changeset.head_revision_id,
            schema_version: changeset.schema_version,
        },
        inspection_version: inspection.inspection_version,
        output_id: citation.output.output_id,
        page: page as unknown as SemanticRecord,
        run_id: citation.run_id,
    };
    io.output(
        `Changeset: ${changeset.changeset_id}\nOutput: ${citation.output.output_id}\nPaths:\n${page.changes.map(({ path: changedPath }) => `  ${changedPath}\n`).join("")}`,
        { changeset: view },
    );
}

async function openChangesetInspection(
    citation: ReturnType<typeof resolveOutputCitationSelector>,
    workspaceRoot: string,
): Promise<Awaited<ReturnType<typeof createWorldChangesetInspection>>> {
    try {
        const carrier = createReferenceCopyCarrier({ workspaceRoot });
        const [baseRevision, headRevision] = await Promise.all([
            carrier.openRevision(citation.output.base_revision_id),
            carrier.openRevision(citation.output.head_revision_id),
        ]);
        return createWorldChangesetInspection({ baseRevision, carrier, headRevision });
    } catch {
        throw new CliUnavailableError(cliProtocolConfig.messages.changesetUnavailable);
    }
}

async function runVcsCore(args: readonly string[], io: CliHandlerIo): Promise<void> {
    const parsed = parseOptions(args, new Set([OPTIONS.store]));
    using store = openStore(parsed, io);
    const citation = resolveOutputCitationSelector(store, requireOnePositional(parsed));
    io.output(
        `Output: ${citation.output.output_id}\nRun: ${citation.run_id}\nBinding: ${citation.output.binding_id}\nChangeset: ${citation.output.changeset_id}\nCapture: ${citation.output.capture_record_id}\nCut: ${citation.output.execution_cut.cut_id}\nSettlements: ${citation.settlements.length}\n`,
        { vcscore: citation as unknown as SemanticRecord },
    );
}

function retainedReadBytes(parsed: ParsedOptions): number {
    const raw = parsed.options.get(OPTIONS.maxBytes);
    if (raw === undefined) return cliProtocolConfig.limits.defaultRetainedReadBytes;
    const value = Number(raw);
    if (
        !Number.isSafeInteger(value) ||
        value < 1 ||
        value > cliProtocolConfig.limits.maxRetainedReadBytes
    ) {
        throw new CliUsageError(`--${OPTIONS.maxBytes} exceeds the configured byte bound`);
    }
    return value;
}

async function runRecoveryRecords(args: readonly string[], io: CliHandlerIo): Promise<void> {
    const parsed = parseOptions(args, new Set([OPTIONS.limit, OPTIONS.offset, OPTIONS.store]));
    const page = pagination(parsed);
    using store = openStore(parsed, io);
    if (parsed.positionals.length === 0) {
        const entries = listRecoveryRecords(store, page);
        io.output(
            entries.length === 0
                ? "No recovery records.\n"
                : entries.map((entry) => `${entry.run_id}\t${entry.recovery_status}\n`).join(""),
            { recovery_records: entries } as unknown as SemanticRecord,
        );
        return;
    }
    const entry = resolveRecoveryRecordSelector(store, requireOnePositional(parsed));
    io.output(
        `Run: ${entry.run_id}\nRecovery: ${entry.recovery_status}\nCommands: ${entry.commands.length}\n`,
        { recovery_record: entry } as unknown as SemanticRecord,
    );
}

function settle(action: SettlementAction): CliHandler {
    return async (args, io) => {
        const parsed = parseOptions(
            args,
            new Set([
                OPTIONS.bindingName,
                OPTIONS.bindingRoot,
                OPTIONS.command,
                OPTIONS.store,
                OPTIONS.workspace,
            ]),
        );
        const outputSelector = requireOnePositional(parsed);
        const commandId = requireOption(parsed, OPTIONS.command);
        const workspaceRoot = resolveOptionPath(
            parsed,
            OPTIONS.workspace,
            io,
            cliProtocolConfig.defaults.workspacePath,
        );
        const bindingName =
            parsed.options.get(OPTIONS.bindingName) ?? cliProtocolConfig.defaults.bindingName;
        const bindingRoot =
            parsed.options.get(OPTIONS.bindingRoot) ?? cliProtocolConfig.defaults.bindingRoot;
        using store = openStore(parsed, io, false);
        const citation = resolveOutputCitationSelector(store, outputSelector);
        if (citation.output.output_id !== outputSelector) {
            throw new CliUsageError("settlement requires an exact output identity");
        }
        const carrier = createReferenceCopyCarrier({ workspaceRoot });
        const binding = createWorkspaceBindings({
            bindings: [{ name: bindingName, root: bindingRoot }],
            workspaceRoot,
        }).bindings[0];
        // One validated binding definition always returns one binding.
        /* node:coverage disable */
        if (binding === undefined) throw new CliUsageError("settlement binding is unavailable");
        /* node:coverage enable */
        await prepareRetainedWorldSettlement({
            action,
            binding,
            carrier,
            commandId,
            output: citation.output,
            store,
        });
        const result =
            action === SELECT_ACTION
                ? await selectRetainedWorldSettlement({
                      binding,
                      carrier,
                      outputId: outputSelector,
                      store,
                  })
                : action === APPLY_ACTION
                  ? await applyRetainedWorldSettlement({
                        binding,
                        carrier,
                        outputId: outputSelector,
                        store,
                    })
                  : action === RELEASE_ACTION
                    ? await releaseRetainedWorldSettlement({
                          binding,
                          carrier,
                          outputId: outputSelector,
                          store,
                      })
                    : await discardRetainedWorldSettlement({
                          carrier,
                          outputId: outputSelector,
                          store,
                      });
        io.output(`${result.action}: ${result.output_id}\nState: ${result.state}\n`, {
            settlement: result as unknown as SemanticRecord,
        });
    };
}

async function runRepair(args: readonly string[], io: CliHandlerIo): Promise<void> {
    const parsed = parseOptions(args, new Set([OPTIONS.command, OPTIONS.store]));
    requireNoPositionals(parsed);
    using store = openStore(parsed, io, false);
    const diagnosis = store.diagnoseOrphanedOperations({
        limit: ORPHAN_REPAIR_LIMITS.maxOperations,
        offset: 0,
    });
    const receipt = store.repairOrphanedOperations({
        basis_id: diagnosis.basis_id,
        command_id: requireOption(parsed, OPTIONS.command),
        command_version: ORPHAN_REPAIR_VERSIONS.command,
        operation_ids: diagnosis.operations.map(({ operation_id }) => operation_id),
    });
    io.output(
        receipt.repaired_count === 0
            ? "Nothing to repair.\n"
            : `Repaired ${receipt.repaired_count} operation(s).\n`,
        { repair_receipt: receipt as unknown as SemanticRecord },
    );
}

async function taskList(args: readonly string[], io: CliHandlerIo): Promise<void> {
    const parsed = parseOptions(args, new Set([OPTIONS.limit, OPTIONS.offset, OPTIONS.registry]));
    requireNoPositionals(parsed);
    const page = pagination(parsed);
    using registry = openRegistry(parsed, io);
    const entries = listTaskLedger(registry, page);
    io.output(
        entries.length === 0
            ? "No tasks.\n"
            : entries
                  .map(
                      ({ artifact_lock }) =>
                          `${artifact_lock.task_id}@${artifact_lock.task_version}\n`,
                  )
                  .join(""),
        { tasks: entries } as unknown as SemanticRecord,
    );
}

async function taskShow(args: readonly string[], io: CliHandlerIo): Promise<void> {
    const parsed = parseOptions(args, new Set([OPTIONS.registry]));
    const selector = requireOnePositional(parsed);
    using registry = openRegistry(parsed, io);
    const entry = resolveTaskLedgerSelector(registry, selector);
    io.output(
        `Task: ${entry.artifact_lock.task_id}@${entry.artifact_lock.task_version}\nDigest: ${entry.artifact_lock.artifact_digest}\n`,
        { task: entry } as unknown as SemanticRecord,
    );
}

async function demoWrite(args: readonly string[], io: CliHandlerIo): Promise<void> {
    if (args.length !== 1 || args[0] !== cliProtocolConfig.defaults.quickstartDemoName) {
        throw new CliUsageError(cliProtocolConfig.messages.demoNameUsage);
    }
    const source = readPackageArtifact(cliProtocolConfig.artifacts.quickstartDemo);
    io.output(source, {
        demo: {
            byte_length: Buffer.byteLength(source, "utf8"),
            name: cliProtocolConfig.defaults.quickstartDemoName,
        },
    });
}

function unsupported(message: string): CliHandler {
    return async (args) => {
        if (args.length !== 0) {
            throw new CliUsageError("unavailable command accepts no arguments");
        }
        throw new CliUnavailableError(message);
    };
}

function readPackageArtifact(relativePath: string): string {
    let directory = path.dirname(fileURLToPath(import.meta.url));
    while (!existsSync(path.join(directory, "package.json"))) {
        const parent = path.dirname(directory);
        /* node:coverage disable */
        if (parent === directory) {
            throw new CliUnavailableError(cliProtocolConfig.messages.quickstartUnavailable);
        }
        /* node:coverage enable */
        directory = parent;
    }
    const artifactPath = path.resolve(directory, relativePath);
    const relative = path.relative(directory, artifactPath);
    /* node:coverage disable */
    if (relative === ".." || relative.startsWith(`..${path.sep}`)) {
        throw new CliUnavailableError(cliProtocolConfig.messages.quickstartUnavailable);
    }
    /* node:coverage enable */
    /* Package/source gates require this configured artifact at every shipped seam. */
    /* node:coverage disable */
    try {
        return readFileSync(artifactPath, "utf8");
    } catch {
        throw new CliUnavailableError(cliProtocolConfig.messages.quickstartUnavailable);
    }
    /* node:coverage enable */
}

function parseOptions(
    args: readonly string[],
    valueOptions: ReadonlySet<string>,
    flagOptions: ReadonlySet<string> = new Set(),
): ParsedOptions {
    const options = new Map<string, string>();
    const flags = new Set<string>();
    const positionals: string[] = [];
    for (let index = 0; index < args.length; index += 1) {
        const argument = args[index] as string;
        if (!argument.startsWith("--")) {
            positionals.push(argument);
            continue;
        }
        const name = argument.slice(2);
        if (flagOptions.has(name)) {
            if (flags.has(name)) throw new CliUsageError(`duplicate option: --${name}`);
            flags.add(name);
            continue;
        }
        if (!valueOptions.has(name)) throw new CliUsageError(`unknown option: --${name}`);
        const value = args[index + 1];
        if (value === undefined || value.startsWith("--")) {
            throw new CliUsageError(`missing value for --${name}`);
        }
        if (options.has(name)) throw new CliUsageError(`duplicate option: --${name}`);
        options.set(name, value);
        index += 1;
    }
    return { flags, options, positionals };
}

function pagination(parsed: ParsedOptions): { readonly limit: number; readonly offset: number } {
    return {
        limit: readNonNegativeIntegerOption(
            parsed,
            OPTIONS.limit,
            cliProtocolConfig.limits.defaultPageSize,
            true,
        ),
        offset: readNonNegativeIntegerOption(parsed, OPTIONS.offset, 0, false),
    };
}

function readNonNegativeIntegerOption(
    parsed: ParsedOptions,
    name: string,
    fallback: number,
    positive: boolean,
): number {
    const raw = parsed.options.get(name);
    if (raw === undefined) return fallback;
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0)) {
        throw new CliUsageError(
            `--${name} must be a ${positive ? "positive" : "non-negative"} integer`,
        );
    }
    if (value > cliProtocolConfig.limits.maxPageSize) {
        throw new CliUsageError(`--${name} exceeds the configured page bound`);
    }
    return value;
}

function openStore(parsed: ParsedOptions, io: CliHandlerIo, readOnly = true): SQLiteTraceStore {
    const storePath = resolveOptionPath(
        parsed,
        OPTIONS.store,
        io,
        cliProtocolConfig.defaults.traceStorePath,
    );
    if (!existsSync(storePath))
        throw new CliUnavailableError(`trace store is unavailable: ${storePath}`);
    return new SQLiteTraceStore(storePath, { readOnly });
}

function openRegistry(parsed: ParsedOptions, io: CliHandlerIo): SQLiteTaskRegistry {
    const registryPath = resolveOptionPath(
        parsed,
        OPTIONS.registry,
        io,
        cliProtocolConfig.defaults.taskRegistryPath,
    );
    if (!existsSync(registryPath))
        throw new CliUnavailableError(`task registry is unavailable: ${registryPath}`);
    return new SQLiteTaskRegistry(registryPath, { readOnly: true });
}

function inspectStore(storePath: string): string {
    if (!existsSync(storePath)) return "missing";
    using store = new SQLiteTraceStore(storePath, { readOnly: true });
    return `schema ${store.schemaVersion}`;
}

function inspectRegistry(registryPath: string): string {
    if (!existsSync(registryPath)) return "missing";
    using registry = new SQLiteTaskRegistry(registryPath, { readOnly: true });
    return `schema ${registry.schemaVersion}`;
}

function inspectWorkspace(workspacePath: string): string {
    try {
        return openWorkspace(workspacePath).format;
    } catch {
        return "missing or invalid";
    }
}

function resolveOptionPath(
    parsed: ParsedOptions,
    name: string,
    io: CliHandlerIo,
    fallback: string,
): string {
    return path.resolve(io.cwd, parsed.options.get(name) ?? fallback);
}

function requireOption(parsed: ParsedOptions, name: string): string {
    const value = parsed.options.get(name);
    if (value === undefined) throw new CliUsageError(`missing required option: --${name}`);
    return value;
}

function requireNoPositionals(parsed: ParsedOptions): void {
    if (parsed.positionals.length !== 0)
        throw new CliUsageError("command accepts no positional arguments");
}

function requireOnePositional(parsed: ParsedOptions): string {
    if (parsed.positionals.length !== 1)
        throw new CliUsageError("command requires exactly one selector");
    return parsed.positionals[0] as string;
}
