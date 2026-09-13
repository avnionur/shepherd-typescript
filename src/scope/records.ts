import { canonicalizeRecord, createRecordId } from "../canonical/canonical-record.ts";
import { createCanonicalSnapshot } from "../canonical/snapshot.ts";
import {
    recordIdConfig,
    scopeProtocolConfig,
    workspaceProtocolConfig,
} from "../protocol/config.ts";
import {
    SCOPE_CHECKPOINT_CONSTITUENT_KINDS,
    SCOPE_CHECKPOINT_EVIDENCE_STATUSES,
    SCOPE_FORK_PHASES,
    SCOPE_KINDS,
    SCOPE_RESOURCE_KINDS,
    SCOPE_WORLD_CAPABILITIES,
} from "../protocol/values.generated.ts";
import { assertRecordId } from "../record/guards.ts";
import type { RecordBody, RecordId } from "../record/types.ts";
import { readScopeResourceGrants } from "./authority.ts";
import { ScopeEvidenceError } from "./errors.ts";
import type {
    ScopeAuthority,
    ScopeCheckpoint,
    ScopeCheckpointConstituent,
    ScopeChildRegisteredRecord,
    ScopeEmissionRecord,
    ScopeForkCompletedRecord,
    ScopeForkPhase,
    ScopeForkPreparedRecord,
    ScopeKind,
    ScopeParentOrigin,
    ScopeRegistrationRecord,
    ScopeResourceKind,
    ScopeWorldCapability,
} from "./types.ts";
import {
    assertPrefixedDigest,
    assertScopeId,
    assertScopeOriginCutId,
    assertScopeText,
    readScopeArray,
    readScopeDataObject,
} from "./validation.ts";

const [ROOT_KIND, CHILD_KIND] = SCOPE_KINDS;
const [TRACE_ONLY_CAPABILITY, REFERENCE_COPY_CAPABILITY] = SCOPE_WORLD_CAPABILITIES;
const [PREPARED_PHASE, COMPLETED_PHASE] = SCOPE_FORK_PHASES;
const [VERIFIED_STATUS, , , UNAVAILABLE_STATUS] = SCOPE_CHECKPOINT_EVIDENCE_STATUSES;

/** Derives the global append-intent identity that names one scope command. @internal */
export function createScopeCommandAppendIntentId(commandId: string): string {
    return createRecordId({ scope_command_id: commandId });
}

/** Derives the append-intent identity naming one phase of one fork command. @internal */
export function createScopeForkAppendIntentId(commandId: string, phase: ScopeForkPhase): string {
    return createRecordId({ scope_fork: { command_id: commandId, phase } });
}

/** Derives the deterministic carrier custody identity published by one scope fork. @internal */
export function createScopeForkCustodyId(commandId: string, scopeId: string): string {
    return `${workspaceProtocolConfig.carrier.custodyIdPrefix}${digestHex(
        createRecordId({
            [scopeProtocolConfig.identity.custodyIdentityKind]: {
                command_id: commandId,
                scope_id: scopeId,
            },
        }),
    )}`;
}

/** Derives the deterministic content-addressed identity of one registered scope. @internal */
export function createScopeId(commandId: string, parentScopeId: string | null): string {
    return `${scopeProtocolConfig.identity.scopeIdPrefix}${digestHex(
        createRecordId({
            scope_registration: { command_id: commandId, parent_scope_id: parentScopeId },
        }),
    )}`;
}

/** Derives the deterministic origin-cut identity for one child registration command. @internal */
export function createScopeOriginCutId(commandId: string): string {
    return `${scopeProtocolConfig.identity.originCutIdPrefix}${digestHex(
        createRecordId({ scope_origin_cut: { command_id: commandId } }),
    )}`;
}

/** Builds one canonical scope registration body. @internal */
export function createScopeRegistrationBody(fields: {
    readonly authority: ScopeAuthority;
    readonly commandId: string;
    readonly executionId: string | null;
    readonly parent: ScopeParentOrigin | null;
    readonly scopeId: string;
    readonly worldCapability?: ScopeWorldCapability;
}): ScopeRegistrationRecord {
    return createCanonicalSnapshot({
        authority: fields.authority,
        command_id: fields.commandId,
        compatibility_version: scopeProtocolConfig.compatibilityVersion,
        execution_id: fields.executionId,
        kind: fields.parent === null ? ROOT_KIND : CHILD_KIND,
        parent: fields.parent,
        scope_id: fields.scopeId,
        scope_version: scopeProtocolConfig.recordVersion,
        world_capability: fields.worldCapability ?? TRACE_ONLY_CAPABILITY,
    }) as unknown as ScopeRegistrationRecord;
}

/** Builds one canonical parent-owned child-registration body. @internal */
export function createScopeChildRegisteredBody(fields: {
    readonly childScopeId: string;
    readonly commandId: string;
    readonly originCutId: string;
    readonly originRecordId: RecordId;
    readonly parentScopeId: string;
}): ScopeChildRegisteredRecord {
    return createCanonicalSnapshot({
        child_scope_id: fields.childScopeId,
        command_id: fields.commandId,
        compatibility_version: scopeProtocolConfig.compatibilityVersion,
        origin_cut_id: fields.originCutId,
        origin_record_id: fields.originRecordId,
        parent_scope_id: fields.parentScopeId,
        scope_version: scopeProtocolConfig.recordVersion,
    }) as unknown as ScopeChildRegisteredRecord;
}

/** Builds one canonical scope-local emission body. @internal */
export function createScopeEmissionBody(fields: {
    readonly citedRecordIds: readonly RecordId[];
    readonly commandId: string;
    readonly data: RecordBody;
    readonly expectedHeadRecordId: RecordId;
    readonly scopeId: string;
}): ScopeEmissionRecord {
    return createCanonicalSnapshot({
        cited_record_ids: fields.citedRecordIds,
        command_id: fields.commandId,
        compatibility_version: scopeProtocolConfig.compatibilityVersion,
        data: fields.data,
        expected_head_record_id: fields.expectedHeadRecordId,
        scope_id: fields.scopeId,
        scope_version: scopeProtocolConfig.recordVersion,
    }) as unknown as ScopeEmissionRecord;
}

/** Decodes and validates one retained scope registration body. @internal */
export function readScopeRegistrationRecord(body: RecordBody): ScopeRegistrationRecord {
    return decodeEvidence("scope registration", () => {
        const fields = readScopeDataObject(
            body,
            [
                "authority",
                "command_id",
                "compatibility_version",
                "execution_id",
                "kind",
                "parent",
                "scope_id",
                "scope_version",
                "world_capability",
            ],
            "scope registration",
        );
        assertScopeText(fields.command_id, "scope registration command_id");
        assertScopeId(fields.scope_id, "scope registration scope_id");
        assertCompatibility(fields.compatibility_version, fields.scope_version);
        if (fields.execution_id !== null) {
            assertScopeText(fields.execution_id, "scope registration execution_id");
        }
        if (!SCOPE_KINDS.includes(fields.kind as ScopeKind)) {
            throw new TypeError("scope registration kind is unsupported");
        }
        if (!SCOPE_WORLD_CAPABILITIES.includes(fields.world_capability as ScopeWorldCapability)) {
            throw new TypeError("scope registration world_capability is unsupported");
        }
        const authorityFields = readScopeDataObject(
            fields.authority,
            ["ceiling", "effective"],
            "scope registration authority",
        );
        const authority: ScopeAuthority = Object.freeze({
            ceiling: readScopeResourceGrants(authorityFields.ceiling, "scope registration ceiling"),
            effective: readScopeResourceGrants(
                authorityFields.effective,
                "scope registration effective authority",
            ),
        });
        const parent = fields.parent === null ? null : readParentOrigin(fields.parent);
        if ((parent === null) !== (fields.kind === ROOT_KIND)) {
            throw new TypeError("scope registration kind disagrees with its parent evidence");
        }
        if (fields.world_capability === REFERENCE_COPY_CAPABILITY && parent === null) {
            throw new TypeError("a reference-copy world requires a forked child scope");
        }
        return Object.freeze({
            authority,
            command_id: fields.command_id,
            compatibility_version: fields.compatibility_version as string,
            execution_id: fields.execution_id as string | null,
            kind: fields.kind as ScopeKind,
            parent,
            scope_id: fields.scope_id,
            scope_version: fields.scope_version as number,
            world_capability: fields.world_capability as ScopeWorldCapability,
        });
    });
}

/** Decodes and validates one retained parent-owned child-registration body. @internal */
export function readScopeChildRegisteredRecord(body: RecordBody): ScopeChildRegisteredRecord {
    return decodeEvidence("scope child registration", () => {
        const fields = readScopeDataObject(
            body,
            [
                "child_scope_id",
                "command_id",
                "compatibility_version",
                "origin_cut_id",
                "origin_record_id",
                "parent_scope_id",
                "scope_version",
            ],
            "scope child registration",
        );
        assertScopeId(fields.child_scope_id, "scope child registration child_scope_id");
        assertScopeText(fields.command_id, "scope child registration command_id");
        assertCompatibility(fields.compatibility_version, fields.scope_version);
        assertScopeOriginCutId(fields.origin_cut_id, "scope child registration origin_cut_id");
        assertRecordId(fields.origin_record_id, "scope child registration origin_record_id");
        assertScopeId(fields.parent_scope_id, "scope child registration parent_scope_id");
        return Object.freeze({
            child_scope_id: fields.child_scope_id,
            command_id: fields.command_id,
            compatibility_version: fields.compatibility_version as string,
            origin_cut_id: fields.origin_cut_id,
            origin_record_id: fields.origin_record_id,
            parent_scope_id: fields.parent_scope_id,
            scope_version: fields.scope_version as number,
        });
    });
}

/** Decodes and validates one retained scope-local emission body. @internal */
export function readScopeEmissionRecord(body: RecordBody): ScopeEmissionRecord {
    return decodeEvidence("scope emission", () => {
        const fields = readScopeDataObject(
            body,
            [
                "cited_record_ids",
                "command_id",
                "compatibility_version",
                "data",
                "expected_head_record_id",
                "scope_id",
                "scope_version",
            ],
            "scope emission",
        );
        assertScopeText(fields.command_id, "scope emission command_id");
        assertCompatibility(fields.compatibility_version, fields.scope_version);
        assertRecordId(fields.expected_head_record_id, "scope emission expected_head_record_id");
        assertScopeId(fields.scope_id, "scope emission scope_id");
        const citedRecordIds = readCitedRecordIds(fields.cited_record_ids, "scope emission");
        if (citedRecordIds.includes(fields.expected_head_record_id)) {
            throw new TypeError("scope emission must not cite its expected head");
        }
        const data = readScopeData(fields.data, "scope emission data");
        return Object.freeze({
            cited_record_ids: citedRecordIds,
            command_id: fields.command_id,
            compatibility_version: fields.compatibility_version as string,
            data,
            expected_head_record_id: fields.expected_head_record_id,
            scope_id: fields.scope_id,
            scope_version: fields.scope_version as number,
        });
    });
}

/** Builds one canonical prepared fork journal body. @internal */
export function createScopeForkPreparedBody(fields: {
    readonly baseContentId: string;
    readonly baseRevisionId: string;
    readonly bindingId: string;
    readonly commandId: string;
    readonly custodyId: string;
    readonly resourceId: string;
    readonly resourceKind: ScopeResourceKind;
    readonly scopeId: string;
}): ScopeForkPreparedRecord {
    return createCanonicalSnapshot({
        base_content_id: fields.baseContentId,
        base_revision_id: fields.baseRevisionId,
        binding_id: fields.bindingId,
        capture_kind: workspaceProtocolConfig.carrier.captureKind,
        command_id: fields.commandId,
        compatibility_version: scopeProtocolConfig.compatibilityVersion,
        custody_id: fields.custodyId,
        phase: PREPARED_PHASE,
        resource_id: fields.resourceId,
        resource_kind: fields.resourceKind,
        scope_id: fields.scopeId,
        scope_version: scopeProtocolConfig.recordVersion,
        world_capability: REFERENCE_COPY_CAPABILITY,
    }) as unknown as ScopeForkPreparedRecord;
}

/** Builds one canonical completed fork journal body. @internal */
export function createScopeForkCompletedBody(fields: {
    readonly checkpoint: ScopeCheckpoint;
    readonly commandId: string;
    readonly custodyContentId: string;
    readonly custodyId: string;
    readonly scopeId: string;
}): ScopeForkCompletedRecord {
    return createCanonicalSnapshot({
        checkpoint: fields.checkpoint,
        command_id: fields.commandId,
        compatibility_version: scopeProtocolConfig.compatibilityVersion,
        custody_content_id: fields.custodyContentId,
        custody_id: fields.custodyId,
        phase: COMPLETED_PHASE,
        scope_id: fields.scopeId,
        scope_version: scopeProtocolConfig.recordVersion,
    }) as unknown as ScopeForkCompletedRecord;
}

/** Decodes and validates one retained fork journal body of either phase. @internal */
export function readScopeForkRecord(
    body: RecordBody,
): ScopeForkCompletedRecord | ScopeForkPreparedRecord {
    return decodeEvidence("scope fork", () => {
        const phase = (body as Record<string, unknown>).phase;
        if (phase === PREPARED_PHASE) {
            return readForkPrepared(body);
        }
        if (phase === COMPLETED_PHASE) {
            return readForkCompleted(body);
        }
        throw new TypeError("scope fork phase is unsupported");
    });
}

/** Validates one closed checkpoint descriptor in configured constituent order. @internal */
export function readScopeCheckpoint(value: unknown): ScopeCheckpoint {
    const fields = readScopeDataObject(
        value,
        ["capture_kind", "checkpoint_version", "constituents"],
        "scope checkpoint",
    );
    if (
        fields.capture_kind !== workspaceProtocolConfig.carrier.captureKind ||
        fields.checkpoint_version !== scopeProtocolConfig.checkpoint.version
    ) {
        throw new TypeError("scope checkpoint capture kind or version is unsupported");
    }
    const constituents = readScopeArray(fields.constituents, "scope checkpoint constituents");
    if (constituents.length !== SCOPE_CHECKPOINT_CONSTITUENT_KINDS.length) {
        throw new TypeError("scope checkpoint must classify every configured constituent");
    }
    return Object.freeze({
        capture_kind: fields.capture_kind,
        checkpoint_version: fields.checkpoint_version,
        constituents: Object.freeze(
            constituents.map((constituent, index) => readConstituent(constituent, index)),
        ),
    });
}

/** Validates unique configured record identities within the configured citation bound. @internal */
export function readCitedRecordIds(value: unknown, subject: string): readonly RecordId[] {
    const citedRecordIds = readScopeArray(value, `${subject} cited_record_ids`).map(
        (recordId, index) => {
            assertRecordId(recordId, `${subject} cited_record_ids[${index}]`);
            return recordId;
        },
    );
    if (
        citedRecordIds.length > scopeProtocolConfig.limits.maxCitedRecords ||
        new Set(citedRecordIds).size !== citedRecordIds.length
    ) {
        throw new TypeError(`${subject} cited_record_ids must be unique and within the bound`);
    }
    return Object.freeze(citedRecordIds);
}

/** Validates one bounded canonical application-data object. @internal */
export function readScopeData(value: unknown, subject: string): RecordBody {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError(`${subject} must be a canonical semantic record`);
    }
    let snapshot: RecordBody;
    try {
        snapshot = createCanonicalSnapshot(value as RecordBody);
    } catch (error) {
        throw new TypeError(`${subject} must be a canonical semantic record`, { cause: error });
    }
    if (
        Buffer.byteLength(canonicalizeRecord(snapshot)) >
        scopeProtocolConfig.limits.maxDataCanonicalBytes
    ) {
        throw new TypeError(`${subject} exceeds the configured canonical byte bound`);
    }
    return snapshot;
}

function readForkPrepared(body: RecordBody): ScopeForkPreparedRecord {
    const fields = readScopeDataObject(
        body,
        [
            "base_content_id",
            "base_revision_id",
            "binding_id",
            "capture_kind",
            "command_id",
            "compatibility_version",
            "custody_id",
            "phase",
            "resource_id",
            "resource_kind",
            "scope_id",
            "scope_version",
            "world_capability",
        ],
        "scope fork prepared",
    );
    assertCompatibility(fields.compatibility_version, fields.scope_version);
    assertScopeText(fields.command_id, "scope fork command_id");
    assertScopeId(fields.scope_id, "scope fork scope_id");
    assertCustodyId(fields.custody_id);
    assertPrefixedDigest(
        fields.base_content_id,
        workspaceProtocolConfig.carrier.worldContentIdPrefix,
        "scope fork base_content_id",
    );
    assertPrefixedDigest(
        fields.base_revision_id,
        workspaceProtocolConfig.carrier.revisionIdPrefix,
        "scope fork base_revision_id",
    );
    assertRecordId(fields.binding_id, "scope fork binding_id");
    assertRecordId(fields.resource_id, "scope fork resource_id");
    if (
        fields.capture_kind !== workspaceProtocolConfig.carrier.captureKind ||
        fields.world_capability !== REFERENCE_COPY_CAPABILITY ||
        !SCOPE_RESOURCE_KINDS.includes(fields.resource_kind as ScopeResourceKind)
    ) {
        throw new TypeError("scope fork capture, capability, or resource kind is unsupported");
    }
    return Object.freeze({
        base_content_id: fields.base_content_id as string,
        base_revision_id: fields.base_revision_id as string,
        binding_id: fields.binding_id,
        capture_kind: fields.capture_kind,
        command_id: fields.command_id,
        compatibility_version: fields.compatibility_version as string,
        custody_id: fields.custody_id as string,
        phase: PREPARED_PHASE,
        resource_id: fields.resource_id,
        resource_kind: fields.resource_kind as ScopeResourceKind,
        scope_id: fields.scope_id,
        scope_version: fields.scope_version as number,
        world_capability: REFERENCE_COPY_CAPABILITY,
    });
}

function readForkCompleted(body: RecordBody): ScopeForkCompletedRecord {
    const fields = readScopeDataObject(
        body,
        [
            "checkpoint",
            "command_id",
            "compatibility_version",
            "custody_content_id",
            "custody_id",
            "phase",
            "scope_id",
            "scope_version",
        ],
        "scope fork completed",
    );
    assertCompatibility(fields.compatibility_version, fields.scope_version);
    assertScopeText(fields.command_id, "scope fork command_id");
    assertScopeId(fields.scope_id, "scope fork scope_id");
    assertCustodyId(fields.custody_id);
    assertPrefixedDigest(
        fields.custody_content_id,
        workspaceProtocolConfig.carrier.worldContentIdPrefix,
        "scope fork custody_content_id",
    );
    return Object.freeze({
        checkpoint: readScopeCheckpoint(fields.checkpoint),
        command_id: fields.command_id,
        compatibility_version: fields.compatibility_version as string,
        custody_content_id: fields.custody_content_id as string,
        custody_id: fields.custody_id as string,
        phase: COMPLETED_PHASE,
        scope_id: fields.scope_id,
        scope_version: fields.scope_version as number,
    });
}

function readConstituent(value: unknown, index: number): ScopeCheckpointConstituent {
    const subject = `scope checkpoint constituent ${index}`;
    const status =
        value !== null && typeof value === "object" && !Array.isArray(value)
            ? (value as Record<string, unknown>).status
            : undefined;
    const kind = SCOPE_CHECKPOINT_CONSTITUENT_KINDS[index];
    if (status === VERIFIED_STATUS) {
        const fields = readScopeDataObject(value, ["kind", "receipt_id", "status"], subject);
        assertScopeText(fields.receipt_id, `${subject} receipt_id`);
        assertConstituentKind(fields.kind, kind, subject);
        return Object.freeze({ kind, receipt_id: fields.receipt_id, status: VERIFIED_STATUS });
    }
    if (status === UNAVAILABLE_STATUS) {
        const fields = readScopeDataObject(value, ["kind", "reason", "status"], subject);
        assertScopeText(fields.reason, `${subject} reason`);
        assertConstituentKind(fields.kind, kind, subject);
        return Object.freeze({ kind, reason: fields.reason, status: UNAVAILABLE_STATUS });
    }
    if (!SCOPE_CHECKPOINT_EVIDENCE_STATUSES.includes(status as never)) {
        throw new TypeError(`${subject} status is unsupported`);
    }
    const fields = readScopeDataObject(value, ["kind", "status"], subject);
    assertConstituentKind(fields.kind, kind, subject);
    return Object.freeze({
        kind,
        status: status as (typeof SCOPE_CHECKPOINT_EVIDENCE_STATUSES)[1],
    });
}

function assertConstituentKind(
    actual: unknown,
    expected: string | undefined,
    subject: string,
): asserts expected is ScopeCheckpointConstituent["kind"] {
    if (expected === undefined || actual !== expected) {
        throw new TypeError(`${subject} kind is not the configured constituent in order`);
    }
}

function assertCustodyId(value: unknown): asserts value is string {
    assertPrefixedDigest(
        value,
        workspaceProtocolConfig.carrier.custodyIdPrefix,
        "scope fork custody_id",
    );
}

function readParentOrigin(value: unknown): ScopeParentOrigin {
    const fields = readScopeDataObject(
        value,
        ["child_registered_record_id", "origin_cut_id", "origin_record_id", "scope_id"],
        "scope registration parent",
    );
    assertRecordId(
        fields.child_registered_record_id,
        "scope registration parent child_registered_record_id",
    );
    assertScopeOriginCutId(fields.origin_cut_id, "scope registration parent origin_cut_id");
    assertRecordId(fields.origin_record_id, "scope registration parent origin_record_id");
    assertScopeId(fields.scope_id, "scope registration parent scope_id");
    return Object.freeze({
        child_registered_record_id: fields.child_registered_record_id,
        origin_cut_id: fields.origin_cut_id,
        origin_record_id: fields.origin_record_id,
        scope_id: fields.scope_id,
    });
}

function assertCompatibility(compatibilityVersion: unknown, scopeVersion: unknown): void {
    if (
        compatibilityVersion !== scopeProtocolConfig.compatibilityVersion ||
        scopeVersion !== scopeProtocolConfig.recordVersion
    ) {
        throw new TypeError("scope evidence compatibility or record version is unsupported");
    }
}

function decodeEvidence<T>(subject: string, decode: () => T): T {
    try {
        return decode();
    } catch (error) {
        if (error instanceof ScopeEvidenceError) {
            throw error;
        }
        throw new ScopeEvidenceError(`${subject} evidence is malformed`, { cause: error });
    }
}

function digestHex(recordId: string): string {
    return recordId.slice(recordIdConfig.prefix.length);
}
