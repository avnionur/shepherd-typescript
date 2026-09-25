import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

/** Consumer TypeScript compiler policy read from `config/runtime-verification.config.json`. */
export type TypeScriptPolicy = {
    /**
     * Environment variable naming an absolute path to the `bin/tsc` script of the minimum
     * supported compiler; required by the runtime-boundary command.
     */
    readonly environmentVariable: string;
    /** Minimum supported consumer TypeScript version (`MAJOR.MINOR.PATCH`). */
    readonly minimum: string;
};

/** One TypeScript compiler used to typecheck installed consumers. */
export type ConsumerCompiler = {
    /** Absolute path of the compiler's `bin/tsc` script, run with the current Node executable. */
    readonly script: string;
    /** Reported compiler version. */
    readonly version: string;
};

/**
 * Reads the consumer TypeScript policy.
 *
 * @param repositoryRoot - Checkout containing `config/runtime-verification.config.json`.
 * @returns The validated policy.
 * @throws {TypeError} If the `typescript` section is missing or malformed.
 */
export function readTypeScriptPolicy(repositoryRoot: string): TypeScriptPolicy {
    const configuration = JSON.parse(
        readFileSync(path.join(repositoryRoot, "config/runtime-verification.config.json"), "utf8"),
    ) as { readonly typescript?: Partial<TypeScriptPolicy> };
    const policy = configuration.typescript;
    if (
        typeof policy?.minimum !== "string" ||
        parseVersion(policy.minimum) === undefined ||
        typeof policy.environmentVariable !== "string" ||
        policy.environmentVariable.length === 0
    ) {
        throw new TypeError(
            "runtime-verification typescript must define minimum (MAJOR.MINOR.PATCH) and environmentVariable",
        );
    }
    return { environmentVariable: policy.environmentVariable, minimum: policy.minimum };
}

/**
 * Compares a compiler version with the configured minimum.
 *
 * @param version - Reported compiler version, optionally with a prerelease suffix.
 * @param minimum - Configured minimum `MAJOR.MINOR.PATCH`.
 * @returns Whether `version` is at least `minimum`; a prerelease of the minimum itself does not
 * satisfy it.
 * @throws {TypeError} If either version is not `MAJOR.MINOR.PATCH`.
 */
export function satisfiesMinimumVersion(version: string, minimum: string): boolean {
    const actual = parseVersion(version);
    const required = parseVersion(minimum);
    if (actual === undefined || required === undefined) {
        throw new TypeError(`cannot compare TypeScript versions ${version} and ${minimum}`);
    }
    for (let index = 0; index < 3; index += 1) {
        const difference = (actual[index] as number) - (required[index] as number);
        if (difference !== 0) {
            return difference > 0;
        }
    }
    return !version.includes("-");
}

/**
 * Lists the compilers that must typecheck installed consumers.
 *
 * The repository compiler is always included and must satisfy the configured minimum. When the
 * policy's environment variable is set, or when `requireMinimum` is true, the named compiler must
 * report exactly the configured minimum version and is included as well.
 *
 * @param policy - Consumer TypeScript policy.
 * @param requireMinimum - Require the minimum-compiler environment variable.
 * @returns The repository compiler and, when supplied, the minimum compiler.
 * @throws {AssertionError} If a compiler is missing or its version violates the policy.
 */
export function consumerCompilers(
    policy: TypeScriptPolicy,
    requireMinimum: boolean,
): readonly ConsumerCompiler[] {
    const manifestPath = createRequire(import.meta.url).resolve("typescript/package.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
        readonly bin: { readonly tsc: string };
        readonly version: string;
    };
    const repositoryCompiler = {
        script: path.resolve(path.dirname(manifestPath), manifest.bin.tsc),
        version: manifest.version,
    };
    assertTypeScriptVersion(repositoryCompiler.version, policy.minimum);
    const compilers: ConsumerCompiler[] = [repositoryCompiler];
    const minimumScript = process.env[policy.environmentVariable];
    if (requireMinimum || (minimumScript !== undefined && minimumScript.length > 0)) {
        assert.ok(
            minimumScript && path.isAbsolute(minimumScript),
            `set ${policy.environmentVariable} to the absolute bin/tsc of TypeScript ${policy.minimum}`,
        );
        const version = execFileSync(process.execPath, [minimumScript, "--version"], {
            encoding: "utf8",
        })
            .trim()
            .replace(/^Version /u, "");
        assert.equal(version, policy.minimum, `${policy.environmentVariable} reports ${version}`);
        compilers.push({ script: minimumScript, version });
    }
    return compilers;
}

/**
 * Asserts that a compiler version meets the minimum supported consumer version.
 *
 * @param version - Reported compiler version.
 * @param minimum - Configured minimum version.
 * @throws {AssertionError} If `version` is older than `minimum`.
 */
export function assertTypeScriptVersion(version: string, minimum: string): void {
    assert.ok(
        satisfiesMinimumVersion(version, minimum),
        `TypeScript ${version} is older than the supported minimum ${minimum}`,
    );
}

function parseVersion(version: string): readonly [number, number, number] | undefined {
    const match = /^(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)(?:-[0-9A-Za-z.-]+)?$/u.exec(
        version,
    );
    if (match?.groups === undefined) {
        return undefined;
    }
    return [Number(match.groups.major), Number(match.groups.minor), Number(match.groups.patch)];
}
