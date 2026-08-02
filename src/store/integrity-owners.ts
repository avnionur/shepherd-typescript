import type { DatabaseSync } from "node:sqlite";

import { kernelProtocolConfig } from "../protocol/config.ts";
import { STORE_TABLES } from "./constants.ts";
import { addIntegrityIssue } from "./integrity-issues.ts";
import type { TraceIntegrityIssue } from "./integrity-types.ts";

/** Verifies owner-path contiguity and persisted next ordinals. */
export function verifyOwnerOrdinalIntegrity(
    database: DatabaseSync,
    issues: TraceIntegrityIssue[],
): number {
    const nextOrdinalByOwner = new Map(
        database
            .prepare(
                `SELECT owner_id, next_ordinal FROM ${STORE_TABLES.ownerOrdinals}
                 ORDER BY owner_id`,
            )
            .all()
            .map((row) => [String(row.owner_id), Number(row.next_ordinal)] as const),
    );
    const ordinalsByOwner = new Map<string, number[]>();
    for (const row of database
        .prepare(
            `SELECT owner_id, owner_ordinal FROM ${STORE_TABLES.recordViews}
             ORDER BY owner_id, owner_ordinal`,
        )
        .all()) {
        const ownerId = String(row.owner_id);
        const ordinals = ordinalsByOwner.get(ownerId) ?? [];
        ordinals.push(Number(row.owner_ordinal));
        ordinalsByOwner.set(ownerId, ordinals);
    }
    const ownerIds = [...new Set([...nextOrdinalByOwner.keys(), ...ordinalsByOwner.keys()])].sort();
    for (const ownerId of ownerIds) {
        const ordinals = ordinalsByOwner.get(ownerId) ?? [];
        const contiguous = ordinals.every(
            (ordinal, index) => ordinal === kernelProtocolConfig.append.firstOwnerOrdinal + index,
        );
        const expectedNext = kernelProtocolConfig.append.firstOwnerOrdinal + ordinals.length;
        if (
            ordinals.length === 0 ||
            !contiguous ||
            nextOrdinalByOwner.get(ownerId) !== expectedNext
        ) {
            addIntegrityIssue(issues, "owner_ordinal_mismatch", ownerId);
        }
    }
    return ownerIds.length;
}

/** Returns owner occurrences whose append-intent row is absent. */
export function readOrphanedAppendIntentIds(database: DatabaseSync): string[] {
    return database
        .prepare(
            `SELECT append_intent_id FROM (
                SELECT v.append_intent_id
                FROM ${STORE_TABLES.recordViews} v
                LEFT JOIN ${STORE_TABLES.appendIntents} i
                    ON i.append_intent_id = v.append_intent_id
                WHERE i.append_intent_id IS NULL
                UNION
                SELECT c.append_intent_id
                FROM ${STORE_TABLES.cuts} c
                LEFT JOIN ${STORE_TABLES.appendIntents} i
                    ON i.append_intent_id = c.append_intent_id
                WHERE i.append_intent_id IS NULL
             ) ORDER BY append_intent_id`,
        )
        .all()
        .map((row) => String(row.append_intent_id));
}
