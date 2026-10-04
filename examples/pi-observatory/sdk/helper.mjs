import { lstat, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { refreshLocalCatalogs } from "./local-catalog.mjs";

const bounds = JSON.parse(await readFile(new URL("./helper.config.json", import.meta.url), "utf8"));
let request;
try {
    const chunks = [];
    let bytes = 0;
    for await (const chunk of process.stdin) {
        bytes += chunk.length;
        if (bytes > bounds.maxInputBytes) throw new Error("request");
        chunks.push(chunk);
    }
    request = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (
        !request ||
        !["catalog", "save_key"].includes(request.operation) ||
        typeof request.agentDirectory !== "string" ||
        !path.isAbsolute(request.agentDirectory)
    )
        throw new Error("request");
    if (
        request.operation === "save_key" &&
        (typeof request.provider !== "string" ||
            typeof request.key !== "string" ||
            !request.key.trim() ||
            !request.key.isWellFormed() ||
            Buffer.byteLength(request.key) > bounds.maxKeyBytes ||
            request.key.includes("$") ||
            [...request.key].some(
                (character) => character.codePointAt(0) < 32 || character.codePointAt(0) === 127,
            ) ||
            request.key.trimStart().startsWith("!"))
    )
        throw new Error("literal_key");
    await mkdir(request.agentDirectory, { recursive: true, mode: 0o700 });
    for (const [filename, directory] of [
        [request.agentDirectory, true],
        [path.join(request.agentDirectory, "auth.json"), false],
    ]) {
        const info = await lstat(filename).catch((error) => {
            if (error.code === "ENOENT" && !directory) return undefined;
            throw error;
        });
        if (
            info &&
            (info.isSymbolicLink() ||
                (directory ? !info.isDirectory() : !info.isFile()) ||
                (info.mode & 0o077) !== 0 ||
                (process.getuid && info.uid !== process.getuid()))
        )
            throw new Error("private_store");
    }
    process.env[bounds.agentDirectoryEnvironment] = request.agentDirectory;
    const local = await refreshLocalCatalogs(
        request.agentDirectory,
        request.localProviders ?? [],
        bounds,
    );
    const localIds = new Set(local.map((provider) => provider.id));
    const runtime = await ModelRuntime.create({ allowModelNetwork: false, refreshOnCreate: false });
    let saved = false;
    let synchronizationFailed = false;
    if (request.operation === "save_key") {
        const provider = runtime.getProvider(request.provider);
        if (!provider?.auth.apiKey?.login) throw new Error("unsupported_login");
        let prompts = 0;
        try {
            await runtime.login(request.provider, "api_key", {
                prompt: async (prompt) => {
                    if (prompt.type !== "secret" || ++prompts !== 1)
                        throw new Error("unsupported_login");
                    return request.key;
                },
                notify: () => {},
            });
            saved = true;
        } catch (error) {
            if (error?.constructor?.name === "CredentialSynchronizationError") {
                saved = true;
                synchronizationFailed = true;
            } else throw new Error("save_failed");
        }
    }
    const stored = new Set((await runtime.listCredentials()).map((entry) => entry.providerId));
    const providers = runtime.getProviders().map((provider) => ({
        id: provider.id,
        name: provider.name,
        apiKey: !localIds.has(provider.id) && Boolean(provider.auth.apiKey?.login),
        local: localIds.has(provider.id),
        stored: stored.has(provider.id),
    }));
    for (const provider of local) {
        const known = providers.find((candidate) => candidate.id === provider.id);
        if (known)
            Object.assign(known, {
                name: provider.name,
                available: provider.available,
                error: provider.error,
            });
        else providers.push({ ...provider, apiKey: false, stored: false });
    }
    const models = runtime
        .getModels()
        .map((model) => ({ provider: model.provider, id: model.id, name: model.name }));
    if (models.length > bounds.maxModels) throw new Error("catalog_bound");
    process.stdout.write(
        `${JSON.stringify({ ok: true, saved, synchronizationFailed, providers, models })}\n`,
    );
} catch {
    process.stdout.write(
        `${JSON.stringify({ ok: false, saved: false, error: "Pi setup failed. Use a literal API key and a private credential directory; this provider may require a separate login flow." })}\n`,
    );
    process.exitCode = 1;
} finally {
    if (request) request.key = undefined;
}
