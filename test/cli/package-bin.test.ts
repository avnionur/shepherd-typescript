import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { runCli } from "../../src/index.ts";

test("package bin metadata matches the public distinct CLI executable", async () => {
    const root = new URL("../../", import.meta.url);
    const packageManifest = JSON.parse(readFileSync(new URL("package.json", root), "utf8")) as {
        readonly bin: Readonly<Record<string, string>>;
        readonly files: readonly string[];
        readonly exports: Readonly<Record<string, unknown>>;
        readonly main: string;
        readonly types: string;
    };
    const protocol = JSON.parse(readFileSync(new URL("protocol.config.json", root), "utf8")) as {
        readonly cli: { readonly executableName: string; readonly executablePath: string };
    };

    const output: string[] = [];
    assert.equal(
        await runCli(["--help"], {
            cwd: process.cwd(),
            stderr: () => undefined,
            stdout: (text) => output.push(text),
        }),
        0,
    );
    const executable = /^Usage: (?<name>\S+)/u.exec(output.join(""))?.groups?.name;
    assert.equal(executable, protocol.cli.executableName);
    assert.deepEqual(packageManifest.bin, { [executable as string]: protocol.cli.executablePath });
    assert.equal(packageManifest.files.includes("dist/src"), true);
    assert.equal(packageManifest.main, "dist/src/index.js");
    assert.equal(packageManifest.types, "dist/src/index.d.ts");
    assert.deepEqual(packageManifest.exports, {
        ".": { import: "./dist/src/index.js", types: "./dist/src/index.d.ts" },
        "./canonical": {
            import: "./dist/src/facades/canonical.js",
            types: "./dist/src/facades/canonical.d.ts",
        },
        "./cli": {
            import: "./dist/src/facades/cli.js",
            types: "./dist/src/facades/cli.d.ts",
        },
        "./providers": {
            import: "./dist/src/facades/providers.js",
            types: "./dist/src/facades/providers.d.ts",
        },
        "./tasks": {
            import: "./dist/src/facades/tasks.js",
            types: "./dist/src/facades/tasks.d.ts",
        },
    });
});
