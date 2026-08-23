import { projectionProtocolConfig, workspaceProtocolConfig } from "../protocol/config.ts";
import { readNativeJailProcessEvidence } from "../protocol/native-jail-evidence.ts";
import { readDurableCreation } from "../run/durable-execution-codec.ts";
import { inspectDurableTaskExecution } from "../run/durable-execution-inspection.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import type { OwnerRecord } from "../store/types.ts";
import { readRetainedWorldOutput } from "../workspace/retained-world-settlement.ts";
import { inspectTaskWorldCaptureJournal } from "../workspace/task-world-journal.ts";
import { assertLedgerEntryBounded, readLedgerListOptions, readLedgerSelector } from "./bounds.ts";
import { ambiguousLedgerSelector, missingLedgerSelector } from "./selector-errors.ts";
import type { LedgerListOptions, RunLedgerEntry } from "./types.ts";

/**
 * Lists a bounded page of durable executions in canonical creation-record/run-ID byte order.
 *
 * @param store - Open trace store containing durable execution evidence.
 * @param options - Optional closed configured pagination object.
 * @returns Frozen immutable run ledger entries.
 * @throws {TraceStoreError} If the store is closed or retained evidence is corrupt.
 * @throws {TypeError} If options, retained evidence, or canonical size are invalid.
 *
 * @example
 * ```ts
 * const page = listRunLedger(store, { limit: 25, offset: 0 });
 * ```
 */
export function listRunLedger(
    store: SQLiteTraceStore,
    options?: LedgerListOptions,
): readonly RunLedgerEntry[] {
    const { limit, offset } = readLedgerListOptions(options);
    const schema = projectionProtocolConfig.executionHistory.executionSchemas.created;
    return Object.freeze(
        store.listOwnersBySchema(schema, limit, offset).map((runId) => readRunEntry(store, runId)),
    );
}

/**
 * Resolves an exact run ID, unique run-ID prefix, or canonical latest read selector.
 *
 * @param store - Open trace store containing durable execution evidence.
 * @param selector - Exact run ID, unique run-ID prefix, or configured latest token.
 * @returns Exact immutable run ledger entry.
 * @throws {LedgerSelectorAmbiguousError} If a prefix matches multiple runs.
 * @throws {LedgerSelectorNotFoundError} If no run matches.
 * @throws {TraceStoreError} If the store is closed or retained evidence is corrupt.
 * @throws {TypeError} If the selector or retained projection evidence is invalid.
 *
 * @example
 * ```ts
 * const run = resolveRunLedgerSelector(store, "run:review:1");
 * ```
 */
export function resolveRunLedgerSelector(
    store: SQLiteTraceStore,
    selector: string,
): RunLedgerEntry {
    const exactSelector = readLedgerSelector(selector, "run ledger selector");
    const schema = projectionProtocolConfig.executionHistory.executionSchemas.created;
    if (store.readOwner(exactSelector).some((record) => record.envelope.schema_ref === schema)) {
        return readRunEntry(store, exactSelector);
    }
    if (exactSelector === projectionProtocolConfig.taskRunLedgers.latestSelector) {
        const latestRunId = store.listOwnersBySchema(schema, 1, 0, true)[0];
        if (latestRunId === undefined) throw missingLedgerSelector(exactSelector);
        return readRunEntry(store, latestRunId);
    }
    const entries = store
        .listOwnersBySchema(
            schema,
            projectionProtocolConfig.taskRunLedgers.maxPageSize + 1,
            0,
            false,
            exactSelector,
        )
        .map((runId) => readRunEntry(store, runId));
    if (entries.length > projectionProtocolConfig.taskRunLedgers.maxPageSize) {
        throw ambiguousLedgerSelector(exactSelector);
    }
    if (entries.length === 0) throw missingLedgerSelector(exactSelector);
    if (entries.length > 1) {
        throw ambiguousLedgerSelector(exactSelector);
    }
    return entries[0] as RunLedgerEntry;
}

function readRunEntry(store: SQLiteTraceStore, runId: string): RunLedgerEntry {
    const createdSchema = projectionProtocolConfig.executionHistory.executionSchemas.created;
    const ownerRecords = store.readOwner(runId);
    const created = ownerRecords.filter((record) => record.envelope.schema_ref === createdSchema);
    if (created.length !== 1) {
        throw new TypeError("run ledger creation evidence is absent or ambiguous");
    }
    const record = created[0] as OwnerRecord;
    const descriptor = Object.getOwnPropertyDescriptor(record.body, "payload");
    if (descriptor === undefined || !("value" in descriptor)) {
        throw new TypeError("run ledger creation payload is absent");
    }
    const evidence = readDurableCreation(descriptor.value, runId);
    const inspection = inspectDurableTaskExecution(store, runId);
    const worldCapture = inspectTaskWorldCaptureJournal(store, runId);
    const terminalCut = inspection.cut;
    const cutRecords =
        terminalCut === null
            ? []
            : ownerRecords.filter(
                  (candidate) => candidate.view.owner_ordinal <= terminalCut.through_owner_ordinal,
              );
    const outputRecord = cutRecords.find(
        (candidate) => candidate.envelope.record_id === worldCapture.output_record_id,
    );
    const output =
        terminalCut === null ||
        inspection.outcome === null ||
        worldCapture.output_record_id === null
            ? null
            : readRetainedWorldOutput({
                  ...(outputRecord as OwnerRecord).body,
                  capture_record_id: (outputRecord as OwnerRecord).envelope.record_id,
                  execution_cut: terminalCut,
                  execution_outcome_record_id: inspection.outcome.record_id,
              });
    const nativeJailProcesses = Object.freeze(
        cutRecords
            .filter(
                (candidate) =>
                    candidate.envelope.schema_ref ===
                    workspaceProtocolConfig.placements.nativeJails.schemas.processId,
            )
            .map((candidate) =>
                Object.freeze({
                    body: readNativeJailProcessEvidence(candidate.body),
                    record_id: candidate.envelope.record_id,
                }),
            ),
    );
    const entry = Object.freeze({
        budget: evidence.budget,
        compatibility_version: projectionProtocolConfig.taskRunLedgers.compatibilityVersion,
        created_record_id: record.envelope.record_id,
        input: evidence.input,
        inspection,
        ledger_version: projectionProtocolConfig.taskRunLedgers.version,
        native_jail_processes: nativeJailProcesses,
        output,
        provider: evidence.provider,
        run_id: runId,
        task_artifact_lock: evidence.taskArtifactLock,
        world_capture: worldCapture,
    });
    assertLedgerEntryBounded(entry);
    return entry;
}
