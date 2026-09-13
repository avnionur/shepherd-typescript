import { createRecordId } from "../canonical/canonical-record.ts";
import { createCanonicalSnapshot } from "../canonical/snapshot.ts";
import { scopeProtocolConfig, workspaceProtocolConfig } from "../protocol/config.ts";
import { SCOPE_DISCARD_PHASES, SCOPE_MERGE_PHASES } from "../protocol/values.generated.ts";
import { assertRecordId } from "../record/guards.ts";
import type { RecordBody, RecordId } from "../record/types.ts";
import { assertCompatibility, assertCustodyId, decodeEvidence, digestHex } from "./records.ts";
import type {
    ScopeChildMergedRecord,
    ScopeContribution,
    ScopeDiscardCleanedRecord,
    ScopeDiscardDecidedRecord,
    ScopeDiscardPhase,
    ScopeMergeCompletedRecord,
    ScopeMergePhase,
    ScopeMergePreparedRecord,
    ScopeMergeWorldPlan,
} from "./types.ts";
import {
    assertPrefixedDigest,
    assertScopeId,
    assertScopeText,
    readScopeArray,
    readScopeDataObject,
} from "./validation.ts";

const [PREPARED_PHASE, COMPLETED_PHASE] = SCOPE_MERGE_PHASES;
const [DECIDED_PHASE, CLEANED_PHASE] = SCOPE_DISCARD_PHASES;

/** Derives the append-intent identity naming one non-initial phase of one merge command. @internal */
export function createScopeMergeAppendIntentId(commandId: string, phase: ScopeMergePhase): string {
    return createRecordId({ scope_merge: { command_id: commandId, phase } });
}

/** Derives the append-intent identity naming one non-initial phase of one discard command. @internal */
export function createScopeDiscardAppendIntentId(
    commandId: string,
    phase: ScopeDiscardPhase,
): string {
    return createRecordId({ scope_discard: { command_id: commandId, phase } });
}

/** Derives the deterministic protected application custody identity of one merge. @internal */
export function createScopeMergeApplicationCustodyId(commandId: string, scopeId: string): string {
    return `${workspaceProtocolConfig.carrier.custodyIdPrefix}${digestHex(
        createRecordId({
            [scopeProtocolConfig.identity.mergeCustodyIdentityKind]: {
                command_id: commandId,
                scope_id: scopeId,
            },
        }),
    )}`;
}

/** Derives the deterministic fixed child-cut identity of one merge command. @internal */
export function createScopeMergeCutId(commandId: string): string {
    return `${scopeProtocolConfig.identity.mergeCutIdPrefix}${digestHex(
        createRecordId({ scope_merge_cut: { command_id: commandId } }),
    )}`;
}

/** Builds one canonical child-side merge reservation body. @internal */
export function createScopeMergePreparedBody(fields: {
    readonly childHeadRecordId: RecordId;
    readonly commandId: string;
    readonly contributions: readonly ScopeContribution[];
    readonly mergeCutId: string;
    readonly parentHeadRecordId: RecordId;
    readonly parentScopeId: string;
    readonly scopeId: string;
    readonly world: ScopeMergeWorldPlan | null;
}): ScopeMergePreparedRecord {
    return createCanonicalSnapshot({
        child_head_record_id: fields.childHeadRecordId,
        command_id: fields.commandId,
        compatibility_version: scopeProtocolConfig.compatibilityVersion,
        contributions: fields.contributions,
        merge_cut_id: fields.mergeCutId,
        parent_head_record_id: fields.parentHeadRecordId,
        parent_scope_id: fields.parentScopeId,
        phase: PREPARED_PHASE,
        scope_id: fields.scopeId,
        scope_version: scopeProtocolConfig.recordVersion,
        world: fields.world,
    } as unknown as RecordBody) as unknown as ScopeMergePreparedRecord;
}

/** Builds one canonical child-side merge seal body. @internal */
export function createScopeMergeCompletedBody(fields: {
    readonly commandId: string;
    readonly parentScopeId: string;
    readonly publicationRevisionId: string | null;
    readonly scopeId: string;
}): ScopeMergeCompletedRecord {
    return createCanonicalSnapshot({
        command_id: fields.commandId,
        compatibility_version: scopeProtocolConfig.compatibilityVersion,
        parent_scope_id: fields.parentScopeId,
        phase: COMPLETED_PHASE,
        publication_revision_id: fields.publicationRevisionId,
        scope_id: fields.scopeId,
        scope_version: scopeProtocolConfig.recordVersion,
    }) as unknown as ScopeMergeCompletedRecord;
}

/** Builds one canonical parent-side child integration body. @internal */
export function createScopeChildMergedBody(fields: {
    readonly childCheckpointRecordId: RecordId | null;
    readonly childCutId: string;
    readonly childScopeId: string;
    readonly commandId: string;
    readonly contributions: readonly ScopeContribution[];
    readonly mergedContentId: string | null;
    readonly parentScopeId: string;
    readonly publicationRevisionId: string | null;
}): ScopeChildMergedRecord {
    return createCanonicalSnapshot({
        child_checkpoint_record_id: fields.childCheckpointRecordId,
        child_cut_id: fields.childCutId,
        child_scope_id: fields.childScopeId,
        command_id: fields.commandId,
        compatibility_version: scopeProtocolConfig.compatibilityVersion,
        contributions: fields.contributions,
        merged_content_id: fields.mergedContentId,
        parent_scope_id: fields.parentScopeId,
        publication_revision_id: fields.publicationRevisionId,
        scope_version: scopeProtocolConfig.recordVersion,
    } as unknown as RecordBody) as unknown as ScopeChildMergedRecord;
}

/** Builds one canonical discard decision body for a sealed scope path. @internal */
export function createScopeDiscardDecidedBody(fields: {
    readonly commandId: string;
    readonly custodyIds: readonly string[];
    readonly discardScopeId: string;
    readonly parentScopeId: string;
    readonly scopeId: string;
    readonly sealedScopeIds: readonly string[];
}): ScopeDiscardDecidedRecord {
    return createCanonicalSnapshot({
        command_id: fields.commandId,
        compatibility_version: scopeProtocolConfig.compatibilityVersion,
        custody_ids: fields.custodyIds,
        discard_scope_id: fields.discardScopeId,
        parent_scope_id: fields.parentScopeId,
        phase: DECIDED_PHASE,
        scope_id: fields.scopeId,
        scope_version: scopeProtocolConfig.recordVersion,
        sealed_scope_ids: fields.sealedScopeIds,
    }) as unknown as ScopeDiscardDecidedRecord;
}

/** Builds one canonical discard cleanup body. @internal */
export function createScopeDiscardCleanedBody(fields: {
    readonly commandId: string;
    readonly custodyIds: readonly string[];
    readonly scopeId: string;
}): ScopeDiscardCleanedRecord {
    return createCanonicalSnapshot({
        command_id: fields.commandId,
        compatibility_version: scopeProtocolConfig.compatibilityVersion,
        custody_ids: fields.custodyIds,
        phase: CLEANED_PHASE,
        scope_id: fields.scopeId,
        scope_version: scopeProtocolConfig.recordVersion,
    }) as unknown as ScopeDiscardCleanedRecord;
}

/** Decodes and validates one retained merge journal body of either phase. @internal */
export function readScopeMergeRecord(
    body: RecordBody,
): ScopeMergeCompletedRecord | ScopeMergePreparedRecord {
    return decodeEvidence("scope merge", () => {
        const phase = (body as Record<string, unknown>).phase;
        if (phase === PREPARED_PHASE) {
            return readMergePrepared(body);
        }
        if (phase === COMPLETED_PHASE) {
            const fields = readScopeDataObject(
                body,
                [
                    "command_id",
                    "compatibility_version",
                    "parent_scope_id",
                    "phase",
                    "publication_revision_id",
                    "scope_id",
                    "scope_version",
                ],
                "scope merge completed",
            );
            assertCommon(fields, "scope merge completed");
            assertScopeId(fields.parent_scope_id, "scope merge parent_scope_id");
            return Object.freeze({
                command_id: fields.command_id as string,
                compatibility_version: fields.compatibility_version as string,
                parent_scope_id: fields.parent_scope_id,
                phase: COMPLETED_PHASE,
                publication_revision_id: readNullableRevisionId(
                    fields.publication_revision_id,
                    "scope merge publication_revision_id",
                ),
                scope_id: fields.scope_id as string,
                scope_version: fields.scope_version as number,
            });
        }
        throw new TypeError("scope merge phase is unsupported");
    });
}

/** Decodes and validates one retained parent-side child integration body. @internal */
export function readScopeChildMergedRecord(body: RecordBody): ScopeChildMergedRecord {
    return decodeEvidence("scope child merged", () => {
        const fields = readScopeDataObject(
            body,
            [
                "child_checkpoint_record_id",
                "child_cut_id",
                "child_scope_id",
                "command_id",
                "compatibility_version",
                "contributions",
                "merged_content_id",
                "parent_scope_id",
                "publication_revision_id",
                "scope_version",
            ],
            "scope child merged",
        );
        assertCompatibility(fields.compatibility_version, fields.scope_version);
        assertScopeText(fields.command_id, "scope child merged command_id");
        assertScopeId(fields.child_scope_id, "scope child merged child_scope_id");
        assertScopeId(fields.parent_scope_id, "scope child merged parent_scope_id");
        assertMergeCutId(fields.child_cut_id);
        if (fields.child_checkpoint_record_id !== null) {
            assertRecordId(
                fields.child_checkpoint_record_id,
                "scope child merged child_checkpoint_record_id",
            );
        }
        const mergedContentId = readNullableContentId(
            fields.merged_content_id,
            "scope child merged merged_content_id",
        );
        const publicationRevisionId = readNullableRevisionId(
            fields.publication_revision_id,
            "scope child merged publication_revision_id",
        );
        if ((mergedContentId === null) !== (publicationRevisionId === null)) {
            throw new TypeError("scope child merged publication evidence is incomplete");
        }
        return Object.freeze({
            child_checkpoint_record_id: fields.child_checkpoint_record_id as RecordId | null,
            child_cut_id: fields.child_cut_id,
            child_scope_id: fields.child_scope_id,
            command_id: fields.command_id,
            compatibility_version: fields.compatibility_version as string,
            contributions: readContributions(fields.contributions),
            merged_content_id: mergedContentId,
            parent_scope_id: fields.parent_scope_id,
            publication_revision_id: publicationRevisionId,
            scope_version: fields.scope_version as number,
        });
    });
}

/** Decodes and validates one retained discard journal body of either phase. @internal */
export function readScopeDiscardRecord(
    body: RecordBody,
): ScopeDiscardCleanedRecord | ScopeDiscardDecidedRecord {
    return decodeEvidence("scope discard", () => {
        const phase = (body as Record<string, unknown>).phase;
        if (phase === DECIDED_PHASE) {
            const fields = readScopeDataObject(
                body,
                [
                    "command_id",
                    "compatibility_version",
                    "custody_ids",
                    "discard_scope_id",
                    "parent_scope_id",
                    "phase",
                    "scope_id",
                    "scope_version",
                    "sealed_scope_ids",
                ],
                "scope discard decided",
            );
            assertCommon(fields, "scope discard decided");
            assertScopeId(fields.discard_scope_id, "scope discard discard_scope_id");
            assertScopeId(fields.parent_scope_id, "scope discard parent_scope_id");
            const custodyIds = readCustodyIds(fields.custody_ids);
            const sealedScopeIds = readUniqueList(
                fields.sealed_scope_ids,
                "scope discard sealed_scope_ids",
                scopeProtocolConfig.limits.maxDiscardScopes,
                (value, subject) => assertScopeId(value, subject),
            );
            const target = fields.discard_scope_id === fields.scope_id;
            if (
                target
                    ? sealedScopeIds[0] !== fields.scope_id
                    : sealedScopeIds.length !== 0 || custodyIds.length !== 0
            ) {
                throw new TypeError("scope discard sealed evidence disagrees with its role");
            }
            return Object.freeze({
                command_id: fields.command_id as string,
                compatibility_version: fields.compatibility_version as string,
                custody_ids: custodyIds,
                discard_scope_id: fields.discard_scope_id,
                parent_scope_id: fields.parent_scope_id,
                phase: DECIDED_PHASE,
                scope_id: fields.scope_id as string,
                scope_version: fields.scope_version as number,
                sealed_scope_ids: sealedScopeIds,
            });
        }
        if (phase === CLEANED_PHASE) {
            const fields = readScopeDataObject(
                body,
                [
                    "command_id",
                    "compatibility_version",
                    "custody_ids",
                    "phase",
                    "scope_id",
                    "scope_version",
                ],
                "scope discard cleaned",
            );
            assertCommon(fields, "scope discard cleaned");
            return Object.freeze({
                command_id: fields.command_id as string,
                compatibility_version: fields.compatibility_version as string,
                custody_ids: readCustodyIds(fields.custody_ids),
                phase: CLEANED_PHASE,
                scope_id: fields.scope_id as string,
                scope_version: fields.scope_version as number,
            });
        }
        throw new TypeError("scope discard phase is unsupported");
    });
}

function readMergePrepared(body: RecordBody): ScopeMergePreparedRecord {
    const fields = readScopeDataObject(
        body,
        [
            "child_head_record_id",
            "command_id",
            "compatibility_version",
            "contributions",
            "merge_cut_id",
            "parent_head_record_id",
            "parent_scope_id",
            "phase",
            "scope_id",
            "scope_version",
            "world",
        ],
        "scope merge prepared",
    );
    assertCommon(fields, "scope merge prepared");
    assertRecordId(fields.child_head_record_id, "scope merge child_head_record_id");
    assertRecordId(fields.parent_head_record_id, "scope merge parent_head_record_id");
    assertScopeId(fields.parent_scope_id, "scope merge parent_scope_id");
    assertMergeCutId(fields.merge_cut_id);
    return Object.freeze({
        child_head_record_id: fields.child_head_record_id,
        command_id: fields.command_id as string,
        compatibility_version: fields.compatibility_version as string,
        contributions: readContributions(fields.contributions),
        merge_cut_id: fields.merge_cut_id,
        parent_head_record_id: fields.parent_head_record_id,
        parent_scope_id: fields.parent_scope_id,
        phase: PREPARED_PHASE,
        scope_id: fields.scope_id as string,
        scope_version: fields.scope_version as number,
        world: fields.world === null ? null : readWorldPlan(fields.world),
    });
}

function readWorldPlan(value: unknown): ScopeMergeWorldPlan {
    const fields = readScopeDataObject(
        value,
        [
            "application_custody_id",
            "binding_id",
            "child_content_id",
            "child_revision_id",
            "origin_content_id",
            "origin_revision_id",
            "parent_content_id",
            "parent_custody_id",
            "parent_revision_id",
        ],
        "scope merge world",
    );
    if (fields.application_custody_id !== null) {
        assertCustodyId(fields.application_custody_id);
    }
    assertRecordId(fields.binding_id, "scope merge world binding_id");
    assertCustodyId(fields.parent_custody_id);
    for (const key of ["child", "origin", "parent"] as const) {
        assertContentId(fields[`${key}_content_id`], `scope merge world ${key}_content_id`);
        assertRevisionId(fields[`${key}_revision_id`], `scope merge world ${key}_revision_id`);
    }
    return Object.freeze({
        application_custody_id: fields.application_custody_id as string | null,
        binding_id: fields.binding_id,
        child_content_id: fields.child_content_id as string,
        child_revision_id: fields.child_revision_id as string,
        origin_content_id: fields.origin_content_id as string,
        origin_revision_id: fields.origin_revision_id as string,
        parent_content_id: fields.parent_content_id as string,
        parent_custody_id: fields.parent_custody_id as string,
        parent_revision_id: fields.parent_revision_id as string,
    });
}

/** Validates ordered unique selected-history contributions within the configured bound. @internal */
export function readContributions(value: unknown): readonly ScopeContribution[] {
    const contributions = readScopeArray(value, "scope contributions").map((entry, index) => {
        const subject = `scope contributions[${index}]`;
        const fields = readScopeDataObject(
            entry,
            ["owner_id", "owner_ordinal", "record_id"],
            subject,
        );
        assertScopeId(fields.owner_id, `${subject} owner_id`);
        if (!Number.isSafeInteger(fields.owner_ordinal) || (fields.owner_ordinal as number) < 0) {
            throw new TypeError(`${subject} owner_ordinal must be a non-negative safe integer`);
        }
        assertRecordId(fields.record_id, `${subject} record_id`);
        return Object.freeze({
            owner_id: fields.owner_id,
            owner_ordinal: fields.owner_ordinal as number,
            record_id: fields.record_id,
        });
    });
    if (
        contributions.length > scopeProtocolConfig.limits.maxContributions ||
        new Set(contributions.map(scopeContributionKey)).size !== contributions.length
    ) {
        throw new TypeError("scope contributions must be unique and within the bound");
    }
    return Object.freeze(contributions);
}

/** Derives the exact occurrence identity of one contribution. @internal */
export function scopeContributionKey(contribution: ScopeContribution): string {
    return `${contribution.owner_id}\0${contribution.owner_ordinal}\0${contribution.record_id}`;
}

function readCustodyIds(value: unknown): readonly string[] {
    return readUniqueList(
        value,
        "scope discard custody_ids",
        scopeProtocolConfig.limits.maxDiscardScopes,
        (candidate) => assertCustodyId(candidate),
    );
}

function readUniqueList(
    value: unknown,
    subject: string,
    maximum: number,
    assertItem: (candidate: unknown, subject: string) => void,
): readonly string[] {
    const items = readScopeArray(value, subject).map((item, index) => {
        assertItem(item, `${subject}[${index}]`);
        return item as string;
    });
    if (items.length > maximum || new Set(items).size !== items.length) {
        throw new TypeError(`${subject} must be unique and within the bound`);
    }
    return Object.freeze(items);
}

function assertCommon(fields: Record<string, unknown>, subject: string): void {
    assertCompatibility(fields.compatibility_version, fields.scope_version);
    assertScopeText(fields.command_id, `${subject} command_id`);
    assertScopeId(fields.scope_id, `${subject} scope_id`);
}

function assertMergeCutId(value: unknown): asserts value is string {
    assertPrefixedDigest(value, scopeProtocolConfig.identity.mergeCutIdPrefix, "merge cut id");
}

function assertContentId(value: unknown, subject: string): void {
    assertPrefixedDigest(value, workspaceProtocolConfig.carrier.worldContentIdPrefix, subject);
}

function assertRevisionId(value: unknown, subject: string): void {
    assertPrefixedDigest(value, workspaceProtocolConfig.carrier.revisionIdPrefix, subject);
}

function readNullableContentId(value: unknown, subject: string): string | null {
    if (value === null) {
        return null;
    }
    assertContentId(value, subject);
    return value as string;
}

function readNullableRevisionId(value: unknown, subject: string): string | null {
    if (value === null) {
        return null;
    }
    assertRevisionId(value, subject);
    return value as string;
}
