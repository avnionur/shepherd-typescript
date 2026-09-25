import { existsSync } from "node:fs";
import path from "node:path";

import { cliProtocolConfig } from "../protocol/config.ts";
import { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import { CliUnavailableError, CliUsageError } from "./errors.ts";
import type { CliHandlerIo } from "./types.ts";

const OPTIONS = cliProtocolConfig.options;

/** @internal Parsed command options, flags, and positional arguments. */
export type ParsedOptions = {
    readonly flags: ReadonlySet<string>;
    readonly options: ReadonlyMap<string, string>;
    readonly positionals: readonly string[];
};

/**
 * @internal Parses the value options and flags `cli.commandOptions` declares for one handler role,
 * refusing unknown or repeated ones. Configuration loading guarantees every role has an entry.
 */
export function parseOptions(args: readonly string[], handler: string): ParsedOptions {
    const declared = cliProtocolConfig.commandOptions[
        handler
    ] as (typeof cliProtocolConfig.commandOptions)[string];
    const valueOptions = new Set(declared.values.map((key) => cliProtocolConfig.options[key]));
    const flagOptions = new Set(declared.flags.map((key) => cliProtocolConfig.options[key]));
    const options = new Map<string, string>();
    const flags = new Set<string>();
    const positionals: string[] = [];
    for (let index = 0; index < args.length; index += 1) {
        const argument = args[index] as string;
        if (!argument.startsWith("--")) {
            positionals.push(argument);
            continue;
        }
        const name = argument.slice(2);
        if (flagOptions.has(name)) {
            if (flags.has(name)) throw new CliUsageError(`duplicate option: --${name}`);
            flags.add(name);
            continue;
        }
        if (!valueOptions.has(name)) throw new CliUsageError(`unknown option: --${name}`);
        const value = args[index + 1];
        if (value === undefined || value.startsWith("--")) {
            throw new CliUsageError(`missing value for --${name}`);
        }
        if (options.has(name)) throw new CliUsageError(`duplicate option: --${name}`);
        options.set(name, value);
        index += 1;
    }
    return { flags, options, positionals };
}

/** @internal Resolves an option path, or its fallback, against the invocation directory. */
export function resolveOptionPath(
    parsed: ParsedOptions,
    name: string,
    io: CliHandlerIo,
    fallback: string,
): string {
    return path.resolve(io.cwd, parsed.options.get(name) ?? fallback);
}

/** @internal Returns a required option value. */
export function requireOption(parsed: ParsedOptions, name: string): string {
    const value = parsed.options.get(name);
    if (value === undefined) throw new CliUsageError(`missing required option: --${name}`);
    return value;
}

/** @internal Refuses positional arguments. */
export function requireNoPositionals(parsed: ParsedOptions): void {
    if (parsed.positionals.length !== 0)
        throw new CliUsageError("command accepts no positional arguments");
}

/** @internal Reads the configured bounded `--limit`/`--offset` page. */
export function pagination(parsed: ParsedOptions): {
    readonly limit: number;
    readonly offset: number;
} {
    return {
        limit: readNonNegativeIntegerOption(
            parsed,
            OPTIONS.limit,
            cliProtocolConfig.limits.defaultPageSize,
            true,
        ),
        offset: readNonNegativeIntegerOption(parsed, OPTIONS.offset, 0, false),
    };
}

function readNonNegativeIntegerOption(
    parsed: ParsedOptions,
    name: string,
    fallback: number,
    positive: boolean,
): number {
    const raw = parsed.options.get(name);
    if (raw === undefined) return fallback;
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0)) {
        throw new CliUsageError(
            `--${name} must be a ${positive ? "positive" : "non-negative"} integer`,
        );
    }
    if (value > cliProtocolConfig.limits.maxPageSize) {
        throw new CliUsageError(`--${name} exceeds the configured page bound`);
    }
    return value;
}

/**
 * @internal Opens the existing `--store` trace store (read-only by default); a missing store is an
 * unavailable capability and is never created.
 */
export function openStore(
    parsed: ParsedOptions,
    io: CliHandlerIo,
    readOnly = true,
): SQLiteTraceStore {
    const storePath = resolveOptionPath(
        parsed,
        OPTIONS.store,
        io,
        cliProtocolConfig.defaults.traceStorePath,
    );
    if (!existsSync(storePath))
        throw new CliUnavailableError(`trace store is unavailable: ${storePath}`);
    return new SQLiteTraceStore(storePath, { readOnly });
}

/** @internal Returns the single required selector positional. */
export function requireOnePositional(parsed: ParsedOptions): string {
    if (parsed.positionals.length !== 1)
        throw new CliUsageError("command requires exactly one selector");
    return parsed.positionals[0] as string;
}
