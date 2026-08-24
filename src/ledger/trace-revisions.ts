import { projectionProtocolConfig } from "../protocol/config.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import type { Cut } from "../store/types.ts";
import { assertLedgerEntryBounded, readLedgerListOptions, readLedgerSelector } from "./bounds.ts";
import { ambiguousLedgerSelector, missingLedgerSelector } from "./selector-errors.ts";
import type { LedgerListOptions, TraceRevisionEntry } from "./types.ts";

/**
 * Lists bounded immutable published-cut trace revisions in canonical publication order.
 *
 * @param store - Open trace store containing published cuts.
 * @param options - Optional closed configured pagination object.
 * @returns Frozen immutable trace revision entries.
 * @throws {TraceStoreError} If retained cut or slice evidence is corrupt.
 * @throws {TypeError} If options or canonical projection bounds are invalid.
 *
 * @example
 * ```ts
 * const revisions = listTraceRevisions(store, { limit: 25, offset: 0 });
 * ```
 */
export function listTraceRevisions(
    store: SQLiteTraceStore,
    options?: LedgerListOptions,
): readonly TraceRevisionEntry[] {
    const { limit, offset } = readLedgerListOptions(
        options,
        projectionProtocolConfig.evidenceRecords,
    );
    return Object.freeze(store.listCuts(limit, offset).map((cut) => traceRevision(store, cut)));
}

/**
 * Resolves an exact cut ID, unique cut-ID prefix, or canonical latest trace revision.
 *
 * @param store - Open trace store containing published cuts.
 * @param selector - Exact cut ID, unique prefix, or configured latest token.
 * @returns Exact immutable trace revision entry.
 * @throws {LedgerSelectorAmbiguousError} If a prefix matches multiple cuts.
 * @throws {LedgerSelectorNotFoundError} If no cut matches.
 * @throws {TraceStoreError} If retained cut or slice evidence is corrupt.
 * @throws {TypeError} If the selector or projection violates configured bounds.
 *
 * @example
 * ```ts
 * const revision = resolveTraceRevisionSelector(store, "cut:run:1");
 * ```
 */
export function resolveTraceRevisionSelector(
    store: SQLiteTraceStore,
    selector: string,
): TraceRevisionEntry {
    const policy = projectionProtocolConfig.evidenceRecords;
    const exactSelector = readLedgerSelector(selector, "trace revision selector", policy);
    const exact = store.readOptionalCut(exactSelector);
    if (exact !== undefined) return traceRevision(store, exact);
    if (exactSelector === policy.latestSelector) {
        const latest = store.listCuts(1, 0, true)[0];
        if (latest === undefined) throw missingLedgerSelector(exactSelector, policy.errors);
        return traceRevision(store, latest);
    }
    const matches = store.listCuts(policy.maxPageSize + 1, 0, false, exactSelector);
    if (matches.length === 0) throw missingLedgerSelector(exactSelector, policy.errors);
    if (matches.length > 1) throw ambiguousLedgerSelector(exactSelector, policy.errors);
    return traceRevision(store, matches[0] as (typeof matches)[number]);
}

function traceRevision(store: SQLiteTraceStore, cut: Cut): TraceRevisionEntry {
    const entry = Object.freeze({
        compatibility_version: projectionProtocolConfig.evidenceRecords.compatibilityVersion,
        cut,
        slice: store.resolveCut(cut.cut_id, {
            mode_filter: "both",
            visibility_profile: "full_internal",
        }),
        trace_revision_version: projectionProtocolConfig.evidenceRecords.version,
    });
    assertLedgerEntryBounded(
        entry,
        projectionProtocolConfig.evidenceRecords.maxCanonicalEntryBytes,
    );
    return entry;
}
