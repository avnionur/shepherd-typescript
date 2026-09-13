import { scopeProtocolConfig } from "../protocol/config.ts";
import {
    RECORD_MODES,
    SCOPE_KINDS,
    SCOPE_WORLD_CAPABILITIES,
} from "../protocol/values.generated.ts";
import { createRecordEnvelope } from "../record/envelope.ts";
import { assertRecordId } from "../record/guards.ts";
import { ROOT_WITNESS_ID } from "../record/root-witness.ts";
import type { RecordBody, RecordId } from "../record/types.ts";
import type { ChildScopeRegistrationRequest } from "../store/scope-registrations.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import type { AppendReceipt } from "../store/types.ts";
import { attenuateScopeAuthority, readScopeResourceGrants } from "./authority.ts";
import { ScopeEvidenceError } from "./errors.ts";
import {
    createScopeChildRegisteredBody,
    createScopeCommandAppendIntentId,
    createScopeId,
    createScopeOriginCutId,
    createScopeRegistrationBody,
    readScopeRegistrationRecord,
} from "./records.ts";
import type {
    RegisterChildScopeOptions,
    RegisterRootScopeOptions,
    ScopeAuthority,
    ScopeChildRegistrationReceipt,
    ScopeHeadAddress,
    ScopeParentOrigin,
    ScopeRootRegistrationReceipt,
    ScopeWorldCapability,
} from "./types.ts";
import { assertScopeText, readNowMilliseconds, readScopeDataObject } from "./validation.ts";
import { assertScopeWriter } from "./writer.ts";

const [CAPTURE_MODE] = RECORD_MODES;
const [ROOT_KIND, CHILD_KIND] = SCOPE_KINDS;
const [TRACE_ONLY_CAPABILITY] = SCOPE_WORLD_CAPABILITIES;
const CHILD_REGISTERED_LOCAL_ID = "scope_child_registered";

/**
 * Durably registers one root scope with explicit trace authority and a whole-run ceiling.
 *
 * The registration record is the first occurrence on the new scope owner path. Effective
 * authority is the per-resource intersection of the requested grant and the ceiling. An exact
 * retry of the same command returns the original receipt across restart; reusing the command
 * identity for different content fails closed. Registration is trace-only: it forks no world,
 * invokes no provider, and materializes nothing.
 *
 * @param store - Open writable trace store.
 * @param options - Closed command identity, authority, and optional execution association.
 * @returns Frozen durable registration receipt.
 * @throws {ScopeAuthorityError} If the grant cites resources outside the ceiling or unknown atoms.
 * @throws {ScopeEvidenceError} If the scope already exists or execution evidence is absent.
 * @throws {AppendIntentConflictError} If the command identity already names different content.
 * @throws {TraceStoreError} If the store is closed.
 * @throws {TypeError} If options are malformed.
 *
 * @example
 * ```ts
 * const root = registerRootScope(store, {
 *     authority: {
 *         ceiling: [{ atoms: ["read", "write"], resource_id: "sha256:...", resource_kind: "repository_binding" }],
 *         grant: [{ atoms: ["read"], resource_id: "sha256:...", resource_kind: "repository_binding" }],
 *     },
 *     commandId: "scope-command:root:1",
 * });
 * ```
 *
 * @public
 */
export function registerRootScope(
    store: SQLiteTraceStore,
    options: RegisterRootScopeOptions,
): ScopeRootRegistrationReceipt {
    const fields = readScopeDataObject(
        options,
        ["authority", "commandId"],
        "registerRootScope options",
        ["executionId"],
    );
    assertScopeText(fields.commandId, "commandId");
    const executionId = readExecutionId(fields.executionId);
    const authorityFields = readScopeDataObject(
        fields.authority,
        ["ceiling", "grant"],
        "registerRootScope authority",
    );
    const authority = attenuateScopeAuthority(
        readScopeResourceGrants(authorityFields.ceiling, "authority.ceiling"),
        null,
        readScopeResourceGrants(authorityFields.grant, "authority.grant"),
    );
    const scopeId = createScopeId(fields.commandId, null);
    const body = createScopeRegistrationBody({
        authority,
        commandId: fields.commandId,
        executionId,
        parent: null,
        scopeId,
    });
    const receipt = store.registerRootScope(scopeId, executionId, {
        append_intent_id: createScopeCommandAppendIntentId(fields.commandId),
        batch: {
            groups: [
                {
                    owner_id: scopeId,
                    records: [
                        {
                            body: body as unknown as RecordBody,
                            mode: CAPTURE_MODE,
                            schema_ref: scopeProtocolConfig.traceSchemas.registration,
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    });
    const registrationRecordId = receipt.record_ids[0] as RecordId;
    return Object.freeze({
        authority,
        command_id: fields.commandId,
        head: headAddress(receipt, scopeId, 0, registrationRecordId),
        kind: ROOT_KIND,
        registration_record_id: registrationRecordId,
        scope_id: scopeId,
    });
}

/**
 * Durably registers one isolated child scope under explicit parent writer authority.
 *
 * One transaction appends a parent-owned child-registration control record caused by the exact
 * expected parent head, the child registration record, and a deterministic immutable origin cut
 * through that parent head published on the child path. Child effective authority is the
 * per-resource intersection of the parent's effective authority, the requested grant, and the
 * whole-run ceiling. The parent's managed content and earlier records are unchanged; only its
 * head advances by the control record. Exact replay returns the original receipt even after the
 * parent fence is later released; changed content conflicts.
 *
 * @param store - Open writable trace store holding the parent registration.
 * @param options - Authenticated parent writer, exact parent head, requested grant, and command.
 * @returns Frozen durable child registration receipt.
 * @throws {ScopeAuthorityError} If the grant exceeds the parent or ceiling or cites unknown atoms.
 * @throws {ScopeWriterFencedError} If the parent fence is released, expired, or superseded.
 * @throws {ScopeHeadConflictError} If the expected parent head is not current.
 * @throws {ScopeEvidenceError} If parent or execution evidence is absent or the child exists.
 * @throws {AppendIntentConflictError} If the command identity already names different content.
 * @throws {TraceStoreError} If the store is closed.
 * @throws {TypeError} If the parent handle is forged or options are malformed.
 *
 * @public
 */
export function registerChildScope(
    store: SQLiteTraceStore,
    options: RegisterChildScopeOptions,
): ScopeChildRegistrationReceipt {
    const fields = readScopeDataObject(
        options,
        ["commandId", "expectedHeadRecordId", "grant", "parent"],
        "registerChildScope options",
        ["executionId", "nowMilliseconds"],
    );
    const child = prepareChildScopeRegistration(store, fields, TRACE_ONLY_CAPABILITY);
    const { cut, receipt } = store.registerChildScope({ ...child.registration, prepared: null });
    return childRegistrationReceipt(child, cut.created_by_record_id, receipt);
}

/** Validated inputs and canonical requests for one child registration. @internal */
export type PreparedChildScopeRegistration = {
    /** Attenuated ceiling and effective authority. */
    readonly authority: ScopeAuthority;
    /** Globally idempotent command identity. */
    readonly commandId: string;
    /** Exact parent origin evidence. */
    readonly origin: ScopeParentOrigin;
    /** Store admission request without an optional prepared journal. */
    readonly registration: Omit<ChildScopeRegistrationRequest, "prepared">;
    /** Child scope identity. */
    readonly scopeId: string;
};

/**
 * Validates child registration options and builds the canonical parent-control and child
 * registration request for the declared world capability.
 *
 * @internal
 */
export function prepareChildScopeRegistration(
    store: SQLiteTraceStore,
    fields: Record<string, unknown>,
    worldCapability: ScopeWorldCapability,
): PreparedChildScopeRegistration {
    assertScopeText(fields.commandId, "commandId");
    assertRecordId(fields.expectedHeadRecordId, "expectedHeadRecordId");
    assertScopeWriter(fields.parent, store);
    const commandId = fields.commandId;
    const expectedHeadRecordId = fields.expectedHeadRecordId;
    const parent = fields.parent;
    const executionId = readExecutionId(fields.executionId);
    const nowMilliseconds = readNowMilliseconds(fields.nowMilliseconds, "nowMilliseconds");
    const grant = readScopeResourceGrants(fields.grant, "grant");
    const parentScopeId = parent.scope_id;
    const parentRow = store.readScopeRegistration(parentScopeId);
    if (parentRow === undefined) {
        throw new ScopeEvidenceError(
            `scope ${parentScopeId} is not registered for mutation in this store`,
        );
    }
    const parentRecord = store.readRecord(parentRow.registration_record_id);
    if (
        parentRecord === undefined ||
        parentRecord.envelope.schema_ref !== scopeProtocolConfig.traceSchemas.registration
    ) {
        throw new ScopeEvidenceError(`scope ${parentScopeId} registration record is unavailable`);
    }
    const parentRegistration = readScopeRegistrationRecord(parentRecord.body);
    if (parentRegistration.scope_id !== parentScopeId) {
        throw new ScopeEvidenceError(`scope ${parentScopeId} registration names another scope`);
    }
    const authority = attenuateScopeAuthority(
        parentRegistration.authority.ceiling,
        parentRegistration.authority.effective,
        grant,
    );
    const scopeId = createScopeId(commandId, parentScopeId);
    const originCutId = createScopeOriginCutId(commandId);
    const childRegisteredBody = createScopeChildRegisteredBody({
        childScopeId: scopeId,
        commandId,
        originCutId,
        originRecordId: expectedHeadRecordId,
        parentScopeId,
    });
    const childRegisteredRecordId = createRecordEnvelope({
        body: childRegisteredBody as unknown as RecordBody,
        caused_by_record_ids: [expectedHeadRecordId],
        mode: CAPTURE_MODE,
        schema_ref: scopeProtocolConfig.traceSchemas.childRegistered,
        witness_ref: ROOT_WITNESS_ID,
    }).record_id;
    const origin = Object.freeze({
        child_registered_record_id: childRegisteredRecordId,
        origin_cut_id: originCutId,
        origin_record_id: expectedHeadRecordId,
        scope_id: parentScopeId,
    });
    const registrationBody = createScopeRegistrationBody({
        authority,
        commandId,
        executionId,
        parent: origin,
        scopeId,
        worldCapability,
    });
    return Object.freeze({
        authority,
        commandId,
        origin,
        registration: Object.freeze({
            executionId,
            nowMilliseconds,
            originCutId,
            parentExpectedHeadRecordId: expectedHeadRecordId,
            parentFence: { claimId: parent.claim_id, fencingToken: parent.fencing_token },
            parentScopeId,
            request: {
                append_intent_id: createScopeCommandAppendIntentId(commandId),
                batch: {
                    groups: [
                        {
                            caused_by_record_ids: [expectedHeadRecordId],
                            owner_id: parentScopeId,
                            records: [
                                {
                                    append_local_id: CHILD_REGISTERED_LOCAL_ID,
                                    body: childRegisteredBody as unknown as RecordBody,
                                    mode: CAPTURE_MODE,
                                    schema_ref: scopeProtocolConfig.traceSchemas.childRegistered,
                                    witness_ref: ROOT_WITNESS_ID,
                                },
                            ],
                        },
                        {
                            owner_id: scopeId,
                            records: [
                                {
                                    body: registrationBody as unknown as RecordBody,
                                    caused_by_local_refs: [CHILD_REGISTERED_LOCAL_ID],
                                    mode: CAPTURE_MODE,
                                    schema_ref: scopeProtocolConfig.traceSchemas.registration,
                                    witness_ref: ROOT_WITNESS_ID,
                                },
                            ],
                        },
                    ],
                },
            },
            scopeId,
        }),
        scopeId,
    });
}

function childRegistrationReceipt(
    child: PreparedChildScopeRegistration,
    originCutRecordId: RecordId,
    receipt: AppendReceipt,
): ScopeChildRegistrationReceipt {
    const registrationRecordId = receipt.record_ids[1] as RecordId;
    const registrationHead = headAddress(receipt, child.scopeId, 0, registrationRecordId);
    return Object.freeze({
        authority: child.authority,
        command_id: child.commandId,
        head: Object.freeze({
            owner_ordinal: registrationHead.owner_ordinal + 1,
            record_id: originCutRecordId,
        }),
        kind: CHILD_KIND,
        origin: child.origin,
        parent_head: headAddress(
            receipt,
            child.registration.parentScopeId,
            0,
            receipt.record_ids[0] as RecordId,
        ),
        registration_record_id: registrationRecordId,
        scope_id: child.scopeId,
    });
}

function readExecutionId(value: unknown): string | null {
    if (value === undefined) {
        return null;
    }
    assertScopeText(value, "executionId");
    return value;
}

function headAddress(
    receipt: AppendReceipt,
    ownerId: string,
    offset: number,
    recordId: RecordId,
): ScopeHeadAddress {
    const range = receipt.owner_ordinal_ranges.get(ownerId);
    // Every scope append allocates exactly one occurrence per owner group.
    /* node:coverage ignore next 3 */
    if (range === undefined) {
        throw new ScopeEvidenceError(`append receipt lacks owner ${ownerId}`);
    }
    return Object.freeze({ owner_ordinal: range[0] + offset, record_id: recordId });
}
