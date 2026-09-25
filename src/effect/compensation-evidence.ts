import { replayProtocolConfig, supervisionProtocolConfig } from "../protocol/config.ts";
import {
    EFFECT_COMPENSATION_EVIDENCE_KINDS,
    REPLAY_EFFECT_DISPOSITIONS,
    REPLAY_STEP_SOURCES,
    SCOPE_STATES,
    SUPERVISION_DISPOSITIONS,
} from "../protocol/values.generated.ts";
import type { RecordId } from "../record/types.ts";
import { inspectReplaySession } from "../replay/inspection.ts";
import type { ReplaySessionInspection, ReplayStepInspection } from "../replay/types.ts";
import { inspectScope } from "../scope/inspection.ts";
import { readScopeEmissionRecord } from "../scope/records.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import { inspectSupervisedDispatch } from "../supervision/control.ts";
import { EffectCompensationEvidenceError } from "./compensation-errors.ts";
import type { MaterializedEffectEvidence } from "./compensation-types.ts";
import type { EffectIntent, EffectOutcome } from "./types.ts";

const [REPLAY_STEP_EVIDENCE, SUPERVISED_DISPATCH_EVIDENCE] = EFFECT_COMPENSATION_EVIDENCE_KINDS;
const [REPLAY_MATERIALIZED] = REPLAY_EFFECT_DISPOSITIONS;
const [, RECORDED] = REPLAY_STEP_SOURCES;
const [SUPERVISED_MATERIALIZED] = SUPERVISION_DISPOSITIONS;
const [OPEN_STATE] = SCOPE_STATES;

/** One materialized effect with the record retaining its original materialization. @internal */
export type MaterializedEffect = {
    readonly evidence: MaterializedEffectEvidence;
    readonly intent: EffectIntent;
    readonly outcome: EffectOutcome;
};

/**
 * Resolves retained materialization evidence without mutation. A recorded replay step resolves to
 * the live step it copies, so every copy names the same original materialization.
 *
 * @internal
 */
export class MaterializedEffectResolver {
    readonly #sessions = new Map<string, ReplaySessionInspection>();
    readonly #store: SQLiteTraceStore;

    /**
     * Creates a resolver over one store.
     *
     * @param store - Open trace store.
     */
    constructor(store: SQLiteTraceStore) {
        this.#store = store;
    }

    /**
     * Resolves one record to a materialized effect.
     *
     * @param recordId - Replay step or supervised dispatch resolution record.
     * @returns The materialized effect, or undefined when the record is not a materialized effect.
     * @throws {EffectCompensationEvidenceError} If the record is absent.
     */
    resolve(recordId: RecordId): MaterializedEffect | undefined {
        const record = this.#store.readRecord(recordId);
        if (record === undefined) {
            throw new EffectCompensationEvidenceError(`record ${recordId} is not retained`);
        }
        // Every retained record has at least one owner view.
        const ownerId = (record.views[0] as NonNullable<(typeof record.views)[0]>).owner_id;
        if (record.envelope.schema_ref === replayProtocolConfig.traceSchemas.step) {
            // A validated session projects every step record on its path.
            return this.replayStep(
                this.#session(ownerId).steps.find(
                    (entry) => entry.record_id === recordId,
                ) as ReplayStepInspection,
            );
        }
        if (record.envelope.schema_ref === supervisionProtocolConfig.traceSchemas.resolution) {
            const dispatch = inspectSupervisedDispatch(this.#store, { dispatchId: ownerId });
            const resolution = dispatch.resolution;
            if (
                resolution?.record_id !== recordId ||
                resolution.disposition !== SUPERVISED_MATERIALIZED ||
                resolution.outcome === null
            ) {
                return undefined;
            }
            return Object.freeze({
                evidence: Object.freeze({
                    kind: SUPERVISED_DISPATCH_EVIDENCE,
                    record_id: recordId,
                }),
                intent: dispatch.effective_intent,
                outcome: resolution.outcome,
            });
        }
        return undefined;
    }

    /**
     * Resolves one validated replay step to its original materialization.
     *
     * @param step - Validated step of a retained session.
     * @returns The materialized effect, or undefined for a provider, refused, or failed step.
     */
    replayStep(step: ReplayStepInspection): MaterializedEffect | undefined {
        const effect = step.effect;
        if (effect?.disposition !== REPLAY_MATERIALIZED || effect.outcome === null) {
            return undefined;
        }
        if (step.source === RECORDED && step.source_step_record_id !== null) {
            return this.resolve(step.source_step_record_id);
        }
        return Object.freeze({
            evidence: Object.freeze({ kind: REPLAY_STEP_EVIDENCE, record_id: step.record_id }),
            intent: effect.intent,
            outcome: effect.outcome,
        });
    }

    #session(sessionId: string): ReplaySessionInspection {
        let inspection = this.#sessions.get(sessionId);
        if (inspection === undefined) {
            inspection = inspectReplaySession(this.#store, { sessionId });
            this.#sessions.set(sessionId, inspection);
        }
        return inspection;
    }
}

/**
 * Collects the materialized effects of a replay session at or after a step boundary, in step
 * order: the effects a branch opened at that boundary rewinds past.
 *
 * @internal
 */
export function collectReplaySuffixEffects(
    store: SQLiteTraceStore,
    source: ReplaySessionInspection,
    stepCount: number,
): readonly MaterializedEffect[] {
    const resolver = new MaterializedEffectResolver(store);
    return source.steps.slice(stepCount).flatMap((step) => resolver.replayStep(step) ?? []);
}

/**
 * Collects the materialized effects cited by the selected history of every scope a discard seals,
 * visiting the subtree root first and each child after its parent in registration order, and
 * each scope's selected history in order. `sealed` names the sealed scopes after the decision;
 * before it, every open scope of the subtree is visited.
 *
 * @internal
 */
export function collectScopeSubtreeEffects(
    store: SQLiteTraceStore,
    rootScopeId: string,
    sealed: ReadonlySet<string> | null,
): readonly MaterializedEffect[] {
    const resolver = new MaterializedEffectResolver(store);
    const effects: MaterializedEffect[] = [];
    const visit = (scopeId: string): void => {
        const inspection = inspectScope(store, scopeId);
        if (
            inspection === undefined ||
            (sealed === null ? inspection.state !== OPEN_STATE : !sealed.has(scopeId))
        ) {
            return;
        }
        for (const contribution of inspection.selected_history) {
            // Inspection validated every selected-history contribution as a retained emission.
            const record = store.readRecord(contribution.record_id) as NonNullable<
                ReturnType<SQLiteTraceStore["readRecord"]>
            >;
            for (const cited of readScopeEmissionRecord(record.body).cited_record_ids) {
                const effect = resolver.resolve(cited);
                if (effect !== undefined) {
                    effects.push(effect);
                }
            }
        }
        for (const child of inspection.children) {
            visit(child);
        }
    };
    visit(rootScopeId);
    return effects;
}
