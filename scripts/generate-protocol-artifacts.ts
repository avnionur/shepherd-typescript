import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";

import { assertSupportedProtocolCompatibility } from "../src/protocol/config-compatibility.ts";
import type { ProtocolConfig } from "../src/protocol/config-types.ts";
import { parseProtocolConfig } from "../src/protocol/config-validation.ts";
import { renderEffectIntentSchema, renderEffectOutcomeSchema } from "./effect-protocol-schemas.ts";
import { renderRunArtifactSchema } from "./run-artifact-schema.ts";
import {
    renderRunContinuationDescriptorSchema,
    renderRunRunningLifecycleSchema,
    renderRunSuspendedLifecycleSchema,
    renderRunWaitingLifecycleSchema,
} from "./run-lifecycle-schemas.ts";
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
            content: renderJson(renderRunContinuationDescriptorSchema(config)),
            relativePath: config.runs.artifacts.continuationDescriptorSchema,
        },
        {
            content: renderJson(renderRunOutcomeSchema(config)),
            relativePath: config.runs.artifacts.outcomeSchema,
        },
        {
            content: renderJson(renderRunRunningLifecycleSchema(config)),
            relativePath: config.runs.artifacts.runningLifecycleSchema,
        },
        {
            content: renderJson(renderRunUsageSchema(config)),
            relativePath: config.runs.artifacts.usageSchema,
        },
        {
            content: renderJson(renderWorldCaptureSchema(config)),
            relativePath: config.workspaces.worldTaskCapture.captureSchemaPath,
        },
        {
            content: renderJson(renderRunWaitingLifecycleSchema(config)),
            relativePath: config.runs.artifacts.waitingLifecycleSchema,
        },
        {
            content: renderJson(renderRunSuspendedLifecycleSchema(config)),
            relativePath: config.runs.artifacts.suspendedLifecycleSchema,
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

function renderWorldCaptureSchema(config: ProtocolConfig): Readonly<Record<string, unknown>> {
    const required = [
        "base_revision_id",
        "binding_id",
        "capture_id",
        "changeset_id",
        "custody_id",
        "head_revision_id",
        "output_id",
        "run_id",
        "schema_version",
        "status",
        "user_basis_after",
        "user_basis_before",
    ];
    const properties = Object.fromEntries(
        required.map((key) => [key, { type: key === "schema_version" ? "integer" : "string" }]),
    );
    return {
        $id: config.workspaces.worldTaskCapture.captureSchemaId,
        $schema: config.kernel.schemas.dialect,
        additionalProperties: false,
        properties: {
            ...properties,
            schema_version: {
                const: config.workspaces.worldTaskCapture.version,
                type: "integer",
            },
            status: { const: config.workspaces.worldTaskCapture.statuses[0], type: "string" },
        },
        required,
        type: "object",
    };
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
    const renderedBudgetMetrics = config.runs.control.budgetMetrics
        .map((metric) => `    ${JSON.stringify(metric)},`)
        .join("\n");
    const renderedControlReasonTypes = config.runs.control.reasonTypes
        .map((type) => JSON.stringify(type))
        .join(", ");
    const renderedControlStatuses = config.runs.control.statuses
        .map((status) => JSON.stringify(status))
        .join(", ");
    const renderedControlCommandKinds = config.runs.execution.controlCommandKinds
        .map((kind) => `    ${JSON.stringify(kind)},`)
        .join("\n");
    const renderedRecoveryStatuses = config.runs.execution.recoveryStatuses
        .map((status) => `    ${JSON.stringify(status)},`)
        .join("\n");
    const renderedClaimStatuses = config.runs.execution.invocationClaimStatuses
        .map((status) => JSON.stringify(status))
        .join(", ");
    const renderedClaimAppendStatuses = config.runs.execution.invocationClaimAppendStatuses
        .map((status) => JSON.stringify(status))
        .join(", ");
    const renderedLifecycleStatuses = config.runs.execution.lifecycleStatuses
        .map((status) => `    ${JSON.stringify(status)},`)
        .join("\n");
    const renderedLifecycleTransitions = config.runs.execution.lifecycleTransitions
        .map(([source, target]) => `    [${JSON.stringify(source)}, ${JSON.stringify(target)}],`)
        .join("\n");
    const renderedLifecycleTerminalTransitions = config.runs.execution.lifecycleTerminalTransitions
        .map(([source, outcome]) => `    [${JSON.stringify(source)}, ${JSON.stringify(outcome)}],`)
        .join("\n");
    const renderedContinuationEvidenceStatuses = config.runs.execution.continuationEvidenceStatuses
        .map((status) => `    ${JSON.stringify(status)},`)
        .join("\n");
    const renderedContinuationConstituentKinds = config.runs.execution.continuationConstituentKinds
        .map((kind) => `    ${JSON.stringify(kind)},`)
        .join("\n");
    const renderedProofProfiles = config.formalAssurance.proofEnvelope.profiles
        .map((profile) => `    ${JSON.stringify(profile)},`)
        .join("\n");
    const renderedProofStrengths = config.formalAssurance.proofEnvelope.strengths
        .map((strength) => `    ${JSON.stringify(strength)},`)
        .join("\n");
    const renderedTraceRecordTypes = Object.entries(
        config.formalAssurance.referenceMachine.recordTypes,
    )
        .map(([key, value]) => `    ${key}: ${JSON.stringify(value)},`)
        .join("\n");
    const renderedTraceActionKinds = config.formalAssurance.referenceMachine.actionKinds
        .map((action) => JSON.stringify(action))
        .join(", ");
    const renderedTraceDispositions =
        config.formalAssurance.referenceMachine.continuationDispositions
            .map((disposition) => JSON.stringify(disposition))
            .join(", ");
    const renderedTraceClosureReasons = config.formalAssurance.referenceMachine.closureReasons
        .map((reason) => JSON.stringify(reason))
        .join(", ");
    const renderedWorkspaceAdoptionModes = config.workspaces.adoptionModes
        .map((mode) => JSON.stringify(mode))
        .join(", ");
    const renderedWorldEntryKinds = config.workspaces.carrier.entryKinds
        .map((kind) => JSON.stringify(kind))
        .join(", ");
    const renderedGitHeadKinds = config.workspaces.gitCustody.headKinds
        .map((kind) => JSON.stringify(kind))
        .join(", ");
    const renderedWorldChangeOperations = config.workspaces.changesets.operations
        .map((operation) => JSON.stringify(operation))
        .join(", ");
    const renderedRetainedWorldEnforcementKinds = config.workspaces.worldExecution.enforcementKinds
        .map((kind) => JSON.stringify(kind))
        .join(", ");
    const renderedRetainedWorldOutputStatuses = config.workspaces.worldTaskCapture.statuses
        .map((status) => JSON.stringify(status))
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

/** Configured proof-envelope profiles ordered from weakest upward. @public */
export const PROOF_ENVELOPE_PROFILES = [
${renderedProofProfiles}
] as const;

/** Configured proof-envelope strengths ordered from weakest upward. @public */
export const PROOF_ENVELOPE_STRENGTHS = [
${renderedProofStrengths}
] as const;

/** Configured normalized Core-A trace record discriminants. @public */
export const TYPED_EFFECT_TRACE_RECORD_TYPES = {
${renderedTraceRecordTypes}
} as const;

/** Configured Core-A handler answer actions. @public */
export const TYPED_EFFECT_TRACE_ACTION_KINDS = [${renderedTraceActionKinds}] as const;

/** Configured canonical world-changeset operations. @public */
export const WORLD_CHANGE_OPERATIONS = [${renderedWorldChangeOperations}] as const;

/** Configured Core-A continuation dispositions paired with answer actions. @public */
export const TYPED_EFFECT_TRACE_CONTINUATION_DISPOSITIONS = [${renderedTraceDispositions}] as const;

/** Configured Core-A selection-closure reasons. @public */
export const TYPED_EFFECT_TRACE_CLOSURE_REASONS = [${renderedTraceClosureReasons}] as const;

/** Configured terminal status discriminants for run outcomes. @public */
export const RUN_TERMINAL_STATUSES = [${renderedRunStatuses}] as const;

/** Configured content representations for run artifacts. @public */
export const RUN_ARTIFACT_CONTENT_TYPES = [${renderedArtifactContentTypes}] as const;

/** Configured run-budget metrics in deterministic exhaustion precedence. @public */
export const RUN_BUDGET_METRICS = [
${renderedBudgetMetrics}
] as const;

/** Configured run-control reason discriminants. @public */
export const RUN_CONTROL_REASON_TYPES = [${renderedControlReasonTypes}] as const;

/** Configured run-control lifecycle statuses. @public */
export const RUN_CONTROL_STATUSES = [${renderedControlStatuses}] as const;

/** Configured normative run-lifecycle statuses. @public */
export const RUN_LIFECYCLE_STATUSES = [
${renderedLifecycleStatuses}
] as const;

/** Configured status identifying the terminal normative lifecycle state. @public */
export const RUN_LIFECYCLE_TERMINAL_STATUS = ${JSON.stringify(
        config.runs.execution.lifecycleTerminalStatus,
    )} as const;

/** Configured active running lifecycle status. @public */
export const RUN_LIFECYCLE_RUNNING_STATUS = ${JSON.stringify(
        config.runs.execution.lifecycleRunningStatus,
    )} as const;

/** Configured prerequisite-driven waiting lifecycle status. @public */
export const RUN_LIFECYCLE_WAITING_STATUS = ${JSON.stringify(
        config.runs.execution.lifecycleWaitingStatus,
    )} as const;

/** Configured control-driven suspended lifecycle status. @public */
export const RUN_LIFECYCLE_SUSPENDED_STATUS = ${JSON.stringify(
        config.runs.execution.lifecycleSuspendedStatus,
    )} as const;

/** Configured allowed non-terminal run-lifecycle transitions. @public */
export const RUN_LIFECYCLE_TRANSITIONS = [
${renderedLifecycleTransitions}
] as const;

/** Configured allowed source-lifecycle and terminal-outcome pairs. @public */
export const RUN_LIFECYCLE_TERMINAL_TRANSITIONS = [
${renderedLifecycleTerminalTransitions}
] as const;

/** Configured continuation-evidence classifications. @public */
export const RUN_CONTINUATION_EVIDENCE_STATUSES = [
${renderedContinuationEvidenceStatuses}
] as const;

/** Configured receipt-bearing continuation-evidence status. @public */
export const RUN_CONTINUATION_VERIFIED_STATUS = ${JSON.stringify(
        config.runs.execution.continuationVerifiedStatus,
    )} as const;

/** Configured continuation-descriptor constituent kinds. @public */
export const RUN_CONTINUATION_CONSTITUENT_KINDS = [
${renderedContinuationConstituentKinds}
] as const;

/** Configured durable execution recovery statuses. @public */
export const DURABLE_EXECUTION_RECOVERY_STATUSES = [
${renderedRecoveryStatuses}
] as const;

/** Configured durable execution control-command kinds. @public */
export const DURABLE_EXECUTION_CONTROL_COMMAND_KINDS = [
${renderedControlCommandKinds}
] as const;

/** Configured durable invocation-claim result statuses. @public */
export const DURABLE_EXECUTION_INVOCATION_CLAIM_STATUSES = [${renderedClaimStatuses}] as const;

/** Configured claim-guarded append result statuses. @public */
export const DURABLE_EXECUTION_CLAIMED_APPEND_STATUSES = [${renderedClaimAppendStatuses}] as const;

/** Configured workspace baseline-adoption modes. @public */
export const WORKSPACE_ADOPTION_MODES = [${renderedWorkspaceAdoptionModes}] as const;

/** Configured reference copy-carrier manifest entry kinds. @public */
export const WORLD_ENTRY_KINDS = [${renderedWorldEntryKinds}] as const;

/** Configured retained-world runner enforcement classifications. @public */
export const RETAINED_WORLD_ENFORCEMENT_KINDS = [${renderedRetainedWorldEnforcementKinds}] as const;

/** Configured durable retained-world output statuses. @public */
export const RETAINED_WORLD_OUTPUT_STATUSES = [${renderedRetainedWorldOutputStatuses}] as const;

/** Configured maximum UTF-8 bytes for one retained-world text operation. @public */
export const RETAINED_WORLD_MAX_TEXT_BYTES = ${config.workspaces.worldTaskCapture.maxTextBytes} as const;

/** Configured maximum UTF-8 bytes for one retained-world capture identity. @public */
export const RETAINED_WORLD_MAX_CAPTURE_ID_BYTES = ${config.workspaces.worldTaskCapture.maxCaptureIdBytes} as const;

/** Configured Git HEAD-state discriminants. @public */
export const GIT_HEAD_KINDS = [${renderedGitHeadKinds}] as const;
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
            append_intent_id: { type: "string", minLength: 1 },
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
