import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readScopeBenchmarkConfiguration } from "../tooling/benchmark/scope-benchmark-config.ts";

type LinuxScopeBenchmarkLane = {
    readonly containerOutput: string;
    readonly containerSource: string;
    readonly containerWorkspace: string;
    readonly dockerExecutable: string;
    readonly dockerRunArguments: readonly string[];
    readonly hostOutput: string;
    readonly image: string;
    readonly shellArguments: readonly string[];
    readonly shellExecutable: string;
    readonly steps: readonly string[];
    readonly tmpfsOptions: string;
    readonly tokens: Readonly<Record<string, string>>;
};

// Runs pnpm bench:scopes in a privileged Linux container on loopback XFS with reflink, where the
// copy, clone, and overlay carriers are all conformant, and copies the result artifact back.
const repositoryRoot = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const file = path.join(repositoryRoot, "config/scope-benchmark.config.json");
const { benchmark } = readScopeBenchmarkConfiguration(file);
const linux = (
    JSON.parse(readFileSync(file, "utf8")) as { readonly linux: LinuxScopeBenchmarkLane }
).linux;
const values: Readonly<Record<string, string>> = {
    output: linux.containerOutput,
    resultDirectory: benchmark.resultDirectory,
    resultPrefix: benchmark.resultPrefix,
    source: linux.containerSource,
    workspace: linux.containerWorkspace,
};
const script = linux.steps
    .map((step) =>
        Object.entries(linux.tokens).reduce(
            (rendered, [name, token]) => rendered.replaceAll(token, values[name] ?? token),
            step,
        ),
    )
    .join(" && ");
const result = spawnSync(
    linux.dockerExecutable,
    [
        ...linux.dockerRunArguments,
        "--tmpfs",
        `${linux.containerWorkspace}:${linux.tmpfsOptions}`,
        "--volume",
        `${repositoryRoot}:${linux.containerSource}:ro`,
        "--volume",
        `${path.join(repositoryRoot, linux.hostOutput)}:${linux.containerOutput}`,
        linux.image,
        linux.shellExecutable,
        ...linux.shellArguments,
        script,
    ],
    { stdio: "inherit" },
);
if (result.error !== undefined) throw result.error;
process.exitCode = result.status ?? 1;
