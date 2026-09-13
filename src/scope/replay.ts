import { scopeProtocolConfig } from "../protocol/config.ts";
import {
    SCOPE_COMMAND_KINDS,
    SCOPE_FORK_PHASES,
    SCOPE_KINDS,
    SCOPE_WORLD_CAPABILITIES,
} from "../protocol/values.generated.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import type { OwnerRecord } from "../store/types.ts";
import { ScopeEvidenceError } from "./errors.ts";
import {
    createScopeCommandAppendIntentId,
    createScopeForkAppendIntentId,
    readScopeChildRegisteredRecord,
    readScopeEmissionRecord,
    readScopeRegistrationRecord,
} from "./records.ts";
import type { ScopeCommandReplay } from "./types.ts";
import { assertScopeText } from "./validation.ts";
import { readScopeWorld } from "./world.ts";

const [REGISTER_ROOT_COMMAND, REGISTER_CHILD_COMMAND, EMIT_COMMAND, FORK_COMMAND] =
    SCOPE_COMMAND_KINDS;
const [ROOT_KIND, CHILD_KIND] = SCOPE_KINDS;
const [, REFERENCE_COPY_CAPABILITY] = SCOPE_WORLD_CAPABILITIES;
const [PREPARED_PHASE, COMPLETED_PHASE] = SCOPE_FORK_PHASES;

/**
 * Reads the exact retained receipt of one completed scope command without any writer authority.
 *
 * Receipt replay is a read: it reconstructs the original registration, emission, or fork receipt
 * from the records retained under the command's append intents, so a caller that lost its
 * response, restarted, or whose fence is stale or superseded still receives the original result.
 * It grants no mutation authority and works on read-only and imported stores. A fork is complete
 * only once its completed journal record is retained; until then no receipt exists, and
 * `inspectScope` reports the prepared world.
 *
 * @param store - Open trace store, writable or read-only.
 * @param commandId - Globally idempotent scope command identity.
 * @returns The classified original receipt, or `undefined` when the command has not completed.
 * @throws {ScopeEvidenceError} If retained command evidence is not well-formed scope evidence.
 * @throws {TraceStoreError} If the store is closed or a cited cut is absent or corrupt.
 * @throws {TypeError} If the command identity is malformed.
 *
 * @example
 * ```ts
 * const replay = readScopeCommandReceipt(store, "scope-command:emit-1");
 * if (replay?.command === "emit") {
 *     console.log(replay.receipt.head.record_id);
 * }
 * ```
 *
 * @public
 */
export function readScopeCommandReceipt(
    store: SQLiteTraceStore,
    commandId: string,
): ScopeCommandReplay | undefined {
    assertScopeText(commandId, "commandId");
    const records = store.readAppendIntentRecords(createScopeCommandAppendIntentId(commandId));
    const [first, second] = records;
    if (first === undefined) {
        return undefined;
    }
    if (
        records.length === 1 &&
        first.envelope.schema_ref === scopeProtocolConfig.traceSchemas.registration
    ) {
        const registration = readScopeRegistrationRecord(first.body);
        if (registration.kind !== ROOT_KIND || registration.command_id !== commandId) {
            throw new ScopeEvidenceError("scope command evidence is not a root registration");
        }
        return Object.freeze({
            command: REGISTER_ROOT_COMMAND,
            receipt: Object.freeze({
                authority: registration.authority,
                command_id: commandId,
                head: headOf(first),
                kind: ROOT_KIND,
                registration_record_id: first.envelope.record_id,
                scope_id: registration.scope_id,
            }),
        });
    }
    if (
        records.length === 2 &&
        second !== undefined &&
        first.envelope.schema_ref === scopeProtocolConfig.traceSchemas.childRegistered &&
        second.envelope.schema_ref === scopeProtocolConfig.traceSchemas.registration
    ) {
        const childRegistered = readScopeChildRegisteredRecord(first.body);
        const registration = readScopeRegistrationRecord(second.body);
        if (
            registration.kind !== CHILD_KIND ||
            registration.parent === null ||
            registration.command_id !== commandId ||
            childRegistered.command_id !== commandId ||
            registration.parent.child_registered_record_id !== first.envelope.record_id
        ) {
            throw new ScopeEvidenceError("scope command evidence is not a child registration");
        }
        const cut = store.readCut(registration.parent.origin_cut_id);
        if (cut.publisher_owner_id !== registration.scope_id) {
            throw new ScopeEvidenceError("scope command origin cut names another publisher");
        }
        if (registration.world_capability === REFERENCE_COPY_CAPABILITY) {
            const prepared = store.readAppendIntentRecords(
                createScopeForkAppendIntentId(commandId, PREPARED_PHASE),
            );
            const completed = store.readAppendIntentRecords(
                createScopeForkAppendIntentId(commandId, COMPLETED_PHASE),
            );
            if (completed.length === 0) {
                return undefined;
            }
            const [preparedRecord] = prepared;
            const [completedRecord] = completed;
            if (
                prepared.length !== 1 ||
                completed.length !== 1 ||
                preparedRecord === undefined ||
                completedRecord === undefined ||
                preparedRecord.envelope.caused_by_record_ids[0] !== cut.created_by_record_id
            ) {
                throw new ScopeEvidenceError("scope fork journal evidence is inconsistent");
            }
            const world = readScopeWorld(
                preparedRecord,
                completedRecord,
                registration.scope_id,
                commandId,
            );
            return Object.freeze({
                command: FORK_COMMAND,
                receipt: Object.freeze({
                    authority: registration.authority,
                    command_id: commandId,
                    completed_record_id: completedRecord.envelope.record_id,
                    head: headOf(completedRecord),
                    kind: CHILD_KIND,
                    origin: registration.parent,
                    parent_head: headOf(first),
                    prepared_record_id: preparedRecord.envelope.record_id,
                    registration_record_id: second.envelope.record_id,
                    scope_id: registration.scope_id,
                    world,
                }),
            });
        }
        return Object.freeze({
            command: REGISTER_CHILD_COMMAND,
            receipt: Object.freeze({
                authority: registration.authority,
                command_id: commandId,
                head: Object.freeze({
                    owner_ordinal: second.view.owner_ordinal + 1,
                    record_id: cut.created_by_record_id,
                }),
                kind: CHILD_KIND,
                origin: registration.parent,
                parent_head: headOf(first),
                registration_record_id: second.envelope.record_id,
                scope_id: registration.scope_id,
            }),
        });
    }
    if (
        records.length === 1 &&
        first.envelope.schema_ref === scopeProtocolConfig.traceSchemas.emission
    ) {
        const emission = readScopeEmissionRecord(first.body);
        if (emission.command_id !== commandId) {
            throw new ScopeEvidenceError("scope command evidence names another emission command");
        }
        return Object.freeze({
            command: EMIT_COMMAND,
            receipt: Object.freeze({
                command_id: commandId,
                head: headOf(first),
                previous_head_record_id: emission.expected_head_record_id,
                scope_id: emission.scope_id,
            }),
        });
    }
    throw new ScopeEvidenceError("scope command intent retains unsupported evidence");
}

function headOf(record: OwnerRecord) {
    return Object.freeze({
        owner_ordinal: record.view.owner_ordinal,
        record_id: record.envelope.record_id,
    });
}
