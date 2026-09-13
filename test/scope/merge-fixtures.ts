import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { TestContext } from "node:test";

import {
    claimScopeWriter,
    forkScope,
    inspectScope,
    type ScopeForkReceipt,
    type ScopeWriter,
    SQLiteTraceStore,
} from "../../src/index.ts";
import {
    bindingGrant,
    createForkWorkspace,
    type ForkWorkspace,
    forkOptions,
} from "./fork-fixtures.ts";

/** A root, a forked world parent, and a forked world child with claimed writers. */
export type NestedWorld = ForkWorkspace & {
    readonly child: ScopeForkReceipt;
    readonly childWriter: ScopeWriter;
    readonly parent: ScopeForkReceipt;
    readonly parentWriter: ScopeWriter;
};

/** Forks a world parent from the fixture root and a world child from that parent. */
export async function createNestedWorld(
    context: TestContext,
    label: string,
    StoreClass: typeof SQLiteTraceStore = SQLiteTraceStore,
): Promise<NestedWorld> {
    const workspace = await createForkWorkspace(context, label, StoreClass);
    const snapshot = await workspace.carrier.snapshot(workspace.source);
    const parent = await forkScope(workspace.store, {
        ...forkOptions(workspace, snapshot.revision_id),
        commandId: "scope-command:fork-parent",
    });
    const parentWriter = claimScopeWriter(workspace.store, {
        claimId: "claim:parent",
        nowMilliseconds: 1_500,
        scopeId: parent.scope_id,
    });
    const child = await forkChild(workspace, parent, parentWriter, "scope-command:fork-child");
    const childWriter = claimScopeWriter(workspace.store, {
        claimId: "claim:child",
        nowMilliseconds: 1_500,
        scopeId: child.scope_id,
    });
    return { ...workspace, child, childWriter, parent, parentWriter };
}

/** Forks one world child of a world parent from the parent's current custody. */
export async function forkChild(
    workspace: ForkWorkspace,
    parent: { readonly scope_id: string; readonly world: { readonly custody_id: string } },
    parentWriter: ScopeWriter,
    commandId: string,
): Promise<ScopeForkReceipt> {
    const origin = await workspace.carrier.captureCustody(parent.world.custody_id);
    return forkScope(workspace.store, {
        binding: workspace.source,
        carrier: workspace.carrier,
        commandId,
        expectedHeadRecordId: headOf(workspace.store, parent.scope_id),
        grant: [bindingGrant(workspace.source)],
        nowMilliseconds: 1_500,
        originRevisionId: origin.revision_id,
        parent: parentWriter,
    });
}

/** Returns the current head record of one scope. */
export function headOf(store: SQLiteTraceStore, scopeId: string): string {
    return inspectScope(store, scopeId)?.head.record_id as string;
}

/** Writes one file into the mutable custody of a forked scope. */
export async function writeCustody(
    workspace: ForkWorkspace,
    custodyId: string,
    relativePath: string,
    content: string,
): Promise<void> {
    const custody = await workspace.carrier.openCustody(custodyId);
    await writeFile(path.join(custody.path, relativePath), content);
}
