import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const repositoryRoot = path.resolve(new URL("../", import.meta.url).pathname);
const protocol = JSON.parse(
    readFileSync(path.join(repositoryRoot, "protocol.config.json"), "utf8"),
) as {
    readonly cli: {
        readonly executableName: string;
        readonly groups: readonly { readonly name: string }[];
        readonly helpAliases: readonly string[];
    };
};
const temporaryRoot = mkdtempSync(path.join(tmpdir(), "shepherd-packaged-cli-"));
const cachePath = path.join(temporaryRoot, "cache");
const installPath = path.join(temporaryRoot, "install");
const packPath = path.join(temporaryRoot, "pack");
mkdirSync(cachePath);
mkdirSync(installPath);
mkdirSync(packPath);

try {
    const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";
    const archiveName = execFileSync(
        npmExecutable,
        ["pack", "--pack-destination", packPath, "--cache", cachePath],
        { cwd: repositoryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    const archivePath = path.join(packPath, archiveName);
    execFileSync(
        npmExecutable,
        ["install", "--prefix", installPath, archivePath, "--ignore-scripts", "--cache", cachePath],
        { cwd: repositoryRoot, stdio: "ignore" },
    );
    const executable = path.join(
        installPath,
        "node_modules",
        ".bin",
        process.platform === "win32"
            ? `${protocol.cli.executableName}.cmd`
            : protocol.cli.executableName,
    );
    const helpAlias = protocol.cli.helpAliases[0];
    assert.ok(helpAlias);
    const output = execFileSync(executable, [helpAlias], { encoding: "utf8" });
    assert.equal(
        output,
        `Usage: ${protocol.cli.executableName} <command> [options]\n\nCommands:\n${protocol.cli.groups.map(({ name }) => `  ${name}\n`).join("")}`,
    );
} finally {
    rmSync(temporaryRoot, { force: true, recursive: true });
}
