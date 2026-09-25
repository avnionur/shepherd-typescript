import { workspaceProtocolConfig } from "../protocol/config.ts";
import type { RetainedWorldApplicationConflictEvidence } from "./retained-world-application-types.ts";

/** Raised when workspace control state is missing, unsafe, malformed, or inconsistent. */
export class WorkspaceControlError extends Error {
    /** Stable machine-readable workspace-control error code. */
    readonly code = workspaceProtocolConfig.errors.controlCode;

    /**
     * Creates a workspace-control validation failure.
     *
     * @param message - Diagnostic describing the rejected control state.
     */
    constructor(message = workspaceProtocolConfig.errors.controlMessage) {
        super(message);
        this.name = "WorkspaceControlError";
    }
}

/** Raised when repeated initialization requests different retained control options. */
export class WorkspaceInitializationConflictError extends Error {
    /** Stable machine-readable initialization-conflict error code. */
    readonly code = workspaceProtocolConfig.errors.conflictCode;

    /**
     * Creates a conflicting workspace-initialization failure.
     *
     * @param message - Diagnostic describing the conflicting option.
     */
    constructor(message = workspaceProtocolConfig.errors.conflictMessage) {
        super(message);
        this.name = "WorkspaceInitializationConflictError";
    }
}

/** Raised when a proposed workspace binding cannot establish unambiguous canonical authority. */
export class WorkspaceBindingError extends Error {
    /** Stable machine-readable binding-validation error code. */
    readonly code: string;

    /**
     * Creates a workspace-binding validation failure.
     *
     * @param code - Configured machine-readable failure code.
     * @param message - Configured diagnostic for the rejected binding set.
     */
    constructor(code: string, message: string) {
        super(message);
        this.code = code;
        this.name = "WorkspaceBindingError";
    }
}

/** Raised when copy-carrier custody or its retained evidence is unavailable or invalid. */
export class WorldCarrierError extends Error {
    /** Stable machine-readable carrier failure code. */
    readonly code: string;

    /**
     * Creates a reference copy-carrier failure.
     *
     * @param code - Configured machine-readable failure code.
     * @param message - Diagnostic describing the rejected operation or evidence.
     */
    constructor(code: string, message: string) {
        super(message);
        this.code = code;
        this.name = "WorldCarrierError";
    }
}

/** Raised when a device-layer world, checkpoint, path, or adapter refuses an operation. */
export class DeviceLayerError extends Error {
    /** Stable machine-readable device-layer failure code. */
    readonly code: string;

    /**
     * Creates a device-layer failure.
     *
     * @param code - Configured machine-readable failure code.
     * @param message - Diagnostic describing the rejected operation.
     * @param options - Optional underlying cause.
     */
    constructor(code: string, message: string, options?: ErrorOptions) {
        super(message, options);
        this.code = code;
        this.name = "DeviceLayerError";
    }
}

/** Raised when Git-aware baseline or retained-output custody is unavailable or inconsistent. */
export class GitCustodyError extends Error {
    /** Stable machine-readable Git-custody failure code. */
    readonly code: string;

    /**
     * Creates a Git-aware custody failure.
     *
     * @param code - Configured machine-readable failure code.
     * @param message - Diagnostic describing the rejected Git state or custody evidence.
     */
    constructor(code: string, message: string) {
        super(message);
        this.code = code;
        this.name = "GitCustodyError";
    }
}

/** Raised when a pure world changeset cannot be constructed safely and exactly. */
export class WorldChangesetError extends Error {
    /** Stable machine-readable changeset failure code. */
    readonly code: string;

    /**
     * Creates a world-changeset validation failure.
     *
     * @param code - Configured machine-readable failure code.
     * @param message - Diagnostic describing the rejected comparison.
     */
    constructor(code: string, message: string) {
        super(message);
        this.code = code;
        this.name = "WorldChangesetError";
    }
}

/** Raised when retained and current path effects are not provably disjoint. */
export class RetainedWorldApplicationConflictError extends Error {
    /** Stable machine-readable application-conflict code. */
    readonly code = workspaceProtocolConfig.settlement.application.errors.conflictCode;
    /** Exact immutable path-overlap evidence. */
    readonly evidence: RetainedWorldApplicationConflictEvidence;

    /**
     * Creates one fail-closed retained-world application conflict.
     *
     * @param evidence - Exact content-addressed overlap evidence.
     */
    constructor(evidence: RetainedWorldApplicationConflictEvidence) {
        super(workspaceProtocolConfig.settlement.application.errors.conflictMessage);
        this.name = "RetainedWorldApplicationConflictError";
        this.evidence = evidence;
    }
}
