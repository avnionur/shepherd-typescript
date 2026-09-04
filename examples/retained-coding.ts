import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { createStaticProvider } from "@avnionur/shepherd-typescript/providers";
import { executeTask, inspectDurableTaskExecution } from "@avnionur/shepherd-typescript/runs";
import { schema, task } from "@avnionur/shepherd-typescript/tasks";
import { SQLiteTraceStore } from "@avnionur/shepherd-typescript/trace";
import {
    captureTaskWorldDurably,
    createReferenceCopyCarrier,
    createRetainedWorldRunner,
    createWorkspaceBindings,
    createWorldChangesetInspection,
    initializeWorkspace,
    prepareRetainedWorldSettlement,
    selectRetainedWorldSettlement,
} from "@avnionur/shepherd-typescript/workspace";

// Pass a NEW demo directory and the shipped JSON scenario. Never reuse a user checkout.
const [directory, configurationPath, ...extra] = process.argv.slice(2);
assert.ok(
    directory && configurationPath && extra.length === 0,
    "Usage: node retained-coding.ts <new-directory> <configuration.json>",
);
const configuration = schema
    .object({
        sourceFile: schema.string(),
        before: schema.string(),
        after: schema.string(),
        storeFile: schema.string(),
        bindingName: schema.string(),
        taskName: schema.string(),
        taskVersion: schema.string(),
        instruction: schema.string(),
        providerId: schema.string(),
        model: schema.string(),
        runnerId: schema.string(),
        runId: schema.string(),
        captureId: schema.string(),
        commandId: schema.string(),
    })
    .parse(JSON.parse(readFileSync(configurationPath, "utf8")));
for (const filename of [configuration.sourceFile, configuration.storeFile]) {
    assert.match(
        filename,
        /^[A-Za-z0-9][A-Za-z0-9._-]*$/u,
        "scenario filenames must be portable basenames",
    );
}
const workspaceRoot = path.resolve(directory);
mkdirSync(workspaceRoot); // EEXIST deliberately refuses repeat runs before any file write.
const sourcePath = path.join(workspaceRoot, configuration.sourceFile);
writeFileSync(sourcePath, configuration.before, { flag: "wx" });

const workspace = initializeWorkspace({
    adopt: "none",
    initializeGit: false,
    rootPath: workspaceRoot,
});
const binding = createWorkspaceBindings({
    bindings: [{ name: configuration.bindingName, root: "." }],
    workspaceRoot,
}).bindings[0];
assert.ok(binding);
const carrier = createReferenceCopyCarrier({ workspaceRoot });
const baseRevision = await carrier.snapshot(binding);
const inputSchema = schema.object({ source: schema.string() });
const outputSchema = schema.string();
const descriptor = task({
    input: inputSchema,
    output: outputSchema,
    instruction: configuration.instruction,
    name: configuration.taskName,
    version: configuration.taskVersion,
});
const input = { source: configuration.before };
const provider = createStaticProvider({
    descriptor: { id: configuration.providerId, model: configuration.model },
    exchanges: [
        {
            request: {
                input,
                instruction: descriptor.instruction,
                outputSchema: descriptor.artifact.output_schema,
            },
            response: {
                output: configuration.after,
                // This offline cassette makes no model request and reports no token usage or charge.
                usage: {
                    inputTokens: 0,
                    outputTokens: 0,
                    cacheReadInputTokens: 0,
                    cacheCreationInputTokens: 0,
                    costUsd: 0,
                },
            },
        },
    ],
});
const runner = createRetainedWorldRunner<typeof inputSchema, typeof outputSchema>({
    enforcement: "advisory",
    runnerId: configuration.runnerId,
    run: async (context) => {
        assert.equal(
            await context.world.readText(configuration.sourceFile),
            context.execution.input.source,
        );
        const execution = await executeTask(context.execution);
        assert.equal(execution.outcome.outcome.status, "finished");
        if (execution.outcome.outcome.status === "finished") {
            await context.world.writeText(
                configuration.sourceFile,
                descriptor.parseOutput(execution.outcome.outcome.value),
            );
        }
        return execution;
    },
});
const storePath = path.join(workspace.control_path, configuration.storeFile);
using store = new SQLiteTraceStore(storePath);
const captured = await captureTaskWorldDurably({
    binding,
    carrier,
    baseRevision,
    runner,
    store,
    captureId: configuration.captureId,
    execution: { task: descriptor, input, provider, runId: configuration.runId, budget: {} },
});
const inspection = await createWorldChangesetInspection({
    carrier,
    baseRevision,
    headRevision: await carrier.openRevision(captured.output.head_revision_id),
});
const change = inspection.change(configuration.sourceFile);
assert.ok(change?.after?.kind === "file");
const retainedSource = new TextDecoder().decode(
    (await inspection.readContent({ contentId: change.after.content_id })).bytes,
);
const beforeSelection = readFileSync(sourcePath, "utf8");
assert.equal(beforeSelection, configuration.before);
assert.equal(retainedSource, configuration.after);

// This is the explicit approval point: inspection alone never authorizes publication.
await prepareRetainedWorldSettlement({
    action: "select",
    binding,
    carrier,
    store,
    output: captured.output,
    commandId: configuration.commandId,
});
await selectRetainedWorldSettlement({
    binding,
    carrier,
    store,
    outputId: captured.output.output_id,
});
const afterSelection = readFileSync(sourcePath, "utf8");
assert.equal(afterSelection, retainedSource);
store.close();
using reopened = new SQLiteTraceStore(storePath, { readOnly: true });
const evidence = inspectDurableTaskExecution(reopened, configuration.runId);
assert.equal(evidence.status, "committed");
assert.equal(evidence.settlements.length, 1);
assert.equal(evidence.settlements[0]?.output_id, captured.output.output_id);
process.stdout.write(
    `${JSON.stringify({
        changedPaths: inspection.changeset.changes.map((entry) => entry.path),
        beforeSelection,
        retainedSource,
        afterSelection,
        runStatus: evidence.status,
        settlementStates: evidence.settlements.map((entry) => entry.state),
    })}\n`,
);
