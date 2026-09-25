import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/** Package-manifest fields whose targets must exist before publication. */
type PublishedTargets = {
    /** Executable targets keyed by command name. */
    readonly bin?: Readonly<Record<string, string>>;
    /** Conditional export targets keyed by subpath. */
    readonly exports?: Readonly<Record<string, Readonly<Record<string, string>>>>;
    /** Legacy main entry. */
    readonly main?: string;
    /** Legacy types entry. */
    readonly types?: string;
};

/**
 * Lists the manifest targets of a package that are missing on disk.
 *
 * Every `main`, `types`, `bin`, and conditional `exports` target is read from the manifest, so no
 * entry path is hard-coded. Targets are resolved relative to the package root.
 *
 * @param packageRoot - Directory containing `package.json`.
 * @returns The sorted, de-duplicated manifest-relative targets that do not exist.
 * @throws {Error} If `package.json` cannot be read or parsed.
 * @example
 * ```ts
 * findMissingPublishedTargets(process.cwd()); // [] after `pnpm build`
 * ```
 */
export function findMissingPublishedTargets(packageRoot: string): readonly string[] {
    const manifest = JSON.parse(
        readFileSync(path.join(packageRoot, "package.json"), "utf8"),
    ) as PublishedTargets;
    const targets = [
        manifest.main,
        manifest.types,
        ...Object.values(manifest.bin ?? {}),
        ...Object.values(manifest.exports ?? {}).flatMap((conditions) => Object.values(conditions)),
    ].filter((target): target is string => typeof target === "string");
    return [...new Set(targets)]
        .filter((target) => !existsSync(path.resolve(packageRoot, target)))
        .sort();
}

/**
 * Fails publication when the build output named by the manifest is absent.
 *
 * Used by the `prepublishOnly` lifecycle script so `npm publish` from a clean checkout stops with
 * an actionable message instead of publishing a package without its entry points.
 *
 * @param packageRoot - Directory containing `package.json`.
 * @throws {Error} If any manifest target is missing; the message lists every missing target and
 * names the build command.
 */
export function assertPublishedTargetsExist(packageRoot: string): void {
    const missing = findMissingPublishedTargets(packageRoot);
    if (missing.length > 0) {
        throw new Error(
            [
                "refusing to publish: package.json targets are missing (run `pnpm build` first):",
                ...missing.map((target) => `- ${target}`),
            ].join("\n"),
        );
    }
}
