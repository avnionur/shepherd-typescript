import path from "node:path";

import { cliProtocolConfig } from "../protocol/config.ts";
import { CliUsageError } from "./errors.ts";
import type { CliHandlerIo } from "./types.ts";

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
