import { spawn } from "node:child_process";
import path from "node:path";

/** Inputs of one run of the configured release packer. */
export type PackOptions = {
    /** Additional environment entries, such as an isolated `npm_config_cache`. */
    readonly environment?: Readonly<Record<string, string>>;
    /** Directory that receives the tarball; appended as the last packer argument. */
    readonly destination: string;
    /**
     * Configured packer command (`reproducibleBuild.packCommand`), which must print the npm
     * `--json` pack result.
     */
    readonly packCommand: readonly string[];
    /** Package root the packer runs in. */
    readonly repositoryRoot: string;
};

type PackResult = { readonly filename: string };

/**
 * Packs the package with the single configured release packer.
 *
 * The reproducible-build gate, the installed-package conformance test, and the attested release
 * tarball all use this function with `reproducibleBuild.packCommand` from
 * `config/release-integrity.config.json`, so the tarball that is tested is produced by the same
 * packer as the tarball that is attested and published.
 *
 * @param options - Packer command, package root, destination, and extra environment.
 * @returns The absolute path of the packed tarball.
 * @throws {Error} If the packer exits non-zero or reports no tarball.
 * @throws {SyntaxError} If the packer output is not JSON.
 */
export async function packWithConfiguredPacker(options: PackOptions): Promise<string> {
    const [executable, ...commandArguments] = options.packCommand;
    if (executable === undefined) {
        throw new Error("pack command is empty");
    }
    const output = await new Promise<string>((resolve, reject) => {
        const child = spawn(executable, [...commandArguments, options.destination], {
            cwd: options.repositoryRoot,
            env: {
                ...process.env,
                npm_config_update_notifier: "false",
                ...options.environment,
            },
            shell: process.platform === "win32",
            stdio: ["ignore", "pipe", "inherit"],
        });
        let text = "";
        child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
            text += chunk;
        });
        child.on("error", reject);
        child.on("close", (code) => {
            if (code === 0) {
                resolve(text);
            } else {
                reject(
                    new Error(
                        `${options.packCommand.join(" ")} ${options.destination} exited with ${code}`,
                    ),
                );
            }
        });
    });
    // npm prints an array of pack results or an object keyed by package name.
    const parsed = JSON.parse(output) as
        | readonly PackResult[]
        | Readonly<Record<string, PackResult>>;
    const [packed] = Array.isArray(parsed) ? parsed : Object.values(parsed);
    if (packed === undefined || typeof packed.filename !== "string") {
        throw new Error("pack produced no tarball");
    }
    return path.join(options.destination, packed.filename);
}
