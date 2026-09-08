import { copyFile, lstat, mkdir, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { API } from "typescript/unstable/sync";

import { publicErrorConfigUrl } from "../../src/errors/public-errors.ts";
import { protocolConfigUrl } from "../../src/protocol/config.ts";
import { runtimePolicyConfigUrl } from "../../src/runtime/policy.ts";

/** Repository and compiler configuration used to locate production build output. */
export type BuildOutputOptions = {
    /** Optional TypeScript build configuration path. */
    readonly configurationPath?: string;
    /** Optional repository root; defaults to this package root. */
    readonly repositoryRoot?: string;
};

/** Runtime-configuration inputs copied beside emitted production source. */
export type RuntimeConfigurationCopyOptions = BuildOutputOptions & {
    /** Optional sources; defaults to protocol, public-error and runtime-policy files. */
    readonly configurationUrls?: readonly URL[];
};

/**
 * Resolves and validates the configured TypeScript build output directory.
 *
 * @param options - Optional repository root and TypeScript build configuration path.
 * @returns The absolute repository-contained build output directory.
 * @throws {Error} If TypeScript configuration cannot be parsed or its output is outside the
 * repository.
 */
export function resolveBuildOutputDirectory(options: BuildOutputOptions = {}): string {
    const repositoryRoot = path.resolve(
        options.repositoryRoot ?? fileURLToPath(new URL("../../", import.meta.url)),
    );
    const buildConfigurationPath =
        options.configurationPath ?? path.join(repositoryRoot, "tsconfig.build.json");
    const typeScriptApi = new API({ cwd: repositoryRoot });
    let buildConfiguration: ReturnType<API["parseConfigFile"]>;
    try {
        buildConfiguration = typeScriptApi.parseConfigFile(buildConfigurationPath);
    } finally {
        typeScriptApi.close();
    }

    const outputDirectory = buildConfiguration.options.outDir;
    if (
        typeof outputDirectory !== "string" ||
        !path.resolve(outputDirectory).startsWith(`${repositoryRoot}${path.sep}`)
    ) {
        throw new Error(
            "tsconfig.build.json compilerOptions.outDir must remain inside the repository",
        );
    }
    return path.resolve(outputDirectory);
}

/**
 * Rejects build-output paths containing symlinks before recursive cleanup.
 *
 * @param outputDirectory - Candidate output directory to validate.
 * @param repositoryRoot - Repository root that must contain the candidate.
 * @returns A promise that resolves after every existing path segment is validated.
 * @throws {TypeError} If the candidate escapes the repository or contains a symbolic link.
 * @throws {Error} If filesystem inspection fails for a reason other than a missing path.
 */
export async function assertSafeBuildOutputDirectory(
    outputDirectory: string,
    repositoryRoot = fileURLToPath(new URL("../../", import.meta.url)),
): Promise<void> {
    const requestedRoot = path.resolve(repositoryRoot);
    const relative = path.relative(requestedRoot, path.resolve(outputDirectory));
    if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`)) {
        throw new TypeError("build output directory must remain inside the repository");
    }
    const resolvedRoot = await realpath(repositoryRoot);

    let currentPath = resolvedRoot;
    for (const segment of relative.split(path.sep)) {
        const candidatePath = path.join(currentPath, segment);
        try {
            const status = await lstat(candidatePath);
            if (status.isSymbolicLink()) {
                throw new TypeError("build output directory must not contain symlinks");
            }
            currentPath = await realpath(candidatePath);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
                throw error;
            }
            return;
        }
    }
}

/**
 * Removes the configured build output after validating its filesystem ancestry.
 *
 * @param options - Optional repository root and TypeScript build configuration path.
 * @returns A promise that resolves after the output is absent.
 * @throws {TypeError} If the output path is unsafe.
 * @throws {Error} If configuration parsing, filesystem inspection, or removal fails.
 */
export async function cleanBuildOutput(options: BuildOutputOptions = {}): Promise<void> {
    const outputDirectory = resolveBuildOutputDirectory(options);
    await assertSafeBuildOutputDirectory(outputDirectory, options.repositoryRoot);
    await rm(outputDirectory, { force: true, recursive: true });
}

/**
 * Copies configuration files required by the emitted runtime into the build output.
 *
 * @param options - Optional build-output location and configuration source URLs.
 * @returns A promise that resolves after every configuration file is copied.
 * @throws {Error} If output resolution, directory creation, or copying fails.
 */
export async function copyRuntimeConfiguration(
    options: RuntimeConfigurationCopyOptions = {},
): Promise<void> {
    const outputDirectory = resolveBuildOutputDirectory(options);
    const configurationUrls = options.configurationUrls ?? [
        protocolConfigUrl,
        publicErrorConfigUrl,
        runtimePolicyConfigUrl,
    ];

    await assertSafeBuildOutputDirectory(outputDirectory, options.repositoryRoot);
    await mkdir(outputDirectory, { recursive: true });
    for (const configUrl of configurationUrls) {
        await copyFile(
            configUrl,
            pathToFileURL(path.join(outputDirectory, path.basename(fileURLToPath(configUrl)))),
        );
    }
}
