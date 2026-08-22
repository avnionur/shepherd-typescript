import type { RETAINED_WORLD_APPLICATION_CONFLICT_KINDS } from "../protocol/values.generated.ts";

/** One configured retained-world application conflict classification. */
export type RetainedWorldApplicationConflictKind =
    (typeof RETAINED_WORLD_APPLICATION_CONFLICT_KINDS)[number];

/** One exact candidate/current path pair that prevents three-way application. */
export type RetainedWorldApplicationConflict = {
    /** Candidate changed path from the retained output. */
    readonly candidate_path: string;
    /** Current-user changed path since the retained base. */
    readonly current_path: string;
    /** Configured overlap classification. */
    readonly kind: RetainedWorldApplicationConflictKind;
};

/** Immutable content-addressed evidence explaining one fail-closed application refusal. */
export type RetainedWorldApplicationConflictEvidence = {
    /** Compatibility namespace governing application evidence. */
    readonly compatibility_version: string;
    /** Canonical bounded conflict pairs. */
    readonly conflicts: readonly RetainedWorldApplicationConflict[];
    /** Content-addressed identity of the complete refusal evidence. */
    readonly conflict_id: string;
    /** Public conflict-evidence protocol version. */
    readonly conflict_version: number;
};

/** Closed options accepted by {@link inspectRetainedWorldApplicationConflicts}. */
export type InspectRetainedWorldApplicationConflictsOptions = {
    /** Canonical candidate paths changed relative to the retained base. */
    readonly candidatePaths: readonly string[];
    /** Canonical current-user paths changed relative to the same retained base. */
    readonly currentPaths: readonly string[];
};
