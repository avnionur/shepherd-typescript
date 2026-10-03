import { canonicalizeSemanticValue, type SemanticRecord } from "../canonical/canonical-record.ts";
import { createCanonicalSnapshot } from "../canonical/snapshot.ts";
import { replayProtocolConfig } from "../protocol/config.ts";
import { readReplayCheckpointPolicy } from "../protocol/config-replay.ts";
import { RECORD_MODES, REPLAY_MODES } from "../protocol/values.generated.ts";
import { ROOT_WITNESS_ID } from "../record/root-witness.ts";
import type { RecordBody, RecordId } from "../record/types.ts";
import { assertScopeText, readScopeDataObject } from "../scope/validation.ts";
import { AppendIntentConflictError } from "../store/errors.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import { ReplayCompatibilityError, ReplayEvidenceError } from "./errors.ts";
import {
    createReplayAppendIntentId,
    createReplaySessionId,
    readReplaySessionBody,
} from "./records.ts";

const config = replayProtocolConfig.branch.request;
const [, DECLARATION_MODE] = RECORD_MODES;
const [ROOT_MODE, REWIND_MODE] = REPLAY_MODES;

/** Immutable request identity and normalized semantic data retained before branch effects. */
export type ReplayBranchRequestInspection = {
    /** Content-addressed identity of the normalized request record. */
    readonly record_id: RecordId;
    /** Versioned normalized request; session data binds mode, source, target, changes and task. */
    readonly request: SemanticRecord;
};

/**
 * Inspects the normalized request for one branch command, including attempts that failed before
 * a session opened. This is read-only and works after reopening or importing a trace.
 * @param store - Open trace store.
 * @param commandId - Exact branch command identity.
 * @returns Validated immutable request evidence, or null for an absent or legacy request.
 * @throws {ReplayCompatibilityError} If the request journal version is unsupported.
 * @throws {ReplayEvidenceError} If retained request evidence is inconsistent.
 * @throws {TypeError} If the command identity is malformed.
 * @throws {TraceStoreError} If the store is closed or cannot read.
 */
export function inspectReplayBranchRequest(
    store: SQLiteTraceStore,
    commandId: string,
): ReplayBranchRequestInspection | null {
    assertScopeText(commandId, "commandId");
    const owner = createReplaySessionId(commandId) + config.ownerSuffix;
    const records = store.readOwner(owner);
    const [record] = records;
    if (record === undefined) return null;
    let request: SemanticRecord;
    try {
        request = readRequest(record.body);
    } catch (error) {
        if (error instanceof ReplayCompatibilityError || error instanceof ReplayEvidenceError)
            throw error;
        throw new ReplayEvidenceError("branch request body is malformed", { cause: error });
    }
    const session = readReplaySessionBody(request.session as RecordBody);
    if (
        records.length !== 1 ||
        record.envelope.schema_ref !== config.schemaRef ||
        record.envelope.mode !== DECLARATION_MODE ||
        record.envelope.witness_ref !== ROOT_WITNESS_ID ||
        session.command_id !== commandId ||
        canonicalizeSemanticValue(record.envelope.caused_by_record_ids) !==
            canonicalizeSemanticValue([session.origin?.source_session_record_id as string])
    ) {
        throw new ReplayEvidenceError("branch request identity or provenance is inconsistent");
    }
    return Object.freeze({ record_id: record.envelope.record_id, request });
}

/** Builds normalized request data from an already validated session declaration. @internal */
export function createReplayBranchRequest(
    session: RecordBody,
    sourceDisposition: string,
    checkpointPolicy: SemanticRecord | null,
): SemanticRecord {
    return readRequest({
        checkpoint_policy: checkpointPolicy,
        compatibility_version: config.compatibilityVersion,
        request_version: config.recordVersion,
        session,
        source_disposition: sourceDisposition,
    });
}

/** Compares an existing request without writing, before receipt replay or physical validation. @internal */
export function assertReplayBranchRequest(
    store: SQLiteTraceStore,
    commandId: string,
    request: SemanticRecord,
): boolean {
    const retained = inspectReplayBranchRequest(store, commandId);
    if (retained === null) return false;
    if (canonicalizeSemanticValue(retained.request) !== canonicalizeSemanticValue(request)) {
        throw new AppendIntentConflictError(
            createReplayAppendIntentId(commandId, config.appendIntentKind),
        );
    }
    return true;
}

/** Atomically binds a command to its normalized request before any effect can run. @internal */
export function retainReplayBranchRequest(
    store: SQLiteTraceStore,
    commandId: string,
    request: SemanticRecord,
): RecordId {
    const session = readReplaySessionBody(request.session as RecordBody);
    const owner = createReplaySessionId(commandId) + config.ownerSuffix;
    const receipt = store.appendReplayBranchRequest(session.session_id, {
        append_intent_id: createReplayAppendIntentId(commandId, config.appendIntentKind),
        batch: {
            groups: [
                {
                    owner_id: owner,
                    records: [
                        {
                            body: request,
                            caused_by_record_ids: [
                                session.origin?.source_session_record_id as string,
                            ],
                            mode: DECLARATION_MODE,
                            schema_ref: config.schemaRef,
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    });
    return receipt.record_ids[0] as RecordId;
}

function readRequest(value: unknown): SemanticRecord {
    const fields = readScopeDataObject(
        value,
        [
            "checkpoint_policy",
            "compatibility_version",
            "request_version",
            "session",
            "source_disposition",
        ],
        "branch request",
    );
    if (
        fields.compatibility_version !== config.compatibilityVersion ||
        fields.request_version !== config.recordVersion
    ) {
        throw new ReplayCompatibilityError(fields.compatibility_version, fields.request_version);
    }
    const session = readReplaySessionBody(fields.session as RecordBody);
    if (session.mode === ROOT_MODE || session.origin === null)
        throw new ReplayEvidenceError("branch request must name a branch session");
    if (
        typeof fields.source_disposition !== "string" ||
        !replayProtocolConfig.branch.sourceDispositions.includes(fields.source_disposition)
    ) {
        throw new TypeError("sourceDisposition must be a configured replay source disposition");
    }
    if (session.mode === REWIND_MODE) {
        if (fields.checkpoint_policy !== null)
            throw new TypeError("rewind request cannot declare a checkpoint policy");
    } else {
        const policy = readScopeDataObject(
            fields.checkpoint_policy,
            ["interval", "kind"],
            "checkpoint_policy",
        );
        readReplayCheckpointPolicy(
            policy.interval === null ? { kind: policy.kind } : policy,
            replayProtocolConfig.checkpoint.automatic.policies,
            replayProtocolConfig.limits.maxSteps,
            "checkpoint_policy",
        );
    }
    return createCanonicalSnapshot(fields as SemanticRecord) as SemanticRecord;
}
