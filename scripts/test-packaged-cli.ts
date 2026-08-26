import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
            readonly quickstartDemo: string;
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
) as {
    readonly exports: Readonly<Record<string, { readonly import: string; readonly types: string }>>;
    readonly name: string;
};
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
    for (const entry of Object.values(packageManifest.exports)) {
        for (const target of [entry.import, entry.types]) {
            const installedTarget = path.join(installedPackageRoot, target);
            assert.equal(readFileSync(installedTarget).byteLength > 0, true);
            assert.equal(readFileSync(`${installedTarget}.map`).byteLength > 0, true);
        }
    }
    for (const artifact of Object.values(protocol.cli.artifacts)) {
        assert.equal(
            readFileSync(path.join(installedPackageRoot, artifact), "utf8"),
            readFileSync(path.join(repositoryRoot, artifact), "utf8"),
        );
    }
    const consumerRoot = path.join(installPath, "quickstart-consumer");
    mkdirSync(consumerRoot);
    const facadeProbe = path.join(consumerRoot, "facade-probe.mjs");
    writeFileSync(
        facadeProbe,
        `import { canonicalizeRecord as rootCanonical, runCli as rootRunCli } from ${JSON.stringify(packageManifest.name)};\nimport { canonicalizeRecord } from ${JSON.stringify(`${packageManifest.name}/canonical`)};\nimport { runCli } from ${JSON.stringify(`${packageManifest.name}/cli`)};\nif (canonicalizeRecord !== rootCanonical || runCli !== rootRunCli) throw new Error("facade mismatch");\nprocess.stdout.write(canonicalizeRecord({ ready: true }) + "\\n");\n`,
    );
    assert.equal(
        execFileSync(process.execPath, [facadeProbe], { cwd: consumerRoot, encoding: "utf8" }),
        '{"ready":true}\n',
    );
    assert.throws(
        () =>
            execFileSync(
                process.execPath,
                [
                    "--input-type=commonjs",
                    "--eval",
                    `require(${JSON.stringify(packageManifest.name)})`,
                ],
                { cwd: consumerRoot, stdio: "pipe" },
            ),
        /ERR_PACKAGE_PATH_NOT_EXPORTED/u,
    );
    assert.throws(
        () =>
            execFileSync(
                process.execPath,
                [
                    "--input-type=module",
                    "--eval",
                    `import ${JSON.stringify(`${packageManifest.name}/dist/src/index.js`)}`,
                ],
                { cwd: consumerRoot, stdio: "pipe" },
            ),
        /ERR_PACKAGE_PATH_NOT_EXPORTED/u,
    );
    const typeProbe = path.join(consumerRoot, "facade-probe.ts");
    writeFileSync(
        typeProbe,
        `import { task } from ${JSON.stringify(packageManifest.name)};\nimport { canonicalizeRecord } from ${JSON.stringify(`${packageManifest.name}/canonical`)};\nimport { runCli, type CliIo } from ${JSON.stringify(`${packageManifest.name}/cli`)};\nvoid task; void canonicalizeRecord; void runCli; const io: CliIo | null = null; void io;\n`,
    );
    const typeConfig = path.join(consumerRoot, "tsconfig.json");
    writeFileSync(
        typeConfig,
        JSON.stringify({
            compilerOptions: {
                lib: ["ESNext"],
                module: "NodeNext",
                moduleResolution: "NodeNext",
                noEmit: true,
                strict: true,
                target: "ESNext",
                typeRoots: [path.join(repositoryRoot, "node_modules", "@types")],
                types: ["node"],
            },
            files: [typeProbe],
        }),
    );
    execFileSync(
        path.join(
            repositoryRoot,
            "node_modules",
            ".bin",
            process.platform === "win32" ? "tsc.cmd" : "tsc",
        ),
        ["--project", typeConfig],
        { cwd: consumerRoot, stdio: "pipe" },
    );
    const quickstartSource = execFileSync(executable, ["demo", "write", "quickstart"], {
        encoding: "utf8",
    });
    assert.equal(
        quickstartSource,
        readFileSync(path.join(repositoryRoot, protocol.cli.artifacts.quickstartDemo), "utf8"),
    );
    const quickstartPath = path.join(consumerRoot, "quickstart.mjs");
    writeFileSync(quickstartPath, quickstartSource);
    const quickstartOutput = execFileSync(process.execPath, [quickstartPath], {
        cwd: consumerRoot,
        encoding: "utf8",
    });
    assert.equal(quickstartOutput, "['NOTE.txt']\nHello from a Shepherd retained output.\n");
    assert.equal(
        readFileSync(path.join(consumerRoot, "NOTE.txt"), "utf8"),
        "Hello from a Shepherd retained output.\n",
    );
    const traceStorePath = path.join(consumerRoot, ".vcscore", "quickstart-trace.sqlite");
    const run = invokeJson(executable, [
        "run",
        "show",
        "run:quickstart",
        "--store",
        traceStorePath,
    ]);
    assert.equal(run.result.run?.run_id, "run:quickstart");
    assert.equal(run.result.run?.inspection.status, "committed");
    const citations = invokeJson(executable, [
        "run",
        "output-citations",
        "--store",
        traceStorePath,
    ]);
    assert.equal(citations.result.output_citations?.length, 1);
    assert.equal(citations.result.output_citations?.[0]?.run_id, "run:quickstart");
    const outputs = invokeJson(executable, ["run", "outputs", "--store", traceStorePath]);
    assert.equal(outputs.result.outputs?.[0]?.run_id, "run:quickstart");
    const outputId = outputs.result.outputs?.[0]?.output.output_id;
    assert.equal(typeof outputId, "string");
    const changeset = invokeJson(executable, [
        "run",
        "changeset",
        outputId as string,
        "--store",
        traceStorePath,
        "--workspace",
        consumerRoot,
    ]);
    assert.deepEqual(
        changeset.result.changeset?.page.changes.map(({ path: changedPath }) => changedPath),
        ["NOTE.txt"],
    );
    const retainedText = execFileSync(
        executable,
        [
            "run",
            "changeset",
            outputId as string,
            "--read",
            "NOTE.txt",
            "--store",
            traceStorePath,
            "--workspace",
            consumerRoot,
        ],
        { encoding: "utf8" },
    );
    assert.equal(retainedText, "Hello from a Shepherd retained output.\n");
    const vcsCore = invokeJson(executable, [
        "run",
        "vcscore",
        outputId as string,
        "--store",
        traceStorePath,
    ]);
    assert.equal(vcsCore.result.vcscore?.output.output_id, outputId);
    const publication = invokeJson(executable, [
        "run",
        "publish-retained-workspace-output",
        "run:quickstart",
        "--store",
        traceStorePath,
    ]);
    assert.equal(publication.result.publication?.output.output_id, outputId);
    const traces = invokeJson(executable, ["run", "trace", "--store", traceStorePath]);
    assert.equal((traces.result.trace_revisions?.length ?? 0) > 0, true);
    const traceRevisions = invokeJson(executable, [
        "run",
        "trace-revision",
        "--store",
        traceStorePath,
    ]);
    assert.deepEqual(traceRevisions.result.trace_revisions, traces.result.trace_revisions);
} finally {
    rmSync(temporaryRoot, { force: true, recursive: true });
}

function invokeJson(executable: string, args: readonly string[]): InstalledJsonEnvelope {
    return JSON.parse(
        execFileSync(executable, [...args, `--${protocol.cli.options.json}`], {
            encoding: "utf8",
        }),
    );
}

type InstalledJsonEnvelope = {
    readonly result: {
        readonly changeset?: {
            readonly page: { readonly changes: readonly { readonly path: string }[] };
        };
        readonly output_citations?: readonly { readonly run_id: string }[];
        readonly publication?: { readonly output: { readonly output_id: string } };
        readonly outputs?: readonly {
            readonly output: { readonly output_id: string };
            readonly run_id: string;
        }[];
        readonly run?: {
            readonly inspection: { readonly status: string };
            readonly run_id: string;
        };
        readonly trace_revisions?: readonly unknown[];
        readonly vcscore?: { readonly output: { readonly output_id: string } };
    };
};

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
