import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { SQLiteTraceStore } from "@avnionur/shepherd-typescript/trace";

const directory = fileURLToPath(new URL("../", import.meta.url));
const template = JSON.parse(await readFile(path.join(directory, "config.json"), "utf8"));

async function launch(context, scenario, existing, options = {}) {
    const temporary = existing ?? (await mkdtemp(path.join(tmpdir(), "shepherd-pi-http-")));
    const configuration = structuredClone(template);
    configuration.provider.model = options.providerModel ?? configuration.provider.model;
    configuration.port = 0;
    configuration.database = path.join(temporary, "trace.sqlite");
    configuration.offline.delayMilliseconds = 80;
    const marker = path.join(temporary, "commands.txt");
    if (scenario) {
        configuration.mode = "pi";
        configuration.pi.command = process.execPath;
        configuration.pi.args = [path.join(directory, "test/fixture.mjs"), scenario, marker];
        configuration.pi.versionArgs = [path.join(directory, "test/fixture.mjs"), "--version"];
        configuration.pi.cwd = temporary;
        configuration.limits.maxRpcLineBytes = 1024;
        configuration.limits.shutdownMilliseconds = 500;
        configuration.limits.timeoutMilliseconds = scenario === "uncooperative" ? 200 : 3000;
    }
    const filename = path.join(temporary, "config.json");
    await writeFile(filename, JSON.stringify(configuration));
    const child = spawn(process.execPath, [path.join(directory, "server.mjs"), filename], {
        stdio: ["ignore", "pipe", "pipe"],
    });
    let diagnostics = "";
    child.stderr.on("data", (chunk) => {
        diagnostics += chunk.toString();
    });
    const closed = once(child, "close");
    const stop = async () => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
        await closed;
    };
    context.after(stop);
    const url = await new Promise((resolve, reject) => {
        let output = "";
        const timer = setTimeout(() => {
            child.kill("SIGKILL");
            reject(new Error(`Server startup timeout: ${diagnostics}`));
        }, 20000);
        child.stdout.on("data", (chunk) => {
            output += chunk.toString();
            if (output.includes("\n")) {
                clearTimeout(timer);
                resolve(JSON.parse(output.split("\n")[0]).url);
            }
        });
        child.on("close", () => {
            clearTimeout(timer);
            reject(new Error(`Server exited: ${diagnostics}`));
        });
    });
    return { url, temporary, marker, stop, child, configuration };
}
async function post(url, route, body, headers = {}) {
    return fetch(url + route, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
    });
}
async function waitForIdle(url) {
    for (let count = 0; count < 300; count++) {
        const state = await (await fetch(`${url}/api/state`)).json();
        if (!state.active) return state;
        await delay(10);
    }
    throw new Error("Run did not terminate");
}

test("offline HTTP chat retains canonical graph and preserves archive bytes across reads and restart", async (context) => {
    const server = await launch(context);
    assert.equal((await fetch(server.url)).status, 200);
    assert.equal((await post(server.url, "/api/chat", { text: "" })).status, 400);
    assert.equal(
        (
            await post(
                server.url,
                "/api/chat",
                { text: "blocked" },
                { Origin: "https://other.example" },
            )
        ).status,
        403,
    );
    assert.equal((await post(server.url, "/api/chat", { text: "Ada" })).status, 202);
    assert.equal((await post(server.url, "/api/chat", { text: "concurrent" })).status, 409);
    const state = await waitForIdle(server.url);
    assert.equal(state.fatal, false);
    assert.deepEqual(
        state.messages.map(({ role, text }) => ({ role, text })),
        [
            { role: "user", text: "Ada" },
            { role: "assistant", text: "Offline fixture reply: Ada" },
        ],
    );
    assert.equal(state.runs[0].status, "finished");
    assert.equal(state.runs[0].budget.maxTurns, 1);
    assert.equal(state.runs[0].control.consumed.turns, 1);
    assert.ok(state.runs[0].taskRef);
    assert.ok(state.runs[0].cut);
    assert.equal(state.nodes.filter((node) => node.source === "shepherd").length, 6);
    assert.equal(state.nodes.filter((node) => node.source === "rpc-observation").length, 2);
    const ids = new Set(state.nodes.map((node) => node.id));
    assert.ok(state.edges.length > 0);
    assert.ok(
        state.edges.every((edge) => ids.has(edge.source) && ids.has(edge.target) && !edge.external),
    );
    const before = await (await fetch(`${server.url}/api/export`)).text();
    await fetch(`${server.url}/api/state`);
    await fetch(`${server.url}/api/state`);
    assert.equal(await (await fetch(`${server.url}/api/export`)).text(), before);
    await server.stop();
    const reopened = await launch(context, undefined, server.temporary);
    assert.deepEqual(
        (await (await fetch(`${reopened.url}/api/state`)).json()).messages,
        state.messages,
    );
    assert.equal(await (await fetch(`${reopened.url}/api/export`)).text(), before);
});

test("Pi RPC waits for settlement, decodes UTF-8/LF and uses authoritative text and measured usage", async (context) => {
    const server = await launch(context, "success");
    assert.equal((await post(server.url, "/api/chat", { text: "hello" })).status, 202);
    await delay(40);
    assert.ok((await (await fetch(`${server.url}/api/state`)).json()).active);
    const state = await waitForIdle(server.url);
    assert.equal(state.runs[0].status, "finished");
    assert.equal(
        state.messages[1].text,
        "Authoritative café \u2028 line \u2029 <script>alert(1)</script>",
    );
    assert.equal(state.runs[0].usage.input_tokens, 4);
    assert.equal(state.runs[0].usage.cost_usd, 0.01);
    assert.ok(state.nodes.some((node) => node.body.event_type === "agent_settled"));
    assert.ok((await readFile(server.marker, "utf8")).includes("closed"));
});

for (const scenario of ["exit", "malformed", "oversized", "refused", "selection-refused"]) {
    test(`Pi ${scenario} becomes durable failure without usage or leaked diagnostics`, async (context) => {
        const server = await launch(context, scenario);
        assert.equal((await post(server.url, "/api/chat", { text: "hello" })).status, 202);
        const state = await waitForIdle(server.url);
        assert.equal(state.runs[0].status, "failed");
        assert.equal(state.runs[0].usage, null);
        assert.equal(JSON.stringify(state).includes("secret-provider-diagnostic"), false);
    });
}

test("Stop clears queue, aborts Pi and confirms process close before cancelled terminal evidence", async (context) => {
    const server = await launch(context, "hang");
    const { runId } = await (await post(server.url, "/api/chat", { text: "wait" })).json();
    for (let count = 0; count < 100; count++) {
        const state = await (await fetch(`${server.url}/api/state`)).json();
        if (state.nodes.some((node) => node.body.event_type === "agent_start")) break;
        await delay(10);
    }
    assert.equal((await post(server.url, "/api/cancel", { runId: "wrong" })).status, 409);
    assert.equal((await post(server.url, "/api/cancel", { runId })).status, 202);
    const state = await waitForIdle(server.url);
    assert.equal(state.runs[0].status, "cancelled");
    assert.equal(state.runs[0].usage, null);
    assert.match(await readFile(server.marker, "utf8"), /clear_queue\nabort\nclosed/);
});

test("configured playground executes success, failure and cancellation cases without arbitrary client control", async (context) => {
    const server = await launch(context);
    const initial = await (await fetch(`${server.url}/api/state`)).json();
    assert.equal(initial.playground.length, 5);
    assert.equal((await post(server.url, "/api/chat", { itemId: "unknown" })).status, 400);
    assert.equal((await post(server.url, "/api/chat", { itemId: "reply" })).status, 202);
    assert.equal((await waitForIdle(server.url)).runs.at(-1).status, "finished");
    assert.equal((await post(server.url, "/api/chat", { itemId: "failure" })).status, 202);
    const failed = await waitForIdle(server.url);
    assert.equal(failed.runs.at(-1).status, "failed");
    assert.equal(failed.runs.at(-1).usage, null);
    const { runId } = await (await post(server.url, "/api/chat", { itemId: "cancel" })).json();
    assert.equal((await post(server.url, "/api/cancel", { runId })).status, 202);
    assert.equal((await waitForIdle(server.url)).runs.at(-1).status, "cancelled");
});

test("Pi internal retry completes only at settlement and accounts observed attempt usage", async (context) => {
    const server = await launch(context, "retry");
    await post(server.url, "/api/chat", { text: "retry" });
    const state = await waitForIdle(server.url);
    assert.equal(state.runs[0].status, "finished");
    assert.equal(state.runs[0].usage.input_tokens, 5);
    assert.ok(state.nodes.some((node) => node.body.event_type === "auto_retry_start"));
});

test("timeout reaps an uncooperative direct child and retains a failed run", async (context) => {
    const server = await launch(context, "uncooperative");
    await post(server.url, "/api/chat", { text: "timeout" });
    const state = await waitForIdle(server.url);
    assert.equal(state.runs[0].status, "failed");
    assert.equal(state.runs[0].usage, null);
    assert.ok(state.runs[0].cut);
});

test("HTTP bounds, content type and host admission refuse invalid writes", async (context) => {
    const server = await launch(context);
    assert.equal(
        (
            await post(server.url, "/api/chat", {
                text: "x".repeat(template.limits.maxMessageBytes + 1),
            })
        ).status,
        400,
    );
    assert.equal(
        (
            await post(server.url, "/api/chat", {
                text: "x".repeat(template.limits.maxRequestBytes + 1),
            })
        ).status,
        413,
    );
    assert.equal(
        (await post(server.url, "/api/chat", { text: "x" }, { "Content-Type": "text/plain" }))
            .status,
        415,
    );
    const refusedHostStatus = await new Promise((resolve, reject) => {
        const probe = request(
            `${server.url}/api/chat`,
            {
                method: "POST",
                headers: { Host: "rebinding.example", "Content-Type": "application/json" },
            },
            (response) => {
                response.resume();
                resolve(response.statusCode);
            },
        );
        probe.on("error", reject);
        probe.end(JSON.stringify({ text: "x" }));
    });
    assert.equal(refusedHostStatus, 403);
    assert.equal((await (await fetch(`${server.url}/api/state`)).json()).nodes.length, 0);
});

test("a killed server reopens interrupted evidence without repeating a Pi invocation", async (context) => {
    const server = await launch(context, "hang");
    await post(server.url, "/api/chat", { text: "interrupted" });
    for (let attempt = 0; attempt < 100; attempt++) {
        const state = await (await fetch(`${server.url}/api/state`)).json();
        if (state.nodes.some((node) => node.body.event_type === "agent_start")) break;
        await delay(10);
    }
    server.child.kill("SIGKILL");
    await server.stop();
    // Child's stdin closes when its parent dies; wait for fixture cleanup before reopening.
    for (let attempt = 0; attempt < 100; attempt++) {
        if ((await readFile(server.marker, "utf8")).includes("closed")) break;
        await delay(10);
    }
    const commands = await readFile(server.marker, "utf8");
    const reopened = await launch(context, "hang", server.temporary);
    const state = await (await fetch(`${reopened.url}/api/state`)).json();
    assert.equal(state.active, null);
    assert.equal(state.runs[0].status, "started");
    assert.match(state.messages[1].text, /Interrupted/);
    assert.equal(
        await readFile(server.marker, "utf8"),
        `${commands}get_available_models\nclosed\n`,
    );
});

test("shutdown closes an admitted unfinished request before persistence without starting a run", async (context) => {
    const server = await launch(context);
    const probe = request(`${server.url}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Transfer-Encoding": "chunked" },
    });
    probe.on("error", () => {});
    const connected = new Promise((resolve) =>
        probe.on("socket", (socket) => socket.on("connect", resolve)),
    );
    probe.flushHeaders();
    await connected;
    probe.write('{"text":"unfinished');
    await delay(20);
    const exit = once(server.child, "close");
    await server.stop();
    const [code] = await exit;
    assert.equal(code, 0);
    probe.destroy();
    const reopened = await launch(context, undefined, server.temporary);
    const state = await (await fetch(`${reopened.url}/api/state`)).json();
    assert.equal(state.runs.length, 0);
    assert.equal(state.fatal, false);
});

test("provider/model catalog is whitelisted and exact selected identity precedes prompt and is retained", async (context) => {
    const server = await launch(context, "success");
    const initial = await (await fetch(`${server.url}/api/state`)).json();
    assert.deepEqual(initial.settings.models, [
        { provider: "fixture-a", id: "model-one", name: "First fixture model" },
        { provider: "fixture-a", id: "model-two", name: "Second fixture model" },
        { provider: "fixture-b", id: "model-three", name: "Third fixture model" },
    ]);
    assert.equal(JSON.stringify(initial).includes("secret-catalog-header"), false);
    assert.equal(JSON.stringify(initial).includes("private.example"), false);
    assert.equal(
        (
            await post(server.url, "/api/chat", {
                text: "x",
                model: { provider: "fixture-a", id: "unknown" },
            })
        ).status,
        400,
    );
    assert.equal(
        (
            await post(server.url, "/api/chat", {
                text: "x",
                model: { provider: "fixture-a", id: "model-two", headers: {} },
            })
        ).status,
        400,
    );
    assert.equal(
        (
            await post(server.url, "/api/chat", {
                text: "selected",
                model: { provider: "fixture-a", id: "model-two" },
            })
        ).status,
        202,
    );
    const state = await waitForIdle(server.url);
    assert.equal(state.runs[0].status, "finished");
    const creation = state.nodes.find((node) => node.mode === "declaration");
    assert.equal(creation.body.payload.provider.model, "fixture-a/model-two");
    assert.deepEqual(creation.body.payload.inputs.value.model, {
        provider: "fixture-a",
        id: "model-two",
    });
    assert.match(
        await readFile(server.marker, "utf8"),
        /set_model\nselection:fixture-a\/model-two\nprompt/,
    );
    assert.equal(JSON.stringify(state).includes("secret-catalog-header"), false);
});

test("explicit unavailable model fails startup rather than selecting a different model", async (context) => {
    await assert.rejects(
        () => launch(context, "success", undefined, { providerModel: "missing" }),
        /unavailable or ambiguous/,
    );
});

test("new trace clears state, preserves old archive and restores the fresh database after restart", async (context) => {
    const server = await launch(context);
    const initial = await (await fetch(server.url + "/api/state")).json();
    const headers = { Origin: server.url, "x-settings-token": initial.settings.setup.csrf };
    assert.equal((await post(server.url, "/api/new-trace", {})).status, 403);
    assert.equal(
        (await post(server.url, "/api/new-trace", { database: "bad" }, headers)).status,
        400,
    );
    await post(server.url, "/api/chat", { text: "retained before rotation" });
    assert.equal((await post(server.url, "/api/new-trace", {}, headers)).status, 409);
    await waitForIdle(server.url);
    const archive = await (await fetch(server.url + "/api/export")).text();
    assert.equal((await post(server.url, "/api/new-trace", {}, headers)).status, 200);
    const fresh = await (await fetch(server.url + "/api/state")).json();
    assert.equal(fresh.nodes.length, 0);
    assert.equal(fresh.messages.length, 0);
    assert.notEqual(fresh.traceIdentity, initial.traceIdentity);
    assert.deepEqual(fresh.settings.defaultModel, initial.settings.defaultModel);
    await server.stop();
    const reopened = await launch(context, undefined, server.temporary);
    assert.equal(
        (await (await fetch(reopened.url + "/api/state")).json()).traceIdentity,
        fresh.traceIdentity,
    );
    assert.equal((await (await fetch(reopened.url + "/api/state")).json()).nodes.length, 0);
    // Read the original immutable archive through its public store facade.
    const original = new SQLiteTraceStore(server.configuration.database);
    assert.equal(original.exportTrace(), archive);
    original.close();
});
