import type { CliGroupConfig, ProtocolConfig } from "../src/protocol/config-types.ts";

type JsonSchema = Readonly<Record<string, unknown>>;

/** Renders the closed stable CLI JSON envelope schema from protocol configuration. */
export function renderCliOutputSchema(config: ProtocolConfig): JsonSchema {
    const commandSchemas = config.cli.groups.flatMap((group) => successSchemas(config, group));
    return {
        $defs: {
            jsonValue: {
                oneOf: [
                    { type: "null" },
                    { type: "boolean" },
                    { type: "number" },
                    { type: "string" },
                    { items: { $ref: "#/$defs/jsonValue" }, type: "array" },
                    {
                        additionalProperties: { $ref: "#/$defs/jsonValue" },
                        type: "object",
                    },
                ],
            },
        },
        $id: config.cli.machineOutput.schemaId,
        $schema: "https://json-schema.org/draft/2020-12/schema",
        oneOf: [
            successEnvelope(config, [], [["groups"]]),
            ...commandSchemas,
            failureEnvelope(config),
        ],
    };
}

/** Renders the checked-in CLI command and JSON contract reference from configuration. */
export function renderCliCommandReference(config: ProtocolConfig): string {
    const commandLines = config.cli.groups.flatMap((group) =>
        group.handler === null
            ? group.commands.map(
                  ({ name }) => `- \`${config.cli.executableName} ${group.name} ${name}\``,
              )
            : [`- \`${config.cli.executableName} ${group.name}\``],
    );
    const optionLines = Object.values(config.cli.options).map((name) => `- \`--${name}\``);
    const unavailableLines = config.cli.groups.flatMap((group) =>
        group.commands.flatMap((command) => {
            const remedyKey = config.cli.machineOutput.unavailableRemedies[command.handler];
            if (remedyKey === undefined) return [];
            return [
                `- \`${config.cli.executableName} ${group.name} ${command.name}\`: ${config.cli.remedies[remedyKey]}`,
            ];
        }),
    );
    return `# Generated CLI reference

This file is generated from \`protocol.config.json\`. Do not edit it directly.

Executable: \`${config.cli.executableName}\`<br>
Human compatibility: \`${config.cli.compatibilityVersion}\`<br>
JSON compatibility: \`${config.cli.machineOutput.compatibilityVersion}\`<br>
JSON schema: \`${config.cli.machineOutput.schemaId}\`

## Commands

${commandLines.join("\n")}

## Options

${optionLines.join("\n")}

## Fenced or unavailable commands

${unavailableLines.join("\n")}

Pass \`--${config.cli.options.json}\` anywhere in an invocation to emit one canonical JSON object followed by a newline. Successful output is written to stdout; errors are written to stderr. The envelope is bounded to ${config.cli.machineOutput.maxCanonicalBytes} UTF-8 bytes and never includes error messages, stack traces, or resolved filesystem paths.
`;
}

function successSchemas(config: ProtocolConfig, group: CliGroupConfig): readonly JsonSchema[] {
    const groupHelp = successEnvelope(config, [group.name], [["commands", "group"]]);
    if (group.handler !== null) {
        return [
            groupHelp,
            successEnvelope(config, [group.name], resultShapes(config, group.handler)),
        ];
    }
    return [
        groupHelp,
        ...group.commands.flatMap((command) => {
            const shapes = resultShapes(config, command.handler);
            return shapes.length === 0
                ? []
                : [successEnvelope(config, [group.name, command.name], shapes)];
        }),
    ];
}

function resultShapes(config: ProtocolConfig, handler: string): readonly (readonly string[])[] {
    return config.cli.machineOutput.resultShapes[handler] ?? [];
}

function successEnvelope(
    config: ProtocolConfig,
    command: readonly string[],
    resultShapes: readonly (readonly string[])[],
): JsonSchema {
    const variants = resultShapes.map((keys) => ({
        additionalProperties: false,
        properties: Object.fromEntries(keys.map((key) => [key, { $ref: "#/$defs/jsonValue" }])),
        required: keys,
        type: "object",
    }));
    const result = variants.length === 1 ? variants[0] : { oneOf: variants };
    return envelope(config, {
        properties: {
            command: { const: command, type: "array" },
            ok: { const: true, type: "boolean" },
            result,
        },
        required: ["result"],
    });
}

function failureEnvelope(config: ProtocolConfig): JsonSchema {
    return envelope(config, {
        properties: {
            command: { items: { type: "string" }, maxItems: 2, type: "array" },
            error: {
                additionalProperties: false,
                properties: {
                    code: {
                        enum: Object.values(config.cli.machineOutput.errorCodes),
                        type: "string",
                    },
                },
                required: ["code"],
                type: "object",
            },
            ok: { const: false, type: "boolean" },
        },
        required: ["error"],
    });
}

function envelope(
    config: ProtocolConfig,
    variant: { readonly properties: JsonSchema; readonly required: readonly string[] },
): JsonSchema {
    return {
        additionalProperties: false,
        properties: {
            cli_compatibility_version: {
                const: config.cli.machineOutput.compatibilityVersion,
                type: "string",
            },
            cli_output_version: { const: config.cli.machineOutput.version, type: "integer" },
            ...variant.properties,
        },
        required: [
            "cli_compatibility_version",
            "cli_output_version",
            "command",
            "ok",
            ...variant.required,
        ],
        type: "object",
    };
}
