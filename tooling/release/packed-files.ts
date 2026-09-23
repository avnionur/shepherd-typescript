import type { PackedFilesConfiguration } from "./integrity-config.ts";
import type { TarEntry } from "./reproducible-build.ts";

/** Result of comparing a packed tarball with the package's `files` allowlist. */
export type PackedFileSetReport = {
    /** Allowlist entries that break the literal, anchored entry rules, with the reason. */
    readonly declarationErrors: readonly string[];
    /** Allowlist entries and always-included paths with no packed file, sorted. */
    readonly missing: readonly string[];
    /** Packed files that no allowlist entry or always-included path covers, sorted. */
    readonly unexpected: readonly string[];
};

const patternCharacters = /[*?[\]{}!]/u;

/**
 * Checks that every `files` entry names one literal repository path the same way for every npm
 * version.
 *
 * npm resolves `files` with gitignore semantics. An entry without an interior `/` (such as
 * `README.md` or `examples`) is unanchored: npm-packlist 10 (npm 11) matches it in every
 * directory it walks, while npm-packlist 11 (npm 12) matches it only at the package root, so the
 * packed file set would depend on the npm version (finding F-032). Such entries must start with
 * `/`. Glob patterns, negations, `./` prefixes, and trailing slashes are refused so each entry is
 * a literal path.
 *
 * @param files - The `files` array of `package.json`.
 * @returns One message per offending entry; empty when the allowlist is deterministic.
 * @example
 * ```ts
 * checkPackageFilesDeclaration(["README.md"]); // ["README.md: ... must start with \"/\""]
 * checkPackageFilesDeclaration(["/README.md", "dist/src"]); // []
 * ```
 */
export function checkPackageFilesDeclaration(files: readonly string[]): readonly string[] {
    const errors: string[] = [];
    for (const entry of files) {
        if (patternCharacters.test(entry)) {
            errors.push(`${entry}: must be a literal path, not a pattern or negation`);
        } else if (entry.startsWith("./") || entry.endsWith("/") || entry.includes("//")) {
            errors.push(
                `${entry}: must not start with "./", end with "/", or contain empty path segments`,
            );
        } else if (!entry.startsWith("/") && !entry.includes("/")) {
            errors.push(
                `${entry}: a top-level entry must start with "/"; unanchored entries match in every directory under npm 11`,
            );
        }
    }
    return errors;
}

/**
 * Lists the regular files of a packed tarball relative to its archive root.
 *
 * @param entries - Entries read by `readTarEntries`.
 * @param archiveRoot - Directory that holds every packed file (npm uses `package`).
 * @returns Archive-root-relative paths of the regular-file entries, sorted.
 * @throws {TypeError} If a regular file lies outside the archive root.
 */
export function packedFilePaths(entries: readonly TarEntry[], archiveRoot: string): string[] {
    const prefix = `${archiveRoot}/`;
    return entries
        .filter(({ type }) => type === "0")
        .map(({ path }) => {
            if (!path.startsWith(prefix)) {
                throw new TypeError(`packed file ${path} is outside ${prefix}`);
            }
            return path.slice(prefix.length);
        })
        .sort();
}

/**
 * Compares packed files with the `files` allowlist.
 *
 * A packed path is covered when it equals an allowlist entry, lies under a directory entry, or is
 * configured as always included. Every entry and always-included path must cover at least one
 * packed file.
 *
 * @param files - The `files` array of `package.json`.
 * @param packedPaths - Archive-root-relative packed file paths.
 * @param configuration - Always-included paths.
 * @returns Declaration errors, missing entries, and unexpected packed files.
 */
export function comparePackedFileSet(
    files: readonly string[],
    packedPaths: readonly string[],
    configuration: Pick<PackedFilesConfiguration, "alwaysIncluded">,
): PackedFileSetReport {
    const entries = files.map((entry) => entry.replace(/^\//u, ""));
    const covers = (entry: string, file: string) => file === entry || file.startsWith(`${entry}/`);
    return {
        declarationErrors: checkPackageFilesDeclaration(files),
        missing: [...entries, ...configuration.alwaysIncluded]
            .filter((entry) => !packedPaths.some((file) => covers(entry, file)))
            .sort(),
        unexpected: packedPaths
            .filter(
                (file) =>
                    !configuration.alwaysIncluded.includes(file) &&
                    !entries.some((entry) => covers(entry, file)),
            )
            .sort(),
    };
}

/**
 * Asserts that a packed tarball contains exactly the files the allowlist declares.
 *
 * @param files - The `files` array of `package.json`.
 * @param entries - Entries of the packed tarball.
 * @param configuration - Archive root and always-included paths.
 * @throws {Error} If the allowlist breaks the entry rules or the packed set differs from it; the
 * message lists every offending entry and file.
 */
export function assertPackedFileSet(
    files: readonly string[],
    entries: readonly TarEntry[],
    configuration: PackedFilesConfiguration,
): void {
    const report = comparePackedFileSet(
        files,
        packedFilePaths(entries, configuration.archiveRoot),
        configuration,
    );
    const problems = [
        ...report.declarationErrors.map((error) => `files entry ${error}`),
        ...report.missing.map((entry) => `missing from the tarball: ${entry}`),
        ...report.unexpected.map((file) => `not declared in files: ${file}`),
    ];
    if (problems.length > 0) {
        throw new Error(`packed file set differs from package.json files:\n${problems.join("\n")}`);
    }
}
