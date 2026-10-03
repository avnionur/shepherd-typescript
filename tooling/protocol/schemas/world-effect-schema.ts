import type { ProtocolConfig } from "../../../src/protocol/config-types.ts";
import { renderEffectIntentSchema, renderEffectOutcomeSchema } from "./effect-protocol-schemas.ts";

type Schema = Readonly<Record<string, unknown>>;

/**
 * Renders the closed retained-world operation journal with bounded, plaintext-free evidence.
 * @param config - Validated repository protocol configuration.
 * @returns A schema for opened, intent, admission and correlated outcome records.
 */
export function renderWorldEffectSchema(config: ProtocolConfig): Schema {
    const capture = config.workspaces.worldTaskCapture;
    const operation = capture.operationJournal;
    const [opened, intentPhase, admitted, outcomePhase] = operation.phases;
    const [succeeded, ...failures] = operation.outcomes;
    const recordId = {
        type: "string",
        pattern: `^${escapeRegularExpression(config.recordId.prefix)}[0-9a-f]{${config.recordId.hexLength}}$`,
    };
    const effectId = {
        type: "string",
        pattern: `^${escapeRegularExpression(operation.effectIdPrefix)}[0-9a-f]{${config.recordId.hexLength}}$`,
    };
    const text = { type: "string", minLength: 1 };
    const integer = { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
    const intent = { ...renderEffectIntentSchema(config) };
    const outcome = { ...renderEffectOutcomeSchema(config) };
    const definitions = intent.$defs as Readonly<Record<string, unknown>>;
    for (const schema of [intent, outcome]) {
        delete schema.$id;
        delete schema.$defs;
    }
    intent.properties = {
        ...(intent.properties as Schema),
        effect_id: effectId,
        kind: { enum: Object.values(operation.kinds) },
        reversibility: { const: config.effects.reversibilityTiers[0] },
        payload: closed({
            authority_record_id: recordId,
            content: { oneOf: [{ type: "null" }, { $ref: "#/$defs/contentEvidence" }] },
            path: { $ref: "#/$defs/pathEvidence" },
            required_atom: { enum: Object.values(config.workspaces.repositoryGrants.operations) },
        }),
    };
    outcome.properties = {
        ...(outcome.properties as Schema),
        effect_id: effectId,
        kind: { enum: Object.values(operation.kinds) },
        result: {
            oneOf: [
                closed({
                    ok: { const: true },
                    value: closed({
                        status: { const: succeeded },
                        result: { oneOf: [{ type: "null" }, { $ref: "#/$defs/contentEvidence" }] },
                    }),
                }),
                closed({ ok: { const: false }, error: closed({ status: { enum: failures } }) }),
            ],
        },
    };
    const common = {
        capture_id: { ...text, "x-shepherd-max-utf8-bytes": capture.maxCaptureIdBytes },
        compatibility_version: { const: operation.compatibilityVersion },
        run_id: text,
        world_effect_version: { const: operation.version },
    };
    return {
        $schema: config.kernel.schemas.dialect,
        $id: operation.schemaId,
        $comment: "Generated from protocol.config.json. Do not edit directly.",
        title: `Shepherd World Effect Journal v${operation.version}`,
        oneOf: [
            closed({
                ...common,
                phase: { const: opened },
                authority: closed({
                    authority: {
                        type: "array",
                        items: { enum: config.workspaces.repositoryGrants.atoms },
                        uniqueItems: true,
                        maxItems: config.workspaces.repositoryGrants.atoms.length,
                    },
                    base_revision_id: text,
                    binding_id: text,
                    claim_id: text,
                    content_policy: { const: operation.contentPolicy },
                    custody_id: text,
                    enforcement: { enum: config.workspaces.worldExecution.enforcementKinds },
                    fencing_token: { ...integer, minimum: 1 },
                    grant_plan_id: { oneOf: [text, { type: "null" }] },
                    resource_id: { oneOf: [text, { type: "null" }] },
                }),
            }),
            closed({
                ...common,
                phase: { const: intentPhase },
                index: integer,
                effect: { $ref: "#/$defs/effectIntent" },
            }),
            closed({ ...common, phase: { const: admitted }, index: integer, effect_id: effectId }),
            closed({
                ...common,
                phase: { const: outcomePhase },
                index: integer,
                effect: { $ref: "#/$defs/effectOutcome" },
            }),
        ],
        $defs: {
            ...definitions,
            effectIntent: intent,
            effectOutcome: outcome,
            contentEvidence: evidence(capture.maxTextBytes, recordId),
            pathEvidence: evidence(operation.maxPathEvidenceBytes, recordId),
        },
    };
}

function closed(properties: Schema): Schema {
    return {
        type: "object",
        required: Object.keys(properties).sort(),
        properties,
        additionalProperties: false,
    };
}

function evidence(bound: number, digest: Schema): Schema {
    return {
        oneOf: [
            closed({
                byte_length: { type: "null" },
                digest: { type: "null" },
                valid_text: { const: false },
                within_bound: { const: false },
            }),
            closed({
                byte_length: { type: "integer", minimum: 0, maximum: bound },
                digest,
                valid_text: { const: true },
                within_bound: { const: true },
            }),
            closed({
                byte_length: { type: "integer", minimum: 0, maximum: bound },
                digest: { type: "null" },
                valid_text: { const: false },
                within_bound: { const: true },
            }),
            closed({
                byte_length: {
                    type: "integer",
                    minimum: bound + 1,
                    maximum: Number.MAX_SAFE_INTEGER,
                },
                digest: { type: "null" },
                valid_text: { type: "boolean" },
                within_bound: { const: false },
            }),
        ],
    };
}

function escapeRegularExpression(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
