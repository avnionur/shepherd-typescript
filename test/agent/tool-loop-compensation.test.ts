import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import {
    createEffectCompensationRegistry,
    createEffectHandlerStack,
    createReplayToolLoopBindings,
    createToolTurnProvider,
    deriveEffectCompensationId,
    inspectEffectCompensation,
    type ReplaySessionContext,
    rewindReplaySession,
    runReplaySession,
    runToolLoop,
    SQLiteTraceStore,
    type ToolLoopTool,
} from "../../src/index.ts";
import { openRowWorld, readRowIds } from "../effect/compensation-fixtures.ts";
import { temporaryDirectory } from "../replay/fixtures.ts";
import { call, scriptedModel, text, userMessage } from "./fixtures.ts";

const tools: readonly ToolLoopTool[] = [
    {
        description: "Insert one row.",
        effectKind: "test.insert_row",
        inputSchema: {
            additionalProperties: false,
            properties: { id: { minLength: 1, type: "string" } },
            required: ["id"],
            type: "object",
        },
        name: "insert_row",
        reversibility: "compensable",
    },
];

function rowOf(payload: unknown): string {
    return (payload as { readonly input: { readonly id: string } }).input.id;
}

test("rewinding a replay-bound tool loop compensates its compensable tool calls in reverse order", async (context) => {
    const directory = await temporaryDirectory(context, "tool-compensation");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const world = path.join(directory, "world.sqlite");
    const handlers = createEffectHandlerStack([
        {
            handle: (intent) => {
                const database = openRowWorld(world);
                try {
                    database
                        .prepare("INSERT INTO rows (id, value) VALUES (?, ?)")
                        .run(rowOf(intent.payload), intent.effect_id);
                } finally {
                    database.close();
                }
                return { ok: true, value: null };
            },
            handlerId: "handler:insert_row",
            kind: "test.insert_row",
        },
    ]);
    const program = async (session: ReplaySessionContext) =>
        (
            await runToolLoop({
                ...createReplayToolLoopBindings(session),
                loopId: "loop:rows",
                messages: [userMessage("Insert two rows.")],
                tools,
            })
        ).output;
    const { provider } = scriptedModel("model:rows", [
        [call("u1", "insert_row", { id: "x" })],
        [call("u2", "insert_row", { id: "y" })],
        [text("done")],
    ]);
    const { inspection: recorded } = await runReplaySession(store, {
        claimId: "meta",
        commandId: "session:rows-loop",
        handlers,
        program,
        programId: "program:rows-loop.v1",
        provider: createToolTurnProvider(provider),
    });
    assert.equal(recorded.terminal?.status, "finished");
    assert.deepEqual(readRowIds(world), ["x", "y"]);
    const effectSteps = recorded.steps.filter((step) => step.effect !== null);
    assert.deepEqual(
        effectSteps.map((step) => step.effect?.intent.reversibility),
        ["compensable", "compensable"],
    );

    const calls: string[] = [];
    const compensation = createEffectCompensationRegistry([
        {
            compensate: ({ intent }) => {
                calls.push(rowOf(intent.payload));
                const database = openRowWorld(world);
                try {
                    database.prepare("DELETE FROM rows WHERE id = ?").run(rowOf(intent.payload));
                } finally {
                    database.close();
                }
                return { ok: true, value: null };
            },
            handlerId: "compensation:insert_row",
            kind: "test.insert_row",
        },
    ]);
    const { inspection: rewound } = await rewindReplaySession(store, {
        claimId: "meta",
        commandId: "session:rows-loop:rewind",
        compensation,
        sourceSessionId: recorded.session_id,
        target: { stepCount: 1 },
    });
    assert.equal(rewound.terminal?.status, "rewound");
    assert.deepEqual(calls, ["y", "x"]);
    assert.deepEqual(readRowIds(world), []);
    for (const step of effectSteps) {
        assert.equal(
            inspectEffectCompensation(store, {
                compensationId: deriveEffectCompensationId(step.record_id),
            }).status,
            "compensated",
        );
    }
});
