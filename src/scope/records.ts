import { canonicalizeRecord, createRecordId } from "../canonical/canonical-record.ts";
import { createCanonicalSnapshot } from "../canonical/snapshot.ts";
import { recordIdConfig, scopeProtocolConfig } from "../protocol/config.ts";
import { SCOPE_KINDS, SCOPE_WORLD_CAPABILITIES } from "../protocol/values.generated.ts";
import { assertRecordId } from "../record/guards.ts";
import type { RecordBody, RecordId } from "../record/types.ts";
import { readScopeResourceGrants } from "./authority.ts";
import { ScopeEvidenceError } from "./errors.ts";
import type {
    ScopeAuthority,
    ScopeChildRegisteredRecord,
    ScopeEmissionRecord,
    ScopeKind,
    ScopeParentOrigin,
    ScopeRegistrationRecord,
    ScopeWorldCapability,
} from "./types.ts";
import {
    assertScopeId,
    assertScopeOriginCutId,
    assertScopeText,
    readScopeArray,
    readScopeDataObject,
} from "./validation.ts";

const [ROOT_KIND, CHILD_KIND] = SCOPE_KINDS;
const [TRACE_ONLY_CAPABILITY] = SCOPE_WORLD_CAPABILITIES;

/** Derives the global append-intent identity that names one scope command. @internal */
export function createScopeCommandAppendIntentId(commandId: string): string {
    return createRecordId({ scope_command_id: commandId });
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
        world_capability: TRACE_ONLY_CAPABILITY,
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
