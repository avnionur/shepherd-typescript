import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

import {
    captureTaskWorldDurably,
    createReferenceCopyCarrier,
    createRetainedWorldRunner,
    createStaticProvider,
    createWorkspaceBindings,
    createWorldChangesetInspection,
    executeTask,
    initializeWorkspace,
    prepareRetainedWorldSettlement,
    SQLiteTraceStore,
    schema,
    selectRetainedWorldSettlement,
    task,
} from "@avnionur/shepherd-typescript";

const NOTE_PATH = "NOTE.txt";
const NOTE_TEXT = "Hello from a Shepherd retained output.\n";
// Bind only this dedicated subdirectory, never the whole working directory: a local install puts
// node_modules beside this script, and capturing it makes the first run slow and large.
const BINDING_DIRECTORY = "quickstart-workspace";
const workspaceRoot = process.cwd();
const bindingRoot = path.join(workspaceRoot, BINDING_DIRECTORY);
const workspace = initializeWorkspace({
    adopt: "none",
    initializeGit: false,
    rootPath: workspaceRoot,
});
mkdirSync(bindingRoot, { recursive: true });
const binding = createWorkspaceBindings({
    bindings: [{ name: "workspace", root: BINDING_DIRECTORY }],
    workspaceRoot,
}).bindings[0];
if (binding === undefined) throw new Error("quickstart binding is unavailable");

const carrier = createReferenceCopyCarrier({ workspaceRoot });
const baseRevision = await carrier.snapshot(binding);
const descriptor = task({
    input: schema.void(),
    instruction: "Write the configured offline quickstart note.",
    name: "quickstart-write-note",
    output: schema.string(),
    version: "1",
});
const provider = createStaticProvider({
    descriptor: { id: "provider:quickstart", model: "offline-v1" },
    exchanges: [
        {
            request: {
                input: null,
                instruction: descriptor.instruction,
                outputSchema: descriptor.artifact.output_schema,
            },
            response: {
                output: "complete",
                usage: {
                    cacheCreationInputTokens: 0,
                    cacheReadInputTokens: 0,
                    costUsd: null,
                    inputTokens: 1,
                    outputTokens: 1,
                },
            },
        },
    ],
});
const runner = createRetainedWorldRunner({
    enforcement: "advisory",
    runnerId: "runner:quickstart",
    run: async (context) => {
        await context.world.writeText(NOTE_PATH, NOTE_TEXT);
        return executeTask(context.execution);
    },
});

using store = new SQLiteTraceStore(path.join(workspace.control_path, "quickstart-trace.sqlite"));
const captured = await captureTaskWorldDurably({
    baseRevision,
    binding,
    captureId: "capture:quickstart",
    carrier,
    execution: {
        budget: { maxTurns: 1 },
        input: undefined,
        provider,
        runId: "run:quickstart",
        task: descriptor,
    },
    runner,
    store,
});
if (existsSync(path.join(bindingRoot, NOTE_PATH))) {
    throw new Error("quickstart changed the user workspace before settlement");
}

const headRevision = await carrier.openRevision(captured.output.head_revision_id);
const inspection = await createWorldChangesetInspection({
    baseRevision,
    carrier,
    headRevision,
});
const changedPaths = inspection.changeset.changes.map(({ path: changedPath }) => changedPath);
const noteChange = inspection.change(NOTE_PATH);
if (noteChange?.after?.kind !== "file") throw new Error("quickstart note is unavailable");
const retainedNote = await inspection.readContent({ contentId: noteChange.after.content_id });
const retainedText = new TextDecoder().decode(retainedNote.bytes);
process.stdout.write(`[${changedPaths.map((changedPath) => `'${changedPath}'`).join(", ")}]\n`);
process.stdout.write(retainedText);

await prepareRetainedWorldSettlement({
    action: "select",
    binding,
    carrier,
    commandId: "settlement:quickstart",
    output: captured.output,
    store,
});
await selectRetainedWorldSettlement({
    binding,
    carrier,
    outputId: captured.output.output_id,
    store,
});
if (readFileSync(path.join(bindingRoot, NOTE_PATH), "utf8") !== NOTE_TEXT) {
    throw new Error("quickstart selected note does not match retained bytes");
}
