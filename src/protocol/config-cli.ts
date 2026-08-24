import type { CliCommandConfig, CliGroupConfig, ProtocolConfig } from "./config-types.ts";
import {
    readArray,
    readNonEmptyString,
    readNonNegativeInteger,
    readObject,
    readPositiveInteger,
} from "./config-value-readers.ts";

/** Validates configured CLI topology, limits, defaults, remedies, and exit codes. */
export function readCliConfig(value: unknown): ProtocolConfig["cli"] {
    const config = readObject(
        value,
        [
            "compatibilityVersion",
            "defaults",
            "executableName",
            "executablePath",
            "exitCodes",
            "groups",
            "handlerRoles",
            "helpAliases",
            "limits",
            "options",
            "remedies",
            "version",
        ],
        "cli",
    );
    const defaults = readObject(
        config.defaults,
        ["bindingName", "bindingRoot", "taskRegistryPath", "traceStorePath", "workspacePath"],
        "cli.defaults",
    );
    const exitCodes = readObject(
        config.exitCodes,
        ["failure", "success", "unavailable", "usage"],
        "cli.exitCodes",
    );
    const limits = readObject(
        config.limits,
        ["defaultPageSize", "maxArgumentBytes", "maxArguments", "maxOutputBytes", "maxPageSize"],
        "cli.limits",
    );
    const handlerRoles = readObject(
        config.handlerRoles,
        [
            "doctor",
            "runApply",
            "runDiscard",
            "runList",
            "runOutputCitations",
            "runRecoveryRecords",
            "runRelease",
            "runRepair",
            "runSelect",
            "runShow",
            "runTrace",
            "taskList",
            "taskResolve",
            "taskShow",
            "unsupportedDemoWrite",
            "unsupportedPackageInit",
            "unsupportedStart",
            "unsupportedTaskRegister",
            "workspaceInit",
        ],
        "cli.handlerRoles",
    );
    const options = readObject(
        config.options,
        [
            "adopt",
            "bindingName",
            "bindingRoot",
            "command",
            "initializeGit",
            "limit",
            "noInitializeGit",
            "offset",
            "registry",
            "store",
            "workspace",
        ],
        "cli.options",
    );
    const remedies = readObject(
        config.remedies,
        ["demoWrite", "fencedStart", "packageInit", "taskRegister"],
        "cli.remedies",
    );
    const groups = readArray(config.groups, "cli.groups").map(readGroup);
    if (groups.length === 0 || new Set(groups.map(({ name }) => name)).size !== groups.length) {
        throw new TypeError("cli groups must be non-empty and uniquely named");
    }
    const configuredHandlerRoles = readStringRecord(handlerRoles, "cli.handlerRoles");
    if (
        new Set(Object.values(configuredHandlerRoles)).size !==
        Object.keys(configuredHandlerRoles).length
    ) {
        throw new TypeError("cli handler roles must be unique");
    }
    const usedHandlers = groups.flatMap((group) => [
        ...(group.handler === null ? [] : [group.handler]),
        ...group.commands.map(({ handler }) => handler),
    ]);
    if (
        usedHandlers.length !== Object.keys(configuredHandlerRoles).length ||
        usedHandlers.some((handler) => !Object.values(configuredHandlerRoles).includes(handler))
    ) {
        throw new TypeError("cli groups must use every configured handler role exactly once");
    }
    const configuredOptions = readStringRecord(options, "cli.options");
    if (new Set(Object.values(configuredOptions)).size !== Object.keys(configuredOptions).length) {
        throw new TypeError("cli option names must be unique");
    }
    const helpAliases = readArray(config.helpAliases, "cli.helpAliases").map((alias, index) =>
        readNonEmptyString(alias, `cli.helpAliases[${index}]`),
    );
    if (helpAliases.length === 0 || new Set(helpAliases).size !== helpAliases.length) {
        throw new TypeError("cli help aliases must be non-empty and unique");
    }
    const configuredExitCodes = {
        failure: readPositiveInteger(exitCodes.failure, "cli.exitCodes.failure"),
        success: readNonNegativeInteger(exitCodes.success, "cli.exitCodes.success"),
        unavailable: readPositiveInteger(exitCodes.unavailable, "cli.exitCodes.unavailable"),
        usage: readPositiveInteger(exitCodes.usage, "cli.exitCodes.usage"),
    };
    if (
        new Set(Object.values(configuredExitCodes)).size !== Object.keys(configuredExitCodes).length
    ) {
        throw new TypeError("cli exit codes must be distinct");
    }
    const defaultPageSize = readPositiveInteger(
        limits.defaultPageSize,
        "cli.limits.defaultPageSize",
    );
    const maxArguments = readPositiveInteger(limits.maxArguments, "cli.limits.maxArguments");
    const maxPageSize = readPositiveInteger(limits.maxPageSize, "cli.limits.maxPageSize");
    if (defaultPageSize > maxPageSize || defaultPageSize > maxArguments) {
        throw new TypeError("cli default page size must not exceed configured maxima");
    }
    return {
        compatibilityVersion: readNonEmptyString(
            config.compatibilityVersion,
            "cli.compatibilityVersion",
        ),
        defaults: {
            bindingName: readNonEmptyString(defaults.bindingName, "cli.defaults.bindingName"),
            bindingRoot: readNonEmptyString(defaults.bindingRoot, "cli.defaults.bindingRoot"),
            taskRegistryPath: readNonEmptyString(
                defaults.taskRegistryPath,
                "cli.defaults.taskRegistryPath",
            ),
            traceStorePath: readNonEmptyString(
                defaults.traceStorePath,
                "cli.defaults.traceStorePath",
            ),
            workspacePath: readNonEmptyString(defaults.workspacePath, "cli.defaults.workspacePath"),
        },
        executableName: readNonEmptyString(config.executableName, "cli.executableName"),
        executablePath: readNonEmptyString(config.executablePath, "cli.executablePath"),
        exitCodes: configuredExitCodes,
        groups,
        handlerRoles: configuredHandlerRoles as ProtocolConfig["cli"]["handlerRoles"],
        helpAliases,
        limits: {
            defaultPageSize,
            maxArgumentBytes: readPositiveInteger(
                limits.maxArgumentBytes,
                "cli.limits.maxArgumentBytes",
            ),
            maxArguments,
            maxOutputBytes: readPositiveInteger(limits.maxOutputBytes, "cli.limits.maxOutputBytes"),
            maxPageSize,
        },
        options: configuredOptions as ProtocolConfig["cli"]["options"],
        remedies: {
            demoWrite: readNonEmptyString(remedies.demoWrite, "cli.remedies.demoWrite"),
            fencedStart: readNonEmptyString(remedies.fencedStart, "cli.remedies.fencedStart"),
            packageInit: readNonEmptyString(remedies.packageInit, "cli.remedies.packageInit"),
            taskRegister: readNonEmptyString(remedies.taskRegister, "cli.remedies.taskRegister"),
        },
        version: readPositiveInteger(config.version, "cli.version"),
    };
}

function readStringRecord(
    value: Record<string, unknown>,
    context: string,
): Readonly<Record<string, string>> {
    return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
            key,
            readNonEmptyString(item, `${context}.${key}`),
        ]),
    );
}

function readGroup(value: unknown, index: number): CliGroupConfig {
    const context = `cli.groups[${index}]`;
    const group = readObject(value, ["commands", "handler", "name"], context);
    const commands = readArray(group.commands, `${context}.commands`).map((command, commandIndex) =>
        readCommand(command, `${context}.commands[${commandIndex}]`),
    );
    if (new Set(commands.map(({ name }) => name)).size !== commands.length) {
        throw new TypeError(`${context}.commands must be uniquely named`);
    }
    const handler =
        group.handler === null ? null : readNonEmptyString(group.handler, `${context}.handler`);
    if ((commands.length === 0) === (handler === null)) {
        throw new TypeError(`${context} must define either one handler or nested commands`);
    }
    return {
        commands,
        handler,
        name: readNonEmptyString(group.name, `${context}.name`),
    };
}

function readCommand(value: unknown, context: string): CliCommandConfig {
    const command = readObject(value, ["handler", "name"], context);
    return {
        handler: readNonEmptyString(command.handler, `${context}.handler`),
        name: readNonEmptyString(command.name, `${context}.name`),
    };
}
