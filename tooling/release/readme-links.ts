import path from "node:path";

/** `package.json` fields that locate the public source repository. */
export type RepositoryManifest = {
    /** npm `repository` field: a URL string or an object with a `url`. */
    readonly repository?: string | { readonly url?: string };
};

/** Result of checking the links of a packed Markdown file. */
export type PackedLinkReport = {
    /**
     * Repository-relative paths named by absolute links under the repository blob base, sorted
     * and without fragments; the caller checks that each exists in the checkout.
     */
    readonly repositoryPaths: readonly string[];
    /** Relative link targets that do not name a packed file, sorted. */
    readonly unresolved: readonly string[];
};

const fencedBlock = /^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1[^\n]*$/gmu;
const inlineCode = /(`+)[^`]*?\1/gu;
const inlineLinkTarget = /\]\(\s*<?([^)\s>]+)/gu;
const referenceDefinition = /^ {0,3}\[[^\]]+\]:\s*<?([^\s>]+)/gmu;
const htmlTarget = /\b(?:href|src)\s*=\s*"([^"]+)"/gu;
const scheme = /^[a-z][a-z0-9+.-]*:/iu;
const urlRepository = /^(?:git\+)?(?:https?|ssh|git):\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/u;
const scpRepository = /^[^@/\s]+@([^:/\s]+):(.+)$/u;

/**
 * Lists the link and image targets of a Markdown document.
 *
 * Inline links and images (`[text](target)`, including nested image links), reference
 * definitions (`[label]: target`), and HTML `href`/`src` attributes are read. Fenced code blocks
 * and inline code spans are ignored.
 *
 * @param markdown - Markdown source.
 * @returns Every target in document order, duplicates included.
 * @example
 * ```ts
 * markdownLinkTargets("[a](./a.md) `[b](./b.md)`"); // ["./a.md"]
 * ```
 */
export function markdownLinkTargets(markdown: string): readonly string[] {
    const prose = markdown.replace(fencedBlock, "").replace(inlineCode, "");
    return [inlineLinkTarget, referenceDefinition, htmlTarget].flatMap((pattern) =>
        [...prose.matchAll(pattern)].map((match) => match[1] as string),
    );
}

/**
 * Derives the public web URL of the source repository from the `package.json` `repository` field.
 *
 * Accepts `https://`, `git+https://`, `git+ssh://git@`, `ssh://git@`, `git://`, and scp-style
 * `git@host:owner/name` URLs and strips a trailing `.git`.
 *
 * @param manifest - Parsed `package.json`.
 * @returns The `https://` URL of the repository, without a trailing slash.
 * @throws {TypeError} If the field is missing or not a recognized repository URL.
 * @example
 * ```ts
 * repositoryWebUrl({ repository: { url: "git+ssh://git@github.com/o/r.git" } });
 * // "https://github.com/o/r"
 * ```
 */
export function repositoryWebUrl(manifest: RepositoryManifest): string {
    const value =
        (typeof manifest.repository === "string"
            ? manifest.repository
            : manifest.repository?.url) ?? "";
    const match = urlRepository.exec(value) ?? scpRepository.exec(value);
    if (match === null) {
        throw new TypeError(`package.json repository is not a repository URL: ${value}`);
    }
    const [, host, repositoryPath] = match as unknown as readonly [string, string, string];
    return `https://${host}/${repositoryPath.replace(/\/+$/u, "").replace(/\.git$/u, "")}`;
}

/**
 * Checks that every link of a packed Markdown file resolves for a registry reader.
 *
 * An absolute URL (any scheme, or protocol-relative `//`) and a same-document `#fragment` always
 * resolve. A relative target resolves only when, after removing its query and fragment and
 * decoding it, it names a packed file relative to the Markdown file's directory. Absolute links
 * under `repositoryBlobBase` are returned as repository paths so the caller can confirm that each
 * target exists at the configured ref.
 *
 * @param options - Markdown source, its packed path, the packed file list, and the blob base.
 * @returns Unresolved relative targets and repository paths named by absolute links.
 * @example
 * ```ts
 * checkPackedMarkdownLinks({
 *     markdown: "[a](./LICENSE) [b](./docs/x.md) [c](https://github.com/o/r/blob/main/docs/x.md)",
 *     markdownPath: "README.md",
 *     packedPaths: ["LICENSE", "README.md"],
 *     repositoryBlobBase: "https://github.com/o/r/blob/main",
 * }); // { repositoryPaths: ["docs/x.md"], unresolved: ["./docs/x.md"] }
 * ```
 */
export function checkPackedMarkdownLinks(options: {
    /** Markdown source. */
    readonly markdown: string;
    /** Archive-relative path of the Markdown file. */
    readonly markdownPath: string;
    /** Archive-relative paths of every packed file. */
    readonly packedPaths: readonly string[];
    /** `<repository web URL>/blob/<ref>`, without a trailing slash. */
    readonly repositoryBlobBase: string;
}): PackedLinkReport {
    const packed = new Set(options.packedPaths);
    const directory = path.posix.dirname(options.markdownPath);
    const blobPrefix = `${options.repositoryBlobBase}/`;
    const unresolved = new Set<string>();
    const repositoryPaths = new Set<string>();
    for (const target of markdownLinkTargets(options.markdown)) {
        const [address = ""] = target.split(/[?#]/u);
        if (target.startsWith(blobPrefix)) {
            repositoryPaths.add(decodeURIComponent(address.slice(blobPrefix.length)));
        } else if (!scheme.test(target) && !target.startsWith("//") && address !== "") {
            const resolved = path.posix.normalize(
                path.posix.join(directory, decodeURIComponent(address)),
            );
            if (!packed.has(resolved)) {
                unresolved.add(target);
            }
        }
    }
    return {
        repositoryPaths: [...repositoryPaths].sort(),
        unresolved: [...unresolved].sort(),
    };
}
