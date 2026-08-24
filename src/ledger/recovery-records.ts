import { projectionProtocolConfig, runProtocolConfig } from "../protocol/config.ts";
import {
    DURABLE_EXECUTION_CONTROL_COMMAND_KINDS,
    RUN_CONTINUATION_EVIDENCE_STATUSES,
} from "../protocol/values.generated.ts";
import {
    readDurableCancellationCommand,
    readDurablePauseCommand,
    readDurableRecoveryCommand,
    readDurableResumeCommand,
} from "../run/durable-execution-control-codec.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import type { OwnerRecord } from "../store/types.ts";
import { assertLedgerEntryBounded, readLedgerListOptions, readLedgerSelector } from "./bounds.ts";
import { resolveRunLedgerSelector } from "./run-ledger.ts";
import { ambiguousLedgerSelector, missingLedgerSelector } from "./selector-errors.ts";
import type {
    LedgerListOptions,
    RecoveryCommandEvidence,
    RecoveryInvocationClaimEvidence,
    RecoveryRecordEntry,
    RunLedgerEntry,
} from "./types.ts";

const [RECOVER_KIND, PAUSE_KIND, RESUME_KIND, CANCEL_KIND] =
    DURABLE_EXECUTION_CONTROL_COMMAND_KINDS;
const [VERIFIED_CLAIM_STATUS, , UNAVAILABLE_CLAIM_STATUS] = RUN_CONTINUATION_EVIDENCE_STATUSES;

/**
 * Lists bounded durable recovery/control projections in canonical run-ledger order.
 *
 * @param store - Open trace store containing durable execution evidence.
 * @param options - Optional closed configured pagination object.
 * @returns Frozen immutable recovery record entries.
 * @throws {TraceStoreError} If retained lifecycle, command, or cut evidence is corrupt.
 * @throws {TypeError} If options or canonical projection bounds are invalid.
 */
export function listRecoveryRecords(
    store: SQLiteTraceStore,
    options?: LedgerListOptions,
): readonly RecoveryRecordEntry[] {
    const policy = projectionProtocolConfig.evidenceRecords;
    const { limit, offset } = readLedgerListOptions(options, policy);
    const schema = projectionProtocolConfig.executionHistory.executionSchemas.created;
    return Object.freeze(
        store
            .listOwnersBySchema(schema, limit, offset)
            .map((runId) => recoveryRecord(store, resolveRunLedgerSelector(store, runId))),
    );
}

/**
 * Resolves recovery records through the exact/prefix/latest read-only run selector contract.
 *
 * @param store - Open trace store containing durable execution evidence.
 * @param selector - Exact run ID, unique prefix, or configured latest token.
 * @returns Exact immutable recovery record projection.
 * @throws {LedgerSelectorAmbiguousError} If a run prefix is ambiguous.
 * @throws {LedgerSelectorNotFoundError} If no run matches.
 * @throws {TraceStoreError} If retained lifecycle, command, or cut evidence is corrupt.
 * @throws {TypeError} If the selector or canonical projection bounds are invalid.
 */
export function resolveRecoveryRecordSelector(
    store: SQLiteTraceStore,
    selector: string,
): RecoveryRecordEntry {
    const policy = projectionProtocolConfig.evidenceRecords;
    const exactSelector = readLedgerSelector(selector, "recovery record selector", policy);
    const schema = projectionProtocolConfig.executionHistory.executionSchemas.created;
    if (store.readOwner(exactSelector).some((record) => record.envelope.schema_ref === schema)) {
        return recoveryRecord(store, resolveRunLedgerSelector(store, exactSelector));
    }
    if (exactSelector === policy.latestSelector) {
        const latestRunId = store.listOwnersBySchema(schema, 1, 0, true)[0];
        if (latestRunId === undefined) throw missingLedgerSelector(exactSelector, policy.errors);
        return recoveryRecord(store, resolveRunLedgerSelector(store, latestRunId));
    }
    const matches = store.listOwnersBySchema(
        schema,
        policy.maxPageSize + 1,
        0,
        false,
        exactSelector,
    );
    if (matches.length === 0) throw missingLedgerSelector(exactSelector, policy.errors);
    if (matches.length > 1) throw ambiguousLedgerSelector(exactSelector, policy.errors);
    return recoveryRecord(
        store,
        resolveRunLedgerSelector(store, matches[0] as (typeof matches)[number]),
    );
}

function recoveryRecord(store: SQLiteTraceStore, run: RunLedgerEntry): RecoveryRecordEntry {
    const headRecordId = lifecycleHead(run);
    const ownerRecords = store.readOwner(run.run_id);
    const head = ownerRecords.find(
        (record) => record.envelope.record_id === headRecordId,
    ) as OwnerRecord;
    const terminalPrefix = ownerRecords.filter(
        (record) => record.view.owner_ordinal <= head.view.owner_ordinal,
    );
    const cutPublication =
        run.inspection.cut === null
            ? undefined
            : ownerRecords.find(
                  (record) =>
                      record.envelope.record_id === run.inspection.cut?.created_by_record_id,
              );
    const terminalRecoveryCommands = ownerRecords.filter(
        (record) =>
            record.view.owner_ordinal > head.view.owner_ordinal &&
            record.envelope.schema_ref === runProtocolConfig.execution.controlCommandSchemaId &&
            record.body.command_kind === RECOVER_KIND &&
            record.envelope.caused_by_record_ids.includes(run.created_record_id) &&
            cutPublication?.envelope.caused_by_record_ids.includes(record.envelope.record_id) ===
                true,
    );
    const bounded =
        run.inspection.lifecycle.terminal_record_id === null
            ? ownerRecords
            : [
                  ...terminalPrefix,
                  ...terminalRecoveryCommands,
                  ...(cutPublication === undefined ? [] : [cutPublication]),
              ]
                  .filter(
                      (record, index, records) =>
                          records.findIndex(
                              (candidate) =>
                                  candidate.envelope.record_id === record.envelope.record_id,
                          ) === index,
                  )
                  .sort((left, right) => left.view.owner_ordinal - right.view.owner_ordinal);
    const commands = Object.freeze(
        bounded
            .filter(
                (record) =>
                    record.envelope.schema_ref ===
                    runProtocolConfig.execution.controlCommandSchemaId,
            )
            .map((record) => commandEvidence(record, run.run_id, run.created_record_id)),
    );
    const entry = Object.freeze({
        command_results: Object.freeze(
            commands.map((command) =>
                Object.freeze({
                    command_record_id: command.record_id,
                    effect_record_ids: Object.freeze(
                        bounded
                            .filter((record) =>
                                record.envelope.caused_by_record_ids.includes(command.record_id),
                            )
                            .map((record) => record.envelope.record_id),
                    ),
                }),
            ),
        ),
        commands,
        compatibility_version: projectionProtocolConfig.evidenceRecords.compatibilityVersion,
        invocation_claim: invocationClaim(
            bounded,
            run.inspection.lifecycle.running_continuation_record_id,
        ),
        lifecycle: run.inspection.lifecycle,
        lifecycle_head_record_id: headRecordId,
        recovery_record_version: projectionProtocolConfig.evidenceRecords.version,
        recovery_status: run.inspection.status,
        run_id: run.run_id,
    });
    assertLedgerEntryBounded(
        entry,
        projectionProtocolConfig.evidenceRecords.maxCanonicalEntryBytes,
    );
    return entry;
}

function lifecycleHead(run: RunLedgerEntry): string {
    const lifecycle = run.inspection.lifecycle;
    const head =
        lifecycle.terminal_record_id ??
        lifecycle.running_continuation_record_id ??
        lifecycle.quiescent?.acknowledgement_record_id ??
        lifecycle.started_record_id ??
        run.created_record_id;
    return head;
}

function commandEvidence(
    record: OwnerRecord,
    runId: string,
    createdRecordId: string,
): RecoveryCommandEvidence {
    const kind = record.body.command_kind;
    const command =
        kind === RECOVER_KIND
            ? readDurableRecoveryCommand(record.body, runId)
            : kind === PAUSE_KIND
              ? readDurablePauseCommand(record.body, runId)
              : kind === RESUME_KIND
                ? readDurableResumeCommand(record.body, runId)
                : kind === CANCEL_KIND
                  ? readDurableCancellationCommand(record.body, runId)
                  : (() => {
                        throw new TypeError("recovery record command kind is unsupported");
                    })();
    const expectedCauses =
        kind === RECOVER_KIND
            ? [createdRecordId]
            : kind === RESUME_KIND && "continuation_descriptor_id" in command
              ? [command.expected_lifecycle_record_id, command.continuation_descriptor_id]
              : "expected_lifecycle_record_id" in command
                ? [command.expected_lifecycle_record_id]
                : [];
    if (
        record.envelope.caused_by_record_ids.length !== expectedCauses.length ||
        expectedCauses.some(
            (recordId, index) => record.envelope.caused_by_record_ids[index] !== recordId,
        )
    ) {
        throw new TypeError("recovery record command causality is inconsistent");
    }
    return Object.freeze({
        caused_by_record_ids: record.envelope.caused_by_record_ids,
        command,
        record_id: record.envelope.record_id,
    });
}

function invocationClaim(
    records: readonly OwnerRecord[],
    runningContinuationRecordId: string | null,
): RecoveryInvocationClaimEvidence {
    if (runningContinuationRecordId === null) {
        return Object.freeze({ status: UNAVAILABLE_CLAIM_STATUS });
    }
    const retained = records.find(
        ({ envelope }) =>
            envelope.record_id === runningContinuationRecordId &&
            envelope.schema_ref === runProtocolConfig.schemas.runningLifecycleId,
    ) as OwnerRecord;
    return Object.freeze({
        claim_id: retained.body.claim_id as string,
        fencing_token: Number(retained.body.fencing_token),
        record_id: retained.envelope.record_id,
        status: VERIFIED_CLAIM_STATUS,
    });
}
