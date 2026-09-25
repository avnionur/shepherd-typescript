import { createHash } from "node:crypto";

import type { ProtocolConfig } from "../../../src/protocol/config-types.ts";

type Schema = Readonly<Record<string, unknown>>;

/**
 * Renders the configured application evaluation report JSON Schema: the report identity over the
 * canonical body, the report and compatibility versions, the evaluation identity and revision, the
 * configured metric order, one run per experiment (kind, application, manifest and protocol
 * identities, protocol version, seeds, dataset, measured manifest costs, and measured metrics), one
 * baseline per experiment (configured baseline kind, cited evidence, and measured metrics), one
 * comparison per experiment (application value, baseline value, and delta per metric), the rescue
 * counts (experiments whose baseline failed while the application passed), and the published
 * limitations. No wall-clock, host, or duration field is admitted.
 *
 * @param config - Validated protocol configuration.
 * @returns The configured closed evaluation report schema.
 */
export function renderApplicationEvaluationSchema(config: ProtocolConfig): Schema {
    const applications = config.applications;
    const evaluation = applications.evaluation;
    const limits = evaluation.limits;
    const [costMetric, callsMetric, inputMetric, outputMetric, stepsMetric, successMetric] =
        evaluation.metrics as readonly string[];
    const metricProperties = {
        [costMetric as string]: nullable({ type: "number", minimum: 0 }),
        [callsMetric as string]: count(),
        [inputMetric as string]: count(),
        [outputMetric as string]: count(),
        [stepsMetric as string]: count(),
        [successMetric as string]: { type: "boolean" },
    };
    const baselineKinds = [
        ...evaluation.supervisionBaselineKinds,
        ...applications.cro.baselineKinds,
        ...applications.compression.baselineKinds,
        ...applications.treeRl.baselineKinds,
    ];
    const experimentId = { type: "string", minLength: 1 };
    const experiments = (items: Schema): Schema => ({
        type: "array",
        minItems: 1,
        maxItems: limits.maxExperiments,
        items,
    });
    const value = { oneOf: [{ type: "null" }, { type: "number" }, { type: "boolean" }] };
    return {
        $schema: config.kernel.schemas.dialect,
        $id: applications.schemas.evaluationId,
        $comment: "Generated from protocol.config.json. Do not edit directly.",
        title: `Shepherd Application Evaluation Report v${evaluation.reportVersion}`,
        description:
            "Measured-only offline evaluation report: one run and one configured baseline per experiment with measured metrics, per-metric comparisons, rescue counts (baseline failed, application passed), and the published limitations. The report identity is the digest of the canonical report body without it; no wall-clock, host, node version, or duration field is admitted.",
        type: "object",
        required: [
            "baselines",
            "comparisons",
            "compatibility_version",
            "evaluation_id",
            "limitations",
            "metrics",
            "report_id",
            "report_version",
            "rescues",
            "revision",
            "runs",
        ],
        properties: {
            baselines: experiments({
                type: "object",
                required: ["evidence", "experiment_id", "kind", "metrics"],
                properties: {
                    evidence: {
                        type: "array",
                        items: { type: "string", minLength: 1 },
                        uniqueItems: true,
                    },
                    experiment_id: experimentId,
                    kind: { enum: baselineKinds },
                    metrics: { $ref: "#/$defs/metrics" },
                },
                additionalProperties: false,
            }),
            comparisons: experiments({
                type: "object",
                required: ["baseline_kind", "experiment_id", "values"],
                properties: {
                    baseline_kind: { enum: baselineKinds },
                    experiment_id: experimentId,
                    values: {
                        type: "array",
                        minItems: evaluation.metrics.length,
                        maxItems: evaluation.metrics.length,
                        items: {
                            type: "object",
                            required: ["application", "baseline", "delta", "metric"],
                            properties: {
                                application: value,
                                baseline: value,
                                delta: nullable({ type: "number" }),
                                metric: { enum: [...evaluation.metrics] },
                            },
                            additionalProperties: false,
                        },
                    },
                },
                additionalProperties: false,
            }),
            compatibility_version: { const: applications.compatibilityVersion },
            evaluation_id: { type: "string", minLength: 1 },
            limitations: {
                type: "array",
                minItems: 1,
                maxItems: limits.maxLimitations,
                items: {
                    type: "object",
                    required: ["id", "text"],
                    properties: {
                        id: { type: "string", minLength: 1 },
                        text: {
                            type: "string",
                            minLength: 1,
                            maxLength: limits.maxLimitationLength,
                        },
                    },
                    additionalProperties: false,
                },
            },
            metrics: { const: [...evaluation.metrics] },
            report_id: prefixed(applications.identity.reportIdPrefix, config),
            report_version: { const: evaluation.reportVersion },
            rescues: {
                type: "object",
                required: ["count", "experiment_ids"],
                properties: {
                    count: { type: "integer", minimum: 0, maximum: limits.maxExperiments },
                    experiment_ids: {
                        type: "array",
                        maxItems: limits.maxExperiments,
                        items: experimentId,
                        uniqueItems: true,
                    },
                },
                additionalProperties: false,
            },
            revision: { type: "string", minLength: 1 },
            runs: experiments({
                type: "object",
                required: [
                    "application_id",
                    "costs",
                    "dataset",
                    "experiment_id",
                    "kind",
                    "manifest_id",
                    "metrics",
                    "protocol_id",
                    "protocol_version",
                    "seeds",
                ],
                properties: {
                    application_id: prefixed(applications.identity.applicationIdPrefix, config),
                    costs: {
                        type: "object",
                        required: [
                            "cache_creation_input_tokens",
                            "cache_read_input_tokens",
                            "cost_usd",
                            "input_tokens",
                            "output_tokens",
                            "provider_calls",
                        ],
                        properties: {
                            cache_creation_input_tokens: count(),
                            cache_read_input_tokens: count(),
                            cost_usd: nullable({ type: "number", minimum: 0 }),
                            input_tokens: count(),
                            output_tokens: count(),
                            provider_calls: count(),
                        },
                        additionalProperties: false,
                    },
                    dataset: {
                        type: "object",
                        required: ["id", "items", "revision"],
                        properties: {
                            id: { type: "string", minLength: 1 },
                            items: {
                                type: "array",
                                maxItems: applications.limits.maxDatasetItems,
                                items: { type: "string", minLength: 1 },
                                uniqueItems: true,
                            },
                            revision: { type: "string", minLength: 1 },
                        },
                        additionalProperties: false,
                    },
                    experiment_id: experimentId,
                    kind: { enum: [...applications.kinds] },
                    manifest_id: prefixed(applications.identity.manifestIdPrefix, config),
                    metrics: { $ref: "#/$defs/metrics" },
                    protocol_id: prefixed(applications.identity.protocolIdPrefix, config),
                    protocol_version: { type: "string", minLength: 1 },
                    seeds: {
                        type: "array",
                        minItems: 1,
                        maxItems: applications.limits.maxSeeds,
                        items: { type: "integer" },
                        uniqueItems: true,
                    },
                },
                additionalProperties: false,
            }),
        },
        additionalProperties: false,
        $defs: {
            metrics: {
                type: "object",
                required: [...evaluation.metrics].sort(),
                properties: metricProperties,
                additionalProperties: false,
            },
        },
    };
}

function count(): Schema {
    return { type: "integer", minimum: 0 };
}

function nullable(schema: Schema): Schema {
    return { oneOf: [{ type: "null" }, schema] };
}

function prefixed(prefix: string, config: ProtocolConfig): Schema {
    const hexLength = createHash(config.applications.identity.digestAlgorithm).digest("hex").length;
    return {
        type: "string",
        pattern: `^${escapePattern(prefix)}[0-9a-f]{${hexLength}}$`,
    };
}

function escapePattern(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
