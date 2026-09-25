import type { SemanticValue } from "../canonical/canonical-record.ts";
import { readDelegationBudget } from "../delegation/authority.ts";
import {
    acceptChildRunResult,
    discardChildRun,
    handoffChildRun,
    injectChildRunContext,
} from "../delegation/commands.ts";
import { openChildRun, retryChildRun, runChildRun } from "../delegation/handle.ts";
import { inspectChildRun } from "../delegation/inspection.ts";
import { observeChildRun } from "../delegation/observe.ts";
import { createChildRunHandleId, readSupervisorId } from "../delegation/records.ts";
import type {
    ChildRunHandle,
    ChildRunInspection,
    ChildRunPredecessorInspection,
    ChildRunProgramContext,
    ChildRunReceipt,
    RunChildRunOptions,
} from "../delegation/types.ts";
import { applicationsProtocolConfig, kernelProtocolConfig } from "../protocol/config.ts";
import {
    APPLICATION_KINDS,
    APPLICATION_PROTOCOL_SURFACES,
    APPLICATION_SUPERVISION_CONFLICT_KINDS,
    APPLICATION_SUPERVISION_PHASES,
    APPLICATION_SUPERVISION_POLICY_KINDS,
    APPLICATION_SUPERVISION_WORKER_STATUSES,
    DELEGATION_STATUSES,
    RECORD_MODES,
    RUN_TERMINAL_STATUSES,
} from "../protocol/values.generated.ts";
import { ROOT_WITNESS_ID } from "../record/root-witness.ts";
import type { RecordBody, RecordId } from "../record/types.ts";
import type {
    DurableTaskExecutionInspection,
    DurableTaskExecutionOutcomeInspection,
} from "../run/durable-execution-inspection-types.ts";
import type { RunUsage } from "../run/usage-types.ts";
import { assertScopeText, readScopeArray, readScopeDataObject } from "../scope/validation.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import type { OwnerRecord } from "../store/types.ts";
import {
    ApplicationBudgetError,
    ApplicationEvidenceError,
    ApplicationProtocolError,
} from "./errors.ts";
import {
    applicationProtocolId,
    createApplicationManifest,
    deriveApplicationOwnerId,
    readApplicationProtocol,
    readRetainedManifest,
    retainApplicationManifest,
} from "./manifest.ts";
import {
    type ApplicationSchemaSurface,
    assertApplicationMessage,
    compileApplicationSchemaSurfaces,
} from "./protocol-schemas.ts";
import {
    type ApplicationDecisionBody,
    type ApplicationOpenedBody,
    assertApplicationDigest,
    canonical,
    createApplicationAppendIntentId,
    createApplicationAppendRequest,
    createApplicationCommandId,
    createApplicationDecisionBody,
    createApplicationOpenedBody,
    foldApplicationCosts,
    readApplicationDecisionBody,
    readApplicationOpenedBody,
    readChangedPaths,
    readSupervisorDecision,
} from "./records.ts";
import type {
    CodingSupervisorAttemptInspection,
    CodingSupervisorChangedPathsReader,
    CodingSupervisorConflict,
    CodingSupervisorDecision,
    CodingSupervisorEvidence,
    CodingSupervisorInspection,
    CodingSupervisorObservation,
    CodingSupervisorPolicy,
    CodingSupervisorReceipt,
    CodingSupervisorWorkerStatus,
    RunCodingSupervisorOptions,
} from "./supervisor-types.ts";
import type {
    ApplicationArtifactSource,
    ApplicationManifest,
    ApplicationProtocolDefinition,
    ApplicationWorldAdapter,
    ApplicationWorldCustody,
    ApplicationWorldReceipt,
} from "./types.ts";

const config = applicationsProtocolConfig;
const supervision = config.supervision;
const [CAPTURE_MODE] = RECORD_MODES;
const [CODING_SUPERVISOR_KIND] = APPLICATION_KINDS;
const [PROMPT_KIND, SCHEMA_KIND, TOOL_KIND] = APPLICATION_PROTOCOL_SURFACES;
const [OPENED_PHASE, DECISION_PHASE] = APPLICATION_SUPERVISION_PHASES;
const [OBSERVE_KIND, INJECT_KIND, HANDOFF_KIND, DISCARD_RESTART_KIND, ACCEPT_KIND] =
    APPLICATION_SUPERVISION_POLICY_KINDS;
const [NONE_CONFLICT, PATH_OVERLAP_CONFLICT] = APPLICATION_SUPERVISION_CONFLICT_KINDS;
const [RUNNING_WORKER, ACCEPTED_WORKER, DISCARDED_WORKER, RESTARTED_WORKER, HANDED_OFF_WORKER] =
    APPLICATION_SUPERVISION_WORKER_STATUSES;
const [READY_STATUS, , , , , ACCEPTED_STATUS, DISCARDED_STATUS] = DELEGATION_STATUSES;
const [FINISHED_STATUS] = RUN_TERMINAL_STATUSES;
const OPENED_STEP = "opened";
const DECISION_STEP = "decision";
const FORK_STEP = "fork";
const OPEN_STEP = "open";
const INJECT_STEP = "inject";
const HANDOFF_STEP = "handoff";
const DISCARD_STEP = "discard";
const WORLD_DISCARD_STEP = "world_discard";
const ACCEPT_STEP = "accept";
const MERGE_STEP = "merge";

type WorkerDefinition = {
    readonly budget: unknown;
    readonly grant: unknown;
    readonly input: unknown;
    readonly program: ((context: ChildRunProgramContext) => unknown) | undefined;
    readonly provenance: unknown;
    readonly provider: unknown;
    readonly task: unknown;
    readonly workerId: string;
};

type WorkerState = {
    readonly attempt: number;
    readonly custody: ApplicationWorldCustody | null;
    readonly definition: WorkerDefinition;
    readonly forkReceiptIds: readonly string[];
    readonly handle: ChildRunHandle;
    readonly handleIds: readonly string[];
    supervisorId: string;
};

type SupervisionProtocol = {
    readonly action: readonly ApplicationSchemaSurface[];
    readonly definition: ApplicationProtocolDefinition;
    readonly observation: readonly ApplicationSchemaSurface[];
    readonly providerCalls: number;
    readonly rounds: number;
};

type RetainedRecords = {
    readonly decisions: readonly {
        readonly body: ApplicationDecisionBody;
        readonly record_id: RecordId;
    }[];
    readonly head: RecordId;
    readonly manifest: ReturnType<typeof readRetainedManifest>;
    readonly opened: { readonly body: ApplicationOpenedBody; readonly record_id: RecordId };
};

type OpenedFields = Parameters<typeof createApplicationOpenedBody>[0];

type Run = {
    readonly applicationId: string;
    readonly changedPaths: CodingSupervisorChangedPathsReader | null;
    readonly clock: () => number;
    head: RecordId;
    readonly parent: unknown;
    readonly protocol: SupervisionProtocol;
    readonly store: SQLiteTraceStore;
    readonly supervisorId: string;
    readonly workers: Map<string, WorkerState>;
    readonly world: ApplicationWorldAdapter | null;
};

/**
 * Runs the two-worker coding supervisor application over durable child run handles.
 *
 * Each worker is opened as a child run under the caller's root declaration, optionally bound to
 * isolated custody forked through `world`. The run proceeds in rounds bounded by the protocol's
 * round budget: every round observes each live worker through `observeChildRun` and its
 * record-derived inspection, classifies the workers' changed paths as `none` or `path_overlap`,
 * consults the policy exactly once, applies its decision through the delegation seam (`inject`,
 * `handoff`, `discard_restart` from a clean fork, or the terminal `accept`), retains one
 * `shepherd.application.supervision.v1` decision record citing the exact evidence, and then runs
 * every ready worker. `accept` merges the accepted custody, discards every other worker and
 * custody, retains the manifest on the application owner path, and publishes the terminal cut.
 * Repeating the command replays retained decisions without consulting the policy and returns the
 * retained manifest without re-executing any worker. A repeat is checked against the retained
 * opened record before any fork or handle is opened, so a refused repeat writes nothing. A round
 * whose delegation commands were applied before its decision record was retained is completed
 * with the decision rebuilt from those commands, never with a new policy decision.
 *
 * @param store - Open writable trace store.
 * @param options - Command, supervisor, protocol, workers, parent declaration, policy, and exactly
 * one of a world adapter or a trace-only changed-path reader.
 * @returns The retained manifest and the record-derived inspection.
 * @throws {ApplicationProtocolError} If the protocol definition is malformed, is not a coding
 * supervisor protocol, lacks a required surface or budget, differs from the retained one, or its
 * observation schema surface refuses a round's observation message (before the policy is
 * consulted).
 * @throws {JSONSchemaValidationError} If a policy decision's `{ kind, reason, worker_id }` action
 * message violates the protocol's action schema surface; the decision is not applied.
 * @throws {ApplicationBudgetError} If a worker budget exceeds the protocol's, the round budget is
 * exhausted, or a worker start would exceed the provider-call budget.
 * @throws {ApplicationEvidenceError} If retained application evidence is inconsistent.
 * @throws {DelegationStatusError} If a worker is running after a crash, is accepted before it
 * finished, or a decision is not admissible for the handle's status.
 * @throws {DelegationAuthorityError} If a worker grant or budget exceeds the declared ceiling.
 * @throws {TraceStoreError} If the store is closed.
 * @throws {TypeError} If options, the world adapter or its results, a worker definition, or a
 * policy decision are malformed.
 *
 * @example
 * ```ts
 * const { manifest, inspection } = await runCodingSupervisor(store, {
 *     changedPaths: ({ output }) => [(output as { path: string }).path],
 *     commandId: "application:supervisor:1",
 *     parent: { budget: { maxTurns: 4 }, ceiling: [], kind: "root" },
 *     policy: ({ observations, round }) =>
 *         round === 1
 *             ? { kind: "observe" }
 *             : { kind: "accept", worker_id: observations[0].worker_id },
 *     protocol,
 *     supervisorId: "supervisor:lead",
 *     workers,
 * });
 * ```
 */
export async function runCodingSupervisor(
    store: SQLiteTraceStore,
    options: RunCodingSupervisorOptions,
): Promise<CodingSupervisorReceipt> {
    const fields = readScopeDataObject(
        options,
        ["commandId", "parent", "policy", "protocol", "supervisorId", "workers"],
        "runCodingSupervisor options",
        ["changedPaths", "clock", "world"],
    );
    assertScopeText(fields.commandId, "commandId");
    const supervisorId = readSupervisorId(fields.supervisorId, "supervisorId");
    const clock = fields.clock === undefined ? Date.now : readFunction(fields.clock, "clock");
    const policy = readFunction(fields.policy, "policy") as CodingSupervisorPolicy;
    const protocol = readSupervisionProtocol(fields.protocol);
    const protocolId = applicationProtocolId(protocol.definition);
    const applicationId = deriveApplicationOwnerId(fields.commandId);
    const world = fields.world === undefined ? null : readWorldAdapter(fields.world);
    const changedPaths =
        fields.changedPaths === undefined
            ? null
            : (readFunction(
                  fields.changedPaths,
                  "changedPaths",
              ) as CodingSupervisorChangedPathsReader);
    if ((world === null) === (changedPaths === null)) {
        throw new TypeError(
            "runCodingSupervisor options must bind exactly one of world or changedPaths",
        );
    }
    const definitions = readWorkers(fields.workers, protocol);
    const retainedManifest = readRetainedManifest(store, applicationId);
    if (retainedManifest !== null) {
        if (retainedManifest.manifest.protocol_id !== protocolId) {
            throw new ApplicationProtocolError(
                `application ${applicationId} retains a manifest under another protocol`,
            );
        }
        return Object.freeze({
            inspection: inspectCodingSupervisorRun(store, applicationId),
            manifest: retainedManifest.manifest,
        });
    }
    const workerHandles = definitions.map((definition) =>
        Object.freeze({
            handle_id: createChildRunHandleId(
                createApplicationCommandId(applicationId, OPEN_STEP, {
                    attempt: 1,
                    worker_id: definition.workerId,
                }),
            ),
            worker_id: definition.workerId,
        }),
    );
    const opened: OpenedFields = {
        application_id: applicationId,
        command_id: fields.commandId,
        kind: CODING_SUPERVISOR_KIND,
        phase: OPENED_PHASE,
        protocol_id: protocolId,
        supervisor_id: supervisorId,
        workers: workerHandles,
        world: world !== null,
    };
    const reopened =
        store.readOwner(applicationId).length === 0
            ? null
            : readApplicationRecords(store, applicationId).opened.body;
    if (reopened !== null) {
        assertReopened(reopened, opened);
    }
    const run: Run = {
        applicationId,
        changedPaths,
        clock: clock as () => number,
        head: "" as RecordId,
        parent: fields.parent,
        protocol,
        store,
        supervisorId,
        workers: new Map(),
        world,
    };
    for (const definition of definitions) {
        run.workers.set(definition.workerId, await openAttempt(run, definition, 1, null));
    }
    const retained = retainOpened(run, reopened === null ? opened : null);
    for (let round = 1; ; round += 1) {
        if (round > protocol.rounds) {
            throw new ApplicationBudgetError(
                `round ${round} exceeds ${supervision.budgetKeys.rounds} ${protocol.rounds}`,
            );
        }
        const retainedDecision = retained.decisions[round - 1];
        let decision: CodingSupervisorDecision;
        let observed: {
            readonly conflict: CodingSupervisorConflict;
            readonly observations: readonly CodingSupervisorObservation[];
        } | null = null;
        if (retainedDecision === undefined) {
            const applied = readAppliedDecision(run, round);
            const observations = await observeWorkers(run, consumedCustody(run, applied));
            const conflict = classifyConflict(observations);
            observed = { conflict, observations };
            if (applied === null) {
                assertObservationMessage(protocol, round, conflict, observations);
                decision = readDecision(
                    await policy(
                        Object.freeze({
                            conflict,
                            observations,
                            protocol: protocol.definition,
                            round,
                            supervisorId,
                        }),
                    ),
                    run,
                );
                assertApplicationMessage(
                    protocol.action,
                    actionMessage(decision),
                    `policy decision of round ${round}`,
                );
            } else {
                decision = applied;
            }
        } else {
            decision = retainedDecision.body.decision;
        }
        const evidence = await applyDecision(run, round, decision);
        if (observed !== null) {
            retainDecision(run, round, observed, decision, evidence);
        }
        if (decision.kind === ACCEPT_KIND) {
            break;
        }
        await runReadyWorkers(run);
    }
    const receipt = retainApplicationManifest(store, { manifest: buildManifest(run) });
    return Object.freeze({
        inspection: inspectCodingSupervisorRun(store, applicationId),
        manifest: receipt.manifest,
    });
}

/**
 * Reads one coding supervisor run as an immutable record-derived view without mutation.
 *
 * Every record on the application owner path is validated: the opened record, each decision
 * record in contiguous round order, the manifest, and the terminal cut publication. Worker
 * lineages follow the opened handles through every retained `discard_restart` successor, and
 * each attempt carries its validated child run handle inspection. Inspection works on reopened,
 * read-only, and imported stores.
 *
 * @param store - Open trace store, writable or read-only.
 * @param applicationId - Application identity derived by {@link deriveApplicationOwnerId}.
 * @returns The validated inspection.
 * @throws {ApplicationEvidenceError} If the application is not retained or its evidence is
 * inconsistent.
 * @throws {DelegationEvidenceError} If a worker handle's evidence is inconsistent.
 * @throws {TraceStoreError} If the store is closed.
 * @throws {TypeError} If the application identity is malformed.
 *
 * @example
 * ```ts
 * const inspection = inspectCodingSupervisorRun(store, deriveApplicationOwnerId(commandId));
 * console.log(inspection.decisions.map((decision) => decision.decision.kind));
 * ```
 */
export function inspectCodingSupervisorRun(
    store: SQLiteTraceStore,
    applicationId: string,
): CodingSupervisorInspection {
    assertApplicationDigest(applicationId, config.identity.applicationIdPrefix, "applicationId");
    const retained = readApplicationRecords(store, applicationId);
    const opened = retained.opened.body;
    const lineages = new Map<string, string[]>(
        opened.workers.map((worker) => [worker.worker_id, [worker.handle_id]]),
    );
    for (const { body } of retained.decisions) {
        if (
            body.decision.kind === DISCARD_RESTART_KIND &&
            body.evidence.kind === body.decision.kind
        ) {
            const lineage = lineages.get(body.decision.worker_id);
            assert(lineage !== undefined, "decision names a worker the run did not open");
            lineage.push(body.evidence.successor_handle_id);
        }
    }
    for (const [workerId, handleIds] of lineages) {
        assert(
            handleIds.every(
                (handleId, index) =>
                    handleId ===
                    createChildRunHandleId(
                        createApplicationCommandId(applicationId, OPEN_STEP, {
                            attempt: index + 1,
                            worker_id: workerId,
                        }),
                    ),
            ),
            `worker ${workerId} names a handle this application did not open`,
        );
    }
    return Object.freeze({
        application_id: applicationId,
        command_id: opened.command_id,
        cut_id: retained.manifest === null ? null : retained.manifest.cut_id,
        decisions: Object.freeze(
            retained.decisions.map(({ body, record_id }) =>
                Object.freeze({
                    conflict: body.conflict,
                    decision: body.decision,
                    evidence: body.evidence,
                    observations: body.observations,
                    record_id,
                    round: body.round,
                    supervisor_id: body.supervisor_id,
                }),
            ),
        ),
        kind: opened.kind,
        manifest: retained.manifest === null ? null : retained.manifest.manifest,
        manifest_record_id: retained.manifest === null ? null : retained.manifest.record_id,
        opened_record_id: retained.opened.record_id,
        protocol_id: opened.protocol_id,
        supervisor_id: opened.supervisor_id,
        workers: Object.freeze(
            [...lineages].map(([workerId, handleIds]) =>
                Object.freeze({
                    attempts: Object.freeze(
                        handleIds.map((handleId, index): CodingSupervisorAttemptInspection => {
                            const inspection = inspectChildRun(store, handleId);
                            return Object.freeze({
                                attempt: index + 1,
                                handle_id: handleId,
                                inspection,
                                status: lineageStatus(
                                    inspection,
                                    opened.supervisor_id,
                                    index < handleIds.length - 1,
                                ),
                            });
                        }),
                    ),
                    worker_id: workerId,
                }),
            ),
        ),
        world: opened.world,
    });
}

function readApplicationRecords(store: SQLiteTraceStore, applicationId: string): RetainedRecords {
    const records = store.readOwner(applicationId);
    const [first, ...rest] = records;
    assert(first !== undefined, `application ${applicationId} is not retained`);
    assertRecord(first, config.traceSchemas.supervision);
    const opened = readApplicationOpenedBody(first.body);
    assert(
        opened.application_id === applicationId &&
            deriveApplicationOwnerId(opened.command_id) === applicationId,
        "opened record names another application",
    );
    const manifest = readRetainedManifest(store, applicationId);
    const decisions: { readonly body: ApplicationDecisionBody; readonly record_id: RecordId }[] =
        [];
    let head = first.envelope.record_id;
    let manifestSeen = false;
    let terminal = false;
    for (const record of rest) {
        const schemaRef = record.envelope.schema_ref;
        assert(!terminal, "application retains a record after its terminal cut");
        if (schemaRef === config.traceSchemas.supervision) {
            assertRecord(record, schemaRef);
            const body = readApplicationDecisionBody(record.body);
            assert(
                !manifestSeen &&
                    body.application_id === applicationId &&
                    body.round === decisions.length + 1 &&
                    body.supervisor_id === opened.supervisor_id &&
                    record.envelope.caused_by_record_ids[0] === head,
                "decision record is late, out of round order, or names another application",
            );
            decisions.push(Object.freeze({ body, record_id: record.envelope.record_id }));
        } else if (schemaRef === config.traceSchemas.manifest) {
            assertRecord(record, schemaRef);
            assert(
                manifest !== null &&
                    manifest.record_id === record.envelope.record_id &&
                    record.envelope.caused_by_record_ids[0] === head,
                "manifest record does not follow the last decision",
            );
            manifestSeen = true;
        } else {
            assertRecord(record, kernelProtocolConfig.queries.cutSchemaRef);
            assert(
                manifestSeen &&
                    record.body.cut_id === (manifest as { readonly cut_id: string }).cut_id,
                "application retains an unsupported record",
            );
            terminal = true;
        }
        head = record.envelope.record_id;
    }
    return Object.freeze({
        decisions: Object.freeze(decisions),
        head,
        manifest,
        opened: Object.freeze({ body: opened, record_id: first.envelope.record_id }),
    });
}

/**
 * Refuses a rerun whose command does not reopen the retained application exactly. It runs before
 * any fork or handle is opened, so a refused rerun writes nothing.
 */
function assertReopened(retained: ApplicationOpenedBody, expected: OpenedFields): void {
    const applicationId = expected.application_id;
    if (retained.protocol_id !== expected.protocol_id) {
        throw new ApplicationProtocolError(
            `application ${applicationId} was opened under another protocol`,
        );
    }
    assert(
        retained.command_id === expected.command_id &&
            retained.supervisor_id === expected.supervisor_id &&
            retained.world === expected.world &&
            canonical(retained.workers) === canonical(expected.workers),
        `application ${applicationId} was opened with different workers or supervisor`,
    );
}

function retainOpened(run: Run, opened: OpenedFields | null): RetainedRecords {
    const { applicationId, store } = run;
    if (opened !== null) {
        const appended = store.appendApplicationRecord(
            applicationId,
            null,
            createApplicationAppendRequest(
                createApplicationAppendIntentId(applicationId, OPENED_STEP),
                applicationId,
                createApplicationOpenedBody(opened),
                config.traceSchemas.supervision,
                [...run.workers.values()].map((state) => state.handle.opened_record_id as RecordId),
            ),
            null,
        );
        if (appended.status === "head_moved") {
            throw new ApplicationEvidenceError(`application ${applicationId} head moved`);
        }
    }
    const retained = readApplicationRecords(store, applicationId);
    run.head = retained.head;
    return retained;
}

async function openAttempt(
    run: Run,
    definition: WorkerDefinition,
    attempt: number,
    predecessor: WorkerState | null,
): Promise<WorkerState> {
    const { applicationId, store } = run;
    const workerId = definition.workerId;
    const custody =
        run.world === null
            ? null
            : readCustody(
                  await run.world.fork({
                      commandId: createApplicationCommandId(applicationId, FORK_STEP, {
                          attempt,
                          worker_id: workerId,
                      }),
                      nowMilliseconds: run.clock(),
                      workerId,
                  }),
              );
    const commandId = createApplicationCommandId(applicationId, OPEN_STEP, {
        attempt,
        worker_id: workerId,
    });
    let receipt: ChildRunReceipt;
    if (predecessor === null) {
        receipt = openChildRun(store, {
            budget: definition.budget as never,
            commandId,
            grant: definition.grant as never,
            input: definition.input,
            parent: run.parent as never,
            ...(definition.provenance === undefined
                ? {}
                : { provenance: definition.provenance as never }),
            supervisorId: run.supervisorId,
            task: definition.task as never,
        });
    } else {
        receipt = retryChildRun(store, {
            commandId,
            handle: predecessor.handle,
            supervisorId: predecessor.supervisorId,
        });
    }
    return {
        attempt,
        custody,
        definition,
        forkReceiptIds: [
            ...(predecessor === null ? [] : predecessor.forkReceiptIds),
            ...(custody === null ? [] : [custody.receipt_id]),
        ],
        handle: receipt.handle,
        handleIds: [
            ...(predecessor === null ? [] : predecessor.handleIds),
            receipt.handle.handle_id,
        ],
        // The supervisor that opened this attempt, not its current owner: a retained handoff
        // is replayed in round order and advances the supervisor exactly as the first run did.
        supervisorId: predecessor === null ? run.supervisorId : predecessor.supervisorId,
    };
}

/**
 * Rebuilds the decision of a round whose delegation commands were applied before its decision
 * record was retained, as after a crash between the two. Every non-observe decision's first
 * durable effect is a delegation command under a round-derived identity whose retained body
 * carries the decision, so the policy is never consulted again for a round with applied effects.
 * An accept is found before the discards it issues for the other workers.
 */
function readAppliedDecision(run: Run, round: number): CodingSupervisorDecision | null {
    const commands = [...run.workers.values()].map((state) => {
        const workerId = state.definition.workerId;
        const records = run.store.readOwner(state.handle.handle_id);
        return {
            body: (step: string): Readonly<Record<string, unknown>> | undefined => {
                const commandId = createApplicationCommandId(run.applicationId, step, {
                    round,
                    worker_id: workerId,
                });
                return records.find((record) => record.body.command_id === commandId)?.body;
            },
            workerId,
        };
    });
    const accepted = commands.find((command) => command.body(ACCEPT_STEP) !== undefined);
    if (accepted !== undefined) {
        return readDecision({ kind: ACCEPT_KIND, worker_id: accepted.workerId }, run);
    }
    for (const { body, workerId } of commands) {
        const discarded = body(DISCARD_STEP);
        if (discarded !== undefined) {
            return readDecision(
                { kind: DISCARD_RESTART_KIND, reason: discarded.reason, worker_id: workerId },
                run,
            );
        }
        const handedOff = body(HANDOFF_STEP);
        if (handedOff !== undefined) {
            return readDecision(
                {
                    kind: HANDOFF_KIND,
                    reason: handedOff.reason,
                    successor_supervisor_id: handedOff.successor_id,
                    worker_id: workerId,
                },
                run,
            );
        }
        const injected = body(INJECT_STEP);
        if (injected !== undefined) {
            return readDecision(
                {
                    cited_record_ids: injected.cited_record_ids,
                    data: injected.data,
                    kind: INJECT_KIND,
                    worker_id: workerId,
                },
                run,
            );
        }
    }
    return null;
}

/**
 * Names the workers whose world custody an applied decision may already have discarded or merged;
 * their changed paths can no longer be read and are observed as empty.
 */
function consumedCustody(run: Run, applied: CodingSupervisorDecision | null): ReadonlySet<string> {
    if (run.world === null || applied === null) {
        return new Set();
    }
    if (applied.kind === ACCEPT_KIND) {
        return new Set(run.workers.keys());
    }
    return new Set(applied.kind === DISCARD_RESTART_KIND ? [applied.worker_id] : []);
}

async function observeWorkers(
    run: Run,
    consumed: ReadonlySet<string>,
): Promise<readonly CodingSupervisorObservation[]> {
    const { store } = run;
    const observations: CodingSupervisorObservation[] = [];
    for (const state of run.workers.values()) {
        const handleId = state.handle.handle_id;
        const inspection = inspectChildRun(store, handleId);
        const subscription = observeChildRun(store, { handle: state.handle });
        const expected =
            store.readOwner(handleId).length + store.readOwner(inspection.child_run_id).length;
        for (let delivered = 0; delivered < expected; delivered += 1) {
            await subscription.next();
        }
        const cursor = subscription.deliveredCursor;
        subscription.close();
        observations.push(
            Object.freeze({
                attempt: state.attempt,
                changed_paths: consumed.has(state.definition.workerId)
                    ? Object.freeze([])
                    : await readWorkerChangedPaths(run, state, inspection),
                child_run_id: inspection.child_run_id,
                completion_status:
                    inspection.completion === null ? null : inspection.completion.status,
                custody_id: state.custody === null ? null : state.custody.custody_id,
                delivered_cursor: cursor,
                handle_id: handleId,
                head_record_id: inspection.head_record_id,
                status: inspection.status,
                supervisor_id: inspection.supervisor_id,
                worker_id: state.definition.workerId,
                worker_status: lineageStatus(inspection, run.supervisorId, false),
            }),
        );
    }
    return Object.freeze(observations);
}

async function readWorkerChangedPaths(
    run: Run,
    state: WorkerState,
    inspection: ChildRunInspection,
): Promise<readonly string[]> {
    if (run.world !== null) {
        return readChangedPaths(
            await run.world.changedPaths((state.custody as ApplicationWorldCustody).custody_id),
            "world changed paths",
        );
    }
    if (inspection.completion === null || inspection.completion.status !== FINISHED_STATUS) {
        return Object.freeze([]);
    }
    const outcome = (inspection.child as DurableTaskExecutionInspection)
        .outcome as DurableTaskExecutionOutcomeInspection;
    return readChangedPaths(
        (run.changedPaths as CodingSupervisorChangedPathsReader)({
            output: (outcome.outcome.outcome as { readonly value: SemanticValue }).value,
            workerId: state.definition.workerId,
        }),
        "changedPaths result",
    );
}

function classifyConflict(
    observations: readonly CodingSupervisorObservation[],
): CodingSupervisorConflict {
    const owners = new Map<string, string[]>();
    for (const observation of observations) {
        for (const path of observation.changed_paths) {
            const workers = owners.get(path) ?? [];
            workers.push(observation.worker_id);
            owners.set(path, workers);
        }
    }
    const overlapping = [...owners].filter(([, workers]) => workers.length > 1);
    const paths = overlapping.map(([path]) => path).sort();
    const workerIds = [...new Set(overlapping.flatMap(([, workers]) => workers))].sort();
    return Object.freeze({
        kind: paths.length === 0 ? NONE_CONFLICT : PATH_OVERLAP_CONFLICT,
        paths: Object.freeze(paths),
        worker_ids: Object.freeze(workerIds),
    });
}

function readDecision(value: unknown, run: Run): CodingSupervisorDecision {
    const decision = readSupervisorDecision(value);
    if (decision.kind !== OBSERVE_KIND && !run.workers.has(decision.worker_id)) {
        throw new TypeError(`policy decision names unknown worker ${decision.worker_id}`);
    }
    return decision;
}

async function applyDecision(
    run: Run,
    round: number,
    decision: CodingSupervisorDecision,
): Promise<CodingSupervisorEvidence> {
    const { store } = run;
    if (decision.kind === OBSERVE_KIND) {
        return Object.freeze({ kind: OBSERVE_KIND });
    }
    const state = run.workers.get(decision.worker_id) as WorkerState;
    const commandFields = { round, worker_id: decision.worker_id };
    const commandId = (step: string) =>
        createApplicationCommandId(run.applicationId, step, commandFields);
    if (decision.kind === INJECT_KIND) {
        const receipt = injectChildRunContext(store, {
            citedRecordIds: decision.cited_record_ids,
            commandId: commandId(INJECT_STEP),
            data: decision.data,
            handle: state.handle,
            supervisorId: state.supervisorId,
        });
        return Object.freeze({ injection_record_id: receipt.record_id, kind: INJECT_KIND });
    }
    if (decision.kind === HANDOFF_KIND) {
        const receipt = handoffChildRun(store, {
            commandId: commandId(HANDOFF_STEP),
            handle: state.handle,
            ...(decision.reason === null ? {} : { reason: decision.reason }),
            successorSupervisorId: decision.successor_supervisor_id,
            supervisorId: state.supervisorId,
        });
        state.supervisorId = decision.successor_supervisor_id;
        return Object.freeze({ handoff_record_id: receipt.record_id, kind: HANDOFF_KIND });
    }
    if (decision.kind === DISCARD_RESTART_KIND) {
        const discarded = discardChildRun(store, {
            commandId: commandId(DISCARD_STEP),
            handle: state.handle,
            reason: decision.reason,
            supervisorId: state.supervisorId,
        });
        const discardReceipt = await discardCustody(run, state, commandId(WORLD_DISCARD_STEP));
        const successor = await openAttempt(run, state.definition, state.attempt + 1, state);
        run.workers.set(decision.worker_id, successor);
        const predecessor = inspectChildRun(store, successor.handle.handle_id)
            .predecessor as ChildRunPredecessorInspection;
        return Object.freeze({
            decision_record_id: discarded.record_id,
            discard_receipt_id: discardReceipt,
            fork_receipt_id: successor.custody === null ? null : successor.custody.receipt_id,
            kind: DISCARD_RESTART_KIND,
            retry_cut_id: predecessor.cut_id,
            successor_handle_id: successor.handle.handle_id,
        });
    }
    const accepted = acceptChildRunResult(store, {
        commandId: commandId(ACCEPT_STEP),
        handle: state.handle,
        supervisorId: state.supervisorId,
    });
    const mergeReceipt =
        run.world === null
            ? null
            : readReceipt(
                  await run.world.merge({
                      commandId: commandId(MERGE_STEP),
                      custodyId: (state.custody as ApplicationWorldCustody).custody_id,
                      nowMilliseconds: run.clock(),
                      workerId: decision.worker_id,
                  }),
              ).receipt_id;
    const discarded = [];
    for (const other of run.workers.values()) {
        if (other === state) {
            continue;
        }
        const otherFields = { round, worker_id: other.definition.workerId };
        const decisionReceipt = discardChildRun(store, {
            commandId: createApplicationCommandId(run.applicationId, DISCARD_STEP, otherFields),
            handle: other.handle,
            reason: supervision.reasons.notAccepted,
            supervisorId: other.supervisorId,
        });
        discarded.push(
            Object.freeze({
                decision_record_id: decisionReceipt.record_id,
                discard_receipt_id: await discardCustody(
                    run,
                    other,
                    createApplicationCommandId(run.applicationId, WORLD_DISCARD_STEP, otherFields),
                ),
                worker_id: other.definition.workerId,
            }),
        );
    }
    return Object.freeze({
        decision_record_id: accepted.record_id,
        discarded: Object.freeze(discarded),
        kind: ACCEPT_KIND,
        merge_receipt_id: mergeReceipt,
    });
}

async function discardCustody(
    run: Run,
    state: WorkerState,
    commandId: string,
): Promise<string | null> {
    if (run.world === null) {
        return null;
    }
    return readReceipt(
        await run.world.discard({
            commandId,
            custodyId: (state.custody as ApplicationWorldCustody).custody_id,
            nowMilliseconds: run.clock(),
            workerId: state.definition.workerId,
        }),
    ).receipt_id;
}

function retainDecision(
    run: Run,
    round: number,
    observed: {
        readonly conflict: CodingSupervisorConflict;
        readonly observations: readonly CodingSupervisorObservation[];
    },
    decision: CodingSupervisorDecision,
    evidence: CodingSupervisorEvidence,
): void {
    const { applicationId, store } = run;
    const appended = store.appendApplicationRecord(
        applicationId,
        run.head,
        createApplicationAppendRequest(
            createApplicationAppendIntentId(applicationId, `${DECISION_STEP}:${round}`),
            applicationId,
            createApplicationDecisionBody({
                application_id: applicationId,
                conflict: observed.conflict,
                decision,
                evidence,
                observations: observed.observations,
                phase: DECISION_PHASE,
                round,
                supervisor_id: run.supervisorId,
            }),
            config.traceSchemas.supervision,
            [run.head, ...evidenceRecordIds(evidence)],
        ),
        null,
    );
    if (appended.status === "head_moved") {
        throw new ApplicationEvidenceError(`application ${applicationId} head moved`);
    }
    run.head = appended.receipt.record_ids[0] as RecordId;
}

function evidenceRecordIds(evidence: CodingSupervisorEvidence): readonly RecordId[] {
    if (evidence.kind === INJECT_KIND) {
        return [evidence.injection_record_id];
    }
    if (evidence.kind === HANDOFF_KIND) {
        return [evidence.handoff_record_id];
    }
    if (evidence.kind === DISCARD_RESTART_KIND) {
        return [evidence.decision_record_id];
    }
    if (evidence.kind === ACCEPT_KIND) {
        return [
            evidence.decision_record_id,
            ...evidence.discarded.map((worker) => worker.decision_record_id),
        ];
    }
    return [];
}

async function runReadyWorkers(run: Run): Promise<void> {
    const { store } = run;
    let started = 0;
    let ready = 0;
    for (const state of run.workers.values()) {
        for (const handleId of state.handleIds) {
            const inspection = inspectChildRun(store, handleId);
            if (
                inspection.child !== null &&
                inspection.child.lifecycle.started_record_id !== null
            ) {
                started += 1;
            }
            if (handleId === state.handle.handle_id && inspection.status === READY_STATUS) {
                ready += 1;
            }
        }
    }
    const budget = run.protocol.providerCalls;
    if (started + ready > budget) {
        throw new ApplicationBudgetError(
            `starting ${ready} worker(s) after ${started} start(s) exceeds ${supervision.budgetKeys.providerCalls} ${budget}`,
        );
    }
    for (const state of run.workers.values()) {
        await runChildRun(store, runOptions(run, state));
    }
}

function runOptions(run: Run, state: WorkerState): RunChildRunOptions {
    const { definition } = state;
    if (definition.program === undefined) {
        return { handle: state.handle, provider: definition.provider as never };
    }
    const program = definition.program;
    return {
        handle: state.handle,
        program: (context) =>
            program(
                Object.freeze({
                    ...context,
                    attempt: state.attempt,
                    custody: state.custody,
                    seeds: run.protocol.definition.seeds,
                    workerId: definition.workerId,
                }),
            ),
    };
}

function buildManifest(run: Run): ApplicationManifest {
    const { store } = run;
    const roles = supervision.artifactRoles;
    const artifacts: ApplicationArtifactSource[] = [];
    const usages: RunUsage[] = [];
    let providerCalls = 0;
    for (const state of run.workers.values()) {
        for (const handleId of state.handleIds) {
            const inspection = inspectChildRun(store, handleId);
            const child = inspection.child;
            if (child !== null && child.lifecycle.started_record_id !== null) {
                providerCalls += 1;
            }
            if (child !== null && child.usage !== null) {
                usages.push(child.usage.usage);
            }
            const cutId =
                inspection.completion === null ? null : inspection.completion.child_cut_id;
            artifacts.push({
                content: {
                    child_cut_id: cutId,
                    handle_id: handleId,
                    head_record_id: inspection.head_record_id,
                    status: inspection.status,
                },
                cut_id: cutId,
                record_id: inspection.head_record_id,
                role: roles.worker,
            });
        }
        for (const receiptId of state.forkReceiptIds) {
            artifacts.push(receiptArtifact(roles.worldFork, receiptId));
        }
    }
    const retained = readApplicationRecords(store, run.applicationId);
    for (const { body, record_id } of retained.decisions) {
        artifacts.push({
            content: body as unknown as SemanticValue,
            cut_id: null,
            record_id,
            role: roles.decision,
        });
        const evidence = body.evidence;
        if (evidence.kind === DISCARD_RESTART_KIND && evidence.discard_receipt_id !== null) {
            artifacts.push(receiptArtifact(roles.worldDiscard, evidence.discard_receipt_id));
        }
        if (evidence.kind === ACCEPT_KIND) {
            if (evidence.merge_receipt_id !== null) {
                artifacts.push(receiptArtifact(roles.worldMerge, evidence.merge_receipt_id));
            }
            for (const worker of evidence.discarded) {
                if (worker.discard_receipt_id !== null) {
                    artifacts.push(receiptArtifact(roles.worldDiscard, worker.discard_receipt_id));
                }
            }
        }
    }
    return createApplicationManifest({
        applicationId: run.applicationId,
        artifacts,
        costs: foldApplicationCosts(usages, providerCalls),
        protocol: run.protocol.definition,
    });
}

function receiptArtifact(role: string, receiptId: string): ApplicationArtifactSource {
    return { content: { receipt_id: receiptId }, cut_id: null, record_id: null, role };
}

function lineageStatus(
    inspection: ChildRunInspection,
    supervisorId: string,
    hasSuccessor: boolean,
): CodingSupervisorWorkerStatus {
    if (inspection.status === ACCEPTED_STATUS) {
        return ACCEPTED_WORKER;
    }
    if (inspection.status === DISCARDED_STATUS) {
        return hasSuccessor ? RESTARTED_WORKER : DISCARDED_WORKER;
    }
    if (inspection.supervisor_id !== supervisorId) {
        return HANDED_OFF_WORKER;
    }
    return RUNNING_WORKER;
}

function readSupervisionProtocol(value: unknown): SupervisionProtocol {
    const definition = readApplicationProtocol(value);
    if (definition.kind !== CODING_SUPERVISOR_KIND) {
        throw new ApplicationProtocolError(`kind must be ${CODING_SUPERVISOR_KIND}`);
    }
    for (const role of [supervision.surfaceRoles.observation, supervision.surfaceRoles.action]) {
        for (const kind of [PROMPT_KIND, SCHEMA_KIND]) {
            if (
                !definition.surfaces.some(
                    (surface) => surface.kind === kind && surface.role === role,
                )
            ) {
                throw new ApplicationProtocolError(
                    `a ${kind} surface with role ${role} is required`,
                );
            }
        }
    }
    if (!definition.surfaces.some((surface) => surface.kind === TOOL_KIND)) {
        throw new ApplicationProtocolError(`at least one ${TOOL_KIND} surface is required`);
    }
    const { providerCalls: providerCallsKey, rounds: roundsKey } = supervision.budgetKeys;
    const providerCalls = definition.budgets[providerCallsKey];
    const rounds = definition.budgets[roundsKey];
    if (providerCalls === undefined || rounds === undefined) {
        throw new ApplicationProtocolError(
            `budgets must declare ${providerCallsKey} and ${roundsKey}`,
        );
    }
    if (rounds > config.limits.maxRounds) {
        throw new ApplicationProtocolError(
            `${roundsKey} exceeds the configured bound ${config.limits.maxRounds}`,
        );
    }
    return {
        action: compileApplicationSchemaSurfaces(definition, supervision.surfaceRoles.action),
        definition,
        observation: compileApplicationSchemaSurfaces(
            definition,
            supervision.surfaceRoles.observation,
        ),
        providerCalls,
        rounds,
    };
}

/**
 * Projects one decision onto the Appendix E action message `{ kind, reason, worker_id }`: the
 * fields a decision kind does not carry are null. Kind-specific arguments (citations, data,
 * successor) remain governed by the closed supervision decision grammar.
 */
function actionMessage(decision: CodingSupervisorDecision): SemanticValue {
    return {
        kind: decision.kind,
        reason: "reason" in decision ? decision.reason : null,
        worker_id: "worker_id" in decision ? decision.worker_id : null,
    };
}

/**
 * Validates the Appendix E observation message `{ conflict, round, workers }` the policy is about
 * to see against the protocol's observation schema surfaces. A runtime observation the pinned
 * schema refuses is a protocol mismatch, raised before the policy is consulted.
 */
function assertObservationMessage(
    protocol: SupervisionProtocol,
    round: number,
    conflict: CodingSupervisorConflict,
    observations: readonly CodingSupervisorObservation[],
): void {
    try {
        assertApplicationMessage(
            protocol.observation,
            {
                conflict: conflict.kind,
                round,
                workers: observations.map((observation) => ({
                    changed_paths: observation.changed_paths,
                    completion_status: observation.completion_status,
                    status: observation.status,
                    worker_id: observation.worker_id,
                })),
            },
            `observation of round ${round}`,
        );
    } catch (error) {
        throw new ApplicationProtocolError(
            `observation of round ${round} is not admitted by the protocol observation schema`,
            { cause: error },
        );
    }
}

function readWorkers(value: unknown, protocol: SupervisionProtocol): readonly WorkerDefinition[] {
    const workers = readScopeArray(value, "workers").map((worker, index) => {
        const subject = `workers[${index}]`;
        const fields = readScopeDataObject(
            worker,
            ["budget", "grant", "input", "task", "workerId"],
            subject,
            ["program", "provenance", "provider"],
        );
        assertScopeText(fields.workerId, `${subject}.workerId`);
        if ((fields.program === undefined) === (fields.provider === undefined)) {
            throw new TypeError(`${subject} must bind exactly one of program or provider`);
        }
        const provider = fields.provider as {
            readonly descriptor?: unknown;
            readonly invoke?: unknown;
        } | null;
        if (
            fields.provider !== undefined &&
            (provider === null ||
                typeof provider !== "object" ||
                typeof provider.descriptor !== "function" ||
                typeof provider.invoke !== "function")
        ) {
            throw new TypeError(`${subject}.provider must be a model provider`);
        }
        const budget = readDelegationBudget(fields.budget, `${subject}.budget`) as Readonly<
            Record<string, number | undefined>
        >;
        for (const [metric, key] of Object.entries(supervision.budgetKeys.worker)) {
            const bound = protocol.definition.budgets[key];
            if (bound === undefined) {
                continue;
            }
            const declared = budget[metric];
            if (declared === undefined || declared > bound) {
                throw new ApplicationBudgetError(
                    `${subject}.budget.${metric} must be declared no greater than ${key} ${bound}`,
                );
            }
        }
        return Object.freeze({
            budget,
            grant: fields.grant,
            input: fields.input,
            program:
                fields.program === undefined
                    ? undefined
                    : (readFunction(
                          fields.program,
                          `${subject}.program`,
                      ) as WorkerDefinition["program"]),
            provenance: fields.provenance,
            provider: fields.provider,
            task: fields.task,
            workerId: fields.workerId,
        });
    });
    if (
        workers.length < config.limits.minWorkers ||
        workers.length > config.limits.maxWorkers ||
        new Set(workers.map((worker) => worker.workerId)).size !== workers.length
    ) {
        throw new TypeError("workers must be distinct and within the configured worker bounds");
    }
    return Object.freeze(workers);
}

function readWorldAdapter(value: unknown): ApplicationWorldAdapter {
    if (value === null || typeof value !== "object") {
        throw new TypeError("world must be a world adapter object");
    }
    const adapter = value as Readonly<Record<string, unknown>>;
    const [changedPaths, discard, fork, merge] = ["changedPaths", "discard", "fork", "merge"].map(
        (key) => readFunction(adapter[key], `world.${key}`).bind(value),
    );
    return Object.freeze({
        changedPaths,
        discard,
        fork,
        merge,
    }) as unknown as ApplicationWorldAdapter;
}

function readCustody(value: unknown): ApplicationWorldCustody {
    const fields = readScopeDataObject(
        value,
        ["custody_id", "receipt_id", "root"],
        "world custody",
    );
    assertScopeText(fields.custody_id, "world custody custody_id");
    assertScopeText(fields.receipt_id, "world custody receipt_id");
    assertScopeText(fields.root, "world custody root");
    return Object.freeze({
        custody_id: fields.custody_id,
        receipt_id: fields.receipt_id,
        root: fields.root,
    });
}

function readReceipt(value: unknown): ApplicationWorldReceipt {
    const fields = readScopeDataObject(value, ["receipt_id"], "world receipt");
    assertScopeText(fields.receipt_id, "world receipt receipt_id");
    return Object.freeze({ receipt_id: fields.receipt_id });
}

function readFunction(value: unknown, subject: string): (...args: never[]) => unknown {
    if (typeof value !== "function") {
        throw new TypeError(`${subject} must be a function`);
    }
    return value as (...args: never[]) => unknown;
}

function assertRecord(record: OwnerRecord, schema: string): void {
    assert(
        record.envelope.schema_ref === schema &&
            record.envelope.mode === CAPTURE_MODE &&
            record.envelope.witness_ref === ROOT_WITNESS_ID,
        `record ${record.envelope.record_id} has an unexpected schema, mode, or witness`,
    );
}

function assert(condition: boolean, message: string): asserts condition {
    if (!condition) {
        throw new ApplicationEvidenceError(message);
    }
}

/** Retained record body type re-exported for tests that forge application evidence. @internal */
export type { RecordBody as ApplicationRecordBody };
