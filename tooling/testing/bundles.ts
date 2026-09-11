import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
    copyFileSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    renameSync,
    writeFileSync,
} from "node:fs";
import path from "node:path";

import { nodeResolve } from "@rollup/plugin-node-resolve";
import { type OutputChunk, type RenderedModule, rollup } from "rollup";

/** Locations used by installed-package bundle verification. */
export type BundleVerificationOptions = {
    /** Checkout containing the reviewed bundling policy. */
    readonly repositoryRoot: string;
    /** Fresh tarball installation's package root. */
    readonly installedPackageRoot: string;
    /** Isolated parent beside installed node_modules. */
    readonly consumerParent: string;
};

/**
 * Bundles installed entry fixtures, checks retained code, and executes asset failure/success cases.
 *
 * @param options - Policy checkout and isolated installation locations.
 * @returns A promise resolving after all bundle assertions pass.
 * @throws {Error} If resolution, bundling, retained modules, assets, or execution violate policy.
 */
export async function testInstalledBundles(options: BundleVerificationOptions): Promise<void> {
    const installedRoot = realpathSync(options.installedPackageRoot);
    const policy = JSON.parse(
        readFileSync(
            path.join(options.repositoryRoot, "config/bundle-verification.config.json"),
            "utf8",
        ),
    ) as {
        readonly output: string;
        readonly allowedWarnings: readonly string[];
        readonly fixtures: readonly {
            readonly entry: string;
            readonly symbol: string;
            readonly argument: unknown;
            readonly stdout: string;
            readonly requiredModules: readonly string[];
            readonly forbiddenModules: readonly string[];
            readonly removedExports: Readonly<Record<string, readonly string[]>>;
            readonly assets: readonly { readonly source: string; readonly destination: string }[];
        }[];
    };
    const manifest = JSON.parse(
        readFileSync(path.join(options.installedPackageRoot, "package.json"), "utf8"),
    ) as {
        readonly name: string;
        readonly exports: Readonly<Record<string, unknown>>;
    };
    for (const fixture of policy.fixtures) {
        assert.ok(Object.hasOwn(manifest.exports, fixture.entry));
        const consumer = mkdtempSync(path.join(options.consumerParent, "bundle-"));
        const entryPath = path.join(consumer, "entry.mjs");
        const specifier =
            fixture.entry === "." ? manifest.name : `${manifest.name}/${fixture.entry.slice(2)}`;
        writeFileSync(
            entryPath,
            `import { ${fixture.symbol} as operation } from ${JSON.stringify(specifier)};
process.stdout.write(operation(${JSON.stringify(fixture.argument)}) + "\\n");
`,
        );
        const chunks: OutputChunk[] = [];
        for (const treeshake of [false, true]) {
            const build = await rollup({
                input: entryPath,
                treeshake,
                plugins: [nodeResolve({ preferBuiltins: true })],
                external: (id) => id.startsWith("node:"),
                onwarn: (warning) => {
                    if (warning.code && policy.allowedWarnings.includes(warning.code)) return;
                    throw new Error(warning.message);
                },
            });
            try {
                const generated = await build.generate({ format: "es" });
                assert.equal(generated.output.length, 1);
                chunks.push(generated.output[0]);
            } finally {
                await build.close();
            }
        }
        const [unshaken, shaken] = chunks;
        assert.ok(
            unshaken && shaken && shaken.code.length < unshaken.code.length,
            "tree-shaking must remove code in the exercised fixture",
        );
        const rendered = new Set(
            Object.entries(shaken.modules)
                .filter(([, module]) => module.renderedLength > 0)
                .map(([id]) => path.relative(installedRoot, id).split(path.sep).join("/")),
        );
        for (const required of fixture.requiredModules)
            assert.ok(rendered.has(required), `missing retained ${required}`);
        for (const forbidden of fixture.forbiddenModules)
            assert.ok(!rendered.has(forbidden), `unexpected retained ${forbidden}`);
        for (const [module, exports] of Object.entries(fixture.removedExports)) {
            const metadata: RenderedModule | undefined = Object.entries(shaken.modules).find(
                ([id]) => path.relative(installedRoot, id).split(path.sep).join("/") === module,
            )?.[1];
            assert.ok(metadata);
            for (const name of exports)
                assert.ok(metadata.removedExports.includes(name), `export ${name} was not removed`);
        }
        const output = path.resolve(consumer, policy.output);
        assert.ok(output.startsWith(`${consumer}${path.sep}`));
        mkdirSync(path.dirname(output), { recursive: true });
        writeFileSync(output, shaken.code);
        for (const asset of fixture.assets) {
            const destination = path.resolve(consumer, asset.destination);
            assert.ok(destination.startsWith(`${consumer}${path.sep}`));
            mkdirSync(path.dirname(destination), { recursive: true });
            copyFileSync(path.join(options.installedPackageRoot, asset.source), destination);
        }
        assert.equal(
            execFileSync(process.execPath, [output], { cwd: consumer, encoding: "utf8" }),
            fixture.stdout,
        );
        for (const asset of fixture.assets) {
            const destination = path.resolve(consumer, asset.destination);
            const saved = `${destination}.saved`;
            renameSync(destination, saved);
            try {
                assert.throws(
                    () =>
                        execFileSync(process.execPath, [output], { cwd: consumer, stdio: "pipe" }),
                    /ENOENT/u,
                );
                writeFileSync(destination, "null");
                assert.throws(() =>
                    execFileSync(process.execPath, [output], { cwd: consumer, stdio: "pipe" }),
                );
            } finally {
                renameSync(saved, destination);
            }
        }
        assert.equal(
            execFileSync(process.execPath, [output], { cwd: consumer, encoding: "utf8" }),
            fixture.stdout,
        );
    }
}
