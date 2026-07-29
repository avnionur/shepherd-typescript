import { synchronizeProtocolArtifacts } from "./generate-protocol-artifacts.ts";

await synchronizeProtocolArtifacts({
    check: process.argv.includes("--check"),
    repositoryRoot: process.cwd(),
});
