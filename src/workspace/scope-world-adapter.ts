import type {
    ApplicationWorldAdapter,
    ApplicationWorldCustody,
    ApplicationWorldDiscardRequest,
    ApplicationWorldForkRequest,
    ApplicationWorldMergeRequest,
    ApplicationWorldReceipt,
} from "../applications/types.ts";
import { SCOPE_COMMAND_KINDS, SCOPE_STATES } from "../protocol/values.generated.ts";
import { readScopeResourceGrants } from "../scope/authority.ts";
import { ScopeMergeConflictError } from "../scope/errors.ts";
import { inspectScope } from "../scope/inspection.ts";
import { readScopeCommandReceipt } from "../scope/replay.ts";
import { createScopeMergeApplicationCustodyId } from "../scope/terminal-records.ts";
import type {
    ScopeForkReceipt,
    ScopeInspection,
    ScopeResourceGrant,
    ScopeResourceGrantRequest,
    ScopeWorldInspection,
    ScopeWriter,
} from "../scope/types.ts";
import { assertScopeText, readNowMilliseconds, readScopeDataObject } from "../scope/validation.ts";
import { assertScopeWriter, claimScopeWriter, releaseScopeWriter } from "../scope/writer.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import { assertWorkspaceBinding } from "./bindings.ts";
import { createVerifiedWorldChangeset, createWorldChangeset } from "./changesets.ts";
import {
    assertReferenceCopyCarrier,
    createReferenceCopyApplicationRevisionWithIdentity,
    discardReferenceCopyCustodyIdentity,
    publishReferenceCopyCustodyChangeset,
} from "./reference-copy-carrier.ts";
import { inspectRetainedWorldApplicationConflicts } from "./retained-world-application.ts";
import { discardScope } from "./scope-discard.ts";
import { forkScope } from "./scope-fork.ts";
import { mergeScope } from "./scope-merge.ts";
import type { ReferenceCopyCarrier, WorkspaceBinding } from "./types.ts";

const [, , , FORK_COMMAND, MERGE_COMMAND, DISCARD_COMMAND] = SCOPE_COMMAND_KINDS;
const [OPEN_STATE] = SCOPE_STATES;
// Steps of landing a nested custody, derived from its merge command: a fresh fork of the parent
// world that receives the custody's lineage changes, and the seal of the nested custody itself.
const REBASE_FORK_STEP = ":rebase-fork";
const REBASE_SEAL_STEP = ":rebase-seal";

/** Closed options for {@link createScopeWorldAdapter}. */
export type ScopeWorldAdapterOptions = {
    /** Package-created binding naming the single bound resource every worker edits. */
    readonly binding: WorkspaceBinding;
    /** Package-created reference-copy carrier owning the parent custody and every fork. */
    readonly carrier: ReferenceCopyCarrier;
    /** Requested worker authority attenuated by the parent; must grant the bound resource. */
    readonly grant: ScopeResourceGrantRequest;
    /** Authenticated writer of the parent scope holding reference-copy world custody. */
    readonly parent: ScopeWriter;
    /** Open writable trace store holding the parent registration. */
    readonly store: SQLiteTraceStore;
};

/**
 * Creates the concrete world adapter the coding and runtime supervisors compose over scope forks,
 * merges, discards, and changesets.
 *
 * `fork` captures the parent's current custody as the origin and forks one child scope with
 * reference-copy custody under the parent writer. With `sourceCustodyId` it instead captures that
 * custody's current content and forks a nested child of the source's scope, so the new custody
 * starts from the source's working tree (the runtime supervisor's cross-agent handoff). A fork
 * command already completed returns its retained receipt without carrier work. Every forked scope
 * is written only under a writer claimed with its own fork command identity, so a nested fork,
 * merge, or discard beneath it re-derives the same claim. `merge` always lands the custody in the
 * parent world. A custody forked from the parent world merges into it at both current heads. A
 * nested custody is rebased: its changes relative to its lineage's base revision (the parent world
 * its first ancestor was forked from, so they include what it inherited from its source, but never
 * what the source wrote after the fork) must not overlap the parent world's changes since that base,
 * or the merge fails with {@link ScopeMergeConflictError} before anything is retained; they are then
 * published into a fresh fork of the current parent world, the nested custody is sealed by a discard
 * beneath its source, and the fresh fork merges into the parent world. `discard` discards the
 * custody's subtree and cleans its custody; both return the retained receipt when the command
 * already completed, before the custody is resolved, and an interrupted rebase resumes from its
 * retained steps. `changedPaths` compares the base revision of the first parent-world fork in the
 * custody's lineage with a capture of its current custody. Custody identities are resolved through
 * the receipts the adapter returned or replayed, so a fresh process rebuilds them by re-issuing the
 * same fork commands in their original order; a replayed fork registers its lineage before opening
 * the custody, so a merge or discard can still resolve a custody whose discard already began.
 *
 * @param options - Store, parent writer, binding, carrier, and worker grant.
 * @returns A frozen adapter.
 * @throws {ScopeEvidenceError} If the parent scope is not registered in the store.
 * @throws {ScopeMergeConflictError} From `merge`, if the custody's changes overlap the parent
 * world's.
 * @throws {TypeError} If a handle is forged, the parent holds no world custody, options are
 * malformed, or a request names custody this adapter has not forked or replayed.
 *
 * @example
 * ```ts
 * const world = createScopeWorldAdapter({
 *     binding,
 *     carrier,
 *     grant: [{ atoms: ["read", "write"], resource_id: binding.binding_id, resource_kind: "workspace_binding" }],
 *     parent: parentWriter,
 *     store,
 * });
 * await runCodingSupervisor(store, { ...options, world });
 * ```
 *
 * @public
 */
export function createScopeWorldAdapter(
    options: ScopeWorldAdapterOptions,
): ApplicationWorldAdapter {
    const fields = readScopeDataObject(
        options,
        ["binding", "carrier", "grant", "parent", "store"],
        "createScopeWorldAdapter options",
    );
    const store = fields.store as SQLiteTraceStore;
    assertScopeWriter(fields.parent, store);
    assertWorkspaceBinding(fields.binding);
    assertReferenceCopyCarrier(fields.carrier);
    const grant: readonly ScopeResourceGrant[] = readScopeResourceGrants(fields.grant, "grant");
    const parent = fields.parent;
    const binding = fields.binding;
    const carrier = fields.carrier;
    if (inspectScope(store, parent.scope_id)?.world === null) {
        throw new TypeError("parent scope must hold reference-copy world custody");
    }
    const custodies = new Map<string, AdapterCustody>();
    const parentWorld = (): ScopeWorldInspection =>
        (inspectScope(store, parent.scope_id) as ScopeInspection).world as ScopeWorldInspection;
    const headOf = (scopeId: string): string =>
        (inspectScope(store, scopeId) as ScopeInspection).head.record_id;
    const entryOf = (custodyId: string): AdapterCustody => {
        const entry = custodies.get(custodyId);
        if (entry === undefined) {
            throw new TypeError(`custody ${custodyId} was not forked by this adapter`);
        }
        return entry;
    };
    const assertRetainedCustody = (scopeId: string, custodyId: string): void => {
        if (inspectScope(store, scopeId)?.world?.custody_id !== custodyId) {
            throw new TypeError(`completed command names custody other than ${custodyId}`);
        }
    };
    // A forked custody's own scope is written only under the claim named by its fork command, so
    // every later fork from, merge into, or discard beneath it re-derives the same writer.
    const writerOver = (entry: AdapterCustody | null, nowMilliseconds: number): ScopeWriter =>
        entry === null
            ? parent
            : claimScopeWriter(store, {
                  claimId: entry.forkCommandId,
                  nowMilliseconds,
                  scopeId: entry.scopeId,
              });
    // A discard requires every open scope of the subtree to hold no unreleased writer, so the claims
    // this adapter took on the custody's scope and its registered descendants (to fork from or
    // discard beneath them) are released first.
    const discardEntry = (entry: AdapterCustody, commandId: string, nowMilliseconds: number) => {
        const descends = (candidate: AdapterCustody): boolean => {
            for (let at: AdapterCustody | null = candidate; at !== null; at = at.source) {
                if (at === entry) {
                    return true;
                }
            }
            return false;
        };
        for (const candidate of custodies.values()) {
            if (
                descends(candidate) &&
                inspectScope(store, candidate.scopeId)?.state === OPEN_STATE
            ) {
                releaseScopeWriter(store, { writer: writerOver(candidate, nowMilliseconds) });
            }
        }
        return discardScope(store, {
            carrier,
            commandId,
            expectedHeadRecordId: headOf(entry.scopeId),
            nowMilliseconds,
            parent: writerOver(entry.source, nowMilliseconds),
            scopeId: entry.scopeId,
        });
    };
    const fork = async (request: ApplicationWorldForkRequest): Promise<ApplicationWorldCustody> => {
        const { commandId, nowMilliseconds, sourceCustodyId } = readForkRequest(request);
        const source = sourceCustodyId === null ? null : entryOf(sourceCustodyId);
        const retained = readScopeCommandReceipt(store, commandId);
        let receipt: ScopeForkReceipt;
        if (retained?.command === FORK_COMMAND) {
            receipt = retained.receipt;
        } else {
            const origin = source === null ? parentWorld().custody_id : (sourceCustodyId as string);
            receipt = await forkScope(store, {
                binding,
                carrier,
                commandId,
                expectedHeadRecordId: headOf(source === null ? parent.scope_id : source.scopeId),
                grant,
                nowMilliseconds,
                originRevisionId: (await carrier.captureCustody(origin)).revision_id,
                parent: writerOver(source, nowMilliseconds),
            });
        }
        // The lineage is registered before the custody is opened, so a replayed fork whose custody
        // was already discarded still resolves for a merge or discard that has not completed.
        custodies.set(receipt.world.custody_id, {
            baseRevisionId:
                source === null
                    ? (
                          (inspectScope(store, receipt.scope_id) as ScopeInspection)
                              .world as ScopeWorldInspection
                      ).base_revision_id
                    : source.baseRevisionId,
            forkCommandId: commandId,
            scopeId: receipt.scope_id,
            source,
        });
        const custody = await carrier.openCustody(receipt.world.custody_id);
        return Object.freeze({
            custody_id: custody.custody_id,
            receipt_id: receipt.completed_record_id,
            root: custody.path,
        });
    };
    const mergeIntoParent = (
        scopeId: string,
        claimId: string,
        commandId: string,
        nowMilliseconds: number,
    ) =>
        mergeScope(store, {
            carrier,
            child: claimScopeWriter(store, { claimId, nowMilliseconds, scopeId }),
            commandId,
            expectedChildHeadRecordId: headOf(scopeId),
            expectedParentHeadRecordId: headOf(parent.scope_id),
            nowMilliseconds,
            parent,
        });
    // Lands a nested custody in the parent world through a fresh fork of it. Every step replays
    // from its retained command, so a retry after any interruption converges.
    const rebase = async (
        custodyId: string,
        commandId: string,
        nowMilliseconds: number,
    ): Promise<string> => {
        const forkCommandId = `${commandId}${REBASE_FORK_STEP}`;
        const sealCommandId = `${commandId}${REBASE_SEAL_STEP}`;
        const sealed = readScopeCommandReceipt(store, sealCommandId);
        if (sealed?.command === DISCARD_COMMAND) {
            assertRetainedCustody(sealed.receipt.scope_id, custodyId);
        } else {
            const entry = entryOf(custodyId);
            const lineageBase = await carrier.openRevision(entry.baseRevisionId);
            const { changeset } = await createVerifiedWorldChangeset({
                baseRevision: lineageBase,
                carrier,
                headRevision: await carrier.captureCustody(custodyId),
            });
            const retainedFork = readScopeCommandReceipt(store, forkCommandId);
            let rebased: ScopeForkReceipt;
            if (retainedFork?.command === FORK_COMMAND) {
                rebased = retainedFork.receipt;
            } else {
                const current = await carrier.captureCustody(parentWorld().custody_id);
                const conflict = inspectRetainedWorldApplicationConflicts({
                    candidatePaths: changeset.changed_paths,
                    currentPaths: (
                        await createWorldChangeset({
                            baseRevision: lineageBase,
                            carrier,
                            headRevision: current,
                        })
                    ).changed_paths,
                });
                if (conflict !== null) {
                    throw new ScopeMergeConflictError(conflict);
                }
                rebased = await forkScope(store, {
                    binding,
                    carrier,
                    commandId: forkCommandId,
                    expectedHeadRecordId: headOf(parent.scope_id),
                    grant,
                    nowMilliseconds,
                    originRevisionId: current.revision_id,
                    parent,
                });
            }
            const landingCustodyId = createScopeMergeApplicationCustodyId(
                forkCommandId,
                rebased.scope_id,
            );
            if (changeset.changes.length > 0) {
                const origin = await carrier.openRevision(rebased.world.base_revision_id);
                const landed = createReferenceCopyApplicationRevisionWithIdentity(carrier, {
                    candidateChangeset: changeset,
                    currentRevisionId: origin.revision_id,
                    custodyId: landingCustodyId,
                }).revision;
                publishReferenceCopyCustodyChangeset(
                    carrier,
                    rebased.world.custody_id,
                    (
                        await createVerifiedWorldChangeset({
                            baseRevision: origin,
                            carrier,
                            headRevision: landed,
                        })
                    ).changeset,
                );
            }
            await discardEntry(entry, sealCommandId, nowMilliseconds);
            discardReferenceCopyCustodyIdentity(carrier, landingCustodyId);
        }
        const rebased = readScopeCommandReceipt(store, forkCommandId);
        if (rebased?.command !== FORK_COMMAND) {
            throw new TypeError(`sealed custody ${custodyId} retains no rebase fork`);
        }
        return (
            await mergeIntoParent(
                rebased.receipt.scope_id,
                forkCommandId,
                commandId,
                nowMilliseconds,
            )
        ).child_merged_record_id;
    };
    const merge = async (
        request: ApplicationWorldMergeRequest,
    ): Promise<ApplicationWorldReceipt> => {
        const { commandId, custodyId, nowMilliseconds } = readRequest(request, "merge request");
        const retained = readScopeCommandReceipt(store, commandId);
        if (retained?.command === MERGE_COMMAND) {
            const sealed = readScopeCommandReceipt(store, `${commandId}${REBASE_SEAL_STEP}`);
            assertRetainedCustody(
                sealed?.command === DISCARD_COMMAND
                    ? sealed.receipt.scope_id
                    : retained.receipt.child_scope_id,
                custodyId,
            );
            return Object.freeze({ receipt_id: retained.receipt.child_merged_record_id });
        }
        const sealed = readScopeCommandReceipt(store, `${commandId}${REBASE_SEAL_STEP}`);
        const entry = sealed?.command === DISCARD_COMMAND ? null : entryOf(custodyId);
        const receiptId =
            entry !== null && entry.source === null
                ? (
                      await mergeIntoParent(
                          entry.scopeId,
                          entry.forkCommandId,
                          commandId,
                          nowMilliseconds,
                      )
                  ).child_merged_record_id
                : await rebase(custodyId, commandId, nowMilliseconds);
        return Object.freeze({ receipt_id: receiptId });
    };
    const discard = async (
        request: ApplicationWorldDiscardRequest,
    ): Promise<ApplicationWorldReceipt> => {
        const { commandId, custodyId, nowMilliseconds } = readRequest(request, "discard request");
        const retained = readScopeCommandReceipt(store, commandId);
        if (retained?.command === DISCARD_COMMAND) {
            assertRetainedCustody(retained.receipt.scope_id, custodyId);
            return Object.freeze({ receipt_id: retained.receipt.decided_record_id });
        }
        const discarded = await discardEntry(entryOf(custodyId), commandId, nowMilliseconds);
        return Object.freeze({ receipt_id: discarded.decided_record_id });
    };
    const changedPaths = async (custodyId: string): Promise<readonly string[]> => {
        const entry = entryOf(custodyId);
        const changeset = await createWorldChangeset({
            baseRevision: await carrier.openRevision(entry.baseRevisionId),
            carrier,
            headRevision: await carrier.captureCustody(custodyId),
        });
        return changeset.changed_paths;
    };
    return Object.freeze({ changedPaths, discard, fork, merge });
}

/** Adapter-held lineage of one forked custody. */
type AdapterCustody = {
    /** Base revision of the first fork of the parent world in this custody's lineage. */
    readonly baseRevisionId: string;
    /** Fork command identity; also the claim identity of the custody's own scope writer. */
    readonly forkCommandId: string;
    /** Child scope holding the custody. */
    readonly scopeId: string;
    /** Custody this one was forked from, or null for a fork of the parent world. */
    readonly source: AdapterCustody | null;
};

function readForkRequest(value: unknown): {
    readonly commandId: string;
    readonly nowMilliseconds: number;
    readonly sourceCustodyId: string | null;
} {
    const subject = "fork request";
    const fields = readScopeDataObject(
        value,
        ["commandId", "nowMilliseconds", "workerId"],
        subject,
        ["sourceCustodyId"],
    );
    assertScopeText(fields.commandId, `${subject} commandId`);
    assertScopeText(fields.workerId, `${subject} workerId`);
    if (fields.sourceCustodyId !== undefined) {
        assertScopeText(fields.sourceCustodyId, `${subject} sourceCustodyId`);
    }
    return {
        commandId: fields.commandId,
        nowMilliseconds: readNowMilliseconds(fields.nowMilliseconds, `${subject} nowMilliseconds`),
        sourceCustodyId: (fields.sourceCustodyId as string | undefined) ?? null,
    };
}

function readRequest(
    value: unknown,
    subject: string,
): { readonly commandId: string; readonly custodyId: string; readonly nowMilliseconds: number } {
    const fields = readScopeDataObject(
        value,
        ["commandId", "custodyId", "nowMilliseconds", "workerId"],
        subject,
    );
    assertScopeText(fields.commandId, `${subject} commandId`);
    assertScopeText(fields.workerId, `${subject} workerId`);
    assertScopeText(fields.custodyId, `${subject} custodyId`);
    return {
        commandId: fields.commandId,
        custodyId: fields.custodyId,
        nowMilliseconds: readNowMilliseconds(fields.nowMilliseconds, `${subject} nowMilliseconds`),
    };
}
