import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { checkPi, readPiModels } from "./pi.mjs";

async function helper(config, request) {
    return new Promise((resolve, reject) => {
        const child = spawn(config.connection.command, config.connection.args, {
            cwd: config.connection.cwd,
            shell: false,
            stdio: ["pipe", "pipe", "ignore"],
        });
        let text = "";
        let failure;
        const timer = setTimeout(() => {
            failure = true;
            child.kill("SIGKILL");
        }, config.limits.startupMilliseconds);
        child.on("error", () => {
            failure = true;
        });
        child.stdin.on("error", () => {
            failure = true;
        });
        child.stdout.on("data", (chunk) => {
            text += chunk.toString();
            if (Buffer.byteLength(text) > config.connection.maxOutputBytes) {
                failure = true;
                child.kill("SIGKILL");
            }
        });
        child.on("close", (code) => {
            clearTimeout(timer);
            try {
                const value = JSON.parse(text);
                if (
                    failure ||
                    code !== 0 ||
                    value.ok !== true ||
                    !Array.isArray(value.models) ||
                    !Array.isArray(value.providers)
                )
                    throw new Error("helper");
                resolve({
                    saved: value.saved === true,
                    synchronizationFailed: value.synchronizationFailed === true,
                    providers: value.providers.map((provider) => ({
                        id: provider.id,
                        name: provider.name,
                        apiKey: provider.apiKey === true,
                        local: provider.local === true,
                        available: provider.available !== false,
                        error: provider.error ?? null,
                        stored: provider.stored === true,
                    })),
                    models: value.models.map((model) => ({
                        provider: model.provider,
                        id: model.id,
                        name: model.name,
                    })),
                });
            } catch {
                reject(
                    new Error(
                        "Pi setup helper unavailable or rejected the request. Install the optional SDK helper and use a supported literal key.",
                    ),
                );
            }
        });
        child.stdin.end(
            JSON.stringify({
                ...request,
                agentDirectory: config.connection.agentDirectory,
                localProviders: config.connection.localProviders,
            }),
        );
    });
}

/** Compose idle-only example connection setup; credentials are owned by the native helper. */
export async function createConnection(config) {
    let mode = config.mode;
    let catalog = { models: [], providers: [] };
    let setupError;
    let selected;
    let rpc = config;
    const token = randomUUID();
    const bundled = {
        ...config,
        pi: {
            ...config.pi,
            command: config.connection.rpcCommand,
            args: [...config.connection.rpcArgs, ...config.pi.args],
            versionArgs: [...config.connection.rpcArgs, ...config.pi.versionArgs],
            expectedVersion: config.connection.expectedVersion,
            environment: {
                [config.connection.agentDirectoryEnvironment]: config.connection.agentDirectory,
            },
        },
    };
    try {
        catalog = await helper(config, { operation: "catalog" });
    } catch (error) {
        setupError = error.message;
    }
    const stateFile = path.join(config.connection.agentDirectory, config.connection.selectionFile);
    let stored;
    try {
        const info = await lstat(stateFile);
        if (info.isSymbolicLink() || !info.isFile() || (info.mode & 0o077) !== 0)
            throw new Error("private selection");
        stored = JSON.parse(await readFile(stateFile, "utf8"));
    } catch (error) {
        if (error.code !== "ENOENT")
            setupError = "Saved connection settings could not be read safely.";
    }
    let available;
    if (["offline", "pi"].includes(stored?.mode)) {
        mode = stored.mode;
        rpc = mode === "pi" ? bundled : config;
    }
    if (mode === "pi") {
        try {
            await checkPi(rpc);
            available = await readPiModels(rpc);
        } catch (error) {
            if (stored?.mode !== "pi") throw error;
            mode = "offline";
            available = [config.offline.model];
            setupError =
                "Saved Pi connection could not be restored. Offline mode is available; refresh setup and reconnect.";
        }
    } else available = [config.offline.model];
    const requested = stored?.mode === mode ? stored.model : undefined;
    const configured = available.filter(
        (model) =>
            model.id === config.provider.model ||
            `${model.provider}/${model.id}` === config.provider.model,
    );
    if (!stored && !requested && config.provider.model !== null && configured.length !== 1)
        throw new Error("Configured provider.model is unavailable or ambiguous in the Pi catalog");
    selected = requested
        ? available.find(
              (model) => model.provider === requested.provider && model.id === requested.id,
          )
        : (configured[0] ?? available[0]);
    if (!selected) {
        mode = "offline";
        available = [config.offline.model];
        selected = available[0];
        setupError = "Saved model is unavailable; reconnect Pi with an available model.";
    }
    const persist = async (value) => {
        await mkdir(config.connection.agentDirectory, { recursive: true, mode: 0o700 });
        const info = await lstat(config.connection.agentDirectory);
        if (info.isSymbolicLink() || !info.isDirectory() || (info.mode & 0o077) !== 0)
            throw new Error("private selection");
        const temporary = path.join(config.connection.agentDirectory, `${randomUUID()}.tmp`);
        await writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: "wx" });
        await chmod(temporary, 0o600);
        await rename(temporary, stateFile);
    };
    return {
        token,
        snapshot() {
            return {
                mode,
                models: available,
                defaultModel: { provider: selected.provider, id: selected.id },
                setup: {
                    available: catalog.models.length > 0,
                    error: setupError ?? null,
                    providers: catalog.providers,
                    models: catalog.models,
                    csrf: token,
                    storage: "Private Pi auth file on this device; not encrypted/keychain storage.",
                },
            };
        },
        runtime() {
            return { ...rpc, mode };
        },
        async refresh() {
            catalog = await helper(config, { operation: "catalog" });
            setupError = undefined;
        },
        async configure(value) {
            if (value.mode === "offline") {
                await persist({ mode: "offline" });
                mode = "offline";
                available = [config.offline.model];
                selected = available[0];
                return;
            }
            if (setupError) {
                catalog = await helper(config, { operation: "catalog" });
                setupError = undefined;
            }
            const model = catalog.models.find(
                (candidate) =>
                    candidate.provider === value.model?.provider &&
                    candidate.id === value.model?.id,
            );
            if (!model) throw new Error("Choose an exact catalog provider and model.");
            let saved = false;
            if (value.apiKey !== undefined) {
                if (
                    typeof value.apiKey !== "string" ||
                    !value.apiKey.trim() ||
                    !value.apiKey.isWellFormed() ||
                    Buffer.byteLength(value.apiKey) > config.connection.maxKeyBytes ||
                    value.apiKey.includes("$") ||
                    [...value.apiKey].some(
                        (character) =>
                            character.codePointAt(0) < 32 || character.codePointAt(0) === 127,
                    ) ||
                    value.apiKey.trimStart().startsWith("!")
                )
                    throw new Error(
                        "Enter a literal API key; configuration expressions are not accepted.",
                    );
                const provider = catalog.providers.find(
                    (candidate) => candidate.id === model.provider,
                );
                if (!provider?.apiKey)
                    throw new Error("This provider requires a separate login flow.");
                const result = await helper(config, {
                    operation: "save_key",
                    provider: model.provider,
                    key: value.apiKey,
                });
                saved = result.saved;
                catalog = result;
            }
            try {
                await checkPi(bundled);
                const models = await readPiModels(bundled);
                const confirmed = models.find(
                    (candidate) =>
                        candidate.provider === model.provider && candidate.id === model.id,
                );
                if (!confirmed) throw new Error("model");
                await persist({ mode: "pi", model: { provider: model.provider, id: model.id } });
                rpc = bundled;
                mode = "pi";
                available = models;
                selected = confirmed;
            } catch {
                throw new Error(
                    saved
                        ? "Key saved privately, but connection activation failed. It is not marked ready; check your provider/model and retry Connect."
                        : "Pi connection activation failed. Save a supported key or configure Pi authentication first.",
                );
            }
        },
    };
}
