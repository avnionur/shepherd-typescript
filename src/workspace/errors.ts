import { workspaceProtocolConfig } from "../protocol/config.ts";

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
