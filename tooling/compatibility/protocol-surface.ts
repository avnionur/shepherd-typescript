import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import {
    canonicalizeSemanticValue,
    type SemanticValue,
} from "../../src/canonical/canonical-record.ts";

/** A configuration file and a JSON pointer into it. */
export type ConfigurationLocation = {
    /** RFC 6901 JSON pointer. */
    readonly pointer: string;
    /** Repository-relative JSON file. */
    readonly source: string;
};

/** Configured locations of every protocol artifact the compatibility gate fingerprints. */
export type ProtocolSurfaceConfiguration = {
    /** CLI exit codes and command groups. */
    readonly cli: {
        /**
         * Pointer to the per-handler option table: handler role to `{ flags, values }` arrays of
         * option keys.
         */
        readonly commandOptionsPointer: string;
        /** Pointer to the exit-code name-to-number map. */
        readonly exitCodesPointer: string;
        /** Pointer to the command-group array. */
        readonly groupsPointer: string;
        /** Pointer to the option-key to option-name map. */
        readonly optionsPointer: string;
        /** Repository-relative configuration file. */
        readonly source: string;
    };
    /**
     * Identity-bearing settings (identifier prefixes, digest algorithms, canonicalization
     * settings): every string or number under a key matching `keyPattern` in `sources`, plus each
     * configured pointer's value.
     */
    readonly identity: {
        /** Regular expression matched against object keys whose scalar values are fingerprinted. */
        readonly keyPattern: string;
        /** Additional locations fingerprinted whole by the canonical digest of their value. */
        readonly pointers: readonly ConfigurationLocation[];
        /** Repository-relative configuration files walked for matching keys. */
        readonly sources: readonly string[];
    };
    /** Append-only migration lists. */
    readonly migrations: readonly ConfigurationLocation[];
    /** Public error-code map whose string leaves are codes. */
    readonly publicErrors: ConfigurationLocation;
    /** Published JSON Schema directory and file suffix. */
    readonly schemas: {
        /** Repository-relative schema directory. */
        readonly directory: string;
        /** File-name suffix of schema files. */
        readonly suffix: string;
    };
    /** Version and format markers. */
    readonly versions: {
        /** Regular expression matched against object keys whose scalar values are markers. */
        readonly keyPattern: string;
        /** Repository-relative configuration files walked for markers. */
        readonly sources: readonly string[];
    };
};

/** Canonical fingerprint of one published JSON Schema. */
export type SchemaFingerprint = {
    /** Digest of each `$defs` member keyed by name. */
    readonly defs: Readonly<Record<string, string>>;
    /** Digest of the whole canonical schema. */
    readonly digest: string;
    /** Digest of each top-level `oneOf` branch in order, or `null` without `oneOf`. */
    readonly oneOf: readonly string[] | null;
    /** Digest of the schema without `oneOf` and `$defs`. */
    readonly rest: string;
};

/** Fingerprints of every configured protocol artifact. */
export type ProtocolSurface = {
    /**
     * Accepted options per CLI command path, keyed by `--name` with `flag` or `value`; absent
     * from baselines recorded before 2.32.2.
     */
    readonly commandOptions?: Readonly<Record<string, Readonly<Record<string, "flag" | "value">>>>;
    /** Sorted CLI command paths (`group` or `group command`). */
    readonly commands: readonly string[];
    /** Sorted public error codes. */
    readonly errorCodes: readonly string[];
    /** CLI exit codes keyed by name. */
    readonly exitCodes: Readonly<Record<string, number>>;
    /**
     * Identity-bearing settings keyed by `source#pointer`: matched strings verbatim, matched
     * numbers as JSON text, and configured pointers as the canonical digest of their value;
     * absent from baselines recorded before 2.32.2.
     */
    readonly identity?: Readonly<Record<string, string>>;
    /** Ordered migration digests keyed by `source#pointer`. */
    readonly migrations: Readonly<Record<string, readonly string[]>>;
    /** Schema fingerprints keyed by file name. */
    readonly schemas: Readonly<Record<string, SchemaFingerprint>>;
    /** Version and format markers keyed by `source#pointer`. */
    readonly versions: Readonly<Record<string, number | string>>;
};

/**
 * Reads and fingerprints every configured protocol artifact.
 *
 * @param repositoryRoot - Repository root that contains every configured source.
 * @param configuration - Configured artifact locations.
 * @returns Sorted, canonical protocol fingerprints.
 * @throws {TypeError} If a source escapes the repository or a located value has the wrong shape.
 * @throws {Error} If a source cannot be read or parsed.
 */
export async function extractProtocolSurface(
    repositoryRoot: string,
    configuration: ProtocolSurfaceConfiguration,
): Promise<ProtocolSurface> {
    const cache = new Map<string, unknown>();
    const load = async (source: string): Promise<unknown> => {
        if (!cache.has(source)) {
            cache.set(
                source,
                JSON.parse(
                    await readFile(containedPath(repositoryRoot, source), "utf8"),
                ) as unknown,
            );
        }
        return cache.get(source);
    };

    const schemaDirectory = containedPath(repositoryRoot, configuration.schemas.directory);
    const schemaFiles = (await readdir(schemaDirectory))
        .filter((name) => name.endsWith(configuration.schemas.suffix))
        .sort();
    const schemas: Record<string, SchemaFingerprint> = {};
    for (const file of schemaFiles) {
        schemas[file] = fingerprintSchema(
            JSON.parse(await readFile(path.join(schemaDirectory, file), "utf8")) as unknown,
        );
    }

    const keyPattern = new RegExp(configuration.versions.keyPattern, "u");
    const versionEntries: [string, number | string][] = [];
    for (const source of configuration.versions.sources) {
        collectKeyedScalars(await load(source), "", source, keyPattern, versionEntries);
    }

    const identityPattern = new RegExp(configuration.identity.keyPattern, "u");
    const identityEntries: [string, number | string][] = [];
    for (const source of configuration.identity.sources) {
        collectKeyedScalars(await load(source), "", source, identityPattern, identityEntries);
    }
    for (const { pointer, source } of configuration.identity.pointers) {
        identityEntries.push([
            `${source}#${pointer}`,
            digestOf(resolvePointer(await load(source), pointer)),
        ]);
    }
    const identity: Record<string, string> = {};
    for (const [key, value] of identityEntries.sort(([left], [right]) => (left < right ? -1 : 1))) {
        identity[key] = typeof value === "string" ? value : JSON.stringify(value);
    }

    const migrations: Record<string, readonly string[]> = {};
    for (const { pointer, source } of configuration.migrations) {
        const list = resolvePointer(await load(source), pointer);
        if (!Array.isArray(list)) {
            throw new TypeError(`${source}#${pointer} must be a migration array`);
        }
        migrations[`${source}#${pointer}`] = list.map((value) => digestOf(value));
    }

    const errorCodes: string[] = [];
    collectStrings(
        resolvePointer(
            await load(configuration.publicErrors.source),
            configuration.publicErrors.pointer,
        ),
        errorCodes,
    );

    const cliSource = await load(configuration.cli.source);
    const exitCodes = objectAt(
        resolvePointer(cliSource, configuration.cli.exitCodesPointer),
        `${configuration.cli.source}#${configuration.cli.exitCodesPointer}`,
    );
    const sortedExitCodes: Record<string, number> = {};
    for (const name of Object.keys(exitCodes).sort()) {
        const code = exitCodes[name];
        if (typeof code !== "number") {
            throw new TypeError(`CLI exit code ${name} must be a number`);
        }
        sortedExitCodes[name] = code;
    }

    const commands = commandEntries(
        resolvePointer(cliSource, configuration.cli.groupsPointer),
        configuration.cli.source,
    );
    return {
        commandOptions: commandOptionTable(
            commands,
            resolvePointer(cliSource, configuration.cli.commandOptionsPointer),
            resolvePointer(cliSource, configuration.cli.optionsPointer),
            configuration.cli.source,
        ),
        commands: commands.map(([commandPath]) => commandPath),
        errorCodes: [...new Set(errorCodes)].sort(),
        exitCodes: sortedExitCodes,
        identity,
        migrations,
        schemas,
        versions: Object.fromEntries(
            versionEntries.sort(([left], [right]) => (left < right ? -1 : 1)),
        ),
    };
}

/**
 * Fingerprints one JSON Schema for the additive `oneOf` rule.
 *
 * @param schema - Parsed JSON Schema document.
 * @returns Whole-schema, remainder, `oneOf` branch, and `$defs` member digests.
 * @throws {TypeError} If the schema is not a JSON object or is not canonicalizable.
 */
export function fingerprintSchema(schema: unknown): SchemaFingerprint {
    const root = objectAt(schema, "schema");
    const { $defs, oneOf, ...rest } = root;
    const defs: Record<string, string> = {};
    if ($defs !== undefined) {
        const definitions = objectAt($defs, "schema $defs");
        for (const name of Object.keys(definitions).sort()) {
            defs[name] = digestOf(definitions[name]);
        }
    }
    return {
        defs,
        digest: digestOf(schema),
        oneOf: Array.isArray(oneOf) ? oneOf.map((branch) => digestOf(branch)) : null,
        rest: digestOf(oneOf === undefined || Array.isArray(oneOf) ? rest : { ...rest, oneOf }),
    };
}

/**
 * Computes the configured canonical digest of a JSON value.
 *
 * @param value - JSON value.
 * @returns `sha256:` followed by the hexadecimal digest of the canonical encoding.
 * @throws {TypeError} If the value is not canonicalizable.
 */
export function digestOf(value: unknown): string {
    return `sha256:${createHash("sha256")
        .update(canonicalizeSemanticValue(value as SemanticValue), "utf8")
        .digest("hex")}`;
}

/**
 * Resolves an RFC 6901 JSON pointer.
 *
 * @param document - Parsed JSON document.
 * @param pointer - Pointer such as `/cli/exitCodes`; the empty pointer is the document.
 * @returns The located value.
 * @throws {TypeError} If the pointer is malformed or does not resolve.
 */
export function resolvePointer(document: unknown, pointer: string): unknown {
    if (pointer === "") {
        return document;
    }
    if (!pointer.startsWith("/")) {
        throw new TypeError(`JSON pointer must start with "/": ${pointer}`);
    }
    let current = document;
    for (const token of pointer
        .slice(1)
        .split("/")
        .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"))) {
        if (typeof current !== "object" || current === null || !Object.hasOwn(current, token)) {
            throw new TypeError(`JSON pointer does not resolve: ${pointer}`);
        }
        current = (current as Record<string, unknown>)[token];
    }
    return current;
}

/**
 * Resolves a repository-relative path and rejects escapes.
 *
 * @param repositoryRoot - Absolute repository root.
 * @param target - Repository-relative path.
 * @returns The absolute contained path.
 * @throws {TypeError} If the path is empty, absolute outside the root, or escapes the root.
 */
export function containedPath(repositoryRoot: string, target: string): string {
    const resolved = path.resolve(repositoryRoot, target);
    const relative = path.relative(repositoryRoot, resolved);
    if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`)) {
        throw new TypeError(`${target} must remain inside the repository`);
    }
    return resolved;
}

function collectKeyedScalars(
    value: unknown,
    pointer: string,
    source: string,
    keyPattern: RegExp,
    output: [string, number | string][],
): void {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return;
    }
    for (const [key, child] of Object.entries(value)) {
        const childPointer = `${pointer}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
        if ((typeof child === "string" || typeof child === "number") && keyPattern.test(key)) {
            output.push([`${source}#${childPointer}`, child]);
        } else {
            collectKeyedScalars(child, childPointer, source, keyPattern, output);
        }
    }
}

function commandOptionTable(
    commands: readonly (readonly [string, unknown])[],
    tableValue: unknown,
    optionsValue: unknown,
    source: string,
): Readonly<Record<string, Readonly<Record<string, "flag" | "value">>>> {
    const table = objectAt(tableValue, `${source} CLI command options`);
    const options = objectAt(optionsValue, `${source} CLI options`);
    const result: Record<string, Readonly<Record<string, "flag" | "value">>> = {};
    for (const [commandPath, handler] of commands) {
        if (typeof handler !== "string" || !Object.hasOwn(table, handler)) {
            throw new TypeError(`${source} CLI command ${commandPath} has no declared options`);
        }
        const declared = objectAt(table[handler], `${source} CLI command options ${handler}`);
        const accepted: [string, "flag" | "value"][] = [];
        for (const [kind, label] of [
            ["flags", "flag"],
            ["values", "value"],
        ] as const) {
            const keys = declared[kind];
            if (!Array.isArray(keys)) {
                throw new TypeError(
                    `${source} CLI command options ${handler} ${kind} must be an array`,
                );
            }
            for (const key of keys) {
                const name =
                    typeof key === "string" && Object.hasOwn(options, key)
                        ? options[key]
                        : undefined;
                if (typeof name !== "string") {
                    throw new TypeError(
                        `${source} CLI command options ${handler} name an unconfigured option`,
                    );
                }
                accepted.push([`--${name}`, label]);
            }
        }
        result[commandPath] = Object.fromEntries(
            accepted.sort(([left], [right]) => (left < right ? -1 : 1)),
        );
    }
    return result;
}

function collectStrings(value: unknown, output: string[]): void {
    if (typeof value === "string") {
        output.push(value);
    } else if (typeof value === "object" && value !== null) {
        for (const child of Object.values(value)) {
            collectStrings(child, output);
        }
    }
}

/** Returns sorted `[command path, handler]` pairs; handlers are checked where they are used. */
function commandEntries(value: unknown, source: string): readonly (readonly [string, unknown])[] {
    if (!Array.isArray(value)) {
        throw new TypeError(`${source} CLI groups must be an array`);
    }
    const entries: [string, unknown][] = [];
    for (const groupValue of value) {
        const group = objectAt(groupValue, `${source} CLI group`);
        const groupName = nameOf(group, `${source} CLI group`);
        const commands = group.commands;
        if (!Array.isArray(commands)) {
            throw new TypeError(`${source} CLI group ${groupName} commands must be an array`);
        }
        if (commands.length === 0) {
            entries.push([groupName, group.handler]);
        }
        for (const commandValue of commands) {
            const command = objectAt(commandValue, `${source} CLI command`);
            entries.push([
                `${groupName} ${nameOf(command, `${source} CLI command`)}`,
                command.handler,
            ]);
        }
    }
    return entries.sort(([left], [right]) => (left < right ? -1 : 1));
}

function nameOf(value: Readonly<Record<string, unknown>>, label: string): string {
    if (typeof value.name !== "string" || value.name.length === 0) {
        throw new TypeError(`${label} name must be a non-empty string`);
    }
    return value.name;
}

function objectAt(value: unknown, label: string): Readonly<Record<string, unknown>> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new TypeError(`${label} must be an object`);
    }
    return value as Readonly<Record<string, unknown>>;
}
