import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { publicErrorConfigUrl } from "../src/errors/public-errors.ts";
import { protocolConfigUrl } from "../src/protocol/config.ts";
import { resolveBuildOutputDirectory } from "./build-output.ts";

const outputDirectory = resolveBuildOutputDirectory();

await mkdir(outputDirectory, { recursive: true });
for (const configUrl of [protocolConfigUrl, publicErrorConfigUrl]) {
    await copyFile(
        configUrl,
        pathToFileURL(path.join(outputDirectory, path.basename(fileURLToPath(configUrl)))),
    );
}
