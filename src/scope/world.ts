import { SCOPE_FORK_PHASES } from "../protocol/values.generated.ts";
import type { OwnerRecord } from "../store/types.ts";
import { ScopeEvidenceError } from "./errors.ts";
import {
    createScopeForkAppendIntentId,
    createScopeForkCustodyId,
    readScopeForkRecord,
} from "./records.ts";
import type {
    ScopeForkCompletedRecord,
    ScopeForkPreparedRecord,
    ScopeWorldInspection,
} from "./types.ts";

const [PREPARED_PHASE, COMPLETED_PHASE] = SCOPE_FORK_PHASES;

/** Decodes one prepared fork journal occurrence bound to its exact scope and command. @internal */
export function readPreparedForkOccurrence(
    record: OwnerRecord,
    scopeId: string,
    commandId: string,
): ScopeForkPreparedRecord {
    const prepared = readScopeForkRecord(record.body);
    if (
        prepared.phase !== PREPARED_PHASE ||
        prepared.scope_id !== scopeId ||
        prepared.command_id !== commandId ||
        prepared.custody_id !== createScopeForkCustodyId(commandId, scopeId) ||
        record.view.append_intent_id !== createScopeForkAppendIntentId(commandId, PREPARED_PHASE)
    ) {
        throw new ScopeEvidenceError("scope fork prepared record disagrees with its command");
    }
    return prepared;
}

/**
 * Builds the validated world view of one forked scope from its retained journal occurrences.
 *
 * @param preparedRecord - Prepared fork journal occurrence on the child path.
 * @param completedRecord - Completed fork journal occurrence, or null while only prepared.
 * @param scopeId - Forked child scope identity.
 * @param commandId - Fork command identity retained by the child registration.
 * @returns Frozen validated world inspection.
 * @throws {ScopeEvidenceError} If journal evidence is malformed or inconsistent.
 * @internal
 */
export function readScopeWorld(
    preparedRecord: OwnerRecord,
    completedRecord: OwnerRecord | null,
    scopeId: string,
    commandId: string,
): ScopeWorldInspection {
    const prepared = readPreparedForkOccurrence(preparedRecord, scopeId, commandId);
    let completed: ScopeForkCompletedRecord | null = null;
    if (completedRecord !== null) {
        const decoded = readScopeForkRecord(completedRecord.body);
        if (
            decoded.phase !== COMPLETED_PHASE ||
            decoded.scope_id !== scopeId ||
            decoded.command_id !== commandId ||
            decoded.custody_id !== prepared.custody_id ||
            completedRecord.envelope.caused_by_record_ids[0] !==
                preparedRecord.envelope.record_id ||
            completedRecord.view.append_intent_id !==
                createScopeForkAppendIntentId(commandId, COMPLETED_PHASE)
        ) {
            throw new ScopeEvidenceError("scope fork completed record disagrees with its journal");
        }
        completed = decoded;
    }
    return Object.freeze({
        base_content_id: prepared.base_content_id,
        base_revision_id: prepared.base_revision_id,
        binding_id: prepared.binding_id,
        capture_kind: prepared.capture_kind,
        checkpoint: completed === null ? null : completed.checkpoint,
        completed_record_id: completedRecord === null ? null : completedRecord.envelope.record_id,
        custody_id: prepared.custody_id,
        prepared_record_id: preparedRecord.envelope.record_id,
        resource: Object.freeze({
            resource_id: prepared.resource_id,
            resource_kind: prepared.resource_kind,
        }),
        status: completed === null ? PREPARED_PHASE : COMPLETED_PHASE,
    });
}
