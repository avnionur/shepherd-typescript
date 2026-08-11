import type {
    RUN_LIFECYCLE_STATUSES,
    RUN_TERMINAL_STATUSES,
} from "../protocol/values.generated.ts";

/** Configured normative run-lifecycle status. */
export type RunLifecycleStatus = (typeof RUN_LIFECYCLE_STATUSES)[number];

/** Configured immutable terminal outcome status. */
export type RunLifecycleTerminalStatus = (typeof RUN_TERMINAL_STATUSES)[number];

/** Requested pure normative run-lifecycle transition. */
export type RunLifecycleTransitionDefinition = {
    /** Current authoritative lifecycle status. */
    readonly source_status: RunLifecycleStatus;
    /** Requested next lifecycle status. */
    readonly target_status: RunLifecycleStatus;
    /** Terminal outcome required only when the target is terminal. */
    readonly terminal_status?: RunLifecycleTerminalStatus;
};

/** Validated immutable normative run-lifecycle transition. */
export type RunLifecycleTransition = {
    /** Current authoritative lifecycle status. */
    readonly source_status: RunLifecycleStatus;
    /** Requested next lifecycle status. */
    readonly target_status: RunLifecycleStatus;
    /** Terminal outcome when the transition enters the terminal lifecycle. */
    readonly terminal_status?: RunLifecycleTerminalStatus;
};
