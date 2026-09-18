import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { TestContext } from "node:test";

import {
    type ApplicationWorldAdapter,
    type CodingSupervisorWorkerProgram,
    claimScopeWriter,
    createScopeWorldAdapter,
    forkScope,
    inspectScope,
    type ScopeForkReceipt,
    type ScopeWriter,
} from "../../src/index.ts";
import {
    bindingGrant,
    createForkWorkspace,
    type ForkWorkspace,
    forkOptions,
} from "../scope/fork-fixtures.ts";

/** One fixture workspace with a world-bearing parent scope and the adapter over it. */
export type SupervisorWorld = ForkWorkspace & {
    readonly adapter: ApplicationWorldAdapter;
    readonly parent: ScopeForkReceipt;
    readonly parentWriter: ScopeWriter;
};

/** Forks a world parent from the fixture root and creates the scope world adapter over it. */
export async function createSupervisorWorld(
    context: TestContext,
    label: string,
): Promise<SupervisorWorld> {
    const workspace = await createForkWorkspace(context, label);
    const snapshot = await workspace.carrier.snapshot(workspace.source);
    const parent = await forkScope(workspace.store, {
        ...forkOptions(workspace, snapshot.revision_id),
        commandId: "scope-command:fork-supervisor-parent",
    });
    const parentWriter = claimScopeWriter(workspace.store, {
        claimId: "claim:supervisor-parent",
        nowMilliseconds: 1_500,
        scopeId: parent.scope_id,
    });
    const adapter = createScopeWorldAdapter({
        binding: workspace.source,
        carrier: workspace.carrier,
        grant: [bindingGrant(workspace.source)],
        parent: parentWriter,
        store: workspace.store,
    });
    return { ...workspace, adapter, parent, parentWriter };
}

/**
 * Program that writes its input text into the custody file and reports the edit together with
 * the content it found there and the number of consumed supervisor context entries.
 */
export const writeCustodyEdit: CodingSupervisorWorkerProgram = async ({
    custody,
    input,
    supervisor_context,
}) => {
    const edit = input as { readonly path: string; readonly text: string };
    if (custody === null) {
        throw new Error("world-bearing worker requires custody");
    }
    const target = path.join(custody.root, edit.path);
    const prior = (await readFile(target, "utf8")).trim();
    await writeFile(target, `${edit.text}\n`);
    return {
        path: edit.path,
        text: `${edit.text}|prior:${prior}|context:${supervisor_context.length}`,
    };
};

/** Reads one file from the parent world custody after settlement. */
export async function readParentFile(
    world: SupervisorWorld,
    relativePath: string,
): Promise<string> {
    const custodyId = inspectScope(world.store, world.parent.scope_id)?.world?.custody_id as string;
    const custody = await world.carrier.openCustody(custodyId);
    return readFile(path.join(custody.path, relativePath), "utf8");
}
