import {
    planEffectCompensations,
    readEffectCompensationRegistry,
    runEffectCompensations,
} from "../effect/compensation.ts";
import { EffectCompensationFailedError } from "../effect/compensation-errors.ts";
import { collectScopeSubtreeEffects } from "../effect/compensation-evidence.ts";
import { scopeProtocolConfig } from "../protocol/config.ts";
import {
    EFFECT_COMPENSATION_TRIGGERS,
    RECORD_MODES,
    SCOPE_COMMAND_KINDS,
    SCOPE_DISCARD_PHASES,
    SCOPE_STATES,
} from "../protocol/values.generated.ts";
import { assertRecordId } from "../record/guards.ts";
import { ROOT_WITNESS_ID } from "../record/root-witness.ts";
import type { RecordBody } from "../record/types.ts";
import { ScopeEvidenceError } from "../scope/errors.ts";
import { createScopeCommandAppendIntentId, readScopeForkRecord } from "../scope/records.ts";
import { readScopeCommandReceipt } from "../scope/replay.ts";
import {
    createScopeDiscardAppendIntentId,
    createScopeDiscardCleanedBody,
    createScopeDiscardDecidedBody,
    readScopeDiscardRecord,
    readScopeMergeRecord,
} from "../scope/terminal-records.ts";
import type { ScopeDiscardReceipt, ScopeMergePreparedRecord } from "../scope/types.ts";
import {
    assertScopeId,
    assertScopeText,
    readNowMilliseconds,
    readScopeDataObject,
} from "../scope/validation.ts";
import { assertScopeWriter } from "../scope/writer.ts";
import { AppendIntentConflictError } from "../store/errors.ts";
import type { ScopeDiscardSubtreeScope } from "../store/scope-terminals.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import type { OwnerRecord, StoreAppendRequest } from "../store/types.ts";
import {
    assertReferenceCopyCarrier,
    discardReferenceCopyCustodyIdentity,
} from "./reference-copy-carrier.ts";
import type { DiscardScopeOptions } from "./scope-terminal-types.ts";
import type { ReferenceCopyCarrier } from "./types.ts";

const [CAPTURE_MODE] = RECORD_MODES;
const [OPEN_STATE] = SCOPE_STATES;
const [DECIDED_PHASE, CLEANED_PHASE] = SCOPE_DISCARD_PHASES;
const [, , , , , DISCARD_COMMAND] = SCOPE_COMMAND_KINDS;
const [DISCARD_TRIGGER] = EFFECT_COMPENSATION_TRIGGERS;

/**
 * Durably discards one owned child subtree and cleans only its proven-owned custody.
 *
 * Admission requires the owning parent's writer, the exact current head of the subtree root, an
 * open root without a reserved merge, and no unreleased writer claim on any open scope in the
 * subtree. One transaction seals every open scope of the subtree with a decision record on its
 * own path; merged and already discarded descendants keep their terminal evidence, and a
 * descendant's in-flight merge or fork can never complete afterwards. The parent's head,
 * managed custody, and effective history are untouched: discard is not a rollback of the parent
 * to fork time.
 *
 * External effects are reversed only through compensation. Every successful compensable effect
 * cited by the selected history of a sealed scope (a replay effect step or a supervised dispatch
 * resolution) is compensated once through `compensation` after the decision, in reverse
 * materialization order: the subtree root first and each child after its parent, each history in
 * order. Compensation intent, attempts, and outcomes are retained on the compensation's own path,
 * so a retry never compensates an effect twice. A missing handler is refused before the decision.
 *
 * Cleanup progress is separate from the logical decision. The decision names the exact custody
 * identities of every forked scope in the subtree, read from their retained fork journals, and
 * cleanup discards only those identities through the carrier, never scanning directories. When a
 * carrier is supplied and cleanup succeeds, a cleanup record is retained under the parent's
 * current fence. Without a carrier, or after an interrupted cleanup, the receipt reports the
 * decided phase and a retry of the same command resumes cleanup. Repeating a completed discard
 * returns its original receipt without any authority.
 *
 * @param store - Open writable trace store holding the parent and subtree registrations.
 * @param options - Parent writer, exact subtree root and head, command, and optional carrier.
 * @returns Frozen discard receipt with cleanup progress.
 * @throws {ScopeTerminalConflictError} If the root or parent is not open or the root retains a
 * reserved merge.
 * @throws {ScopeQuiescenceError} If an open subtree scope holds an unreleased writer claim.
 * @throws {ScopeWriterFencedError} If the parent fence is released, expired, or superseded.
 * @throws {ScopeHeadConflictError} If the expected root head is not current.
 * @throws {ScopeEvidenceError} If ownership or retained evidence is inconsistent or the subtree
 * exceeds the configured bound.
 * @throws {AppendIntentConflictError} If the command identity already names different content.
 * @throws {WorldCarrierError} If owned custody is in an unknown physical state.
 * @throws {EffectCompensationHandlerNotFoundError} If a cited compensable effect still needing
 * compensation has no handler; before the decision when the discard is new.
 * @throws {EffectCompensationFailedError} After cleanup, if a compensation handler failed; a retry
 * attempts the failed compensations again.
 * @throws {TraceStoreError} If the store is closed.
 * @throws {TypeError} If a handle or carrier is forged or options are malformed.
 *
 * @example
 * ```ts
 * const discarded = await discardScope(store, {
 *     carrier,
 *     commandId: "scope-command:discard:1",
 *     expectedHeadRecordId: inspectScope(store, child.scope_id)?.head.record_id,
 *     parent: parentWriter,
 *     scopeId: child.scope_id,
 * });
 * console.log(discarded.cleanup.phase);
 * ```
 *
 * @public
 */
export async function discardScope(
    store: SQLiteTraceStore,
    options: DiscardScopeOptions,
): Promise<ScopeDiscardReceipt> {
    const fields = readScopeDataObject(
        options,
        ["commandId", "expectedHeadRecordId", "parent", "scopeId"],
        "discardScope options",
        ["carrier", "compensation", "nowMilliseconds"],
    );
    assertScopeText(fields.commandId, "commandId");
    assertRecordId(fields.expectedHeadRecordId, "expectedHeadRecordId");
    assertScopeId(fields.scopeId, "scopeId");
    assertScopeWriter(fields.parent, store);
    if (fields.carrier !== undefined) {
        assertReferenceCopyCarrier(fields.carrier);
    }
    const nowMilliseconds = readNowMilliseconds(fields.nowMilliseconds, "nowMilliseconds");
    const compensation = readEffectCompensationRegistry(fields.compensation);
    const commandId = fields.commandId;
    const parent = fields.parent;
    const scopeId = fields.scopeId;
    const expectedHeadRecordId = fields.expectedHeadRecordId;
    const carrier = fields.carrier as ReferenceCopyCarrier | undefined;
    const commandIntentId = createScopeCommandAppendIntentId(commandId);
    const parentFence = { claimId: parent.claim_id, fencingToken: parent.fencing_token };
    assertRetainedDecision(store, commandIntentId, commandId, {
        expectedHeadRecordId,
        parentScopeId: parent.scope_id,
        scopeId,
    });
    if (store.readAppendIntentRecords(commandIntentId).length === 0) {
        // Refuse before sealing anything when an effect the discard must compensate lacks a handler.
        planEffectCompensations(
            store,
            collectScopeSubtreeEffects(store, scopeId, null),
            compensation,
        );
    }
    store.discardScope({
        commandAppendIntentId: commandIntentId,
        decide: (subtree) => decisionRequest(commandIntentId, commandId, parent.scope_id, subtree),
        expectedHeadRecordId,
        nowMilliseconds,
        parentFence,
        parentScopeId: parent.scope_id,
        scopeId,
    });
    assertRetainedDecision(store, commandIntentId, commandId, {
        expectedHeadRecordId,
        parentScopeId: parent.scope_id,
        scopeId,
    });
    const decided = readDiscardReceipt(store, commandId);
    const { failed } = await runEffectCompensations(
        store,
        collectScopeSubtreeEffects(store, scopeId, new Set(decided.sealed_scope_ids)),
        compensation,
        { command_id: commandId, kind: DISCARD_TRIGGER },
    );
    // A sealed parent can no longer authorize cleanup; the ancestor discard owns those identities.
    if (
        decided.cleanup.phase === DECIDED_PHASE &&
        (carrier !== undefined || decided.cleanup.custody_ids.length === 0) &&
        store.readScopeRegistration(parent.scope_id)?.state === OPEN_STATE
    ) {
        for (const custodyId of decided.cleanup.custody_ids) {
            discardReferenceCopyCustodyIdentity(carrier as ReferenceCopyCarrier, custodyId);
        }
        store.completeScopeDiscardCleanup({
            decidedRecordId: decided.decided_record_id,
            nowMilliseconds,
            parentFence,
            parentScopeId: parent.scope_id,
            request: {
                append_intent_id: createScopeDiscardAppendIntentId(commandId, CLEANED_PHASE),
                batch: {
                    groups: [
                        {
                            owner_id: scopeId,
                            records: [
                                {
                                    body: createScopeDiscardCleanedBody({
                                        commandId,
                                        custodyIds: decided.cleanup.custody_ids,
                                        scopeId,
                                    }) as unknown as RecordBody,
                                    caused_by_record_ids: [decided.decided_record_id],
                                    mode: CAPTURE_MODE,
                                    schema_ref: scopeProtocolConfig.traceSchemas.discard,
                                    witness_ref: ROOT_WITNESS_ID,
                                },
                            ],
                        },
                    ],
                },
            },
            scopeId,
        });
    }
    if (failed.length > 0) {
        throw new EffectCompensationFailedError(failed);
    }
    return readDiscardReceipt(store, commandId);
}

function assertRetainedDecision(
    store: SQLiteTraceStore,
    commandIntentId: string,
    commandId: string,
    expected: {
        readonly expectedHeadRecordId: string;
        readonly parentScopeId: string;
        readonly scopeId: string;
    },
): void {
    const [record] = store.readAppendIntentRecords(commandIntentId);
    if (record === undefined) {
        return;
    }
    const decided =
        record.envelope.schema_ref === scopeProtocolConfig.traceSchemas.discard
            ? readScopeDiscardRecord(record.body)
            : undefined;
    if (
        decided?.phase !== DECIDED_PHASE ||
        decided.command_id !== commandId ||
        decided.scope_id !== expected.scopeId ||
        decided.parent_scope_id !== expected.parentScopeId ||
        record.envelope.caused_by_record_ids[0] !== expected.expectedHeadRecordId
    ) {
        throw new AppendIntentConflictError(
            `scope command ${commandId} already names different content`,
        );
    }
}

function decisionRequest(
    commandIntentId: string,
    commandId: string,
    parentScopeId: string,
    subtree: readonly ScopeDiscardSubtreeScope[],
): StoreAppendRequest {
    const [root] = subtree as readonly [ScopeDiscardSubtreeScope];
    const sealed = subtree.filter((scope) => scope.state === OPEN_STATE);
    const custodyIds = subtree
        .flatMap((scope) => [
            ...(scope.forkPrepared === undefined
                ? []
                : [readScopeForkRecord(scope.forkPrepared.body).custody_id]),
            ...(scope.mergePrepared === undefined
                ? []
                : applicationCustodyIds(scope.mergePrepared)),
        ])
        .sort();
    return {
        append_intent_id: commandIntentId,
        batch: {
            groups: sealed.map((scope) => ({
                owner_id: scope.scopeId,
                records: [
                    {
                        body: createScopeDiscardDecidedBody({
                            commandId,
                            custodyIds: scope === root ? custodyIds : [],
                            discardScopeId: root.scopeId,
                            parentScopeId,
                            scopeId: scope.scopeId,
                            sealedScopeIds:
                                scope === root ? sealed.map((entry) => entry.scopeId) : [],
                        }) as unknown as RecordBody,
                        caused_by_record_ids: [scope.head.record_id],
                        mode: CAPTURE_MODE,
                        schema_ref: scopeProtocolConfig.traceSchemas.discard,
                        witness_ref: ROOT_WITNESS_ID,
                    },
                ],
            })),
        },
    };
}

function applicationCustodyIds(reservation: OwnerRecord): readonly string[] {
    const prepared = readScopeMergeRecord(reservation.body) as ScopeMergePreparedRecord;
    const applicationCustodyId = prepared.world?.application_custody_id;
    return applicationCustodyId === undefined || applicationCustodyId === null
        ? []
        : [applicationCustodyId];
}

function readDiscardReceipt(store: SQLiteTraceStore, commandId: string): ScopeDiscardReceipt {
    const replay = readScopeCommandReceipt(store, commandId);
    // The decision was validated as a discard of this exact scope before this read.
    /* node:coverage ignore next 3 */
    if (replay?.command !== DISCARD_COMMAND) {
        throw new ScopeEvidenceError("scope discard decision is not retained");
    }
    return replay.receipt;
}
