import { canonicalizeRecord, type SemanticRecord } from "../canonical/canonical-record.ts";
import { cliProtocolConfig } from "../protocol/config.ts";
import type { CliGroupConfig } from "../protocol/config-types.ts";
import { CliUnavailableError, CliUsageError } from "./errors.ts";
import { createCliHandlers } from "./handlers.ts";
import type { CliHandler, CliHandlerIo, CliIo } from "./types.ts";

const handlerRegistry = createCliHandlers();

type BoundedCliIo = CliHandlerIo & {
    readonly error: (text: string) => void;
};

/**
 * Runs the configured human-facing CLI without terminating the process.
 *
 * @param args - Command arguments excluding the executable and script paths.
 * @param io - Optional injectable current directory and output sinks.
 * @returns Configured process exit code.
 * @throws {TypeError} If the injectable I/O boundary is malformed.
 *
 * @public
 */
export async function runCli(args: readonly string[], io: CliIo = processIo()): Promise<number> {
    const boundedIo = createBoundedIo(io);
    const jsonRequested =
        Array.isArray(args) && args.includes(`--${cliProtocolConfig.options.json}`);
    let command: readonly string[] = [];
    let machineResult: SemanticRecord = {};
    const handlerIo: CliHandlerIo = jsonRequested
        ? {
              cwd: boundedIo.cwd,
              output: (_text, result = {}) => {
                  machineResult = result;
              },
          }
        : boundedIo;
    try {
        const allArgs = readArgs(args);
        const parsedArgs = allArgs.filter(
            (argument) => argument !== `--${cliProtocolConfig.options.json}`,
        );
        if (allArgs.length - parsedArgs.length > 1) {
            throw new CliUsageError(`duplicate option: --${cliProtocolConfig.options.json}`);
        }
        if (parsedArgs.length === 0 || isHelp(parsedArgs[0])) {
            handlerIo.output(
                `Usage: ${cliProtocolConfig.executableName} <command> [options]\n\nCommands:\n${cliProtocolConfig.groups.map(({ name }) => `  ${name}\n`).join("")}`,
                { groups: cliProtocolConfig.groups.map(({ name }) => name) },
            );
            if (jsonRequested) boundedIo.output(encodeSuccess(command, machineResult));
            return cliProtocolConfig.exitCodes.success;
        }
        command = Object.freeze([parsedArgs[0] as string]);
        const group = cliProtocolConfig.groups.find(({ name }) => name === parsedArgs[0]);
        if (group === undefined) throw new CliUsageError(`unknown command: ${parsedArgs[0]}`);
        command = Object.freeze([group.name]);
        if (isHelp(parsedArgs[1])) {
            handlerIo.output(groupHelp(group), {
                commands: group.commands.map(({ name }) => name),
                group: group.name,
            });
            if (jsonRequested) boundedIo.output(encodeSuccess(command, machineResult));
            return cliProtocolConfig.exitCodes.success;
        }
        command = Object.freeze([
            group.name,
            ...(group.handler === null && parsedArgs[1] !== undefined ? [parsedArgs[1]] : []),
        ]);
        const handler = resolveHandler(group, parsedArgs);
        await handler(
            group.handler === null ? parsedArgs.slice(2) : parsedArgs.slice(1),
            handlerIo,
        );
        if (jsonRequested) boundedIo.output(encodeSuccess(command, machineResult));
        return cliProtocolConfig.exitCodes.success;
    } catch (error) {
        const classified = classifyError(error);
        boundedIo.error(
            jsonRequested
                ? encodeFailure(command, classified.machineCode)
                : `${classified.message}\n`,
        );
        return classified.exitCode;
    }
}

function resolveHandler(group: CliGroupConfig, args: readonly string[]): CliHandler {
    const handlerId = group.handler ?? group.commands.find(({ name }) => name === args[1])?.handler;
    if (handlerId === undefined) {
        throw new CliUsageError(`missing or unknown ${group.name} command`);
    }
    return handlerRegistry.get(handlerId) as CliHandler;
}

function groupHelp(group: CliGroupConfig): string {
    if (group.handler !== null) {
        return `Usage: ${cliProtocolConfig.executableName} ${group.name} [options]\n`;
    }
    return `Usage: ${cliProtocolConfig.executableName} ${group.name} <command> [options]\n\nCommands:\n${group.commands.map(({ name }) => `  ${name}\n`).join("")}`;
}

function classifyError(error: unknown): {
    readonly exitCode: number;
    readonly machineCode: string;
    readonly message: string;
} {
    if (error instanceof CliUsageError) {
        return {
            exitCode: cliProtocolConfig.exitCodes.usage,
            machineCode: cliProtocolConfig.machineOutput.errorCodes.usage,
            message: error.message,
        };
    }
    if (error instanceof CliUnavailableError) {
        return {
            exitCode: cliProtocolConfig.exitCodes.unavailable,
            machineCode: cliProtocolConfig.machineOutput.errorCodes.unavailable,
            message: error.message,
        };
    }
    return {
        exitCode: cliProtocolConfig.exitCodes.failure,
        machineCode: cliProtocolConfig.machineOutput.errorCodes.failure,
        message: error instanceof Error ? error.message : "command failed",
    };
}

function encodeSuccess(command: readonly string[], result: SemanticRecord): string {
    return encodeMachine({
        cli_compatibility_version: cliProtocolConfig.machineOutput.compatibilityVersion,
        cli_output_version: cliProtocolConfig.machineOutput.version,
        command,
        ok: true,
        result,
    });
}

function encodeFailure(command: readonly string[], code: string): string {
    return encodeMachine({
        cli_compatibility_version: cliProtocolConfig.machineOutput.compatibilityVersion,
        cli_output_version: cliProtocolConfig.machineOutput.version,
        command,
        error: { code },
        ok: false,
    });
}

function encodeMachine(value: SemanticRecord): string {
    const json = canonicalizeRecord(value);
    // Configured command/page bounds cap every current machine payload below this ceiling.
    /* node:coverage disable */
    if (Buffer.byteLength(json, "utf8") > cliProtocolConfig.machineOutput.maxCanonicalBytes) {
        throw new CliUnavailableError("machine output exceeds the configured limit");
    }
    /* node:coverage enable */
    return `${json}\n`;
}

function readArgs(value: unknown): readonly string[] {
    if (!Array.isArray(value)) throw new CliUsageError("CLI arguments must be an array");
    if (value.length > cliProtocolConfig.limits.maxArguments) {
        throw new CliUsageError("CLI argument count exceeds the configured limit");
    }
    return Object.freeze(
        value.map((argument, index) => {
            if (
                typeof argument !== "string" ||
                Buffer.byteLength(argument, "utf8") > cliProtocolConfig.limits.maxArgumentBytes
            ) {
                throw new CliUsageError(
                    `CLI argument ${index} is invalid or exceeds its byte limit`,
                );
            }
            return argument;
        }),
    );
}

function createBoundedIo(value: unknown): BoundedCliIo {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError("CLI I/O must be an object");
    }
    const io = value as Partial<CliIo>;
    if (
        typeof io.cwd !== "string" ||
        typeof io.stdout !== "function" ||
        typeof io.stderr !== "function"
    ) {
        throw new TypeError("CLI I/O is invalid");
    }
    let outputBytes = 0;
    const write = (sink: (text: string) => void, text: string): void => {
        outputBytes += Buffer.byteLength(text, "utf8");
        // Configured page/entry bounds cap every current formatter below this ceiling.
        /* node:coverage disable */
        if (outputBytes > cliProtocolConfig.limits.maxOutputBytes) {
            throw new CliUnavailableError("command output exceeds the configured limit");
        }
        /* node:coverage enable */
        sink(text);
    };
    return {
        cwd: io.cwd,
        error: (text) => write(io.stderr as (text: string) => void, text),
        output: (text) => write(io.stdout as (text: string) => void, text),
    };
}

function processIo(): CliIo {
    return {
        cwd: process.cwd(),
        stderr: (text) => process.stderr.write(text),
        stdout: (text) => process.stdout.write(text),
    };
}

function isHelp(value: string | undefined): boolean {
    return value !== undefined && cliProtocolConfig.helpAliases.includes(value);
}
