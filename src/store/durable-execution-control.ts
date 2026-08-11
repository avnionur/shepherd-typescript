import type { DatabaseSync } from "node:sqlite";

import { createRecordId } from "../canonical/canonical-record.ts";
import { projectionProtocolConfig, runProtocolConfig } from "../protocol/config.ts";
import { RECORD_MODES } from "../protocol/values.generated.ts";
import { createRecordEnvelope } from "../record/envelope.ts";
import { assertNonEmptyString, assertRecordId } from "../record/guards.ts";
import { ROOT_WITNESS_ID } from "../record/root-witness.ts";
import type { RecordId } from "../record/types.ts";
import {
    createDurableResumeCommand,
    readDurablePauseCommand,
    readDurableResumeCommand,
} from "../run/durable-execution-control-codec.ts";
import { assertDurableExecutionRecordContract } from "../run/durable-execution-recovery.ts";
import { appendWithinTraceStoreTransaction } from "./append.ts";
import { STORE_TABLES, STORE_TRANSACTION_SQL } from "./constants.ts";
import { readStoredCut } from "./cuts.ts";
import { TraceStoreError } from "./errors.ts";
import { readStoredRecord } from "./read.ts";
import type {
    AppendReceipt,
    DurableExecutionResumeAppend,
    OwnerRecord,
    StoreAppendRequest,
} from "./types.ts";

type StartedClaimRow = {
    readonly fencing_token: number;
    readonly started: number;
};

const [CAPTURE_MODE] = RECORD_MODES;

/**
 * Atomically retains an exact running control request while its head and fence are current.
 *
 * An already retained append intent is replayed or conflicts before current-lifecycle validation,
 * so an exact command remains idempotent after the run later advances.
 *
 * @param database - Open trace-store database inside no caller-owned transaction.
 * @param runId - Durable run whose running lifecycle is targeted.
 * @param expectedLifecycleRecordId - Exact retained start record expected by the caller.
 * @param fencingToken - Exact current invocation fencing token.
 * @param request - Canonical running-control-command append request.
 * @returns The committed or identically replayed append receipt.
 * @throws {TraceStoreError} If the expected running authority is no longer current.
 * @throws {AppendIntentConflictError} If the command identity already names different content.
 * @throws {TypeError} If an identifier, token, or append request is malformed.
 * @internal
 */
export function appendDurableExecutionRunningControlCommand(
    database: DatabaseSync,
    runId: string,
    expectedLifecycleRecordId: RecordId,
    fencingToken: number,
    request: StoreAppendRequest,
): AppendReceipt {
    assertNonEmptyString(runId, "runId");
    assertRecordId(expectedLifecycleRecordId, "expectedLifecycleRecordId");
    if (!Number.isSafeInteger(fencingToken) || fencingToken <= 0) {
        throw new TypeError("fencingToken must be a positive safe integer");
    }
    database.exec(STORE_TRANSACTION_SQL.begin);
    try {
        const existingIntent = database
            .prepare(`SELECT 1 FROM ${STORE_TABLES.appendIntents} WHERE append_intent_id = ?`)
            .get(request.append_intent_id);
        if (existingIntent !== undefined) {
            const receipt = appendWithinTraceStoreTransaction(database, request);
            database.exec(STORE_TRANSACTION_SQL.commit);
            return receipt;
        }
        const claim = database
            .prepare(
                `SELECT fencing_token, started FROM ${STORE_TABLES.durableExecutionClaims} WHERE run_id = ?`,
            )
            .get(runId) as StartedClaimRow | undefined;
        if (claim === undefined || claim.started !== 1 || claim.fencing_token !== fencingToken) {
            throw new TraceStoreError(
                "durable running control command requires the current started invocation fence",
            );
        }
        const startedSchema = projectionProtocolConfig.executionHistory.executionSchemas.started;
        const expectedHead = database
            .prepare(
                `SELECT view.owner_ordinal FROM ${STORE_TABLES.recordViews} AS view INNER JOIN ${STORE_TABLES.records} AS record ON record.record_id = view.record_id WHERE view.owner_id = ? AND view.record_id = ? AND record.schema_ref = ?`,
            )
            .get(runId, expectedLifecycleRecordId, startedSchema) as
            | { readonly owner_ordinal: number }
            | undefined;
        if (expectedHead === undefined) {
            throw new TraceStoreError(
                "durable running control command requires the exact retained lifecycle record",
            );
        }
        const schemas = projectionProtocolConfig.executionHistory.executionSchemas;
        const laterLifecycle = database
            .prepare(
                `SELECT 1 FROM ${STORE_TABLES.recordViews} AS view INNER JOIN ${STORE_TABLES.records} AS record ON record.record_id = view.record_id WHERE view.owner_id = ? AND view.owner_ordinal > ? AND record.schema_ref IN (?, ?, ?, ?, ?) LIMIT 1`,
            )
            .get(
                runId,
                expectedHead.owner_ordinal,
                startedSchema,
                schemas.completed,
                schemas.failed,
                runProtocolConfig.schemas.waitingLifecycleId,
                runProtocolConfig.schemas.suspendedLifecycleId,
            );
        if (laterLifecycle !== undefined) {
            throw new TraceStoreError(
                "durable running control command expected lifecycle record is no longer current",
            );
        }
        const receipt = appendWithinTraceStoreTransaction(database, request);
        database.exec(STORE_TRANSACTION_SQL.commit);
        return receipt;
    } catch (error) {
        database.exec(STORE_TRANSACTION_SQL.rollback);
        throw error;
    }
}

/**
 * Atomically publishes suspension evidence and releases the exact current invocation fence.
 *
 * @param database - Open trace-store database inside no caller-owned transaction.
 * @param runId - Durable run reaching a safe boundary.
 * @param expectedLifecycleRecordId - Exact current started lifecycle record.
 * @param fencingToken - Exact current invocation fencing token.
 * @param pauseCommandRecordId - Retained command authorizing suspension.
 * @param traceCutId - Immutable cut through the expected lifecycle record.
 * @param request - Canonical descriptor and suspension append request.
 * @returns The committed or identically replayed append receipt.
 * @throws {TraceStoreError} If any authority or retained evidence is inconsistent.
 * @throws {AppendIntentConflictError} If the intent already names different content.
 * @internal
 */
export function appendDurableExecutionSuspension(
    database: DatabaseSync,
    runId: string,
    expectedLifecycleRecordId: RecordId,
    fencingToken: number,
    pauseCommandRecordId: RecordId,
    traceCutId: string,
    request: StoreAppendRequest,
): AppendReceipt {
    assertNonEmptyString(runId, "runId");
    assertRecordId(expectedLifecycleRecordId, "expectedLifecycleRecordId");
    assertRecordId(pauseCommandRecordId, "pauseCommandRecordId");
    assertNonEmptyString(traceCutId, "traceCutId");
    if (!Number.isSafeInteger(fencingToken) || fencingToken <= 0) {
        throw new TypeError("fencingToken must be a positive safe integer");
    }
    database.exec(STORE_TRANSACTION_SQL.begin);
    try {
        const existingIntent = database
            .prepare(`SELECT 1 FROM ${STORE_TABLES.appendIntents} WHERE append_intent_id = ?`)
            .get(request.append_intent_id);
        if (existingIntent !== undefined) {
            const receipt = appendWithinTraceStoreTransaction(database, request);
            database.exec(STORE_TRANSACTION_SQL.commit);
            return receipt;
        }
        const claim = database
            .prepare(
                `SELECT fencing_token, started FROM ${STORE_TABLES.durableExecutionClaims} WHERE run_id = ?`,
            )
            .get(runId) as StartedClaimRow | undefined;
        if (claim === undefined || claim.started !== 1 || claim.fencing_token !== fencingToken) {
            throw new TraceStoreError(
                "durable suspension requires the current started invocation fence",
            );
        }
        const pause = readStoredRecord(database, pauseCommandRecordId);
        const pauseOwned = database
            .prepare(
                `SELECT 1 FROM ${STORE_TABLES.recordViews} WHERE owner_id = ? AND record_id = ?`,
            )
            .get(runId, pauseCommandRecordId);
        if (
            pause === undefined ||
            pauseOwned === undefined ||
            pause.envelope.schema_ref !== runProtocolConfig.execution.controlCommandSchemaId ||
            pause.envelope.mode !== CAPTURE_MODE ||
            pause.envelope.witness_ref !== ROOT_WITNESS_ID ||
            pause.envelope.caused_by_record_ids.length !== 1 ||
            pause.envelope.caused_by_record_ids[0] !== expectedLifecycleRecordId ||
            pause.body.command_kind !== runProtocolConfig.execution.controlCommandKinds[1] ||
            pause.body.execution_id !== runId ||
            pause.body.expected_lifecycle_record_id !== expectedLifecycleRecordId ||
            pause.body.fencing_token !== fencingToken
        ) {
            throw new TraceStoreError("durable suspension pause command is inconsistent");
        }
        const cut = readStoredCut(database, traceCutId);
        if (cut.target_owner_id !== runId || cut.through_record_id !== expectedLifecycleRecordId) {
            throw new TraceStoreError("durable suspension trace cut is inconsistent");
        }
        const schemas = projectionProtocolConfig.executionHistory.executionSchemas;
        const head = database
            .prepare(
                `SELECT owner_ordinal FROM ${STORE_TABLES.recordViews} WHERE owner_id = ? AND record_id = ?`,
            )
            .get(runId, expectedLifecycleRecordId) as { readonly owner_ordinal: number };
        const laterLifecycle = database
            .prepare(
                `SELECT 1 FROM ${STORE_TABLES.recordViews} AS view INNER JOIN ${STORE_TABLES.records} AS record ON record.record_id = view.record_id WHERE view.owner_id = ? AND view.owner_ordinal > ? AND record.schema_ref IN (?, ?, ?, ?, ?) LIMIT 1`,
            )
            .get(
                runId,
                head.owner_ordinal,
                schemas.started,
                schemas.completed,
                schemas.failed,
                runProtocolConfig.schemas.waitingLifecycleId,
                runProtocolConfig.schemas.suspendedLifecycleId,
            );
        if (laterLifecycle !== undefined) {
            throw new TraceStoreError(
                "durable suspension expected lifecycle record is no longer current",
            );
        }
        const receipt = appendWithinTraceStoreTransaction(database, request);
        database
            .prepare(
                `UPDATE ${STORE_TABLES.durableExecutionClaims} SET lease_expires_at = 0, started = 0 WHERE run_id = ? AND fencing_token = ?`,
            )
            .run(runId, fencingToken);
        database.exec(STORE_TRANSACTION_SQL.commit);
        return receipt;
    } catch (error) {
        database.exec(STORE_TRANSACTION_SQL.rollback);
        throw error;
    }
}

/**
 * Atomically acquires the next worker fence and publishes command-bound running continuation.
 *
 * @param database - Open trace-store database inside no caller-owned transaction.
 * @param runId - Durable run being resumed.
 * @param commandId - Globally idempotent resume command identity.
 * @param expectedLifecycleRecordId - Exact suspension acknowledgement expected as current.
 * @param continuationDescriptorRecordId - Exact continuation descriptor cited by suspension.
 * @param claimId - Deterministic new worker claim identity.
 * @param nowMilliseconds - Unix time used for deterministic lease creation.
 * @param leaseDurationMilliseconds - Configured positive lease duration.
 * @returns Canonical command/running identities and the new worker authority.
 * @throws {TraceStoreError} If lifecycle, continuation, or claim evidence is inconsistent.
 * @throws {AppendIntentConflictError} If command identity already names different content.
 * @internal
 */
export function appendDurableExecutionResume(
    database: DatabaseSync,
    runId: string,
    commandId: string,
    expectedLifecycleRecordId: RecordId,
    continuationDescriptorRecordId: RecordId,
    claimId: string,
    nowMilliseconds: number,
    leaseDurationMilliseconds: number,
): DurableExecutionResumeAppend {
    assertNonEmptyString(runId, "runId");
    assertNonEmptyString(commandId, "commandId");
    assertRecordId(expectedLifecycleRecordId, "expectedLifecycleRecordId");
    assertRecordId(continuationDescriptorRecordId, "continuationDescriptorRecordId");
    assertNonEmptyString(claimId, "claimId");
    if (!Number.isSafeInteger(nowMilliseconds) || nowMilliseconds < 0) {
        throw new TypeError("nowMilliseconds must be a non-negative safe integer");
    }
    if (!Number.isSafeInteger(leaseDurationMilliseconds) || leaseDurationMilliseconds <= 0) {
        throw new TypeError("leaseDurationMilliseconds must be a positive safe integer");
    }
    const appendIntentId = createRecordId({ durable_control_command_id: commandId });
    database.exec(STORE_TRANSACTION_SQL.begin);
    try {
        const existing = database
            .prepare(
                `SELECT view.record_id FROM ${STORE_TABLES.recordViews} AS view WHERE view.append_intent_id = ? ORDER BY view.append_position`,
            )
            .all(appendIntentId);
        if (existing.length > 0) {
            if (existing.length !== 2) {
                throw new TraceStoreError("durable resume append receipt is inconsistent");
            }
            const commandRecord = readStoredRecord(database, String(existing[0]?.record_id));
            const runningRecord = readStoredRecord(database, String(existing[1]?.record_id));
            if (commandRecord === undefined || runningRecord === undefined) {
                throw new TraceStoreError("durable resume records are unavailable");
            }
            const command = readDurableResumeCommand(commandRecord.body, runId);
            const running = readResumeRunningBody(runningRecord.body, runId);
            if (
                command.command_id !== commandId ||
                command.expected_lifecycle_record_id !== expectedLifecycleRecordId ||
                command.continuation_descriptor_id !== continuationDescriptorRecordId ||
                running.continuation_descriptor_id !== continuationDescriptorRecordId ||
                running.resume_command_id !== commandRecord.envelope.record_id ||
                running.claim_id !== claimId
            ) {
                throw new TraceStoreError("durable resume command identity conflicts with content");
            }
            const request = createResumeAppendRequest(
                runId,
                appendIntentId,
                commandId,
                expectedLifecycleRecordId,
                continuationDescriptorRecordId,
                claimId,
                running.fencing_token,
                running.lease_expires_at,
            );
            const receipt = appendWithinTraceStoreTransaction(database, request);
            database.exec(STORE_TRANSACTION_SQL.commit);
            return freezeResumeAppend(
                receipt.record_ids[0] as RecordId,
                receipt.record_ids[1] as RecordId,
                claimId,
                running.fencing_token,
                running.lease_expires_at,
            );
        }
        const suspension = readOwnedRecord(database, runId, expectedLifecycleRecordId);
        const descriptor = readOwnedRecord(database, runId, continuationDescriptorRecordId);
        if (
            suspension.envelope.schema_ref !== runProtocolConfig.schemas.suspendedLifecycleId ||
            descriptor.envelope.schema_ref !== runProtocolConfig.schemas.continuationDescriptorId
        ) {
            throw new TraceStoreError("durable resume lifecycle evidence has an invalid schema");
        }
        const suspensionBody = readExactDataObject(suspension.body, [
            "continuation_descriptor_id",
            "execution_id",
            "lifecycle_version",
            "pause_command_id",
            "status",
        ]);
        if (
            suspensionBody.execution_id !== runId ||
            suspensionBody.status !== runProtocolConfig.execution.lifecycleSuspendedStatus ||
            suspensionBody.lifecycle_version !== runProtocolConfig.execution.lifecycleVersion ||
            suspensionBody.continuation_descriptor_id !== continuationDescriptorRecordId
        ) {
            throw new TraceStoreError("durable resume suspension acknowledgement is inconsistent");
        }
        const descriptorBody = assertResumableDescriptor(descriptor.body, runId);
        assertNonEmptyString(descriptorBody.trace_cut_id, "resume continuation trace cut identity");
        const cut = readStoredCut(database, descriptorBody.trace_cut_id);
        if (cut.target_owner_id !== runId) {
            throw new TraceStoreError("durable resume continuation cut targets another run");
        }
        assertDurableExecutionRecordContract(descriptor, CAPTURE_MODE, ROOT_WITNESS_ID, [
            cut.created_by_record_id,
        ]);
        assertRecordId(suspensionBody.pause_command_id, "resume pause command identity");
        const pause = readOwnedRecord(database, runId, suspensionBody.pause_command_id);
        if (pause.envelope.schema_ref !== runProtocolConfig.execution.controlCommandSchemaId) {
            throw new TraceStoreError("durable resume pause command schema is inconsistent");
        }
        const pauseBody = readDurablePauseCommand(pause.body, runId);
        if (pauseBody.expected_lifecycle_record_id !== cut.through_record_id) {
            throw new TraceStoreError("durable resume pause command boundary is inconsistent");
        }
        assertDurableExecutionRecordContract(pause, CAPTURE_MODE, ROOT_WITNESS_ID, [
            cut.through_record_id,
        ]);
        assertDurableExecutionRecordContract(suspension, CAPTURE_MODE, ROOT_WITNESS_ID, [
            cut.through_record_id,
            pause.envelope.record_id,
            descriptor.envelope.record_id,
        ]);
        if (suspension.view.append_intent_id !== descriptor.view.append_intent_id) {
            throw new TraceStoreError(
                "durable resume suspension and descriptor must share one append transaction",
            );
        }
        const schemas = projectionProtocolConfig.executionHistory.executionSchemas;
        const suspensionHead = database
            .prepare(
                `SELECT owner_ordinal FROM ${STORE_TABLES.recordViews} WHERE owner_id = ? AND record_id = ?`,
            )
            .get(runId, expectedLifecycleRecordId) as { readonly owner_ordinal: number };
        const laterLifecycle = database
            .prepare(
                `SELECT 1 FROM ${STORE_TABLES.recordViews} AS view INNER JOIN ${STORE_TABLES.records} AS record ON record.record_id = view.record_id WHERE view.owner_id = ? AND view.owner_ordinal > ? AND record.schema_ref IN (?, ?, ?, ?, ?, ?) LIMIT 1`,
            )
            .get(
                runId,
                suspensionHead.owner_ordinal,
                schemas.started,
                schemas.completed,
                schemas.failed,
                runProtocolConfig.schemas.runningLifecycleId,
                runProtocolConfig.schemas.waitingLifecycleId,
                runProtocolConfig.schemas.suspendedLifecycleId,
            );
        if (laterLifecycle !== undefined) {
            throw new TraceStoreError(
                "durable resume expected lifecycle record is no longer current",
            );
        }
        const claim = database
            .prepare(
                `SELECT fencing_token, started FROM ${STORE_TABLES.durableExecutionClaims} WHERE run_id = ?`,
            )
            .get(runId) as StartedClaimRow | undefined;
        if (claim === undefined || claim.started !== 0) {
            throw new TraceStoreError("durable resume requires a released suspended worker claim");
        }
        const fencingToken = claim.fencing_token + 1;
        const leaseExpiresAt = nowMilliseconds + leaseDurationMilliseconds;
        if (!Number.isSafeInteger(fencingToken) || !Number.isSafeInteger(leaseExpiresAt)) {
            throw new TraceStoreError(
                "durable resume worker authority exceeds safe integer bounds",
            );
        }
        const request = createResumeAppendRequest(
            runId,
            appendIntentId,
            commandId,
            expectedLifecycleRecordId,
            continuationDescriptorRecordId,
            claimId,
            fencingToken,
            leaseExpiresAt,
        );
        const receipt = appendWithinTraceStoreTransaction(database, request);
        database
            .prepare(
                `UPDATE ${STORE_TABLES.durableExecutionClaims} SET claim_id = ?, fencing_token = ?, lease_expires_at = ?, started = 1 WHERE run_id = ? AND fencing_token = ? AND started = 0`,
            )
            .run(claimId, fencingToken, leaseExpiresAt, runId, claim.fencing_token);
        database.exec(STORE_TRANSACTION_SQL.commit);
        return freezeResumeAppend(
            receipt.record_ids[0] as RecordId,
            receipt.record_ids[1] as RecordId,
            claimId,
            fencingToken,
            leaseExpiresAt,
        );
    } catch (error) {
        database.exec(STORE_TRANSACTION_SQL.rollback);
        throw error;
    }
}

function createResumeAppendRequest(
    runId: string,
    appendIntentId: string,
    commandId: string,
    expectedLifecycleRecordId: RecordId,
    continuationDescriptorRecordId: RecordId,
    claimId: string,
    fencingToken: number,
    leaseExpiresAt: number,
): StoreAppendRequest {
    const commandBody = createDurableResumeCommand(
        runId,
        commandId,
        expectedLifecycleRecordId,
        continuationDescriptorRecordId,
    );
    const commandLocalId = createRecordId({ durable_resume_command_id: commandId });
    const commandRecordId = createRecordEnvelope({
        body: commandBody,
        caused_by_record_ids: [expectedLifecycleRecordId, continuationDescriptorRecordId],
        mode: CAPTURE_MODE,
        schema_ref: runProtocolConfig.execution.controlCommandSchemaId,
        witness_ref: ROOT_WITNESS_ID,
    }).record_id;
    return {
        append_intent_id: appendIntentId,
        batch: {
            groups: [
                {
                    caused_by_record_ids: [
                        expectedLifecycleRecordId,
                        continuationDescriptorRecordId,
                    ],
                    owner_id: runId,
                    records: [
                        {
                            append_local_id: commandLocalId,
                            body: commandBody,
                            mode: CAPTURE_MODE,
                            schema_ref: runProtocolConfig.execution.controlCommandSchemaId,
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
                {
                    caused_by_record_ids: [
                        expectedLifecycleRecordId,
                        continuationDescriptorRecordId,
                    ],
                    owner_id: runId,
                    records: [
                        {
                            body: {
                                claim_id: claimId,
                                continuation_descriptor_id: continuationDescriptorRecordId,
                                execution_id: runId,
                                fencing_token: fencingToken,
                                lifecycle_version: runProtocolConfig.execution.lifecycleVersion,
                                lease_expires_at: leaseExpiresAt,
                                resume_command_id: commandRecordId,
                                status: runProtocolConfig.execution.lifecycleRunningStatus,
                            },
                            caused_by_local_refs: [commandLocalId],
                            mode: CAPTURE_MODE,
                            schema_ref: runProtocolConfig.schemas.runningLifecycleId,
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    };
}

function readOwnedRecord(database: DatabaseSync, runId: string, recordId: RecordId): OwnerRecord {
    const record = readStoredRecord(database, recordId);
    const view = record?.views.find((candidate) => candidate.owner_id === runId);
    if (record === undefined || view === undefined) {
        throw new TraceStoreError("durable resume evidence is not owned by the run");
    }
    return Object.freeze({ body: record.body, envelope: record.envelope, view });
}

function assertResumableDescriptor(
    value: unknown,
    runId: string,
): Readonly<Record<string, unknown>> {
    const descriptor = readExactDataObject(value, [
        "constituents",
        "continuation_version",
        "execution_id",
        "trace_cut_id",
    ]);
    if (
        descriptor.execution_id !== runId ||
        descriptor.continuation_version !== runProtocolConfig.execution.continuationVersion ||
        !Array.isArray(descriptor.constituents) ||
        descriptor.constituents.length !==
            runProtocolConfig.execution.continuationConstituentKinds.length
    ) {
        throw new TraceStoreError("durable resume continuation descriptor is inconsistent");
    }
    const [, , unavailableStatus] = runProtocolConfig.execution.continuationEvidenceStatuses;
    for (const [index, candidate] of descriptor.constituents.entries()) {
        const evidence = readExactDataObject(candidate, ["kind", "status"], ["receipt_id"]);
        const verified = evidence.status === runProtocolConfig.execution.continuationVerifiedStatus;
        if (
            evidence.kind !== runProtocolConfig.execution.continuationConstituentKinds[index] ||
            !runProtocolConfig.execution.continuationEvidenceStatuses.includes(
                evidence.status as string,
            ) ||
            evidence.status === unavailableStatus ||
            (verified && typeof evidence.receipt_id !== "string") ||
            (!verified && evidence.receipt_id !== undefined)
        ) {
            throw new TraceStoreError("durable resume continuation evidence is not resumable");
        }
    }
    return descriptor;
}

function readResumeRunningBody(value: unknown, runId: string) {
    const body = readExactDataObject(value, [
        "claim_id",
        "continuation_descriptor_id",
        "execution_id",
        "fencing_token",
        "lease_expires_at",
        "lifecycle_version",
        "resume_command_id",
        "status",
    ]);
    if (
        body.execution_id !== runId ||
        body.status !== runProtocolConfig.execution.lifecycleRunningStatus ||
        body.lifecycle_version !== runProtocolConfig.execution.lifecycleVersion ||
        typeof body.claim_id !== "string" ||
        !Number.isSafeInteger(body.fencing_token) ||
        !Number.isSafeInteger(body.lease_expires_at)
    ) {
        throw new TraceStoreError("durable resumed running evidence is inconsistent");
    }
    return body as {
        readonly claim_id: string;
        readonly continuation_descriptor_id: RecordId;
        readonly fencing_token: number;
        readonly lease_expires_at: number;
        readonly resume_command_id: RecordId;
    };
}

function readExactDataObject(
    value: unknown,
    requiredKeys: readonly string[],
    optionalKeys: readonly string[] = [],
): Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new TraceStoreError("durable resume evidence must be a data object");
    }
    const keys = Object.keys(value);
    const allowed = [...requiredKeys, ...optionalKeys];
    if (
        requiredKeys.some((key) => !Object.hasOwn(value, key)) ||
        keys.some((key) => !allowed.includes(key))
    ) {
        throw new TraceStoreError("durable resume evidence fields are inconsistent");
    }
    return value as Record<string, unknown>;
}

function freezeResumeAppend(
    commandRecordId: RecordId,
    runningRecordId: RecordId,
    claimId: string,
    fencingToken: number,
    leaseExpiresAt: number,
): DurableExecutionResumeAppend {
    return Object.freeze({
        claim_id: claimId,
        command_record_id: commandRecordId,
        fencing_token: fencingToken,
        lease_expires_at: leaseExpiresAt,
        running_record_id: runningRecordId,
    });
}
