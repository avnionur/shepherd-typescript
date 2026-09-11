import type { ScopeWriterClaimRow } from "../store/scope-registrations.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import type {
    ClaimScopeWriterOptions,
    ReleaseScopeWriterOptions,
    ScopeWriter,
    ScopeWriterRelease,
} from "./types.ts";
import {
    assertScopeId,
    assertScopeText,
    readNowMilliseconds,
    readScopeDataObject,
} from "./validation.ts";

const AUTHENTICATED_SCOPE_WRITERS = new WeakMap<object, SQLiteTraceStore>();

/** Rejects forged, copied, imported, or foreign-store scope writer handles. @internal */
export function assertScopeWriter(
    value: unknown,
    store: SQLiteTraceStore,
): asserts value is ScopeWriter {
    if (
        value === null ||
        typeof value !== "object" ||
        AUTHENTICATED_SCOPE_WRITERS.get(value) !== store
    ) {
        throw new TypeError("scope writer must be created by this package for this store");
    }
}

/**
 * Atomically claims single-writer authority for one registered open scope.
 *
 * A fresh claim receives fencing token one. An exact unexpired active claim is returned again.
 * A released or expired claim is superseded by a new claim with the next monotonic token, so a
 * stale holder's later commands are fenced; expiry alone does not prove the previous holder
 * stopped. An unexpired active claim held by another identity fails closed. Imported scopes have
 * no live registration and cannot be claimed.
 *
 * @param store - Open writable trace store holding the scope registration.
 * @param options - Exact scope, proposed claim identity, and optional deterministic time.
 * @returns A frozen package-authenticated writer handle.
 * @throws {ScopeWriterConflictError} If another unexpired active claim holds the scope.
 * @throws {ScopeEvidenceError} If the scope is not registered for mutation in this store or not open.
 * @throws {TraceStoreError} If the store is closed.
 * @throws {TypeError} If options are malformed.
 *
 * @example
 * ```ts
 * const writer = claimScopeWriter(store, { claimId: "claim:worker-1", scopeId: root.scope_id });
 * ```
 *
 * @public
 */
export function claimScopeWriter(
    store: SQLiteTraceStore,
    options: ClaimScopeWriterOptions,
): ScopeWriter {
    const fields = readScopeDataObject(
        options,
        ["claimId", "scopeId"],
        "claimScopeWriter options",
        ["nowMilliseconds"],
    );
    assertScopeText(fields.claimId, "claimId");
    assertScopeId(fields.scopeId, "scopeId");
    const nowMilliseconds = readNowMilliseconds(fields.nowMilliseconds, "nowMilliseconds");
    return mintScopeWriter(
        store,
        store.claimScopeWriter(fields.scopeId, fields.claimId, nowMilliseconds),
    );
}

/**
 * Releases one exact scope writer so a later claim may proceed without waiting for expiry.
 *
 * Releasing an already released exact claim is idempotent. A superseded or unknown fence fails
 * closed. Released handles remain authenticated objects whose later commands are fenced.
 *
 * @param store - Open writable trace store holding the claim.
 * @param options - Authenticated writer to release.
 * @returns Frozen released-claim evidence.
 * @throws {ScopeWriterFencedError} If the fence is superseded or unknown.
 * @throws {TraceStoreError} If the store is closed.
 * @throws {TypeError} If the writer handle is forged or options are malformed.
 *
 * @public
 */
export function releaseScopeWriter(
    store: SQLiteTraceStore,
    options: ReleaseScopeWriterOptions,
): ScopeWriterRelease {
    const fields = readScopeDataObject(options, ["writer"], "releaseScopeWriter options");
    assertScopeWriter(fields.writer, store);
    const released = store.releaseScopeWriter(fields.writer.scope_id, {
        claimId: fields.writer.claim_id,
        fencingToken: fields.writer.fencing_token,
    });
    return Object.freeze({
        claim_id: released.claim_id,
        fencing_token: released.fencing_token,
        scope_id: released.scope_id,
    });
}

function mintScopeWriter(store: SQLiteTraceStore, row: ScopeWriterClaimRow): ScopeWriter {
    const writer: ScopeWriter = Object.freeze({
        claim_id: row.claim_id,
        fencing_token: row.fencing_token,
        lease_expires_at: row.lease_expires_at,
        scope_id: row.scope_id,
    });
    AUTHENTICATED_SCOPE_WRITERS.set(writer, store);
    return writer;
}
