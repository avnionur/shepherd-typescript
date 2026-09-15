import { PROVIDER_KINDS, type ProtocolConfig } from "./config-types.ts";
import {
    readEnum,
    readNonEmptyString,
    readObject,
    readUniqueStrings,
} from "./config-value-readers.ts";

/** Validates provider-neutral, deterministic-provider, and program-provider configuration. */
export function readProviderConfig(value: unknown): ProtocolConfig["providers"] {
    const providers = readObject(value, ["kinds", "program", "static"], "providers");
    const programProvider = readObject(
        providers.program,
        ["capabilities", "kind"],
        "providers.program",
    );
    const programCapabilities = readObject(
        programProvider.capabilities,
        ["streaming", "structuredOutput", "tools"],
        "providers.program.capabilities",
    );
    const staticProvider = readObject(
        providers.static,
        ["capabilities", "errors", "kind"],
        "providers.static",
    );
    const capabilities = readObject(
        staticProvider.capabilities,
        ["streaming", "structuredOutput", "tools"],
        "providers.static.capabilities",
    );
    const errors = readObject(
        staticProvider.errors,
        ["exhaustedCode", "exhaustedMessage", "mismatchCode", "mismatchMessage"],
        "providers.static.errors",
    );
    const kinds = readUniqueStrings(providers.kinds, "providers.kinds");
    const programKind = readEnum(programProvider.kind, PROVIDER_KINDS, "providers.program.kind");
    const staticKind = readEnum(staticProvider.kind, PROVIDER_KINDS, "providers.static.kind");
    if (programKind === staticKind || !kinds.includes(programKind) || !kinds.includes(staticKind)) {
        throw new TypeError("providers.kinds must list the distinct static and program kinds");
    }
    return {
        kinds,
        program: {
            capabilities: {
                streaming: readBoolean(
                    programCapabilities.streaming,
                    "providers.program.capabilities.streaming",
                ),
                structuredOutput: readBoolean(
                    programCapabilities.structuredOutput,
                    "providers.program.capabilities.structuredOutput",
                ),
                tools: readBoolean(
                    programCapabilities.tools,
                    "providers.program.capabilities.tools",
                ),
            },
            kind: programKind,
        },
        static: {
            capabilities: {
                streaming: readBoolean(
                    capabilities.streaming,
                    "providers.static.capabilities.streaming",
                ),
                structuredOutput: readBoolean(
                    capabilities.structuredOutput,
                    "providers.static.capabilities.structuredOutput",
                ),
                tools: readBoolean(capabilities.tools, "providers.static.capabilities.tools"),
            },
            errors: {
                exhaustedCode: readNonEmptyString(
                    errors.exhaustedCode,
                    "providers.static.errors.exhaustedCode",
                ),
                exhaustedMessage: readNonEmptyString(
                    errors.exhaustedMessage,
                    "providers.static.errors.exhaustedMessage",
                ),
                mismatchCode: readNonEmptyString(
                    errors.mismatchCode,
                    "providers.static.errors.mismatchCode",
                ),
                mismatchMessage: readNonEmptyString(
                    errors.mismatchMessage,
                    "providers.static.errors.mismatchMessage",
                ),
            },
            kind: staticKind,
        },
    };
}

function readBoolean(value: unknown, path: string): boolean {
    if (typeof value !== "boolean") {
        throw new TypeError(`${path} must be a boolean`);
    }
    return value;
}
