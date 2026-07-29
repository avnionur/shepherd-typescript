import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";

type ArtifactOptions = {
    readonly check?: boolean;
    readonly repositoryRoot: string;
};

type ProtocolConfig = {
    readonly kernel: {
        readonly append: {
            readonly firstOwnerOrdinal: number;
            readonly lastOwnerOrdinal: number;
        };
        readonly artifacts: {
            readonly appendBatchDraftSchema: string;
            readonly recordBodySchema: string;
            readonly recordEnvelopeSchema: string;
            readonly recordViewSchema: string;
            readonly recordValues: string;
        };
        readonly recordModes: readonly string[];
        readonly schemas: {
            readonly appendBatchDraftId: string;
            readonly dialect: string;
            readonly recordBodyId: string;
            readonly recordEnvelopeId: string;
            readonly recordViewId: string;
        };
    };
    readonly recordId: {
        readonly hexLength: number;
        readonly prefix: string;
    };
};

/** Generates or checks protocol artifacts derived from `protocol.config.json`. */
export async function synchronizeProtocolArtifacts(options: ArtifactOptions): Promise<void> {
    const repositoryRoot = await realpath(options.repositoryRoot);
    const configPath = path.join(repositoryRoot, "protocol.config.json");
    const config = JSON.parse(await readFile(configPath, "utf8")) as ProtocolConfig;
    const artifacts = new Map<string, string>([
        [config.kernel.artifacts.recordValues, renderRecordValues(config.kernel.recordModes)],
        [config.kernel.artifacts.recordBodySchema, renderJson(recordBodySchema(config))],
        [config.kernel.artifacts.recordEnvelopeSchema, renderJson(recordEnvelopeSchema(config))],
        [config.kernel.artifacts.recordViewSchema, renderJson(recordViewSchema(config))],
        [
            config.kernel.artifacts.appendBatchDraftSchema,
            renderJson(appendBatchDraftSchema(config)),
        ],
    ]);

    for (const [relativePath, content] of artifacts) {
        const artifactPath = await resolveArtifactPath(repositoryRoot, relativePath);
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

function renderRecordValues(recordModes: readonly string[]): string {
    const renderedModes = recordModes.map((mode) => JSON.stringify(mode)).join(", ");
    return `// Generated from protocol.config.json. Do not edit directly.

/**
 * Record modes supported by the configured kernel ABI.
 *
 * @public
 */
export const RECORD_MODES = [${renderedModes}] as const;
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
