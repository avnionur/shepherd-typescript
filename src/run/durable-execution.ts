import { randomUUID } from "node:crypto";
import { createRecordId, type SemanticRecord } from "../canonical/canonical-record.ts";
import { projectionProtocolConfig, runProtocolConfig } from "../protocol/config.ts";
import {
    DURABLE_EXECUTION_CLAIMED_APPEND_STATUSES,
    DURABLE_EXECUTION_INVOCATION_CLAIM_STATUSES,
    DURABLE_EXECUTION_RECOVERY_STATUSES,
    RECORD_MODES,
    RUN_ARTIFACT_CONTENT_TYPES,
    RUN_TERMINAL_STATUSES,
} from "../protocol/values.generated.ts";
import { ROOT_WITNESS_ID } from "../record/root-witness.ts";
import type { RecordId } from "../record/types.ts";
import { TraceStoreError } from "../store/errors.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import type { TaskSchema } from "../task/schema.ts";
import { retainDurableExecutionCreation } from "./durable-execution-creation.ts";
import { publishDurableExecutionCut } from "./durable-execution-cut.ts";
import {
    DurableExecutionClaimFencedError,
    DurableExecutionClaimLostError,
    DurableExecutionRecoveryCommandRequiredError,
    DurableExecutionRecoveryError,
} from "./durable-execution-errors.ts";
import { readDurableTaskExecution } from "./durable-execution-recovery.ts";
import type { DurableTaskExecutionResult } from "./durable-execution-types.ts";
import { executePreparedTask } from "./execution.ts";
import type { PreparedTaskExecution } from "./execution-preparation.ts";
import { prepareTaskExecution } from "./execution-preparation.ts";
import type { TaskExecutionOptions, TaskExecutionResult } from "./execution-types.ts";

const [CAPTURE_MODE] = RECORD_MODES;
const [, FENCED_APPEND_STATUS] = DURABLE_EXECUTION_CLAIMED_APPEND_STATUSES;
const [, LOST_CLAIM_STATUS] = DURABLE_EXECUTION_INVOCATION_CLAIM_STATUSES;
const [, BLOB_ARTIFACT_TYPE] = RUN_ARTIFACT_CONTENT_TYPES;
const [FINISHED_RUN_STATUS] = RUN_TERMINAL_STATUSES;
const [
    ,
    CREATED_RECOVERY_STATUS,
    STARTED_RECOVERY_STATUS,
    TERMINAL_PENDING_CUT_STATUS,
    COMMITTED_RECOVERY_STATUS,
] = DURABLE_EXECUTION_RECOVERY_STATUSES;

/**
 * Executes one task while retaining its lifecycle, artifacts, usage, and exact terminal outcome.
 *
 * Caller-owned options are fully validated before the creation record is appended. Creation and
 * start are retained at their actual execution boundaries. Ordered artifacts, usage, outcome, and
 * terminal lifecycle evidence commit atomically, after which an immutable terminal cut is
 * published. Blob artifacts must cite bytes available in the same store. Sequential retries
 * reconstruct committed results without provider invocation. Existing incomplete executions must
 * be advanced through an explicit durable recovery command. A retained start without terminal
 * evidence fails closed because repeating provider invocation may be unsafe. A durable
 * first-writer claim prevents concurrent callers from crossing one provider boundary.
 *
 * @param store - Open SQLite trace store receiving execution evidence.
 * @param options - Exact task execution options accepted by {@link executeTask}.
 * @returns The immutable execution result and its durable record identities and cut.
 * @throws {TypeError} If execution options or task input are malformed.
 * @throws {DurableExecutionRecoveryError} If retained start evidence has no terminal result.
 * @throws {TraceStoreError} If durable append or cut publication fails.
 *
 * @example
 * ```ts
 * const durable = await executeTaskDurably(store, {
 *     task: greet,
 *     input: { name: "Ada" },
 *     provider,
 *     runId: "run:greet:1",
 *     budget: { maxTurns: 1 },
 * });
 * const projected = store.projectExecution(durable.ledger.cut.cut_id);
 * ```
 *
 * @public
 */
export async function executeTaskDurably<
    I extends TaskSchema<unknown>,
    O extends TaskSchema<unknown>,
>(
    store: SQLiteTraceStore,
    options: TaskExecutionOptions<I, O>,
): Promise<DurableTaskExecutionResult> {
    return executeTaskDurablyInternal(store, options, null);
}

/**
 * Executes durable recovery while causally binding an already-retained command.
 *
 * @param store - Open trace store containing execution and command evidence.
 * @param options - Exact execution contract associated with retained creation evidence.
 * @param recoveryCommandRecordId - Canonical recovery-command record to cite.
 * @returns The recovered immutable execution result and durable ledger receipt.
 * @throws {TypeError} If execution or command evidence is malformed.
 * @throws {TraceStoreError} If recovery is unsafe or retained evidence is inconsistent.
 * @internal
 */
export async function executeTaskDurablyWithRecoveryCommand<
    I extends TaskSchema<unknown>,
    O extends TaskSchema<unknown>,
>(
    store: SQLiteTraceStore,
    options: TaskExecutionOptions<I, O>,
    recoveryCommandRecordId: RecordId,
): Promise<DurableTaskExecutionResult> {
    return executeTaskDurablyInternal(store, options, recoveryCommandRecordId);
}

/** One additional record committed atomically before the durable outcome. @internal */
export type DurableExecutionTerminalContribution = {
    readonly body: SemanticRecord;
    readonly causedByRecordIds: readonly RecordId[];
    readonly localId: string;
    readonly schemaRef: string;
};

/** Result of custom execution and its exact terminal contribution. @internal */
export type DurableExecutionWithContribution = {
    readonly contributionRecordId: RecordId;
    readonly result: DurableTaskExecutionResult;
};

/** Executes a package-owned adapter under the ordinary durable invocation claim. @internal */
export async function executeTaskDurablyWithTerminalContribution<
    I extends TaskSchema<unknown>,
    O extends TaskSchema<unknown>,
>(
    store: SQLiteTraceStore,
    options: TaskExecutionOptions<I, O>,
    recoveryCommandRecordId: RecordId | null,
    beforeClaim: (
        prepared: PreparedTaskExecution<I, O>,
        createdRecordId: RecordId,
    ) => Promise<void>,
    execute: (
        prepared: PreparedTaskExecution<I, O>,
        authority: {
            readonly claimId: string;
            readonly fencingToken: number;
            readonly startedRecordId: RecordId;
        },
    ) => Promise<{
        readonly contribution: DurableExecutionTerminalContribution;
        readonly execution: TaskExecutionResult;
    }>,
): Promise<DurableExecutionWithContribution> {
    const prepared = prepareTaskExecution(options);
    const { definition } = prepared;
    const recovery = readDurableTaskExecution(store, definition.runId);
    if (
        recovery.status !==
        (recoveryCommandRecordId === null
            ? DURABLE_EXECUTION_RECOVERY_STATUSES[0]
            : CREATED_RECOVERY_STATUS)
    ) {
        throw new DurableExecutionRecoveryError(definition.runId);
    }
    const createdRecordId = retainDurableExecutionCreation(store, prepared);
    await beforeClaim(prepared, createdRecordId);
    const claimId = randomUUID();
    const claim = store.claimDurableExecutionInvocation(
        definition.runId,
        createdRecordId,
        claimId,
        Date.now(),
        recoveryCommandRecordId !== null,
    );
    // Cross-connection loss is proven through the shared ordinary admission seam.
    /* node:coverage ignore next 3 */
    if (claim.status === LOST_CLAIM_STATUS) {
        throw new DurableExecutionClaimLostError(definition.runId, claim.claim_id);
    }
    const started = store.appendDurableExecutionStart(
        definition.runId,
        claimId,
        claim.fencing_token,
        Date.now(),
        recoveryCommandRecordId,
    );
    // Start fencing is proven through the shared store transaction seam.
    /* node:coverage ignore next 3 */
    if (started.status === FENCED_APPEND_STATUS) {
        throw new DurableExecutionClaimFencedError(definition.runId, claimId);
    }
    const startedRecordId = started.receipt.record_ids[0] as RecordId;
    const authority = Object.freeze({
        claimId,
        fencingToken: claim.fencing_token,
        startedRecordId,
    });
    const completed = await execute(prepared, authority);
    return retainTerminalWithContribution(
        store,
        definition.runId,
        createdRecordId,
        startedRecordId,
        authority,
        completed.execution,
        completed.contribution,
    );
}

async function executeTaskDurablyInternal<
    I extends TaskSchema<unknown>,
    O extends TaskSchema<unknown>,
>(
    store: SQLiteTraceStore,
    options: TaskExecutionOptions<I, O>,
    recoveryCommandRecordId: RecordId | null,
): Promise<DurableTaskExecutionResult> {
    const prepared = prepareTaskExecution(options);
    const { definition } = prepared;
    const recovery = readDurableTaskExecution(store, definition.runId);
    const createdRecordId = retainDurableExecutionCreation(store, prepared);
    if (recovery.status === COMMITTED_RECOVERY_STATUS) {
        return recovery.result;
    }
    if (recovery.status === TERMINAL_PENDING_CUT_STATUS) {
        if (recoveryCommandRecordId === null) {
            throw new DurableExecutionRecoveryCommandRequiredError(
                definition.runId,
                TERMINAL_PENDING_CUT_STATUS,
            );
        }
        const cut = publishDurableExecutionCut(
            store,
            definition.runId,
            recovery.ledger.lifecycle_record_id,
            recoveryCommandRecordId,
        );
        return Object.freeze({
            execution: recovery.execution,
            ledger: Object.freeze({ cut, ...recovery.ledger }),
        });
    }
    if (recovery.status === STARTED_RECOVERY_STATUS) {
        throw new DurableExecutionRecoveryError(definition.runId);
    }
    if (recovery.status === CREATED_RECOVERY_STATUS && recoveryCommandRecordId === null) {
        throw new DurableExecutionRecoveryCommandRequiredError(
            definition.runId,
            CREATED_RECOVERY_STATUS,
        );
    }
    let startedRecordId: RecordId | null = null;
    let invocationAuthority: { readonly claimId: string; readonly fencingToken: number } | null =
        null;
    const execution = await executePreparedTask(prepared, () => {
        const claimId = randomUUID();
        const claim = store.claimDurableExecutionInvocation(
            definition.runId,
            createdRecordId,
            claimId,
            Date.now(),
            recoveryCommandRecordId !== null,
        );
        if (claim.status === LOST_CLAIM_STATUS) {
            throw new DurableExecutionClaimLostError(definition.runId, claim.claim_id);
        }
        const started = store.appendDurableExecutionStart(
            definition.runId,
            claimId,
            claim.fencing_token,
            Date.now(),
            recoveryCommandRecordId,
        );
        if (started.status === FENCED_APPEND_STATUS) {
            throw new DurableExecutionClaimFencedError(definition.runId, claimId);
        }
        startedRecordId = started.receipt.record_ids[0] as RecordId;
        invocationAuthority = Object.freeze({
            claimId,
            fencingToken: claim.fencing_token,
        });
    });
    return retainTerminal(
        store,
        prepared.definition.runId,
        createdRecordId,
        startedRecordId,
        invocationAuthority,
        execution,
    );
}

function retainTerminal(
    store: SQLiteTraceStore,
    runId: string,
    createdRecordId: RecordId,
    startedRecordId: RecordId | null,
    invocationAuthority: { readonly claimId: string; readonly fencingToken: number } | null,
    execution: TaskExecutionResult,
    commandRecordId: RecordId | null = null,
    releaseClaim = false,
    contribution: DurableExecutionTerminalContribution | null = null,
    onContributionRecordId?: (recordId: RecordId) => void,
): DurableTaskExecutionResult {
    const schemas = projectionProtocolConfig.executionHistory.executionSchemas;
    const finished = execution.outcome.outcome.status === FINISHED_RUN_STATUS;
    const lifecycleSchema = finished ? schemas.completed : schemas.failed;
    const usageLocalId = runProtocolConfig.schemas.usageId;
    const outcomeLocalId = runProtocolConfig.schemas.outcomeId;
    for (const artifact of execution.artifacts) {
        if (artifact.content.type === BLOB_ARTIFACT_TYPE) {
            const content = store.readBlob(artifact.content.blob_id);
            if (content === undefined || content.byteLength !== artifact.content.byte_length) {
                throw new TraceStoreError(
                    "durable execution artifact references an unavailable blob receipt",
                );
            }
        }
    }
    const artifactLocalIds = execution.artifacts.map((artifact) =>
        createRecordId({
            durable_artifact: {
                artifact_ordinal: artifact.artifact_ordinal,
                run_id: runId,
            },
        }),
    );
    const terminalRequest = {
        append_intent_id: createLedgerIntentId(runId, runProtocolConfig.schemas.outcomeId),
        batch: {
            groups: [
                {
                    caused_by_record_ids: [
                        startedRecordId ?? createdRecordId,
                        ...(commandRecordId === null ? [] : [commandRecordId]),
                    ],
                    owner_id: runId,
                    records: [
                        ...(contribution === null
                            ? []
                            : [
                                  {
                                      append_local_id: contribution.localId,
                                      body: contribution.body,
                                      caused_by_record_ids: contribution.causedByRecordIds,
                                      mode: CAPTURE_MODE,
                                      schema_ref: contribution.schemaRef,
                                      witness_ref: ROOT_WITNESS_ID,
                                  },
                              ]),
                        ...execution.artifacts.map((artifact, index) => ({
                            append_local_id: artifactLocalIds[index] as string,
                            body: artifact as SemanticRecord,
                            ...(index === 0
                                ? {}
                                : {
                                      caused_by_local_refs: [artifactLocalIds[index - 1] as string],
                                  }),
                            mode: CAPTURE_MODE,
                            schema_ref: runProtocolConfig.schemas.artifactId,
                            witness_ref: ROOT_WITNESS_ID,
                        })),
                        ...(execution.usage === null
                            ? []
                            : [
                                  {
                                      append_local_id: usageLocalId,
                                      body: execution.usage,
                                      mode: CAPTURE_MODE,
                                      schema_ref: runProtocolConfig.schemas.usageId,
                                      witness_ref: ROOT_WITNESS_ID,
                                  },
                              ]),
                        {
                            append_local_id: outcomeLocalId,
                            body: execution.outcome,
                            ...(execution.usage === null
                                ? artifactLocalIds.length === 0
                                    ? contribution === null
                                        ? {}
                                        : { caused_by_local_refs: [contribution.localId] }
                                    : {
                                          caused_by_local_refs: [
                                              ...(contribution === null
                                                  ? []
                                                  : [contribution.localId]),
                                              ...artifactLocalIds,
                                          ],
                                      }
                                : {
                                      caused_by_local_refs: [
                                          ...(contribution === null ? [] : [contribution.localId]),
                                          ...artifactLocalIds,
                                          usageLocalId,
                                      ],
                                  }),
                            mode: CAPTURE_MODE,
                            schema_ref: runProtocolConfig.schemas.outcomeId,
                            witness_ref: ROOT_WITNESS_ID,
                        },
                        {
                            body: terminalLifecycleBody(runId, execution),
                            caused_by_local_refs: [
                                ...(contribution === null ? [] : [contribution.localId]),
                                outcomeLocalId,
                            ],
                            mode: CAPTURE_MODE,
                            schema_ref: lifecycleSchema,
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    };
    const terminal =
        invocationAuthority === null
            ? store.append(terminalRequest)
            : store.appendDurableExecutionTerminal(
                  runId,
                  invocationAuthority.claimId,
                  invocationAuthority.fencingToken,
                  terminalRequest,
                  releaseClaim,
              );
    if ("status" in terminal) {
        if (terminal.status === FENCED_APPEND_STATUS) {
            throw new DurableExecutionClaimFencedError(
                runId,
                invocationAuthority?.claimId ?? runId,
            );
        }
        return retainTerminalReceipt(
            store,
            runId,
            createdRecordId,
            startedRecordId,
            execution,
            terminal.receipt,
            contribution,
            onContributionRecordId,
        );
    }
    return retainTerminalReceipt(
        store,
        runId,
        createdRecordId,
        startedRecordId,
        execution,
        terminal,
        contribution,
        onContributionRecordId,
    );
}

function retainTerminalWithContribution(
    store: SQLiteTraceStore,
    runId: string,
    createdRecordId: RecordId,
    startedRecordId: RecordId,
    invocationAuthority: { readonly claimId: string; readonly fencingToken: number },
    execution: TaskExecutionResult,
    contribution: DurableExecutionTerminalContribution,
): DurableExecutionWithContribution {
    let contributionRecordId: RecordId | null = null;
    const result = retainTerminal(
        store,
        runId,
        createdRecordId,
        startedRecordId,
        invocationAuthority,
        execution,
        null,
        false,
        contribution,
        (recordId) => {
            contributionRecordId = recordId;
        },
    );
    // A committed contribution append always returns its first receipt identity.
    /* node:coverage ignore next 3 */
    if (contributionRecordId === null) {
        throw new TraceStoreError("durable terminal contribution receipt is unavailable");
    }
    return Object.freeze({
        contributionRecordId,
        result,
    });
}

/**
 * Retains a command-bound cancelled terminal while atomically releasing the current worker.
 *
 * @param store - Open durable trace store.
 * @param runId - Durable run being cancelled.
 * @param createdRecordId - Exact retained creation record.
 * @param startedRecordId - Exact current running lifecycle record.
 * @param claimId - Exact current worker claim identity.
 * @param fencingToken - Exact current monotonic fencing token.
 * @param commandRecordId - Retained cancellation command authorizing terminalization.
 * @param execution - Immutable cancelled execution result.
 * @returns Durable cancelled result and terminal cut.
 * @throws {DurableExecutionClaimFencedError} If worker authority is stale.
 * @throws {TraceStoreError} If retained evidence cannot commit or reconstruct.
 * @internal
 */
export function retainDurableCancellationTerminal(
    store: SQLiteTraceStore,
    runId: string,
    createdRecordId: RecordId,
    startedRecordId: RecordId,
    claimId: string,
    fencingToken: number,
    commandRecordId: RecordId,
    execution: TaskExecutionResult,
): DurableTaskExecutionResult {
    return retainTerminal(
        store,
        runId,
        createdRecordId,
        startedRecordId,
        { claimId, fencingToken },
        execution,
        commandRecordId,
        true,
    );
}

function retainTerminalReceipt(
    store: SQLiteTraceStore,
    runId: string,
    createdRecordId: RecordId,
    startedRecordId: RecordId | null,
    execution: TaskExecutionResult,
    terminal: { readonly record_ids: readonly string[] },
    contribution: DurableExecutionTerminalContribution | null = null,
    onContributionRecordId?: (recordId: RecordId) => void,
): DurableTaskExecutionResult {
    const contributionOffset = contribution === null ? 0 : 1;
    if (contribution !== null) {
        onContributionRecordId?.(terminal.record_ids[0] as RecordId);
    }
    const artifactRecordIds = Object.freeze(
        terminal.record_ids.slice(
            contributionOffset,
            contributionOffset + execution.artifacts.length,
        ) as readonly RecordId[],
    );
    const usageOffset = contributionOffset + execution.artifacts.length;
    const outcomeOffset = usageOffset + (execution.usage === null ? 0 : 1);
    const usageRecordId =
        execution.usage === null ? null : (terminal.record_ids[usageOffset] as RecordId);
    const outcomeRecordId = terminal.record_ids[outcomeOffset] as RecordId;
    const lifecycleRecordId = terminal.record_ids[outcomeOffset + 1] as RecordId;
    const cut = publishDurableExecutionCut(store, runId, lifecycleRecordId);
    return Object.freeze({
        execution,
        ledger: Object.freeze({
            artifact_record_ids: artifactRecordIds,
            cut,
            created_record_id: createdRecordId,
            lifecycle_record_id: lifecycleRecordId,
            outcome_record_id: outcomeRecordId,
            started: startedRecordId !== null,
            started_record_id: startedRecordId,
            usage_record_id: usageRecordId,
        }),
    });
}

function terminalLifecycleBody(runId: string, execution: TaskExecutionResult): SemanticRecord {
    const outcome = execution.outcome.outcome;
    if (outcome.status === FINISHED_RUN_STATUS) {
        return {
            payload: {
                control: execution.control,
                execution_id: runId,
                outputs: { value: outcome.value },
            },
        };
    }
    const error = "message" in outcome ? outcome.message : outcome.reason;
    return { payload: { control: execution.control, error, execution_id: runId } };
}

function createLedgerIntentId(runId: string, schemaRef: string): string {
    return createRecordId({ append_intent: { run_id: runId, schema_ref: schemaRef } });
}
