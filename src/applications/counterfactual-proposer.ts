import { createReplayToolLoopBindings, createToolTurnProvider } from "../agent/bindings.ts";
import { runToolLoop } from "../agent/tool-loop.ts";
import type { ToolLoopTool } from "../agent/types.ts";
import {
    canonicalizeSemanticValue,
    type SemanticRecord,
    type SemanticValue,
} from "../canonical/canonical-record.ts";
import type { EffectHandler } from "../effect/handler-types.ts";
import { createEffectHandlerStack } from "../effect/handlers.ts";
import type { EffectIntent, EffectResult } from "../effect/types.ts";
import { applicationsProtocolConfig, providerProtocolConfig } from "../protocol/config.ts";
import {
    APPLICATION_CRO_SPLITS,
    APPLICATION_PROTOCOL_SURFACES,
    EFFECT_REVERSIBILITY_TIERS,
    MODEL_CONTENT_BLOCK_TYPES,
    MODEL_MESSAGE_ROLES,
    REPLAY_TERMINAL_STATUSES,
    TOOL_CALL_DISPOSITIONS,
    TOOL_LOOP_STATUSES,
} from "../protocol/values.generated.ts";
import { inspectReplaySession } from "../replay/inspection.ts";
import { runReplaySession } from "../replay/session.ts";
import type {
    ReplaySessionInspection,
    ReplayStepInspection,
    ReplayTerminalInspection,
} from "../replay/types.ts";
import { compileJSONSchema } from "../schema/json-schema-validator.ts";
import { readCroEdit } from "./counterfactual-records.ts";
import type {
    CounterfactualCandidateRecord,
    CounterfactualProposal,
    CounterfactualProposer,
    CounterfactualProposerContext,
    ToolLoopCounterfactualProposerOptions,
} from "./counterfactual-types.ts";
import { ApplicationProtocolError, ApplicationVerificationError } from "./errors.ts";
import { canonical } from "./records.ts";
import type { ApplicationProtocolDefinition, ApplicationProtocolSurface } from "./types.ts";

const proposerConfig = applicationsProtocolConfig.cro.proposer;
const surfaceRoles = applicationsProtocolConfig.cro.surfaceRoles;
const reflectionFields = applicationsProtocolConfig.cro.reflection.fields;
const [PROMPT_KIND, SCHEMA_KIND, TOOL_KIND] = APPLICATION_PROTOCOL_SURFACES;
const [REVERSIBLE] = EFFECT_REVERSIBILITY_TIERS;
const [TEXT_BLOCK] = MODEL_CONTENT_BLOCK_TYPES;
const [USER_ROLE] = MODEL_MESSAGE_ROLES;
const [MATERIALIZED] = TOOL_CALL_DISPOSITIONS;
const [FINISHED_SESSION] = REPLAY_TERMINAL_STATUSES;
const [COMPLETED_LOOP] = TOOL_LOOP_STATUSES;
const [TRAIN_SPLIT] = APPLICATION_CRO_SPLITS;

type Operation = keyof typeof proposerConfig.operations;
type Input = Readonly<Record<string, SemanticValue>>;

/**
 * Creates the provider-backed CRO proposer: each attempt runs one bounded tool-use loop
 * (`runToolLoop`) inside a replay session recorded under the attempt's reserved command identity,
 * so its turns and tool calls are retained, replayable, counted against the provider-call budget,
 * and cited by the proposal record.
 *
 * The loop's system prompt is the protocol's `proposer` prompt surfaces, its tools are the
 * protocol's `proposer` tool surfaces (each `{ name, description, inputSchema }` naming one
 * configured operation in `applications.cro.proposer.operations`), and its output schema is the
 * first `reflection` schema surface. The first user message carries the attempt brief: iteration,
 * attempt, capacity, parent pool, train and dev example identities, and earlier refusal reasons.
 *
 * | Operation | Result |
 * | --- | --- |
 * | `inspectCandidates` | The pool, baseline example scores, and every candidate's plan, status, gate, dev score, and cost |
 * | `readTrace` | Bounded step summaries of one pool member's (or the baseline's, for a null candidate) session on one example |
 * | `grepTraces` | Bounded regex matches over one member's example step summaries |
 * | `proposeCandidate` | Accepts one edit with its fix and guard sets; the edit joins the proposal |
 *
 * The proposal is the accepted `proposeCandidate` inputs in call order, the final output as the
 * reflection (parsed from JSON text when the model returns text), and the reflection's configured
 * `parent` field as the parent. An attempt whose session does not finish or whose loop reaches its
 * turn limit is refused by throwing {@link ApplicationVerificationError}, which the optimizer
 * records as a refusal and retries.
 *
 * @param options - Conversational model and optional turn bound.
 * @returns The proposer.
 * @throws {TypeError} If the options are malformed. The returned proposer throws
 * {@link ApplicationProtocolError} if a proposer tool surface is malformed or names no configured
 * operation, or the protocol offers no propose tool.
 *
 * @example
 * ```ts
 * const proposer = createToolLoopCounterfactualProposer({
 *     model: createLiveProvider({ id: "proposer", kind: "anthropic", model: "claude-sonnet-4-6" }),
 * });
 * ```
 */
export function createToolLoopCounterfactualProposer(
    options: ToolLoopCounterfactualProposerOptions,
): CounterfactualProposer {
    if (options === null || typeof options !== "object" || Array.isArray(options)) {
        throw new TypeError("tool loop proposer options must be an object");
    }
    if (Object.keys(options).some((key) => key !== "maxTurns" && key !== "model")) {
        throw new TypeError("tool loop proposer options must contain only model and maxTurns");
    }
    const { model } = options;
    if (typeof model?.converse !== "function" || typeof model.descriptor !== "function") {
        throw new TypeError("tool loop proposer model must be a conversational provider");
    }
    const maxTurns = options.maxTurns ?? proposerConfig.limits.defaultMaxTurns;
    if (
        !Number.isSafeInteger(maxTurns) ||
        maxTurns < 1 ||
        maxTurns > providerProtocolConfig.tools.loop.maxTurns
    ) {
        throw new TypeError(
            `maxTurns must be a positive integer of at most ${providerProtocolConfig.tools.loop.maxTurns}`,
        );
    }
    const provider = createToolTurnProvider(model);
    return async (context) => {
        const surfaces = readSurfaces(context.protocol);
        const tools = surfaces.tools.map(({ operation, tool }) => ({ operation, tool }));
        const proposeName = proposerConfig.operations.proposeCandidate;
        const handlers = tools.map(
            ({ operation, tool }): EffectHandler => ({
                handle: async (intent: EffectIntent) => {
                    // The tool loop validated the payload input against the tool's schema.
                    const payload = intent.payload as Readonly<Record<string, Input>>;
                    try {
                        return success(OPERATIONS[operation](context, payload.input as Input));
                    } catch (error) {
                        return failure(error as Error);
                    }
                },
                handlerId: `${proposerConfig.effectKindPrefix}${tool.name}`,
                kind: tool.effectKind,
            }),
        );
        const { inspection } = await runReplaySession(context.store, {
            claimId: context.claimId,
            ...(context.clock === undefined ? {} : { clock: context.clock }),
            commandId: context.commandId,
            handlers: createEffectHandlerStack(handlers),
            program: async (session) => {
                const result = await runToolLoop({
                    ...createReplayToolLoopBindings(session),
                    loopId: context.commandId,
                    maxTurns,
                    messages: [
                        {
                            content: [{ text: brief(context), type: TEXT_BLOCK }],
                            role: USER_ROLE,
                        },
                    ],
                    outputSchema: surfaces.output,
                    system: surfaces.system,
                    tools: tools.map(({ tool }) => tool),
                });
                return {
                    edits: result.turns.flatMap((turn) =>
                        turn.calls
                            .filter(
                                (call) =>
                                    call.name === proposeName &&
                                    call.disposition === MATERIALIZED &&
                                    call.outcome?.result.ok === true,
                            )
                            .map((call) => call.input),
                    ),
                    output: result.output,
                    status: result.status,
                };
            },
            programId: proposerConfig.programId,
            provider,
        });
        return readSessionProposal(inspection);
    };
}

const OPERATIONS: Readonly<
    Record<Operation, (context: CounterfactualProposerContext, input: Input) => SemanticValue>
> = {
    grepTraces: (context, input) => {
        const pattern = input.pattern as string;
        if (pattern.length > proposerConfig.limits.maxPatternLength) {
            throw new TypeError(
                `pattern must be text of at most ${proposerConfig.limits.maxPatternLength} characters`,
            );
        }
        const expression = new RegExp(pattern, "u");
        const half = Math.floor(proposerConfig.limits.maxExcerptLength / 2);
        const matches = [...sessionsOf(context, input.candidate as SemanticValue)].flatMap(
            ([exampleId, sessionId]) =>
                inspectReplaySession(context.store, { sessionId }).steps.flatMap((step) => {
                    const text = canonicalizeSemanticValue(stepSummary(step));
                    const found = expression.exec(text);
                    return found === null
                        ? []
                        : [
                              {
                                  example_id: exampleId,
                                  excerpt: text.slice(
                                      Math.max(0, found.index - half),
                                      found.index + half,
                                  ),
                                  step_index: step.index,
                              },
                          ];
                }),
        );
        return {
            matches: matches.slice(0, proposerConfig.limits.maxGrepMatches),
            truncated: matches.length > proposerConfig.limits.maxGrepMatches,
        };
    },
    inspectCandidates: (context) => {
        const inspection = context.inspection;
        return {
            candidates: inspection.candidates.map((candidate) => ({
                changes: [...candidate.changes],
                cost: candidate.cost,
                dev_score: candidate.dev_score,
                edit_scope: candidate.edit_scope,
                edited_step_index: candidate.edited_step_index,
                failure: candidate.failure,
                fix_set: [...candidate.fix_set],
                gate: candidate.gate,
                guard_set: [...candidate.guard_set],
                iteration: candidate.iteration,
                mechanism: candidate.mechanism,
                name: candidate.name,
                parent: nameOf(context, candidate.parent_candidate_id),
                rationale: candidate.rationale,
                scores: [
                    ...candidate.targeted,
                    ...(candidate.dev ?? []),
                    ...(candidate.train ?? []),
                ].map((result) => ({
                    example_id: result.example_id,
                    parent_score: result.parent_score,
                    role: result.role,
                    score: result.score,
                })),
                status: candidate.status,
            })),
            examples: inspection.examples.map((example) => ({
                example_id: example.example_id,
                score: example.score,
                split: example.split,
            })),
            pool: context.pool.map((member) => ({
                dev_score: member.dev_score,
                name: member.name,
            })),
        };
    },
    proposeCandidate: (context, input) => {
        const edit = readCroEdit(input, "edit");
        return { accepted: edit.name, capacity: context.capacity };
    },
    readTrace: (context, input) => {
        const exampleId = input.example_id;
        const sessionId = sessionsOf(context, input.candidate as SemanticValue).get(
            exampleId as string,
        );
        if (sessionId === undefined) {
            throw new TypeError(
                `no session of ${String(input.candidate)} on example ${String(exampleId)}`,
            );
        }
        const session = inspectReplaySession(context.store, { sessionId });
        return {
            example_id: exampleId as string,
            session_id: sessionId,
            status: (session.terminal as ReplayTerminalInspection).status,
            steps: session.steps.slice(0, proposerConfig.limits.maxTraceSteps).map(stepSummary),
            steps_truncated: session.steps.length > proposerConfig.limits.maxTraceSteps,
        };
    },
};

/** Example sessions of the baseline (null) or of the named candidate, by example identity. */
function sessionsOf(
    context: CounterfactualProposerContext,
    candidate: SemanticValue,
): ReadonlyMap<string, string> {
    if (candidate === null) {
        return new Map(
            context.inspection.examples.map((example) => [example.example_id, example.session_id]),
        );
    }
    const record = context.inspection.candidates.find((entry) => entry.name === candidate);
    if (record === undefined) {
        throw new TypeError(`candidate ${String(candidate)} is not retained`);
    }
    return new Map(
        [...record.targeted, ...(record.dev ?? []), ...(record.train ?? [])].map((result) => [
            result.example_id,
            result.session_id,
        ]),
    );
}

function nameOf(context: CounterfactualProposerContext, candidateId: string | null): string | null {
    return candidateId === null
        ? null
        : (
              context.inspection.candidates.find(
                  (entry) => entry.candidate_id === candidateId,
              ) as CounterfactualCandidateRecord
          ).name;
}

function stepSummary(step: ReplayStepInspection): SemanticValue {
    return {
        effect: step.effect as unknown as SemanticValue,
        index: step.index,
        kind: step.kind,
        provider: step.provider as unknown as SemanticValue,
        source: step.source,
    };
}

function brief(context: CounterfactualProposerContext): string {
    const [train, dev] = [
        context.inspection.examples.filter((example) => example.split === TRAIN_SPLIT),
        context.inspection.examples.filter((example) => example.split !== TRAIN_SPLIT),
    ];
    return `Proposer session brief:\n${canonical({
        attempt: context.attempt,
        capacity: context.capacity,
        dev_examples: dev.map((example) => example.example_id),
        feedback: [...context.feedback],
        iteration: context.iteration,
        pool: context.pool.map((member) => ({ dev_score: member.dev_score, name: member.name })),
        train_examples: train.map((example) => example.example_id),
    })}`;
}

function readSurfaces(protocol: ApplicationProtocolDefinition): {
    readonly output: SemanticRecord;
    readonly system: string;
    readonly tools: readonly { readonly operation: Operation; readonly tool: ToolLoopTool }[];
} {
    const role = surfaceRoles.proposer;
    const operations = Object.entries(proposerConfig.operations) as [Operation, string][];
    const tools = protocol.surfaces
        .filter((surface) => surface.kind === TOOL_KIND && surface.role === role)
        .map((surface) => {
            const content = Object(surface.content) as Readonly<Record<string, unknown>>;
            const operation = operations.find(([, name]) => name === content.name)?.[0];
            if (operation === undefined || typeof content.description !== "string") {
                throw new ApplicationProtocolError(
                    `proposer tool surface ${surface.id} must declare a configured operation name, a description, and an inputSchema`,
                );
            }
            compileJSONSchema(content.inputSchema);
            return {
                operation,
                tool: Object.freeze({
                    description: content.description,
                    effectKind: `${proposerConfig.effectKindPrefix}${content.name as string}`,
                    inputSchema: content.inputSchema as SemanticRecord,
                    name: content.name as string,
                    reversibility: REVERSIBLE,
                }),
            };
        });
    if (!tools.some(({ operation }) => operation === "proposeCandidate")) {
        throw new ApplicationProtocolError(
            `the protocol offers no ${proposerConfig.operations.proposeCandidate} tool`,
        );
    }
    // The optimizer requires a reflection schema surface before any proposer runs.
    const output = (
        protocol.surfaces.find(
            (surface) => surface.kind === SCHEMA_KIND && surface.role === surfaceRoles.reflection,
        ) as ApplicationProtocolSurface
    ).content as SemanticRecord;
    return {
        output,
        system: protocol.surfaces
            .filter((surface) => surface.kind === PROMPT_KIND && surface.role === role)
            .map((surface) => String(surface.content))
            .join("\n\n"),
        tools,
    };
}

function readSessionProposal(inspection: ReplaySessionInspection): CounterfactualProposal {
    // runReplaySession returns only terminal sessions.
    const terminal = inspection.terminal as ReplayTerminalInspection;
    const status = terminal.status;
    if (status !== FINISHED_SESSION) {
        throw new ApplicationVerificationError(
            `proposer session ${inspection.session_id} ended ${status} instead of finished`,
        );
    }
    const result = (terminal.result as { readonly value: Readonly<Record<string, unknown>> }).value;
    if (result.status !== COMPLETED_LOOP) {
        throw new ApplicationVerificationError(
            `proposer session ${inspection.session_id} reached its turn limit without a reflection`,
        );
    }
    let reflection = result.output as SemanticValue;
    if (typeof reflection === "string") {
        try {
            reflection = JSON.parse(reflection) as SemanticValue;
        } catch (error) {
            throw new ApplicationVerificationError(
                `proposer session ${inspection.session_id} returned a reflection that is not JSON`,
                { cause: error },
            );
        }
    }
    const parent = (reflection as Readonly<Record<string, unknown>> | null)?.[
        reflectionFields.parent
    ];
    return Object.freeze({
        edits: result.edits as CounterfactualProposal["edits"],
        parent: parent as string | null,
        reflection,
    });
}

function success(value: SemanticValue): EffectResult<SemanticValue, SemanticValue> {
    return { ok: true, value };
}

function failure(error: Error): EffectResult<SemanticValue, SemanticValue> {
    return { error: { message: error.message, name: error.name }, ok: false };
}
