import type { SemanticRecord, SemanticValue } from "../canonical/canonical-record.ts";
import type { EffectHandler } from "../effect/handler-types.ts";
import type { EffectIntent, EffectResult } from "../effect/types.ts";
import { kernelProtocolConfig, providerProtocolConfig } from "../protocol/config.ts";
import type { MetaAgentToolConfig } from "../protocol/config-types.ts";
import { REPLAY_SOURCE_DISPOSITIONS } from "../protocol/values.generated.ts";
import { analyzeReplayDivergence } from "../replay/analysis.ts";
import { replayReplaySession, rewindReplaySession } from "../replay/branch.ts";
import { inspectReplaySession } from "../replay/inspection.ts";
import { runReplaySession } from "../replay/session.ts";
import type {
    ReplayProviderStepInspection,
    ReplayRestoreInspection,
    ReplaySessionInspection,
    ReplayStepInspection,
    ReplayTarget,
    ReplayWorldBinding,
} from "../replay/types.ts";
import { compileJSONSchema } from "../schema/json-schema-validator.ts";
import { currentToolEffectScope } from "./tool-effect-scope.ts";
import type {
    MetaAgentToolEnvironment,
    MetaAgentTools,
    MetaAgentWorkerDefinition,
    ToolLoopTool,
} from "./types.ts";

const metaAgent = providerProtocolConfig.tools.metaAgent;
const [, RETAIN_SOURCE] = REPLAY_SOURCE_DISPOSITIONS;

type Input = Readonly<Record<string, SemanticValue>>;
type Operation = (input: Input, commandId: string) => Promise<SemanticValue>;

/**
 * Creates the substrate-native meta-agent tools declared by `providers.tools.metaAgent.tools`:
 * one tool and one exact-kind effect handler per catalog entry, bound to its configured operation.
 *
 * | Operation | Substrate API |
 * | --- | --- |
 * | `observe` | `inspectReplaySession`: mode, status, checkpoints, and a bounded step summary |
 * | `fork` | world-adapter `fork` (or an allocated root), then `runReplaySession` of a declared worker |
 * | `discard` | world-adapter `discard` of a forked custody |
 * | `rewind` | `rewindReplaySession` into allocated empty roots |
 * | `replay` | `replayReplaySession` under a declared worker variant |
 * | `read_trace` | bounded exact-ordinal reads of one owner path |
 * | `diff` | `analyzeReplayDivergence` |
 *
 * Every handler re-validates the call input against the tool's schema and derives the substrate
 * command identity `<commandIdPrefix><session_id>:<effect_id>` inside a replay-bound tool loop
 * ({@link createReplayToolLoopBindings}), where `session_id` is the session executing the call, and
 * `<commandIdPrefix><effect_id>` otherwise. A repeated intent in the same session therefore converges
 * on the retained receipts, while a replay branch that runs a call live issues fresh substrate
 * commands instead of colliding with its source's (a branch's recorded prefix invokes no handler). A substrate refusal returns a failure result `{ name, message }` to the model instead
 * of throwing; an input that fails the schema throws `TypeError`.
 *
 * @param environment - Store, claim, workers, root allocator, and optional world adapter and clock.
 * @returns The catalog tools and their handlers.
 * @throws {TypeError} If the environment is malformed.
 *
 * @example
 * ```ts
 * const meta = createMetaAgentTools({ allocateRoot, claimId: "meta", store, workers, world });
 * await runToolLoop({
 *     effects: createHandlerToolLoopEffects(createEffectHandlerStack(meta.handlers)),
 *     loopId: "meta:1",
 *     messages,
 *     model,
 *     tools: meta.tools,
 * });
 * ```
 *
 * @public
 */
export function createMetaAgentTools(environment: MetaAgentToolEnvironment): MetaAgentTools {
    const env = readEnvironment(environment);
    const operations: Readonly<Record<MetaAgentToolConfig["operation"], Operation>> = {
        diff: async (input) => diff(env, input),
        discard: async (input, commandId) => discard(env, input, commandId),
        fork: async (input, commandId) => fork(env, input, commandId),
        observe: async (input) => observe(env, input),
        read_trace: async (input) => readTrace(env, input),
        replay: async (input, commandId) => replay(env, input, commandId),
        rewind: async (input, commandId) => rewind(env, input, commandId),
    };
    const tools: ToolLoopTool[] = [];
    const handlers: EffectHandler[] = [];
    for (const entry of metaAgent.tools) {
        const validator = compileJSONSchema(entry.inputSchema);
        const operation = operations[entry.operation];
        tools.push(
            Object.freeze({
                description: entry.description,
                effectKind: entry.effectKind,
                inputSchema: validator.document as SemanticRecord,
                name: entry.name,
                reversibility: entry.reversibility as ToolLoopTool["reversibility"],
            }),
        );
        handlers.push(
            Object.freeze({
                handle: async (intent: EffectIntent) => {
                    const payload = intent.payload as Readonly<Record<string, SemanticValue>>;
                    const input = validator.parse(payload?.input, `${entry.name} input`) as Input;
                    try {
                        return success(await operation(input, commandIdOf(intent.effect_id)));
                    } catch (error) {
                        return failure(error);
                    }
                },
                handlerId: `${metaAgent.commandIdPrefix}${entry.name}`,
                kind: entry.effectKind,
            }),
        );
    }
    return Object.freeze({ handlers: Object.freeze(handlers), tools: Object.freeze(tools) });
}

function commandIdOf(effectId: string): string {
    const scope = currentToolEffectScope();
    return `${metaAgent.commandIdPrefix}${scope === null ? "" : `${scope}:`}${effectId}`;
}

type Environment = {
    readonly allocateRoot: MetaAgentToolEnvironment["allocateRoot"];
    readonly claimId: string;
    readonly clock: () => number;
    readonly store: MetaAgentToolEnvironment["store"];
    readonly workers: ReadonlyMap<string, MetaAgentWorkerDefinition>;
    readonly world: MetaAgentToolEnvironment["world"];
};

async function fork(env: Environment, input: Input, commandId: string): Promise<SemanticValue> {
    const name = input.worker as string;
    const workerId = input.worker_id as string;
    const worker = env.workers.get(name);
    if (worker === undefined) {
        throw new TypeError(`worker ${name} is not declared`);
    }
    const custody =
        env.world === undefined
            ? null
            : await env.world.fork({
                  commandId,
                  nowMilliseconds: env.clock(),
                  workerId,
              });
    const root =
        custody?.root ??
        (await env.allocateRoot({ commandId, operation: "fork", world: worker.world }));
    const { inspection } = await runReplaySession(env.store, {
        claimId: env.claimId,
        clock: env.clock,
        commandId,
        program: worker.program,
        programId: worker.programId,
        worlds: [{ name: worker.world, root }],
        ...defined({
            handlers: worker.handlers?.(root),
            provider: worker.provider,
            task: worker.task,
        }),
    });
    return {
        custody_id: custody?.custody_id ?? null,
        worker: name,
        worker_id: workerId,
        ...sessionSummary(inspection),
    };
}

async function discard(env: Environment, input: Input, commandId: string): Promise<SemanticValue> {
    if (env.world === undefined) {
        throw new TypeError("discard requires a bound world adapter");
    }
    const receipt = await env.world.discard({
        commandId,
        custodyId: input.custody_id as string,
        nowMilliseconds: env.clock(),
        workerId: input.worker_id as string,
    });
    return { custody_id: input.custody_id as string, receipt_id: receipt.receipt_id };
}

function observe(env: Environment, input: Input): SemanticValue {
    const inspection = inspectReplaySession(env.store, { sessionId: input.session_id as string });
    const limit = metaAgent.limits.maxObservedSteps;
    return {
        ...sessionSummary(inspection),
        checkpoints: inspection.checkpoints.map((checkpoint) => ({
            checkpoint_id: checkpoint.checkpoint_id,
            classification: checkpoint.classification,
            step_count: checkpoint.step_count,
        })),
        mode: inspection.mode,
        origin:
            inspection.origin === null
                ? null
                : {
                      changes: [...inspection.origin.changes],
                      source_session_id: inspection.origin.source_session_id,
                      target_step_count: inspection.origin.target_step_count,
                  },
        program_id: inspection.program_id,
        steps: inspection.steps.slice(0, limit).map(stepSummary),
        steps_truncated: inspection.steps.length > limit,
        worlds: [...inspection.worlds],
    };
}

async function rewind(env: Environment, input: Input, commandId: string): Promise<SemanticValue> {
    const source = inspectReplaySession(env.store, { sessionId: input.session_id as string });
    const worker = [...env.workers.values()].find(
        (candidate) => candidate.programId === source.program_id,
    );
    const { inspection } = await rewindReplaySession(env.store, {
        claimId: env.claimId,
        clock: env.clock,
        commandId,
        sourceSessionId: source.session_id,
        target: readTarget(input),
        worlds: await allocateWorlds(env, source, commandId, "rewind"),
        ...defined({ compensation: worker?.compensation }),
    });
    return {
        ...sessionSummary(inspection),
        classification: (inspection.restore as ReplayRestoreInspection).classification,
        source_session_id: source.session_id,
    };
}

async function replay(env: Environment, input: Input, commandId: string): Promise<SemanticValue> {
    const source = inspectReplaySession(env.store, { sessionId: input.session_id as string });
    const worker = [...env.workers.values()].find(
        (candidate) => candidate.programId === source.program_id,
    );
    if (worker === undefined) {
        throw new TypeError(`no declared worker runs program ${source.program_id}`);
    }
    const name = input.variant as string;
    const variant = worker.variants?.[name];
    if (variant === undefined) {
        throw new TypeError(`worker program ${source.program_id} declares no variant ${name}`);
    }
    const worlds = await allocateWorlds(env, source, commandId, "replay");
    const root = worlds.find((world) => world.name === worker.world)?.root;
    if (root === undefined) {
        throw new TypeError(`session ${source.session_id} does not bind world ${worker.world}`);
    }
    const { inspection } = await replayReplaySession(env.store, {
        changes: variant.changes,
        claimId: env.claimId,
        clock: env.clock,
        commandId,
        program: worker.program,
        // An exploratory replay keeps its source as a retained alternative and compensates nothing.
        sourceDisposition: RETAIN_SOURCE,
        sourceSessionId: source.session_id,
        target: readTarget(input),
        worlds,
        ...defined({
            handlers: (variant.handlers ?? worker.handlers)?.(root),
            policy: variant.policy,
            provider: variant.provider ?? worker.provider,
            task: variant.task,
        }),
    });
    return {
        ...sessionSummary(inspection),
        source_session_id: source.session_id,
        variant: name,
    };
}

function readTrace(env: Environment, input: Input): SemanticValue {
    const ownerId = input.owner_id as string;
    const first = kernelProtocolConfig.append.firstOwnerOrdinal;
    const next = env.store.readOwnerNextOrdinals([ownerId]).get(ownerId) as number;
    const start = Math.max(first, (input.from_ordinal as number | undefined) ?? first);
    const limit = Math.min(
        (input.max_records as number | undefined) ?? metaAgent.limits.maxTraceRecords,
        metaAgent.limits.maxTraceRecords,
    );
    const records: SemanticValue[] = [];
    for (let ordinal = start; ordinal < next && records.length < limit; ordinal += 1) {
        const record = env.store.readOwnerOccurrence(ownerId, ordinal);
        records.push({
            body: record.body as SemanticValue,
            caused_by_record_ids: [...record.envelope.caused_by_record_ids],
            mode: record.envelope.mode,
            ordinal: record.view.owner_ordinal,
            record_id: record.envelope.record_id,
            schema_ref: record.envelope.schema_ref,
        });
    }
    return {
        has_more: start + records.length < next,
        next_ordinal: start + records.length,
        owner_id: ownerId,
        records,
    };
}

function diff(env: Environment, input: Input): SemanticValue {
    const analysis = analyzeReplayDivergence(env.store, {
        replaySessionId: input.replay_session_id as string,
        sourceSessionId: input.source_session_id as string,
    });
    return {
        changes: [...analysis.changes],
        common_prefix_id: analysis.common_prefix_id,
        first_divergence_index: analysis.first_divergence_index,
        replay_session_id: analysis.replay_session_id,
        source_session_id: analysis.source_session_id,
        steps: analysis.steps.map((step) => ({
            cause: step.cause,
            index: step.index,
            status: step.status,
        })),
        unexplained: [...analysis.unexplained],
    };
}

async function allocateWorlds(
    env: Environment,
    source: ReplaySessionInspection,
    commandId: string,
    operation: string,
): Promise<readonly ReplayWorldBinding[]> {
    const worlds: ReplayWorldBinding[] = [];
    for (const world of source.worlds) {
        worlds.push({ name: world, root: await env.allocateRoot({ commandId, operation, world }) });
    }
    return worlds;
}

function readTarget(input: Input): ReplayTarget {
    return input.checkpoint_id === undefined
        ? { stepCount: input.step_count as number }
        : { checkpointId: input.checkpoint_id as string };
}

function sessionSummary(inspection: ReplaySessionInspection): Record<string, SemanticValue> {
    return {
        failure: inspection.terminal?.failure ?? null,
        result: inspection.terminal?.result?.value ?? null,
        session_id: inspection.session_id,
        status: inspection.terminal?.status ?? inspection.classification,
        step_count: inspection.steps.length,
    };
}

function stepSummary(step: ReplayStepInspection): SemanticValue {
    if (step.effect !== null) {
        const result = step.effect.outcome?.result ?? null;
        return {
            disposition: step.effect.disposition,
            effect_kind: step.effect.intent.kind,
            index: step.index,
            kind: step.kind,
            ok: result?.ok ?? null,
            result: result === null ? null : result.ok ? result.value : result.error,
            source: step.source,
        };
    }
    return {
        failure: (step.provider as ReplayProviderStepInspection).failure ?? null,
        index: step.index,
        kind: step.kind,
        output: (step.provider as ReplayProviderStepInspection).response?.output ?? null,
        source: step.source,
    };
}

function defined<T extends Record<string, unknown>>(
    fields: T,
): { [K in keyof T]?: Exclude<T[K], undefined> } {
    return Object.fromEntries(
        Object.entries(fields).filter(([, value]) => value !== undefined),
    ) as { [K in keyof T]?: Exclude<T[K], undefined> };
}

function success(value: SemanticValue): EffectResult<SemanticValue, SemanticValue> {
    return { ok: true, value };
}

function failure(error: unknown): EffectResult<SemanticValue, SemanticValue> {
    const name =
        error instanceof Error
            ? error.name === "Error"
                ? error.constructor.name
                : error.name
            : "Error";
    const message = error instanceof Error ? error.message : String(error);
    const code = (error as { readonly code?: unknown } | null)?.code;
    return {
        error: { code: typeof code === "string" ? code : null, message, name },
        ok: false,
    };
}

function readEnvironment(value: unknown): Environment {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError("meta-agent tool environment must be an object");
    }
    const allowed = ["allocateRoot", "claimId", "clock", "store", "workers", "world"];
    if (Object.keys(value).some((key) => !allowed.includes(key))) {
        throw new TypeError("meta-agent tool environment must contain only its declared fields");
    }
    const environment = value as MetaAgentToolEnvironment;
    if (typeof environment.allocateRoot !== "function") {
        throw new TypeError("meta-agent tool environment allocateRoot must be a function");
    }
    if (typeof environment.claimId !== "string" || environment.claimId.length === 0) {
        throw new TypeError("meta-agent tool environment claimId must be non-empty text");
    }
    if (environment.clock !== undefined && typeof environment.clock !== "function") {
        throw new TypeError("meta-agent tool environment clock must be a function");
    }
    if (typeof environment.store?.readOwnerOccurrence !== "function") {
        throw new TypeError("meta-agent tool environment store must be a trace store");
    }
    if (environment.workers === null || typeof environment.workers !== "object") {
        throw new TypeError("meta-agent tool environment workers must be an object");
    }
    const workers = new Map<string, MetaAgentWorkerDefinition>();
    const programs = new Set<string>();
    for (const [name, worker] of Object.entries(environment.workers)) {
        if (
            typeof worker?.program !== "function" ||
            typeof worker.programId !== "string" ||
            typeof worker.world !== "string" ||
            programs.has(worker.programId)
        ) {
            throw new TypeError(
                `meta-agent worker ${name} requires a program, a unique programId, and a world`,
            );
        }
        programs.add(worker.programId);
        workers.set(name, worker);
    }
    if (
        environment.world !== undefined &&
        (typeof environment.world?.fork !== "function" ||
            typeof environment.world.discard !== "function")
    ) {
        throw new TypeError("meta-agent tool environment world must be a world adapter");
    }
    return {
        allocateRoot: environment.allocateRoot,
        claimId: environment.claimId,
        clock: environment.clock ?? Date.now,
        store: environment.store,
        workers,
        world: environment.world,
    };
}
