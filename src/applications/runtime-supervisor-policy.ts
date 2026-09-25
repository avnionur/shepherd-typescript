import { canonicalizeSemanticValue, type SemanticRecord } from "../canonical/canonical-record.ts";
import { applicationsProtocolConfig, providerProtocolConfig } from "../protocol/config.ts";
import {
    APPLICATION_KINDS,
    APPLICATION_PROTOCOL_SURFACES,
    MODEL_CONTENT_BLOCK_TYPES,
    MODEL_MESSAGE_ROLES,
} from "../protocol/values.generated.ts";
import { readModelConversationResponse } from "../provider/messages.ts";
import { readScopeDataObject } from "../scope/validation.ts";
import { ApplicationProtocolError } from "./errors.ts";
import { readApplicationProtocol } from "./manifest.ts";
import {
    type ApplicationSchemaSurface,
    compileApplicationSchemaSurfaces,
} from "./protocol-schemas.ts";
import type {
    ModelRuntimeSupervisorPolicyOptions,
    RuntimeSupervisorPolicy,
    RuntimeSupervisorPolicyResult,
} from "./runtime-supervisor-types.ts";
import type { ApplicationProtocolDefinition } from "./types.ts";

const config = applicationsProtocolConfig;
const runtime = config.runtimeSupervision;
const [CODING_SUPERVISOR_KIND] = APPLICATION_KINDS;
const [PROMPT_KIND, SCHEMA_KIND] = APPLICATION_PROTOCOL_SURFACES;
const [USER_ROLE] = MODEL_MESSAGE_ROLES;
const [TEXT_BLOCK] = MODEL_CONTENT_BLOCK_TYPES;

/** Budgets of a validated runtime supervision protocol, keyed by configured meaning. @internal */
export type RuntimeSupervisionBudgets = {
    readonly [Key in keyof typeof runtime.budgetKeys]: number;
};

/** Validated runtime supervision protocol with its compiled schema surfaces. @internal */
export type RuntimeSupervisionProtocol = {
    /** Compiled decision schema surfaces. */
    readonly action: readonly ApplicationSchemaSurface[];
    /** System prompt of a model-serviced policy. */
    readonly actionPrompt: string;
    /** Decision JSON Schema sent as the output schema of a model-serviced policy. */
    readonly actionSchema: SemanticRecord;
    /** Budgets by configured meaning. */
    readonly budgets: RuntimeSupervisionBudgets;
    /** Validated definition. */
    readonly definition: ApplicationProtocolDefinition;
    /** Compiled snapshot schema surfaces. */
    readonly observation: readonly ApplicationSchemaSurface[];
    /** Snapshot preamble of a model-serviced policy. */
    readonly observationPrompt: string;
};

/**
 * Validates one runtime supervision protocol: a `coding_supervisor` definition with exactly one
 * prompt and one schema surface for each configured role and every configured budget, the tick
 * count and cadence within the configured limits and the worker turn bound within the tool-use
 * loop's bound.
 *
 * @throws {ApplicationProtocolError} If the definition is malformed or lacks a surface or budget.
 * @internal
 */
export function readRuntimeSupervisionProtocol(value: unknown): RuntimeSupervisionProtocol {
    const definition = readApplicationProtocol(value);
    if (definition.kind !== CODING_SUPERVISOR_KIND) {
        throw new ApplicationProtocolError(`kind must be ${CODING_SUPERVISOR_KIND}`);
    }
    const surface = (kind: string, role: string) => {
        const matching = definition.surfaces.filter(
            (candidate) => candidate.kind === kind && candidate.role === role,
        );
        if (matching.length !== 1) {
            throw new ApplicationProtocolError(
                `exactly one ${kind} surface with role ${role} is required`,
            );
        }
        return (matching[0] as (typeof matching)[number]).content;
    };
    const { action, observation } = runtime.surfaceRoles;
    const actionPrompt = surface(PROMPT_KIND, action);
    const observationPrompt = surface(PROMPT_KIND, observation);
    const actionSchema = surface(SCHEMA_KIND, action);
    surface(SCHEMA_KIND, observation);
    if (typeof actionPrompt !== "string" || typeof observationPrompt !== "string") {
        throw new ApplicationProtocolError("prompt surfaces must be text");
    }
    const budgets = Object.fromEntries(
        Object.entries(runtime.budgetKeys).map(([meaning, key]) => {
            const budget = definition.budgets[key];
            if (budget === undefined) {
                throw new ApplicationProtocolError(`budgets must declare ${key}`);
            }
            if (budget < 1 && key !== runtime.budgetKeys.tickInterval) {
                throw new ApplicationProtocolError(`${key} must be positive`);
            }
            return [meaning, budget];
        }),
    ) as RuntimeSupervisionBudgets;
    const bounds: readonly (readonly [number, number, string])[] = [
        [budgets.ticks, config.limits.maxTicks, runtime.budgetKeys.ticks],
        [
            budgets.tickInterval,
            config.limits.maxTickIntervalMilliseconds,
            runtime.budgetKeys.tickInterval,
        ],
        [
            budgets.turnsPerWorker,
            providerProtocolConfig.tools.loop.maxTurns,
            runtime.budgetKeys.turnsPerWorker,
        ],
    ];
    for (const [budget, bound, key] of bounds) {
        if (budget > bound) {
            throw new ApplicationProtocolError(`${key} exceeds the configured bound ${bound}`);
        }
    }
    return Object.freeze({
        action: compileApplicationSchemaSurfaces(definition, action),
        actionPrompt,
        actionSchema: actionSchema as SemanticRecord,
        budgets,
        definition,
        observation: compileApplicationSchemaSurfaces(definition, observation),
        observationPrompt,
    });
}

/**
 * Creates the provider-backed runtime supervisor policy: one JSON-mode model request per tick.
 *
 * Each request carries the protocol's `action` prompt (the Appendix E meta-agent prompt) as the
 * system prompt, one user message holding the `observation` prompt followed by the canonical JSON
 * of the tick's snapshot, and the protocol's `action` schema as the output schema; the stable
 * system prompt is the cacheable prefix. A structured output is returned as the decision object; a
 * text output is parsed as JSON, and text that is not JSON is returned unchanged so the runtime
 * refuses the batch and retains the refusal. The response usage is returned for cost accounting.
 *
 * @param options - Conversational model and runtime supervision protocol.
 * @returns A policy for {@link runRuntimeSupervisor}.
 * @throws {ApplicationProtocolError} If the protocol is not a valid runtime supervision protocol.
 * @throws {TypeError} If the options or the model are malformed. The returned policy rethrows model
 * errors and the signal's reason.
 *
 * @example
 * ```ts
 * const policy = createModelRuntimeSupervisorPolicy({
 *     model: createLiveProvider({ id: "meta", kind: "anthropic", model: "claude-opus-4-7" }),
 *     protocol,
 * });
 * await runRuntimeSupervisor(store, { ...options, policy, protocol });
 * ```
 *
 * @public
 */
export function createModelRuntimeSupervisorPolicy(
    options: ModelRuntimeSupervisorPolicyOptions,
): RuntimeSupervisorPolicy {
    const fields = readScopeDataObject(
        options,
        ["model", "protocol"],
        "createModelRuntimeSupervisorPolicy options",
    );
    const model = fields.model as { readonly converse?: unknown } | null;
    if (model === null || typeof model !== "object" || typeof model.converse !== "function") {
        throw new TypeError("model must provide converse");
    }
    const converse = (
        model.converse as ModelRuntimeSupervisorPolicyOptions["model"]["converse"]
    ).bind(model);
    const protocol = readRuntimeSupervisionProtocol(fields.protocol);
    return async ({ signal, snapshot }): Promise<RuntimeSupervisorPolicyResult> => {
        const response = readModelConversationResponse(
            await converse(
                {
                    cachePrefixMessages: 0,
                    messages: [
                        {
                            content: [
                                { text: protocol.observationPrompt, type: TEXT_BLOCK },
                                {
                                    text: canonicalizeSemanticValue(snapshot as never),
                                    type: TEXT_BLOCK,
                                },
                            ],
                            role: USER_ROLE,
                        },
                    ],
                    outputSchema: protocol.actionSchema,
                    system: protocol.actionPrompt,
                },
                signal,
            ),
            "runtime supervisor policy response",
        );
        return Object.freeze({ output: parseOutput(response.output), usage: response.usage });
    };
}

function parseOutput(output: unknown): unknown {
    if (typeof output !== "string") {
        return output;
    }
    try {
        return JSON.parse(output) as unknown;
    } catch {
        return output;
    }
}
