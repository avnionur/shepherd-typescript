import assert from "node:assert/strict";
import { execFileSync, type SpawnSyncReturns, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Checks installed store/registry/CLI behavior on the current and explicitly supplied runtimes.
 * @param repositoryRoot - Checkout containing the reviewed fixture policy.
 * @param installedPackageRoot - Fresh tarball installation.
 * @param consumerParent - Isolated directory beside the installation's node_modules.
 * @param requireBoundaries - Require all configured boundary executable environment variables.
 * @returns Nothing after behavior and non-mutation assertions pass.
 * @throws {Error} If a runtime is absent/wrong or installed behavior differs from policy.
 */
export function testInstalledRuntimeBoundaries(
    repositoryRoot: string,
    installedPackageRoot: string,
    consumerParent: string,
    requireBoundaries: boolean,
): void {
    const policy = JSON.parse(
        readFileSync(path.join(repositoryRoot, "runtime-verification.config.json"), "utf8"),
    ) as {
        readonly boundaries: readonly {
            readonly environmentVariable: string;
            readonly version: string;
            readonly supported: boolean;
        }[];
        readonly probes: readonly {
            readonly source: string;
            readonly entry: string;
            readonly stdout: string;
        }[];
        readonly cliArguments: readonly string[];
        readonly cliOutputPattern: string;
        readonly refusalPattern: string;
    };
    const manifest = JSON.parse(
        readFileSync(path.join(installedPackageRoot, "package.json"), "utf8"),
    ) as {
        readonly name: string;
        readonly bin: Readonly<Record<string, string>>;
        readonly engines: { readonly node: string };
    };
    const installedPolicy = JSON.parse(
        readFileSync(path.join(installedPackageRoot, "dist/runtime.config.json"), "utf8"),
    ) as { readonly node: string };
    assert.equal(manifest.engines.node, installedPolicy.node);
    const runtimes = [
        { executable: process.execPath, version: process.versions.node, supported: true },
    ];
    if (requireBoundaries) {
        for (const boundary of policy.boundaries) {
            const executable = process.env[boundary.environmentVariable];
            assert.ok(
                executable && path.isAbsolute(executable),
                `set ${boundary.environmentVariable} to an absolute Node executable`,
            );
            runtimes.push({ executable, version: boundary.version, supported: boundary.supported });
        }
    }
    const [cliPath] = Object.values(manifest.bin);
    assert.ok(cliPath);
    for (const runtime of runtimes) {
        assert.equal(
            execFileSync(runtime.executable, ["-p", "process.versions.node"], {
                encoding: "utf8",
            }).trim(),
            runtime.version,
        );
        const consumer = mkdtempSync(path.join(consumerParent, "runtime-"));
        for (const probe of policy.probes) {
            const script = path.join(consumer, "probe.mjs");
            writeFileSync(
                script,
                readFileSync(path.join(repositoryRoot, probe.source), "utf8").replaceAll(
                    "PACKAGE_ENTRY",
                    `${manifest.name}/${probe.entry.slice(2)}`,
                ),
            );
            const destination = mkdtempSync(path.join(consumer, "storage-"));
            const result = spawnSync(runtime.executable, [script, destination], {
                cwd: consumer,
                encoding: "utf8",
            });
            assert.ifError(result.error);
            if (runtime.supported) {
                assert.equal(result.status, 0, result.stderr);
                assert.equal(result.stdout, probe.stdout);
            } else {
                assert.notEqual(result.status, 0);
                assert.match(result.stderr, new RegExp(policy.refusalPattern, "u"));
                assert.deepEqual(readdirSync(destination), []);
            }
        }
        const destination = mkdtempSync(path.join(consumer, "cli-"));
        const result: SpawnSyncReturns<string> = spawnSync(
            runtime.executable,
            [
                path.join(installedPackageRoot, cliPath),
                ...policy.cliArguments.map((value) =>
                    value.replaceAll("{destination}", destination),
                ),
            ],
            { cwd: consumer, encoding: "utf8" },
        );
        assert.ifError(result.error);
        if (runtime.supported) {
            assert.equal(result.status, 0, result.stderr);
            assert.match(result.stdout, new RegExp(policy.cliOutputPattern, "u"));
            assert.ok(readdirSync(destination).length > 0);
        } else {
            assert.notEqual(result.status, 0);
            assert.match(result.stderr, new RegExp(policy.refusalPattern, "u"));
            assert.deepEqual(readdirSync(destination), []);
        }
        process.stdout.write(
            `Installed runtime ${runtime.version}: ${runtime.supported ? "supported" : "refused before writes"}\n`,
        );
    }
}
