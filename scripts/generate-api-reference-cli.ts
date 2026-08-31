import { checkApiReference, writeApiReference } from "./api-reference.ts";

const [mode, ...rest] = process.argv.slice(2);
if (rest.length > 0 || (mode !== undefined && mode !== "--check")) {
    throw new TypeError("Usage: generate-api-reference-cli.ts [--check]");
}

if (mode === "--check") {
    await checkApiReference();
} else {
    await writeApiReference();
}
