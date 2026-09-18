import { synchronizeApplicationEvaluation } from "../tooling/evaluation/writer.ts";

const [mode, ...rest] = process.argv.slice(2);
if (rest.length > 0 || (mode !== undefined && mode !== "--check")) {
    throw new TypeError("Usage: evaluate-applications-cli.ts [--check]");
}

await synchronizeApplicationEvaluation({
    check: mode === "--check",
    repositoryRoot: process.cwd(),
});
