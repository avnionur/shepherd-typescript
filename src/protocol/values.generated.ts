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
