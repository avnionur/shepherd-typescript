import {
    LIVE_PROVIDER_DIALECTS,
    type LiveProviderKindConfig,
    META_AGENT_TOOL_OPERATIONS,
    type MetaAgentToolConfig,
    type ProtocolConfig,
    type ProviderCapabilitiesConfig,
    type ProviderToolsConfig,
} from "./config-types.ts";
import {
    readAbsoluteUrl,
    readArray,
    readEnum,
    readJsonObject,
    readNonEmptyString,
    readObject,
    readPositiveInteger,
    readUniqueStrings,
} from "./config-value-readers.ts";

/**
 * Validates provider-neutral, deterministic, program, live provider, and tool-use configuration.
 *
 * @param value - Untrusted `providers` configuration section.
 * @param reversibilityTiers - Validated effect reversibility tiers that catalog tools must cite.
 * @returns The validated provider configuration.
 * @throws {TypeError} If any field is missing, malformed, or inconsistent.
 */
export function readProviderConfig(
    value: unknown,
    reversibilityTiers: readonly string[],
): ProtocolConfig["providers"] {
    const providers = readObject(
        value,
        ["conversation", "kinds", "live", "messages", "program", "static", "tools"],
        "providers",
    );
    const kinds = readUniqueStrings(providers.kinds, "providers.kinds");
    const programProvider = readObject(
        providers.program,
        ["capabilities", "conversationCapabilities", "kind"],
        "providers.program",
    );
    const staticProvider = readObject(
        providers.static,
        ["capabilities", "errors", "kind"],
        "providers.static",
    );
    const errors = readObject(
        staticProvider.errors,
        ["exhaustedCode", "exhaustedMessage", "mismatchCode", "mismatchMessage"],
        "providers.static.errors",
    );
    const programKind = readEnum(programProvider.kind, kinds, "providers.program.kind");
    const staticKind = readEnum(staticProvider.kind, kinds, "providers.static.kind");
    const live = readLiveConfig(providers.live);
    const declared = [staticKind, programKind, ...Object.keys(live.kinds)];
    if (
        new Set(declared).size !== declared.length ||
        declared.length !== kinds.length ||
        !kinds.every((kind) => declared.includes(kind))
    ) {
        throw new TypeError(
            "providers.kinds must list the static, program, and every live kind exactly once",
        );
    }
    const conversation = readObject(
        providers.conversation,
        ["cacheIdentityPrefix", "receiptIdPrefix"],
        "providers.conversation",
    );
    const cacheIdentityPrefix = readNonEmptyString(
        conversation.cacheIdentityPrefix,
        "providers.conversation.cacheIdentityPrefix",
    );
    const receiptIdPrefix = readNonEmptyString(
        conversation.receiptIdPrefix,
        "providers.conversation.receiptIdPrefix",
    );
    if (cacheIdentityPrefix === receiptIdPrefix) {
        throw new TypeError("providers.conversation prefixes must be distinct");
    }
    return {
        conversation: { cacheIdentityPrefix, receiptIdPrefix },
        kinds,
        live,
        messages: readMessagesConfig(providers.messages),
        program: {
            capabilities: readCapabilities(
                programProvider.capabilities,
                "providers.program.capabilities",
            ),
            conversationCapabilities: readCapabilities(
                programProvider.conversationCapabilities,
                "providers.program.conversationCapabilities",
            ),
            kind: programKind,
        },
        static: {
            capabilities: readCapabilities(
                staticProvider.capabilities,
                "providers.static.capabilities",
            ),
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
        tools: readToolsConfig(providers.tools, reversibilityTiers),
    };
}

function readToolsConfig(
    value: unknown,
    reversibilityTiers: readonly string[],
): ProviderToolsConfig {
    const tools = readObject(value, ["loop", "metaAgent", "turn"], "providers.tools");
    const loop = readObject(
        tools.loop,
        [
            "defaultMaxTurns",
            "dispositions",
            "effectIdPrefix",
            "maxResultBytes",
            "maxTurns",
            "statuses",
            "truncationMarker",
        ],
        "providers.tools.loop",
    );
    const defaultMaxTurns = readPositiveInteger(
        loop.defaultMaxTurns,
        "providers.tools.loop.defaultMaxTurns",
    );
    const maxTurns = readPositiveInteger(loop.maxTurns, "providers.tools.loop.maxTurns");
    if (defaultMaxTurns > maxTurns) {
        throw new TypeError("providers.tools.loop.defaultMaxTurns must not exceed maxTurns");
    }
    const dispositions = readUniqueStrings(loop.dispositions, "providers.tools.loop.dispositions");
    if (dispositions.length !== 4) {
        throw new TypeError(
            "providers.tools.loop.dispositions must list materialized, denied, invalid, and failed",
        );
    }
    const statuses = readUniqueStrings(loop.statuses, "providers.tools.loop.statuses");
    if (statuses.length !== 2) {
        throw new TypeError("providers.tools.loop.statuses must list completed and turn limit");
    }
    const turn = readObject(tools.turn, ["instruction", "outputSchema"], "providers.tools.turn");
    return {
        loop: {
            defaultMaxTurns,
            dispositions,
            effectIdPrefix: readNonEmptyString(
                loop.effectIdPrefix,
                "providers.tools.loop.effectIdPrefix",
            ),
            maxResultBytes: readPositiveInteger(
                loop.maxResultBytes,
                "providers.tools.loop.maxResultBytes",
            ),
            maxTurns,
            statuses,
            truncationMarker: readNonEmptyString(
                loop.truncationMarker,
                "providers.tools.loop.truncationMarker",
            ),
        },
        metaAgent: readMetaAgentConfig(tools.metaAgent, reversibilityTiers),
        turn: {
            instruction: readNonEmptyString(turn.instruction, "providers.tools.turn.instruction"),
            outputSchema: readPlainJson(turn.outputSchema, "providers.tools.turn.outputSchema"),
        },
    };
}

function readMetaAgentConfig(
    value: unknown,
    reversibilityTiers: readonly string[],
): ProviderToolsConfig["metaAgent"] {
    const path = "providers.tools.metaAgent";
    const metaAgent = readObject(value, ["commandIdPrefix", "limits", "tools"], path);
    const limits = readObject(
        metaAgent.limits,
        ["maxObservedSteps", "maxTraceRecords"],
        `${path}.limits`,
    );
    const tools = readArray(metaAgent.tools, `${path}.tools`).map((entry, index) =>
        readMetaAgentTool(entry, `${path}.tools[${index}]`, reversibilityTiers),
    );
    const names = tools.map((tool) => tool.name);
    const effectKinds = tools.map((tool) => tool.effectKind);
    const operations = tools.map((tool) => tool.operation);
    if (
        new Set(names).size !== names.length ||
        new Set(effectKinds).size !== effectKinds.length ||
        operations.length !== META_AGENT_TOOL_OPERATIONS.length ||
        !META_AGENT_TOOL_OPERATIONS.every((operation) => operations.includes(operation))
    ) {
        throw new TypeError(
            `${path}.tools must bind every operation exactly once with distinct names and effect kinds`,
        );
    }
    return {
        commandIdPrefix: readNonEmptyString(metaAgent.commandIdPrefix, `${path}.commandIdPrefix`),
        limits: {
            maxObservedSteps: readPositiveInteger(
                limits.maxObservedSteps,
                `${path}.limits.maxObservedSteps`,
            ),
            maxTraceRecords: readPositiveInteger(
                limits.maxTraceRecords,
                `${path}.limits.maxTraceRecords`,
            ),
        },
        tools,
    };
}

function readMetaAgentTool(
    value: unknown,
    path: string,
    reversibilityTiers: readonly string[],
): MetaAgentToolConfig {
    const tool = readObject(
        value,
        ["description", "effectKind", "inputSchema", "name", "operation", "reversibility"],
        path,
    );
    const name = readNonEmptyString(tool.name, `${path}.name`);
    if (!/^[a-zA-Z0-9_-]{1,64}$/u.test(name)) {
        throw new TypeError(`${path}.name must be a portable tool name`);
    }
    return {
        description: readNonEmptyString(tool.description, `${path}.description`),
        effectKind: readNonEmptyString(tool.effectKind, `${path}.effectKind`),
        inputSchema: readPlainJson(tool.inputSchema, `${path}.inputSchema`),
        name,
        operation: readEnum(tool.operation, META_AGENT_TOOL_OPERATIONS, `${path}.operation`),
        reversibility: readEnum(tool.reversibility, reversibilityTiers, `${path}.reversibility`),
    };
}

const LIVE_ERROR_KEYS = [
    "credentialCode",
    "credentialMessage",
    "httpCode",
    "httpMessage",
    "responseCode",
    "responseMessage",
    "transportCode",
    "transportMessage",
] as const;

function readLiveConfig(value: unknown): ProtocolConfig["providers"]["live"] {
    const live = readObject(value, ["errors", "kinds", "limits", "redaction"], "providers.live");
    const errors = readObject(live.errors, LIVE_ERROR_KEYS, "providers.live.errors");
    const errorValues = Object.fromEntries(
        LIVE_ERROR_KEYS.map((key) => [
            key,
            readNonEmptyString(errors[key], `providers.live.errors.${key}`),
        ]),
    ) as Record<(typeof LIVE_ERROR_KEYS)[number], string>;
    const codes = [
        errorValues.credentialCode,
        errorValues.httpCode,
        errorValues.responseCode,
        errorValues.transportCode,
    ];
    if (new Set(codes).size !== codes.length) {
        throw new TypeError("providers.live.errors codes must be distinct");
    }
    const source = readObject(
        live.kinds,
        Object.keys(readJsonObject(live.kinds, "providers.live.kinds")),
        "providers.live.kinds",
    );
    const names = Object.keys(source).sort();
    if (names.length === 0) {
        throw new TypeError("providers.live.kinds must declare at least one live kind");
    }
    const kinds: Record<string, LiveProviderKindConfig> = {};
    for (const name of names) {
        kinds[readNonEmptyString(name, "providers.live.kinds key")] = readLiveKind(
            source[name],
            `providers.live.kinds.${name}`,
        );
    }
    const limits = readObject(live.limits, ["maxErrorDetailBytes"], "providers.live.limits");
    return {
        errors: errorValues,
        kinds,
        limits: {
            maxErrorDetailBytes: readPositiveInteger(
                limits.maxErrorDetailBytes,
                "providers.live.limits.maxErrorDetailBytes",
            ),
        },
        redaction: readNonEmptyString(live.redaction, "providers.live.redaction"),
    };
}

function readLiveKind(value: unknown, path: string): LiveProviderKindConfig {
    const kind = readObject(
        value,
        [
            "cacheControl",
            "capabilities",
            "completeStopReasons",
            "credential",
            "dialect",
            "endpoint",
            "headers",
            "maxOutputTokens",
            "maxTokensField",
            "outputFormat",
            "toolUse",
        ],
        path,
    );
    const toolUse = readObject(kind.toolUse, ["requestField", "stopReasons"], `${path}.toolUse`);
    const toolStopReasons = readUniqueStrings(toolUse.stopReasons, `${path}.toolUse.stopReasons`);
    const completeStopReasons = readUniqueStrings(
        kind.completeStopReasons,
        `${path}.completeStopReasons`,
    );
    if (toolStopReasons.some((reason) => completeStopReasons.includes(reason))) {
        throw new TypeError(
            `${path}.toolUse.stopReasons must be disjoint from completeStopReasons`,
        );
    }
    const credential = readObject(
        kind.credential,
        ["environmentVariable", "header", "scheme"],
        `${path}.credential`,
    );
    const headerSource = readJsonObject(kind.headers, `${path}.headers`);
    const headers: Record<string, string> = {};
    for (const name of Object.keys(headerSource).sort()) {
        headers[readHeaderName(name, `${path}.headers key`)] = readNonEmptyString(
            headerSource[name],
            `${path}.headers.${name}`,
        );
    }
    const credentialHeader = readHeaderName(credential.header, `${path}.credential.header`);
    if (Object.hasOwn(headers, credentialHeader)) {
        throw new TypeError(`${path}.headers must not carry the credential header`);
    }
    const dialect = readEnum(kind.dialect, LIVE_PROVIDER_DIALECTS, `${path}.dialect`);
    const outputFormat =
        kind.outputFormat === null
            ? null
            : readObject(kind.outputFormat, ["name", "strict"], `${path}.outputFormat`);
    if (outputFormat === null && dialect === LIVE_PROVIDER_DIALECTS[1]) {
        throw new TypeError(`${path}.outputFormat is required by the ${dialect} dialect`);
    }
    return {
        cacheControl:
            kind.cacheControl === null
                ? null
                : { ...readJsonObject(kind.cacheControl, `${path}.cacheControl`) },
        capabilities: readCapabilities(kind.capabilities, `${path}.capabilities`),
        completeStopReasons,
        credential: {
            environmentVariable: readNonEmptyString(
                credential.environmentVariable,
                `${path}.credential.environmentVariable`,
            ),
            header: credentialHeader,
            scheme:
                credential.scheme === null
                    ? null
                    : readNonEmptyString(credential.scheme, `${path}.credential.scheme`),
        },
        dialect,
        endpoint: readAbsoluteUrl(kind.endpoint, `${path}.endpoint`),
        headers,
        maxOutputTokens: readPositiveInteger(kind.maxOutputTokens, `${path}.maxOutputTokens`),
        maxTokensField: readNonEmptyString(kind.maxTokensField, `${path}.maxTokensField`),
        outputFormat:
            outputFormat === null
                ? null
                : {
                      name: readNonEmptyString(outputFormat.name, `${path}.outputFormat.name`),
                      strict: readBoolean(outputFormat.strict, `${path}.outputFormat.strict`),
                  },
        toolUse: {
            requestField: readNonEmptyString(toolUse.requestField, `${path}.toolUse.requestField`),
            stopReasons: toolStopReasons,
        },
    };
}

function readMessagesConfig(value: unknown): ProtocolConfig["providers"]["messages"] {
    const messages = readObject(
        value,
        ["contentTypes", "rendering", "roles"],
        "providers.messages",
    );
    const rendering = readObject(
        messages.rendering,
        ["input", "instruction", "outputSchema"],
        "providers.messages.rendering",
    );
    const fields = {
        input: readNonEmptyString(rendering.input, "providers.messages.rendering.input"),
        instruction: readNonEmptyString(
            rendering.instruction,
            "providers.messages.rendering.instruction",
        ),
        outputSchema: readNonEmptyString(
            rendering.outputSchema,
            "providers.messages.rendering.outputSchema",
        ),
    };
    if (new Set(Object.values(fields)).size !== 3) {
        throw new TypeError("providers.messages.rendering fields must be distinct");
    }
    const contentTypes = readUniqueStrings(
        messages.contentTypes,
        "providers.messages.contentTypes",
    );
    if (contentTypes.length !== 3) {
        throw new TypeError(
            "providers.messages.contentTypes must list the text, tool use, and tool result types",
        );
    }
    const roles = readUniqueStrings(messages.roles, "providers.messages.roles");
    if (roles.length !== 2) {
        throw new TypeError("providers.messages.roles must list the user and assistant roles");
    }
    return {
        contentTypes,
        rendering: fields,
        roles,
    };
}

function readCapabilities(value: unknown, path: string): ProviderCapabilitiesConfig {
    const capabilities = readObject(value, ["streaming", "structuredOutput", "tools"], path);
    return {
        streaming: readBoolean(capabilities.streaming, `${path}.streaming`),
        structuredOutput: readBoolean(capabilities.structuredOutput, `${path}.structuredOutput`),
        tools: readBoolean(capabilities.tools, `${path}.tools`),
    };
}

function readPlainJson(value: unknown, path: string): Readonly<Record<string, unknown>> {
    return JSON.parse(JSON.stringify(readJsonObject(value, path))) as Record<string, unknown>;
}

function readHeaderName(value: unknown, path: string): string {
    const name = readNonEmptyString(value, path);
    if (!/^[a-z0-9-]+$/u.test(name)) {
        throw new TypeError(`${path} must be a lowercase HTTP header name`);
    }
    return name;
}

function readBoolean(value: unknown, path: string): boolean {
    if (typeof value !== "boolean") {
        throw new TypeError(`${path} must be a boolean`);
    }
    return value;
}
