import type {
    ApplicationWorldAdapter,
    ApplicationWorldCustody,
    ApplicationWorldDiscardRequest,
    ApplicationWorldForkRequest,
    ApplicationWorldMergeRequest,
    ApplicationWorldReceipt,
} from "../applications/types.ts";
import { SCOPE_COMMAND_KINDS } from "../protocol/values.generated.ts";
import { readScopeResourceGrants } from "../scope/authority.ts";
import { inspectScope } from "../scope/inspection.ts";
import { readScopeCommandReceipt } from "../scope/replay.ts";
import type {
    ScopeInspection,
    ScopeResourceGrant,
    ScopeResourceGrantRequest,
    ScopeWorldInspection,
    ScopeWriter,
} from "../scope/types.ts";
import { assertScopeText, readNowMilliseconds, readScopeDataObject } from "../scope/validation.ts";
import { assertScopeWriter, claimScopeWriter } from "../scope/writer.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import { assertWorkspaceBinding } from "./bindings.ts";
import { createWorldChangeset } from "./changesets.ts";
import { assertReferenceCopyCarrier } from "./reference-copy-carrier.ts";
import { discardScope } from "./scope-discard.ts";
import { forkScope } from "./scope-fork.ts";
import { mergeScope } from "./scope-merge.ts";
import type { ReferenceCopyCarrier, WorkspaceBinding } from "./types.ts";

const [, , , FORK_COMMAND, MERGE_COMMAND, DISCARD_COMMAND] = SCOPE_COMMAND_KINDS;

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
 * Creates the concrete world adapter the coding supervisor composes over scope forks, merges,
 * discards, and changesets.
 *
 * `fork` captures the parent's current custody as the origin and forks one child scope with
 * reference-copy custody under the parent writer; a fork command already completed returns its
 * retained receipt without carrier work. `merge` claims the child writer under the merge command
 * identity and merges the child into the parent at both current heads; `discard` discards the
 * child subtree and cleans its custody; both return the retained receipt when the command already
 * completed. `changedPaths` compares the custody's origin revision with a capture of its current
 * custody and returns the canonical changed paths. Custody identities are resolved through the
 * receipts the adapter returned or replayed, so a fresh process rebuilds them by re-issuing the
 * same fork commands.
 *
 * @param options - Store, parent writer, binding, carrier, and worker grant.
 * @returns A frozen adapter.
 * @throws {ScopeEvidenceError} If the parent scope is not registered in the store.
 * @throws {TypeError} If a handle is forged, the parent holds no world custody, or options are
 * malformed.
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
    const scopes = new Map<string, string>();
    const parentWorld = (): ScopeWorldInspection =>
        (inspectScope(store, parent.scope_id) as ScopeInspection).world as ScopeWorldInspection;
    const headOf = (scopeId: string): string =>
        (inspectScope(store, scopeId) as ScopeInspection).head.record_id;
    const scopeOf = (custodyId: string): string => {
        const scopeId = scopes.get(custodyId);
        if (scopeId === undefined) {
            throw new TypeError(`custody ${custodyId} was not forked by this adapter`);
        }
        return scopeId;
    };
    const fork = async (request: ApplicationWorldForkRequest): Promise<ApplicationWorldCustody> => {
        const { commandId, nowMilliseconds } = readRequest(request, "fork request", false);
        const retained = readScopeCommandReceipt(store, commandId);
        const receipt =
            retained?.command === FORK_COMMAND
                ? retained.receipt
                : await forkScope(store, {
                      binding,
                      carrier,
                      commandId,
                      expectedHeadRecordId: headOf(parent.scope_id),
                      grant,
                      nowMilliseconds,
                      originRevisionId: (await carrier.captureCustody(parentWorld().custody_id))
                          .revision_id,
                      parent,
                  });
        const custody = await carrier.openCustody(receipt.world.custody_id);
        scopes.set(custody.custody_id, receipt.scope_id);
        return Object.freeze({
            custody_id: custody.custody_id,
            receipt_id: receipt.completed_record_id,
            root: custody.path,
        });
    };
    const merge = async (
        request: ApplicationWorldMergeRequest,
    ): Promise<ApplicationWorldReceipt> => {
        const { commandId, custodyId, nowMilliseconds } = readRequest(
            request,
            "merge request",
            true,
        );
        const scopeId = scopeOf(custodyId);
        const retained = readScopeCommandReceipt(store, commandId);
        if (retained?.command === MERGE_COMMAND) {
            return Object.freeze({ receipt_id: retained.receipt.child_merged_record_id });
        }
        const child = claimScopeWriter(store, { claimId: commandId, nowMilliseconds, scopeId });
        const merged = await mergeScope(store, {
            carrier,
            child,
            commandId,
            expectedChildHeadRecordId: headOf(scopeId),
            expectedParentHeadRecordId: headOf(parent.scope_id),
            nowMilliseconds,
            parent,
        });
        return Object.freeze({ receipt_id: merged.child_merged_record_id });
    };
    const discard = async (
        request: ApplicationWorldDiscardRequest,
    ): Promise<ApplicationWorldReceipt> => {
        const { commandId, custodyId, nowMilliseconds } = readRequest(
            request,
            "discard request",
            true,
        );
        const scopeId = scopeOf(custodyId);
        const retained = readScopeCommandReceipt(store, commandId);
        if (retained?.command === DISCARD_COMMAND) {
            return Object.freeze({ receipt_id: retained.receipt.decided_record_id });
        }
        const discarded = await discardScope(store, {
            carrier,
            commandId,
            expectedHeadRecordId: headOf(scopeId),
            nowMilliseconds,
            parent,
            scopeId,
        });
        return Object.freeze({ receipt_id: discarded.decided_record_id });
    };
    const changedPaths = async (custodyId: string): Promise<readonly string[]> => {
        const scopeId = scopeOf(custodyId);
        const world = (inspectScope(store, scopeId) as ScopeInspection)
            .world as ScopeWorldInspection;
        const changeset = await createWorldChangeset({
            baseRevision: await carrier.openRevision(world.base_revision_id),
            carrier,
            headRevision: await carrier.captureCustody(custodyId),
        });
        return changeset.changed_paths;
    };
    return Object.freeze({ changedPaths, discard, fork, merge });
}

function readRequest(
    value: unknown,
    subject: string,
    custody: boolean,
): { readonly commandId: string; readonly custodyId: string; readonly nowMilliseconds: number } {
    const fields = readScopeDataObject(
        value,
        ["commandId", ...(custody ? ["custodyId"] : []), "nowMilliseconds", "workerId"],
        subject,
    );
    assertScopeText(fields.commandId, `${subject} commandId`);
    assertScopeText(fields.workerId, `${subject} workerId`);
    if (custody) {
        assertScopeText(fields.custodyId, `${subject} custodyId`);
    }
    return {
        commandId: fields.commandId,
        custodyId: fields.custodyId as string,
        nowMilliseconds: readNowMilliseconds(fields.nowMilliseconds, `${subject} nowMilliseconds`),
    };
}
