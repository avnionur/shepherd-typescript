import { readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";

import { parse } from "yaml";

/** Validated release version and repository-relative manifest targets. */
export type ReleaseConfig = {
    /** Semantic version copied to every configured manifest. */
    readonly version: string;
    /** Repository-relative JSON manifests updated by version synchronization. */
    readonly versionFiles: readonly string[];
};

/** Repository paths required for version synchronization. */
export type SynchronizeVersionOptions = {
    /** Release-configuration YAML path. */
    readonly configPath: string;
    /** Repository root containing every configured manifest. */
    readonly repositoryRoot: string;
};

/**
 * Synchronizes every configured JSON manifest to the release version.
 *
 * @param options - Repository root and release-configuration path.
 * @returns The number of updated manifest files.
 * @throws {Error} If configuration, containment validation, parsing, or writing fails.
 */
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

/**
 * Parses and validates the repository release-version configuration.
 *
 * @param configText - YAML release configuration.
 * @returns The validated semantic version and manifest paths.
 * @throws {Error} If the configuration shape or semantic version is invalid.
 */
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
