import assert from "node:assert/strict";
import { test } from "node:test";

import {
    ApplicationProtocolError,
    createModelRuntimeSupervisorPolicy,
    createProgramConversationProvider,
    type ModelConversationRequest,
    runRuntimeSupervisor,
} from "../../src/index.ts";
import { researchApplications } from "./fixtures.ts";
import {
    gate,
    runtimeProtocol,
    runtimeWorker,
    say,
    scriptedWorker,
    TURN_USAGE,
    ticker,
    until,
    use,
} from "./runtime-supervisor-fixtures.ts";
import { createSupervisorWorld } from "./world-adapter-fixture.ts";

const surfaces = (
    (researchApplications as unknown as Record<string, Record<string, unknown>>)
        .runtimeSupervision as { readonly surfaces: readonly Record<string, unknown>[] }
).surfaces;
const surfaceOf = (kind: string, role: string) =>
    surfaces.find((surface) => surface.kind === kind && surface.role === role)?.content;

test("the provider-backed policy builds one JSON-mode request per tick and parses its decisions", async (context) => {
    const world = await createSupervisorWorld(context, "runtime-model-policy");
    const { store } = world;
    const requests: ModelConversationRequest[] = [];
    const replies = [
        '{"decisions":[{"agent":"a","action":"inject","reason":"b owns b.txt","guidance":"Stay in a.txt."}]}',
        "I think everything is fine.",
    ];
    const meta = createProgramConversationProvider({
        id: "model:meta",
        model: "scripted-meta-v1",
        respond: (request) => {
            requests.push(request);
            const text = replies[requests.length - 1] ?? '{"decisions":[]}';
            return {
                message: { content: [say(text)], role: "assistant" },
                output: text,
                stopReason: "end_turn",
                usage: { ...TURN_USAGE, costUsd: 0.01 },
            };
        },
    });
    const protocol = runtimeProtocol();
    const policy = createModelRuntimeSupervisorPolicy({ model: meta, protocol });
    const hold = gate();
    const a = scriptedWorker("model:a", [
        [
            () => [use("a1", "write_file", { path: "a.txt", text: "a" })],
            async (_request, signal) => {
                await hold.wait(signal);
                return [use("a2", "write_file", { path: "a.txt", text: "a2" })];
            },
            () => [say("a done")],
        ],
    ]);
    const b = scriptedWorker("model:b", [[() => [say("b done")]]]);
    const clock = ticker();
    const running = runRuntimeSupervisor(store, {
        clock: () => 3_000,
        commandId: "application:runtime:model-policy",
        policy,
        protocol,
        supervisorId: "supervisor:meta",
        wait: clock.wait,
        workers: [runtimeWorker("a", a.model), runtimeWorker("b", b.model)],
        world: world.adapter,
    });
    await until(() => a.requests.length === 2 && b.requests.length === 1, "first turns");
    await clock.advance();
    await until(() => requests.length === 1, "tick 1 request");
    await clock.advance();
    await until(() => requests.length === 2, "tick 2 request");
    hold.open();
    await until(() => a.requests.length === 3, "a resumes");
    clock.release();
    const receipt = await running;
    const [first] = requests;
    assert.equal(first?.system, surfaceOf("prompt", "action"));
    assert.deepEqual(first?.outputSchema, surfaceOf("schema", "action"));
    assert.equal(first?.cachePrefixMessages, 0);
    assert.deepEqual(first?.tools ?? [], []);
    const [preamble, snapshot] = first?.messages[0]?.content ?? [];
    assert.deepEqual(preamble, say(surfaceOf("prompt", "observation") as string));
    assert.deepEqual(
        JSON.parse((snapshot as { readonly text: string }).text),
        receipt.inspection.ticks[0]?.snapshot,
    );
    const [injected, refused] = receipt.inspection.ticks;
    assert.deepEqual(injected?.decisions, [
        { action: "inject", agent: "a", guidance: "Stay in a.txt.", reason: "b owns b.txt" },
    ]);
    assert.deepEqual(injected?.usage, { ...TURN_USAGE, costUsd: 0.01 });
    // Text that is not JSON is retained verbatim and refused; nothing is applied.
    assert.equal(refused?.output, "I think everything is fine.");
    assert.notEqual(refused?.refusal, null);
    const delivered = a.requests[2]?.messages.at(-1)?.content.at(-1);
    assert.deepEqual(delivered, say("Stay in a.txt."));
    // Supervisor calls are measured into the manifest alongside worker turns.
    const ticks = receipt.inspection.ticks.length;
    assert.equal(receipt.manifest.costs.provider_calls, 4 + ticks);
    assert.equal(receipt.manifest.costs.cost_usd, null);
    assert.throws(
        () =>
            createModelRuntimeSupervisorPolicy({
                model: meta,
                protocol: { ...protocol, surfaces: [] },
            }),
        ApplicationProtocolError,
    );
    assert.throws(
        () => createModelRuntimeSupervisorPolicy({ model: {} as never, protocol }),
        TypeError,
    );
});
