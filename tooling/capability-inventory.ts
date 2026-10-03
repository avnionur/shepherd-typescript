import { createHash } from "node:crypto";
import { lstat, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readPublishedApi } from "./api-reference/generator.ts";

type Evidence = { readonly path: string; readonly sha256: string };
type Row = {
    readonly id: string;
    readonly group: string;
    readonly title: string;
    readonly source: string;
    readonly exports: readonly { readonly entry: string; readonly symbol: string }[];
    readonly dimensions: Readonly<Record<string, string>>;
    readonly evidence: readonly Evidence[];
    readonly issues: readonly string[];
};
type Configuration = {
    readonly artifact: string;
    readonly introduction: readonly string[];
    readonly groups: Readonly<Record<string, string>>;
    readonly dimensions: Readonly<Record<string, string>>;
    readonly rows: readonly Row[];
};

/** Optional repository and reviewed inventory paths for the documentation gate. */
export type CapabilityInventoryOptions = {
    /** Root containing package declarations, evidence, and generated documentation. */
    readonly repositoryRoot?: string;
    /** Reviewed JSON configuration; defaults to the repository inventory configuration. */
    readonly configurationPath?: string;
};

/**
 * Generates the reviewed capability inventory after checking public exports and evidence hashes.
 * This validates citations, not experimental outcomes or semantic truth of prose.
 * @param options - Repository and configuration overrides for tooling and regression fixtures.
 * @returns Deterministic Markdown and its contained output path.
 * @throws {Error} If a claim loses evidence, an export, a dimension, or a valid repository path.
 */
export async function generateCapabilityInventory(
    options: CapabilityInventoryOptions = {},
): Promise<{
    /** Absolute generated-document path. */
    readonly artifact: string;
    /** Generated inventory with separate evidence dimensions. */
    readonly markdown: string;
}> {
    const root = await realpath(
        options.repositoryRoot ?? fileURLToPath(new URL("../", import.meta.url)),
    );
    const configuration = JSON.parse(
        await readFile(
            options.configurationPath ?? path.join(root, "config/capability-inventory.config.json"),
            "utf8",
        ),
    ) as Configuration;
    if (!Array.isArray(configuration.rows as unknown) || configuration.rows.length === 0) {
        throw new TypeError("inventory rows must not be empty");
    }
    const artifact = await containedPath(root, configuration.artifact, true);
    const api = await readPublishedApi({ repositoryRoot: root });
    const dimensions = Object.keys(configuration.dimensions);
    const identifiers = new Set<string>();
    const sections = new Map(
        Object.entries(configuration.groups).map(([key, title]) => [key, [`## ${title}`, ""]]),
    );
    for (const row of configuration.rows) {
        const section = sections.get(row.group);
        if (section === undefined || identifiers.has(row.id))
            throw new Error(`invalid inventory identity: ${row.id}`);
        identifiers.add(row.id);
        if (
            Object.keys(row.dimensions).sort().join("\n") !== [...dimensions].sort().join("\n") ||
            Object.values(row.dimensions).some(
                (value) => typeof value !== "string" || value.trim().length === 0,
            )
        ) {
            throw new Error(`inventory dimensions are incomplete: ${row.id}`);
        }
        if (row.evidence.length === 0) throw new Error(`evidence must not be empty: ${row.id}`);
        for (const reference of row.exports) {
            if (
                !api.entries.some(
                    (entry) =>
                        entry.entryName === reference.entry &&
                        entry.symbols.some((symbol) => symbol.name === reference.symbol),
                )
            ) {
                throw new Error(`missing public export: ${reference.entry}#${reference.symbol}`);
            }
        }
        for (const evidence of row.evidence) {
            const file = await containedPath(root, evidence.path, false);
            const digest = createHash("sha256")
                .update(await readFile(file))
                .digest("hex");
            if (digest !== evidence.sha256)
                throw new Error(`evidence changed; review claim ${row.id}: ${evidence.path}`);
        }
        section.push(
            `### ${row.title}`,
            "",
            row.source,
            "",
            `Public entry points: ${row.exports.length === 0 ? "No runtime API claimed." : row.exports.map((entry) => `\`${entry.entry}#${entry.symbol}\``).join(", ")}`,
            "",
            "| Dimension | Evidence boundary |",
            "| --- | --- |",
            ...dimensions.map(
                (dimension) =>
                    `| ${configuration.dimensions[dimension]} | ${row.dimensions[dimension]?.replaceAll("|", "\\|").replaceAll("\n", " ")} |`,
            ),
            "",
            "Reviewed evidence (content pinned; existence is not a passing test result):",
            "",
            ...row.evidence.map(
                (evidence) =>
                    `- [${evidence.path}](${path.relative(path.dirname(artifact), path.join(root, evidence.path)).split(path.sep).join("/")})`,
            ),
            "",
            `Outstanding issues: ${row.issues.length === 0 ? "None for this stated boundary." : row.issues.map((issue) => `[${new URL(issue).pathname.split("/").at(-1)}](${issue})`).join(", ")}`,
            "",
        );
    }
    return {
        artifact,
        markdown: [
            "# Capability evidence inventory",
            "",
            ...configuration.introduction,
            "",
            ...[...sections.values()].flat(),
        ].join("\n"),
    };
}

/**
 * Rejects stale generated claims against the reviewed configuration and current evidence.
 * @param options - Repository and configuration overrides.
 * @returns The checked document path.
 * @throws {Error} If generation fails or the document differs from reviewed claims.
 */
export async function checkCapabilityInventory(
    options: CapabilityInventoryOptions = {},
): Promise<string> {
    const result = await generateCapabilityInventory(options);
    if ((await readFile(result.artifact, "utf8")) !== result.markdown)
        throw new Error("capability inventory is stale");
    return result.artifact;
}

/**
 * Writes the generated inventory after verifying its evidence; never updates evidence hashes.
 * @param options - Repository and configuration overrides.
 * @returns The written document path.
 * @throws {Error} If evidence is stale or a file operation fails.
 */
export async function writeCapabilityInventory(
    options: CapabilityInventoryOptions = {},
): Promise<string> {
    const result = await generateCapabilityInventory(options);
    await writeFile(result.artifact, result.markdown);
    return result.artifact;
}

async function containedPath(root: string, target: string, output: boolean): Promise<string> {
    if (path.isAbsolute(target) || path.win32.isAbsolute(target))
        throw new Error("inventory path must remain inside repository");
    const resolved = path.resolve(root, target);
    const real = output
        ? path.join(await realpath(path.dirname(resolved)), path.basename(resolved))
        : await realpath(resolved);
    const relative = path.relative(root, real);
    if (
        relative === "" ||
        path.isAbsolute(relative) ||
        relative === ".." ||
        relative.startsWith(`..${path.sep}`)
    )
        throw new Error("inventory path must remain inside repository");
    if (output) {
        try {
            const status = await lstat(resolved);
            if (!status.isFile() || status.isSymbolicLink())
                throw new Error("inventory artifact must be a regular file");
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
    }
    return real;
}
