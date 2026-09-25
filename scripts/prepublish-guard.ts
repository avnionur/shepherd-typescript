import { fileURLToPath } from "node:url";

import { assertPublishedTargetsExist } from "../tooling/release/prepublish-guard.ts";

try {
    assertPublishedTargetsExist(fileURLToPath(new URL("../", import.meta.url)));
} catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
}
