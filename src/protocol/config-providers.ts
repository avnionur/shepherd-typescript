import { PROVIDER_KINDS, type ProtocolConfig } from "./config-types.ts";
import {
    readEnum,
    readNonEmptyString,
    readObject,
    readUniqueStrings,
} from "./config-value-readers.ts";

/** Validates provider-neutral and deterministic-provider configuration. */
export function readProviderConfig(value: unknown): ProtocolConfig["providers"] {
    const providers = readObject(value, ["kinds", "static"], "providers");
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
    return {
        kinds: readUniqueStrings(providers.kinds, "providers.kinds"),
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
            kind: readEnum(staticProvider.kind, PROVIDER_KINDS, "providers.static.kind"),
        },
    };
}

function readBoolean(value: unknown, path: string): boolean {
    if (typeof value !== "boolean") {
        throw new TypeError(`${path} must be a boolean`);
    }
    return value;
}
