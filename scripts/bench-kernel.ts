import { fileURLToPath } from "node:url";

import { benchKernel, checkSlo } from "../tooling/benchmark/kernel-benchmark.ts";

const [mode, ...rest] = process.argv.slice(2);
if (rest.length > 0 || (mode !== undefined && mode !== "--check-slo")) {
    throw new TypeError("Usage: bench-kernel.ts [--check-slo]");
}

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const paths = {
    benchmarkConfiguration: `${repositoryRoot}config/kernel-benchmark.config.json`,
    repositoryRoot,
    sloConfiguration: `${repositoryRoot}config/performance-slo.config.json`,
};
const io = { write: (text: string) => process.stdout.write(text) };

if (mode === "--check-slo") {
    process.exitCode = (await checkSlo(paths, io)) ? 0 : 1;
} else {
    await benchKernel(paths, io);
}
