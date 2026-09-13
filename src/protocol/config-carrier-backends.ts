import type { ProtocolConfig } from "./config-types.ts";
import {
    readArray,
    readNonEmptyString,
    readObject,
    readPositiveInteger,
    readUniqueStrings,
} from "./config-value-readers.ts";

type CarrierBackendsConfig = ProtocolConfig["workspaces"]["carrierBackends"];

/**
 * Validates the closed workspace protocol v26 carrier-backend section.
 *
 * @param value - Raw `workspaces.carrierBackends` configuration.
 * @param reserved - Carrier names the backend configuration must agree with or avoid.
 * @returns Validated backend selection, availability, and overlay command policy.
 * @throws {TypeError} If a field is missing, extra, malformed, or internally inconsistent.
 */
export function readCarrierBackendsConfig(
    value: unknown,
    reserved: Readonly<{
        copyBackend: string;
        custodyDescriptorFile: string;
        worldDirectory: string;
    }>,
): CarrierBackendsConfig {
    const context = "workspaces.carrierBackends";
    const section = readObject(
        value,
        [
            "backends",
            "clone",
            "commandMaxBytes",
            "commandTimeoutMs",
            "conformance",
            "defaultBackend",
            "errors",
            "overlay",
            "version",
        ],
        context,
    );
    const backends = readUniqueStrings(section.backends, `${context}.backends`);
    const clone = readObject(section.clone, ["backend", "helper"], `${context}.clone`);
    const helper = readObject(
        clone.helper,
        [
            "compilerArguments",
            "compilerExecutables",
            "compilerOutputArgument",
            "executableName",
            "platforms",
            "sourceName",
            "temporaryDirectoryPrefix",
        ],
        `${context}.clone.helper`,
    );
    const conformance = readObject(
        section.conformance,
        ["reasonRoles", "reasons", "statusRoles", "statuses"],
        `${context}.conformance`,
    );
    const reasons = readUniqueStrings(conformance.reasons, `${context}.conformance.reasons`);
    const statuses = readUniqueStrings(conformance.statuses, `${context}.conformance.statuses`);
    const reasonRoles = readRoles(
        conformance.reasonRoles,
        [
            "available",
            "helperUnavailable",
            "mountNotPermitted",
            "platformUnsupported",
            "reflinkUnsupported",
        ],
        reasons,
        `${context}.conformance.reasonRoles`,
    );
    const statusRoles = readRoles(
        conformance.statusRoles,
        ["conformant", "unavailable"],
        statuses,
        `${context}.conformance.statusRoles`,
    );
    const errors = readObject(
        section.errors,
        ["unavailableCode", "unavailableMessage"],
        `${context}.errors`,
    );
    const overlay = readObject(
        section.overlay,
        [
            "backend",
            "filesystemType",
            "mountArguments",
            "mountExecutable",
            "mountInfoPath",
            "mountOptionSeparator",
            "mountOptions",
            "platforms",
            "reservedPathCharacters",
            "tokens",
            "unmountArguments",
            "unmountExecutable",
            "upperDirectory",
            "workDirectory",
        ],
        `${context}.overlay`,
    );
    const tokenFields = readObject(
        overlay.tokens,
        ["lower", "options", "target", "upper", "work"],
        `${context}.overlay.tokens`,
    );
    const tokens = {
        lower: readNonEmptyString(tokenFields.lower, `${context}.overlay.tokens.lower`),
        options: readNonEmptyString(tokenFields.options, `${context}.overlay.tokens.options`),
        target: readNonEmptyString(tokenFields.target, `${context}.overlay.tokens.target`),
        upper: readNonEmptyString(tokenFields.upper, `${context}.overlay.tokens.upper`),
        work: readNonEmptyString(tokenFields.work, `${context}.overlay.tokens.work`),
    };
    const defaultBackend = readNonEmptyString(section.defaultBackend, `${context}.defaultBackend`);
    const cloneBackend = readNonEmptyString(clone.backend, `${context}.clone.backend`);
    const overlayBackend = readNonEmptyString(overlay.backend, `${context}.overlay.backend`);
    const roles = [defaultBackend, cloneBackend, overlayBackend];
    if (
        defaultBackend !== reserved.copyBackend ||
        new Set(roles).size !== roles.length ||
        roles.some((backend) => !backends.includes(backend)) ||
        backends.length !== roles.length
    ) {
        throw new TypeError(`${context} backend roles must name each configured backend once`);
    }
    const mountArguments = readStrings(overlay.mountArguments, `${context}.overlay.mountArguments`);
    const unmountArguments = readStrings(
        overlay.unmountArguments,
        `${context}.overlay.unmountArguments`,
    );
    const mountOptions = readNonEmptyString(
        overlay.mountOptions,
        `${context}.overlay.mountOptions`,
    );
    if (
        !mountArguments.includes(tokens.options) ||
        !mountArguments.includes(tokens.target) ||
        !unmountArguments.includes(tokens.target) ||
        ![tokens.lower, tokens.upper, tokens.work].every((token) => mountOptions.includes(token))
    ) {
        throw new TypeError(`${context}.overlay command templates must contain their tokens`);
    }
    const upperDirectory = readNonEmptyString(
        overlay.upperDirectory,
        `${context}.overlay.upperDirectory`,
    );
    const workDirectory = readNonEmptyString(
        overlay.workDirectory,
        `${context}.overlay.workDirectory`,
    );
    const custodyNames = [
        upperDirectory,
        workDirectory,
        reserved.worldDirectory,
        reserved.custodyDescriptorFile,
    ];
    if (
        new Set(custodyNames).size !== custodyNames.length ||
        [upperDirectory, workDirectory].some((name) => /[/\\\0]|^\.\.?$/u.test(name))
    ) {
        throw new TypeError(`${context}.overlay layer directories must be distinct simple names`);
    }
    return {
        backends,
        clone: {
            backend: cloneBackend,
            helper: {
                compilerArguments: readStrings(
                    helper.compilerArguments,
                    `${context}.clone.helper.compilerArguments`,
                ),
                compilerExecutables: readUniqueStrings(
                    helper.compilerExecutables,
                    `${context}.clone.helper.compilerExecutables`,
                ),
                compilerOutputArgument: readNonEmptyString(
                    helper.compilerOutputArgument,
                    `${context}.clone.helper.compilerOutputArgument`,
                ),
                executableName: readNonEmptyString(
                    helper.executableName,
                    `${context}.clone.helper.executableName`,
                ),
                platforms: readUniqueStrings(helper.platforms, `${context}.clone.helper.platforms`),
                sourceName: readNonEmptyString(
                    helper.sourceName,
                    `${context}.clone.helper.sourceName`,
                ),
                temporaryDirectoryPrefix: readNonEmptyString(
                    helper.temporaryDirectoryPrefix,
                    `${context}.clone.helper.temporaryDirectoryPrefix`,
                ),
            },
        },
        commandMaxBytes: readPositiveInteger(section.commandMaxBytes, `${context}.commandMaxBytes`),
        commandTimeoutMs: readPositiveInteger(
            section.commandTimeoutMs,
            `${context}.commandTimeoutMs`,
        ),
        conformance: { reasonRoles, reasons, statusRoles, statuses },
        defaultBackend,
        errors: {
            unavailableCode: readNonEmptyString(
                errors.unavailableCode,
                `${context}.errors.unavailableCode`,
            ),
            unavailableMessage: readNonEmptyString(
                errors.unavailableMessage,
                `${context}.errors.unavailableMessage`,
            ),
        },
        overlay: {
            backend: overlayBackend,
            filesystemType: readNonEmptyString(
                overlay.filesystemType,
                `${context}.overlay.filesystemType`,
            ),
            mountArguments,
            mountExecutable: readNonEmptyString(
                overlay.mountExecutable,
                `${context}.overlay.mountExecutable`,
            ),
            mountInfoPath: readNonEmptyString(
                overlay.mountInfoPath,
                `${context}.overlay.mountInfoPath`,
            ),
            mountOptionSeparator: readNonEmptyString(
                overlay.mountOptionSeparator,
                `${context}.overlay.mountOptionSeparator`,
            ),
            mountOptions,
            platforms: readUniqueStrings(overlay.platforms, `${context}.overlay.platforms`),
            reservedPathCharacters: readUniqueStrings(
                overlay.reservedPathCharacters,
                `${context}.overlay.reservedPathCharacters`,
            ),
            tokens,
            unmountArguments,
            unmountExecutable: readNonEmptyString(
                overlay.unmountExecutable,
                `${context}.overlay.unmountExecutable`,
            ),
            upperDirectory,
            workDirectory,
        },
        version: readPositiveInteger(section.version, `${context}.version`),
    };
}

function readStrings(value: unknown, context: string): readonly string[] {
    const strings = readArray(value, context).map((entry, index) =>
        readNonEmptyString(entry, `${context}[${index}]`),
    );
    if (strings.length === 0) {
        throw new TypeError(`${context} must not be empty`);
    }
    return strings;
}

function readRoles<const Keys extends readonly string[]>(
    value: unknown,
    keys: Keys,
    vocabulary: readonly string[],
    context: string,
): { readonly [Key in Keys[number]]: string } {
    const fields = readObject(value, keys, context);
    const roles = keys.map((key) => readNonEmptyString(fields[key], `${context}.${key}`));
    if (
        new Set(roles).size !== roles.length ||
        roles.length !== vocabulary.length ||
        roles.some((role) => !vocabulary.includes(role))
    ) {
        throw new TypeError(`${context} must map each configured value exactly once`);
    }
    return Object.fromEntries(keys.map((key, index) => [key, roles[index]])) as {
        readonly [Key in Keys[number]]: string;
    };
}
