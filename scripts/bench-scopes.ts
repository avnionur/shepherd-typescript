import { fileURLToPath } from "node:url";

import { benchScopes, checkScopeSlo } from "../tooling/benchmark/scope-benchmark.ts";

const [mode, ...rest] = process.argv.slice(2);
if (rest.length > 0 || (mode !== undefined && mode !== "--check-slo")) {
    throw new TypeError("Usage: bench-scopes.ts [--check-slo]");
}

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const paths = {
    configuration: `${repositoryRoot}config/scope-benchmark.config.json`,
    repositoryRoot,
};
const io = { write: (text: string) => process.stdout.write(text) };

if (mode === "--check-slo") {
    process.exitCode = (await checkScopeSlo(paths, io)) ? 0 : 1;
} else {
    await benchScopes(paths, io);
}
