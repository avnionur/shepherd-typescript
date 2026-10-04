import { randomUUID } from "node:crypto";
import { lstat, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/** Discover configured local Ollama-compatible catalogs without downloading or running models. */
export async function refreshLocalCatalogs(directory, providers, bounds) {
    const filename = path.join(directory, "models.json");
    let document = { providers: {} };
    try {
        const info = await lstat(filename);
        if (info.isSymbolicLink() || !info.isFile() || (info.mode & 0o077) !== 0)
            throw new Error("private models");
        document = JSON.parse(await readFile(filename, "utf8"));
        if (!document || typeof document !== "object" || Array.isArray(document))
            throw new Error("models");
    } catch (error) {
        if (error.code !== "ENOENT") throw error;
    }
    const statuses = [];
    for (const provider of providers) {
        try {
            const signal = AbortSignal.timeout(bounds.discoveryMilliseconds);
            const read = async (endpoint, options = {}) => {
                const url = new URL(endpoint);
                if (
                    !bounds.loopbackHosts.includes(url.hostname) ||
                    url.protocol !== "http:" ||
                    url.username ||
                    url.password
                )
                    throw new Error("endpoint");
                const response = await fetch(url, { ...options, signal, redirect: "error" });
                if (!response.ok) throw new Error("discovery");
                const chunks = [];
                let size = 0;
                for await (const chunk of response.body) {
                    size += chunk.length;
                    if (size > bounds.maxDiscoveryBytes) throw new Error("bound");
                    chunks.push(chunk);
                }
                return JSON.parse(Buffer.concat(chunks).toString("utf8"));
            };
            const payload = await read(provider.discoveryUrl);
            if (!Array.isArray(payload.models) || payload.models.length > bounds.maxLocalModels)
                throw new Error("models");
            for (const model of payload.models) {
                if (typeof model.name !== "string" || !model.name.trim()) throw new Error("id");
                if (!Array.isArray(model.capabilities)) {
                    const metadata = await read(provider.showUrl, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ model: model.name }),
                    });
                    model.capabilities = metadata.capabilities;
                }
            }
            const models = payload.models
                .filter(
                    (model) =>
                        Array.isArray(model.capabilities) &&
                        model.capabilities.includes("completion"),
                )
                .map((model) => {
                    if (
                        typeof model.name !== "string" ||
                        !model.name.trim() ||
                        !model.name.isWellFormed()
                    )
                        throw new Error("id");
                    return {
                        ...provider.modelDefaults,
                        id: model.name,
                        name: model.name + (model.remote_host ? provider.cloudLabel : ""),
                    };
                });
            document.providers ??= {};
            document.providers[provider.id] = {
                baseUrl: provider.baseUrl,
                api: provider.api,
                apiKey: provider.placeholderKey,
                models,
                compat: provider.compat,
            };
            statuses.push({
                id: provider.id,
                name: provider.name,
                local: true,
                available: models.length > 0,
                error: models.length ? null : "No completion-capable models found",
                models: models.map((model) => ({
                    provider: provider.id,
                    id: model.id,
                    name: model.name,
                })),
            });
        } catch {
            if (document.providers) delete document.providers[provider.id];
            statuses.push({
                id: provider.id,
                name: provider.name,
                local: true,
                available: false,
                error: "Local server unavailable or model discovery failed",
                models: [],
            });
        }
    }
    if (providers.length) {
        const temporary = path.join(directory, `${randomUUID()}.models.tmp`);
        await writeFile(temporary, JSON.stringify(document), { mode: 0o600, flag: "wx" });
        await rename(temporary, filename);
    }
    return statuses;
}
