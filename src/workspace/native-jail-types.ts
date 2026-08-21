import type {
    NATIVE_JAIL_BACKENDS,
    NATIVE_JAIL_PLACEMENT_REASONS,
    NATIVE_JAIL_PROBE_REASONS,
    NATIVE_JAIL_PROBE_STATUSES,
    NATIVE_JAIL_PROCESS_STATUSES,
    NATIVE_JAIL_QUIESCENCE_STATUSES,
} from "../protocol/values.generated.ts";
import type { TaskSchema } from "../task/schema.ts";
import type {
    PlacementEnvironment,
    PlacementPlatformEvidence,
    PlacementPlatformFamily,
} from "./placement-types.ts";
import type { GitRepositoryGrantPlan } from "./repository-grant-types.ts";
import type {
    RetainedWorldEnforcement,
    RetainedWorldRunner,
} from "./retained-world-runner-types.ts";

/** One configured native syscall-jail backend name. */
export type NativeJailBackendName = (typeof NATIVE_JAIL_BACKENDS)[number];

/** One configured native-jail probe reason. */
export type NativeJailProbeReason = (typeof NATIVE_JAIL_PROBE_REASONS)[number];

/** One configured native-jail probe status. */
export type NativeJailProbeStatus = (typeof NATIVE_JAIL_PROBE_STATUSES)[number];

/** One configured successful native-jail placement reason. */
export type NativeJailPlacementReason = (typeof NATIVE_JAIL_PLACEMENT_REASONS)[number];

/** One configured native judged-process terminal status. */
export type NativeJailProcessStatus = (typeof NATIVE_JAIL_PROCESS_STATUSES)[number];

/** One configured process-group quiescence classification. */
export type NativeJailQuiescenceStatus = (typeof NATIVE_JAIL_QUIESCENCE_STATUSES)[number];

/** Immutable configured descriptor for one native syscall-jail backend. */
export type NativeJailBackendDescriptor = {
    /** Content-addressed identity of the complete backend descriptor. */
    readonly backend_id: string;
    /** Public backend-descriptor protocol version. */
    readonly backend_version: number;
    /** Compatibility namespace governing native-jail evidence. */
    readonly compatibility_version: string;
    /** Execution environments on which the backend may be probed. */
    readonly environments: readonly PlacementEnvironment[];
    /** Actual native enforcement classification. */
    readonly enforcement: RetainedWorldEnforcement;
    /** Absolute launcher executable, or `null` for a package helper. */
    readonly executable: string | null;
    /** Classified platform family governed by the backend. */
    readonly family: PlacementPlatformFamily;
    /** Node platform spellings on which the backend may be probed. */
    readonly node_platforms: readonly string[];
    /** Stable configured backend name. */
    readonly name: NativeJailBackendName;
    /** Structured profile argument, or `null` for a package helper. */
    readonly profile_argument: string | null;
};

/** Immutable result of one real local native-jail capability probe. */
export type NativeJailBackendProbeEvidence = {
    /** Exact configured backend descriptor, or `null` on unsupported platforms. */
    readonly backend: NativeJailBackendDescriptor | null;
    /** Compatibility namespace governing native-jail evidence. */
    readonly compatibility_version: string;
    /** Whether the native boundary denied the ungranted canary write. */
    readonly denied_write: boolean;
    /** Actual native enforcement classification. */
    readonly enforcement: RetainedWorldEnforcement;
    /** Whether the native boundary allowed the granted canary write. */
    readonly granted_write: boolean;
    /** Digest of the exact package helper executable, or `null` for host launchers. */
    readonly helper_digest: string | null;
    /** Exact authenticated local platform evidence used for backend selection. */
    readonly platform: PlacementPlatformEvidence;
    /** Content-addressed identity of the complete probe evidence. */
    readonly probe_id: string;
    /** Configured reason explaining the probe result. */
    readonly reason: NativeJailProbeReason;
    /** Configured available/unavailable probe status. */
    readonly status: NativeJailProbeStatus;
    /** Public backend-probe protocol version. */
    readonly probe_version: number;
};

/** One explicit environment entry supplied to a native jailed command. */
export type NativeJailEnvironmentEntry = {
    /** Exact environment variable name. */
    readonly name: string;
    /** Exact environment variable value. */
    readonly value: string;
};

/** Closed structured command definition accepted by {@link createNativeJailRunner}. */
export type NativeJailCommandDefinition = {
    /** Literal ordered arguments passed without shell interpretation. */
    readonly arguments: readonly string[];
    /** Explicit environment supplied without inheriting ambient process variables. */
    readonly environment: readonly NativeJailEnvironmentEntry[];
    /** Absolute executable path invoked as the judged process. */
    readonly executable: string;
};

/** Immutable content-addressed native jailed command descriptor. */
export type NativeJailCommand = {
    /** Literal ordered arguments passed without shell interpretation. */
    readonly arguments: readonly string[];
    /** Content-addressed identity of the complete command descriptor. */
    readonly command_id: string;
    /** Public structured command protocol version. */
    readonly command_version: number;
    /** Explicit environment supplied without ambient inheritance. */
    readonly environment: readonly NativeJailEnvironmentEntry[];
    /** Canonical absolute executable path invoked as the judged process. */
    readonly executable: string;
};

/** Closed definition accepted by {@link createNativeJailRunner}. */
export type NativeJailRunnerDefinition = {
    /** Structured shell-free judged-process command. */
    readonly command: NativeJailCommandDefinition;
    /** Maximum captured bytes accepted from each output stream. */
    readonly maxOutputBytes: number;
    /** Authenticated successful local backend probe. */
    readonly probe: NativeJailBackendProbeEvidence;
    /** Stable caller-assigned runner identity. */
    readonly runnerId: string;
    /** Maximum process duration before fail-closed termination. */
    readonly timeoutMilliseconds: number;
};

/** Opaque authenticated native-jail runner handle. */
export type NativeJailRunner<
    I extends TaskSchema<unknown> = TaskSchema<unknown>,
    O extends TaskSchema<unknown> = TaskSchema<unknown>,
> = RetainedWorldRunner<I, O>;

/** Closed options accepted by {@link createNativeJailPlacementResolution}. */
export type NativeJailPlacementResolutionOptions<
    I extends TaskSchema<unknown>,
    O extends TaskSchema<unknown>,
> = {
    /** Exact durable capture identity governed by the resolution. */
    readonly captureId: string;
    /** Explicit jail or auto placement request. */
    readonly placement: "auto" | "jail";
    /** Exact authenticated local platform evidence. */
    readonly platform: PlacementPlatformEvidence;
    /** Authenticated repository grant plan governed by native enforcement. */
    readonly repositoryGrantPlan: GitRepositoryGrantPlan;
    /** Exact durable run identity governed by the resolution. */
    readonly runId: string;
    /** Authenticated native-jail runner and structured command. */
    readonly runner: NativeJailRunner<I, O>;
};

/** Immutable content-addressed native-jail placement resolution. */
export type NativeJailPlacementResolution = {
    /** Exact configured backend descriptor. */
    readonly backend: NativeJailBackendDescriptor;
    /** Successful authenticated backend probe authorizing this resolution. */
    readonly backend_probe: NativeJailBackendProbeEvidence;
    /** Exact durable capture identity governed by the resolution. */
    readonly capture_id: string;
    /** Exact structured judged-process command. */
    readonly command: NativeJailCommand;
    /** Compatibility namespace governing native-jail evidence. */
    readonly compatibility_version: string;
    /** Actual native enforcement classification. */
    readonly enforcement: RetainedWorldEnforcement;
    /** Public native-jail placement-resolution protocol version. */
    readonly placement_version: number;
    /** Maximum captured bytes accepted from each native output stream. */
    readonly max_output_bytes: number;
    /** Configured reason explaining the successful resolution. */
    readonly reason: NativeJailPlacementReason;
    /** Exact repository grant plan governed by the resolution. */
    readonly repository_grant_plan_id: string;
    /** Explicit caller-requested placement. */
    readonly requested_placement: "auto" | "jail";
    /** Content-addressed identity of the complete resolution. */
    readonly resolution_id: string;
    /** Effective native jail placement. */
    readonly resolved_placement: "jail";
    /** Exact durable run identity governed by the resolution. */
    readonly run_id: string;
    /** Exact authenticated runner identity. */
    readonly runner_id: string;
    /** Configured successful resolution status. */
    readonly status: "resolved";
    /** Exact bodyless task artifact governed by the grant plan. */
    readonly task_artifact_digest: string;
    /** Maximum native judged-process duration. */
    readonly timeout_milliseconds: number;
};

/** Immutable content-addressed native confinement plan for one isolated custody. */
export type NativeJailConfinementPlan = {
    /** Exact configured backend descriptor identity. */
    readonly backend_id: string;
    /** Exact structured judged-process command identity. */
    readonly command_id: string;
    /** Compatibility namespace governing native-jail evidence. */
    readonly compatibility_version: string;
    /** Canonical isolated custody root governed by the plan. */
    readonly custody_root: string;
    /** Actual native enforcement classification. */
    readonly enforcement: RetainedWorldEnforcement;
    /** Content-addressed identity of the complete confinement plan. */
    readonly plan_id: string;
    /** Public confinement-plan protocol version. */
    readonly plan_version: number;
    /** Digest of the exact lowered backend-private profile. */
    readonly profile_digest: string;
    /** Successful native backend probe authorizing the plan. */
    readonly probe_id: string;
    /** Canonical writable roots compiled from effective grants. */
    readonly writable_roots: readonly string[];
};

/** Immutable intent retained before one native process may start. */
export type NativeJailLaunchIntent = {
    /** Exact structured command identity. */
    readonly command_id: string;
    /** Content-addressed identity of this launch intent. */
    readonly launch_id: string;
    /** Complete authenticated confinement plan retained before process start. */
    readonly plan: NativeJailConfinementPlan;
    /** Exact confinement plan identity. */
    readonly plan_id: string;
    /** Exact authenticated runner identity. */
    readonly runner_id: string;
};

/** Immutable evidence retained after the native process actually starts. */
export type NativeJailProcessStarted = {
    /** Exact launch-intent identity. */
    readonly launch_id: string;
    /** Exact operating-system process identifier. */
    readonly process_id: number;
    /** Content-addressed identity of the process-start evidence. */
    readonly start_id: string;
};

/** Immutable durable result of one native judged-process launch. */
export type NativeJailLaunchReceipt = {
    /** Exit code reported after process close, or `null` when unavailable. */
    readonly exit_code: number | null;
    /** Exact launch-intent identity. */
    readonly launch_id: string;
    /** Exact operating-system process identifier, or `null` before start. */
    readonly process_id: number | null;
    /** Proven or uncertain process-group quiescence classification. */
    readonly quiescence: NativeJailQuiescenceStatus;
    /** Content-addressed identity of the complete launch receipt. */
    readonly receipt_id: string;
    /** Public launch-receipt protocol version. */
    readonly receipt_version: number;
    /** Operating-system exit signal, or `null` for ordinary exit. */
    readonly signal: string | null;
    /** Closed terminal native-process classification. */
    readonly status: NativeJailProcessStatus;
    /** Captured standard-error bytes encoded as base64. */
    readonly stderr_base64: string;
    /** Captured standard-error byte length. */
    readonly stderr_bytes: number;
    /** Captured standard-output bytes encoded as base64. */
    readonly stdout_base64: string;
    /** Captured standard-output byte length. */
    readonly stdout_bytes: number;
};
