import { canonicalizeRecord, createRecordId } from "../canonical/canonical-record.ts";
import { createCanonicalSnapshot } from "../canonical/snapshot.ts";
import { createIntentReference, validateEffectCorrelation } from "../effect/records.ts";
import type { EffectIntent, EffectOutcome } from "../effect/types.ts";
import { readEffectIntent } from "../effect/validation.ts";
import { kernelProtocolConfig, supervisionProtocolConfig } from "../protocol/config.ts";
import {
    SUPERVISION_APPROVAL_GATES,
    SUPERVISION_APPROVAL_PHASES,
    SUPERVISION_APPROVAL_VERDICTS,
    SUPERVISION_DECISION_SOURCES,
    SUPERVISION_DECISIONS,
    SUPERVISION_DISPOSITIONS,
    SUPERVISION_TIMEOUT_POLICIES,
} from "../protocol/values.generated.ts";
import { assertRecordId } from "../record/guards.ts";
import type { RecordBody, RecordId } from "../record/types.ts";
import {
    assertPrefixedDigest,
    assertScopeText,
    readScopeArray,
    readScopeDataObject,
} from "../scope/validation.ts";
import { SupervisionEvidenceError } from "./errors.ts";
import type {
    SupervisionApprovalGate,
    SupervisionApprovalVerdict,
    SupervisionDecision,
    SupervisionDecisionSource,
    SupervisionDisposition,
    SupervisionInterceptorDeclaration,
    SupervisionTimeoutPolicy,
    TraceSubscriptionCursor,
    TraceSubscriptionPosition,
} from "./types.ts";

const config = supervisionProtocolConfig;
const [REQUESTED_PHASE, RESOLVED_PHASE] = SUPERVISION_APPROVAL_PHASES;
const [, , EXPIRED_VERDICT] = SUPERVISION_APPROVAL_VERDICTS;
const [MATERIALIZED_DISPOSITION] = SUPERVISION_DISPOSITIONS;
const [, , REPLACE_DECISION] = SUPERVISION_DECISIONS;
const [INTERCEPTOR_SOURCE] = SUPERVISION_DECISION_SOURCES;

/** Retained dispatch record body. @internal */
export type SupervisionDispatchBody = {
    readonly approval_timeout_milliseconds: number;
    readonly cited_record_ids: readonly RecordId[];
    readonly command_id: string;
    readonly compatibility_version: string;
    readonly dispatch_id: string;
    readonly intent: EffectIntent;
    readonly intent_ref: string;
    readonly interceptors: readonly SupervisionInterceptorDeclaration[];
    readonly supervision_version: number;
};

/** Retained decision record body. @internal */
export type SupervisionDecisionBody = {
    readonly applied_policy: SupervisionTimeoutPolicy | null;
    readonly compatibility_version: string;
    readonly decision: SupervisionDecision;
    readonly dispatch_id: string;
    readonly intent_ref: string;
    readonly interceptor_id: string;
    readonly position: number;
    readonly reason: string | null;
    readonly replacement: EffectIntent | null;
    readonly source: SupervisionDecisionSource;
    readonly supervision_version: number;
};

/** Retained approval request body. @internal */
export type SupervisionApprovalRequestBody = {
    readonly compatibility_version: string;
    readonly dispatch_id: string;
    readonly gate: SupervisionApprovalGate;
    readonly intent_ref: string;
    readonly phase: (typeof SUPERVISION_APPROVAL_PHASES)[0];
    readonly position: number | null;
    readonly reason: string | null;
    readonly supervision_version: number;
};

/** Retained approval verdict body. @internal */
export type SupervisionApprovalVerdictBody = {
    readonly approver_id: string | null;
    readonly command_id: string | null;
    readonly compatibility_version: string;
    readonly dispatch_id: string;
    readonly phase: (typeof SUPERVISION_APPROVAL_PHASES)[1];
    readonly reason: string | null;
    readonly request_record_id: RecordId;
    readonly supervision_version: number;
    readonly verdict: SupervisionApprovalVerdict;
};

/** Retained admission body. @internal */
export type SupervisionAdmissionBody = {
    readonly compatibility_version: string;
    readonly dispatch_id: string;
    readonly intent_ref: string;
    readonly supervision_version: number;
};

/** Retained resolution body. @internal */
export type SupervisionResolutionBody = {
    readonly compatibility_version: string;
    readonly dispatch_id: string;
    readonly disposition: SupervisionDisposition;
    readonly handler_id: string | null;
    readonly intent_ref: string;
    readonly outcome: EffectOutcome | null;
    readonly supervision_version: number;
};

/** Retained context injection body. @internal */
export type SupervisionContextBody = {
    readonly channel_id: string;
    readonly cited_record_ids: readonly RecordId[];
    readonly command_id: string;
    readonly compatibility_version: string;
    readonly data: RecordBody;
    readonly supervision_version: number;
    readonly supervisor_id: string;
};

const VERSION_FIELDS = {
    compatibility_version: config.compatibilityVersion,
    supervision_version: config.recordVersion,
} as const;

/** Derives the owner path and identity of one supervised dispatch command. @internal */
export function createSupervisedDispatchId(commandId: string): string {
    assertScopeText(commandId, "commandId");
    return `${config.identity.dispatchIdPrefix}${digestHex(
        createRecordId({ supervised_dispatch: { command_id: commandId } }),
    )}`;
}

/** Derives the owner path and identity of one named context channel. @internal */
export function createSupervisionContextChannelId(channel: string): string {
    assertScopeText(channel, "channel");
    return `${config.identity.contextChannelIdPrefix}${digestHex(
        createRecordId({ supervision_context_channel: { channel } }),
    )}`;
}

/** Derives the append intent naming one step of one supervision command. @internal */
export function createSupervisionAppendIntentId(commandId: string, step: string): string {
    return createRecordId({
        [config.identity.commandAppendIntentKind]: { command_id: commandId, step },
    });
}

/** Creates one canonical subscription cursor from owner positions. @internal */
export function createTraceSubscriptionCursor(
    positions: readonly TraceSubscriptionPosition[],
): TraceSubscriptionCursor {
    const ordered = [...positions]
        .sort((left, right) => compareText(left.owner_id, right.owner_id))
        .map((position) =>
            Object.freeze({ next_ordinal: position.next_ordinal, owner_id: position.owner_id }),
        );
    const identity = {
        cursor_version: config.subscriptions.cursorVersion,
        positions: ordered,
    };
    return Object.freeze({
        compatibility_version: config.compatibilityVersion,
        cursor_id: `${config.identity.cursorIdPrefix}${digestHex(
            createRecordId({ supervision_cursor: identity }),
        )}`,
        cursor_version: config.subscriptions.cursorVersion,
        positions: Object.freeze(ordered),
    });
}

/**
 * Validates an untrusted cursor, including its content-addressed identity.
 *
 * @internal
 */
export function readTraceSubscriptionCursor(value: unknown): TraceSubscriptionCursor {
    const fields = readScopeDataObject(
        value,
        ["compatibility_version", "cursor_id", "cursor_version", "positions"],
        "cursor",
    );
    const positions = readScopeArray(fields.positions, "cursor positions").map((entry, index) => {
        const position = readScopeDataObject(
            entry,
            ["next_ordinal", "owner_id"],
            `cursor positions[${index}]`,
        );
        assertScopeText(position.owner_id, `cursor positions[${index}].owner_id`);
        assertOrdinal(position.next_ordinal, `cursor positions[${index}].next_ordinal`, true);
        return position as TraceSubscriptionPosition;
    });
    const cursor = createTraceSubscriptionCursor(positions);
    if (
        fields.compatibility_version !== config.compatibilityVersion ||
        fields.cursor_version !== config.subscriptions.cursorVersion ||
        fields.cursor_id !== cursor.cursor_id ||
        positions.some(
            (position, index) => position.owner_id !== cursor.positions[index]?.owner_id,
        ) ||
        new Set(positions.map((position) => position.owner_id)).size !== positions.length
    ) {
        throw new TypeError("cursor must be canonical, current, and correctly identified");
    }
    return cursor;
}

/** Creates the first record body of one supervised dispatch. @internal */
export function createSupervisionDispatchBody(fields: {
    readonly approvalTimeoutMilliseconds: number;
    readonly citedRecordIds: readonly RecordId[];
    readonly commandId: string;
    readonly dispatchId: string;
    readonly intent: EffectIntent;
    readonly interceptors: readonly SupervisionInterceptorDeclaration[];
}): RecordBody {
    return snapshot({
        ...VERSION_FIELDS,
        approval_timeout_milliseconds: fields.approvalTimeoutMilliseconds,
        cited_record_ids: fields.citedRecordIds,
        command_id: fields.commandId,
        dispatch_id: fields.dispatchId,
        intent: fields.intent,
        intent_ref: createIntentReference(fields.intent),
        interceptors: fields.interceptors,
    });
}

/** Creates one retained decision body. @internal */
export function createSupervisionDecisionBody(fields: {
    readonly appliedPolicy: SupervisionTimeoutPolicy | null;
    readonly decision: SupervisionDecision;
    readonly dispatchId: string;
    readonly intentRef: string;
    readonly interceptorId: string;
    readonly position: number;
    readonly reason: string | null;
    readonly replacement: EffectIntent | null;
    readonly source: SupervisionDecisionSource;
}): RecordBody {
    return snapshot({
        ...VERSION_FIELDS,
        applied_policy: fields.appliedPolicy,
        decision: fields.decision,
        dispatch_id: fields.dispatchId,
        intent_ref: fields.intentRef,
        interceptor_id: fields.interceptorId,
        position: fields.position,
        reason: fields.reason,
        replacement: fields.replacement,
        source: fields.source,
    });
}

/** Creates one approval request body. @internal */
export function createSupervisionApprovalRequestBody(fields: {
    readonly dispatchId: string;
    readonly gate: SupervisionApprovalGate;
    readonly intentRef: string;
    readonly position: number | null;
    readonly reason: string | null;
}): RecordBody {
    return snapshot({
        ...VERSION_FIELDS,
        dispatch_id: fields.dispatchId,
        gate: fields.gate,
        intent_ref: fields.intentRef,
        phase: REQUESTED_PHASE,
        position: fields.position,
        reason: fields.reason,
    });
}

/** Creates one approval verdict body. @internal */
export function createSupervisionApprovalVerdictBody(fields: {
    readonly approverId: string | null;
    readonly commandId: string | null;
    readonly dispatchId: string;
    readonly reason: string | null;
    readonly requestRecordId: RecordId;
    readonly verdict: SupervisionApprovalVerdict;
}): RecordBody {
    return snapshot({
        ...VERSION_FIELDS,
        approver_id: fields.approverId,
        command_id: fields.commandId,
        dispatch_id: fields.dispatchId,
        phase: RESOLVED_PHASE,
        reason: fields.reason,
        request_record_id: fields.requestRecordId,
        verdict: fields.verdict,
    });
}

/** Creates one admission body. @internal */
export function createSupervisionAdmissionBody(dispatchId: string, intentRef: string): RecordBody {
    return snapshot({ ...VERSION_FIELDS, dispatch_id: dispatchId, intent_ref: intentRef });
}

/** Creates one resolution body. @internal */
export function createSupervisionResolutionBody(fields: {
    readonly dispatchId: string;
    readonly disposition: SupervisionDisposition;
    readonly handlerId: string | null;
    readonly intentRef: string;
    readonly outcome: EffectOutcome | null;
}): RecordBody {
    return snapshot({
        ...VERSION_FIELDS,
        dispatch_id: fields.dispatchId,
        disposition: fields.disposition,
        handler_id: fields.handlerId,
        intent_ref: fields.intentRef,
        outcome: fields.outcome,
    });
}

/** Creates one context injection body. @internal */
export function createSupervisionContextBody(fields: {
    readonly channelId: string;
    readonly citedRecordIds: readonly RecordId[];
    readonly commandId: string;
    readonly data: RecordBody;
    readonly supervisorId: string;
}): RecordBody {
    return snapshot({
        ...VERSION_FIELDS,
        channel_id: fields.channelId,
        cited_record_ids: fields.citedRecordIds,
        command_id: fields.commandId,
        data: fields.data,
        supervisor_id: fields.supervisorId,
    });
}

/** Validates a retained dispatch body. @internal */
export function readSupervisionDispatchBody(body: RecordBody): SupervisionDispatchBody {
    return decodeSupervisionEvidence("dispatch", () => {
        const fields = readVersionedBody(body, [
            "approval_timeout_milliseconds",
            "cited_record_ids",
            "command_id",
            "dispatch_id",
            "intent",
            "intent_ref",
            "interceptors",
        ]);
        assertScopeText(fields.command_id, "command_id");
        const intent = readEffectIntent(fields.intent as EffectIntent);
        const interceptors = readInterceptorDeclarations(fields.interceptors);
        assertBoundedMilliseconds(
            fields.approval_timeout_milliseconds,
            config.approval.maxWaitMilliseconds,
            "approval_timeout_milliseconds",
        );
        readSupervisionCitations(fields.cited_record_ids, "dispatch", false);
        if (
            fields.dispatch_id !== createSupervisedDispatchId(fields.command_id) ||
            fields.intent_ref !== createIntentReference(intent)
        ) {
            throw new TypeError("dispatch identity or intent reference is inconsistent");
        }
        return { ...fields, interceptors } as unknown as SupervisionDispatchBody;
    });
}

/** Validates a retained decision body. @internal */
export function readSupervisionDecisionBody(body: RecordBody): SupervisionDecisionBody {
    return decodeSupervisionEvidence("decision", () => {
        const fields = readVersionedBody(body, [
            "applied_policy",
            "decision",
            "dispatch_id",
            "intent_ref",
            "interceptor_id",
            "position",
            "reason",
            "replacement",
            "source",
        ]);
        assertScopeText(fields.dispatch_id, "dispatch_id");
        assertScopeText(fields.intent_ref, "intent_ref");
        assertScopeText(fields.interceptor_id, "interceptor_id");
        assertOrdinal(fields.position, "position", false);
        readSupervisionReason(fields.reason, true);
        const replacement =
            fields.replacement === null
                ? null
                : readEffectIntent(fields.replacement as EffectIntent);
        const interceptorDecided = fields.source === INTERCEPTOR_SOURCE;
        if (
            !includes(SUPERVISION_DECISIONS, fields.decision) ||
            !includes(SUPERVISION_DECISION_SOURCES, fields.source) ||
            (fields.applied_policy !== null &&
                !includes(SUPERVISION_TIMEOUT_POLICIES, fields.applied_policy)) ||
            interceptorDecided !== (fields.applied_policy === null) ||
            (fields.decision === REPLACE_DECISION) !== (replacement !== null) ||
            // Interceptors must explain every non-allow decision; timeouts and failures retain none.
            (fields.reason === null) !==
                (!interceptorDecided || fields.decision === SUPERVISION_DECISIONS[0])
        ) {
            throw new TypeError(
                "decision vocabulary, source, policy, or replacement is inconsistent",
            );
        }
        return fields as unknown as SupervisionDecisionBody;
    });
}

/** Validates a retained approval request or verdict body. @internal */
export function readSupervisionApprovalBody(
    body: RecordBody,
): SupervisionApprovalRequestBody | SupervisionApprovalVerdictBody {
    return decodeSupervisionEvidence("approval", () => {
        const phase = (body as { readonly phase?: unknown }).phase;
        if (phase === REQUESTED_PHASE) {
            const fields = readVersionedBody(body, [
                "dispatch_id",
                "gate",
                "intent_ref",
                "phase",
                "position",
                "reason",
            ]);
            assertScopeText(fields.dispatch_id, "dispatch_id");
            assertScopeText(fields.intent_ref, "intent_ref");
            readSupervisionReason(fields.reason, true);
            if (fields.position !== null) {
                assertOrdinal(fields.position, "position", false);
            }
            if (
                !includes(SUPERVISION_APPROVAL_GATES, fields.gate) ||
                (fields.gate === SUPERVISION_APPROVAL_GATES[0]) !== (fields.position !== null)
            ) {
                throw new TypeError("approval request gate and position are inconsistent");
            }
            return fields as unknown as SupervisionApprovalRequestBody;
        }
        const fields = readVersionedBody(body, [
            "approver_id",
            "command_id",
            "dispatch_id",
            "phase",
            "reason",
            "request_record_id",
            "verdict",
        ]);
        assertScopeText(fields.dispatch_id, "dispatch_id");
        assertRecordId(fields.request_record_id, "request_record_id");
        readSupervisionReason(fields.reason, true);
        const expired = fields.verdict === EXPIRED_VERDICT;
        if (!expired) {
            assertScopeText(fields.approver_id, "approver_id");
            assertScopeText(fields.command_id, "command_id");
        }
        if (
            phase !== RESOLVED_PHASE ||
            !includes(SUPERVISION_APPROVAL_VERDICTS, fields.verdict) ||
            (expired &&
                (fields.approver_id !== null ||
                    fields.command_id !== null ||
                    fields.reason !== null))
        ) {
            throw new TypeError(
                "approval verdict phase, vocabulary, or attribution is inconsistent",
            );
        }
        return fields as unknown as SupervisionApprovalVerdictBody;
    });
}

/** Validates a retained admission body. @internal */
export function readSupervisionAdmissionBody(body: RecordBody): SupervisionAdmissionBody {
    return decodeSupervisionEvidence("admission", () => {
        const fields = readVersionedBody(body, ["dispatch_id", "intent_ref"]);
        assertScopeText(fields.dispatch_id, "dispatch_id");
        assertScopeText(fields.intent_ref, "intent_ref");
        return fields as unknown as SupervisionAdmissionBody;
    });
}

/** Validates a retained resolution body against the dispatch's effective intent. @internal */
export function readSupervisionResolutionBody(
    body: RecordBody,
    effectiveIntent: EffectIntent,
): SupervisionResolutionBody {
    return decodeSupervisionEvidence("resolution", () => {
        const fields = readVersionedBody(body, [
            "dispatch_id",
            "disposition",
            "handler_id",
            "intent_ref",
            "outcome",
        ]);
        assertScopeText(fields.dispatch_id, "dispatch_id");
        assertScopeText(fields.intent_ref, "intent_ref");
        const materialized = fields.disposition === MATERIALIZED_DISPOSITION;
        if (materialized) {
            assertScopeText(fields.handler_id, "handler_id");
            validateEffectCorrelation(effectiveIntent, fields.outcome);
        }
        if (
            !includes(SUPERVISION_DISPOSITIONS, fields.disposition) ||
            (!materialized && (fields.handler_id !== null || fields.outcome !== null))
        ) {
            throw new TypeError("resolution disposition, handler, or outcome is inconsistent");
        }
        return fields as unknown as SupervisionResolutionBody;
    });
}

/** Validates a retained context injection body. @internal */
export function readSupervisionContextBody(body: RecordBody): SupervisionContextBody {
    return decodeSupervisionEvidence("context", () => {
        const fields = readVersionedBody(body, [
            "channel_id",
            "cited_record_ids",
            "command_id",
            "data",
            "supervisor_id",
        ]);
        assertPrefixedDigest(
            fields.channel_id,
            config.identity.contextChannelIdPrefix,
            "channel_id",
        );
        assertScopeText(fields.command_id, "command_id");
        assertScopeText(fields.supervisor_id, "supervisor_id");
        readSupervisionCitations(fields.cited_record_ids, "context", true);
        readSupervisionData(fields.data);
        return fields as unknown as SupervisionContextBody;
    });
}

/** Validates unique bounded record citations. @internal */
export function readSupervisionCitations(
    value: unknown,
    subject: string,
    required: boolean,
): readonly RecordId[] {
    const citations = readScopeArray(value, `${subject} citedRecordIds`).map((recordId, index) => {
        assertRecordId(recordId, `${subject} citedRecordIds[${index}]`);
        return recordId;
    });
    if (
        citations.length > config.limits.maxCitedRecords ||
        (required && citations.length === 0) ||
        new Set(citations).size !== citations.length
    ) {
        throw new TypeError(
            `${subject} citedRecordIds must be unique, bounded, and non-empty when required`,
        );
    }
    return Object.freeze(citations);
}

/** Validates an optional bounded retained reason. @internal */
export function readSupervisionReason(value: unknown, nullable: boolean): string | null {
    if (nullable && value === null) {
        return null;
    }
    assertScopeText(value, "reason");
    if (Buffer.byteLength(value, "utf8") > config.limits.maxReasonBytes) {
        throw new TypeError("reason exceeds the configured byte bound");
    }
    return value;
}

/** Validates one bounded canonical application-data object. @internal */
export function readSupervisionData(value: unknown): RecordBody {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError("data must be a canonical semantic record");
    }
    const data = snapshot(value as RecordBody);
    if (Buffer.byteLength(canonicalizeRecord(data)) > config.limits.maxDataCanonicalBytes) {
        throw new TypeError("data exceeds the configured canonical byte bound");
    }
    return data;
}

/** Validates a positive integer bounded by a configured maximum. @internal */
export function assertBoundedMilliseconds(value: unknown, maximum: number, subject: string): void {
    if (!Number.isSafeInteger(value) || (value as number) <= 0 || (value as number) > maximum) {
        throw new TypeError(`${subject} must be a positive integer within the configured bound`);
    }
}

/** Validates an owner ordinal, optionally allowing the position after the last ordinal. @internal */
export function assertOrdinal(value: unknown, subject: string, allowNext: boolean): void {
    const maximum = kernelProtocolConfig.append.lastOwnerOrdinal + (allowNext ? 1 : 0);
    if (
        !Number.isSafeInteger(value) ||
        (value as number) < kernelProtocolConfig.append.firstOwnerOrdinal ||
        (value as number) > maximum
    ) {
        throw new TypeError(`${subject} must be a configured owner ordinal`);
    }
}

/** Classifies any decoding failure as malformed supervision evidence. @internal */
export function decodeSupervisionEvidence<T>(subject: string, decode: () => T): T {
    try {
        return decode();
    } catch (error) {
        if (error instanceof SupervisionEvidenceError) {
            throw error;
        }
        throw new SupervisionEvidenceError(`${subject} evidence is malformed`, { cause: error });
    }
}

/** Compares text by code units for canonical ordering. @internal */
export function compareText(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

function readInterceptorDeclarations(value: unknown): readonly SupervisionInterceptorDeclaration[] {
    const declarations = readScopeArray(value, "interceptors").map((entry, index) => {
        const fields = readScopeDataObject(
            entry,
            ["interceptor_id", "priority", "timeout_milliseconds", "timeout_policy"],
            `interceptors[${index}]`,
        );
        assertScopeText(fields.interceptor_id, `interceptors[${index}].interceptor_id`);
        assertBoundedMilliseconds(
            fields.timeout_milliseconds,
            config.interception.maxTimeoutMilliseconds,
            `interceptors[${index}].timeout_milliseconds`,
        );
        if (
            !Number.isSafeInteger(fields.priority) ||
            !includes(SUPERVISION_TIMEOUT_POLICIES, fields.timeout_policy)
        ) {
            throw new TypeError(`interceptors[${index}] priority or policy is invalid`);
        }
        return Object.freeze(fields) as unknown as SupervisionInterceptorDeclaration;
    });
    if (
        declarations.length > config.interception.maxInterceptors ||
        new Set(declarations.map((entry) => entry.interceptor_id)).size !== declarations.length ||
        declarations.some(
            (entry, index) =>
                index > 0 &&
                compareDeclarations(
                    declarations[index - 1] as SupervisionInterceptorDeclaration,
                    entry,
                ) >= 0,
        )
    ) {
        throw new TypeError("interceptors must be bounded, unique, and canonically ordered");
    }
    return Object.freeze(declarations);
}

/** Orders interceptor declarations by priority, then identity. @internal */
export function compareDeclarations(
    left: { readonly interceptor_id: string; readonly priority: number },
    right: { readonly interceptor_id: string; readonly priority: number },
): number {
    return left.priority - right.priority || compareText(left.interceptor_id, right.interceptor_id);
}

function readVersionedBody(body: RecordBody, keys: readonly string[]): Record<string, unknown> {
    const fields = readScopeDataObject(
        body,
        ["compatibility_version", "supervision_version", ...keys],
        "supervision record",
    );
    if (
        fields.compatibility_version !== config.compatibilityVersion ||
        fields.supervision_version !== config.recordVersion
    ) {
        throw new TypeError("supervision compatibility or record version is unsupported");
    }
    return fields;
}

function includes(values: readonly string[], value: unknown): boolean {
    return values.includes(value as string);
}

function snapshot(value: object): RecordBody {
    return createCanonicalSnapshot(value as RecordBody);
}

function digestHex(recordId: string): string {
    return recordId.slice(recordId.indexOf(":") + 1);
}
