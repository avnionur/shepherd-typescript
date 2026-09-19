import { spawn } from "node:child_process";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { resolveBuildOutputDirectory } from "../tooling/build/output.ts";
import {
    defaultRepositoryRoot,
    readReleaseIntegrityConfiguration,
} from "../tooling/release/integrity-config.ts";
import { runReproducibleBuild } from "../tooling/release/reproducible-build.ts";

type PackResult = { readonly filename: string };

if (process.argv.length > 2) {
    throw new TypeError("Usage: reproducible-build-cli.ts");
}

const configuration = await readReleaseIntegrityConfiguration();
const releaseDirectory = path.join(defaultRepositoryRoot, configuration.release.directory);
const [buildExecutable, ...buildArguments] = configuration.reproducibleBuild.buildCommand as [
    string,
    ...string[],
];
const [packExecutable, ...packArguments] = configuration.reproducibleBuild.packCommand as [
    string,
    ...string[],
];

const run = await runReproducibleBuild({
    build: async () => {
        await execute(buildExecutable, buildArguments, "inherit");
    },
    outputDirectory: resolveBuildOutputDirectory(),
    pack: async (destination) => {
        const output = await execute(packExecutable, [...packArguments, destination], "pipe");
        // npm prints an array of pack results or an object keyed by package name.
        const parsed = JSON.parse(output) as
            | readonly PackResult[]
            | Readonly<Record<string, PackResult>>;
        const [packed] = Array.isArray(parsed) ? parsed : Object.values(parsed);
        if (packed === undefined || typeof packed.filename !== "string") {
            throw new Error("pack produced no tarball");
        }
        return path.join(destination, packed.filename);
    },
});
try {
    await mkdir(releaseDirectory, { recursive: true });
    await writeFile(
        path.join(releaseDirectory, configuration.release.reproducibleBuildReport),
        `${JSON.stringify(run.report, null, 4)}\n`,
    );
    for (const [index, build] of run.report.builds.entries()) {
        process.stdout.write(
            `build ${index + 1}: ${build.tarball} sha256:${build.tarballSha256} dist ${build.distTreeDigest}\n`,
        );
    }
    if (!run.report.identical) {
        throw new Error(
            [
                "builds are not reproducible; differing files:",
                ...run.report.differingFiles.map((file) => `- ${file}`),
            ].join("\n"),
        );
    }
    await copyFile(run.tarballPath, path.join(releaseDirectory, path.basename(run.tarballPath)));
    process.stdout.write("two clean builds produced identical output and tarball digests\n");
} finally {
    await run.dispose();
}

function execute(
    executable: string,
    commandArguments: readonly string[],
    stdout: "inherit" | "pipe",
): Promise<string> {
    return new Promise((resolve, reject) => {
        const child = spawn(executable, commandArguments, {
            cwd: defaultRepositoryRoot,
            env: { ...process.env, npm_config_update_notifier: "false" },
            stdio: ["ignore", stdout, "inherit"],
        });
        let output = "";
        child.stdout?.setEncoding("utf8").on("data", (chunk: string) => {
            output += chunk;
        });
        child.on("error", reject);
        child.on("close", (code) => {
            if (code === 0) {
                resolve(output);
            } else {
                reject(
                    new Error(`${executable} ${commandArguments.join(" ")} exited with ${code}`),
                );
            }
        });
    });
}
