import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { TestContext } from "node:test";
import {
    createReferenceCopyCarrier,
    createStaticProvider,
    createWorkspaceBindings,
    initializeWorkspace,
    schema,
    task,
} from "../../src/index.ts";

/** Creates a fresh public capture fixture whose user file starts with `original`. */
export async function createWorldEffectFixture(context: TestContext) {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "world-effect-"));
    context.after(() => rm(workspaceRoot, { recursive: true, force: true }));
    initializeWorkspace({ rootPath: workspaceRoot, adopt: "none", initializeGit: false });
    await mkdir(path.join(workspaceRoot, "source"));
    await writeFile(path.join(workspaceRoot, "source", "value.txt"), "original");
    return openWorldEffectFixture(workspaceRoot);
}

/** Reopens fixture authority without writing the user's source file, including in crash workers. */
export async function openWorldEffectFixture(workspaceRoot: string) {
    const binding = createWorkspaceBindings({
        workspaceRoot,
        bindings: [{ name: "source", root: "source" }],
    }).bindings[0];
    if (binding === undefined) throw new Error("fixture binding missing");
    const carrier = createReferenceCopyCarrier({ workspaceRoot });
    const baseRevision = await carrier.snapshot(binding);
    const definition = task({
        name: "world-history",
        version: "1.0.0",
        input: schema.void(),
        output: schema.string(),
        instruction: "Return complete.",
    });
    const provider = createStaticProvider({
        descriptor: { id: "history", model: "offline" },
        exchanges: [
            {
                request: {
                    instruction: definition.instruction,
                    input: null,
                    outputSchema: definition.artifact.output_schema,
                },
                response: {
                    output: "complete",
                    usage: {
                        inputTokens: 1,
                        outputTokens: 1,
                        cacheReadInputTokens: 0,
                        cacheCreationInputTokens: 0,
                        costUsd: null,
                    },
                },
            },
        ],
    });
    return {
        workspaceRoot,
        sourceRoot: path.join(workspaceRoot, "source"),
        storePath: path.join(workspaceRoot, "trace.sqlite"),
        options: {
            baseRevision,
            binding,
            captureId: "capture:history",
            carrier,
            execution: {
                task: definition,
                input: undefined,
                provider,
                runId: "run:history",
                budget: { maxTurns: 1 },
            },
        },
    };
}
