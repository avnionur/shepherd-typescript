// Generated from protocol.config.json. Do not edit directly.

/**
 * Record modes supported by the configured kernel ABI.
 *
 * @public
 */
export const RECORD_MODES = ["capture", "declaration"] as const;

/** Configured reversibility guarantees for effect intents. @public */
export const EFFECT_REVERSIBILITY_TIERS = ["reversible", "compensable", "irreversible"] as const;

/** Configured wire discriminants for effect lifecycle phases. @public */
export const EFFECT_PHASES = { intent: "intent", outcome: "outcome" } as const;

/** Configured proof-envelope profiles ordered from weakest upward. @public */
export const PROOF_ENVELOPE_PROFILES = [
    "runtime_only",
    "reference_core_a",
    "core0",
    "core_a",
    "core0h",
    "extension",
] as const;

/** Configured proof-envelope strengths ordered from weakest upward. @public */
export const PROOF_ENVELOPE_STRENGTHS = [
    "runtime_only",
    "reference_validated",
    "forward_simulation",
    "semantic_adequacy",
] as const;

/** Configured normalized Core-A trace record discriminants. @public */
export const TYPED_EFFECT_TRACE_RECORD_TYPES = {
    capture: "EffectCapture",
    continuationResume: "ContinuationResume",
    declaration: "EffectDeclaration",
    resumeReturn: "ResumeReturn",
    resumptionHandle: "ResumptionHandle",
    selection: "HandlerSelection",
    selectionClosed: "SelectionClosed",
} as const;

/** Configured Core-A handler answer actions. @public */
export const TYPED_EFFECT_TRACE_ACTION_KINDS = ["return", "abort"] as const;

/** Configured Core-A continuation dispositions paired with answer actions. @public */
export const TYPED_EFFECT_TRACE_CONTINUATION_DISPOSITIONS = ["completed", "aborted"] as const;

/** Configured Core-A selection-closure reasons. @public */
export const TYPED_EFFECT_TRACE_CLOSURE_REASONS = ["abandoned", "skipped_by_outer_abort"] as const;

/** Configured terminal status discriminants for run outcomes. @public */
export const RUN_TERMINAL_STATUSES = ["finished", "failed", "exhausted", "cancelled"] as const;

/** Configured content representations for run artifacts. @public */
export const RUN_ARTIFACT_CONTENT_TYPES = ["text", "blob"] as const;

/** Configured run-budget metrics in deterministic exhaustion precedence. @public */
export const RUN_BUDGET_METRICS = [
    "turns",
    "effects",
    "duration_milliseconds",
    "input_tokens",
    "output_tokens",
    "cost_usd",
] as const;

/** Configured run-control reason discriminants. @public */
export const RUN_CONTROL_REASON_TYPES = ["budget_exhausted", "cancelled"] as const;

/** Configured run-control lifecycle statuses. @public */
export const RUN_CONTROL_STATUSES = ["active", "exhausted", "cancelled"] as const;

/** Configured normative run-lifecycle statuses. @public */
export const RUN_LIFECYCLE_STATUSES = [
    "created",
    "running",
    "waiting",
    "suspended",
    "terminal",
] as const;

/** Configured status identifying the terminal normative lifecycle state. @public */
export const RUN_LIFECYCLE_TERMINAL_STATUS = "terminal" as const;

/** Configured active running lifecycle status. @public */
export const RUN_LIFECYCLE_RUNNING_STATUS = "running" as const;

/** Configured prerequisite-driven waiting lifecycle status. @public */
export const RUN_LIFECYCLE_WAITING_STATUS = "waiting" as const;

/** Configured control-driven suspended lifecycle status. @public */
export const RUN_LIFECYCLE_SUSPENDED_STATUS = "suspended" as const;

/** Configured allowed non-terminal run-lifecycle transitions. @public */
export const RUN_LIFECYCLE_TRANSITIONS = [
    ["created", "running"],
    ["running", "waiting"],
    ["waiting", "running"],
    ["running", "suspended"],
    ["suspended", "running"],
] as const;

/** Configured allowed source-lifecycle and terminal-outcome pairs. @public */
export const RUN_LIFECYCLE_TERMINAL_TRANSITIONS = [
    ["created", "failed"],
    ["created", "exhausted"],
    ["created", "cancelled"],
    ["running", "finished"],
    ["running", "failed"],
    ["running", "exhausted"],
    ["running", "cancelled"],
    ["waiting", "failed"],
    ["waiting", "exhausted"],
    ["waiting", "cancelled"],
    ["suspended", "failed"],
    ["suspended", "exhausted"],
    ["suspended", "cancelled"],
] as const;

/** Configured continuation-evidence classifications. @public */
export const RUN_CONTINUATION_EVIDENCE_STATUSES = [
    "verified",
    "not_required",
    "unavailable",
] as const;

/** Configured receipt-bearing continuation-evidence status. @public */
export const RUN_CONTINUATION_VERIFIED_STATUS = "verified" as const;

/** Configured continuation-descriptor constituent kinds. @public */
export const RUN_CONTINUATION_CONSTITUENT_KINDS = [
    "world",
    "provider_session",
    "process",
    "prerequisite",
] as const;

/** Configured durable execution recovery statuses. @public */
export const DURABLE_EXECUTION_RECOVERY_STATUSES = [
    "absent",
    "created",
    "started",
    "terminal_pending_cut",
    "committed",
] as const;

/** Configured durable execution control-command kinds. @public */
export const DURABLE_EXECUTION_CONTROL_COMMAND_KINDS = [
    "recover",
    "pause",
    "resume",
    "cancel",
] as const;

/** Configured durable invocation-claim result statuses. @public */
export const DURABLE_EXECUTION_INVOCATION_CLAIM_STATUSES = ["acquired", "lost"] as const;

/** Configured claim-guarded append result statuses. @public */
export const DURABLE_EXECUTION_CLAIMED_APPEND_STATUSES = ["committed", "fenced"] as const;

/** Configured workspace baseline-adoption modes. @public */
export const WORKSPACE_ADOPTION_MODES = ["none", "git-head", "worktree"] as const;
