import { createHash } from "node:crypto";
import {
    canonicalizeSemanticValue,
    createRecordId,
    type SemanticRecord,
    type SemanticValue,
} from "../canonical/canonical-record.ts";
import { createCanonicalSnapshot } from "../canonical/snapshot.ts";
import { validateEffectCorrelation } from "../effect/records.ts";
import type { EffectIntent } from "../effect/types.ts";
import { readEffectIntent, readEffectOutcome } from "../effect/validation.ts";
import {
    effectProtocolConfig,
    projectionProtocolConfig,
    recordIdConfig,
    workspaceProtocolConfig,
} from "../protocol/config.ts";
import {
    RECORD_MODES,
    RETAINED_WORLD_JOURNAL_PHASES,
    WORLD_EFFECT_OUTCOMES,
    WORLD_EFFECT_PHASES,
    WORLD_EFFECT_RECOVERY,
} from "../protocol/values.generated.ts";
import { ROOT_WITNESS_ID } from "../record/root-witness.ts";
import type { RecordId } from "../record/types.ts";
import { assertPrefixedDigest, readScopeDataObject } from "../scope/validation.ts";
import { TraceStoreError } from "../store/errors.ts";
import type { OwnerRecord } from "../store/types.ts";
import type { GitRepositoryGrantPlan } from "./repository-grant-types.ts";
import type {
    WorldEffectAuthority,
    WorldEffectJournalEvidence,
    WorldEffectOperationInspection,
    WorldEffectTextEvidence,
} from "./world-effect-types.ts";

const capture = workspaceProtocolConfig.worldTaskCapture;
const config = capture.operationJournal;
const [OPENED, INTENT, ADMITTED, OUTCOME] = WORLD_EFFECT_PHASES;
const [SUCCEEDED, REFUSED, FAILED, CANCELLED] = WORLD_EFFECT_OUTCOMES;
const [ABSENT, RECORDING, NOT_MATERIALIZED, UNCERTAIN, SETTLED] = WORLD_EFFECT_RECOVERY;
const [PREPARED, , EXECUTING, CAPTURED] = RETAINED_WORLD_JOURNAL_PHASES;
const [CAPTURE_MODE] = RECORD_MODES;

/** Derives a capability operation identity from its capture and invocation position. @internal */
export function worldEffectId(runId: string, captureId: string, index: number): string {
    return (
        config.effectIdPrefix +
        createRecordId({
            [config.identityKind]: { run_id: runId, capture_id: captureId, index },
        }).slice(recordIdConfig.prefix.length)
    );
}

/** Creates bounded digest-only evidence without evaluating non-text input objects. @internal */
export function summarizeWorldEffectText(value: unknown, bound: number): WorldEffectTextEvidence {
    if (typeof value !== "string")
        return Object.freeze({
            byte_length: null,
            digest: null,
            valid_text: false,
            within_bound: false,
        });
    const length = Buffer.byteLength(value, "utf8");
    const valid = !/[\uD800-\uDFFF]/u.test(value);
    const within = length <= bound;
    return Object.freeze({
        byte_length: length,
        digest:
            valid && within
                ? recordIdConfig.prefix +
                  createHash(recordIdConfig.algorithm).update(value, "utf8").digest("hex")
                : null,
        valid_text: valid,
        within_bound: within,
    });
}

/**
 * Validates the operation stream after the enclosing capture journal has been authenticated.
 * Records beyond a retained lifecycle terminal are outside this inspection's immutable prefix.
 * @param records - Owner-ordered run records, including capture authority evidence.
 * @param runId - Expected run identity.
 * @returns Immutable operation evidence, including any interrupted tail.
 * @throws {TraceStoreError} If operation evidence or its authority/correlation is inconsistent.
 * @internal
 */
export function readWorldEffectRecords(
    records: readonly OwnerRecord[],
    runId: string,
): WorldEffectJournalEvidence {
    try {
        return fold(records, runId);
    } catch (error) {
        if (error instanceof TraceStoreError) throw error;
        throw new TraceStoreError("world operation evidence is malformed", { cause: error });
    }
}

function fold(allRecords: readonly OwnerRecord[], runId: string): WorldEffectJournalEvidence {
    const lifecycle = projectionProtocolConfig.executionHistory.executionSchemas;
    const terminal = allRecords.find(
        (record) =>
            record.envelope.schema_ref === lifecycle.completed ||
            record.envelope.schema_ref === lifecycle.failed,
    );
    const records =
        terminal === undefined
            ? allRecords
            : allRecords.filter(
                  (record) => record.view.owner_ordinal <= terminal.view.owner_ordinal,
              );
    const journal = records.filter((record) => record.envelope.schema_ref === config.schemaId);
    const first = journal[0];
    if (first === undefined)
        return Object.freeze({
            authority: null,
            authority_record_id: null,
            capture_id: null,
            operations: Object.freeze([]),
            run_id: runId,
            status: ABSENT,
        });
    const transitions = records.filter((record) =>
        capture.journalReaders.some((reader) => reader.schemaId === record.envelope.schema_ref),
    );
    const prepared = transitions.find((record) => record.body.capture_phase === PREPARED);
    const executing = transitions.find((record) => record.body.capture_phase === EXECUTING);
    const captured = transitions.find((record) => record.body.capture_phase === CAPTURED);
    requireEvidence(
        prepared !== undefined && executing !== undefined,
        "operation stream has no authenticated capture authority",
    );
    const opened = readBody(first, runId, ["authority"]);
    requireEvidence(
        opened.phase === OPENED &&
            opened.capture_id === executing.body.capture_id &&
            first.view.owner_ordinal > executing.view.owner_ordinal &&
            same(first.envelope.caused_by_record_ids, [executing.envelope.record_id]),
        "operation stream opening is inconsistent",
    );
    const plan = (prepared.body.repository_grant_plan ??
        null) as unknown as GitRepositoryGrantPlan | null;
    const grant = plan?.grants.find((entry) => entry.binding_id === prepared.body.binding_id);
    requireEvidence(
        plan === null || grant !== undefined,
        "operation authority names an ungranted binding",
    );
    const authority: WorldEffectAuthority = {
        authority: grant?.authority ?? workspaceProtocolConfig.repositoryGrants.atoms,
        base_revision_id: prepared.body.base_revision_id as string,
        binding_id: prepared.body.binding_id as string,
        claim_id: executing.body.claim_id as string,
        content_policy: config.contentPolicy,
        custody_id: executing.body.custody_id as string,
        enforcement: prepared.body.enforcement as string,
        fencing_token: executing.body.fencing_token as number,
        grant_plan_id: plan?.plan_id ?? null,
        resource_id: grant?.resource_id ?? null,
    };
    requireEvidence(
        same(opened.authority, authority),
        "operation authority differs from the capture grant or fence",
    );
    const operations: WorldEffectOperationInspection[] = [];
    let active: {
        index: number;
        intent: EffectIntent;
        intentRecordId: RecordId;
        admissionRecordId: RecordId | null;
    } | null = null;
    let previous = first.envelope.record_id;
    for (const record of journal.slice(1)) {
        const phase = record.body.phase;
        const body = readBody(
            record,
            runId,
            phase === ADMITTED ? ["effect_id", "index"] : ["effect", "index"],
        );
        requireEvidence(
            body.capture_id === opened.capture_id &&
                same(record.envelope.caused_by_record_ids, [previous]) &&
                (captured === undefined || record.view.owner_ordinal < captured.view.owner_ordinal),
            "operation ordering or capture boundary is inconsistent",
        );
        if (phase === INTENT) {
            requireEvidence(
                active === null && body.index === operations.length,
                "operation intent is out of order",
            );
            const intent = readEffectIntent(body.effect as EffectIntent);
            const requiredAtom =
                intent.kind === config.kinds.readText
                    ? workspaceProtocolConfig.repositoryGrants.operations.readText
                    : workspaceProtocolConfig.repositoryGrants.operations.writeText;
            requireEvidence(
                [config.kinds.readText, config.kinds.writeText].includes(intent.kind) &&
                    intent.effect_id ===
                        worldEffectId(runId, opened.capture_id as string, operations.length) &&
                    intent.reversibility === effectProtocolConfig.reversibilityTiers[0],
                "operation intent identity is inconsistent",
            );
            const payload = readScopeDataObject(
                intent.payload,
                ["authority_record_id", "content", "path", "required_atom"],
                "world operation payload",
            );
            requireEvidence(
                payload.authority_record_id === first.envelope.record_id &&
                    payload.required_atom === requiredAtom,
                "operation intent authority is inconsistent",
            );
            readSummary(payload.path, config.maxPathEvidenceBytes);
            if (intent.kind === config.kinds.readText)
                requireEvidence(payload.content === null, "read intent cannot carry write content");
            else readSummary(payload.content, capture.maxTextBytes);
            active = {
                index: operations.length,
                intent,
                intentRecordId: record.envelope.record_id,
                admissionRecordId: null,
            };
        } else if (phase === ADMITTED) {
            requireEvidence(
                active !== null &&
                    body.index === active.index &&
                    body.effect_id === active.intent.effect_id &&
                    active.admissionRecordId === null,
                "operation admission has no matching intent",
            );
            const payload = active.intent.payload as SemanticRecord;
            requireEvidence(
                authority.authority.includes(payload.required_atom as string),
                "ungranted operation was admitted",
            );
            active.admissionRecordId = record.envelope.record_id;
        } else {
            requireEvidence(
                phase === OUTCOME && active !== null && body.index === active.index,
                "operation outcome has no matching intent",
            );
            const outcome = readEffectOutcome(body.effect);
            validateEffectCorrelation(active.intent, outcome);
            if (outcome.result.ok) {
                const value = readScopeDataObject(
                    outcome.result.value,
                    ["result", "status"],
                    "world operation success",
                );
                requireEvidence(
                    value.status === SUCCEEDED && active.admissionRecordId !== null,
                    "successful operation has no admission",
                );
                if (active.intent.kind === config.kinds.readText) {
                    const summary = readSummary(value.result, capture.maxTextBytes);
                    requireEvidence(
                        summary.valid_text && summary.within_bound,
                        "successful read has invalid content evidence",
                    );
                } else
                    requireEvidence(
                        value.result === null,
                        "write outcome cannot carry read content",
                    );
            } else {
                const failure = readScopeDataObject(
                    outcome.result.error,
                    ["status"],
                    "world operation failure",
                );
                requireEvidence(
                    [REFUSED, FAILED, CANCELLED].includes(failure.status as never) &&
                        (failure.status === FAILED || active.admissionRecordId === null),
                    "refused operation was materialized or has an invalid outcome",
                );
            }
            operations.push(
                Object.freeze({
                    admission_record_id: active.admissionRecordId,
                    index: active.index,
                    intent: active.intent,
                    intent_record_id: active.intentRecordId,
                    outcome,
                    outcome_record_id: record.envelope.record_id,
                    status: SETTLED,
                }),
            );
            active = null;
        }
        previous = record.envelope.record_id;
    }
    if (active !== null) {
        requireEvidence(
            captured === undefined && terminal === undefined,
            "capture settled with an uncertain operation",
        );
        operations.push(
            Object.freeze({
                admission_record_id: active.admissionRecordId,
                index: active.index,
                intent: active.intent,
                intent_record_id: active.intentRecordId,
                outcome: null,
                outcome_record_id: null,
                status: active.admissionRecordId === null ? NOT_MATERIALIZED : UNCERTAIN,
            }),
        );
    }
    requireEvidence(
        captured === undefined || first.view.owner_ordinal < captured.view.owner_ordinal,
        "operation stream opened after capture",
    );
    return createCanonicalSnapshot({
        authority,
        authority_record_id: first.envelope.record_id,
        capture_id: opened.capture_id as string,
        operations,
        run_id: runId,
        status:
            active === null
                ? captured === undefined
                    ? RECORDING
                    : SETTLED
                : active.admissionRecordId === null
                  ? NOT_MATERIALIZED
                  : UNCERTAIN,
    }) as unknown as WorldEffectJournalEvidence;
}

function readBody(
    record: OwnerRecord,
    runId: string,
    fields: readonly string[],
): Record<string, unknown> {
    const body = readScopeDataObject(
        record.body,
        [
            "capture_id",
            "compatibility_version",
            "phase",
            "run_id",
            "world_effect_version",
            ...fields,
        ],
        "world operation record",
    );
    requireEvidence(
        body.compatibility_version === config.compatibilityVersion &&
            body.world_effect_version === config.version &&
            body.run_id === runId &&
            record.envelope.mode === CAPTURE_MODE &&
            record.envelope.witness_ref === ROOT_WITNESS_ID,
        "world operation record version or envelope is inconsistent",
    );
    return body;
}

function readSummary(value: unknown, bound: number): WorldEffectTextEvidence {
    const fields = readScopeDataObject(
        value,
        ["byte_length", "digest", "valid_text", "within_bound"],
        "world operation text evidence",
    );
    requireEvidence(
        typeof fields.valid_text === "boolean" && typeof fields.within_bound === "boolean",
        "text evidence flags are invalid",
    );
    if (fields.byte_length === null) {
        requireEvidence(
            fields.digest === null && !fields.valid_text && !fields.within_bound,
            "non-text evidence is inconsistent",
        );
    } else {
        requireEvidence(
            Number.isSafeInteger(fields.byte_length) &&
                (fields.byte_length as number) >= 0 &&
                fields.within_bound === (fields.byte_length as number) <= bound,
            "text evidence bound is inconsistent",
        );
        if (fields.valid_text && fields.within_bound)
            assertPrefixedDigest(fields.digest, recordIdConfig.prefix, "text digest");
        else
            requireEvidence(
                fields.digest === null,
                "invalid or over-bound text must not retain a digest",
            );
    }
    return Object.freeze(fields) as unknown as WorldEffectTextEvidence;
}

function same(left: unknown, right: unknown): boolean {
    return (
        canonicalizeSemanticValue(left as SemanticValue) ===
        canonicalizeSemanticValue(right as SemanticValue)
    );
}

function requireEvidence(condition: boolean, message: string): asserts condition {
    if (!condition) throw new TraceStoreError(`world operation evidence is malformed: ${message}`);
}
