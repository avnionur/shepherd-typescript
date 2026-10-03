import { createRecordId, type SemanticRecord } from "../canonical/canonical-record.ts";
import { createEffectIntent, createEffectOutcome } from "../effect/records.ts";
import type { EffectReversibility } from "../effect/types.ts";
import { effectProtocolConfig, workspaceProtocolConfig } from "../protocol/config.ts";
import {
    DURABLE_EXECUTION_CLAIMED_APPEND_STATUSES,
    RECORD_MODES,
    WORLD_EFFECT_OUTCOMES,
    WORLD_EFFECT_PHASES,
} from "../protocol/values.generated.ts";
import { ROOT_WITNESS_ID } from "../record/root-witness.ts";
import type { RecordId } from "../record/types.ts";
import { readDurableTaskExecution } from "../run/durable-execution-recovery.ts";
import { assertRunText } from "../run/validation-values.ts";
import { TraceStoreError } from "../store/errors.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import {
    readWorldEffectRecords,
    summarizeWorldEffectText,
    worldEffectId,
} from "./world-effect-records.ts";
import type { WorldEffectAuthority, WorldEffectJournalInspection } from "./world-effect-types.ts";

const config = workspaceProtocolConfig.worldTaskCapture.operationJournal;
const [OPENED, INTENT, ADMITTED, OUTCOME] = WORLD_EFFECT_PHASES;
const [SUCCEEDED, REFUSED, FAILED, CANCELLED] = WORLD_EFFECT_OUTCOMES;
const [COMMITTED] = DURABLE_EXECUTION_CLAIMED_APPEND_STATUSES;
const [CAPTURE_MODE] = RECORD_MODES;

/** Invocation-local writer whose effects remain durable in the enclosing run trace. @internal */
export type WorldEffectJournal = {
    /** Records one operation and dispatches it only after an admission record commits. */
    readonly perform: <T>(
        kind: string,
        relativePath: unknown,
        content: unknown,
        action: (admit: () => void) => T,
    ) => T;
    /** Refuses capture if journal publication left any operation uncertain. */
    readonly finish: () => void;
};

/** Marks publication uncertainty so caller-caught storage failures cannot enable further I/O. */
class WorldEffectJournalError extends TraceStoreError {}

/**
 * Opens an operation stream under the exact current invocation fence.
 * @param options - Authenticated authority, executing-journal citation, store and cancellation.
 * @returns A synchronous writer used inside the asynchronous capability methods.
 * @throws {TraceStoreError} If evidence cannot be retained under the current fence.
 * @internal
 */
export function createWorldEffectJournal(options: {
    readonly assertFence: () => void;
    readonly authority: WorldEffectAuthority;
    readonly captureId: string;
    readonly executingRecordId: RecordId;
    readonly runId: string;
    readonly signal: AbortSignal;
    readonly store: SQLiteTraceStore;
}): WorldEffectJournal {
    let head = options.executingRecordId;
    let index = 0;
    let pending = false;
    let tainted = false;
    const append = (phase: string, fields: SemanticRecord): RecordId => {
        try {
            const retained = options.store.appendDurableExecutionTerminal(
                options.runId,
                options.authority.claim_id,
                options.authority.fencing_token,
                {
                    append_intent_id: createRecordId({
                        [config.appendIntentKind]: {
                            capture_id: options.captureId,
                            run_id: options.runId,
                            phase,
                            index: fields.index ?? null,
                        },
                    }),
                    batch: {
                        groups: [
                            {
                                owner_id: options.runId,
                                caused_by_record_ids: [head],
                                records: [
                                    {
                                        body: {
                                            ...fields,
                                            capture_id: options.captureId,
                                            compatibility_version: config.compatibilityVersion,
                                            phase,
                                            run_id: options.runId,
                                            world_effect_version: config.version,
                                        },
                                        mode: CAPTURE_MODE,
                                        schema_ref: config.schemaId,
                                        witness_ref: ROOT_WITNESS_ID,
                                    },
                                ],
                            },
                        ],
                    },
                },
            );
            if (retained.status !== COMMITTED)
                throw new WorldEffectJournalError(
                    "world operation evidence lost its invocation fence",
                );
            head = retained.receipt.record_ids[0] as RecordId;
            return head;
        } catch (error) {
            tainted = true;
            if (error instanceof WorldEffectJournalError) throw error;
            throw new WorldEffectJournalError("world operation evidence could not be retained", {
                cause: error,
            });
        }
    };
    options.assertFence();
    const authorityRecordId = append(OPENED, {
        authority: options.authority as unknown as SemanticRecord,
    });
    return Object.freeze({
        perform: <T>(
            kind: string,
            relativePath: unknown,
            content: unknown,
            action: (admit: () => void) => T,
        ): T => {
            options.assertFence();
            if (tainted)
                throw new WorldEffectJournalError("world operation journal requires recovery");
            const reading = kind === config.kinds.readText;
            const operationIndex = index++;
            const intent = createEffectIntent({
                effectId: worldEffectId(options.runId, options.captureId, operationIndex),
                kind,
                payload: {
                    authority_record_id: authorityRecordId,
                    content: reading
                        ? null
                        : summarizeWorldEffectText(
                              content,
                              workspaceProtocolConfig.worldTaskCapture.maxTextBytes,
                          ),
                    path: summarizeWorldEffectText(relativePath, config.maxPathEvidenceBytes),
                    required_atom: reading
                        ? workspaceProtocolConfig.repositoryGrants.operations.readText
                        : workspaceProtocolConfig.repositoryGrants.operations.writeText,
                },
                reversibility: effectProtocolConfig.reversibilityTiers[0] as EffectReversibility,
            });
            append(INTENT, { effect: intent as unknown as SemanticRecord, index: operationIndex });
            pending = true;
            let admitted = false;
            let cancelled = false;
            try {
                if (options.signal.aborted) {
                    cancelled = true;
                    throw new TypeError("retained-world operation is cancelled", {
                        cause: options.signal.reason,
                    });
                }
                const result = action(() => {
                    append(ADMITTED, { effect_id: intent.effect_id, index: operationIndex });
                    admitted = true;
                });
                const outcome = createEffectOutcome(intent, {
                    ok: true,
                    value: {
                        status: SUCCEEDED,
                        result: reading
                            ? summarizeWorldEffectText(
                                  result,
                                  workspaceProtocolConfig.worldTaskCapture.maxTextBytes,
                              )
                            : null,
                    },
                });
                append(OUTCOME, {
                    effect: outcome as unknown as SemanticRecord,
                    index: operationIndex,
                });
                pending = false;
                return result;
            } catch (error) {
                if (error instanceof WorldEffectJournalError) throw error;
                const status = cancelled
                    ? CANCELLED
                    : !admitted && error instanceof TypeError && error.cause === undefined
                      ? REFUSED
                      : FAILED;
                const outcome = createEffectOutcome(intent, { ok: false, error: { status } });
                append(OUTCOME, {
                    effect: outcome as unknown as SemanticRecord,
                    index: operationIndex,
                });
                pending = false;
                throw error;
            }
        },
        finish: () => {
            if (tainted || pending)
                throw new WorldEffectJournalError(
                    "world operation journal is incomplete; capture cannot settle",
                );
        },
    });
}

/**
 * Inspects every built-in world operation in the run's retained terminal prefix.
 * Includes writes later overwritten or restored, refused operations, and interrupted admissions.
 * No filesystem, provider, recovery or append operation is performed.
 * @param store - Open trace store, including read-only or imported stores.
 * @param runId - Exact enclosing durable run identity.
 * @returns Immutable operation evidence and independent run recovery classification.
 * @throws {TypeError} If the run identity is malformed.
 * @throws {TraceStoreError} If the store is closed, evidence is inconsistent or inspection races a writer.
 */
export function inspectTaskWorldEffects(
    store: SQLiteTraceStore,
    runId: string,
): WorldEffectJournalInspection {
    assertRunText(runId, "runId");
    const before = store.readOwner(runId);
    const recovery = readDurableTaskExecution(store, runId);
    const after = store.readOwner(runId);
    if (before.length !== after.length)
        throw new TraceStoreError("world operation journal changed during inspection");
    return Object.freeze({
        ...readWorldEffectRecords(after, runId),
        recovery_status: recovery.status,
    });
}
