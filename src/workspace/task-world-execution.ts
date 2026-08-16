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
import type { PreparedTaskExecution } from "../run/execution-preparation.ts";
import { prepareTaskExecution } from "../run/execution-preparation.ts";
import type { TaskExecutionResult } from "../run/execution-types.ts";
import { assertRunText } from "../run/validation-values.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import type { TaskSchema } from "../task/schema.ts";
import { assertWorkspaceBinding } from "./bindings.ts";
import { createWorldChangeset } from "./changesets.ts";
import {
    assertReferenceCopyCarrier,
    forkReferenceCopyRevisionForTaskWorld,
} from "./reference-copy-carrier.ts";
import { assertRetainedWorldRunner, invokeRetainedWorldRunner } from "./retained-world-runner.ts";
import type {
    RetainedWorldCapability,
    RetainedWorldExecutionContext,
} from "./retained-world-runner-types.ts";
import type {
    CaptureTaskWorldOptions,
    RecoverTaskWorldOptions,
    RetainedWorldOutput,
    TaskWorldCaptureResult,
} from "./task-world-execution-types.ts";
import { appendTaskWorldJournal, inspectTaskWorldCaptureJournal } from "./task-world-journal.ts";
import type { WorldCustody, WorldRevision } from "./types.ts";

const [RETAINED_STATUS] = RETAINED_WORLD_OUTPUT_STATUSES;
const [, , , TERMINAL_PENDING_CUT_RECOVERY_STATUS, COMMITTED_RECOVERY_STATUS] =
    DURABLE_EXECUTION_RECOVERY_STATUSES;
const [PREPARED_PHASE, FORKED_PHASE, EXECUTING_PHASE, CAPTURED_PHASE] =
    RETAINED_WORLD_JOURNAL_PHASES;
const [FINISHED_STATUS] = RUN_TERMINAL_STATUSES;
const [, BLOB_ARTIFACT_TYPE] = RUN_ARTIFACT_CONTENT_TYPES;
const [CAPTURE_MODE] = RECORD_MODES;

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
    const fields = readRecoveryOptions(options);
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
            // Another exact repair may publish the cut between stable inspection and this read.
            /* node:coverage ignore next 7 */
            if (pending.status === COMMITTED_RECOVERY_STATUS) {
                return rebuildRetainedTaskWorld(fields, retainedBase, inspection.output_record_id);
            }
            // Stable recovery allows only pending or committed at this boundary.
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
            // A retained output requires one of the two terminal recovery classifications.
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
            ? forkReferenceCopyRevisionForTaskWorld(
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
    fields: CaptureTaskWorldOptions<I, O>,
    retainedBase: WorldRevision,
): void {
    if (
        preparedBody.base_revision_id !== retainedBase.revision_id ||
        preparedBody.binding_id !== fields.binding.binding_id ||
        preparedBody.runner_id !== fields.runner.runner_id ||
        preparedBody.enforcement !== fields.runner.enforcement ||
        preparedBody.max_capture_id_bytes !==
            workspaceProtocolConfig.worldTaskCapture.maxCaptureIdBytes ||
        preparedBody.max_text_bytes !== workspaceProtocolConfig.worldTaskCapture.maxTextBytes
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
    fields: RecoverTaskWorldOptions<I, O>,
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
>(fields: CaptureTaskWorldOptions<I, O>): Promise<WorldRevision> {
    assertReferenceCopyCarrier(fields.carrier);
    assertRetainedWorldRunner(fields.runner);
    assertWorkspaceBinding(fields.binding);
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
    fields: CaptureTaskWorldOptions<I, O>,
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
                    runner_id: fields.runner.runner_id,
                },
                [createdRecordId],
            );
            custody = forkReferenceCopyRevisionForTaskWorld(
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
                assertFence,
            );
            const runnerContext = Object.freeze({
                capture_fence: authority.fencingToken,
                execution: prepared.definition,
                signal: prepared.definition.signal ?? new AbortController().signal,
                world,
            }) satisfies RetainedWorldExecutionContext<I, O>;
            let execution: TaskExecutionResult;
            try {
                execution = await invokeRetainedWorldRunner(fields.runner, runnerContext);
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
                [executingRecordId],
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
    return Object.freeze({
        ...durable.result,
        changeset: changesetResult,
        output: Object.freeze({
            ...output,
            capture_record_id: durable.contributionRecordId,
            execution_cut: durable.result.ledger.cut,
            execution_outcome_record_id: durable.result.ledger.outcome_record_id,
        }),
    });
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
                const filePath = resolveRegularFile(custody.path, relativePath);
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
                if (
                    typeof text !== "string" ||
                    /[\uD800-\uDFFF]/u.test(text) ||
                    Buffer.byteLength(text) > workspaceProtocolConfig.worldTaskCapture.maxTextBytes
                ) {
                    throw new TypeError("retained-world text is invalid or too large");
                }
                const filePath = resolveRegularFile(custody.path, relativePath);
                const descriptor = openSync(filePath, constants.O_WRONLY | constants.O_NOFOLLOW);
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

function resolveRegularFile(root: string, relativePath: string): string {
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
                    part === workspaceProtocolConfig.controlDirectory,
            )
    ) {
        throw new TypeError("retained-world path is invalid");
    }
    let current = root;
    const parts = relativePath.split("/");
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

function readRunnerResult<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>>(
    value: unknown,
    prepared: PreparedTaskExecution<I, O>,
    store: CaptureTaskWorldOptions<I, O>["store"],
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
