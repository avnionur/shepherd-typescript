import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { lstat, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { readConfiguration } from "../config.mjs";
import { createConnection } from "../connection.mjs";

const example = fileURLToPath(new URL("../", import.meta.url));
const fixture = JSON.parse(
    await readFile(new URL("./connection.fixture.json", import.meta.url), "utf8"),
);
async function setupHelper(request) {
    const child = spawn(process.execPath, [path.join(example, "sdk/helper.mjs")], {
        stdio: ["pipe", "pipe", "ignore"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
        output += chunk.toString();
    });
    const closed = once(child, "close");
    child.stdin.end(JSON.stringify(request));
    const [code] = await closed;
    return { code, output, value: JSON.parse(output) };
}

test("real SDK lists providers/models before authentication and saves only native private credentials", async () => {
    const agentDirectory = await mkdtemp(path.join(tmpdir(), "pi-native-keys-"));
    const before = await setupHelper({ operation: "catalog", agentDirectory });
    assert.equal(before.code, 0);
    assert.ok(before.value.models.some((model) => model.provider === fixture.providers[0]));
    assert.ok(
        before.value.providers.some(
            (provider) =>
                provider.id === fixture.providers[0] && provider.apiKey && !provider.stored,
        ),
    );
    for (const provider of fixture.providers) {
        const saved = await setupHelper({
            operation: "save_key",
            agentDirectory,
            provider,
            key: fixture.dummyKey,
        });
        assert.equal(saved.code, 0);
        assert.equal(saved.value.saved, true);
        assert.equal(saved.output.includes(fixture.dummyKey), false);
    }
    const reopened = await setupHelper({ operation: "catalog", agentDirectory });
    for (const provider of fixture.providers)
        assert.ok(reopened.value.providers.some((item) => item.id === provider && item.stored));
    const auth = JSON.parse(await readFile(path.join(agentDirectory, "auth.json"), "utf8"));
    for (const provider of fixture.providers)
        assert.deepEqual(auth[provider], { type: "api_key", key: fixture.dummyKey });
    assert.equal((await lstat(agentDirectory)).mode & 0o077, 0);
    assert.equal((await lstat(path.join(agentDirectory, "auth.json"))).mode & 0o077, 0);
    assert.ok(
        reopened.value.models.every(
            (model) => Object.keys(model).sort().join() === "id,name,provider",
        ),
    );
});

test("literal-key boundary rejects command/environment expressions before native persistence", async () => {
    const agentDirectory = await mkdtemp(path.join(tmpdir(), "pi-literal-key-"));
    for (const key of fixture.refusedKeys) {
        const result = await setupHelper({
            operation: "save_key",
            agentDirectory,
            provider: fixture.providers[0],
            key,
        });
        assert.equal(result.code, 1);
        assert.equal(result.value.ok, false);
        assert.equal(result.output.includes(key), false);
    }
    await assert.rejects(() => lstat(path.join(agentDirectory, "auth.json")), { code: "ENOENT" });
});

test("HTTP connection setup preserves trace, refuses forged requests, and reopens native key and selected mode", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "pi-http-settings-"));
    const config = JSON.parse(await readFile(path.join(example, "config.json"), "utf8"));
    config.port = 0;
    config.database = path.join(directory, "trace.sqlite");
    config.connection.agentDirectory = path.join(directory, "pi-state");
    const filename = path.join(directory, "config.json");
    await writeFile(filename, JSON.stringify(config));
    async function start() {
        const child = spawn(process.execPath, [path.join(example, "server.mjs"), filename], {
            stdio: ["ignore", "pipe", "pipe"],
        });
        const closed = once(child, "close");
        context.after(async () => {
            if (child.exitCode === null) child.kill("SIGTERM");
            await closed;
        });
        let diagnostics = "";
        child.stderr.on("data", (chunk) => {
            diagnostics += chunk;
        });
        const url = await new Promise((resolve, reject) => {
            child.stdout.once("data", (chunk) => resolve(JSON.parse(chunk.toString().trim()).url));
            child.once("close", () => reject(new Error(diagnostics)));
        });
        return {
            url,
            stop: async () => {
                child.kill("SIGTERM");
                await closed;
            },
        };
    }
    const server = await start();
    const state = await (await fetch(`${server.url}/api/state`)).json();
    assert.equal(state.mode, "offline");
    assert.ok(state.settings.setup.available);
    const model = state.settings.setup.models.find(
        (item) => item.provider === fixture.providers[0],
    );
    assert.ok(model);
    const archive = await (await fetch(`${server.url}/api/export`)).text();
    const send = (body, headers = {}) =>
        fetch(`${server.url}/api/connection`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...headers },
            body: JSON.stringify(body),
        });
    const body = {
        mode: "pi",
        model: { provider: model.provider, id: model.id },
        apiKey: fixture.dummyKey,
    };
    assert.equal((await send(body)).status, 403);
    const headers = { Origin: server.url, "x-settings-token": state.settings.setup.csrf };
    assert.equal(
        (await send({ ...body, model: { provider: model.provider, id: "unknown" } }, headers))
            .status,
        400,
    );
    assert.equal((await send({ ...body, apiKey: fixture.refusedKeys[0] }, headers)).status, 400);
    const connected = await send(body, headers);
    assert.equal(connected.status, 200, await connected.text());
    const after = await (await fetch(`${server.url}/api/state`)).json();
    assert.equal(after.mode, "pi");
    assert.deepEqual(after.settings.defaultModel, body.model);
    assert.equal(JSON.stringify(after).includes(fixture.dummyKey), false);
    assert.equal(await (await fetch(`${server.url}/api/export`)).text(), archive);
    await server.stop();
    const reopened = await start();
    const resumed = await (await fetch(`${reopened.url}/api/state`)).json();
    assert.equal(resumed.mode, "pi");
    assert.deepEqual(resumed.settings.defaultModel, body.model);
    assert.equal(JSON.stringify(resumed).includes(fixture.dummyKey), false);
    const offline = await fetch(`${reopened.url}/api/connection`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Origin: reopened.url,
            "x-settings-token": resumed.settings.setup.csrf,
        },
        body: JSON.stringify({ mode: "offline" }),
    });
    assert.equal(offline.status, 200);
});

test("saved live failure restores offline recovery, and persisted offline overrides configured live", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "pi-connection-recovery-"));
    const config = JSON.parse(await readFile(path.join(example, "config.json"), "utf8"));
    config.mode = "pi";
    config.connection.agentDirectory = path.join(directory, "pi-state");
    const filename = path.join(directory, "config.json");
    await writeFile(filename, JSON.stringify(config));
    const agentDirectory = config.connection.agentDirectory;
    await setupHelper({ operation: "catalog", agentDirectory });
    await writeFile(
        path.join(agentDirectory, "connection.json"),
        JSON.stringify({ mode: "offline" }),
        { mode: 0o600 },
    );
    const offline = await createConnection(readConfiguration(filename));
    assert.equal(offline.snapshot().mode, "offline");
    assert.ok(offline.snapshot().setup.available);
    await writeFile(
        path.join(agentDirectory, "connection.json"),
        JSON.stringify({ mode: "pi", model: { provider: fixture.providers[0], id: "missing" } }),
        { mode: 0o600 },
    );
    const failed = await createConnection(readConfiguration(filename));
    assert.equal(failed.snapshot().mode, "offline");
    assert.ok(failed.snapshot().setup.available);
    assert.match(failed.snapshot().setup.error, /restored|unavailable/);
    await failed.refresh();
    assert.equal(failed.snapshot().setup.error, null);
});

test("Ollama catalog uses native custom models, discovers optional capabilities and excludes embeddings", async (context) => {
    const template = JSON.parse(await readFile(path.join(example, "config.json"), "utf8"));
    const agentDirectory = await mkdtemp(path.join(tmpdir(), "pi-local-models-"));
    let available = true;
    const server = createServer(async (request, response) => {
        response.setHeader("Content-Type", "application/json");
        if (!available) {
            response.writeHead(503);
            response.end("{}");
            return;
        }
        if (request.url === "/api/tags") {
            response.end(
                JSON.stringify({
                    models: [{ name: "fixture-chat" }, { name: "fixture-embedding" }],
                }),
            );
        } else {
            const chunks = [];
            for await (const chunk of request) chunks.push(chunk);
            const body = JSON.parse(Buffer.concat(chunks).toString());
            response.end(
                JSON.stringify({
                    capabilities: [body.model === "fixture-chat" ? "completion" : "embedding"],
                }),
            );
        }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    context.after(() => new Promise((resolve) => server.close(resolve)));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const provider = {
        ...template.connection.localProviders[0],
        discoveryUrl: origin + "/api/tags",
        showUrl: origin + "/api/show",
    };
    const result = await setupHelper({
        operation: "catalog",
        agentDirectory,
        localProviders: [provider],
    });
    assert.equal(result.code, 0);
    assert.deepEqual(
        result.value.models
            .filter((model) => model.provider === provider.id)
            .map((model) => model.id),
        ["fixture-chat"],
    );
    assert.ok(
        result.value.providers.some(
            (item) => item.id === provider.id && item.local && !item.apiKey,
        ),
    );
    const document = JSON.parse(await readFile(path.join(agentDirectory, "models.json"), "utf8"));
    assert.equal(document.providers[provider.id].api, provider.api);
    assert.equal((await lstat(path.join(agentDirectory, "models.json"))).mode & 0o077, 0);
    available = false;
    const unavailable = await setupHelper({
        operation: "catalog",
        agentDirectory,
        localProviders: [provider],
    });
    assert.equal(unavailable.code, 0);
    assert.equal(
        unavailable.value.models.some((model) => model.provider === provider.id),
        false,
    );
    assert.ok(
        unavailable.value.providers.some(
            (item) => item.id === provider.id && item.available === false,
        ),
    );
});
