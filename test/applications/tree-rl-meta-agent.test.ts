import assert from "node:assert/strict";
import { test } from "node:test";

import {
    ApplicationProtocolError,
    ApplicationVerificationError,
    createMetaAgentTreeRlForkSelector,
    createStaticProvider,
    deriveApplicationOwnerId,
    type ModelProvider,
    type ModelRequest,
    runTreeRlRollouts,
    SQLiteTraceStore,
} from "../../src/index.ts";
import {
    recordRoots,
    renderToolCall,
    treeRlDefinition,
    treeRlOptions,
    treeRlProtocol,
} from "./tree-rl-fixtures.ts";

const TOOL_CALL = {
    arguments: { command: 'pip install requests && python -c "import requests"' },
    name: "bash",
};

/** Meta-agent provider answering every request with `answer`, logging each request. */
function metaAgent(answer: (request: ModelRequest) => unknown): ModelProvider & {
    readonly requests: ModelRequest[];
} {
    const requests: ModelRequest[] = [];
    const { descriptor } = createStaticProvider({
        descriptor: { id: "provider:meta-agent", model: "fixture-meta-v1" },
        exchanges: [],
    });
    return {
        descriptor,
        invoke: async (request: ModelRequest) => {
            requests.push(request);
            return {
                output: answer(request) as never,
                usage: {
                    cacheCreationInputTokens: 0,
                    cacheReadInputTokens: 0,
                    costUsd: null,
                    inputTokens: 1,
                    outputTokens: 1,
                },
            };
        },
        requests,
    };
}

function surface(role: string): Record<string, unknown> {
    return (treeRlDefinition.surfaces as readonly Record<string, unknown>[]).find(
        (entry) => entry.role === role,
    ) as Record<string, unknown>;
}

test("the meta-agent selector sends the numbered turns and reward, and its clamped proposal seeds the first branch", async () => {
    using store = new SQLiteTraceStore();
    const labels = await recordRoots(store);
    const provider = metaAgent((request) => {
        const input = request.input as { readonly reward: number };
        // Out-of-range turns are clamped into [1, T - 2] = [1, 3].
        return {
            branch_turn: input.reward === 1 ? 9 : -4,
            reason: "the first turn installed the wrong package",
            tool_call: TOOL_CALL,
        };
    });
    const { batch, inspection } = await runTreeRlRollouts(
        store,
        treeRlOptions("application:tree-rl:meta-agent", labels, {
            selector: createMetaAgentTreeRlForkSelector({ provider }),
        }),
    );
    assert.equal(provider.requests.length, 2);
    const [request] = provider.requests;
    assert.equal(request?.instruction, surface("fork_selector").content);
    assert.deepEqual(request?.outputSchema, surface("fork_proposal").content);
    const input = request?.input as {
        readonly prompt_id: string;
        readonly reward: number;
        readonly turn_bounds: { readonly first: number; readonly last: number };
        readonly turn_count: number;
        readonly turns: readonly {
            readonly output: unknown;
            readonly request: { readonly input: unknown; readonly instruction: string };
            readonly step_index: number;
            readonly turn: number;
        }[];
    };
    assert.equal(input.prompt_id, "task");
    assert.equal(input.reward, 1);
    assert.deepEqual(input.turn_bounds, { first: 1, last: 3 });
    assert.equal(input.turn_count, 5);
    assert.deepEqual(
        input.turns.map((turn) => [turn.turn, turn.step_index, turn.request.instruction]),
        [
            [1, 0, "perform plan"],
            [2, 1, "perform explore"],
            [3, 2, "perform draft"],
            [4, 3, "perform note"],
            [5, 4, "perform answer"],
        ],
    );
    assert.deepEqual(input.turns[0]?.output, { text: "base:plan" });
    assert.deepEqual(
        inspection.roots.map((root) => [
            root.fork.proposed_turn,
            root.fork.branch_turn,
            root.fork.fork_point.step_index,
            root.fork.tool_call,
        ]),
        [
            [9, 3, 2, TOOL_CALL],
            [-4, 1, 0, TOOL_CALL],
        ],
    );
    assert.deepEqual(
        inspection.rollouts.map((entry) => [entry.branch, entry.seeded]),
        [
            [0, true],
            [1, false],
            [0, true],
            [1, false],
        ],
    );
    const seeded = batch.lines.find((line) => line.seeded && line.member === "branch");
    assert.equal(seeded?.branch_turn, 3);
    assert.deepEqual(
        seeded?.actions.map((action) => action.segment),
        ["prefix", "prefix", "suffix", "suffix", "suffix"],
    );
    assert.ok(renderToolCall(TOOL_CALL).text.startsWith("bash("));
});

test("a malformed meta-agent proposal is a verification failure and a protocol without the selector surfaces is refused", async () => {
    using store = new SQLiteTraceStore();
    const labels = await recordRoots(store);
    const commandId = "application:tree-rl:meta-agent:malformed";
    for (const output of [
        { branch_turn: 2, reason: "no tool call" },
        { branch_turn: 2.5, reason: "x", tool_call: TOOL_CALL },
        { branch_turn: 2, reason: "", tool_call: TOOL_CALL },
        { branch_turn: 2, reason: "x", tool_call: { arguments: [], name: "bash" } },
        "not an object",
    ]) {
        await assert.rejects(
            runTreeRlRollouts(
                store,
                treeRlOptions(commandId, labels, {
                    concurrency: 1,
                    selector: createMetaAgentTreeRlForkSelector({
                        provider: metaAgent(() => output),
                    }),
                }),
            ),
            ApplicationVerificationError,
            JSON.stringify(output),
        );
    }
    // Only the opened record is retained; a corrected rerun of the same command proceeds.
    assert.equal(store.readOwner(deriveApplicationOwnerId(commandId)).length, 1);
    const { inspection } = await runTreeRlRollouts(
        store,
        treeRlOptions(commandId, labels, {
            selector: createMetaAgentTreeRlForkSelector({
                provider: metaAgent(() => ({ branch_turn: 2, reason: "ok", tool_call: TOOL_CALL })),
            }),
        }),
    );
    assert.equal(inspection.roots.length, 2);
    const withoutSurfaces = treeRlProtocol({
        surfaces: (treeRlDefinition.surfaces as readonly Record<string, unknown>[]).filter(
            (entry) => entry.role !== "fork_selector",
        ),
    });
    await assert.rejects(
        runTreeRlRollouts(
            store,
            treeRlOptions("application:tree-rl:meta-agent:surfaces", labels, {
                protocol: withoutSurfaces,
                selector: createMetaAgentTreeRlForkSelector({
                    provider: metaAgent(() => ({ branch_turn: 2, reason: "ok", tool_call: null })),
                }),
            }),
        ),
        ApplicationProtocolError,
    );
    assert.throws(() => createMetaAgentTreeRlForkSelector({ provider: null as never }), TypeError);
    assert.throws(
        () =>
            createMetaAgentTreeRlForkSelector({
                provider: metaAgent(() => null),
                signal: 1 as never,
            }),
        TypeError,
    );
});
