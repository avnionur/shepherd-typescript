import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type LinuxDeviceLayerLane = {
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

// Runs the device-layer conformance kit (overlay required on tmpfs; clone and overlay required on
// loopback XFS with reflink) and pnpm bench:device-layers on tmpfs in a privileged Linux container,
// then copies the result artifact back.
const repositoryRoot = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const read = <T>(file: string): T =>
    JSON.parse(readFileSync(path.join(repositoryRoot, "config", file), "utf8")) as T;
const benchmark = read<{
    readonly linux: LinuxDeviceLayerLane;
    readonly outputDirectory: string;
    readonly outputPrefix: string;
}>("device-layer-benchmark.config.json");
const conformance = read<{
    readonly requiredAdaptersEnvironmentVariable: string;
    readonly testFile: string;
}>("device-layer-conformance.config.json");
const linux = benchmark.linux;
const values: Readonly<Record<string, string>> = {
    output: linux.containerOutput,
    outputDirectory: benchmark.outputDirectory,
    outputPrefix: benchmark.outputPrefix,
    requiredVariable: conformance.requiredAdaptersEnvironmentVariable,
    source: linux.containerSource,
    testFile: conformance.testFile,
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
