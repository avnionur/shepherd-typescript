import { scopeProtocolConfig } from "../protocol/config.ts";
import {
    SCOPE_CHECKPOINT_EVIDENCE_STATUSES,
    SCOPE_CHECKPOINT_START_CLASSIFICATIONS,
} from "../protocol/values.generated.ts";
import { readScopeCheckpoint } from "./records.ts";
import type {
    ScopeCheckpoint,
    ScopeCheckpointClassification,
    ScopeCheckpointStartClassification,
} from "./types.ts";

const [VERIFIED_STATUS, RECONSTRUCTIVE_STATUS, NOT_APPLICABLE_STATUS] =
    SCOPE_CHECKPOINT_EVIDENCE_STATUSES;
const [, , RECONSTRUCTED_START] = SCOPE_CHECKPOINT_START_CLASSIFICATIONS;

/**
 * Proves from retained checkpoint evidence how a branch started and what it can restore.
 *
 * Any reconstructive constituent classifies the start as reconstructed. Otherwise the configured
 * start classification of the carrier capture kind applies: the reference copy carrier's quiescent
 * verified copy is never reported as an atomic snapshot. Every constituent is listed under its
 * evidence status, and the branch is restorable only when no applicable constituent is
 * reconstructive or unavailable. Identifiers and timestamps alone are never treated as proof.
 *
 * @param checkpoint - Checkpoint descriptor retained by a completed scope fork.
 * @returns Frozen classification.
 * @throws {TypeError} If the checkpoint is malformed or its capture kind has no configured
 * start classification.
 *
 * @example
 * ```ts
 * const fork = await forkScope(store, options);
 * const { start, restorable } = classifyScopeCheckpoint(fork.world.checkpoint);
 * ```
 *
 * @public
 */
export function classifyScopeCheckpoint(
    checkpoint: ScopeCheckpoint,
): ScopeCheckpointClassification {
    const validated = readScopeCheckpoint(checkpoint);
    const kinds = (status: string) =>
        Object.freeze(
            validated.constituents
                .filter((constituent) => constituent.status === status)
                .map((constituent) => constituent.kind),
        );
    const reconstructive = kinds(RECONSTRUCTIVE_STATUS);
    const unavailable = Object.freeze(
        validated.constituents.flatMap((constituent) =>
            "reason" in constituent
                ? [Object.freeze({ kind: constituent.kind, reason: constituent.reason })]
                : [],
        ),
    );
    const captureStart = scopeProtocolConfig.checkpoint.startClassifications.captureKinds[
        validated.capture_kind
    ] as ScopeCheckpointStartClassification | undefined;
    // The checkpoint reader accepts only the configured carrier capture kind, which is mapped.
    /* node:coverage ignore next 3 */
    if (captureStart === undefined) {
        throw new TypeError("scope checkpoint capture kind has no configured start classification");
    }
    return Object.freeze({
        not_applicable: kinds(NOT_APPLICABLE_STATUS),
        reconstructive,
        restorable: reconstructive.length === 0 && unavailable.length === 0,
        start: reconstructive.length > 0 ? RECONSTRUCTED_START : captureStart,
        unavailable,
        verified: kinds(VERIFIED_STATUS),
    });
}
