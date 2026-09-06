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
    initializeWorkspace,
    prepareRetainedWorldSettlement,
    type RetainedWorldOutput,
    selectRetainedWorldSettlement,
} from "@avnionur/shepherd-typescript/workspace";

const [directory, configurationPath, ...extra] = process.argv.slice(2);
assert.ok(
    directory && configurationPath && extra.length === 0,
    "Usage: node multiple-bindings.ts <new-directory> <scenario.json>",
);
const raw: unknown = JSON.parse(readFileSync(configurationPath, "utf8"));
assert.ok(raw !== null && typeof raw === "object" && "settings" in raw && "bindings" in raw);
const settings = schema
    .object({
        storeFile: schema.string(),
        instruction: schema.string(),
        taskVersion: schema.string(),
        model: schema.string(),
    })
    .parse(raw.settings);
assert.ok(Array.isArray(raw.bindings) && raw.bindings.length > 1);
const bindingSchema = schema.object({
    name: schema.string(),
    directory: schema.string(),
    file: schema.string(),
    before: schema.string(),
    after: schema.string(),
    taskName: schema.string(),
    providerId: schema.string(),
    runnerId: schema.string(),
    runId: schema.string(),
    captureId: schema.string(),
    commandId: schema.string(),
});
const scenarios = raw.bindings.map((entry: unknown) => bindingSchema.parse(entry));
for (const name of [
    settings.storeFile,
    ...scenarios.flatMap((entry) => [entry.directory, entry.file]),
]) {
    assert.match(
        name,
        /^[A-Za-z0-9][A-Za-z0-9._-]*$/u,
        "scenario paths must be portable basenames",
    );
}
assert.equal(
    new Set(scenarios.map((entry) => entry.directory.toLowerCase())).size,
    scenarios.length,
);
const workspaceRoot = path.resolve(directory);
mkdirSync(workspaceRoot); // Refuse any existing destination before modifying its contents.
for (const scenario of scenarios) {
    mkdirSync(path.join(workspaceRoot, scenario.directory));
    writeFileSync(path.join(workspaceRoot, scenario.directory, scenario.file), scenario.before, {
        flag: "wx",
    });
}
const workspace = initializeWorkspace({
    rootPath: workspaceRoot,
    adopt: "none",
    initializeGit: false,
});
const { bindings } = createWorkspaceBindings({
    workspaceRoot,
    bindings: scenarios.map((entry) => ({ name: entry.name, root: entry.directory })),
});
const carrier = createReferenceCopyCarrier({ workspaceRoot });
const storePath = path.join(workspace.control_path, settings.storeFile);
using store = new SQLiteTraceStore(storePath);
const captures: RetainedWorldOutput[] = [];
const inputSchema = schema.object({ source: schema.string() });
const outputSchema = schema.string();

// Each invocation receives exactly one world. Captures are deliberately sequential.
for (const scenario of scenarios) {
    const binding = bindings.find((entry) => entry.name === scenario.name);
    assert.ok(binding);
    const baseRevision = await carrier.snapshot(binding);
    const descriptor = task({
        input: inputSchema,
        output: outputSchema,
        name: scenario.taskName,
        version: settings.taskVersion,
        instruction: settings.instruction,
    });
    const input = { source: scenario.before };
    const provider = createStaticProvider({
        descriptor: { id: scenario.providerId, model: settings.model },
        exchanges: [
            {
                request: {
                    input,
                    instruction: descriptor.instruction,
                    outputSchema: descriptor.artifact.output_schema,
                },
                response: {
                    output: scenario.after,
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
        runnerId: scenario.runnerId,
        enforcement: "advisory",
        run: async (context) => {
            assert.equal(context.world.binding_id, binding.binding_id);
            assert.equal(await context.world.readText(scenario.file), scenario.before);
            const result = await executeTask(context.execution);
            assert.equal(result.outcome.outcome.status, "finished");
            if (result.outcome.outcome.status === "finished") {
                await context.world.writeText(
                    scenario.file,
                    descriptor.parseOutput(result.outcome.outcome.value),
                );
            }
            return result;
        },
    });
    const capture = await captureTaskWorldDurably({
        binding,
        carrier,
        baseRevision,
        runner,
        store,
        captureId: scenario.captureId,
        execution: { input, task: descriptor, provider, runId: scenario.runId, budget: {} },
    });
    assert.equal(capture.output.binding_id, binding.binding_id);
    captures.push(capture.output);
    for (const sibling of scenarios) {
        assert.equal(
            readFileSync(path.join(workspaceRoot, sibling.directory, sibling.file), "utf8"),
            sibling.before,
        );
    }
}
assert.equal(new Set(captures.map((entry) => entry.output_id)).size, scenarios.length);
const beforeSelection = scenarios.map((entry) =>
    readFileSync(path.join(workspaceRoot, entry.directory, entry.file), "utf8"),
);
const afterEachSelection: string[][] = [];
for (const [index, scenario] of scenarios.entries()) {
    const binding = bindings.find((entry) => entry.name === scenario.name);
    const output = captures[index];
    assert.ok(binding && output);
    // An application should obtain approval here for this exact binding/output.
    await prepareRetainedWorldSettlement({
        action: "select",
        binding,
        carrier,
        store,
        output,
        commandId: scenario.commandId,
    });
    await selectRetainedWorldSettlement({ binding, carrier, store, outputId: output.output_id });
    const state = scenarios.map((entry) =>
        readFileSync(path.join(workspaceRoot, entry.directory, entry.file), "utf8"),
    );
    assert.deepEqual(
        state,
        scenarios.map((entry, siblingIndex) =>
            siblingIndex <= index ? entry.after : entry.before,
        ),
    );
    afterEachSelection.push(state);
}
store.close();
using reopened = new SQLiteTraceStore(storePath, { readOnly: true });
const settlementStates = scenarios.map((scenario, index) => {
    const inspection = inspectDurableTaskExecution(reopened, scenario.runId);
    assert.equal(inspection.status, "committed");
    assert.equal(inspection.settlements.length, 1);
    assert.equal(inspection.settlements[0]?.output_id, captures[index]?.output_id);
    return inspection.settlements.map((entry) => entry.state);
});
process.stdout.write(
    `${JSON.stringify({
        bindings: scenarios.map((entry) => entry.name),
        beforeSelection,
        afterEachSelection,
        settlementStates,
    })}\n`,
);
