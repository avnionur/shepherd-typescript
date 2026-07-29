import { rm } from "node:fs/promises";

import { assertSafeBuildOutputDirectory, resolveBuildOutputDirectory } from "./build-output.ts";

const outputDirectory = resolveBuildOutputDirectory();
await assertSafeBuildOutputDirectory(outputDirectory);
await rm(outputDirectory, { force: true, recursive: true });
