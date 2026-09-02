import { runRepositoryTests } from "../tooling/testing/test-runner.ts";

const [mode, ...rest] = process.argv.slice(2);
if (rest.length > 0 || (mode !== "--parallel" && mode !== "--serial")) {
    throw new TypeError("Usage: run-tests.ts <--parallel|--serial>");
}

const succeeded = await runRepositoryTests({
    mode: mode === "--parallel" ? "parallel" : "serial",
    output: process.stdout,
});
if (!succeeded) process.exitCode = 1;
