import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { API } from "typescript/unstable/sync";

type BuildOutputOptions = {
    readonly configurationPath?: string;
    readonly repositoryRoot?: string;
};

/** Resolves and validates the configured TypeScript build output directory. */
export function resolveBuildOutputDirectory(options: BuildOutputOptions = {}): string {
    const repositoryRoot = path.resolve(
        options.repositoryRoot ?? fileURLToPath(new URL("../", import.meta.url)),
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
        !outputDirectory.startsWith(`${repositoryRoot}${path.sep}`)
    ) {
        throw new Error(
            "tsconfig.build.json compilerOptions.outDir must remain inside the repository",
        );
    }
    return outputDirectory;
}

/** Rejects build-output paths containing symlinks before recursive cleanup. */
export async function assertSafeBuildOutputDirectory(
    outputDirectory: string,
    repositoryRoot = fileURLToPath(new URL("../", import.meta.url)),
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
