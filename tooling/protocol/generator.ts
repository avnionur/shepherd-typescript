import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";

import { assertSupportedProtocolCompatibility } from "../../src/protocol/config-compatibility.ts";
import type { ProtocolConfig } from "../../src/protocol/config-types.ts";
import { parseProtocolConfig } from "../../src/protocol/config-validation.ts";
import { renderCliCommandReference, renderCliOutputSchema } from "./schemas/cli-artifacts.ts";
import {
    renderEffectIntentSchema,
    renderEffectOutcomeSchema,
} from "./schemas/effect-protocol-schemas.ts";
import {
    renderOutputCitationEntrySchema,
    renderRecoveryRecordEntrySchema,
    renderTraceRevisionEntrySchema,
} from "./schemas/evidence-record-schemas.ts";
import {
    renderOrphanOperationDiagnosisSchema,
    renderOrphanRepairCommandSchema,
    renderOrphanRepairReceiptSchema,
} from "./schemas/orphan-repair-schemas.ts";
import { renderRunArtifactSchema } from "./schemas/run-artifact-schema.ts";
import {
    renderRunContinuationDescriptorSchema,
    renderRunRunningLifecycleSchema,
    renderRunSuspendedLifecycleSchema,
    renderRunWaitingLifecycleSchema,
} from "./schemas/run-lifecycle-schemas.ts";
import { renderRunOutcomeSchema } from "./schemas/run-protocol-schema.ts";
import { renderRunUsageSchema } from "./schemas/run-usage-schema.ts";
import {
    renderScopeChildMergedSchema,
    renderScopeChildRegisteredSchema,
    renderScopeDiscardSchema,
    renderScopeEmissionSchema,
    renderScopeForkSchema,
    renderScopeMergeSchema,
    renderScopeRegistrationSchema,
} from "./schemas/scope-schemas.ts";
import {
    renderTaskArtifactLockSchema,
    renderTaskDescriptorSchema,
} from "./schemas/task-protocol-schemas.ts";
import {
    renderRunLedgerEntrySchema,
    renderTaskLedgerEntrySchema,
} from "./schemas/task-run-ledger-schemas.ts";
import { renderTraceArchiveSchema } from "./schemas/trace-archive-schema.ts";

/** Repository and execution mode for deterministic protocol artifact synchronization. */
export type ProtocolArtifactOptions = {
    /** Whether to reject drift instead of writing generated artifacts. */
    readonly check?: boolean;
    /** Repository root containing protocol configuration and artifact destinations. */
    readonly repositoryRoot: string;
};

/**
 * Generates or checks protocol artifacts derived from `protocol.config.json`.
 *
 * @param options - Repository root and optional drift-check mode.
 * @returns A promise that resolves after all configured artifacts are validated or written.
 * @throws {TypeError} If configuration or an artifact destination is unsafe.
 * @throws {Error} If compatibility validation, reading, generation, or writing fails.
 */
export async function synchronizeProtocolArtifacts(
    options: ProtocolArtifactOptions,
): Promise<void> {
    const repositoryRoot = await realpath(options.repositoryRoot);
    const configPath = path.join(repositoryRoot, "protocol.config.json");
    const config = parseProtocolConfig(JSON.parse(await readFile(configPath, "utf8")), {
        enforceCompatibility: false,
    });
    const artifacts = [
        {
            content: renderCliCommandReference(config),
            relativePath: config.cli.artifacts.commandReference,
        },
        {
            content: renderJson(renderCliOutputSchema(config)),
            relativePath: config.cli.artifacts.jsonOutputSchema,
        },
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
            content: renderJson(renderTaskLedgerEntrySchema(config)),
            relativePath: config.projections.taskRunLedgers.artifacts.taskEntrySchema,
        },
        {
            content: renderJson(renderRunLedgerEntrySchema(config)),
            relativePath: config.projections.taskRunLedgers.artifacts.runEntrySchema,
        },
        {
            content: renderJson(renderOutputCitationEntrySchema(config)),
            relativePath: config.projections.evidenceRecords.artifacts.outputCitationSchema,
        },
        {
            content: renderJson(renderTraceRevisionEntrySchema(config)),
            relativePath: config.projections.evidenceRecords.artifacts.traceRevisionSchema,
        },
        {
            content: renderJson(renderRecoveryRecordEntrySchema(config)),
            relativePath: config.projections.evidenceRecords.artifacts.recoveryRecordSchema,
        },
        {
            content: renderJson(renderOrphanOperationDiagnosisSchema(config)),
            relativePath: config.orphanRepair.artifacts.diagnosisSchema,
        },
        {
            content: renderJson(renderOrphanRepairCommandSchema(config)),
            relativePath: config.orphanRepair.artifacts.commandSchema,
        },
        {
            content: renderJson(renderOrphanRepairReceiptSchema(config)),
            relativePath: config.orphanRepair.artifacts.receiptSchema,
        },
        {
            content: renderJson(renderRepositoryTaskGrantSchema(config)),
            relativePath: config.workspaces.repositoryGrants.artifacts.taskGrantArtifactSchema,
        },
        {
            content: renderJson(renderRepositoryTaskGrantLockSchema(config)),
            relativePath: config.workspaces.repositoryGrants.artifacts.taskGrantArtifactLockSchema,
        },
        {
            content: renderJson(renderRepositoryGrantPlanSchema(config)),
            relativePath: config.workspaces.repositoryGrants.artifacts.grantPlanSchema,
        },
        {
            content: renderJson(renderPlacementPlatformEvidenceSchema(config)),
            relativePath: config.workspaces.placements.artifacts.platformEvidenceSchema,
        },
        {
            content: renderJson(renderPlacementResolutionSchema(config)),
            relativePath: config.workspaces.placements.artifacts.resolutionSchema,
        },
        {
            content: renderJson(renderNativeJailBackendSchema(config)),
            relativePath: config.workspaces.placements.nativeJails.artifacts.backendSchema,
        },
        {
            content: renderJson(renderNativeJailCommandSchema(config)),
            relativePath: config.workspaces.placements.nativeJails.artifacts.commandSchema,
        },
        {
            content: renderJson(renderNativeJailPlanSchema(config)),
            relativePath: config.workspaces.placements.nativeJails.artifacts.planSchema,
        },
        {
            content: renderJson(renderNativeJailProbeSchema(config)),
            relativePath: config.workspaces.placements.nativeJails.artifacts.probeSchema,
        },
        {
            content: renderJson(renderNativeJailProcessSchema(config)),
            relativePath: config.workspaces.placements.nativeJails.artifacts.processSchema,
        },
        {
            content: renderJson(renderNativeJailResolutionSchema(config)),
            relativePath: config.workspaces.placements.nativeJails.artifacts.resolutionSchema,
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
            content: renderJson(renderScopeRegistrationSchema(config)),
            relativePath: config.scopes.artifacts.registrationSchema,
        },
        {
            content: renderJson(renderScopeChildRegisteredSchema(config)),
            relativePath: config.scopes.artifacts.childRegisteredSchema,
        },
        {
            content: renderJson(renderScopeEmissionSchema(config)),
            relativePath: config.scopes.artifacts.emissionSchema,
        },
        {
            content: renderJson(renderScopeForkSchema(config)),
            relativePath: config.scopes.artifacts.forkSchema,
        },
        {
            content: renderJson(renderScopeMergeSchema(config)),
            relativePath: config.scopes.artifacts.mergeSchema,
        },
        {
            content: renderJson(renderScopeChildMergedSchema(config)),
            relativePath: config.scopes.artifacts.childMergedSchema,
        },
        {
            content: renderJson(renderScopeDiscardSchema(config)),
            relativePath: config.scopes.artifacts.discardSchema,
        },
        {
            content: renderJson(renderWorldCaptureSchema(config)),
            relativePath: config.workspaces.worldTaskCapture.captureSchemaPath,
        },
        {
            content: renderJson(renderWorldCaptureJournalSchema(config)),
            relativePath: config.workspaces.worldTaskCapture.journalSchemaPath,
        },
        {
            content: renderJson(renderSettlementCitationSchema(config)),
            relativePath: config.workspaces.settlement.citationSchemaPath,
        },
        {
            content: renderJson(renderRetainedWorldApplicationConflictSchema(config)),
            relativePath: config.workspaces.settlement.application.artifacts.conflictSchema,
        },
        {
            content: renderJson(renderRetainedWorldApplicationPlanSchema(config)),
            relativePath: config.workspaces.settlement.application.artifacts.planSchema,
        },
        {
            content: renderJson(renderRetainedWorldApplicationReceiptSchema(config)),
            relativePath: config.workspaces.settlement.application.artifacts.receiptSchema,
        },
        {
            content: renderJson(renderRetainedWorldReleaseReceiptSchema(config)),
            relativePath: config.workspaces.settlement.release.artifacts.receiptSchema,
        },
        {
            content: renderJson(renderSelectionPublicationSchema(config)),
            relativePath: config.workspaces.selectionPublication.schemaPath,
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

function renderSettlementCitationSchema(config: ProtocolConfig): Readonly<Record<string, unknown>> {
    const text = { minLength: 1, type: "string" } as const;
    return {
        $id: config.workspaces.settlement.citationSchemaId,
        $schema: "https://json-schema.org/draft/2020-12/schema",
        additionalProperties: false,
        properties: {
            action: { enum: config.workspaces.settlement.actions, type: "string" },
            capture_record_id: text,
            citation_cut_id: text,
            citation_version: {
                const: config.workspaces.settlement.citationVersion,
                type: "integer",
            },
            command_id: text,
            execution_cut_id: text,
            operation_digest: text,
            operation_id: text,
            operation_json: text,
            outcome_record_id: text,
            output_id: text,
            receipt_digest: text,
            receipt_json: text,
            request_id: text,
            run_id: text,
            state: {
                enum: config.workspaces.settlement.states.slice(2),
                type: "string",
            },
            terminal_record_id: text,
        },
        required: [
            "action",
            "capture_record_id",
            "citation_cut_id",
            "citation_version",
            "command_id",
            "execution_cut_id",
            "operation_digest",
            "operation_id",
            "operation_json",
            "outcome_record_id",
            "output_id",
            "receipt_digest",
            "receipt_json",
            "request_id",
            "run_id",
            "state",
            "terminal_record_id",
        ],
        title: "Shepherd Retained World Settlement Citation v1",
        type: "object",
    };
}

function renderRetainedWorldApplicationConflictSchema(
    config: ProtocolConfig,
): Readonly<Record<string, unknown>> {
    const application = config.workspaces.settlement.application;
    return {
        $id: application.schemas.conflictId,
        $schema: config.kernel.schemas.dialect,
        additionalProperties: false,
        properties: {
            compatibility_version: { const: application.compatibilityVersion, type: "string" },
            conflict_id: {
                pattern: digestPrefixPattern(application.conflictIdPrefix, config),
                type: "string",
            },
            conflict_version: { const: application.conflictVersion, type: "integer" },
            conflicts: {
                items: {
                    additionalProperties: false,
                    properties: {
                        candidate_path: { minLength: 1, type: "string" },
                        current_path: { minLength: 1, type: "string" },
                        kind: { enum: application.conflictKinds, type: "string" },
                    },
                    required: ["candidate_path", "current_path", "kind"],
                    type: "object",
                },
                maxItems: application.maxConflicts,
                minItems: 1,
                type: "array",
            },
        },
        required: ["compatibility_version", "conflict_id", "conflict_version", "conflicts"],
        type: "object",
    };
}

function renderRetainedWorldApplicationPlanSchema(
    config: ProtocolConfig,
): Readonly<Record<string, unknown>> {
    const application = config.workspaces.settlement.application;
    const text = { minLength: 1, type: "string" } as const;
    const pathArray = {
        items: text,
        maxItems: config.workspaces.changesets.maxChanges,
        type: "array",
        uniqueItems: true,
    } as const;
    const fields = [
        "application_custody_id",
        "application_version",
        "base_content_id",
        "base_revision_id",
        "binding_id",
        "candidate_changeset_id",
        "candidate_content_id",
        "candidate_paths",
        "candidate_revision_id",
        "compatibility_version",
        "current_changeset_id",
        "current_content_id",
        "current_paths",
        "current_revision_id",
        "merged_content_id",
        "merged_revision_id",
        "plan_id",
        "publication_changeset_id",
        "reason",
        "request_id",
        "status",
    ];
    return {
        $id: application.schemas.planId,
        $schema: config.kernel.schemas.dialect,
        additionalProperties: false,
        properties: {
            ...Object.fromEntries(fields.map((field) => [field, text])),
            application_version: { const: application.planVersion, type: "integer" },
            candidate_paths: pathArray,
            compatibility_version: { const: application.compatibilityVersion, type: "string" },
            current_paths: pathArray,
            plan_id: {
                pattern: digestPrefixPattern(application.planIdPrefix, config),
                type: "string",
            },
            reason: { enum: application.reasons, type: "string" },
            status: { enum: application.statuses, type: "string" },
        },
        required: fields,
        type: "object",
    };
}

function renderRetainedWorldApplicationReceiptSchema(
    config: ProtocolConfig,
): Readonly<Record<string, unknown>> {
    const application = config.workspaces.settlement.application;
    const fields = [
        "action",
        "applied_revision_id",
        "application_plan_id",
        "operation_id",
        "publication_id",
        "receipt_version",
        "request_id",
        "state",
        "user_basis_after",
    ];
    return {
        $id: application.schemas.receiptId,
        $schema: config.kernel.schemas.dialect,
        additionalProperties: false,
        properties: {
            ...Object.fromEntries(fields.map((field) => [field, { minLength: 1, type: "string" }])),
            action: { const: config.workspaces.settlement.actions[2], type: "string" },
            application_plan_id: {
                pattern: digestPrefixPattern(application.planIdPrefix, config),
                type: "string",
            },
            receipt_version: { const: application.receiptVersion, type: "integer" },
            state: { const: config.workspaces.settlement.states[4], type: "string" },
        },
        required: fields,
        type: "object",
    };
}

function renderRetainedWorldReleaseReceiptSchema(
    config: ProtocolConfig,
): Readonly<Record<string, unknown>> {
    const release = config.workspaces.settlement.release;
    const fields = [
        "action",
        "base_revision_id",
        "binding_id",
        "changeset_id",
        "compatibility_version",
        "custody_id",
        "head_revision_id",
        "operation_id",
        "output_id",
        "receipt_version",
        "request_id",
        "state",
        "user_basis_after",
        "user_basis_before",
    ];
    return {
        $id: release.schemaId,
        $schema: config.kernel.schemas.dialect,
        additionalProperties: false,
        properties: {
            ...Object.fromEntries(fields.map((field) => [field, { minLength: 1, type: "string" }])),
            action: { const: config.workspaces.settlement.actions[3], type: "string" },
            compatibility_version: { const: release.compatibilityVersion, type: "string" },
            receipt_version: { const: release.receiptVersion, type: "integer" },
            state: { const: config.workspaces.settlement.states[5], type: "string" },
        },
        required: fields,
        type: "object",
    };
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

function renderWorldCaptureJournalSchema(
    config: ProtocolConfig,
): Readonly<Record<string, unknown>> {
    const [prepared, forked, executing, captured] =
        config.workspaces.worldTaskCapture.journalPhases;
    const phaseSchemas = [
        [
            prepared,
            [
                "base_revision_id",
                "binding_id",
                "enforcement",
                "max_capture_id_bytes",
                "max_text_bytes",
                "native_jail_resolution",
                "native_jail_resolution_id",
                "placement_resolution",
                "placement_resolution_id",
                "repository_grant_plan",
                "repository_grant_plan_id",
                "runner_id",
            ],
        ],
        [forked, ["custody_id", "user_basis_before"]],
        [executing, ["claim_id", "custody_id", "fencing_token"]],
        [
            captured,
            [
                "changeset_id",
                "custody_id",
                "head_revision_id",
                "user_basis_after",
                "user_basis_before",
            ],
        ],
    ] as const;
    const placedGrantDependency = Object.fromEntries([
        [
            "if",
            {
                properties: {
                    capture_phase: { const: prepared },
                    placement_resolution: { type: "object" },
                },
                required: ["capture_phase", "placement_resolution"],
                type: "object",
            },
        ],
        [
            // biome-ignore lint/suspicious/noThenProperty: JSON Schema conditional keyword.
            "then",
            {
                properties: {
                    repository_grant_plan: {
                        $ref: config.workspaces.repositoryGrants.schemas.grantPlanId,
                    },
                },
                required: ["repository_grant_plan"],
                type: "object",
            },
        ],
    ]);
    return {
        $id: config.workspaces.worldTaskCapture.journalSchemaId,
        $schema: config.kernel.schemas.dialect,
        allOf: [placedGrantDependency],
        oneOf: phaseSchemas.map(([phase, phaseFields]) => {
            const required = [
                "capture_id",
                "capture_phase",
                "journal_version",
                "run_id",
                ...phaseFields,
            ];
            return {
                additionalProperties: false,
                properties: Object.fromEntries(
                    required.map((key) => [
                        key,
                        key === "journal_version"
                            ? {
                                  const: config.workspaces.worldTaskCapture.journalVersion,
                                  type: "integer",
                              }
                            : key === "capture_phase"
                              ? { const: phase, type: "string" }
                              : key === "placement_resolution"
                                ? {
                                      oneOf: [
                                          { type: "null" },
                                          {
                                              $ref: config.workspaces.placements.schemas
                                                  .resolutionId,
                                          },
                                      ],
                                  }
                                : key === "placement_resolution_id"
                                  ? {
                                        oneOf: [
                                            { type: "null" },
                                            {
                                                pattern: `^${escapeRegularExpression(
                                                    config.workspaces.placements.resolutionIdPrefix,
                                                )}[0-9a-f]{${config.recordId.hexLength}}$`,
                                                type: "string",
                                            },
                                        ],
                                    }
                                  : key === "native_jail_resolution"
                                    ? {
                                          $ref: config.workspaces.placements.nativeJails.schemas
                                              .resolutionId,
                                      }
                                    : key === "native_jail_resolution_id"
                                      ? {
                                            pattern: digestPrefixPattern(
                                                config.workspaces.placements.nativeJails
                                                    .resolutionIdPrefix,
                                                config,
                                            ),
                                            type: "string",
                                        }
                                      : key === "repository_grant_plan"
                                        ? {
                                              oneOf: [
                                                  { type: "null" },
                                                  {
                                                      $ref: config.workspaces.repositoryGrants
                                                          .schemas.grantPlanId,
                                                  },
                                              ],
                                          }
                                        : key === "repository_grant_plan_id"
                                          ? {
                                                oneOf: [
                                                    { type: "null" },
                                                    {
                                                        pattern: `^${escapeRegularExpression(
                                                            config.workspaces.repositoryGrants
                                                                .planIdPrefix,
                                                        )}[0-9a-f]{${config.recordId.hexLength}}$`,
                                                        type: "string",
                                                    },
                                                ],
                                            }
                                          : [
                                                  "fencing_token",
                                                  "max_capture_id_bytes",
                                                  "max_text_bytes",
                                              ].includes(key)
                                            ? { minimum: 1, type: "integer" }
                                            : { minLength: 1, type: "string" },
                    ]),
                ),
                required,
                type: "object",
            };
        }),
    };
}

function renderPlacementPlatformEvidenceSchema(
    config: ProtocolConfig,
): Readonly<Record<string, unknown>> {
    const placement = config.workspaces.placements;
    return {
        $id: placement.schemas.platformEvidenceId,
        $schema: config.kernel.schemas.dialect,
        additionalProperties: false,
        properties: {
            compatibility_version: { const: placement.compatibilityVersion, type: "string" },
            environment: { enum: placement.platform.environments, type: "string" },
            family: { enum: placement.platform.families, type: "string" },
            node_platform: { minLength: 1, type: "string" },
            os_release: { minLength: 1, type: "string" },
            platform_id: {
                pattern: `^${escapeRegularExpression(placement.platform.evidenceIdPrefix)}[0-9a-f]{${config.recordId.hexLength}}$`,
                type: "string",
            },
            platform_version: { const: placement.platform.version, type: "integer" },
            wsl_markers: {
                items: { enum: placement.platform.wslEnvironmentVariables, type: "string" },
                type: "array",
                uniqueItems: true,
            },
        },
        required: [
            "compatibility_version",
            "environment",
            "family",
            "node_platform",
            "os_release",
            "platform_id",
            "platform_version",
            "wsl_markers",
        ],
        type: "object",
    };
}

function renderPlacementResolutionSchema(
    config: ProtocolConfig,
): Readonly<Record<string, unknown>> {
    const placement = config.workspaces.placements;
    const digestPattern = `^${escapeRegularExpression(config.tasks.digestPrefix)}[0-9a-f]{${config.tasks.hexLength}}$`;
    return {
        $id: placement.schemas.resolutionId,
        $schema: config.kernel.schemas.dialect,
        additionalProperties: false,
        allOf: [
            {
                oneOf: placement.rules
                    .filter((rule) => rule.supported && rule.resolved !== null)
                    .map((rule) => ({
                        properties: {
                            reason: { const: rule.reason },
                            requested_placement: { const: rule.request },
                            resolved_placement: { const: rule.resolved },
                            status: { const: rule.status },
                        },
                    })),
            },
        ],
        properties: {
            capture_id: { minLength: 1, type: "string" },
            compatibility_version: { const: placement.compatibilityVersion, type: "string" },
            enforcement: { const: placement.enforcement, type: "string" },
            placement_version: { const: placement.artifactVersion, type: "integer" },
            platform: { $ref: placement.schemas.platformEvidenceId },
            reason: { enum: placement.reasons, type: "string" },
            repository_grant_plan_id: {
                pattern: `^${escapeRegularExpression(
                    config.workspaces.repositoryGrants.planIdPrefix,
                )}[0-9a-f]{${config.recordId.hexLength}}$`,
                type: "string",
            },
            requested_placement: { enum: placement.requests, type: "string" },
            resolution_id: {
                pattern: `^${escapeRegularExpression(placement.resolutionIdPrefix)}[0-9a-f]{${config.recordId.hexLength}}$`,
                type: "string",
            },
            resolved_placement: { enum: placement.resolvedPlacements, type: "string" },
            run_id: { minLength: 1, type: "string" },
            runner_id: { minLength: 1, type: "string" },
            status: { enum: placement.statuses, type: "string" },
            task_artifact_digest: { pattern: digestPattern, type: "string" },
        },
        required: [
            "capture_id",
            "compatibility_version",
            "enforcement",
            "placement_version",
            "platform",
            "reason",
            "repository_grant_plan_id",
            "requested_placement",
            "resolution_id",
            "resolved_placement",
            "run_id",
            "runner_id",
            "status",
            "task_artifact_digest",
        ],
        type: "object",
    };
}

function renderNativeJailBackendSchema(config: ProtocolConfig): Readonly<Record<string, unknown>> {
    const jail = config.workspaces.placements.nativeJails;
    return {
        $id: jail.schemas.backendId,
        $schema: config.kernel.schemas.dialect,
        additionalProperties: false,
        properties: {
            backend_id: {
                pattern: digestPrefixPattern(jail.descriptorIdPrefix, config),
                type: "string",
            },
            backend_version: { const: jail.descriptorVersion, type: "integer" },
            compatibility_version: { const: jail.compatibilityVersion, type: "string" },
            enforcement: { const: jail.enforcement, type: "string" },
            environments: {
                items: { enum: config.workspaces.placements.platform.environments },
                type: "array",
                uniqueItems: true,
            },
            executable: { type: ["string", "null"] },
            family: { enum: config.workspaces.placements.platform.families, type: "string" },
            name: { enum: jail.backends.map(({ name }) => name), type: "string" },
            node_platforms: {
                items: { minLength: 1, type: "string" },
                minItems: 1,
                type: "array",
                uniqueItems: true,
            },
            profile_argument: { type: ["string", "null"] },
        },
        required: [
            "backend_id",
            "backend_version",
            "compatibility_version",
            "enforcement",
            "environments",
            "executable",
            "family",
            "name",
            "node_platforms",
            "profile_argument",
        ],
        type: "object",
    };
}

function renderNativeJailCommandSchema(config: ProtocolConfig): Readonly<Record<string, unknown>> {
    const jail = config.workspaces.placements.nativeJails;
    return {
        $id: jail.schemas.commandId,
        $schema: config.kernel.schemas.dialect,
        additionalProperties: false,
        properties: {
            arguments: { items: { type: "string" }, maxItems: jail.maxArguments, type: "array" },
            command_id: {
                pattern: digestPrefixPattern(jail.commandIdPrefix, config),
                type: "string",
            },
            command_version: { const: jail.commandVersion, type: "integer" },
            environment: {
                items: {
                    additionalProperties: false,
                    properties: {
                        name: { minLength: 1, type: "string" },
                        value: { type: "string" },
                    },
                    required: ["name", "value"],
                    type: "object",
                },
                maxItems: jail.maxEnvironmentEntries,
                type: "array",
            },
            executable: { minLength: 1, type: "string" },
        },
        required: ["arguments", "command_id", "command_version", "environment", "executable"],
        type: "object",
    };
}

function renderNativeJailProbeSchema(config: ProtocolConfig): Readonly<Record<string, unknown>> {
    const jail = config.workspaces.placements.nativeJails;
    return {
        $id: jail.schemas.probeId,
        $schema: config.kernel.schemas.dialect,
        additionalProperties: false,
        properties: {
            backend: { oneOf: [{ type: "null" }, { $ref: jail.schemas.backendId }] },
            compatibility_version: { const: jail.compatibilityVersion, type: "string" },
            denied_write: { type: "boolean" },
            enforcement: { const: jail.enforcement, type: "string" },
            granted_write: { type: "boolean" },
            helper_digest: { type: ["string", "null"] },
            platform: { $ref: config.workspaces.placements.schemas.platformEvidenceId },
            probe_id: { pattern: digestPrefixPattern(jail.probeIdPrefix, config), type: "string" },
            probe_version: { const: jail.probeVersion, type: "integer" },
            reason: { enum: jail.probeReasons, type: "string" },
            status: { enum: jail.probeStatuses, type: "string" },
        },
        required: [
            "backend",
            "compatibility_version",
            "denied_write",
            "enforcement",
            "granted_write",
            "helper_digest",
            "platform",
            "probe_id",
            "probe_version",
            "reason",
            "status",
        ],
        type: "object",
    };
}

function renderNativeJailPlanSchema(config: ProtocolConfig): Readonly<Record<string, unknown>> {
    const jail = config.workspaces.placements.nativeJails;
    return {
        $id: jail.schemas.planId,
        $schema: config.kernel.schemas.dialect,
        additionalProperties: false,
        properties: {
            backend_id: {
                pattern: digestPrefixPattern(jail.descriptorIdPrefix, config),
                type: "string",
            },
            command_id: {
                pattern: digestPrefixPattern(jail.commandIdPrefix, config),
                type: "string",
            },
            compatibility_version: { const: jail.compatibilityVersion, type: "string" },
            custody_root: { minLength: 1, type: "string" },
            enforcement: { const: jail.enforcement, type: "string" },
            plan_id: { pattern: digestPrefixPattern(jail.planIdPrefix, config), type: "string" },
            plan_version: { const: jail.planVersion, type: "integer" },
            probe_id: { pattern: digestPrefixPattern(jail.probeIdPrefix, config), type: "string" },
            profile_digest: { pattern: recordIdPattern(config), type: "string" },
            writable_roots: {
                items: { minLength: 1, type: "string" },
                type: "array",
                uniqueItems: true,
            },
        },
        required: [
            "backend_id",
            "command_id",
            "compatibility_version",
            "custody_root",
            "enforcement",
            "plan_id",
            "plan_version",
            "probe_id",
            "profile_digest",
            "writable_roots",
        ],
        type: "object",
    };
}

function renderNativeJailResolutionSchema(
    config: ProtocolConfig,
): Readonly<Record<string, unknown>> {
    const jail = config.workspaces.placements.nativeJails;
    return {
        $id: jail.schemas.resolutionId,
        $schema: config.kernel.schemas.dialect,
        additionalProperties: false,
        properties: {
            backend: { $ref: jail.schemas.backendId },
            backend_probe: { $ref: jail.schemas.probeId },
            capture_id: { minLength: 1, type: "string" },
            command: { $ref: jail.schemas.commandId },
            compatibility_version: { const: jail.compatibilityVersion, type: "string" },
            enforcement: { const: jail.enforcement, type: "string" },
            max_output_bytes: { maximum: jail.maxOutputBytes, minimum: 1, type: "integer" },
            placement_version: { const: jail.placementVersion, type: "integer" },
            reason: { enum: jail.placementReasons, type: "string" },
            repository_grant_plan_id: {
                pattern: digestPrefixPattern(
                    config.workspaces.repositoryGrants.planIdPrefix,
                    config,
                ),
                type: "string",
            },
            requested_placement: { enum: ["auto", "jail"], type: "string" },
            resolution_id: {
                pattern: digestPrefixPattern(jail.resolutionIdPrefix, config),
                type: "string",
            },
            resolved_placement: { const: jail.resolvedPlacement, type: "string" },
            run_id: { minLength: 1, type: "string" },
            runner_id: { minLength: 1, type: "string" },
            status: { const: jail.placementStatus, type: "string" },
            task_artifact_digest: {
                pattern: `^${escapeRegularExpression(config.tasks.digestPrefix)}[0-9a-f]{${config.tasks.hexLength}}$`,
                type: "string",
            },
            timeout_milliseconds: {
                maximum: jail.maxTimeoutMilliseconds,
                minimum: 1,
                type: "integer",
            },
        },
        required: [
            "backend",
            "backend_probe",
            "capture_id",
            "command",
            "compatibility_version",
            "enforcement",
            "max_output_bytes",
            "placement_version",
            "reason",
            "repository_grant_plan_id",
            "requested_placement",
            "resolution_id",
            "resolved_placement",
            "run_id",
            "runner_id",
            "status",
            "task_artifact_digest",
            "timeout_milliseconds",
        ],
        type: "object",
    };
}

function renderNativeJailProcessSchema(config: ProtocolConfig): Readonly<Record<string, unknown>> {
    const jail = config.workspaces.placements.nativeJails;
    const intent = {
        additionalProperties: false,
        properties: {
            command_id: {
                pattern: digestPrefixPattern(jail.commandIdPrefix, config),
                type: "string",
            },
            launch_id: {
                pattern: digestPrefixPattern(jail.process.launchIdPrefix, config),
                type: "string",
            },
            plan: { $ref: jail.schemas.planId },
            plan_id: { pattern: digestPrefixPattern(jail.planIdPrefix, config), type: "string" },
            runner_id: { minLength: 1, type: "string" },
        },
        required: ["command_id", "launch_id", "plan", "plan_id", "runner_id"],
        type: "object",
    };
    const started = {
        additionalProperties: false,
        properties: {
            launch_id: {
                pattern: digestPrefixPattern(jail.process.launchIdPrefix, config),
                type: "string",
            },
            process_id: { minimum: 1, type: "integer" },
            start_id: {
                pattern: digestPrefixPattern(jail.process.startIdPrefix, config),
                type: "string",
            },
        },
        required: ["launch_id", "process_id", "start_id"],
        type: "object",
    };
    const receiptFields = [
        "exit_code",
        "launch_id",
        "process_id",
        "quiescence",
        "receipt_id",
        "receipt_version",
        "signal",
        "status",
        "stderr_base64",
        "stderr_bytes",
        "stdout_base64",
        "stdout_bytes",
    ];
    const receipt = {
        additionalProperties: false,
        properties: {
            exit_code: { type: ["integer", "null"] },
            launch_id: {
                pattern: digestPrefixPattern(jail.process.launchIdPrefix, config),
                type: "string",
            },
            process_id: { type: ["integer", "null"] },
            quiescence: { enum: jail.process.quiescenceStatuses, type: "string" },
            receipt_id: {
                pattern: digestPrefixPattern(jail.process.receiptIdPrefix, config),
                type: "string",
            },
            receipt_version: { const: jail.process.receiptVersion, type: "integer" },
            signal: { type: ["string", "null"] },
            status: { enum: jail.process.statuses, type: "string" },
            stderr_base64: {
                maxLength: Math.ceil((jail.maxOutputBytes * 4) / 3) + 4,
                type: "string",
            },
            stderr_bytes: { maximum: jail.maxOutputBytes + 1, minimum: 0, type: "integer" },
            stdout_base64: {
                maxLength: Math.ceil((jail.maxOutputBytes * 4) / 3) + 4,
                type: "string",
            },
            stdout_bytes: { maximum: jail.maxOutputBytes + 1, minimum: 0, type: "integer" },
        },
        required: receiptFields,
        type: "object",
    };
    return {
        $id: jail.schemas.processId,
        $schema: config.kernel.schemas.dialect,
        oneOf: [intent, started, receipt],
    };
}

function digestPrefixPattern(prefix: string, config: ProtocolConfig): string {
    return `^${escapeRegularExpression(prefix)}[0-9a-f]{${config.recordId.hexLength}}$`;
}

function renderRepositoryTaskGrantSchema(
    config: ProtocolConfig,
): Readonly<Record<string, unknown>> {
    const grants = config.workspaces.repositoryGrants;
    return {
        $id: grants.schemas.taskGrantArtifactId,
        $schema: config.kernel.schemas.dialect,
        additionalProperties: false,
        properties: {
            compatibility_version: { const: grants.compatibilityVersion, type: "string" },
            grant_version: { const: grants.artifactVersion, type: "integer" },
            grants: {
                items: {
                    additionalProperties: false,
                    properties: {
                        binding: {
                            pattern: "^(?!\\s*$)(?!\\.{1,2}$)[^/\\\\\\u0000]+$",
                            type: "string",
                        },
                        profile: { enum: grants.profiles.map(({ name }) => name), type: "string" },
                    },
                    required: ["binding", "profile"],
                    type: "object",
                },
                minItems: 1,
                type: "array",
            },
            task_artifact_digest: {
                pattern: `^${escapeRegularExpression(config.tasks.digestPrefix)}[0-9a-f]{${config.tasks.hexLength}}$`,
                type: "string",
            },
        },
        required: ["compatibility_version", "grant_version", "grants", "task_artifact_digest"],
        type: "object",
    };
}

function renderRepositoryTaskGrantLockSchema(
    config: ProtocolConfig,
): Readonly<Record<string, unknown>> {
    const grants = config.workspaces.repositoryGrants;
    return {
        $id: grants.schemas.taskGrantArtifactLockId,
        $schema: config.kernel.schemas.dialect,
        additionalProperties: false,
        properties: {
            artifact_digest: { pattern: recordIdPattern(config), type: "string" },
            grant_version: { const: grants.artifactVersion, type: "integer" },
            task_artifact_digest: {
                pattern: `^${escapeRegularExpression(config.tasks.digestPrefix)}[0-9a-f]{${config.tasks.hexLength}}$`,
                type: "string",
            },
            task_grant_id: {
                pattern: `^${escapeRegularExpression(grants.taskGrantIdPrefix)}[0-9a-f]{${config.recordId.hexLength}}$`,
                type: "string",
            },
        },
        required: ["artifact_digest", "grant_version", "task_artifact_digest", "task_grant_id"],
        type: "object",
    };
}

function renderRepositoryGrantPlanSchema(
    config: ProtocolConfig,
): Readonly<Record<string, unknown>> {
    const grants = config.workspaces.repositoryGrants;
    const profiles = grants.profiles.map(({ name }) => name);
    return {
        $id: grants.schemas.grantPlanId,
        $schema: config.kernel.schemas.dialect,
        additionalProperties: false,
        properties: {
            authority_ceiling: { enum: profiles, type: "string" },
            enforcement: { const: grants.enforcement, type: "string" },
            grants: {
                items: {
                    additionalProperties: false,
                    properties: {
                        authority: {
                            items: { enum: grants.atoms, type: "string" },
                            type: "array",
                            uniqueItems: true,
                        },
                        binding_id: { pattern: recordIdPattern(config), type: "string" },
                        binding_name: {
                            pattern: "^(?!\\s*$)(?!\\.{1,2}$)[^/\\\\\\u0000]+$",
                            type: "string",
                        },
                        resource_id: { pattern: recordIdPattern(config), type: "string" },
                        task_profile: { enum: profiles, type: "string" },
                    },
                    required: [
                        "authority",
                        "binding_id",
                        "binding_name",
                        "resource_id",
                        "task_profile",
                    ],
                    type: "object",
                },
                minItems: 1,
                type: "array",
            },
            grant_plan_version: { const: grants.planVersion, type: "integer" },
            plan_id: {
                pattern: `^${escapeRegularExpression(grants.planIdPrefix)}[0-9a-f]{${config.recordId.hexLength}}$`,
                type: "string",
            },
            task_artifact_digest: {
                pattern: `^${escapeRegularExpression(config.tasks.digestPrefix)}[0-9a-f]{${config.tasks.hexLength}}$`,
                type: "string",
            },
            task_grant_artifact_digest: { pattern: recordIdPattern(config), type: "string" },
        },
        required: [
            "authority_ceiling",
            "enforcement",
            "grants",
            "grant_plan_version",
            "plan_id",
            "task_artifact_digest",
            "task_grant_artifact_digest",
        ],
        type: "object",
    };
}

function renderSelectionPublicationSchema(
    config: ProtocolConfig,
): Readonly<Record<string, unknown>> {
    const text = { minLength: 1, type: "string" } as const;
    const directoryNode = {
        additionalProperties: false,
        properties: {
            kind: { const: config.workspaces.carrier.entryKinds[0], type: "string" },
            mode: { minimum: 0, type: "integer" },
        },
        required: ["kind", "mode"],
        type: "object",
    };
    const fileNode = {
        additionalProperties: false,
        properties: {
            byte_length: { minimum: 0, type: "integer" },
            content_id: text,
            kind: { const: config.workspaces.carrier.entryKinds[1], type: "string" },
            mode: { minimum: 0, type: "integer" },
        },
        required: ["byte_length", "content_id", "kind", "mode"],
        type: "object",
    };
    const symlinkNode = {
        additionalProperties: false,
        properties: {
            kind: { const: config.workspaces.carrier.entryKinds[2], type: "string" },
            mode: { type: "null" },
            target: { type: "string" },
        },
        required: ["kind", "mode", "target"],
        type: "object",
    };
    const nullableNode = {
        anyOf: [
            { type: "null" },
            { $ref: "#/$defs/directoryNode" },
            { $ref: "#/$defs/fileNode" },
            { $ref: "#/$defs/symlinkNode" },
        ],
    };
    const change = {
        additionalProperties: false,
        properties: {
            after: nullableNode,
            before: nullableNode,
            operation: { enum: config.workspaces.changesets.operations, type: "string" },
            path: text,
        },
        required: ["after", "before", "operation", "path"],
        type: "object",
    };
    const planFields = [
        "action",
        "atomicity",
        "base_content_id",
        "base_revision_id",
        "binding_id",
        "capture_record_id",
        "changes",
        "changeset_id",
        "command_id",
        "custody_id",
        "descriptor_format",
        "execution_cut_id",
        "head_content_id",
        "head_revision_id",
        "operation_id",
        "output_id",
        "plan_version",
        "request_id",
        "run_id",
        "settlement_version",
        "staging_id",
        "user_basis_before",
    ];
    return {
        $defs: { change, directoryNode, fileNode, symlinkNode },
        $id: config.workspaces.selectionPublication.schemaId,
        $schema: config.kernel.schemas.dialect,
        oneOf: [
            {
                additionalProperties: false,
                properties: {
                    ...Object.fromEntries(planFields.map((field) => [field, text])),
                    action: {
                        enum: [
                            config.workspaces.settlement.actions[0],
                            config.workspaces.settlement.actions[2],
                        ],
                        type: "string",
                    },
                    atomicity: {
                        enum: config.workspaces.selectionPublication.atomicityKinds,
                        type: "string",
                    },
                    changes: {
                        items: { $ref: "#/$defs/change" },
                        maxItems: config.workspaces.selectionPublication.maxSteps,
                        type: "array",
                    },
                    descriptor_format: {
                        const: config.workspaces.selectionPublication.descriptorFormat,
                        type: "string",
                    },
                    plan_version: {
                        const: config.workspaces.selectionPublication.planVersion,
                        type: "integer",
                    },
                    settlement_version: {
                        const: config.workspaces.settlement.version,
                        type: "integer",
                    },
                },
                required: planFields,
                type: "object",
            },
            {
                additionalProperties: false,
                properties: {
                    change: { $ref: "#/$defs/change" },
                    ordinal: {
                        maximum: config.workspaces.selectionPublication.maxSteps - 1,
                        minimum: 0,
                        type: "integer",
                    },
                    plan_id: text,
                    previous_step_id: { anyOf: [{ type: "null" }, text] },
                    status: {
                        enum: config.workspaces.selectionPublication.stepStatuses,
                        type: "string",
                    },
                    step_version: {
                        const: config.workspaces.selectionPublication.stepVersion,
                        type: "integer",
                    },
                },
                required: [
                    "change",
                    "ordinal",
                    "plan_id",
                    "previous_step_id",
                    "status",
                    "step_version",
                ],
                type: "object",
            },
            {
                additionalProperties: false,
                properties: {
                    atomicity: {
                        enum: config.workspaces.selectionPublication.atomicityKinds,
                        type: "string",
                    },
                    final_step_id: { anyOf: [{ type: "null" }, text] },
                    head_content_id: text,
                    operation_id: text,
                    plan_id: text,
                    publication_version: {
                        const: config.workspaces.selectionPublication.publicationVersion,
                        type: "integer",
                    },
                    staging_id: text,
                    user_basis_after: text,
                    user_basis_before: text,
                },
                required: [
                    "atomicity",
                    "final_step_id",
                    "head_content_id",
                    "operation_id",
                    "plan_id",
                    "publication_version",
                    "staging_id",
                    "user_basis_after",
                    "user_basis_before",
                ],
                type: "object",
            },
            {
                additionalProperties: false,
                properties: {
                    change_ordinals: {
                        items: {
                            maximum: config.workspaces.selectionPublication.maxSteps - 1,
                            minimum: 0,
                            type: "integer",
                        },
                        maxItems: config.workspaces.selectionPublication.maxSteps,
                        type: "array",
                    },
                    plan_id: text,
                    schedule_kind: {
                        enum: config.workspaces.selectionPublication.scheduleKinds,
                        type: "string",
                    },
                    schedule_version: {
                        const: config.workspaces.selectionPublication.scheduleVersion,
                        type: "integer",
                    },
                },
                required: ["change_ordinals", "plan_id", "schedule_kind", "schedule_version"],
                type: "object",
            },
            {
                additionalProperties: false,
                properties: {
                    change: { $ref: "#/$defs/change" },
                    change_ordinal: {
                        maximum: config.workspaces.selectionPublication.maxSteps - 1,
                        minimum: 0,
                        type: "integer",
                    },
                    operation_ordinal: {
                        maximum: config.workspaces.selectionPublication.maxSteps - 1,
                        minimum: 0,
                        type: "integer",
                    },
                    plan_id: text,
                    previous_step_id: { anyOf: [{ type: "null" }, text] },
                    schedule_id: text,
                    status: {
                        enum: config.workspaces.selectionPublication.stepStatuses,
                        type: "string",
                    },
                    step_version: {
                        const: config.workspaces.selectionPublication.scheduledStepVersion,
                        type: "integer",
                    },
                },
                required: [
                    "change",
                    "change_ordinal",
                    "operation_ordinal",
                    "plan_id",
                    "previous_step_id",
                    "schedule_id",
                    "status",
                    "step_version",
                ],
                type: "object",
            },
            {
                additionalProperties: false,
                properties: {
                    atomicity: {
                        enum: config.workspaces.selectionPublication.atomicityKinds,
                        type: "string",
                    },
                    final_step_id: { anyOf: [{ type: "null" }, text] },
                    head_content_id: text,
                    operation_id: text,
                    plan_id: text,
                    publication_version: {
                        const: config.workspaces.selectionPublication.scheduledPublicationVersion,
                        type: "integer",
                    },
                    schedule_id: text,
                    staging_id: text,
                    user_basis_after: text,
                    user_basis_before: text,
                },
                required: [
                    "atomicity",
                    "final_step_id",
                    "head_content_id",
                    "operation_id",
                    "plan_id",
                    "publication_version",
                    "schedule_id",
                    "staging_id",
                    "user_basis_after",
                    "user_basis_before",
                ],
                type: "object",
            },
        ],
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
    const renderedWorldCarrierBackends = config.workspaces.carrierBackends.backends
        .map((backend) => JSON.stringify(backend))
        .join(", ");
    const renderedGitHeadKinds = config.workspaces.gitCustody.headKinds
        .map((kind) => JSON.stringify(kind))
        .join(", ");
    const renderedScopeKinds = config.scopes.kinds.map((kind) => JSON.stringify(kind)).join(", ");
    const renderedScopeStates = config.scopes.states
        .map((state) => JSON.stringify(state))
        .join(", ");
    const renderedScopeEvidenceKinds = config.scopes.evidenceKinds
        .map((kind) => `    ${JSON.stringify(kind)},`)
        .join("\n");
    const renderedScopeWorldCapabilities = config.scopes.worldCapabilities
        .map((capability) => JSON.stringify(capability))
        .join(", ");
    const renderedScopeAuthorityAtoms = config.scopes.authority.atoms
        .map((atom) => JSON.stringify(atom))
        .join(", ");
    const renderedScopeResourceKinds = config.scopes.authority.resourceKinds
        .map((kind) => JSON.stringify(kind))
        .join(", ");
    const renderedScopeCommandKinds = config.scopes.commandKinds
        .map((kind) => `    ${JSON.stringify(kind)},`)
        .join("\n");
    const renderedScopeForkPhases = config.scopes.forkPhases
        .map((phase) => JSON.stringify(phase))
        .join(", ");
    const renderedScopeMergePhases = config.scopes.mergePhases
        .map((phase) => JSON.stringify(phase))
        .join(", ");
    const renderedScopeDiscardPhases = config.scopes.discardPhases
        .map((phase) => JSON.stringify(phase))
        .join(", ");
    const renderedScopeCheckpointKinds = config.scopes.checkpoint.constituentKinds
        .map((kind) => `    ${JSON.stringify(kind)},`)
        .join("\n");
    const renderedScopeCheckpointStatuses = config.scopes.checkpoint.evidenceStatuses
        .map((status) => `    ${JSON.stringify(status)},`)
        .join("\n");
    const renderedWorldChangeOperations = config.workspaces.changesets.operations
        .map((operation) => JSON.stringify(operation))
        .join(", ");
    const renderedWorldPreviewClassifications =
        config.workspaces.changesetInspection.previewClassifications
            .map((classification) => JSON.stringify(classification))
            .join(", ");
    const renderedWorldMoveKinds = config.workspaces.changesetInspection.moveKinds
        .map((kind) => JSON.stringify(kind))
        .join(", ");
    const renderedRetainedWorldEnforcementKinds = config.workspaces.worldExecution.enforcementKinds
        .map((kind) => JSON.stringify(kind))
        .join(", ");
    const renderedRepositoryGrantAtoms = config.workspaces.repositoryGrants.atoms
        .map((atom) => JSON.stringify(atom))
        .join(", ");
    const renderedRepositoryGrantProfiles = config.workspaces.repositoryGrants.profiles
        .map((profile) => JSON.stringify(profile.name))
        .join(", ");
    const renderedPlacementRequests = config.workspaces.placements.requests
        .map((request) => JSON.stringify(request))
        .join(", ");
    const renderedResolvedPlacements = config.workspaces.placements.resolvedPlacements
        .map((placement) => JSON.stringify(placement))
        .join(", ");
    const renderedPlacementReasons = config.workspaces.placements.reasons
        .map((reason) => `    ${JSON.stringify(reason)},`)
        .join("\n");
    const renderedPlacementStatuses = config.workspaces.placements.statuses
        .map((status) => JSON.stringify(status))
        .join(", ");
    const renderedPlacementPlatformFamilies = config.workspaces.placements.platform.families
        .map((family) => JSON.stringify(family))
        .join(", ");
    const renderedPlacementEnvironments = config.workspaces.placements.platform.environments
        .map((environment) => JSON.stringify(environment))
        .join(", ");
    const renderedNativeJailBackends = config.workspaces.placements.nativeJails.backends
        .map(({ name }) => JSON.stringify(name))
        .join(", ");
    const renderedNativeJailProbeReasons = config.workspaces.placements.nativeJails.probeReasons
        .map((reason) => `    ${JSON.stringify(reason)},`)
        .join("\n");
    const renderedNativeJailProbeStatuses = config.workspaces.placements.nativeJails.probeStatuses
        .map((status) => JSON.stringify(status))
        .join(", ");
    const renderedNativeJailPlacementReasons =
        config.workspaces.placements.nativeJails.placementReasons
            .map((reason) => `    ${JSON.stringify(reason)},`)
            .join("\n");
    const renderedNativeJailProcessStatuses =
        config.workspaces.placements.nativeJails.process.statuses
            .map((status) => `    ${JSON.stringify(status)},`)
            .join("\n");
    const renderedNativeJailQuiescenceStatuses =
        config.workspaces.placements.nativeJails.process.quiescenceStatuses
            .map((status) => JSON.stringify(status))
            .join(", ");
    const renderedRetainedWorldOutputStatuses = config.workspaces.worldTaskCapture.statuses
        .map((status) => JSON.stringify(status))
        .join(", ");
    const renderedRetainedWorldJournalPhases = config.workspaces.worldTaskCapture.journalPhases
        .map((phase) => `    ${JSON.stringify(phase)}`)
        .join(",\n");
    const renderedRetainedWorldSettlementActions = config.workspaces.settlement.actions
        .map((action) => JSON.stringify(action))
        .join(", ");
    const renderedRetainedWorldApplicationConflictKinds =
        config.workspaces.settlement.application.conflictKinds
            .map((kind) => `    ${JSON.stringify(kind)},`)
            .join("\n");
    const renderedRetainedWorldApplicationReasons = config.workspaces.settlement.application.reasons
        .map((reason) => JSON.stringify(reason))
        .join(", ");
    const renderedRetainedWorldApplicationStatuses =
        config.workspaces.settlement.application.statuses
            .map((status) => JSON.stringify(status))
            .join(", ");
    const renderedRetainedWorldSettlementStates = config.workspaces.settlement.states
        .map((state) => `    ${JSON.stringify(state)}`)
        .join(",\n");
    const renderedSelectionAtomicityKinds = config.workspaces.selectionPublication.atomicityKinds
        .map((kind) => JSON.stringify(kind))
        .join(", ");
    const renderedSelectionStepStatuses = config.workspaces.selectionPublication.stepStatuses
        .map((status) => JSON.stringify(status))
        .join(", ");
    const renderedSelectionScheduleKinds = config.workspaces.selectionPublication.scheduleKinds
        .map((kind) => JSON.stringify(kind))
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

/** Configured retained-world text-preview classifications. @public */
export const WORLD_TEXT_PREVIEW_CLASSIFICATIONS = [${renderedWorldPreviewClassifications}] as const;

/** Configured retained-world text-preview encoding. @public */
export const WORLD_TEXT_PREVIEW_ENCODING = ${JSON.stringify(config.workspaces.changesetInspection.encoding)} as const;

/** Configured exact-content derived move classifications. @public */
export const WORLD_DERIVED_MOVE_KINDS = [${renderedWorldMoveKinds}] as const;

/** Configured Gitlink presentation discriminant. @public */
export const GITLINK_ENTRY_KIND = ${JSON.stringify(config.workspaces.changesetInspection.gitlinkEntryKind)} as const;

/** Configured Gitlink index mode. @public */
export const GITLINK_MODE = ${JSON.stringify(config.workspaces.changesetInspection.gitlinkMode)} as const;

/** Configured symbolic-link index mode. @public */
export const GIT_SYMLINK_MODE = ${JSON.stringify(config.workspaces.changesetInspection.symlinkMode)} as const;

/** Configured public resource bounds for changeset inspection. @public */
export const WORLD_CHANGESET_INSPECTION_LIMITS = {
    maxDerivedMoveCandidates: ${config.workspaces.changesetInspection.maxDerivedMoveCandidates},
    maxPageSize: ${config.workspaces.changesetInspection.maxPageSize},
    maxPathBytes: ${config.workspaces.changesets.maxPathBytes},
    maxPreviewBytes: ${config.workspaces.changesetInspection.maxPreviewBytes},
    maxPreviewLines: ${config.workspaces.changesetInspection.maxPreviewLines},
    maxReadBytes: ${config.workspaces.changesetInspection.maxReadBytes},
    maxVerificationConcurrency: ${config.workspaces.changesetInspection.maxVerificationConcurrency},
} as const;

/** Configured public output/trace/recovery selector and projection bounds. @public */
export const EVIDENCE_RECORD_LIMITS = {
    defaultPageSize: ${config.projections.evidenceRecords.defaultPageSize},
    maxCanonicalEntryBytes: ${config.projections.evidenceRecords.maxCanonicalEntryBytes},
    maxPageSize: ${config.projections.evidenceRecords.maxPageSize},
    maxSelectorBytes: ${config.projections.evidenceRecords.maxSelectorBytes},
} as const;

/** Configured canonical latest evidence-record read selector. @public */
export const EVIDENCE_RECORD_LATEST_SELECTOR = ${JSON.stringify(config.projections.evidenceRecords.latestSelector)} as const;

/** Configured orphaned-operation diagnosis and repair resource bounds. @public */
export const ORPHAN_REPAIR_LIMITS = {
    defaultPageSize: ${config.orphanRepair.limits.defaultPageSize},
    maxCanonicalBytes: ${config.orphanRepair.limits.maxCanonicalBytes},
    maxCauseBytes: ${config.orphanRepair.limits.maxCauseBytes},
    maxIdentifierBytes: ${config.orphanRepair.limits.maxIdentifierBytes},
    maxOperations: ${config.orphanRepair.limits.maxOperations},
    maxPageSize: ${config.orphanRepair.limits.maxPageSize},
} as const;

/** Configured stable blockers for bookkeeping-only orphan repair. @public */
export const ORPHAN_REPAIR_BLOCKERS = {
    liveSession: ${JSON.stringify(config.orphanRepair.blockers.liveSession)},
    providerStarted: ${JSON.stringify(config.orphanRepair.blockers.providerStarted)},
    scopeOwned: ${JSON.stringify(config.orphanRepair.blockers.scopeOwned)},
} as const;

/** Configured orphan-repair error codes. @public */
export const ORPHAN_REPAIR_ERROR_CODES = {
    blocked: ${JSON.stringify(config.orphanRepair.errors.blockedCode)},
    commandConflict: ${JSON.stringify(config.orphanRepair.errors.commandConflictCode)},
    corrupt: ${JSON.stringify(config.orphanRepair.errors.corruptCode)},
    stale: ${JSON.stringify(config.orphanRepair.errors.staleCode)},
    unsupported: ${JSON.stringify(config.orphanRepair.errors.unsupportedCode)},
} as const;

/** Configured session-liveness diagnosis statuses. @public */
export const ORPHAN_REPAIR_SESSION_STATUSES = {
    dead: ${JSON.stringify(config.orphanRepair.statuses.session.dead)},
    live: ${JSON.stringify(config.orphanRepair.statuses.session.live)},
} as const;

/** Configured fail-soft pre-run reclaim statuses. @public */
export const ORPHAN_REPAIR_PRE_RUN_STATUSES = {
    declined: ${JSON.stringify(config.orphanRepair.statuses.preRun.declined)},
    repaired: ${JSON.stringify(config.orphanRepair.statuses.preRun.repaired)},
} as const;

/** Configured orphan diagnosis, command, operation, and receipt versions. @public */
export const ORPHAN_REPAIR_VERSIONS = {
    command: ${config.orphanRepair.versions.command},
    diagnosis: ${config.orphanRepair.versions.diagnosis},
    operation: ${config.orphanRepair.versions.operation},
    receipt: ${config.orphanRepair.versions.receipt},
} as const;

/** Configured public task/run ledger selector and projection bounds. @public */
export const TASK_RUN_LEDGER_LIMITS = {
    defaultPageSize: ${config.projections.taskRunLedgers.defaultPageSize},
    maxCanonicalEntryBytes: ${config.projections.taskRunLedgers.maxCanonicalEntryBytes},
    maxPageSize: ${config.projections.taskRunLedgers.maxPageSize},
    maxSelectorBytes: ${config.projections.taskRunLedgers.maxSelectorBytes},
} as const;

/** Configured canonical latest read selector. @public */
export const TASK_RUN_LEDGER_LATEST_SELECTOR = ${JSON.stringify(config.projections.taskRunLedgers.latestSelector)} as const;

/** Configured public world-changeset error codes. @public */
export const WORLD_CHANGESET_ERROR_CODES = {
    invalid: ${JSON.stringify(config.workspaces.changesets.errors.invalidCode)},
    limit: ${JSON.stringify(config.workspaces.changesets.errors.limitCode)},
} as const;

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

/** Configured selectable world-carrier backends. @public */
export const WORLD_CARRIER_BACKENDS = [${renderedWorldCarrierBackends}] as const;

/** Configured retained-world runner enforcement classifications. @public */
export const RETAINED_WORLD_ENFORCEMENT_KINDS = [${renderedRetainedWorldEnforcementKinds}] as const;

/** Configured repository authority atoms. @public */
export const REPOSITORY_GRANT_ATOMS = [${renderedRepositoryGrantAtoms}] as const;

/** Configured whole-repository grant profiles. @public */
export const REPOSITORY_GRANT_PROFILES = [${renderedRepositoryGrantProfiles}] as const;

/** Configured requested placement vocabulary. @public */
export const PLACEMENT_REQUESTS = [${renderedPlacementRequests}] as const;

/** Configured effective placement vocabulary. @public */
export const RESOLVED_PLACEMENTS = [${renderedResolvedPlacements}] as const;

/** Configured placement-resolution reasons. @public */
export const PLACEMENT_RESOLUTION_REASONS = [
${renderedPlacementReasons}
] as const;

/** Configured placement resolved/refused statuses. @public */
export const PLACEMENT_RESOLUTION_STATUSES = [${renderedPlacementStatuses}] as const;

/** Configured platform-family classifications used by placement evidence. @public */
export const PLACEMENT_PLATFORM_FAMILIES = [${renderedPlacementPlatformFamilies}] as const;

/** Configured execution-environment classifications used by placement evidence. @public */
export const PLACEMENT_ENVIRONMENTS = [${renderedPlacementEnvironments}] as const;

/** Configured native syscall-jail backend names. @public */
export const NATIVE_JAIL_BACKENDS = [${renderedNativeJailBackends}] as const;

/** Configured native-jail backend probe reasons. @public */
export const NATIVE_JAIL_PROBE_REASONS = [
${renderedNativeJailProbeReasons}
] as const;

/** Configured native-jail backend probe statuses. @public */
export const NATIVE_JAIL_PROBE_STATUSES = [${renderedNativeJailProbeStatuses}] as const;

/** Configured successful native-jail placement reasons. @public */
export const NATIVE_JAIL_PLACEMENT_REASONS = [
${renderedNativeJailPlacementReasons}
] as const;

/** Configured native judged-process terminal statuses. @public */
export const NATIVE_JAIL_PROCESS_STATUSES = [
${renderedNativeJailProcessStatuses}
] as const;

/** Configured native process-group quiescence statuses. @public */
export const NATIVE_JAIL_QUIESCENCE_STATUSES = [${renderedNativeJailQuiescenceStatuses}] as const;

/** Configured durable retained-world output statuses. @public */
export const RETAINED_WORLD_OUTPUT_STATUSES = [${renderedRetainedWorldOutputStatuses}] as const;

/** Configured ordered durable retained-world capture-journal phases. @public */
export const RETAINED_WORLD_JOURNAL_PHASES = [
${renderedRetainedWorldJournalPhases},
] as const;

/** Configured consume-once retained-world settlement actions. @public */
export const RETAINED_WORLD_SETTLEMENT_ACTIONS = [${renderedRetainedWorldSettlementActions}] as const;

/** Configured retained-world application conflict classifications. @public */
export const RETAINED_WORLD_APPLICATION_CONFLICT_KINDS = [
${renderedRetainedWorldApplicationConflictKinds}
] as const;

/** Configured retained-world application plan reasons. @public */
export const RETAINED_WORLD_APPLICATION_REASONS = [${renderedRetainedWorldApplicationReasons}] as const;

/** Configured retained-world application plan statuses. @public */
export const RETAINED_WORLD_APPLICATION_STATUSES = [${renderedRetainedWorldApplicationStatuses}] as const;

/** Configured durable retained-world settlement states. @public */
export const RETAINED_WORLD_SETTLEMENT_STATES = [
${renderedRetainedWorldSettlementStates},
] as const;

/** Configured public retained-world settlement protocol version. @public */
export const RETAINED_WORLD_SETTLEMENT_VERSION = ${config.workspaces.settlement.version} as const;

/** Configured deterministic settlement-operation codec version. @public */
export const RETAINED_WORLD_SETTLEMENT_OPERATION_VERSION = ${config.workspaces.settlement.operationVersion} as const;

/** Configured deterministic settlement-receipt codec version. @public */
export const RETAINED_WORLD_SETTLEMENT_RECEIPT_VERSION = ${config.workspaces.settlement.receiptVersion} as const;

/** Configured receipt-only retained-world release receipt version. @public */
export const RETAINED_WORLD_RELEASE_RECEIPT_VERSION = ${config.workspaces.settlement.release.receiptVersion} as const;

/** Configured receipt-only retained-world release compatibility namespace. @public */
export const RETAINED_WORLD_RELEASE_COMPATIBILITY_VERSION =
    ${JSON.stringify(config.workspaces.settlement.release.compatibilityVersion)} as const;

/** Configured execution-trace settlement-citation version. @public */
export const RETAINED_WORLD_SETTLEMENT_CITATION_VERSION = ${config.workspaces.settlement.citationVersion} as const;

/** Configured retained-world selection publication atomicity classifications. @public */
export const RETAINED_WORLD_SELECTION_ATOMICITY_KINDS = [${renderedSelectionAtomicityKinds}] as const;

/** Configured retained-world selection path-step statuses. @public */
export const RETAINED_WORLD_SELECTION_STEP_STATUSES = [${renderedSelectionStepStatuses}] as const;

/** Configured retained-world selection dependency-schedule classifications. @public */
export const RETAINED_WORLD_SELECTION_SCHEDULE_KINDS = [${renderedSelectionScheduleKinds}] as const;

/** Configured retained-world selection publication protocol version. @public */
export const RETAINED_WORLD_SELECTION_PUBLICATION_VERSION = ${config.workspaces.selectionPublication.version} as const;

/** Configured retained-world selection plan codec version. @public */
export const RETAINED_WORLD_SELECTION_PLAN_VERSION = ${config.workspaces.selectionPublication.planVersion} as const;

/** Configured retained-world selection path-step codec version. @public */
export const RETAINED_WORLD_SELECTION_STEP_VERSION = ${config.workspaces.selectionPublication.stepVersion} as const;

/** Configured retained-world selection publication-receipt codec version. @public */
export const RETAINED_WORLD_SELECTION_RECEIPT_VERSION = ${config.workspaces.selectionPublication.publicationVersion} as const;

/** Configured retained-world selection dependency-schedule codec version. @public */
export const RETAINED_WORLD_SELECTION_SCHEDULE_VERSION = ${config.workspaces.selectionPublication.scheduleVersion} as const;

/** Configured dependency-scheduled path-step codec version. @public */
export const RETAINED_WORLD_SELECTION_SCHEDULED_STEP_VERSION = ${config.workspaces.selectionPublication.scheduledStepVersion} as const;

/** Configured dependency-scheduled terminal publication-receipt codec version. @public */
export const RETAINED_WORLD_SELECTION_SCHEDULED_RECEIPT_VERSION = ${config.workspaces.selectionPublication.scheduledPublicationVersion} as const;

/** Configured maximum path effects in one retained-world selection publication. @public */
export const RETAINED_WORLD_SELECTION_MAX_STEPS = ${config.workspaces.selectionPublication.maxSteps} as const;

/** Configured maximum UTF-8 bytes for one retained-world text operation. @public */
export const RETAINED_WORLD_MAX_TEXT_BYTES = ${config.workspaces.worldTaskCapture.maxTextBytes} as const;

/** Configured maximum UTF-8 bytes for one retained-world capture identity. @public */
export const RETAINED_WORLD_MAX_CAPTURE_ID_BYTES = ${config.workspaces.worldTaskCapture.maxCaptureIdBytes} as const;

/** Configured Git HEAD-state discriminants. @public */
export const GIT_HEAD_KINDS = [${renderedGitHeadKinds}] as const;

/** Configured scope kinds ordered root then child. @public */
export const SCOPE_KINDS = [${renderedScopeKinds}] as const;

/** Configured scope branch-lifecycle states ordered open, merged, discarded. @public */
export const SCOPE_STATES = [${renderedScopeStates}] as const;

/** Configured scope-local history evidence classifications. @public */
export const SCOPE_EVIDENCE_KINDS = [
${renderedScopeEvidenceKinds}
] as const;

/** Configured scope world-capability declarations. @public */
export const SCOPE_WORLD_CAPABILITIES = [${renderedScopeWorldCapabilities}] as const;

/** Configured scope authority atoms shared with repository grants. @public */
export const SCOPE_AUTHORITY_ATOMS = [${renderedScopeAuthorityAtoms}] as const;

/** Configured resource kinds that scope authority may cite. @public */
export const SCOPE_RESOURCE_KINDS = [${renderedScopeResourceKinds}] as const;

/** Configured scope command kinds ordered root registration, child registration, emission, fork, merge, discard. @public */
export const SCOPE_COMMAND_KINDS = [
${renderedScopeCommandKinds}
] as const;

/** Configured scope fork journal phases ordered prepared then completed. @public */
export const SCOPE_FORK_PHASES = [${renderedScopeForkPhases}] as const;

/** Configured scope merge journal phases ordered prepared then completed. @public */
export const SCOPE_MERGE_PHASES = [${renderedScopeMergePhases}] as const;

/** Configured scope discard journal phases ordered decided then cleaned. @public */
export const SCOPE_DISCARD_PHASES = [${renderedScopeDiscardPhases}] as const;

/** Configured scope checkpoint constituent kinds in classification order. @public */
export const SCOPE_CHECKPOINT_CONSTITUENT_KINDS = [
${renderedScopeCheckpointKinds}
] as const;

/** Configured scope checkpoint evidence statuses. @public */
export const SCOPE_CHECKPOINT_EVIDENCE_STATUSES = [
${renderedScopeCheckpointStatuses}
] as const;

/** Configured scope checkpoint descriptor version. @public */
export const SCOPE_CHECKPOINT_VERSION = ${config.scopes.checkpoint.version} as const;

/** Configured canonical scope record version. @public */
export const SCOPE_RECORD_VERSION = ${config.scopes.recordVersion} as const;

/** Configured scope evidence compatibility namespace. @public */
export const SCOPE_COMPATIBILITY_VERSION = ${JSON.stringify(config.scopes.compatibilityVersion)} as const;

/** Configured scope command resource bounds. @public */
export const SCOPE_LIMITS = Object.freeze({
    maxCitedRecords: ${config.scopes.limits.maxCitedRecords},
    maxContributions: ${config.scopes.limits.maxContributions},
    maxDataCanonicalBytes: ${config.scopes.limits.maxDataCanonicalBytes},
    maxDiscardScopes: ${config.scopes.limits.maxDiscardScopes},
    maxResources: ${config.scopes.limits.maxResources},
} as const);
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
