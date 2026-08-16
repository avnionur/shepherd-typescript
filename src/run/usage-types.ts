/** Aggregate token and cost totals accepted by {@link createRunUsage}. */
export type RunUsageDefinition = {
    /** Tokens written into provider caches during the run. */
    readonly cacheCreationInputTokens: number;
    /** Tokens read from provider caches during the run. */
    readonly cacheReadInputTokens: number;
    /** Aggregate run cost in US dollars; omitted when unavailable. */
    readonly costUsd?: number;
    /** Input tokens consumed across the entire run. */
    readonly inputTokens: number;
    /** Output tokens produced across the entire run. */
    readonly outputTokens: number;
    /** Run whose aggregate resource use is described. */
    readonly runId: string;
};

/** Immutable versioned aggregate resource-usage record for one run. */
export type RunUsage = {
    /** Tokens written into provider caches during the run. */
    readonly cache_creation_input_tokens: number;
    /** Tokens read from provider caches during the run. */
    readonly cache_read_input_tokens: number;
    /** Aggregate run cost in US dollars, or `null` when unavailable. */
    readonly cost_usd: number | null;
    /** Input tokens consumed across the entire run. */
    readonly input_tokens: number;
    /** Output tokens produced across the entire run. */
    readonly output_tokens: number;
    /** Run whose aggregate resource use is described. */
    readonly run_id: string;
    /** Configured aggregate run-usage wire version. */
    readonly usage_version: number;
};
