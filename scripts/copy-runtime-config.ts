import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { protocolConfigUrl } from "../src/protocol/config.ts";
import { resolveBuildOutputDirectory } from "./build-output.ts";

const outputDirectory = resolveBuildOutputDirectory();

await mkdir(outputDirectory, { recursive: true });
await copyFile(
    protocolConfigUrl,
    pathToFileURL(path.join(outputDirectory, path.basename(fileURLToPath(protocolConfigUrl)))),
);
