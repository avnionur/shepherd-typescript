import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { API } from "typescript/unstable/sync";

import { protocolConfigUrl } from "../src/protocol-config.ts";

const repositoryRoot = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const buildConfigurationPath = fileURLToPath(new URL("../tsconfig.build.json", import.meta.url));
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
    throw new Error("tsconfig.build.json compilerOptions.outDir must remain inside the repository");
}

await mkdir(outputDirectory, { recursive: true });
await copyFile(
    protocolConfigUrl,
    pathToFileURL(path.join(outputDirectory, path.basename(fileURLToPath(protocolConfigUrl)))),
);
