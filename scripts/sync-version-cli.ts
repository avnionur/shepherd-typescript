import { fileURLToPath } from "node:url";

import { synchronizeVersions } from "./sync-version.ts";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const updatedFiles = await synchronizeVersions({
    configPath: fileURLToPath(new URL("../release-config.yaml", import.meta.url)),
    repositoryRoot,
});

console.log(`Synchronized ${updatedFiles} version file(s).`);
