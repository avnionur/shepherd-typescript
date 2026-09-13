import assert from "node:assert/strict";
import {
    closeSync,
    constants,
    fstatSync,
    ftruncateSync,
    lstatSync,
    openSync,
    readFileSync,
    realpathSync,
    statSync,
    writeFileSync,
} from "node:fs";
import path from "node:path";

import {
    canonicalizeRecord,
    createRecordId,
    type SemanticRecord,
} from "../canonical/canonical-record.ts";
import { recordIdConfig, runProtocolConfig, workspaceProtocolConfig } from "../protocol/config.ts";
import { readNativeJailProcessEvidence } from "../protocol/native-jail-evidence.ts";
import {
    DURABLE_EXECUTION_RECOVERY_STATUSES,
    RECORD_MODES,
    RETAINED_WORLD_JOURNAL_PHASES,
    RETAINED_WORLD_OUTPUT_STATUSES,
    RUN_ARTIFACT_CONTENT_TYPES,
    RUN_TERMINAL_STATUSES,
} from "../protocol/values.generated.ts";
import { ROOT_WITNESS_ID } from "../record/root-witness.ts";
import type { RecordId } from "../record/types.ts";
import {
    type DurableExecutionTerminalContribution,
    executeTaskDurablyWithTerminalContribution,
} from "../run/durable-execution.ts";
import { readDurableExecutionResult } from "../run/durable-execution-codec.ts";
import { createDurableRecoveryCommand } from "../run/durable-execution-control-codec.ts";
import { retainDurableExecutionCreation } from "../run/durable-execution-creation.ts";
import { publishDurableExecutionCut } from "../run/durable-execution-cut.ts";
import { DurableExecutionRecoveryError } from "../run/durable-execution-errors.ts";
import { readDurableTaskExecution } from "../run/durable-execution-recovery.ts";
import { executeTask } from "../run/execution.ts";
import type { PreparedTaskExecution } from "../run/execution-preparation.ts";
import { prepareTaskExecution } from "../run/execution-preparation.ts";
import type { TaskExecutionResult } from "../run/execution-types.ts";
import { assertRunText } from "../run/validation-values.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import type { TaskSchema } from "../task/schema.ts";
import { assertWorkspaceBinding, isGitRepositoryBinding } from "./bindings.ts";
import { createWorldChangeset } from "./changesets.ts";
import {
    assertNativeJailPlacementResolutionContract,
    createNativeJailConfinementPlan,
    launchNativeJailRunner,
    NativeJailExecutionError,
} from "./native-jail.ts";
import type {
    NativeJailLaunchIntent,
    NativeJailLaunchReceipt,
    NativeJailPlacementResolution,
} from "./native-jail-types.ts";
import { assertGrantedPlacementResolutionContract } from "./placement.ts";
import type { GrantedPlacementResolution } from "./placement-types.ts";
import {
    assertReferenceCopyCarrier,
    forkReferenceCopyRevisionWithIdentity,
} from "./reference-copy-carrier.ts";
import type {
    GitRepositoryGrantPlan,
    GitRepositoryGrantPlanEntry,
    RepositoryGrantAtom,
} from "./repository-grant-types.ts";
import { assertGitRepositoryGrantPlan } from "./repository-grants.ts";
import { assertRetainedWorldRunner, invokeRetainedWorldRunner } from "./retained-world-runner.ts";
import type {
    RetainedWorldCapability,
    RetainedWorldExecutionContext,
} from "./retained-world-runner-types.ts";
import type {
    CaptureGrantedTaskWorldOptions,
    CaptureJailedGrantedTaskWorldOptions,
    CapturePlacedGrantedTaskWorldOptions,
    CaptureTaskWorldOptions,
    JailedTaskWorldCaptureResult,
    PlacedTaskWorldCaptureResult,
    RecoverGrantedTaskWorldOptions,
    RecoverJailedGrantedTaskWorldOptions,
    RecoverPlacedGrantedTaskWorldOptions,
    RecoverTaskWorldOptions,
    RetainedWorldOutput,
    TaskWorldCaptureResult,
} from "./task-world-execution-types.ts";
import {
    appendNativeJailProcessEvidence,
    appendTaskWorldJournal,
    inspectTaskWorldCaptureJournal,
} from "./task-world-journal.ts";
import type { GitRepositoryBinding, WorldCustody, WorldRevision } from "./types.ts";

const [RETAINED_STATUS] = RETAINED_WORLD_OUTPUT_STATUSES;
const [, , , TERMINAL_PENDING_CUT_RECOVERY_STATUS, COMMITTED_RECOVERY_STATUS] =
    DURABLE_EXECUTION_RECOVERY_STATUSES;
const [PREPARED_PHASE, FORKED_PHASE, EXECUTING_PHASE, CAPTURED_PHASE] =
    RETAINED_WORLD_JOURNAL_PHASES;
const [FINISHED_STATUS] = RUN_TERMINAL_STATUSES;
const [, BLOB_ARTIFACT_TYPE] = RUN_ARTIFACT_CONTENT_TYPES;
const [CAPTURE_MODE] = RECORD_MODES;
const NATIVE_JAIL_PROCESS_RESULTS = new WeakMap<object, NativeJailLaunchReceipt>();

type CaptureTaskWorldFields<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>> =
    | CaptureTaskWorldOptions<I, O>
    | CaptureGrantedTaskWorldOptions<I, O>
    | CaptureJailedGrantedTaskWorldOptions<I, O>
    | CapturePlacedGrantedTaskWorldOptions<I, O>;

type RecoverTaskWorldFields<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>> =
    | RecoverTaskWorldOptions<I, O>
    | RecoverGrantedTaskWorldOptions<I, O>
    | RecoverJailedGrantedTaskWorldOptions<I, O>
    | RecoverPlacedGrantedTaskWorldOptions<I, O>;

/**
 * Executes one registered runner against isolated custody and retains its verified world output.
 *
 * Runner authentication, every filesystem operation, immutable capture, and terminal publication
 * share the existing durable invocation fence. The user binding is observed before and after but
 * never supplied as runner authority. The captured record commits atomically before the ordinary
 * outcome and lifecycle terminal and is therefore included in the same immutable cut.
 *
 * @param options - Exact store, execution, binding, carrier, base, capture, and runner contract.
 * @returns Durable task result, canonical changeset, and retained world attachment.
 * @throws {TypeError} If authority, options, runner output, or relative paths are malformed.
 * @throws {TraceStoreError} If durable execution or terminal publication fails closed.
 * @throws {WorldCarrierError} If retained carrier evidence cannot be verified or captured.
 * @throws {WorldChangesetError} If the captured comparison is invalid or exceeds limits.
 *
 * @example
 * ```ts
 * const result = await captureTaskWorldDurably({
 *     baseRevision,
 *     binding,
 *     captureId: "capture:review:1",
 *     carrier,
 *     execution: { task, input, provider, runId: "run:review:1", budget: { maxTurns: 1 } },
 *     runner,
 *     store,
 * });
 * result.output.head_revision_id;
 * ```
 *
 * @public
 */
export async function captureTaskWorldDurably<
    I extends TaskSchema<unknown>,
    O extends TaskSchema<unknown>,
>(options: CaptureTaskWorldOptions<I, O>): Promise<TaskWorldCaptureResult> {
    const fields = readOptions(options);
    const retainedBase = await validateCaptureAuthority(fields);
    return executeTaskWorld(fields, retainedBase, null);
}

/**
 * Executes one retained-world task under an authenticated exact repository grant plan.
 *
 * Admission authenticates every resource in the plan before runner or provider invocation. The
 * active capability exposes only the intersection of the task grant and whole-run ceiling.
 * Enforcement is in-process advisory; this function does not claim an OS sandbox or syscall jail.
 *
 * @param options - Exact granted task-world capture contract.
 * @returns Durable task result, canonical changeset, and retained world attachment.
 * @throws {TypeError} If the plan, task, resource, authority, or options are invalid.
 * @throws {TraceStoreError} If durable execution or terminal publication fails closed.
 * @throws {WorldCarrierError} If retained carrier evidence cannot be verified or captured.
 * @throws {WorldChangesetError} If the captured comparison is invalid or exceeds limits.
 *
 * @example
 * ```ts
 * const result = await captureGrantedTaskWorldDurably({
 *     ...captureOptions,
 *     repositoryGrantPlan,
 * });
 * ```
 *
 * @public
 */
export async function captureGrantedTaskWorldDurably<
    I extends TaskSchema<unknown>,
    O extends TaskSchema<unknown>,
>(options: CaptureGrantedTaskWorldOptions<I, O>): Promise<TaskWorldCaptureResult> {
    const fields = readGrantedOptions(options);
    const retainedBase = await validateCaptureAuthority(fields);
    return executeTaskWorld(fields, retainedBase, null);
}

/**
 * Executes one granted retained-world task under exact requested/resolved placement evidence.
 *
 * @param options - Exact granted capture contract plus authenticated placement resolution.
 * @returns Durable task, retained world, changeset, and immutable placement evidence.
 * @throws {TypeError} If placement, grant, task, resource, runner, or options are inconsistent.
 * @throws {TraceStoreError} If durable execution or terminal publication fails closed.
 * @throws {WorldCarrierError} If retained carrier evidence cannot be verified or captured.
 * @throws {WorldChangesetError} If the captured comparison is invalid or exceeds limits.
 *
 * @example
 * ```ts
 * const result = await capturePlacedGrantedTaskWorldDurably({
 *     ...grantedCaptureOptions,
 *     placementResolution,
 * });
 * result.placement.resolved_placement;
 * ```
 *
 * @public
 */
export async function capturePlacedGrantedTaskWorldDurably<
    I extends TaskSchema<unknown>,
    O extends TaskSchema<unknown>,
>(options: CapturePlacedGrantedTaskWorldOptions<I, O>): Promise<PlacedTaskWorldCaptureResult> {
    const fields = readPlacedOptions(options);
    const retainedBase = await validateCaptureAuthority(fields);
    const result = await executeTaskWorld(fields, retainedBase, null);
    return Object.freeze({ ...result, placement: fields.placementResolution });
}

/**
 * Executes one granted retained-world task through an authenticated native syscall jail.
 *
 * The structured judged process runs before provider invocation. Its confinement plan is compiled
 * from the selected binding's exact effective write grant, and execution continues only after a
 * successful exit and proven process-group quiescence.
 *
 * @param options - Exact granted capture contract plus authenticated native-jail resolution.
 * @returns Durable task-world result with exact native placement and process receipt.
 * @throws {TypeError} If placement, grant, task, resource, runner, or options are inconsistent.
 * @throws {NativeJailExecutionError} If launch, exit, cancellation, timeout, output, or quiescence fails.
 *
 * @example
 * ```ts
 * const result = await captureJailedGrantedTaskWorldDurably({
 *     ...grantedCaptureOptions,
 *     nativeJailResolution,
 *     runner: nativeRunner,
 * });
 * result.process.quiescence;
 * ```
 *
 * @public
 */
export async function captureJailedGrantedTaskWorldDurably<
    I extends TaskSchema<unknown>,
    O extends TaskSchema<unknown>,
>(options: CaptureJailedGrantedTaskWorldOptions<I, O>): Promise<JailedTaskWorldCaptureResult> {
    const fields = readJailedOptions(options);
    const retainedBase = await validateCaptureAuthority(fields);
    const result = await executeTaskWorld(fields, retainedBase, null);
    const processReceipt = NATIVE_JAIL_PROCESS_RESULTS.get(result);
    /* Successful native execution always retains its exact receipt before capture. */
    /* node:coverage disable */
    if (processReceipt === undefined) throw new TypeError("native jail receipt is unavailable");
    /* node:coverage enable */
    await assertRetainedNativeJailPlanContract(fields, result);
    return Object.freeze({
        ...result,
        placement: fields.nativeJailResolution,
        process: processReceipt,
    });
}

/**
 * Resumes one pre-execution task-world capture under an explicit durable recovery command.
 *
 * Recovery reuses exact `forked` custody and creation evidence, acquires a command-authorized
 * invocation fence, and never scans carrier directories or repeats an `executing` capture.
 *
 * @param options - Exact capture contract plus globally idempotent recovery command identity.
 * @returns Durable task result and the retained world produced from the original custody.
 * @throws {TypeError} If options or retained capture evidence disagree.
 * @throws {DurableExecutionRecoveryError} If the capture is absent, uncertain, or not recoverable.
 * @throws {TraceStoreError} If command, claim, or terminal publication fails closed.
 *
 * @example
 * ```ts
 * const result = await recoverTaskWorldDurably({
 *     ...captureOptions,
 *     commandId: "command:recover-world:1",
 * });
 * result.output.custody_id;
 * ```
 *
 * @public
 */
export async function recoverTaskWorldDurably<
    I extends TaskSchema<unknown>,
    O extends TaskSchema<unknown>,
>(options: RecoverTaskWorldOptions<I, O>): Promise<TaskWorldCaptureResult> {
    return recoverTaskWorld(readRecoveryOptions(options));
}

/**
 * Recovers a repository-granted task-world capture only under the exact prepared grant plan.
 *
 * @param options - Exact granted capture contract plus recovery command identity.
 * @returns Recovered durable task result and retained world.
 * @throws {TypeError} If current grant evidence differs from the prepared contract.
 * @throws {DurableExecutionRecoveryError} If the capture is absent, uncertain, or unrecoverable.
 * @throws {TraceStoreError} If command, claim, or terminal publication fails closed.
 * @throws {WorldCarrierError} If retained carrier evidence cannot be reopened or captured.
 * @throws {WorldChangesetError} If retained comparison evidence is invalid or exceeds limits.
 *
 * @example
 * ```ts
 * const result = await recoverGrantedTaskWorldDurably({
 *     ...grantedCaptureOptions,
 *     commandId: "command:recover-granted-world:1",
 * });
 * ```
 *
 * @public
 */
export async function recoverGrantedTaskWorldDurably<
    I extends TaskSchema<unknown>,
    O extends TaskSchema<unknown>,
>(options: RecoverGrantedTaskWorldOptions<I, O>): Promise<TaskWorldCaptureResult> {
    return recoverTaskWorld(readGrantedRecoveryOptions(options));
}

/**
 * Recovers a placed granted task-world capture under the exact prepared placement resolution.
 *
 * @param options - Exact placed capture contract plus recovery command identity.
 * @returns Recovered task-world result with exact placement evidence.
 * @throws {TypeError} If current placement or retained evidence differs from the prepared contract.
 * @throws {DurableExecutionRecoveryError} If the capture is absent, uncertain, or unrecoverable.
 * @throws {TraceStoreError} If command, claim, or terminal publication fails closed.
 * @throws {WorldCarrierError} If retained carrier evidence cannot be reopened or captured.
 * @throws {WorldChangesetError} If retained comparison evidence is invalid or exceeds limits.
 *
 * @example
 * ```ts
 * const result = await recoverPlacedGrantedTaskWorldDurably({
 *     ...placedCaptureOptions,
 *     commandId: "command:recover-placed-world:1",
 * });
 * ```
 *
 * @public
 */
export async function recoverPlacedGrantedTaskWorldDurably<
    I extends TaskSchema<unknown>,
    O extends TaskSchema<unknown>,
>(options: RecoverPlacedGrantedTaskWorldOptions<I, O>): Promise<PlacedTaskWorldCaptureResult> {
    const fields = readPlacedRecoveryOptions(options);
    const result = await recoverTaskWorld(fields);
    return Object.freeze({ ...result, placement: fields.placementResolution });
}

/**
 * Reopens one native-jailed capture without repeating uncertain external process work.
 *
 * @param options - Exact jailed capture contract plus recovery command identity.
 * @returns Recovered task-world result with reconstructed native placement and process receipt.
 * @throws {DurableExecutionRecoveryError} If process start is uncertain or evidence is incomplete.
 * @throws {TypeError} If retained native-jail evidence differs from current authority.
 *
 * @example
 * ```ts
 * const result = await recoverJailedGrantedTaskWorldDurably({
 *     ...jailedCaptureOptions,
 *     commandId: "command:recover-native:1",
 * });
 * ```
 *
 * @public
 */
export async function recoverJailedGrantedTaskWorldDurably<
    I extends TaskSchema<unknown>,
    O extends TaskSchema<unknown>,
>(options: RecoverJailedGrantedTaskWorldOptions<I, O>): Promise<JailedTaskWorldCaptureResult> {
    const fields = readJailedRecoveryOptions(options);
    const result = await recoverTaskWorld(fields);
    const processReceipt = readRetainedNativeJailReceipt(fields.store, fields.execution.runId);
    await assertRetainedNativeJailPlanContract(fields, result);
    return Object.freeze({
        ...result,
        placement: fields.nativeJailResolution,
        process: processReceipt,
    });
}

async function recoverTaskWorld<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>>(
    fields: RecoverTaskWorldFields<I, O>,
): Promise<TaskWorldCaptureResult> {
    const retainedBase = await validateCaptureAuthority(fields);
    const prepared = prepareTaskExecution(fields.execution);
    const createdRecordId = retainDurableExecutionCreation(fields.store, prepared);
    const inspection = inspectTaskWorldCaptureJournal(fields.store, fields.execution.runId);
    const preparedTransition = inspection.transitions[0];
    if (preparedTransition !== undefined) {
        assertPreparedRecoveryContract(preparedTransition.body, fields, retainedBase);
    }
    if (inspection.status === RETAINED_STATUS) {
        if (inspection.recovery_status === TERMINAL_PENDING_CUT_RECOVERY_STATUS) {
            const pending = readDurableTaskExecution(fields.store, prepared.definition.runId);
            /* node:coverage ignore next 7 */
            if (pending.status === COMMITTED_RECOVERY_STATUS) {
                return rebuildRetainedTaskWorld(fields, retainedBase, inspection.output_record_id);
            }
            assert.equal(pending.status, TERMINAL_PENDING_CUT_RECOVERY_STATUS);
            const commandRecordId = retainRecoveryCommand(
                fields.store,
                prepared.definition.runId,
                createdRecordId,
                fields.commandId,
            );
            publishDurableExecutionCut(
                fields.store,
                prepared.definition.runId,
                pending.ledger.lifecycle_record_id,
                commandRecordId,
            );
        } else {
            /* node:coverage ignore next 3 */
            if (inspection.recovery_status !== COMMITTED_RECOVERY_STATUS) {
                throw new DurableExecutionRecoveryError(prepared.definition.runId);
            }
        }
        return rebuildRetainedTaskWorld(fields, retainedBase, inspection.output_record_id);
    }
    if (inspection.capture_id !== fields.captureId) {
        throw new DurableExecutionRecoveryError(fields.execution.runId);
    }
    const [, retainedForkedTransition] = inspection.transitions;
    if (
        preparedTransition === undefined ||
        ![PREPARED_PHASE, FORKED_PHASE].includes(inspection.status as never) ||
        inspection.transitions.length !== (inspection.status === PREPARED_PHASE ? 1 : 2)
    ) {
        throw new DurableExecutionRecoveryError(fields.execution.runId);
    }
    const observedBefore = await fields.carrier.snapshot(fields.binding);
    if (observedBefore.revision_id !== retainedBase.revision_id) {
        throw new TypeError("task-world recovery custody or user basis is inconsistent");
    }
    const commandRecordId = retainRecoveryCommand(
        fields.store,
        prepared.definition.runId,
        createdRecordId,
        fields.commandId,
    );
    const custody =
        retainedForkedTransition === undefined
            ? forkReferenceCopyRevisionWithIdentity(
                  fields.carrier,
                  retainedBase.revision_id,
                  taskWorldCustodyId(prepared.definition.runId, fields.captureId),
              )
            : await fields.carrier.openCustody(retainedForkedTransition.body.custody_id as string);
    if (
        custody.base_revision_id !== retainedBase.revision_id ||
        (retainedForkedTransition !== undefined &&
            retainedForkedTransition.body.user_basis_before !== observedBefore.content_id)
    ) {
        throw new TypeError("task-world recovery custody or user basis is inconsistent");
    }
    const forkedRecordId =
        retainedForkedTransition?.record_id ??
        appendTaskWorldJournal(
            fields.store,
            prepared.definition.runId,
            fields.captureId,
            FORKED_PHASE,
            {
                custody_id: custody.custody_id,
                user_basis_before: observedBefore.content_id,
            },
            [preparedTransition.record_id],
            taskWorldJournalWriter(fields),
        );
    return executeTaskWorld(fields, retainedBase, {
        commandRecordId,
        custody,
        forkedRecordId,
        observedBefore,
    });
}

function assertPreparedRecoveryContract<
    I extends TaskSchema<unknown>,
    O extends TaskSchema<unknown>,
>(
    preparedBody: SemanticRecord,
    fields: CaptureTaskWorldFields<I, O>,
    retainedBase: WorldRevision,
): void {
    if (
        preparedBody.base_revision_id !== retainedBase.revision_id ||
        preparedBody.binding_id !== fields.binding.binding_id ||
        preparedBody.runner_id !== fields.runner.runner_id ||
        preparedBody.enforcement !== fields.runner.enforcement ||
        preparedBody.max_capture_id_bytes !==
            workspaceProtocolConfig.worldTaskCapture.maxCaptureIdBytes ||
        preparedBody.max_text_bytes !== workspaceProtocolConfig.worldTaskCapture.maxTextBytes ||
        canonicalizeRecord({
            repository_grant_plan: preparedBody.repository_grant_plan ?? null,
        }) !== canonicalizeRecord({ repository_grant_plan: repositoryGrantPlan(fields) }) ||
        (preparedBody.repository_grant_plan_id ?? null) !==
            (repositoryGrantPlan(fields)?.plan_id ?? null) ||
        canonicalizeRecord({ placement_resolution: preparedBody.placement_resolution ?? null }) !==
            canonicalizeRecord({ placement_resolution: placementResolution(fields) }) ||
        (preparedBody.placement_resolution_id ?? null) !==
            (placementResolution(fields)?.resolution_id ?? null) ||
        canonicalizeRecord({
            native_jail_resolution: preparedBody.native_jail_resolution ?? null,
        }) !==
            canonicalizeRecord({
                native_jail_resolution: nativeJailPlacementResolution(fields),
            }) ||
        (preparedBody.native_jail_resolution_id ?? null) !==
            (nativeJailPlacementResolution(fields)?.resolution_id ?? null)
    ) {
        throw new TypeError("task-world recovery contract differs from prepared evidence");
    }
}

function retainRecoveryCommand(
    store: SQLiteTraceStore,
    runId: string,
    createdRecordId: RecordId,
    commandId: string,
): RecordId {
    const command = store.append({
        append_intent_id: createRecordId({ durable_control_command_id: commandId }),
        batch: {
            groups: [
                {
                    caused_by_record_ids: [createdRecordId],
                    owner_id: runId,
                    records: [
                        {
                            body: createDurableRecoveryCommand(runId, commandId),
                            mode: CAPTURE_MODE,
                            schema_ref: runProtocolConfig.execution.controlCommandSchemaId,
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    });
    return command.record_ids[0] as RecordId;
}

async function rebuildRetainedTaskWorld<
    I extends TaskSchema<unknown>,
    O extends TaskSchema<unknown>,
>(
    fields: RecoverTaskWorldFields<I, O>,
    retainedBase: WorldRevision,
    outputRecordId: RecordId | null,
): Promise<TaskWorldCaptureResult> {
    const recovery = readDurableTaskExecution(fields.store, fields.execution.runId);
    // Retained inspection constructs its status from the presence of this exact record.
    /* node:coverage ignore next 3 */
    if (outputRecordId === null) {
        throw new DurableExecutionRecoveryError(fields.execution.runId);
    }
    const outputRecord = fields.store.readRecord(outputRecordId);
    if (recovery.status !== COMMITTED_RECOVERY_STATUS || outputRecord === undefined) {
        throw new DurableExecutionRecoveryError(fields.execution.runId);
    }
    const body = outputRecord.body as unknown as Omit<
        RetainedWorldOutput,
        "capture_record_id" | "execution_cut" | "execution_outcome_record_id"
    >;
    if (
        body.base_revision_id !== retainedBase.revision_id ||
        body.binding_id !== fields.binding.binding_id ||
        body.capture_id !== fields.captureId ||
        body.run_id !== fields.execution.runId
    ) {
        throw new TypeError("retained task-world output differs from recovery options");
    }
    const head = await fields.carrier.openRevision(body.head_revision_id);
    const changeset = await createWorldChangeset({
        baseRevision: retainedBase,
        carrier: fields.carrier,
        headRevision: head,
    });
    if (changeset.changeset_id !== body.changeset_id) {
        throw new TypeError("retained task-world changeset is inconsistent");
    }
    return Object.freeze({
        ...recovery.result,
        changeset,
        output: Object.freeze({
            ...body,
            capture_record_id: outputRecordId,
            execution_cut: recovery.result.ledger.cut,
            execution_outcome_record_id: recovery.result.ledger.outcome_record_id,
        }),
    });
}

async function validateCaptureAuthority<
    I extends TaskSchema<unknown>,
    O extends TaskSchema<unknown>,
>(fields: CaptureTaskWorldFields<I, O>): Promise<WorldRevision> {
    assertReferenceCopyCarrier(fields.carrier);
    assertRetainedWorldRunner(fields.runner);
    assertWorkspaceBinding(fields.binding);
    activeRepositoryGrant(fields);
    const placement = placementResolution(fields);
    if (placement !== null) {
        assertGrantedPlacementResolutionContract(placement, {
            captureId: fields.captureId,
            repositoryGrantPlan: (fields as CapturePlacedGrantedTaskWorldOptions<I, O>)
                .repositoryGrantPlan,
            runId: fields.execution.runId,
            runner: fields.runner,
        });
    }
    const nativePlacement = nativeJailPlacementResolution(fields);
    if (nativePlacement !== null) {
        assertNativeJailPlacementResolutionContract(nativePlacement, {
            captureId: fields.captureId,
            repositoryGrantPlan: (fields as CaptureJailedGrantedTaskWorldOptions<I, O>)
                .repositoryGrantPlan,
            runId: fields.execution.runId,
            runner: fields.runner,
        });
    }
    assertText(
        fields.captureId,
        "captureId",
        workspaceProtocolConfig.worldTaskCapture.maxCaptureIdBytes,
    );
    const retainedBase = await fields.carrier.openRevision(fields.baseRevision.revision_id);
    if (
        canonicalizeRecord(retainedBase as unknown as SemanticRecord) !==
            canonicalizeRecord(fields.baseRevision as unknown as SemanticRecord) ||
        retainedBase.binding_id !== fields.binding.binding_id ||
        retainedBase.revision_id !== fields.baseRevision.revision_id
    ) {
        throw new TypeError("base revision differs from retained carrier evidence");
    }
    return retainedBase;
}

async function executeTaskWorld<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>>(
    fields: CaptureTaskWorldFields<I, O>,
    retainedBase: WorldRevision,
    recovery: {
        readonly commandRecordId: RecordId;
        readonly custody: WorldCustody;
        readonly forkedRecordId: RecordId;
        readonly observedBefore: WorldRevision;
    } | null,
): Promise<TaskWorldCaptureResult> {
    let changesetResult: Awaited<ReturnType<typeof createWorldChangeset>> | null = null;
    let retainedOutput: Omit<
        RetainedWorldOutput,
        "capture_record_id" | "execution_cut" | "execution_outcome_record_id"
    > | null = null;
    let observedBefore: WorldRevision | null = recovery?.observedBefore ?? null;
    let custody: WorldCustody | null = recovery?.custody ?? null;
    let forkedRecordId: RecordId | null = recovery?.forkedRecordId ?? null;
    const durable = await executeTaskDurablyWithTerminalContribution(
        fields.store,
        fields.execution,
        recovery?.commandRecordId ?? null,
        async (prepared, createdRecordId) => {
            if (recovery !== null) return;
            observedBefore = await fields.carrier.snapshot(fields.binding);
            if (observedBefore.revision_id !== retainedBase.revision_id) {
                throw new TypeError("user basis differs from base");
            }
            const preparedRecordId = appendTaskWorldJournal(
                fields.store,
                prepared.definition.runId,
                fields.captureId,
                PREPARED_PHASE,
                {
                    base_revision_id: retainedBase.revision_id,
                    binding_id: fields.binding.binding_id,
                    enforcement: fields.runner.enforcement,
                    max_capture_id_bytes:
                        workspaceProtocolConfig.worldTaskCapture.maxCaptureIdBytes,
                    max_text_bytes: workspaceProtocolConfig.worldTaskCapture.maxTextBytes,
                    ...taskWorldPreparedAuthorityEvidence(fields),
                    runner_id: fields.runner.runner_id,
                },
                [createdRecordId],
                taskWorldJournalWriter(fields),
            );
            custody = forkReferenceCopyRevisionWithIdentity(
                fields.carrier,
                retainedBase.revision_id,
                taskWorldCustodyId(prepared.definition.runId, fields.captureId),
            );
            forkedRecordId = appendTaskWorldJournal(
                fields.store,
                prepared.definition.runId,
                fields.captureId,
                FORKED_PHASE,
                {
                    custody_id: custody.custody_id,
                    user_basis_before: observedBefore.content_id,
                },
                [preparedRecordId],
                taskWorldJournalWriter(fields),
            );
        },
        async (prepared, authority) => {
            assert.ok(observedBefore !== null && custody !== null && forkedRecordId !== null);
            const executingRecordId = appendTaskWorldJournal(
                fields.store,
                prepared.definition.runId,
                fields.captureId,
                EXECUTING_PHASE,
                {
                    claim_id: authority.claimId,
                    custody_id: custody.custody_id,
                    fencing_token: authority.fencingToken,
                },
                [forkedRecordId, authority.startedRecordId],
                taskWorldJournalWriter(fields),
                authority,
            );
            let active = true;
            const assertFence = () => {
                if (
                    !active ||
                    !fields.store.hasDurableExecutionInvocationAuthority(
                        prepared.definition.runId,
                        authority.claimId,
                        authority.fencingToken,
                    )
                ) {
                    throw new TypeError("retained-world capability fence is stale");
                }
            };
            const world = createCapability(
                custody,
                authority.fencingToken,
                fields.runner.enforcement,
                activeRepositoryGrant(fields)?.authority ??
                    workspaceProtocolConfig.repositoryGrants.atoms,
                repositoryGrantPlan(fields) !== null,
                assertFence,
            );
            const runnerContext = Object.freeze({
                capture_fence: authority.fencingToken,
                execution: prepared.definition,
                signal: prepared.definition.signal ?? new AbortController().signal,
                world,
            }) satisfies RetainedWorldExecutionContext<I, O>;
            let execution: TaskExecutionResult;
            let capturedParentRecordId = executingRecordId;
            let nativeProcessReceipt: NativeJailLaunchReceipt | null = null;
            try {
                if (nativeJailPlacementResolution(fields) === null) {
                    execution = await invokeRetainedWorldRunner(fields.runner, runnerContext);
                } else {
                    const grant = activeRepositoryGrant(fields);
                    assert.ok(grant !== null);
                    const plan = createNativeJailConfinementPlan(
                        fields.runner,
                        custody.path,
                        grant.authority.includes(
                            workspaceProtocolConfig.repositoryGrants.operations
                                .writeText as RepositoryGrantAtom,
                        ),
                    );
                    let processParentRecordId = executingRecordId;
                    nativeProcessReceipt = await launchNativeJailRunner(
                        fields.runner,
                        plan,
                        runnerContext.signal,
                        {
                            onIntent: (intent) => {
                                processParentRecordId = appendNativeJailProcessEvidence(
                                    fields.store,
                                    prepared.definition.runId,
                                    intent,
                                    [processParentRecordId],
                                    authority,
                                );
                            },
                            onReceipt: (receipt) => {
                                processParentRecordId = appendNativeJailProcessEvidence(
                                    fields.store,
                                    prepared.definition.runId,
                                    receipt,
                                    [processParentRecordId],
                                    authority,
                                );
                            },
                            onStarted: (started) => {
                                processParentRecordId = appendNativeJailProcessEvidence(
                                    fields.store,
                                    prepared.definition.runId,
                                    started,
                                    [processParentRecordId],
                                    authority,
                                );
                            },
                        },
                    );
                    capturedParentRecordId = processParentRecordId;
                    const processPolicy = workspaceProtocolConfig.placements.nativeJails.process;
                    /* Each non-success classification is covered by native process fixtures. */
                    /* node:coverage disable */
                    if (
                        nativeProcessReceipt.status !== processPolicy.statusRoles.exited ||
                        nativeProcessReceipt.exit_code !== 0 ||
                        nativeProcessReceipt.quiescence !==
                            processPolicy.quiescenceStatusRoles.proven
                    ) {
                        throw new NativeJailExecutionError(nativeProcessReceipt);
                    }
                    /* node:coverage enable */
                    execution = await executeTask(prepared.definition);
                }
            } finally {
                active = false;
            }
            execution = readRunnerResult(execution, prepared, fields.store);
            if (
                !fields.store.hasDurableExecutionInvocationAuthority(
                    prepared.definition.runId,
                    authority.claimId,
                    authority.fencingToken,
                )
            ) {
                throw new TypeError("retained-world capture fence is stale");
            }
            const head = await fields.carrier.captureCustody(custody.custody_id);
            const changeset = await createWorldChangeset({
                baseRevision: retainedBase,
                carrier: fields.carrier,
                headRevision: head,
            });
            const observedAfter = await fields.carrier.snapshot(fields.binding);
            if (observedAfter.revision_id !== observedBefore.revision_id) {
                throw new TypeError("user basis moved during retained-world execution");
            }
            const capturedRecordId = appendTaskWorldJournal(
                fields.store,
                prepared.definition.runId,
                fields.captureId,
                CAPTURED_PHASE,
                {
                    changeset_id: changeset.changeset_id,
                    custody_id: custody.custody_id,
                    head_revision_id: head.revision_id,
                    user_basis_after: observedAfter.content_id,
                    user_basis_before: observedBefore.content_id,
                },
                [capturedParentRecordId],
                taskWorldJournalWriter(fields),
                authority,
            );
            const semantic = {
                base_revision_id: retainedBase.revision_id,
                binding_id: retainedBase.binding_id,
                capture_id: fields.captureId,
                changeset_id: changeset.changeset_id,
                custody_id: custody.custody_id,
                head_revision_id: head.revision_id,
                run_id: prepared.definition.runId,
                schema_version: workspaceProtocolConfig.worldTaskCapture.version,
                status: RETAINED_STATUS,
                user_basis_after: observedAfter.content_id,
                user_basis_before: observedBefore.content_id,
            } as const;
            const digest = createRecordId({ retained_world_output: semantic });
            const outputId = `${workspaceProtocolConfig.worldTaskCapture.outputIdPrefix}${digest.slice(digest.lastIndexOf(":") + 1)}`;
            const body = Object.freeze({ output_id: outputId, ...semantic }) as SemanticRecord;
            changesetResult = changeset;
            retainedOutput = Object.freeze({
                base_revision_id: retainedBase.revision_id,
                binding_id: retainedBase.binding_id,
                capture_id: fields.captureId,
                custody_id: custody.custody_id,
                changeset_id: changeset.changeset_id,
                head_revision_id: head.revision_id,
                output_id: outputId,
                run_id: prepared.definition.runId,
                schema_version: workspaceProtocolConfig.worldTaskCapture.version,
                status: RETAINED_STATUS,
                user_basis_after: observedAfter.content_id,
                user_basis_before: observedBefore.content_id,
            });
            const contribution: DurableExecutionTerminalContribution = Object.freeze({
                body,
                causedByRecordIds: Object.freeze([capturedRecordId]),
                localId: workspaceProtocolConfig.worldTaskCapture.captureSchemaId,
                schemaRef: workspaceProtocolConfig.worldTaskCapture.captureSchemaId,
            });
            return Object.freeze({ contribution, execution });
        },
    );
    assert.ok(changesetResult !== null && retainedOutput !== null);
    const output = retainedOutput as Omit<
        RetainedWorldOutput,
        "capture_record_id" | "execution_cut" | "execution_outcome_record_id"
    >;
    const result = Object.freeze({
        ...durable.result,
        changeset: changesetResult,
        output: Object.freeze({
            ...output,
            capture_record_id: durable.contributionRecordId,
            execution_cut: durable.result.ledger.cut,
            execution_outcome_record_id: durable.result.ledger.outcome_record_id,
        }),
    });
    if (nativeJailPlacementResolution(fields) !== null) {
        const processReceipt = readRetainedNativeJailReceipt(fields.store, fields.execution.runId);
        NATIVE_JAIL_PROCESS_RESULTS.set(result, processReceipt);
    }
    return result;
}

function taskWorldCustodyId(runId: string, captureId: string): string {
    const digest = createRecordId({
        [workspaceProtocolConfig.worldTaskCapture.custodyIdentityKind]: {
            capture_id: captureId,
            run_id: runId,
        },
    });
    return `${workspaceProtocolConfig.carrier.custodyIdPrefix}${digest.slice(recordIdConfig.prefix.length)}`;
}

function createCapability(
    custody: WorldCustody,
    fencingToken: number,
    enforcement: RetainedWorldCapability["enforcement"],
    grantedAuthority: readonly string[],
    protectGitMetadata: boolean,
    assertFence: () => void,
): RetainedWorldCapability {
    return Object.freeze({
        base_revision_id: custody.base_revision_id,
        binding_id: custody.binding_id,
        capture_fence: fencingToken,
        custody_id: custody.custody_id,
        enforcement,
        readText: async (relativePath: string) =>
            runFileOperation(() => {
                assertFence();
                assertAuthority(
                    grantedAuthority,
                    workspaceProtocolConfig.repositoryGrants.operations
                        .readText as RepositoryGrantAtom,
                );
                const filePath = resolveRegularFile(custody.path, relativePath, protectGitMetadata);
                const descriptor = openSync(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
                try {
                    assertOpenedRegularFile(custody.path, filePath, descriptor);
                    assertFence();
                    const bytes = readFileSync(descriptor);
                    if (bytes.byteLength > workspaceProtocolConfig.worldTaskCapture.maxTextBytes) {
                        throw new TypeError("retained-world text exceeds configured limit");
                    }
                    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
                } finally {
                    closeSync(descriptor);
                }
            }),
        writeText: async (relativePath: string, text: string) =>
            runFileOperation(() => {
                assertFence();
                assertAuthority(
                    grantedAuthority,
                    workspaceProtocolConfig.repositoryGrants.operations
                        .writeText as RepositoryGrantAtom,
                );
                if (
                    typeof text !== "string" ||
                    /[\uD800-\uDFFF]/u.test(text) ||
                    Buffer.byteLength(text) > workspaceProtocolConfig.worldTaskCapture.maxTextBytes
                ) {
                    throw new TypeError("retained-world text is invalid or too large");
                }
                const { create, filePath } = resolveWritableFile(
                    custody.path,
                    relativePath,
                    protectGitMetadata,
                );
                const descriptor = openSync(
                    filePath,
                    constants.O_WRONLY |
                        constants.O_NOFOLLOW |
                        (create ? constants.O_CREAT | constants.O_EXCL : 0),
                    constants.S_IRUSR | constants.S_IWUSR,
                );
                try {
                    assertOpenedRegularFile(custody.path, filePath, descriptor);
                    assertFence();
                    ftruncateSync(descriptor, 0);
                    writeFileSync(descriptor, text, "utf8");
                } finally {
                    closeSync(descriptor);
                }
            }),
    });
}

function runFileOperation<T>(operation: () => T): T {
    try {
        return operation();
    } catch (error) {
        if (error instanceof TypeError) throw error;
        throw new TypeError("retained-world filesystem operation failed", { cause: error });
    }
}

function assertAuthority(authority: readonly string[], atom: RepositoryGrantAtom): void {
    if (!authority.includes(atom)) {
        throw new TypeError(`repository grant does not grant ${atom} authority`);
    }
}

function repositoryGrantPlan<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>>(
    fields: CaptureTaskWorldFields<I, O>,
): GitRepositoryGrantPlan | null {
    return "repositoryGrantPlan" in fields ? fields.repositoryGrantPlan : null;
}

function placementResolution<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>>(
    fields: CaptureTaskWorldFields<I, O>,
): GrantedPlacementResolution | null {
    return "placementResolution" in fields ? fields.placementResolution : null;
}

function nativeJailPlacementResolution<
    I extends TaskSchema<unknown>,
    O extends TaskSchema<unknown>,
>(fields: CaptureTaskWorldFields<I, O>): NativeJailPlacementResolution | null {
    return "nativeJailResolution" in fields ? fields.nativeJailResolution : null;
}

function taskWorldJournalWriter<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>>(
    fields: CaptureTaskWorldFields<I, O>,
): { readonly schemaId: string; readonly version: number } {
    const version =
        nativeJailPlacementResolution(fields) !== null
            ? workspaceProtocolConfig.placements.nativeJails.journalVersion
            : placementResolution(fields) !== null
              ? workspaceProtocolConfig.placements.journalVersion
              : repositoryGrantPlan(fields) !== null
                ? workspaceProtocolConfig.repositoryGrants.journalVersion
                : workspaceProtocolConfig.worldTaskCapture.ordinaryJournalVersion;
    const writer = workspaceProtocolConfig.worldTaskCapture.journalReaders.find(
        (reader) => reader.version === version,
    );
    /* Config validation requires every selected writer version to have one exact reader. */
    /* node:coverage ignore next 3 */
    if (writer === undefined) {
        throw new TypeError("task-world journal writer contract is unavailable");
    }
    return writer;
}

function taskWorldPreparedAuthorityEvidence<
    I extends TaskSchema<unknown>,
    O extends TaskSchema<unknown>,
>(fields: CaptureTaskWorldFields<I, O>): SemanticRecord {
    const grantPlan = repositoryGrantPlan(fields);
    const placement = placementResolution(fields);
    const nativePlacement = nativeJailPlacementResolution(fields);
    return {
        ...(nativePlacement === null
            ? {}
            : {
                  native_jail_resolution: nativePlacement,
                  native_jail_resolution_id: nativePlacement.resolution_id,
              }),
        ...(placement === null
            ? nativePlacement === null
                ? {}
                : { placement_resolution: null, placement_resolution_id: null }
            : {
                  placement_resolution: placement,
                  placement_resolution_id: placement.resolution_id,
              }),
        ...(grantPlan === null
            ? {}
            : {
                  repository_grant_plan: grantPlan,
                  repository_grant_plan_id: grantPlan.plan_id,
              }),
    } as SemanticRecord;
}

function activeRepositoryGrant<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>>(
    fields: CaptureTaskWorldFields<I, O>,
): GitRepositoryGrantPlanEntry | null {
    const plan = repositoryGrantPlan(fields);
    if (plan === null) return null;
    if (!isGitRepositoryBinding(fields.binding)) {
        throw new TypeError("repository-granted execution requires an exact repository binding");
    }
    return assertGitRepositoryGrantPlan(
        plan,
        fields.execution.task.artifactLock.artifact_digest,
        fields.binding as GitRepositoryBinding,
    );
}

function assertOpenedRegularFile(root: string, filePath: string, descriptor: number): void {
    const opened = fstatSync(descriptor, { bigint: true });
    const canonicalRoot = realpathSync(root);
    const canonicalFile = realpathSync(filePath);
    const relative = path.relative(canonicalRoot, canonicalFile);
    const observed = statSync(canonicalFile, { bigint: true });
    // Requires replacement between open and descriptor identity comparison.
    /* node:coverage ignore next 13 */
    if (
        !opened.isFile() ||
        !observed.isFile() ||
        relative === "" ||
        relative === ".." ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative) ||
        opened.dev !== observed.dev ||
        opened.ino !== observed.ino
    ) {
        throw new TypeError("retained-world opened file escaped isolated custody");
    }
}

function resolveRegularFile(
    root: string,
    relativePath: string,
    protectGitMetadata: boolean,
): string {
    const parts = readCapabilityPath(relativePath, protectGitMetadata);
    let current = root;
    for (const part of parts) {
        current = path.join(current, part);
        const status = lstatSync(current);
        if (status.isSymbolicLink())
            throw new TypeError("retained-world symbolic links are not file authority");
    }
    if (!lstatSync(current).isFile())
        throw new TypeError("retained-world path is not a regular file");
    return current;
}

function resolveWritableFile(
    root: string,
    relativePath: string,
    protectGitMetadata: boolean,
): { readonly create: boolean; readonly filePath: string } {
    const parts = readCapabilityPath(relativePath, protectGitMetadata);
    let current = root;
    for (const [index, part] of parts.entries()) {
        current = path.join(current, part);
        try {
            const status = lstatSync(current);
            if (status.isSymbolicLink()) {
                throw new TypeError("retained-world symbolic links are not file authority");
            }
            if (index < parts.length - 1 && !status.isDirectory()) {
                throw new TypeError("retained-world parent path is not a directory");
            }
            if (index === parts.length - 1 && !status.isFile()) {
                throw new TypeError("retained-world path is not a regular file");
            }
        } catch (error) {
            if (
                index === parts.length - 1 &&
                parts.length === 1 &&
                (error as NodeJS.ErrnoException).code === "ENOENT"
            ) {
                return { create: true, filePath: current };
            }
            throw error;
        }
    }
    return { create: false, filePath: current };
}

function readCapabilityPath(relativePath: string, protectGitMetadata: boolean): readonly string[] {
    if (
        typeof relativePath !== "string" ||
        relativePath.length === 0 ||
        path.isAbsolute(relativePath) ||
        relativePath.includes("\\") ||
        relativePath
            .split("/")
            .some(
                (part) =>
                    part.length === 0 ||
                    part === "." ||
                    part === ".." ||
                    part === workspaceProtocolConfig.controlDirectory ||
                    (protectGitMetadata && part === workspaceProtocolConfig.gitMetadataName),
            )
    ) {
        throw new TypeError("retained-world path is invalid");
    }
    return relativePath.split("/");
}

function readRunnerResult<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>>(
    value: unknown,
    prepared: PreparedTaskExecution<I, O>,
    store: CaptureTaskWorldFields<I, O>["store"],
): TaskExecutionResult {
    // Exotic prototypes are rejected at the registered runner boundary.
    /* node:coverage disable */
    if (
        value === null ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    ) {
        throw new TypeError("retained-world runner returned an invalid execution result");
    }
    /* node:coverage enable */
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const expected = ["artifacts", "control", "outcome", "provider", "usage"];
    const keys = Reflect.ownKeys(descriptors).sort();
    if (
        keys.length !== expected.length ||
        keys.some((key, index) => key !== expected[index]) ||
        expected.some((key) => {
            const descriptor = descriptors[key];
            return descriptor === undefined || !("value" in descriptor);
        })
    ) {
        throw new TypeError("retained-world runner returned an invalid execution result");
    }
    const fields = Object.fromEntries(
        expected.map((key) => [key, (descriptors[key] as PropertyDescriptor).value]),
    ) as Record<(typeof expected)[number], unknown>;
    const execution = readDurableExecutionResult(
        fields.artifacts as readonly unknown[],
        fields.outcome,
        fields.usage,
        fields.provider,
        fields.control,
        prepared.definition.budget,
        true,
        prepared.definition.runId,
        true,
    );
    if (
        canonicalizeRecord(execution.provider as unknown as SemanticRecord) !==
            canonicalizeRecord(prepared.provider as unknown as SemanticRecord) ||
        canonicalizeRecord(execution.outcome.task_artifact_lock as unknown as SemanticRecord) !==
            canonicalizeRecord(prepared.definition.task.artifactLock as unknown as SemanticRecord)
    ) {
        throw new TypeError("retained-world runner result authority is inconsistent");
    }
    if (execution.outcome.outcome.status === FINISHED_STATUS) {
        prepared.definition.task.parseOutput(execution.outcome.outcome.value);
    }
    for (const artifact of execution.artifacts) {
        if (artifact.content.type === BLOB_ARTIFACT_TYPE) {
            const content = store.readBlob(artifact.content.blob_id);
            if (content === undefined || content.byteLength !== artifact.content.byte_length) {
                throw new TypeError("retained-world runner artifact blob is unavailable");
            }
        }
    }
    return execution;
}

function readOptions<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>>(
    value: CaptureTaskWorldOptions<I, O>,
): CaptureTaskWorldOptions<I, O> {
    return readExactOptions(value, [
        "baseRevision",
        "binding",
        "captureId",
        "carrier",
        "execution",
        "runner",
        "store",
    ]) as unknown as CaptureTaskWorldOptions<I, O>;
}

function readGrantedOptions<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>>(
    value: CaptureGrantedTaskWorldOptions<I, O>,
): CaptureGrantedTaskWorldOptions<I, O> {
    return readExactOptions(value, [
        "baseRevision",
        "binding",
        "captureId",
        "carrier",
        "execution",
        "repositoryGrantPlan",
        "runner",
        "store",
    ]) as unknown as CaptureGrantedTaskWorldOptions<I, O>;
}

function readPlacedOptions<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>>(
    value: CapturePlacedGrantedTaskWorldOptions<I, O>,
): CapturePlacedGrantedTaskWorldOptions<I, O> {
    return readExactOptions(value, [
        "baseRevision",
        "binding",
        "captureId",
        "carrier",
        "execution",
        "placementResolution",
        "repositoryGrantPlan",
        "runner",
        "store",
    ]) as unknown as CapturePlacedGrantedTaskWorldOptions<I, O>;
}

function readJailedOptions<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>>(
    value: CaptureJailedGrantedTaskWorldOptions<I, O>,
): CaptureJailedGrantedTaskWorldOptions<I, O> {
    return readExactOptions(value, [
        "baseRevision",
        "binding",
        "captureId",
        "carrier",
        "execution",
        "nativeJailResolution",
        "repositoryGrantPlan",
        "runner",
        "store",
    ]) as unknown as CaptureJailedGrantedTaskWorldOptions<I, O>;
}

function readExactOptions(value: unknown, expected: readonly string[]): Record<string, unknown> {
    if (
        value === null ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    )
        throw new TypeError("task-world capture options must be exact data");
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors).sort();
    if (
        keys.length !== expected.length ||
        keys.some((key, index) => key !== expected[index]) ||
        expected.some((key) => {
            const descriptor = descriptors[key];
            return descriptor === undefined || !("value" in descriptor);
        })
    )
        throw new TypeError("task-world capture options must be exact data");
    return Object.freeze(
        Object.fromEntries(
            expected.map((key) => [key, (descriptors[key] as PropertyDescriptor).value]),
        ),
    );
}

function readRecoveryOptions<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>>(
    value: RecoverTaskWorldOptions<I, O>,
): RecoverTaskWorldOptions<I, O> {
    const fields = readExactOptions(value, [
        "baseRevision",
        "binding",
        "captureId",
        "carrier",
        "commandId",
        "execution",
        "runner",
        "store",
    ]);
    assertRunText(fields.commandId, "commandId");
    return fields as unknown as RecoverTaskWorldOptions<I, O>;
}

function readGrantedRecoveryOptions<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>>(
    value: RecoverGrantedTaskWorldOptions<I, O>,
): RecoverGrantedTaskWorldOptions<I, O> {
    const fields = readExactOptions(value, [
        "baseRevision",
        "binding",
        "captureId",
        "carrier",
        "commandId",
        "execution",
        "repositoryGrantPlan",
        "runner",
        "store",
    ]);
    assertRunText(fields.commandId, "commandId");
    return fields as unknown as RecoverGrantedTaskWorldOptions<I, O>;
}

function readPlacedRecoveryOptions<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>>(
    value: RecoverPlacedGrantedTaskWorldOptions<I, O>,
): RecoverPlacedGrantedTaskWorldOptions<I, O> {
    const fields = readExactOptions(value, [
        "baseRevision",
        "binding",
        "captureId",
        "carrier",
        "commandId",
        "execution",
        "placementResolution",
        "repositoryGrantPlan",
        "runner",
        "store",
    ]);
    assertRunText(fields.commandId, "commandId");
    return fields as unknown as RecoverPlacedGrantedTaskWorldOptions<I, O>;
}

function readJailedRecoveryOptions<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>>(
    value: RecoverJailedGrantedTaskWorldOptions<I, O>,
): RecoverJailedGrantedTaskWorldOptions<I, O> {
    const fields = readExactOptions(value, [
        "baseRevision",
        "binding",
        "captureId",
        "carrier",
        "commandId",
        "execution",
        "nativeJailResolution",
        "repositoryGrantPlan",
        "runner",
        "store",
    ]);
    assertRunText(fields.commandId, "commandId");
    return fields as unknown as RecoverJailedGrantedTaskWorldOptions<I, O>;
}

function readRetainedNativeJailReceipt(
    store: SQLiteTraceStore,
    runId: string,
): NativeJailLaunchReceipt {
    const receipts = store
        .readOwner(runId)
        .filter(
            (record) =>
                record.envelope.schema_ref ===
                    workspaceProtocolConfig.placements.nativeJails.schemas.processId &&
                "receipt_id" in record.body,
        )
        .map((record) => readNativeJailProcessEvidence(record.body));
    /* A successful captured native run retains exactly one validated receipt. */
    /* node:coverage disable */
    if (receipts.length !== 1) {
        throw new TypeError("native jail launch receipt is unavailable or ambiguous");
    }
    /* node:coverage enable */
    return receipts[0] as unknown as NativeJailLaunchReceipt;
}

async function assertRetainedNativeJailPlanContract<
    I extends TaskSchema<unknown>,
    O extends TaskSchema<unknown>,
>(
    fields: CaptureJailedGrantedTaskWorldOptions<I, O> | RecoverJailedGrantedTaskWorldOptions<I, O>,
    result: TaskWorldCaptureResult,
): Promise<void> {
    const intents = fields.store
        .readOwner(fields.execution.runId)
        .filter(
            (record) =>
                record.envelope.schema_ref ===
                    workspaceProtocolConfig.placements.nativeJails.schemas.processId &&
                "command_id" in record.body,
        )
        .map((record) => readNativeJailProcessEvidence(record.body));
    /* Successful native capture has one claim-fenced launch intent. */
    /* node:coverage disable */
    if (intents.length !== 1) {
        throw new TypeError("native jail launch intent is unavailable or ambiguous");
    }
    /* node:coverage enable */
    const intent = intents[0] as unknown as NativeJailLaunchIntent;
    const custody = await fields.carrier.openCustody(result.output.custody_id);
    const grant = activeRepositoryGrant(fields);
    assert.ok(grant !== null);
    const expected = createNativeJailConfinementPlan(
        fields.runner,
        custody.path,
        grant.authority.includes(
            workspaceProtocolConfig.repositoryGrants.operations.writeText as RepositoryGrantAtom,
        ),
    );
    /* Substitution is exercised through exact changed-resolution recovery refusal. */
    /* node:coverage disable */
    if (
        canonicalizeRecord(intent.plan as unknown as SemanticRecord) !==
        canonicalizeRecord(expected as unknown as SemanticRecord)
    ) {
        throw new TypeError("native jail confinement plan differs from reopened authority");
    }
    /* node:coverage enable */
}

function assertText(value: unknown, subject: string, maxBytes: number): asserts value is string {
    if (
        typeof value !== "string" ||
        value.length === 0 ||
        value.includes("\0") ||
        Buffer.byteLength(value) > maxBytes ||
        /[\uD800-\uDFFF]/u.test(value)
    )
        throw new TypeError(`${subject} is invalid`);
}
