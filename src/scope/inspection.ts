import { kernelProtocolConfig, scopeProtocolConfig } from "../protocol/config.ts";
import {
    SCOPE_EVIDENCE_KINDS,
    SCOPE_FORK_PHASES,
    SCOPE_STATES,
    SCOPE_WORLD_CAPABILITIES,
} from "../protocol/values.generated.ts";
import type { RecordId } from "../record/types.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import type { OwnerRecord } from "../store/types.ts";
import { ScopeEvidenceError } from "./errors.ts";
import {
    createScopeCommandAppendIntentId,
    readScopeChildRegisteredRecord,
    readScopeEmissionRecord,
    readScopeRegistrationRecord,
} from "./records.ts";
import type {
    ScopeHistoryEntry,
    ScopeInspection,
    ScopeState,
    ScopeWorldInspection,
} from "./types.ts";
import { assertScopeId } from "./validation.ts";
import { readScopeWorld } from "./world.ts";

const [
    REGISTRATION_KIND,
    ORIGIN_CUT_KIND,
    CHILD_REGISTERED_KIND,
    EMISSION_KIND,
    FORK_PREPARED_KIND,
    FORK_COMPLETED_KIND,
] = SCOPE_EVIDENCE_KINDS;
const [OPEN_STATE] = SCOPE_STATES;
const [, REFERENCE_COPY_CAPABILITY] = SCOPE_WORLD_CAPABILITIES;
const [, FORK_COMPLETED_STATUS] = SCOPE_FORK_PHASES;

/**
 * Reconstructs and validates one scope from its retained owner path without mutation.
 *
 * The projection is derived from canonical records, so a read-only reopen or a native archive
 * import produces the same result. Live registration admitting mutation is reported separately:
 * an imported archive carries inspection evidence only and reports `registered_for_mutation`
 * false. Slice A retains only open scopes; merge and discard evidence are later slices.
 *
 * @param store - Open trace store, writable or read-only.
 * @param scopeId - Exact configured scope identity.
 * @returns Frozen validated inspection, or `undefined` when the owner path retains nothing.
 * @throws {ScopeEvidenceError} If retained scope evidence is malformed or inconsistent.
 * @throws {TraceStoreError} If the store is closed or a cited cut is absent or corrupt.
 * @throws {TypeError} If the scope identity is malformed.
 *
 * @example
 * ```ts
 * const inspection = inspectScope(store, root.scope_id);
 * console.log(inspection?.head.record_id, inspection?.history.length);
 * ```
 *
 * @public
 */
export function inspectScope(
    store: SQLiteTraceStore,
    scopeId: string,
): ScopeInspection | undefined {
    assertScopeId(scopeId, "scopeId");
    const records = store.readOwner(scopeId);
    const first = records[0];
    if (first === undefined) {
        return undefined;
    }
    assertSchema(first, scopeProtocolConfig.traceSchemas.registration, "first scope record");
    const registration = readScopeRegistrationRecord(first.body);
    if (registration.scope_id !== scopeId) {
        throw new ScopeEvidenceError("scope registration names another scope");
    }
    assertCommandIntent(first, registration.command_id);
    const history: ScopeHistoryEntry[] = [
        {
            command_id: registration.command_id,
            kind: REGISTRATION_KIND,
            owner_ordinal: first.view.owner_ordinal,
            record_id: first.envelope.record_id,
        },
    ];
    const children: string[] = [];
    let previous = first;
    let nextIndex = 1;
    if (registration.parent !== null) {
        const originRecord = records[1];
        if (originRecord === undefined) {
            throw new ScopeEvidenceError("child scope lacks its origin-cut publication");
        }
        assertSchema(originRecord, kernelProtocolConfig.queries.cutSchemaRef, "scope origin cut");
        const cut = store.readCut(registration.parent.origin_cut_id);
        if (
            originRecord.view.append_intent_id !==
            `${kernelProtocolConfig.queries.cutAppendIntentPrefix}${cut.cut_id}`
        ) {
            throw new ScopeEvidenceError("scope origin cut is not retained by its own intent");
        }
        if (
            cut.created_by_record_id !== originRecord.envelope.record_id ||
            cut.publisher_owner_id !== scopeId ||
            cut.target_owner_id !== registration.parent.scope_id ||
            cut.through_record_id !== registration.parent.origin_record_id ||
            first.envelope.caused_by_record_ids[0] !==
                registration.parent.child_registered_record_id
        ) {
            throw new ScopeEvidenceError("child scope origin disagrees with its retained cut");
        }
        history.push({
            cut_id: cut.cut_id,
            kind: ORIGIN_CUT_KIND,
            owner_ordinal: originRecord.view.owner_ordinal,
            record_id: originRecord.envelope.record_id,
        });
        previous = originRecord;
        nextIndex = 2;
    }
    const forked = registration.world_capability === REFERENCE_COPY_CAPABILITY;
    let world: ScopeWorldInspection | null = null;
    let preparedRecord: OwnerRecord | null = null;
    for (const record of records.slice(nextIndex)) {
        if (record.envelope.caused_by_record_ids[0] !== previous.envelope.record_id) {
            throw new ScopeEvidenceError("scope record is not caused by the previous head");
        }
        const isFork = record.envelope.schema_ref === scopeProtocolConfig.traceSchemas.fork;
        if (forked && (world === null || world.status !== FORK_COMPLETED_STATUS) && !isFork) {
            throw new ScopeEvidenceError("scope world fork is not complete");
        }
        if (isFork) {
            if (!forked || world?.status === FORK_COMPLETED_STATUS) {
                throw new ScopeEvidenceError("scope path retains an unexpected fork record");
            }
            world =
                preparedRecord === null
                    ? readScopeWorld(record, null, scopeId, registration.command_id)
                    : readScopeWorld(preparedRecord, record, scopeId, registration.command_id);
            preparedRecord = preparedRecord ?? record;
            history.push({
                command_id: registration.command_id,
                custody_id: world.custody_id,
                kind:
                    world.status === FORK_COMPLETED_STATUS
                        ? FORK_COMPLETED_KIND
                        : FORK_PREPARED_KIND,
                owner_ordinal: record.view.owner_ordinal,
                record_id: record.envelope.record_id,
            });
        } else if (record.envelope.schema_ref === scopeProtocolConfig.traceSchemas.emission) {
            const emission = readScopeEmissionRecord(record.body);
            assertCommandIntent(record, emission.command_id);
            if (
                emission.scope_id !== scopeId ||
                emission.expected_head_record_id !== previous.envelope.record_id
            ) {
                throw new ScopeEvidenceError("scope emission disagrees with its retained head");
            }
            history.push({
                cited_record_ids: emission.cited_record_ids,
                command_id: emission.command_id,
                kind: EMISSION_KIND,
                owner_ordinal: record.view.owner_ordinal,
                record_id: record.envelope.record_id,
            });
        } else if (
            record.envelope.schema_ref === scopeProtocolConfig.traceSchemas.childRegistered
        ) {
            const childRegistered = readScopeChildRegisteredRecord(record.body);
            assertCommandIntent(record, childRegistered.command_id);
            if (
                childRegistered.parent_scope_id !== scopeId ||
                childRegistered.origin_record_id !== previous.envelope.record_id
            ) {
                throw new ScopeEvidenceError(
                    "scope child registration disagrees with its retained head",
                );
            }
            children.push(childRegistered.child_scope_id);
            history.push({
                child_scope_id: childRegistered.child_scope_id,
                command_id: childRegistered.command_id,
                kind: CHILD_REGISTERED_KIND,
                owner_ordinal: record.view.owner_ordinal,
                record_id: record.envelope.record_id,
            });
        } else {
            throw new ScopeEvidenceError(
                `scope path retains unsupported record schema ${record.envelope.schema_ref}`,
            );
        }
        previous = record;
    }
    if (forked && world === null) {
        throw new ScopeEvidenceError("reference-copy scope lacks its prepared fork record");
    }
    const row = store.readScopeRegistration(scopeId);
    let state: ScopeState = OPEN_STATE;
    if (row !== undefined) {
        if (
            row.registration_record_id !== first.envelope.record_id ||
            row.parent_scope_id !== (registration.parent?.scope_id ?? null) ||
            !SCOPE_STATES.includes(row.state as ScopeState)
        ) {
            throw new ScopeEvidenceError("scope registration row disagrees with retained records");
        }
        state = row.state as ScopeState;
    }
    return Object.freeze({
        authority: registration.authority,
        children: Object.freeze(children),
        execution_id: registration.execution_id,
        head: Object.freeze({
            owner_ordinal: previous.view.owner_ordinal,
            record_id: previous.envelope.record_id as RecordId,
        }),
        history: Object.freeze(history.map((entry) => Object.freeze(entry))),
        kind: registration.kind,
        parent: registration.parent,
        registered_for_mutation: row !== undefined,
        registration_record_id: first.envelope.record_id,
        scope_id: scopeId,
        state,
        world,
        world_capability: registration.world_capability,
    });
}

function assertCommandIntent(record: OwnerRecord, commandId: string): void {
    if (record.view.append_intent_id !== createScopeCommandAppendIntentId(commandId)) {
        throw new ScopeEvidenceError("scope record is not retained by its command intent");
    }
}

function assertSchema(record: OwnerRecord, schemaRef: string, subject: string): void {
    if (record.envelope.schema_ref !== schemaRef) {
        throw new ScopeEvidenceError(`${subject} uses schema ${record.envelope.schema_ref}`);
    }
}
