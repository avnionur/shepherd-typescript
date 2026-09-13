import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type LinuxCarrierConfiguration = {
    readonly linux: {
        readonly containerSource: string;
        readonly containerWorkspace: string;
        readonly dockerExecutable: string;
        readonly dockerRunArguments: readonly string[];
        readonly image: string;
        readonly shellArguments: readonly string[];
        readonly shellExecutable: string;
        readonly steps: readonly string[];
        readonly tmpfsOptions: string;
        readonly tokens: Readonly<Record<string, string>>;
    };
    readonly requiredBackendsEnvironmentVariable: string;
    readonly requiredBackendsSeparator: string;
    readonly testFile: string;
};

const repositoryRoot = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const configuration = JSON.parse(
    readFileSync(path.join(repositoryRoot, "config/carrier-conformance.config.json"), "utf8"),
) as LinuxCarrierConfiguration;
const linux = configuration.linux;
const values: Readonly<Record<string, string>> = {
    requiredVariable: configuration.requiredBackendsEnvironmentVariable,
    source: linux.containerSource,
    testFile: configuration.testFile,
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
        linux.image,
        linux.shellExecutable,
        ...linux.shellArguments,
        script,
    ],
    { stdio: "inherit" },
);
if (result.error !== undefined) throw result.error;
process.exitCode = result.status ?? 1;
