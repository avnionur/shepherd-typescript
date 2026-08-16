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

/** Configured canonical world-changeset operations. @public */
export const WORLD_CHANGE_OPERATIONS = ["add", "delete", "modify", "replace"] as const;

/** Configured retained-world text-preview classifications. @public */
export const WORLD_TEXT_PREVIEW_CLASSIFICATIONS = ["text", "binary"] as const;

/** Configured retained-world text-preview encoding. @public */
export const WORLD_TEXT_PREVIEW_ENCODING = "utf-8" as const;

/** Configured exact-content derived move classifications. @public */
export const WORLD_DERIVED_MOVE_KINDS = ["rename", "copy"] as const;

/** Configured Gitlink presentation discriminant. @public */
export const GITLINK_ENTRY_KIND = "gitlink" as const;

/** Configured Gitlink index mode. @public */
export const GITLINK_MODE = "160000" as const;

/** Configured symbolic-link index mode. @public */
export const GIT_SYMLINK_MODE = "120000" as const;

/** Configured public resource bounds for changeset inspection. @public */
export const WORLD_CHANGESET_INSPECTION_LIMITS = {
    maxDerivedMoveCandidates: 10000,
    maxPageSize: 1000,
    maxPathBytes: 4096,
    maxPreviewBytes: 1048576,
    maxPreviewLines: 1000,
    maxReadBytes: 1048576,
    maxVerificationConcurrency: 2,
} as const;

/** Configured public world-changeset error codes. @public */
export const WORLD_CHANGESET_ERROR_CODES = {
    invalid: "WORLD_CHANGESET_INVALID",
    limit: "WORLD_CHANGESET_LIMIT_EXCEEDED",
} as const;

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

/** Configured reference copy-carrier manifest entry kinds. @public */
export const WORLD_ENTRY_KINDS = ["directory", "file", "symlink"] as const;

/** Configured retained-world runner enforcement classifications. @public */
export const RETAINED_WORLD_ENFORCEMENT_KINDS = ["advisory"] as const;

/** Configured durable retained-world output statuses. @public */
export const RETAINED_WORLD_OUTPUT_STATUSES = ["retained"] as const;

/** Configured ordered durable retained-world capture-journal phases. @public */
export const RETAINED_WORLD_JOURNAL_PHASES = [
    "prepared",
    "forked",
    "executing",
    "captured",
] as const;

/** Configured consume-once retained-world settlement actions. @public */
export const RETAINED_WORLD_SETTLEMENT_ACTIONS = ["select", "discard"] as const;

/** Configured durable retained-world settlement states. @public */
export const RETAINED_WORLD_SETTLEMENT_STATES = [
    "prepared",
    "applying",
    "selected",
    "discarded",
] as const;

/** Configured public retained-world settlement protocol version. @public */
export const RETAINED_WORLD_SETTLEMENT_VERSION = 12 as const;

/** Configured deterministic settlement-operation codec version. @public */
export const RETAINED_WORLD_SETTLEMENT_OPERATION_VERSION = 1 as const;

/** Configured deterministic settlement-receipt codec version. @public */
export const RETAINED_WORLD_SETTLEMENT_RECEIPT_VERSION = 1 as const;

/** Configured retained-world selection publication atomicity classifications. @public */
export const RETAINED_WORLD_SELECTION_ATOMICITY_KINDS = ["journaled-path-set"] as const;

/** Configured retained-world selection path-step statuses. @public */
export const RETAINED_WORLD_SELECTION_STEP_STATUSES = ["applied"] as const;

/** Configured retained-world selection dependency-schedule classifications. @public */
export const RETAINED_WORLD_SELECTION_SCHEDULE_KINDS = ["dependency-ordered-path-set"] as const;

/** Configured retained-world selection publication protocol version. @public */
export const RETAINED_WORLD_SELECTION_PUBLICATION_VERSION = 16 as const;

/** Configured retained-world selection plan codec version. @public */
export const RETAINED_WORLD_SELECTION_PLAN_VERSION = 1 as const;

/** Configured retained-world selection path-step codec version. @public */
export const RETAINED_WORLD_SELECTION_STEP_VERSION = 1 as const;

/** Configured retained-world selection publication-receipt codec version. @public */
export const RETAINED_WORLD_SELECTION_RECEIPT_VERSION = 1 as const;

/** Configured retained-world selection dependency-schedule codec version. @public */
export const RETAINED_WORLD_SELECTION_SCHEDULE_VERSION = 1 as const;

/** Configured dependency-scheduled path-step codec version. @public */
export const RETAINED_WORLD_SELECTION_SCHEDULED_STEP_VERSION = 1 as const;

/** Configured dependency-scheduled terminal publication-receipt codec version. @public */
export const RETAINED_WORLD_SELECTION_SCHEDULED_RECEIPT_VERSION = 1 as const;

/** Configured maximum path effects in one retained-world selection publication. @public */
export const RETAINED_WORLD_SELECTION_MAX_STEPS = 100000 as const;

/** Configured maximum UTF-8 bytes for one retained-world text operation. @public */
export const RETAINED_WORLD_MAX_TEXT_BYTES = 16777216 as const;

/** Configured maximum UTF-8 bytes for one retained-world capture identity. @public */
export const RETAINED_WORLD_MAX_CAPTURE_ID_BYTES = 256 as const;

/** Configured Git HEAD-state discriminants. @public */
export const GIT_HEAD_KINDS = ["attached", "unborn", "detached"] as const;
