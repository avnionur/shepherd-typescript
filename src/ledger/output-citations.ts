import { projectionProtocolConfig, workspaceProtocolConfig } from "../protocol/config.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import { assertLedgerEntryBounded, readLedgerListOptions, readLedgerSelector } from "./bounds.ts";
import { resolveRunLedgerSelector } from "./run-ledger.ts";
import { ambiguousLedgerSelector, missingLedgerSelector } from "./selector-errors.ts";
import type { LedgerListOptions, OutputCitationEntry } from "./types.ts";

/**
 * Lists a bounded page of exact retained-world output citations in canonical record/run order.
 *
 * @param store - Open trace store containing durable retained-world evidence.
 * @param options - Optional closed configured pagination object.
 * @returns Frozen immutable output citation entries.
 * @throws {TraceStoreError} If retained run, output, cut, or settlement evidence is corrupt.
 * @throws {TypeError} If options or projected evidence violate configured bounds.
 *
 * @example
 * ```ts
 * const outputs = listOutputCitations(store, { limit: 25, offset: 0 });
 * ```
 */
export function listOutputCitations(
    store: SQLiteTraceStore,
    options?: LedgerListOptions,
): readonly OutputCitationEntry[] {
    const { limit, offset } = readLedgerListOptions(
        options,
        projectionProtocolConfig.evidenceRecords,
    );
    return Object.freeze(readOutputCitationCandidates(store).slice(offset, offset + limit));
}

/**
 * Resolves an exact output ID, unique output-ID prefix, or canonical latest read selector.
 *
 * @param store - Open trace store containing durable retained-world evidence.
 * @param selector - Exact output ID, unique output-ID prefix, or configured latest token.
 * @returns Exact immutable output citation entry.
 * @throws {LedgerSelectorAmbiguousError} If a prefix matches multiple bounded outputs.
 * @throws {LedgerSelectorNotFoundError} If no output matches.
 * @throws {TraceStoreError} If retained run, output, cut, or settlement evidence is corrupt.
 * @throws {TypeError} If the selector or projection violates configured bounds.
 *
 * @example
 * ```ts
 * const output = resolveOutputCitationSelector(store, "world-output:sha256:...");
 * ```
 */
export function resolveOutputCitationSelector(
    store: SQLiteTraceStore,
    selector: string,
): OutputCitationEntry {
    const policy = projectionProtocolConfig.evidenceRecords;
    const exactSelector = readLedgerSelector(selector, "output citation selector", policy);
    const exactMatches = store
        .listOwnersBySchemaBodyText(
            workspaceProtocolConfig.worldTaskCapture.captureSchemaId,
            policy.outputIdJsonPath,
            exactSelector,
            1,
        )
        .flatMap((runId) => {
            const citation = outputCitation(store, runId);
            return citation === null ? [] : [citation];
        });
    const exact = exactMatches[0];
    if (exact !== undefined) return exact;
    const candidates = readOutputCitationCandidates(store);
    if (exactSelector === policy.latestSelector) {
        const latest = candidates.at(-1);
        if (latest === undefined) throw missingLedgerSelector(exactSelector, policy.errors);
        return latest;
    }
    const matches = candidates.filter(({ output }) => output.output_id.startsWith(exactSelector));
    if (matches.length === 0) throw missingLedgerSelector(exactSelector, policy.errors);
    if (matches.length > 1) throw ambiguousLedgerSelector(exactSelector, policy.errors);
    return matches[0] as OutputCitationEntry;
}

function readOutputCitationCandidates(store: SQLiteTraceStore): readonly OutputCitationEntry[] {
    const policy = projectionProtocolConfig.evidenceRecords;
    const runIds = store.listOwnersBySchema(
        workspaceProtocolConfig.worldTaskCapture.captureSchemaId,
        policy.maxPageSize + 1,
        0,
    );
    if (runIds.length > policy.maxPageSize) {
        throw new TypeError("output citation candidates exceed the configured bound");
    }
    return Object.freeze(
        runIds.flatMap((runId) => {
            const citation = outputCitation(store, runId);
            return citation === null ? [] : [citation];
        }),
    );
}

function outputCitation(store: SQLiteTraceStore, runId: string): OutputCitationEntry | null {
    const run = resolveRunLedgerSelector(store, runId);
    if (run.output === null) return null;
    const output = run.output;
    const entry = Object.freeze({
        compatibility_version: projectionProtocolConfig.evidenceRecords.compatibilityVersion,
        output,
        output_citation_version: projectionProtocolConfig.evidenceRecords.version,
        run_created_record_id: run.created_record_id,
        run_id: run.run_id,
        settlements: run.inspection.settlements,
        task_artifact_lock: run.task_artifact_lock,
        world_capture: run.world_capture,
    });
    assertLedgerEntryBounded(
        entry,
        projectionProtocolConfig.evidenceRecords.maxCanonicalEntryBytes,
    );
    return entry;
}
