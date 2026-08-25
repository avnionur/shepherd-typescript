import type { CliCommandConfig, CliGroupConfig, ProtocolConfig } from "./config-types.ts";
import {
    readAbsoluteUrl,
    readArray,
    readNonEmptyString,
    readNonNegativeInteger,
    readObject,
    readPositiveInteger,
    readUniqueStrings,
} from "./config-value-readers.ts";

/** Validates configured CLI topology, limits, defaults, remedies, and exit codes. */
export function readCliConfig(value: unknown): ProtocolConfig["cli"] {
    const config = readObject(
        value,
        [
            "artifacts",
            "compatibilityVersion",
            "defaults",
            "executableName",
            "executablePath",
            "exitCodes",
            "groups",
            "handlerRoles",
            "helpAliases",
            "limits",
            "machineOutput",
            "messages",
            "options",
            "remedies",
            "version",
        ],
        "cli",
    );
    const artifacts = readObject(
        config.artifacts,
        ["commandReference", "jsonOutputSchema", "quickstartDemo"],
        "cli.artifacts",
    );
    const defaults = readObject(
        config.defaults,
        [
            "bindingName",
            "bindingRoot",
            "quickstartDemoName",
            "taskRegistryPath",
            "traceStorePath",
            "workspacePath",
        ],
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
            "demoWrite",
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
            "json",
            "limit",
            "noInitializeGit",
            "offset",
            "registry",
            "store",
            "workspace",
        ],
        "cli.options",
    );
    const machineOutput = readObject(
        config.machineOutput,
        [
            "compatibilityVersion",
            "errorCodes",
            "maxCanonicalBytes",
            "resultShapes",
            "schemaId",
            "unavailableRemedies",
            "version",
        ],
        "cli.machineOutput",
    );
    const machineErrorCodes = readObject(
        machineOutput.errorCodes,
        ["failure", "unavailable", "usage"],
        "cli.machineOutput.errorCodes",
    );
    const messages = readObject(
        config.messages,
        ["demoNameUsage", "quickstartUnavailable"],
        "cli.messages",
    );
    const remedies = readObject(
        config.remedies,
        ["fencedStart", "packageInit", "taskRegister"],
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
    const resultShapes = readResultShapes(
        machineOutput.resultShapes,
        "cli.machineOutput.resultShapes",
    );
    const unavailableRemedies = readStringRecord(
        readObject(
            machineOutput.unavailableRemedies,
            [],
            "cli.machineOutput.unavailableRemedies",
            true,
        ),
        "cli.machineOutput.unavailableRemedies",
    );
    const configuredRemedies = readStringRecord(remedies, "cli.remedies");
    const handlerIds = Object.values(configuredHandlerRoles);
    if (
        Object.keys(resultShapes).length !== handlerIds.length ||
        Object.keys(resultShapes).some((handler) => !handlerIds.includes(handler))
    ) {
        throw new TypeError("cli machine result shapes must cover every configured handler");
    }
    const unavailableHandlers = Object.entries(resultShapes)
        .filter(([, shapes]) => shapes.length === 0)
        .map(([handler]) => handler);
    if (
        Object.keys(unavailableRemedies).length !== unavailableHandlers.length ||
        Object.keys(unavailableRemedies).some((handler) => !unavailableHandlers.includes(handler))
    ) {
        throw new TypeError("cli unavailable remedies must cover every result-less handler");
    }
    if (
        new Set(Object.values(unavailableRemedies)).size !==
            Object.keys(unavailableRemedies).length ||
        Object.values(unavailableRemedies).some(
            (remedy) => !Object.hasOwn(configuredRemedies, remedy),
        ) ||
        Object.values(unavailableRemedies).length !== Object.keys(configuredRemedies).length
    ) {
        throw new TypeError("cli unavailable handlers must use every configured remedy once");
    }
    const configuredOptions = readStringRecord(options, "cli.options");
    if (new Set(Object.values(configuredOptions)).size !== Object.keys(configuredOptions).length) {
        throw new TypeError("cli option names must be unique");
    }
    const configuredMachineErrorCodes = readStringRecord(
        machineErrorCodes,
        "cli.machineOutput.errorCodes",
    );
    if (
        new Set(Object.values(configuredMachineErrorCodes)).size !==
        Object.keys(configuredMachineErrorCodes).length
    ) {
        throw new TypeError("cli machine error codes must be unique");
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
        artifacts: {
            commandReference: readNonEmptyString(
                artifacts.commandReference,
                "cli.artifacts.commandReference",
            ),
            jsonOutputSchema: readNonEmptyString(
                artifacts.jsonOutputSchema,
                "cli.artifacts.jsonOutputSchema",
            ),
            quickstartDemo: readNonEmptyString(
                artifacts.quickstartDemo,
                "cli.artifacts.quickstartDemo",
            ),
        },
        compatibilityVersion: readNonEmptyString(
            config.compatibilityVersion,
            "cli.compatibilityVersion",
        ),
        defaults: {
            bindingName: readNonEmptyString(defaults.bindingName, "cli.defaults.bindingName"),
            bindingRoot: readNonEmptyString(defaults.bindingRoot, "cli.defaults.bindingRoot"),
            quickstartDemoName: readNonEmptyString(
                defaults.quickstartDemoName,
                "cli.defaults.quickstartDemoName",
            ),
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
        machineOutput: {
            compatibilityVersion: readNonEmptyString(
                machineOutput.compatibilityVersion,
                "cli.machineOutput.compatibilityVersion",
            ),
            errorCodes: {
                failure: configuredMachineErrorCodes.failure as string,
                unavailable: configuredMachineErrorCodes.unavailable as string,
                usage: configuredMachineErrorCodes.usage as string,
            },
            maxCanonicalBytes: readPositiveInteger(
                machineOutput.maxCanonicalBytes,
                "cli.machineOutput.maxCanonicalBytes",
            ),
            resultShapes,
            schemaId: readAbsoluteUrl(machineOutput.schemaId, "cli.machineOutput.schemaId"),
            unavailableRemedies:
                unavailableRemedies as ProtocolConfig["cli"]["machineOutput"]["unavailableRemedies"],
            version: readPositiveInteger(machineOutput.version, "cli.machineOutput.version"),
        },
        messages: {
            demoNameUsage: readNonEmptyString(messages.demoNameUsage, "cli.messages.demoNameUsage"),
            quickstartUnavailable: readNonEmptyString(
                messages.quickstartUnavailable,
                "cli.messages.quickstartUnavailable",
            ),
        },
        options: configuredOptions as ProtocolConfig["cli"]["options"],
        remedies: {
            fencedStart: configuredRemedies.fencedStart as string,
            packageInit: configuredRemedies.packageInit as string,
            taskRegister: configuredRemedies.taskRegister as string,
        },
        version: readPositiveInteger(config.version, "cli.version"),
    };
}

function readResultShapes(
    value: unknown,
    context: string,
): Readonly<Record<string, readonly (readonly string[])[]>> {
    const record = readObject(value, [], context, true);
    return Object.fromEntries(
        Object.entries(record).map(([handler, item]) => {
            const shapes = readArray(item, `${context}.${handler}`).map((shape, index) =>
                readUniqueStrings(shape, `${context}.${handler}[${index}]`),
            );
            if (new Set(shapes.map((shape) => JSON.stringify(shape))).size !== shapes.length) {
                throw new TypeError(`${context}.${handler} must contain unique result shapes`);
            }
            return [readNonEmptyString(handler, `${context} key`), shapes];
        }),
    );
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
