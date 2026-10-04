// Generated from protocol.config.json and public-errors.config.json. Do not edit directly.

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

/** Configured public output/trace/recovery selector and projection bounds. @public */
export const EVIDENCE_RECORD_LIMITS = {
    defaultPageSize: 50,
    maxCanonicalEntryBytes: 67108864,
    maxPageSize: 100,
    maxSelectorBytes: 512,
} as const;

/** Configured canonical latest evidence-record read selector. @public */
export const EVIDENCE_RECORD_LATEST_SELECTOR = "@latest" as const;

/** Configured orphaned-operation diagnosis and repair resource bounds. @public */
export const ORPHAN_REPAIR_LIMITS = {
    defaultPageSize: 50,
    maxCanonicalBytes: 1048576,
    maxCauseBytes: 4096,
    maxIdentifierBytes: 512,
    maxOperations: 100,
    maxPageSize: 100,
} as const;

/** Configured stable blockers for bookkeeping-only orphan repair. @public */
export const ORPHAN_REPAIR_BLOCKERS = {
    liveSession: "live_session",
    providerStarted: "provider_call_started",
    scopeOwned: "scope_owned",
} as const;

/** Configured orphan-repair error codes. @public */
export const ORPHAN_REPAIR_ERROR_CODES = {
    blocked: "ORPHAN_REPAIR_BLOCKED",
    commandConflict: "ORPHAN_REPAIR_COMMAND_CONFLICT",
    corrupt: "ORPHAN_REPAIR_CORRUPT",
    stale: "ORPHAN_REPAIR_STALE_BASIS",
    unsupported: "ORPHAN_REPAIR_UNSUPPORTED_VERSION",
} as const;

/** Configured session-liveness diagnosis statuses. @public */
export const ORPHAN_REPAIR_SESSION_STATUSES = {
    dead: "dead",
    live: "live",
} as const;

/** Configured fail-soft pre-run reclaim statuses. @public */
export const ORPHAN_REPAIR_PRE_RUN_STATUSES = {
    declined: "declined",
    repaired: "repaired",
} as const;

/** Configured orphan diagnosis, command, operation, and receipt versions. @public */
export const ORPHAN_REPAIR_VERSIONS = {
    command: 1,
    diagnosis: 1,
    operation: 1,
    receipt: 1,
} as const;

/** Configured public task/run ledger selector and projection bounds. @public */
export const TASK_RUN_LEDGER_LIMITS = {
    defaultPageSize: 50,
    maxCanonicalEntryBytes: 67108864,
    maxPageSize: 100,
    maxSelectorBytes: 512,
} as const;

/** Configured canonical latest read selector. @public */
export const TASK_RUN_LEDGER_LATEST_SELECTOR = "@latest" as const;

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

/** Configured selectable world-carrier backends. @public */
export const WORLD_CARRIER_BACKENDS = ["copy", "clone", "overlay"] as const;

/** Configured backend and device-layer adapter selection modes. @public */
export const BACKEND_SELECTION_MODES = ["fallback", "strict"] as const;

/** Configured built-in device-layer adapter names. @public */
export const DEVICE_LAYER_ADAPTERS = ["clone", "container", "copy", "overlay"] as const;

/** Configured retained-world runner enforcement classifications. @public */
export const RETAINED_WORLD_ENFORCEMENT_KINDS = ["advisory", "native-syscall-deny"] as const;

/** Configured repository authority atoms. @public */
export const REPOSITORY_GRANT_ATOMS = ["read", "write"] as const;

/** Configured whole-repository grant profiles. @public */
export const REPOSITORY_GRANT_PROFILES = ["read-only", "read-write"] as const;

/** Configured requested placement vocabulary. @public */
export const PLACEMENT_REQUESTS = ["advisory", "auto", "jail"] as const;

/** Configured effective placement vocabulary. @public */
export const RESOLVED_PLACEMENTS = ["advisory"] as const;

/** Configured placement-resolution reasons. @public */
export const PLACEMENT_RESOLUTION_REASONS = [
    "requested-advisory",
    "auto-fallback-unavailable",
    "explicit-jail-unavailable",
] as const;

/** Configured placement resolved/refused statuses. @public */
export const PLACEMENT_RESOLUTION_STATUSES = ["resolved", "refused"] as const;

/** Configured platform-family classifications used by placement evidence. @public */
export const PLACEMENT_PLATFORM_FAMILIES = ["macos", "linux", "windows", "unsupported"] as const;

/** Configured execution-environment classifications used by placement evidence. @public */
export const PLACEMENT_ENVIRONMENTS = ["native", "wsl", "unsupported"] as const;

/** Configured native syscall-jail backend names. @public */
export const NATIVE_JAIL_BACKENDS = ["seatbelt", "landlock"] as const;

/** Configured native-jail backend probe reasons. @public */
export const NATIVE_JAIL_PROBE_REASONS = [
    "probe-succeeded",
    "platform-unsupported",
    "backend-executable-unavailable",
    "helper-compiler-unavailable",
    "helper-integrity-failed",
    "native-denial-failed",
    "native-write-failed",
    "native-probe-error",
] as const;

/** Configured native-jail backend probe statuses. @public */
export const NATIVE_JAIL_PROBE_STATUSES = ["available", "unavailable"] as const;

/** Configured successful native-jail placement reasons. @public */
export const NATIVE_JAIL_PLACEMENT_REASONS = [
    "requested-native-jail",
    "auto-selected-native-jail",
] as const;

/** Configured native judged-process terminal statuses. @public */
export const NATIVE_JAIL_PROCESS_STATUSES = [
    "exited",
    "cancelled",
    "timed-out",
    "output-limit",
    "launch-failed",
    "quiescence-uncertain",
] as const;

/** Configured native process-group quiescence statuses. @public */
export const NATIVE_JAIL_QUIESCENCE_STATUSES = ["proven", "uncertain"] as const;

/** Configured world-operation journal phases. @public */
export const WORLD_EFFECT_PHASES = ["opened", "intent", "admitted", "outcome"] as const;

/** Configured world-operation outcomes. @public */
export const WORLD_EFFECT_OUTCOMES = ["succeeded", "refused", "failed", "cancelled"] as const;

/** Configured world-operation evidence recovery classifications. @public */
export const WORLD_EFFECT_RECOVERY = [
    "absent",
    "recording",
    "not_materialized",
    "uncertain",
    "settled",
] as const;

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
export const RETAINED_WORLD_SETTLEMENT_ACTIONS = ["select", "discard", "apply", "release"] as const;

/** Configured retained-world application conflict classifications. @public */
export const RETAINED_WORLD_APPLICATION_CONFLICT_KINDS = [
    "equal-path",
    "ancestor-descendant",
    "portable-alias",
] as const;

/** Configured retained-world application plan reasons. @public */
export const RETAINED_WORLD_APPLICATION_REASONS = ["unmoved-parent", "path-disjoint"] as const;

/** Configured retained-world application plan statuses. @public */
export const RETAINED_WORLD_APPLICATION_STATUSES = ["planned"] as const;

/** Configured durable retained-world settlement states. @public */
export const RETAINED_WORLD_SETTLEMENT_STATES = [
    "prepared",
    "applying",
    "selected",
    "discarded",
    "applied",
    "released",
] as const;

/** Configured public retained-world settlement protocol version. @public */
export const RETAINED_WORLD_SETTLEMENT_VERSION = 12 as const;

/** Configured deterministic settlement-operation codec version. @public */
export const RETAINED_WORLD_SETTLEMENT_OPERATION_VERSION = 1 as const;

/** Configured deterministic settlement-receipt codec version. @public */
export const RETAINED_WORLD_SETTLEMENT_RECEIPT_VERSION = 1 as const;

/** Configured receipt-only retained-world release receipt version. @public */
export const RETAINED_WORLD_RELEASE_RECEIPT_VERSION = 1 as const;

/** Configured receipt-only retained-world release compatibility namespace. @public */
export const RETAINED_WORLD_RELEASE_COMPATIBILITY_VERSION =
    "shepherd.workspace.retained-world-release.v1" as const;

/** Configured execution-trace settlement-citation version. @public */
export const RETAINED_WORLD_SETTLEMENT_CITATION_VERSION = 1 as const;

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

/** Configured scope kinds ordered root then child. @public */
export const SCOPE_KINDS = ["root", "child"] as const;

/** Configured scope branch-lifecycle states ordered open, merged, discarded. @public */
export const SCOPE_STATES = ["open", "merged", "discarded"] as const;

/** Configured scope-local history evidence classifications. @public */
export const SCOPE_EVIDENCE_KINDS = [
    "registration",
    "origin_cut",
    "child_registered",
    "emission",
    "fork_prepared",
    "fork_completed",
    "merge_cut",
    "merge_prepared",
    "merge_completed",
    "child_merged",
    "discard_decided",
    "discard_cleaned",
] as const;

/** Configured scope world-capability declarations. @public */
export const SCOPE_WORLD_CAPABILITIES = ["trace_only", "reference_copy"] as const;

/** Configured scope authority atoms shared with repository grants. @public */
export const SCOPE_AUTHORITY_ATOMS = ["read", "write"] as const;

/** Configured resource kinds that scope authority may cite. @public */
export const SCOPE_RESOURCE_KINDS = ["repository_binding", "workspace_binding"] as const;

/** Configured scope command kinds ordered root registration, child registration, emission, fork, merge, discard. @public */
export const SCOPE_COMMAND_KINDS = [
    "register_root",
    "register_child",
    "emit",
    "fork",
    "merge",
    "discard",
] as const;

/** Configured scope fork journal phases ordered prepared then completed. @public */
export const SCOPE_FORK_PHASES = ["prepared", "completed"] as const;

/** Configured scope merge journal phases ordered prepared then completed. @public */
export const SCOPE_MERGE_PHASES = ["prepared", "completed"] as const;

/** Configured scope discard journal phases ordered decided then cleaned. @public */
export const SCOPE_DISCARD_PHASES = ["decided", "cleaned"] as const;

/** Configured scope checkpoint constituent kinds in classification order. @public */
export const SCOPE_CHECKPOINT_CONSTITUENT_KINDS = [
    "trace_cut",
    "execution",
    "binding",
    "world",
    "grants",
    "child_frontier",
    "budget",
    "provider_session",
    "process",
    "irreversible_effects",
] as const;

/** Configured scope checkpoint evidence statuses. @public */
export const SCOPE_CHECKPOINT_EVIDENCE_STATUSES = [
    "verified",
    "reconstructive",
    "not_applicable",
    "unavailable",
] as const;

/** Configured scope recovery classifications in precedence order. @public */
export const SCOPE_RECOVERY_CLASSIFICATIONS = [
    "terminal",
    "cleanup_pending",
    "merge_pending",
    "fork_pending",
    "writer_expired",
    "writer_held",
    "idle",
] as const;

/** Configured scope recovery resume actions ordered fork, merge, discard, claim. @public */
export const SCOPE_RECOVERY_RESUME_KINDS = ["fork", "merge", "discard", "claim"] as const;

/** Configured scope scheduling decisions ordered merge then discard. @public */
export const SCOPE_SCHEDULING_DECISIONS = ["merge", "discard"] as const;

/** Configured scope scheduling outcomes ordered merged, discarded, conflicted, failed. @public */
export const SCOPE_SCHEDULING_OUTCOMES = ["merged", "discarded", "conflicted", "failed"] as const;

/** Configured scope scheduling bounds. @public */
export const SCOPE_SCHEDULING_LIMITS = Object.freeze({
    maxDepth: 16,
    maxNodes: 256,
    maxParallel: 64,
} as const);

/** Configured scope vocabulary terms ordered spawn, adopt, abandon, publish. @public */
export const SCOPE_VOCABULARY_TERMS = ["spawn", "adopt", "abandon", "publish"] as const;

/** Configured scope vocabulary mapping statuses ordered pending then completed. @public */
export const SCOPE_VOCABULARY_STATUSES = ["pending", "completed"] as const;

/** Configured scope vocabulary projection version. @public */
export const SCOPE_VOCABULARY_VERSION = 1 as const;

/** Configured branch start classifications ordered atomic snapshot, quiescent verified copy, reconstructed. @public */
export const SCOPE_CHECKPOINT_START_CLASSIFICATIONS = [
    "atomic_snapshot",
    "quiescent_verified_copy",
    "reconstructed",
] as const;

/** Configured scope checkpoint descriptor version. @public */
export const SCOPE_CHECKPOINT_VERSION = 1 as const;

/** Configured canonical scope record version. @public */
export const SCOPE_RECORD_VERSION = 1 as const;

/** Configured scope evidence compatibility namespace. @public */
export const SCOPE_COMPATIBILITY_VERSION = "shepherd.scope.v1" as const;

/** Configured scope command resource bounds. @public */
export const SCOPE_LIMITS = Object.freeze({
    maxCitedRecords: 64,
    maxContributions: 1024,
    maxDataCanonicalBytes: 65536,
    maxDiscardScopes: 256,
    maxResources: 64,
} as const);

/** Configured supervision evidence compatibility namespace. @public */
export const SUPERVISION_COMPATIBILITY_VERSION = "shepherd.supervision.v1" as const;

/** Configured canonical supervision record version. @public */
export const SUPERVISION_RECORD_VERSION = 1 as const;

/** Configured subscription start positions ordered origin then head. @public */
export const SUPERVISION_SUBSCRIPTION_START_POSITIONS = ["origin", "head"] as const;

/** Configured subscription overflow policies ordered backpressure then fail. @public */
export const SUPERVISION_SUBSCRIPTION_OVERFLOW_POLICIES = ["backpressure", "fail"] as const;

/** Configured subscription cursor version and bounds. @public */
export const SUPERVISION_SUBSCRIPTION_LIMITS = Object.freeze({
    cursorVersion: 1,
    defaultBufferCapacity: 64,
    maxBufferCapacity: 4096,
    maxOwners: 64,
    pollIntervalMilliseconds: 10,
} as const);

/** Configured interception decisions ordered allow, deny, replace, pause. @public */
export const SUPERVISION_DECISIONS = ["allow", "deny", "replace", "pause"] as const;

/** Configured decision sources ordered interceptor, timeout, failure. @public */
export const SUPERVISION_DECISION_SOURCES = ["interceptor", "timeout", "failure"] as const;

/** Configured timeout policies ordered fail open then fail closed. @public */
export const SUPERVISION_TIMEOUT_POLICIES = ["fail_open", "fail_closed"] as const;

/** Configured interception bounds and decision lease timing. @public */
export const SUPERVISION_INTERCEPTION_LIMITS = Object.freeze({
    decisionLeaseMilliseconds: 30000,
    leaseRenewalMilliseconds: 10000,
    maxInterceptors: 16,
    maxTimeoutMilliseconds: 3600000,
} as const);

/** Configured reversibility tiers for which fail-open is replaced by fail-closed. @public */
export const SUPERVISION_FAIL_OPEN_FORBIDDEN_TIERS = ["irreversible"] as const;

/** Configured approval gates ordered interceptor pause then irreversible frontier. @public */
export const SUPERVISION_APPROVAL_GATES = ["interceptor_pause", "irreversible_frontier"] as const;

/** Configured approval record phases ordered requested then resolved. @public */
export const SUPERVISION_APPROVAL_PHASES = ["requested", "resolved"] as const;

/** Configured approval verdicts ordered approved, rejected, expired. @public */
export const SUPERVISION_APPROVAL_VERDICTS = ["approved", "rejected", "expired"] as const;

/** Configured reversibility tiers that require approval before admission. @public */
export const SUPERVISION_APPROVAL_REQUIRED_TIERS = ["irreversible"] as const;

/** Configured approval wait bounds. @public */
export const SUPERVISION_APPROVAL_LIMITS = Object.freeze({
    defaultWaitMilliseconds: 300000,
    maxWaitMilliseconds: 3600000,
    pollIntervalMilliseconds: 10,
} as const);

/** Configured terminal dispositions ordered materialized, materialization failed, denied, rejected, cancelled. @public */
export const SUPERVISION_DISPOSITIONS = [
    "materialized",
    "materialization_failed",
    "denied",
    "rejected",
    "cancelled",
] as const;

/** Configured recovery classifications ordered resolved, materialization uncertain, resolution, approval, decision pending. @public */
export const SUPERVISION_RECOVERY_CLASSIFICATIONS = [
    "resolved",
    "materialization_uncertain",
    "resolution_pending",
    "approval_pending",
    "decision_pending",
] as const;

/** Configured supervision evidence bounds. @public */
export const SUPERVISION_LIMITS = Object.freeze({
    maxCitedRecords: 64,
    maxDataCanonicalBytes: 65536,
    maxReasonBytes: 4096,
} as const);

/** Configured replay evidence compatibility namespace. @public */
export const REPLAY_COMPATIBILITY_VERSION = "shepherd.replay.v1" as const;

/** Configured provider kinds ordered static, program, then live kinds. @public */
export const PROVIDER_KINDS = ["static", "program", "anthropic", "openai", "openrouter"] as const;

/** Configured provider-neutral message roles ordered user then assistant. @public */
export const MODEL_MESSAGE_ROLES = ["user", "assistant"] as const;

/** Configured provider-neutral message content block types ordered text, tool use, tool result. @public */
export const MODEL_CONTENT_BLOCK_TYPES = ["text", "tool_use", "tool_result"] as const;

/** Configured tool-use loop statuses ordered completed then turn limit. @public */
export const TOOL_LOOP_STATUSES = ["completed", "turn_limit"] as const;

/** Configured tool-call dispositions ordered materialized, denied, invalid, failed. @public */
export const TOOL_CALL_DISPOSITIONS = ["materialized", "denied", "invalid", "failed"] as const;

/** Configured canonical replay record version. @public */
export const REPLAY_RECORD_VERSION = 1 as const;

/** Configured replay session modes ordered root, rewind, replay. @public */
export const REPLAY_MODES = ["root", "rewind", "replay"] as const;

/** Configured reversibility tiers whose materialized effects are compensated. @public */
export const EFFECT_COMPENSABLE_TIERS = ["compensable"] as const;

/** Configured compensation evidence kinds ordered replay step then supervised dispatch. @public */
export const EFFECT_COMPENSATION_EVIDENCE_KINDS = ["replay_step", "supervised_dispatch"] as const;

/** Configured compensation record phases ordered intent, attempt, outcome. @public */
export const EFFECT_COMPENSATION_PHASES = ["intent", "attempt", "outcome"] as const;

/** Configured compensation outcomes ordered compensated then failed. @public */
export const EFFECT_COMPENSATION_OUTCOMES = ["compensated", "failed"] as const;

/** Configured derived compensation statuses ordered pending, uncertain, failed, compensated. @public */
export const EFFECT_COMPENSATION_STATUSES = [
    "pending",
    "uncertain",
    "failed",
    "compensated",
] as const;

/** Configured store-local compensation ownership classifications. @public */
export const EFFECT_COMPENSATION_OWNERSHIP_STATUSES = [
    "absent",
    "active",
    "expired",
    "released",
] as const;

/** Configured explicit operator reconciliation dispositions. @public */
export const EFFECT_RECONCILIATION_DISPOSITIONS = [
    "retry",
    "externally_verified_completion",
    "accepted_unresolved",
] as const;

/** Configured source execution kinds for reconciliation evidence. @public */
export const EFFECT_RECONCILIATION_SOURCE_KINDS = ["replay", "supervised_dispatch"] as const;

/** Configured compensation triggers ordered scope discard, replay rewind, replay replay, command. @public */
export const EFFECT_COMPENSATION_TRIGGERS = [
    "scope_discard",
    "replay_rewind",
    "replay_replay",
    "command",
] as const;

/** Configured replay step kinds ordered provider then effect. @public */
export const REPLAY_STEP_KINDS = ["provider", "effect"] as const;

/** Configured replay step sources ordered live then recorded. @public */
export const REPLAY_STEP_SOURCES = ["live", "recorded"] as const;

/** Configured declarable replay change dimensions ordered task, provider, handlers. @public */
export const REPLAY_CHANGE_DIMENSIONS = ["task", "provider", "handlers"] as const;

/** Configured replay effect dispositions ordered materialized, materialization failed, refused. @public */
export const REPLAY_EFFECT_DISPOSITIONS = [
    "materialized",
    "materialization_failed",
    "refused",
] as const;

/** Configured reversibility tiers that require replay policy approval in a branch suffix. @public */
export const REPLAY_APPROVAL_REQUIRED_TIERS = ["irreversible"] as const;

/** Configured provider cache evidence statuses ordered hit then not observed. @public */
export const REPLAY_CACHE_STATUSES = ["hit", "not_observed"] as const;

/** Configured checkpoint classifications ordered atomic, reconstructive, unavailable. @public */
export const REPLAY_CHECKPOINT_CLASSIFICATIONS = [
    "atomic",
    "reconstructive",
    "unavailable",
] as const;

/** Configured checkpoint constituent kinds in descriptor order. @public */
export const REPLAY_CHECKPOINT_CONSTITUENT_KINDS = [
    "trace_cut",
    "world",
    "provider_session",
    "process",
    "irreversible_effects",
] as const;

/** Configured checkpoint evidence statuses ordered verified, reconstructive, not applicable, unavailable. @public */
export const REPLAY_CHECKPOINT_EVIDENCE_STATUSES = [
    "verified",
    "reconstructive",
    "not_applicable",
    "unavailable",
] as const;

/** Configured automatic checkpoint policies ordered none, provider step, effect step, every N steps. @public */
export const REPLAY_CHECKPOINT_POLICIES = [
    "none",
    "provider_step",
    "effect_step",
    "every_n_steps",
] as const;

/** Configured branch source dispositions ordered compensate, retain. @public */
export const REPLAY_SOURCE_DISPOSITIONS = ["compensate", "retain"] as const;

/** Configured session terminal statuses ordered finished, failed, cancelled, rewound. @public */
export const REPLAY_TERMINAL_STATUSES = ["finished", "failed", "cancelled", "rewound"] as const;

/** Configured session recovery classifications ordered terminal, running, interrupted, materialization uncertain. @public */
export const REPLAY_RECOVERY_CLASSIFICATIONS = [
    "terminal",
    "running",
    "interrupted",
    "materialization_uncertain",
] as const;

/** Configured divergence alignment statuses ordered identical, diverged, source only, replay only. @public */
export const REPLAY_DIVERGENCE_STATUSES = [
    "identical",
    "diverged",
    "source_only",
    "replay_only",
] as const;

/** Configured divergence causes ordered root, propagated, unexplained. @public */
export const REPLAY_DIVERGENCE_CAUSES = ["root", "propagated", "unexplained"] as const;

/** Configured first-regression search strategies ordered bisect, linear. @public */
export const REPLAY_REGRESSION_STRATEGIES = ["bisect", "linear"] as const;

/** Configured process checkpoint backends ordered cooperative then transparent. @public */
export const REPLAY_PROCESS_BACKENDS = ["cooperative", "transparent"] as const;

/** Configured replay session lease timing. @public */
export const REPLAY_LEASE_LIMITS = Object.freeze({
    leaseMilliseconds: 30000,
    renewalMilliseconds: 10000,
} as const);

/** Configured replay evidence bounds. @public */
export const REPLAY_LIMITS = Object.freeze({
    maxDependencies: 64,
    maxErrorMessageBytes: 4096,
    maxProcessImageBytes: 16777216,
    maxProcesses: 8,
    maxReasonBytes: 4096,
    maxSteps: 4096,
    maxWorldEntries: 65536,
    maxWorlds: 16,
} as const);

/** Configured delegation evidence compatibility namespace. @public */
export const DELEGATION_COMPATIBILITY_VERSION = "shepherd.delegation.v1" as const;

/** Configured canonical delegation record version. @public */
export const DELEGATION_RECORD_VERSION = 1 as const;

/** Configured child run handle parent kinds ordered root then handle. @public */
export const DELEGATION_PARENT_KINDS = ["root", "handle"] as const;

/** Configured child execution kinds ordered provider then program. @public */
export const DELEGATION_EXECUTION_KINDS = ["provider", "program"] as const;

/** Configured task provenance kinds ordered declared, revised, synthesized. @public */
export const DELEGATION_PROVENANCE_KINDS = ["declared", "revised", "synthesized"] as const;

/** Configured task approval verdicts ordered approved then rejected. @public */
export const DELEGATION_APPROVAL_VERDICTS = ["approved", "rejected"] as const;

/** Configured terminal decision kinds ordered accepted then discarded. @public */
export const DELEGATION_DECISION_KINDS = ["accepted", "discarded"] as const;

/** Configured context record phases ordered injected then consumed. @public */
export const DELEGATION_CONTEXT_PHASES = ["injected", "consumed"] as const;

/** Configured task fields a revision may change. @public */
export const DELEGATION_REVISION_FIELDS = [
    "instruction",
    "input_schema",
    "output_schema",
    "task_version",
] as const;

/** Configured derived handle statuses ordered ready, running, settling, approval pending, rejected, accepted, discarded. @public */
export const DELEGATION_STATUSES = [
    "ready",
    "running",
    "settling",
    "approval_pending",
    "rejected",
    "accepted",
    "discarded",
] as const;

/** Configured delegation tree projection root kinds ordered handle then supervisor. @public */
export const DELEGATION_TREE_ROOT_KINDS = ["handle", "supervisor"] as const;

/** Configured delegation evidence and projection bounds. @public */
export const DELEGATION_LIMITS = Object.freeze({
    maxCitedRecords: 32,
    maxInjections: 64,
    maxNestingDepth: 16,
    maxReasonLength: 1024,
    maxSupervisorIdLength: 256,
    maxTreeEntries: 256,
} as const);

/** Configured application evidence compatibility namespace. @public */
export const APPLICATION_COMPATIBILITY_VERSION = "shepherd.applications.v1" as const;

/** Configured canonical application record version. @public */
export const APPLICATION_RECORD_VERSION = 1 as const;

/** Configured application manifest version. @public */
export const APPLICATION_MANIFEST_VERSION = 1 as const;

/** Configured application kinds ordered coding supervisor, counterfactual optimization, trajectory compression, Tree-RL. @public */
export const APPLICATION_KINDS = [
    "coding_supervisor",
    "counterfactual_optimization",
    "trajectory_compression",
    "tree_rl",
] as const;

/** Configured protocol surface kinds ordered prompt, schema, tool. @public */
export const APPLICATION_PROTOCOL_SURFACES = ["prompt", "schema", "tool"] as const;

/** Configured supervision record phases ordered opened then decision. @public */
export const APPLICATION_SUPERVISION_PHASES = ["opened", "decision"] as const;

/** Configured coding supervisor policy kinds ordered observe, inject, handoff, discard/restart, accept. @public */
export const APPLICATION_SUPERVISION_POLICY_KINDS = [
    "observe",
    "inject",
    "handoff",
    "discard_restart",
    "accept",
] as const;

/** Configured worker conflict classifications ordered none then path overlap. @public */
export const APPLICATION_SUPERVISION_CONFLICT_KINDS = ["none", "path_overlap"] as const;

/** Configured worker lineage statuses ordered running, accepted, discarded, restarted, handed off. @public */
export const APPLICATION_SUPERVISION_WORKER_STATUSES = [
    "running",
    "accepted",
    "discarded",
    "restarted",
    "handed_off",
] as const;

/** Configured Appendix E runtime supervisor decision actions ordered none, inject, handoff, discard. @public */
export const APPLICATION_RUNTIME_SUPERVISION_ACTIONS = [
    "none",
    "inject",
    "handoff",
    "discard",
] as const;

/** Configured runtime supervision record phases ordered opened, tick, settled, attempt, turn, completed. @public */
export const APPLICATION_RUNTIME_SUPERVISION_PHASES = [
    "opened",
    "tick",
    "settled",
    "attempt",
    "turn",
    "completed",
] as const;

/** Configured runtime supervisor worker attempt causes ordered start, handoff, discard. @public */
export const APPLICATION_RUNTIME_SUPERVISION_ATTEMPT_CAUSES = [
    "start",
    "handoff",
    "discard",
] as const;

/** Configured runtime supervisor worker attempt statuses ordered running, completed, turn limit, failed, aborted. @public */
export const APPLICATION_RUNTIME_SUPERVISION_ATTEMPT_STATUSES = [
    "running",
    "completed",
    "turn_limit",
    "failed",
    "aborted",
] as const;

/** Configured counterfactual optimizer record phases ordered opened, proposal, candidate, selection. @public */
export const APPLICATION_CRO_PHASES = ["opened", "proposal", "candidate", "selection"] as const;

/** Configured counterfactual candidate outcome statuses ordered archived, evaluated, promoted, rejected. @public */
export const APPLICATION_CRO_CANDIDATE_STATUSES = [
    "archived",
    "evaluated",
    "promoted",
    "rejected",
] as const;

/** Configured counterfactual comparison baseline kinds. @public */
export const APPLICATION_CRO_BASELINE_KINDS = ["full_replay"] as const;

/** Configured counterfactual candidate edit scopes ordered request then downstream. @public */
export const APPLICATION_CRO_EDIT_SCOPES = ["request", "downstream"] as const;

/** Configured counterfactual example splits ordered train then dev. @public */
export const APPLICATION_CRO_SPLITS = ["train", "dev"] as const;

/** Configured counterfactual example result roles ordered fix, guard, dev, train. @public */
export const APPLICATION_CRO_EXAMPLE_ROLES = ["fix", "guard", "dev", "train"] as const;

/** Configured trajectory compression record phases ordered opened, candidate, outcome. @public */
export const APPLICATION_COMPRESSION_PHASES = ["opened", "candidate", "outcome"] as const;

/** Configured trajectory compression candidate kinds ordered compression then best-of-N control. @public */
export const APPLICATION_COMPRESSION_CANDIDATE_KINDS = ["compression", "control"] as const;

/** Configured trajectory compression candidate statuses ordered proposed, rewound, settled, rejected. @public */
export const APPLICATION_COMPRESSION_CANDIDATE_STATUSES = [
    "proposed",
    "rewound",
    "settled",
    "rejected",
] as const;

/** Configured trajectory compression outcomes ordered pruned, no prune, restored. @public */
export const APPLICATION_COMPRESSION_OUTCOMES = ["pruned", "no_prune", "restored"] as const;

/** Configured trajectory compression verifier verdicts ordered accepted then rejected. @public */
export const APPLICATION_COMPRESSION_VERDICTS = ["accepted", "rejected"] as const;

/** Configured trajectory compression comparison baseline kinds. @public */
export const APPLICATION_COMPRESSION_BASELINE_KINDS = ["no_compression"] as const;

/** Configured trajectory compression fork-step policies ordered clamp then reject. @public */
export const APPLICATION_COMPRESSION_FORK_STEP_POLICIES = ["clamp", "reject"] as const;

/** Configured Tree-RL record phases ordered opened, root, rollout, batch. @public */
export const APPLICATION_TREE_RL_PHASES = ["opened", "root", "rollout", "batch"] as const;

/** Configured Tree-RL tree member kinds ordered root then branch. @public */
export const APPLICATION_TREE_RL_MEMBER_KINDS = ["root", "branch"] as const;

/** Configured Tree-RL per-action advantage segments ordered prefix, suffix, flat. @public */
export const APPLICATION_TREE_RL_ACTION_SEGMENTS = ["prefix", "suffix", "flat"] as const;

/** Configured Tree-RL advantage normalizations ordered none then per-group standardization. @public */
export const APPLICATION_TREE_RL_NORMALIZATIONS = ["none", "group_std"] as const;

/** Configured Tree-RL batch and concurrency bounds. @public */
export const APPLICATION_TREE_RL_LIMITS = Object.freeze({
    defaultConcurrency: 4,
    maxConcurrency: 16,
    maxGroupSize: 16,
    maxPrompts: 16,
} as const);

/** Configured Tree-RL rollout statuses ordered completed then failed. @public */
export const APPLICATION_TREE_RL_ROLLOUT_STATUSES = ["completed", "failed"] as const;

/** Configured Tree-RL comparison baseline kinds. @public */
export const APPLICATION_TREE_RL_BASELINE_KINDS = ["flat_grpo"] as const;

/** Configured Tree-RL training batch formats. @public */
export const APPLICATION_TREE_RL_BATCH_FORMATS = ["jsonl_v2"] as const;

/** Configured coding supervisor comparison baseline kinds. @public */
export const APPLICATION_SUPERVISION_BASELINE_KINDS = ["no_supervision"] as const;

/** Configured measured evaluation metrics ordered cost, provider calls, input tokens, output tokens, steps, success. @public */
export const APPLICATION_EVALUATION_METRICS = [
    "cost_usd",
    "provider_calls",
    "input_tokens",
    "output_tokens",
    "steps",
    "success",
] as const;

/** Configured application evaluation report version. @public */
export const APPLICATION_EVALUATION_REPORT_VERSION = 2 as const;

/** Configured application evaluation definition bounds. @public */
export const APPLICATION_EVALUATION_LIMITS = Object.freeze({
    maxExperiments: 16,
    maxLimitationLength: 1024,
    maxLimitations: 32,
} as const);

/** Configured application evidence bounds. @public */
export const APPLICATION_LIMITS = Object.freeze({
    maxArtifacts: 128,
    maxBestOfN: 8,
    maxBranches: 16,
    maxCandidates: 32,
    maxDatasetItems: 64,
    maxForkPoints: 32,
    maxPromptBytes: 16384,
    maxReasonLength: 1024,
    maxRollouts: 64,
    maxRounds: 64,
    maxSchemaBytes: 16384,
    maxSeeds: 16,
    maxSurfaces: 32,
    maxTickIntervalMilliseconds: 600000,
    maxTicks: 4096,
    maxToolBytes: 16384,
    maxWorkers: 8,
    minWorkers: 2,
} as const);

/** Configured retention data classes. @public */
export const RETENTION_DATA_CLASSES = [
    "checkpoint",
    "context",
    "general",
    "memory-adapter",
    "provider-citation",
] as const;

/** Configured redacted-export dispositions. @public */
export const RETENTION_EXPORT_DISPOSITIONS = ["include", "omit-body", "redact"] as const;

/** Configured trace-store secret-scanning modes. @public */
export const SECRET_SCANNING_MODES = ["off", "refuse"] as const;

/** Configured storage durabilities a blob-store backend or storage coordinator declares. @public */
export const STORAGE_DURABILITIES = ["durable", "volatile"] as const;

/** Configured storage lease result statuses. @public */
export const STORAGE_LEASE_STATUSES = [
    "acquired",
    "held",
    "renewed",
    "released",
    "fenced",
] as const;

/** Configured storage reference compare-and-swap result statuses. @public */
export const STORAGE_REF_SWAP_STATUSES = ["swapped", "conflict", "fenced"] as const;

/** Configured locations of backed-up blob bytes. @public */
export const STORE_BACKUP_BLOB_LOCATIONS = ["directory", "backend"] as const;

/** Configured classifications of refused or failed backup, verification, and restore operations. @public */
export const STORE_BACKUP_FAILURE_REASONS = [
    "backup-unsupported",
    "destination-exists",
    "manifest-missing",
    "manifest-invalid",
    "manifest-mismatch",
    "schema-unsupported",
    "database-mismatch",
    "blob-mismatch",
    "integrity-failed",
    "export-mismatch",
    "target-exists",
] as const;

/** Configured telemetry exporter body modes. @public */
export const TELEMETRY_BODY_MODES = ["omit", "retention-policy"] as const;

/** Configured descriptions of how one record body was handled in exported telemetry. @public */
export const TELEMETRY_BODY_HANDLINGS = [
    "included",
    "withheld",
    "redacted",
    "omitted",
    "oversized",
] as const;

/**
 * Configured public error code for a missing configuration asset, embedded so it is available
 * before `public-errors.config.json` loads. @internal
 */
export const CONFIGURATION_ASSET_MISSING_CODE = "CONFIGURATION_ASSET_MISSING";
