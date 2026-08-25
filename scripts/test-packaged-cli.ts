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
        readonly artifacts: {
            readonly commandReference: string;
            readonly jsonOutputSchema: string;
        };
        readonly executableName: string;
        readonly executablePath: string;
        readonly groups: readonly { readonly name: string }[];
        readonly helpAliases: readonly string[];
        readonly machineOutput: {
            readonly compatibilityVersion: string;
            readonly version: number;
        };
        readonly options: { readonly json: string };
    };
};
const packageManifest = JSON.parse(
    readFileSync(path.join(repositoryRoot, "package.json"), "utf8"),
) as { readonly name: string };
const temporaryRoot = mkdtempSync(path.join(tmpdir(), "shepherd-packaged-cli-"));
const cachePath = path.join(temporaryRoot, "cache");
const installPath = path.join(temporaryRoot, "install");
const packPath = path.join(temporaryRoot, "pack");
mkdirSync(cachePath);
mkdirSync(installPath);
mkdirSync(packPath);

try {
    const helpAlias = protocol.cli.helpAliases[0];
    assert.ok(helpAlias);
    assertStableJsonHelp(process.execPath, [
        path.join(repositoryRoot, protocol.cli.executablePath),
        helpAlias,
        `--${protocol.cli.options.json}`,
    ]);
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
    const output = execFileSync(executable, [helpAlias], { encoding: "utf8" });
    assert.equal(
        output,
        `Usage: ${protocol.cli.executableName} <command> [options]\n\nCommands:\n${protocol.cli.groups.map(({ name }) => `  ${name}\n`).join("")}`,
    );
    assertStableJsonHelp(executable, [helpAlias, `--${protocol.cli.options.json}`]);
    const installedPackageRoot = path.join(
        installPath,
        "node_modules",
        ...packageManifest.name.split("/"),
    );
    for (const artifact of Object.values(protocol.cli.artifacts)) {
        assert.equal(
            readFileSync(path.join(installedPackageRoot, artifact), "utf8"),
            readFileSync(path.join(repositoryRoot, artifact), "utf8"),
        );
    }
} finally {
    rmSync(temporaryRoot, { force: true, recursive: true });
}

function assertStableJsonHelp(executable: string, args: readonly string[]): void {
    const jsonOutput = execFileSync(executable, args, { encoding: "utf8" });
    assert.deepEqual(JSON.parse(jsonOutput), {
        cli_compatibility_version: protocol.cli.machineOutput.compatibilityVersion,
        cli_output_version: protocol.cli.machineOutput.version,
        command: [],
        ok: true,
        result: { groups: protocol.cli.groups.map(({ name }) => name) },
    });
}
