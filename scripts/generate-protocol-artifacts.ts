import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";

import { assertSupportedProtocolCompatibility } from "../src/protocol/config-compatibility.ts";
import type { ProtocolConfig } from "../src/protocol/config-types.ts";
import { parseProtocolConfig } from "../src/protocol/config-validation.ts";
import { renderEffectIntentSchema, renderEffectOutcomeSchema } from "./effect-protocol-schemas.ts";
import { renderRunArtifactSchema } from "./run-artifact-schema.ts";
import { renderRunOutcomeSchema } from "./run-protocol-schema.ts";
import { renderRunUsageSchema } from "./run-usage-schema.ts";
import {
    renderTaskArtifactLockSchema,
    renderTaskDescriptorSchema,
} from "./task-protocol-schemas.ts";
import { renderTraceArchiveSchema } from "./trace-archive-schema.ts";

type ArtifactOptions = {
    readonly check?: boolean;
    readonly repositoryRoot: string;
};

/** Generates or checks protocol artifacts derived from `protocol.config.json`. */
export async function synchronizeProtocolArtifacts(options: ArtifactOptions): Promise<void> {
    const repositoryRoot = await realpath(options.repositoryRoot);
    const configPath = path.join(repositoryRoot, "protocol.config.json");
    const config = parseProtocolConfig(JSON.parse(await readFile(configPath, "utf8")), {
        enforceCompatibility: false,
    });
    const artifacts = [
        {
            content: renderProtocolValues(config),
            relativePath: config.kernel.artifacts.recordValues,
        },
        {
            content: renderJson(recordBodySchema(config)),
            relativePath: config.kernel.artifacts.recordBodySchema,
        },
        {
            content: renderJson(recordEnvelopeSchema(config)),
            relativePath: config.kernel.artifacts.recordEnvelopeSchema,
        },
        {
            content: renderJson(recordViewSchema(config)),
            relativePath: config.kernel.artifacts.recordViewSchema,
        },
        {
            content: renderJson(appendBatchDraftSchema(config)),
            relativePath: config.kernel.artifacts.appendBatchDraftSchema,
        },
        {
            content: renderJson(renderTraceArchiveSchema(config)),
            relativePath: config.kernel.artifacts.traceArchiveSchema,
        },
        {
            content: renderJson(renderTaskDescriptorSchema(config)),
            relativePath: config.tasks.artifacts.descriptorSchema,
        },
        {
            content: renderJson(renderTaskArtifactLockSchema(config)),
            relativePath: config.tasks.artifacts.artifactLockSchema,
        },
        {
            content: renderJson(renderEffectIntentSchema(config)),
            relativePath: config.effects.artifacts.intentSchema,
        },
        {
            content: renderJson(renderEffectOutcomeSchema(config)),
            relativePath: config.effects.artifacts.outcomeSchema,
        },
        {
            content: renderJson(renderRunArtifactSchema(config)),
            relativePath: config.runs.artifacts.artifactSchema,
        },
        {
            content: renderJson(renderRunOutcomeSchema(config)),
            relativePath: config.runs.artifacts.outcomeSchema,
        },
        {
            content: renderJson(renderRunUsageSchema(config)),
            relativePath: config.runs.artifacts.usageSchema,
        },
    ];
    const resolvedArtifacts: { content: string; artifactPath: string; relativePath: string }[] = [];
    for (const { content, relativePath } of artifacts) {
        const artifactPath = await resolveArtifactPath(repositoryRoot, relativePath);
        resolvedArtifacts.push({ artifactPath, content, relativePath });
    }
    assertSupportedProtocolCompatibility(config);

    for (const { artifactPath, content, relativePath } of resolvedArtifacts) {
        if (options.check) {
            if ((await readFile(artifactPath, "utf8")) !== content) {
                throw new Error(`${relativePath} is not synchronized with protocol.config.json`);
            }
            continue;
        }
        await mkdir(path.dirname(artifactPath), { recursive: true });
        await writeFile(artifactPath, content);
    }
}

function renderProtocolValues(config: ProtocolConfig): string {
    const renderedModes = config.kernel.recordModes.map((mode) => JSON.stringify(mode)).join(", ");
    const renderedTiers = config.effects.reversibilityTiers
        .map((tier) => JSON.stringify(tier))
        .join(", ");
    const renderedRunStatuses = config.runs.terminalStatuses
        .map((status) => JSON.stringify(status))
        .join(", ");
    const renderedArtifactContentTypes = config.runs.artifactContentTypes
        .map((type) => JSON.stringify(type))
        .join(", ");
    return `// Generated from protocol.config.json. Do not edit directly.

/**
 * Record modes supported by the configured kernel ABI.
 *
 * @public
 */
export const RECORD_MODES = [${renderedModes}] as const;

/** Configured reversibility guarantees for effect intents. @public */
export const EFFECT_REVERSIBILITY_TIERS = [${renderedTiers}] as const;

/** Configured wire discriminants for effect lifecycle phases. @public */
export const EFFECT_PHASES = { intent: ${JSON.stringify(
        config.effects.phases.intent,
    )}, outcome: ${JSON.stringify(config.effects.phases.outcome)} } as const;

/** Configured terminal status discriminants for run outcomes. @public */
export const RUN_TERMINAL_STATUSES = [${renderedRunStatuses}] as const;

/** Configured content representations for run artifacts. @public */
export const RUN_ARTIFACT_CONTENT_TYPES = [${renderedArtifactContentTypes}] as const;
`;
}

function recordBodySchema(config: ProtocolConfig): Readonly<Record<string, unknown>> {
    const semanticValue = {
        anyOf: [
            { type: "boolean" },
            { type: "null" },
            { type: "number" },
            { type: "string" },
            { type: "array", items: { $ref: "#/$defs/semanticValue" } },
            {
                type: "object",
                additionalProperties: { $ref: "#/$defs/semanticValue" },
            },
        ],
    };
    return {
        $schema: config.kernel.schemas.dialect,
        $id: config.kernel.schemas.recordBodyId,
        $comment: "Generated from protocol.config.json. Do not edit directly.",
        title: "Shepherd Kernel RecordBody v0",
        description: "A schema-specific semantic payload retained by a kernel record.",
        type: "object",
        additionalProperties: { $ref: "#/$defs/semanticValue" },
        $defs: { semanticValue },
    };
}

function recordEnvelopeSchema(config: ProtocolConfig): Readonly<Record<string, unknown>> {
    return {
        $schema: config.kernel.schemas.dialect,
        $id: config.kernel.schemas.recordEnvelopeId,
        $comment: "Generated from protocol.config.json. Do not edit directly.",
        title: "Shepherd Kernel RecordEnvelope v0",
        description: "Stable semantic identity and ordered causality for one retained record.",
        type: "object",
        required: [
            "record_id",
            "digest",
            "schema_ref",
            "mode",
            "witness_ref",
            "caused_by_record_ids",
        ],
        properties: {
            record_id: { $ref: "#/$defs/recordId" },
            digest: { $ref: "#/$defs/recordId" },
            schema_ref: { type: "string", minLength: 1 },
            mode: { enum: [...config.kernel.recordModes] },
            witness_ref: {
                anyOf: [{ $ref: "#/$defs/recordId" }, { const: "" }],
            },
            caused_by_record_ids: {
                type: "array",
                items: { $ref: "#/$defs/recordId" },
            },
        },
        additionalProperties: false,
        $defs: {
            recordId: {
                type: "string",
                pattern: recordIdPattern(config),
            },
        },
    };
}

function recordViewSchema(config: ProtocolConfig): Readonly<Record<string, unknown>> {
    return {
        $schema: config.kernel.schemas.dialect,
        $id: config.kernel.schemas.recordViewId,
        $comment: "Generated from protocol.config.json. Do not edit directly.",
        title: "Shepherd Kernel RecordView v0",
        description: "Owner-local record placement outside semantic record identity.",
        type: "object",
        required: ["owner_id", "owner_ordinal"],
        properties: {
            owner_id: { type: "string", minLength: 1 },
            owner_ordinal: {
                type: "integer",
                minimum: config.kernel.append.firstOwnerOrdinal,
                maximum: config.kernel.append.lastOwnerOrdinal,
            },
        },
        additionalProperties: false,
    };
}

function appendBatchDraftSchema(config: ProtocolConfig): Readonly<Record<string, unknown>> {
    return {
        $schema: config.kernel.schemas.dialect,
        $id: config.kernel.schemas.appendBatchDraftId,
        $comment: "Generated from protocol.config.json. Do not edit directly.",
        title: "Shepherd Kernel AppendBatchDraft v0",
        description: "Ordered owner groups prepared for a future atomic append.",
        type: "object",
        required: ["groups"],
        properties: {
            groups: {
                type: "array",
                items: { $ref: "#/$defs/appendGroup" },
            },
        },
        additionalProperties: false,
        $defs: {
            appendGroup: {
                type: "object",
                required: ["owner_id", "records"],
                properties: {
                    owner_id: { type: "string", minLength: 1 },
                    caused_by_record_ids: {
                        type: "array",
                        items: { $ref: "#/$defs/recordId" },
                    },
                    records: {
                        type: "array",
                        items: { $ref: "#/$defs/appendRecord" },
                    },
                },
                additionalProperties: false,
            },
            appendRecord: {
                type: "object",
                required: ["body", "mode", "schema_ref", "witness_ref"],
                properties: {
                    append_local_id: { type: "string", minLength: 1 },
                    body: { $ref: config.kernel.schemas.recordBodyId },
                    caused_by_record_ids: {
                        type: "array",
                        items: { $ref: "#/$defs/recordId" },
                    },
                    caused_by_local_refs: {
                        type: "array",
                        items: { type: "string", minLength: 1 },
                    },
                    mode: { enum: [...config.kernel.recordModes] },
                    schema_ref: { type: "string", minLength: 1 },
                    witness_ref: { $ref: "#/$defs/recordId" },
                },
                additionalProperties: false,
            },
            recordId: {
                type: "string",
                pattern: recordIdPattern(config),
            },
        },
    };
}

function recordIdPattern(config: ProtocolConfig): string {
    return `^${escapeRegularExpression(config.recordId.prefix)}[0-9a-f]{${
        config.recordId.hexLength
    }}$`;
}

function renderJson(value: Readonly<Record<string, unknown>>): string {
    return `${JSON.stringify(value, null, 4)}\n`;
}

async function resolveArtifactPath(repositoryRoot: string, relativePath: string): Promise<string> {
    if (relativePath.length === 0 || path.isAbsolute(relativePath)) {
        throw new TypeError(`unsafe protocol artifact path: ${relativePath}`);
    }
    const relative = path.relative(repositoryRoot, path.resolve(repositoryRoot, relativePath));
    if (relative === ".." || relative.startsWith(`..${path.sep}`)) {
        throw new TypeError(`unsafe protocol artifact path: ${relativePath}`);
    }

    let currentPath = repositoryRoot;
    const segments = relative.split(path.sep);
    for (const [index, segment] of segments.entries()) {
        const candidatePath = path.join(currentPath, segment);
        try {
            const status = await lstat(candidatePath);
            if (status.isSymbolicLink()) {
                throw new TypeError(`unsafe protocol artifact symlink: ${relativePath}`);
            }
            currentPath = await realpath(candidatePath);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
                throw error;
            }
            return path.join(currentPath, ...segments.slice(index));
        }
    }
    return currentPath;
}

function escapeRegularExpression(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
