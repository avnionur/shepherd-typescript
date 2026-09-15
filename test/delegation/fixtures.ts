import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { TestContext } from "node:test";

import {
    type ChildRunRootParent,
    createStaticProvider,
    type ModelProvider,
    type RunBudgetDefinition,
    type ScopeResourceGrant,
    schema,
    type TaskDescriptor,
    type TaskSchema,
    task,
} from "../../src/index.ts";

/** Creates one temporary file-backed trace store path removed after the test. */
export async function temporaryDatabasePath(context: TestContext, label: string): Promise<string> {
    const directory = await mkdtemp(path.join(tmpdir(), `shepherd-delegation-${label}-`));
    context.after(() => rm(directory, { force: true, recursive: true }));
    return path.join(directory, "trace.sqlite");
}

/** String-to-string echo task. */
export const echoTask = task({
    input: schema.string(),
    instruction: "Echo the input.",
    name: "echo",
    output: schema.string(),
    version: "1",
});

/** Object-to-object summary task. */
export const summaryTask = task({
    input: schema.object({ topic: schema.string() }),
    instruction: "Summarize the topic.",
    name: "summarize",
    output: schema.object({ text: schema.string() }),
    version: "1",
});

/** Void-to-void task. */
export const voidTask = task({
    input: schema.void(),
    instruction: "Do nothing.",
    name: "noop",
    output: schema.void(),
    version: "1",
});

/** One canonical repository grant. */
export function grantOf(
    atoms: readonly ("read" | "write")[],
    resourceId = "repo:main",
): ScopeResourceGrant {
    return { atoms, resource_id: resourceId, resource_kind: "repository_binding" };
}

/** Root declaration with a read/write ceiling on the main repository. */
export function rootParent(
    overrides: Partial<Omit<ChildRunRootParent, "kind">> = {},
): ChildRunRootParent {
    return {
        budget: { maxTurns: 4 },
        ceiling: [grantOf(["read", "write"])],
        kind: "root",
        ...overrides,
    };
}

/** Static provider answering one exact task request. */
export function providerFor(
    descriptor: TaskDescriptor<TaskSchema<unknown>, TaskSchema<unknown>>,
    input: unknown,
    output: unknown,
    id = "provider:delegation",
): ModelProvider {
    return createStaticProvider({
        descriptor: { id, model: "fixture-v1" },
        exchanges: [
            {
                request: {
                    input: input as never,
                    instruction: descriptor.instruction,
                    outputSchema: descriptor.artifact.output_schema,
                },
                response: {
                    output: output as never,
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
}

/** Options shared by most opening commands. */
export function openOptions(commandId: string, budget: RunBudgetDefinition = { maxTurns: 2 }) {
    return {
        budget,
        commandId,
        grant: [grantOf(["read"])],
        input: "hello",
        parent: rootParent(),
        supervisorId: "supervisor:lead",
        task: echoTask,
    };
}
