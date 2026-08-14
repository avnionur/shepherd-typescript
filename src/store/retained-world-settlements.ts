import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { canonicalizeRecord, type SemanticRecord } from "../canonical/canonical-record.ts";
import { workspaceProtocolConfig } from "../protocol/config.ts";
import {
    RETAINED_WORLD_SETTLEMENT_ACTIONS,
    RETAINED_WORLD_SETTLEMENT_STATES,
} from "../protocol/values.generated.ts";
import { assertNonEmptyString } from "../record/guards.ts";
import { STORE_TABLES, STORE_TRANSACTION_SQL } from "./constants.ts";
import {
    RetainedWorldSettlementConflictError,
    RetainedWorldSettlementInvalidError,
} from "./errors.ts";
import type { RetainedWorldSettlementAdmission, RetainedWorldSettlementRequest } from "./types.ts";

type SettlementRow = {
    readonly action: string;
    readonly command_id: string;
    readonly output_id: string;
    readonly request_digest: string;
    readonly request_id: string;
    readonly request_json: string;
    readonly state: string;
};

const [PREPARED_STATE] = RETAINED_WORLD_SETTLEMENT_STATES;

/** Atomically admits or identically replays one exact retained-world settlement request. */
export function admitRetainedWorldSettlement(
    database: DatabaseSync,
    request: RetainedWorldSettlementRequest,
): RetainedWorldSettlementAdmission {
    const retainedRequest = readRequest(request);
    const requestJson = canonicalizeRecord(retainedRequest as unknown as SemanticRecord);
    const requestDigest = createHash(workspaceProtocolConfig.digestAlgorithm)
        .update(requestJson)
        .digest("hex");
    const requestId = `${workspaceProtocolConfig.settlement.requestIdPrefix}${requestDigest}`;
    database.exec(STORE_TRANSACTION_SQL.begin);
    try {
        const rows = database
            .prepare(
                `SELECT output_id, command_id, request_id, request_digest, request_json, action, state
                 FROM ${STORE_TABLES.retainedWorldSettlements}
                 WHERE output_id = ? OR command_id = ?`,
            )
            .all(
                retainedRequest.output_id,
                retainedRequest.command_id,
            ) as unknown as SettlementRow[];
        if (rows.length > 0) {
            const row = rows[0] as SettlementRow;
            if (
                rows.length !== 1 ||
                !rowMatchesRequest(row, requestId, requestDigest, requestJson)
            ) {
                throw new RetainedWorldSettlementConflictError(
                    workspaceProtocolConfig.settlement.errors.conflictMessage,
                );
            }
            const replay = admissionFromRow(row, retainedRequest);
            database.exec(STORE_TRANSACTION_SQL.commit);
            return replay;
        }
        database
            .prepare(
                `INSERT INTO ${STORE_TABLES.retainedWorldSettlements}(
                    output_id, command_id, request_id, request_digest, request_json, action, state
                 ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
                retainedRequest.output_id,
                retainedRequest.command_id,
                requestId,
                requestDigest,
                requestJson,
                retainedRequest.action,
                PREPARED_STATE,
            );
        const admission = freezeAdmission(retainedRequest, requestId);
        database.exec(STORE_TRANSACTION_SQL.commit);
        return admission;
    } catch (error) {
        database.exec(STORE_TRANSACTION_SQL.rollback);
        throw error;
    }
}

/** Reads one exact retained-world settlement admission by output identity. */
export function readRetainedWorldSettlement(
    database: DatabaseSync,
    outputId: string,
): RetainedWorldSettlementAdmission | undefined {
    assertNonEmptyString(outputId, "outputId");
    const row = database
        .prepare(
            `SELECT output_id, command_id, request_id, request_digest, request_json, action, state
             FROM ${STORE_TABLES.retainedWorldSettlements} WHERE output_id = ?`,
        )
        .get(outputId) as SettlementRow | undefined;
    if (row === undefined) return undefined;
    let value: unknown;
    try {
        value = JSON.parse(row.request_json);
    } catch (error) {
        throw new RetainedWorldSettlementInvalidError(
            workspaceProtocolConfig.settlement.errors.invalidMessage,
            {
                cause: error,
            },
        );
    }
    return admissionFromRow(row, readRequest(value));
}

function readRequest(value: unknown): RetainedWorldSettlementRequest {
    if (
        value === null ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    ) {
        throw new TypeError("retained world settlement request must be exact data");
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const ownKeys = Reflect.ownKeys(descriptors);
    const expectedKeys = [
        "action",
        "base_revision_id",
        "binding_id",
        "capture_record_id",
        "changeset_id",
        "command_id",
        "custody_id",
        "execution_cut_id",
        "head_revision_id",
        "output_id",
        "run_id",
        "settlement_version",
        "user_basis_before",
    ];
    if (
        ownKeys.some((key) => typeof key !== "string") ||
        ownKeys.length !== expectedKeys.length ||
        (ownKeys as string[]).sort().some((key, index) => key !== expectedKeys[index]) ||
        (ownKeys as string[]).some((key) => !("value" in (descriptors[key] as PropertyDescriptor)))
    ) {
        throw new TypeError("retained world settlement request must be exact data");
    }
    const request = Object.fromEntries(
        expectedKeys.map((key) => [key, (descriptors[key] as PropertyDescriptor).value]),
    ) as Partial<RetainedWorldSettlementRequest>;
    if (request.settlement_version !== workspaceProtocolConfig.settlement.version) {
        throw new TypeError("retained world settlement version is unsupported");
    }
    if (!RETAINED_WORLD_SETTLEMENT_ACTIONS.includes(request.action as never)) {
        throw new TypeError("retained world settlement action is unsupported");
    }
    const fields = [
        "base_revision_id",
        "binding_id",
        "capture_record_id",
        "changeset_id",
        "command_id",
        "custody_id",
        "execution_cut_id",
        "head_revision_id",
        "output_id",
        "run_id",
        "user_basis_before",
    ] as const;
    for (const field of fields) assertNonEmptyString(request[field], field);
    return Object.freeze({
        action: request.action as RetainedWorldSettlementRequest["action"],
        base_revision_id: request.base_revision_id as string,
        binding_id: request.binding_id as string,
        capture_record_id: request.capture_record_id as string,
        changeset_id: request.changeset_id as string,
        command_id: request.command_id as string,
        custody_id: request.custody_id as string,
        execution_cut_id: request.execution_cut_id as string,
        head_revision_id: request.head_revision_id as string,
        output_id: request.output_id as string,
        run_id: request.run_id as string,
        settlement_version: request.settlement_version,
        user_basis_before: request.user_basis_before as string,
    });
}

function admissionFromRow(
    row: SettlementRow,
    request: RetainedWorldSettlementRequest,
): RetainedWorldSettlementAdmission {
    const requestJson = canonicalizeRecord(request as unknown as SemanticRecord);
    const digest = createHash(workspaceProtocolConfig.digestAlgorithm)
        .update(requestJson)
        .digest("hex");
    const expectedRequestId = `${workspaceProtocolConfig.settlement.requestIdPrefix}${digest}`;
    const expectedRow = {
        action: request.action,
        command_id: request.command_id,
        output_id: request.output_id,
        request_digest: digest,
        request_id: expectedRequestId,
        request_json: requestJson,
        state: PREPARED_STATE,
    };
    if (canonicalizeRecord(row) !== canonicalizeRecord(expectedRow)) {
        throw new RetainedWorldSettlementInvalidError(
            workspaceProtocolConfig.settlement.errors.invalidMessage,
        );
    }
    return freezeAdmission(request, expectedRequestId);
}

function rowMatchesRequest(
    row: SettlementRow,
    requestId: string,
    requestDigest: string,
    requestJson: string,
): boolean {
    return (
        canonicalizeRecord({
            request_digest: row.request_digest,
            request_id: row.request_id,
            request_json: row.request_json,
        }) ===
        canonicalizeRecord({
            request_digest: requestDigest,
            request_id: requestId,
            request_json: requestJson,
        })
    );
}

function freezeAdmission(
    request: RetainedWorldSettlementRequest,
    requestId: string,
): RetainedWorldSettlementAdmission {
    return Object.freeze({
        action: request.action,
        command_id: request.command_id,
        output_id: request.output_id,
        request,
        request_id: requestId,
        state: PREPARED_STATE,
    });
}
