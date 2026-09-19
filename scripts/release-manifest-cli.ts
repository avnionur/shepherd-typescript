import { execFileSync } from "node:child_process";

import { defaultRepositoryRoot } from "../tooling/release/integrity-config.ts";
import { isProvenanceStatement, writeReleaseEvidence } from "../tooling/release/provenance.ts";

if (process.argv.length > 2) {
    throw new TypeError("Usage: release-manifest-cli.ts");
}

const read = (executable: string, commandArguments: readonly string[]): string =>
    execFileSync(executable, commandArguments, {
        cwd: defaultRepositoryRoot,
        encoding: "utf8",
        env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    }).trim();

const evidence = await writeReleaseEvidence({
    commit: read("git", ["rev-parse", "HEAD"]),
    nodeVersion: process.version,
    pnpmVersion: read("pnpm", ["--version"]),
    workingTreeClean: read("git", ["status", "--porcelain"]).length === 0,
});
if (!isProvenanceStatement(evidence.statement)) {
    throw new Error("generated provenance statement is malformed");
}
process.stdout.write(`release evidence written: ${evidence.manifestPath}\n`);
