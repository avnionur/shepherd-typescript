import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
    existsSync,
    lstatSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    writeFileSync,
} from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

/** Documented-quickstart budgets read from `config/runtime-verification.config.json`. */
export type QuickstartPolicy = {
    /** Workspace-relative directory the emitted quickstart binds instead of the whole workspace. */
    readonly bindingDirectory: string;
    /** Maximum wall time, in milliseconds, for emitting and running the quickstart. */
    readonly maxWallTimeMilliseconds: number;
    /** Maximum total regular-file bytes under the workspace control directory after the run. */
    readonly maxRetainedStateBytes: number;
};

/** Inputs for {@link testInstalledQuickstartFlow}. */
export type QuickstartFlowOptions = {
    /** Checkout containing the configuration files and the quickstart artifact. */
    readonly repositoryRoot: string;
    /** Packed package tarball to install into the consumer directory. */
    readonly archivePath: string;
    /** npm cache directory shared with the rest of package conformance. */
    readonly cachePath: string;
    /** New consumer directory; it must not exist and receives its own `node_modules`. */
    readonly consumerRoot: string;
    /** Published package name. */
    readonly packageName: string;
    /** Configured CLI executable name. */
    readonly executableName: string;
    /** Configured CLI `demo write` quickstart name. */
    readonly demoName: string;
    /** Package-relative path of the quickstart artifact the CLI must emit byte-for-byte. */
    readonly demoArtifact: string;
    /** Configured workspace control directory name. */
    readonly controlDirectory: string;
};

/** Evidence returned after the documented quickstart flow passes its budgets. */
export type QuickstartFlowResult = {
    /** Consumer directory holding `node_modules`, `quickstart.mjs`, and the control directory. */
    readonly consumerRoot: string;
    /** Installed CLI executable inside the consumer's own `node_modules`. */
    readonly executable: string;
    /** Absolute path of the directory the quickstart bound and settled into. */
    readonly bindingRoot: string;
    /** Measured wall time of `demo write` plus `node quickstart.mjs`, in milliseconds. */
    readonly wallTimeMilliseconds: number;
    /** Measured regular-file bytes under the control directory. */
    readonly retainedStateBytes: number;
};

/**
 * Reads the documented-quickstart budgets.
 *
 * @param repositoryRoot - Checkout containing `config/runtime-verification.config.json`.
 * @returns The validated policy.
 * @throws {TypeError} If the `quickstart` section is missing or malformed.
 */
export function readQuickstartPolicy(repositoryRoot: string): QuickstartPolicy {
    const configuration = JSON.parse(
        readFileSync(path.join(repositoryRoot, "config/runtime-verification.config.json"), "utf8"),
    ) as { readonly quickstart?: Partial<QuickstartPolicy> };
    const policy = configuration.quickstart;
    if (
        typeof policy?.bindingDirectory !== "string" ||
        policy.bindingDirectory.length === 0 ||
        path.isAbsolute(policy.bindingDirectory) ||
        policy.bindingDirectory.split(/[\\/]/u).includes("..") ||
        !isPositiveInteger(policy.maxWallTimeMilliseconds) ||
        !isPositiveInteger(policy.maxRetainedStateBytes)
    ) {
        throw new TypeError(
            "runtime-verification quickstart must define a relative bindingDirectory and positive integer maxWallTimeMilliseconds and maxRetainedStateBytes",
        );
    }
    return {
        bindingDirectory: policy.bindingDirectory,
        maxRetainedStateBytes: policy.maxRetainedStateBytes,
        maxWallTimeMilliseconds: policy.maxWallTimeMilliseconds,
    };
}

/**
 * Runs the documented quickstart in a consumer directory that holds its own local install.
 *
 * Installs the tarball into `consumerRoot` (so `node_modules` sits beside the script, as after a
 * local `npm install`), emits the demo through the installed binary, runs it, and asserts the
 * transcript, the settled file inside the configured binding directory, the configured wall-time
 * budget, and the configured retained-state size budget.
 *
 * @param options - Tarball, consumer directory, and configured CLI/workspace names.
 * @returns Measured evidence and the paths later CLI inspection uses.
 * @throws {AssertionError} If output, placement, or a budget differs from policy.
 * @throws {Error} If installation or a consumer process fails.
 */
export function testInstalledQuickstartFlow(options: QuickstartFlowOptions): QuickstartFlowResult {
    const policy = readQuickstartPolicy(options.repositoryRoot);
    const { consumerRoot } = options;
    mkdirSync(consumerRoot);
    execFileSync(
        process.platform === "win32" ? "npm.cmd" : "npm",
        [
            "install",
            "--prefix",
            consumerRoot,
            options.archivePath,
            "--ignore-scripts",
            "--cache",
            options.cachePath,
        ],
        { cwd: consumerRoot, stdio: "ignore" },
    );
    assert.ok(
        existsSync(
            path.join(
                consumerRoot,
                "node_modules",
                ...options.packageName.split("/"),
                "package.json",
            ),
        ),
        "quickstart consumer must hold its own local install",
    );
    const executable = path.join(
        consumerRoot,
        "node_modules",
        ".bin",
        process.platform === "win32" ? `${options.executableName}.cmd` : options.executableName,
    );
    const quickstartPath = path.join(consumerRoot, "quickstart.mjs");
    const started = performance.now();
    const source = execFileSync(executable, ["demo", "write", options.demoName], {
        cwd: consumerRoot,
        encoding: "utf8",
    });
    writeFileSync(quickstartPath, source);
    const output = execFileSync(process.execPath, [quickstartPath], {
        cwd: consumerRoot,
        encoding: "utf8",
    });
    const wallTimeMilliseconds = performance.now() - started;
    assert.equal(
        source,
        readFileSync(path.join(options.repositoryRoot, options.demoArtifact), "utf8"),
    );
    assert.ok(
        source.includes(JSON.stringify(policy.bindingDirectory)),
        "emitted quickstart must bind the configured binding directory",
    );
    assert.equal(output, "['NOTE.txt']\nHello from a Shepherd retained output.\n");
    const bindingRoot = path.join(consumerRoot, policy.bindingDirectory);
    assert.equal(
        readFileSync(path.join(bindingRoot, "NOTE.txt"), "utf8"),
        "Hello from a Shepherd retained output.\n",
    );
    assert.equal(existsSync(path.join(consumerRoot, "NOTE.txt")), false);
    const retainedStateBytes = regularFileBytes(path.join(consumerRoot, options.controlDirectory));
    assert.ok(
        wallTimeMilliseconds <= policy.maxWallTimeMilliseconds,
        `quickstart took ${Math.round(wallTimeMilliseconds)} ms; budget is ${policy.maxWallTimeMilliseconds} ms`,
    );
    assert.ok(
        retainedStateBytes <= policy.maxRetainedStateBytes,
        `quickstart retained ${retainedStateBytes} bytes; budget is ${policy.maxRetainedStateBytes} bytes`,
    );
    return { bindingRoot, consumerRoot, executable, retainedStateBytes, wallTimeMilliseconds };
}

function isPositiveInteger(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function regularFileBytes(directory: string): number {
    let total = 0;
    for (const entry of readdirSync(directory, { recursive: true, withFileTypes: true })) {
        if (entry.isFile()) {
            total += lstatSync(path.join(entry.parentPath, entry.name)).size;
        }
    }
    return total;
}
