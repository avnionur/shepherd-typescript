import { synchronizeProtocolArtifacts } from "../tooling/protocol/generator.ts";

await synchronizeProtocolArtifacts({
    check: process.argv.includes("--check"),
    repositoryRoot: process.cwd(),
});
