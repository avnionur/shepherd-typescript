import { readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";

import { parse } from "yaml";

type ReleaseConfig = {
    readonly version: string;
    readonly versionFiles: readonly string[];
};

type SynchronizeVersionOptions = {
    readonly configPath: string;
    readonly repositoryRoot: string;
};

export async function synchronizeVersions(options: SynchronizeVersionOptions): Promise<number> {
    const repositoryRoot = await realpath(options.repositoryRoot);
    const config = parseReleaseConfig(await readFile(options.configPath, "utf8"));
    const updates: { readonly content: string; readonly filePath: string }[] = [];

    for (const versionFile of config.versionFiles) {
        const filePath = await resolveVersionFile(repositoryRoot, versionFile);
        const manifest: unknown = JSON.parse(await readFile(filePath, "utf8"));
        if (!isRecord(manifest)) {
            throw new Error(`${versionFile} must contain a JSON object`);
        }

        updates.push({
            content: `${JSON.stringify({ ...manifest, version: config.version }, null, 4)}\n`,
            filePath,
        });
    }

    await Promise.all(updates.map((update) => writeFile(update.filePath, update.content)));
    return updates.length;
}

export function parseReleaseConfig(configText: string): ReleaseConfig {
    const parsed: unknown = parse(configText);
    if (!isRecord(parsed) || !isRecord(parsed.cognia)) {
        throw new Error("release-config.yaml must define cognia");
    }

    const version = parsed.cognia.version;
    if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) {
        throw new Error("release-config.yaml must define cognia.version");
    }

    const versionFiles = parsed.versionFiles;
    if (
        !Array.isArray(versionFiles) ||
        !versionFiles.every((value): value is string => typeof value === "string")
    ) {
        throw new Error("release-config.yaml must define versionFiles");
    }

    return { version, versionFiles };
}

async function resolveVersionFile(repositoryRoot: string, versionFile: string): Promise<string> {
    if (
        versionFile.length === 0 ||
        versionFile.includes("\\") ||
        /[%?#]/.test(versionFile) ||
        path.isAbsolute(versionFile)
    ) {
        throw new Error(`versionFiles contains an unsafe path: ${versionFile}`);
    }

    const filePath = await realpath(path.resolve(repositoryRoot, versionFile));
    if (!filePath.startsWith(`${repositoryRoot}${path.sep}`)) {
        throw new Error(`versionFiles escapes the repository: ${versionFile}`);
    }

    return filePath;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
