import { defaultRepositoryRoot } from "../tooling/release/integrity-config.ts";
import { checkSbom, writeSbom } from "../tooling/release/sbom.ts";

const [mode, ...rest] = process.argv.slice(2);
if (rest.length > 0 || (mode !== undefined && mode !== "--check")) {
    throw new TypeError("Usage: generate-sbom-cli.ts [--check]");
}

if (mode === "--check") {
    await checkSbom();
} else {
    await writeSbom(defaultRepositoryRoot);
}
