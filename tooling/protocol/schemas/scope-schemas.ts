import type { ProtocolConfig } from "../../../src/protocol/config-types.ts";

/**
 * Renders the configured scope registration record JSON Schema.
 *
 * @param config - Validated protocol configuration.
 * @returns The configured closed scope-registration schema.
 */
export function renderScopeRegistrationSchema(
    config: ProtocolConfig,
): Readonly<Record<string, unknown>> {
    return {
        $schema: config.kernel.schemas.dialect,
        $id: config.scopes.schemas.registrationId,
        $comment: "Generated from protocol.config.json. Do not edit directly.",
        title: `Shepherd Scope Registration v${config.scopes.recordVersion}`,
        description:
            "First retained record on one scope owner path binding ownership, origin, authority, and world capability.",
        type: "object",
        required: [
            "authority",
            "command_id",
            "compatibility_version",
            "execution_id",
            "kind",
            "parent",
            "scope_id",
            "scope_version",
            "world_capability",
        ],
        properties: {
            authority: {
                type: "object",
                required: ["ceiling", "effective"],
                properties: {
                    ceiling: { $ref: "#/$defs/resources" },
                    effective: { $ref: "#/$defs/resources" },
                },
                additionalProperties: false,
            },
            command_id: nonEmptyStringSchema(),
            compatibility_version: { const: config.scopes.compatibilityVersion },
            execution_id: { oneOf: [nonEmptyStringSchema(), { type: "null" }] },
            kind: { enum: [...config.scopes.kinds] },
            parent: {
                oneOf: [
                    { type: "null" },
                    {
                        type: "object",
                        required: [
                            "child_registered_record_id",
                            "origin_cut_id",
                            "origin_record_id",
                            "scope_id",
                        ],
                        properties: {
                            child_registered_record_id: { $ref: "#/$defs/recordId" },
                            origin_cut_id: { $ref: "#/$defs/originCutId" },
                            origin_record_id: { $ref: "#/$defs/recordId" },
                            scope_id: { $ref: "#/$defs/scopeId" },
                        },
                        additionalProperties: false,
                    },
                ],
            },
            scope_id: { $ref: "#/$defs/scopeId" },
            scope_version: { const: config.scopes.recordVersion },
            world_capability: { enum: [...config.scopes.worldCapabilities] },
        },
        additionalProperties: false,
        $defs: scopeDefinitions(config),
    };
}

/**
 * Renders the configured parent-owned child-registration control record JSON Schema.
 *
 * @param config - Validated protocol configuration.
 * @returns The configured closed child-registration schema.
 */
export function renderScopeChildRegisteredSchema(
    config: ProtocolConfig,
): Readonly<Record<string, unknown>> {
    return {
        $schema: config.kernel.schemas.dialect,
        $id: config.scopes.schemas.childRegisteredId,
        $comment: "Generated from protocol.config.json. Do not edit directly.",
        title: `Shepherd Scope Child Registered v${config.scopes.recordVersion}`,
        description:
            "Parent-owned control record retaining one exact child registration and its fork origin.",
        type: "object",
        required: [
            "child_scope_id",
            "command_id",
            "compatibility_version",
            "origin_cut_id",
            "origin_record_id",
            "parent_scope_id",
            "scope_version",
        ],
        properties: {
            child_scope_id: { $ref: "#/$defs/scopeId" },
            command_id: nonEmptyStringSchema(),
            compatibility_version: { const: config.scopes.compatibilityVersion },
            origin_cut_id: { $ref: "#/$defs/originCutId" },
            origin_record_id: { $ref: "#/$defs/recordId" },
            parent_scope_id: { $ref: "#/$defs/scopeId" },
            scope_version: { const: config.scopes.recordVersion },
        },
        additionalProperties: false,
        $defs: scopeDefinitions(config),
    };
}

/**
 * Renders the configured scope-local application-data emission JSON Schema.
 *
 * @param config - Validated protocol configuration.
 * @returns The configured closed scope-emission schema.
 */
export function renderScopeEmissionSchema(
    config: ProtocolConfig,
): Readonly<Record<string, unknown>> {
    return {
        $schema: config.kernel.schemas.dialect,
        $id: config.scopes.schemas.emissionId,
        $comment: "Generated from protocol.config.json. Do not edit directly.",
        title: `Shepherd Scope Emission v${config.scopes.recordVersion}`,
        description:
            "Scope-local validated application data emitted under one exact head and command identity.",
        type: "object",
        required: [
            "cited_record_ids",
            "command_id",
            "compatibility_version",
            "data",
            "expected_head_record_id",
            "scope_id",
            "scope_version",
        ],
        properties: {
            cited_record_ids: {
                type: "array",
                items: { $ref: "#/$defs/recordId" },
                maxItems: config.scopes.limits.maxCitedRecords,
                uniqueItems: true,
            },
            command_id: nonEmptyStringSchema(),
            compatibility_version: { const: config.scopes.compatibilityVersion },
            data: {
                type: "object",
                additionalProperties: { $ref: "#/$defs/semanticValue" },
                "x-shepherd-max-canonical-bytes": config.scopes.limits.maxDataCanonicalBytes,
            },
            expected_head_record_id: { $ref: "#/$defs/recordId" },
            scope_id: { $ref: "#/$defs/scopeId" },
            scope_version: { const: config.scopes.recordVersion },
        },
        additionalProperties: false,
        $defs: scopeDefinitions(config),
    };
}

/**
 * Renders the configured scope fork journal JSON Schema.
 *
 * @param config - Validated protocol configuration.
 * @returns The configured closed prepared/completed fork journal schema.
 */
export function renderScopeForkSchema(config: ProtocolConfig): Readonly<Record<string, unknown>> {
    const [preparedPhase, completedPhase] = config.scopes.forkPhases;
    const [, referenceCopyCapability] = config.scopes.worldCapabilities;
    const [verifiedStatus, , , unavailableStatus] = config.scopes.checkpoint.evidenceStatuses;
    const plainStatuses = config.scopes.checkpoint.evidenceStatuses.filter(
        (status) => status !== verifiedStatus && status !== unavailableStatus,
    );
    const common = {
        command_id: nonEmptyStringSchema(),
        compatibility_version: { const: config.scopes.compatibilityVersion },
        custody_id: {
            type: "string",
            pattern: prefixedDigestPattern(config.workspaces.carrier.custodyIdPrefix, config),
        },
        scope_id: { $ref: "#/$defs/scopeId" },
        scope_version: { const: config.scopes.recordVersion },
    };
    return {
        $schema: config.kernel.schemas.dialect,
        $id: config.scopes.schemas.forkId,
        $comment: "Generated from protocol.config.json. Do not edit directly.",
        title: `Shepherd Scope Fork v${config.scopes.recordVersion}`,
        description:
            "Durable reference-copy fork journal: a prepared declaration before physical custody and a completed record citing the verified custody and checkpoint.",
        oneOf: [
            {
                type: "object",
                required: [
                    "base_content_id",
                    "base_revision_id",
                    "binding_id",
                    "capture_kind",
                    "command_id",
                    "compatibility_version",
                    "custody_id",
                    "phase",
                    "resource_id",
                    "resource_kind",
                    "scope_id",
                    "scope_version",
                    "world_capability",
                ],
                properties: {
                    ...common,
                    base_content_id: {
                        type: "string",
                        pattern: prefixedDigestPattern(
                            config.workspaces.carrier.worldContentIdPrefix,
                            config,
                        ),
                    },
                    base_revision_id: {
                        type: "string",
                        pattern: prefixedDigestPattern(
                            config.workspaces.carrier.revisionIdPrefix,
                            config,
                        ),
                    },
                    binding_id: { $ref: "#/$defs/recordId" },
                    capture_kind: { const: config.workspaces.carrier.captureKind },
                    phase: { const: preparedPhase },
                    resource_id: { $ref: "#/$defs/recordId" },
                    resource_kind: { enum: [...config.scopes.authority.resourceKinds] },
                    world_capability: { const: referenceCopyCapability },
                },
                additionalProperties: false,
            },
            {
                type: "object",
                required: [
                    "checkpoint",
                    "command_id",
                    "compatibility_version",
                    "custody_content_id",
                    "custody_id",
                    "phase",
                    "scope_id",
                    "scope_version",
                ],
                properties: {
                    ...common,
                    checkpoint: {
                        type: "object",
                        required: ["capture_kind", "checkpoint_version", "constituents"],
                        properties: {
                            capture_kind: { const: config.workspaces.carrier.captureKind },
                            checkpoint_version: { const: config.scopes.checkpoint.version },
                            constituents: {
                                type: "array",
                                prefixItems: config.scopes.checkpoint.constituentKinds.map(
                                    (kind) => ({
                                        oneOf: [
                                            {
                                                type: "object",
                                                required: ["kind", "receipt_id", "status"],
                                                properties: {
                                                    kind: { const: kind },
                                                    receipt_id: nonEmptyStringSchema(),
                                                    status: { const: verifiedStatus },
                                                },
                                                additionalProperties: false,
                                            },
                                            {
                                                type: "object",
                                                required: ["kind", "reason", "status"],
                                                properties: {
                                                    kind: { const: kind },
                                                    reason: nonEmptyStringSchema(),
                                                    status: { const: unavailableStatus },
                                                },
                                                additionalProperties: false,
                                            },
                                            {
                                                type: "object",
                                                required: ["kind", "status"],
                                                properties: {
                                                    kind: { const: kind },
                                                    status: { enum: plainStatuses },
                                                },
                                                additionalProperties: false,
                                            },
                                        ],
                                    }),
                                ),
                                minItems: config.scopes.checkpoint.constituentKinds.length,
                                maxItems: config.scopes.checkpoint.constituentKinds.length,
                            },
                        },
                        additionalProperties: false,
                    },
                    custody_content_id: {
                        type: "string",
                        pattern: prefixedDigestPattern(
                            config.workspaces.carrier.worldContentIdPrefix,
                            config,
                        ),
                    },
                    phase: { const: completedPhase },
                },
                additionalProperties: false,
            },
        ],
        $defs: scopeDefinitions(config),
    };
}

/**
 * Renders the configured scope merge journal JSON Schema.
 *
 * @param config - Validated protocol configuration.
 * @returns The configured closed prepared/completed child-side merge journal schema.
 */
export function renderScopeMergeSchema(config: ProtocolConfig): Readonly<Record<string, unknown>> {
    const [preparedPhase, completedPhase] = config.scopes.mergePhases;
    const carrier = config.workspaces.carrier;
    const revisionId = {
        type: "string",
        pattern: prefixedDigestPattern(carrier.revisionIdPrefix, config),
    };
    const contentId = {
        type: "string",
        pattern: prefixedDigestPattern(carrier.worldContentIdPrefix, config),
    };
    const custodyId = {
        type: "string",
        pattern: prefixedDigestPattern(carrier.custodyIdPrefix, config),
    };
    const common = {
        command_id: nonEmptyStringSchema(),
        compatibility_version: { const: config.scopes.compatibilityVersion },
        parent_scope_id: { $ref: "#/$defs/scopeId" },
        scope_id: { $ref: "#/$defs/scopeId" },
        scope_version: { const: config.scopes.recordVersion },
    };
    return {
        $schema: config.kernel.schemas.dialect,
        $id: config.scopes.schemas.mergeId,
        $comment: "Generated from protocol.config.json. Do not edit directly.",
        title: `Shepherd Scope Merge v${config.scopes.recordVersion}`,
        description:
            "Consume-once child-side merge journal: a prepared reservation citing the fixed child cut, three-way world plan, and selected contributions, then a completed seal citing the verified parent publication.",
        oneOf: [
            {
                type: "object",
                required: [
                    "child_head_record_id",
                    "command_id",
                    "compatibility_version",
                    "contributions",
                    "merge_cut_id",
                    "parent_head_record_id",
                    "parent_scope_id",
                    "phase",
                    "scope_id",
                    "scope_version",
                    "world",
                ],
                properties: {
                    ...common,
                    child_head_record_id: { $ref: "#/$defs/recordId" },
                    contributions: { $ref: "#/$defs/contributions" },
                    merge_cut_id: { $ref: "#/$defs/mergeCutId" },
                    parent_head_record_id: { $ref: "#/$defs/recordId" },
                    phase: { const: preparedPhase },
                    world: {
                        oneOf: [
                            { type: "null" },
                            {
                                type: "object",
                                required: [
                                    "application_custody_id",
                                    "binding_id",
                                    "child_content_id",
                                    "child_revision_id",
                                    "merged_content_id",
                                    "merged_revision_id",
                                    "origin_content_id",
                                    "origin_revision_id",
                                    "parent_content_id",
                                    "parent_custody_id",
                                    "parent_revision_id",
                                ],
                                properties: {
                                    application_custody_id: {
                                        oneOf: [custodyId, { type: "null" }],
                                    },
                                    binding_id: { $ref: "#/$defs/recordId" },
                                    child_content_id: contentId,
                                    child_revision_id: revisionId,
                                    merged_content_id: contentId,
                                    merged_revision_id: revisionId,
                                    origin_content_id: contentId,
                                    origin_revision_id: revisionId,
                                    parent_content_id: contentId,
                                    parent_custody_id: custodyId,
                                    parent_revision_id: revisionId,
                                },
                                additionalProperties: false,
                            },
                        ],
                    },
                },
                additionalProperties: false,
            },
            {
                type: "object",
                required: [
                    "command_id",
                    "compatibility_version",
                    "parent_scope_id",
                    "phase",
                    "publication_revision_id",
                    "scope_id",
                    "scope_version",
                ],
                properties: {
                    ...common,
                    phase: { const: completedPhase },
                    publication_revision_id: { oneOf: [revisionId, { type: "null" }] },
                },
                additionalProperties: false,
            },
        ],
        $defs: scopeDefinitions(config),
    };
}

/**
 * Renders the configured parent-side child-merge integration JSON Schema.
 *
 * @param config - Validated protocol configuration.
 * @returns The configured closed child-merged schema.
 */
export function renderScopeChildMergedSchema(
    config: ProtocolConfig,
): Readonly<Record<string, unknown>> {
    const carrier = config.workspaces.carrier;
    return {
        $schema: config.kernel.schemas.dialect,
        $id: config.scopes.schemas.childMergedId,
        $comment: "Generated from protocol.config.json. Do not edit directly.",
        title: `Shepherd Scope Child Merged v${config.scopes.recordVersion}`,
        description:
            "Parent-owned integration of one consumed child: the fixed child cut, its checkpoint, the selected contributions added to parent history, and the verified parent-managed world publication.",
        type: "object",
        required: [
            "child_checkpoint_record_id",
            "child_cut_id",
            "child_scope_id",
            "command_id",
            "compatibility_version",
            "contributions",
            "merged_content_id",
            "parent_scope_id",
            "publication_revision_id",
            "scope_version",
        ],
        properties: {
            child_checkpoint_record_id: {
                oneOf: [{ $ref: "#/$defs/recordId" }, { type: "null" }],
            },
            child_cut_id: { $ref: "#/$defs/mergeCutId" },
            child_scope_id: { $ref: "#/$defs/scopeId" },
            command_id: nonEmptyStringSchema(),
            compatibility_version: { const: config.scopes.compatibilityVersion },
            contributions: { $ref: "#/$defs/contributions" },
            merged_content_id: {
                oneOf: [
                    {
                        type: "string",
                        pattern: prefixedDigestPattern(carrier.worldContentIdPrefix, config),
                    },
                    { type: "null" },
                ],
            },
            parent_scope_id: { $ref: "#/$defs/scopeId" },
            publication_revision_id: {
                oneOf: [
                    {
                        type: "string",
                        pattern: prefixedDigestPattern(carrier.revisionIdPrefix, config),
                    },
                    { type: "null" },
                ],
            },
            scope_version: { const: config.scopes.recordVersion },
        },
        additionalProperties: false,
        $defs: scopeDefinitions(config),
    };
}

/**
 * Renders the configured scope discard journal JSON Schema.
 *
 * @param config - Validated protocol configuration.
 * @returns The configured closed decided/cleaned discard journal schema.
 */
export function renderScopeDiscardSchema(
    config: ProtocolConfig,
): Readonly<Record<string, unknown>> {
    const [decidedPhase, cleanedPhase] = config.scopes.discardPhases;
    const custodyIds = {
        type: "array",
        items: {
            type: "string",
            pattern: prefixedDigestPattern(config.workspaces.carrier.custodyIdPrefix, config),
        },
        uniqueItems: true,
    };
    const common = {
        command_id: nonEmptyStringSchema(),
        compatibility_version: { const: config.scopes.compatibilityVersion },
        custody_ids: custodyIds,
        scope_id: { $ref: "#/$defs/scopeId" },
        scope_version: { const: config.scopes.recordVersion },
    };
    return {
        $schema: config.kernel.schemas.dialect,
        $id: config.scopes.schemas.discardId,
        $comment: "Generated from protocol.config.json. Do not edit directly.",
        title: `Shepherd Scope Discard v${config.scopes.recordVersion}`,
        description:
            "Scope discard journal: a logical decision sealing each open scope of an owned subtree, then cleanup progress naming the exact proven-owned custody identities removed.",
        oneOf: [
            {
                type: "object",
                required: [
                    "command_id",
                    "compatibility_version",
                    "custody_ids",
                    "discard_scope_id",
                    "parent_scope_id",
                    "phase",
                    "scope_id",
                    "scope_version",
                    "sealed_scope_ids",
                ],
                properties: {
                    ...common,
                    discard_scope_id: { $ref: "#/$defs/scopeId" },
                    parent_scope_id: { $ref: "#/$defs/scopeId" },
                    phase: { const: decidedPhase },
                    sealed_scope_ids: {
                        type: "array",
                        items: { $ref: "#/$defs/scopeId" },
                        maxItems: config.scopes.limits.maxDiscardScopes,
                        uniqueItems: true,
                    },
                },
                additionalProperties: false,
            },
            {
                type: "object",
                required: [
                    "command_id",
                    "compatibility_version",
                    "custody_ids",
                    "phase",
                    "scope_id",
                    "scope_version",
                ],
                properties: {
                    ...common,
                    phase: { const: cleanedPhase },
                },
                additionalProperties: false,
            },
        ],
        $defs: scopeDefinitions(config),
    };
}

function scopeDefinitions(config: ProtocolConfig): Readonly<Record<string, unknown>> {
    return {
        contributions: {
            type: "array",
            items: {
                type: "object",
                required: ["owner_id", "owner_ordinal", "record_id"],
                properties: {
                    owner_id: { $ref: "#/$defs/scopeId" },
                    owner_ordinal: { type: "integer", minimum: 0 },
                    record_id: { $ref: "#/$defs/recordId" },
                },
                additionalProperties: false,
            },
            maxItems: config.scopes.limits.maxContributions,
        },
        mergeCutId: {
            type: "string",
            pattern: prefixedDigestPattern(config.scopes.identity.mergeCutIdPrefix, config),
        },
        originCutId: {
            type: "string",
            pattern: prefixedDigestPattern(config.scopes.identity.originCutIdPrefix, config),
        },
        recordId: {
            type: "string",
            pattern: prefixedDigestPattern(config.recordId.prefix, config),
        },
        resources: {
            type: "array",
            items: {
                type: "object",
                required: ["atoms", "resource_id", "resource_kind"],
                properties: {
                    atoms: {
                        type: "array",
                        items: { enum: [...config.scopes.authority.atoms] },
                        maxItems: config.scopes.authority.atoms.length,
                        uniqueItems: true,
                    },
                    resource_id: nonEmptyStringSchema(),
                    resource_kind: { enum: [...config.scopes.authority.resourceKinds] },
                },
                additionalProperties: false,
            },
            maxItems: config.scopes.limits.maxResources,
        },
        scopeId: {
            type: "string",
            pattern: prefixedDigestPattern(config.scopes.identity.scopeIdPrefix, config),
        },
        semanticValue: {
            anyOf: [
                { type: "boolean" },
                { type: "null" },
                { type: "number" },
                { type: "string" },
                { type: "array", items: { $ref: "#/$defs/semanticValue" } },
                { type: "object", additionalProperties: { $ref: "#/$defs/semanticValue" } },
            ],
        },
    };
}

function prefixedDigestPattern(prefix: string, config: ProtocolConfig): string {
    return `^${prefix.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}[0-9a-f]{${config.recordId.hexLength}}$`;
}

function nonEmptyStringSchema(): Readonly<Record<string, unknown>> {
    return { type: "string", minLength: 1 };
}
