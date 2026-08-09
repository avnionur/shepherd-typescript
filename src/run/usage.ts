import { createCanonicalSnapshot } from "../canonical/snapshot.ts";
import { runProtocolConfig } from "../protocol/config.ts";
import type { RunUsage, RunUsageDefinition } from "./usage-types.ts";
import { readRunUsageDefinition } from "./usage-validation.ts";

/**
 * Creates one immutable aggregate resource-usage record for a run.
 *
 * Counts are totals for the complete run, not an individual provider call. An omitted cost is
 * normalized to `null` so the wire record remains closed and deterministic.
 *
 * @param definition - Run identity and aggregate token and cost totals.
 * @returns A deeply frozen canonical aggregate run-usage record.
 * @throws {TypeError} If a field is missing, unexpected, malformed, or negative.
 *
 * @example
 * ```ts
 * const usage = createRunUsage({
 *     runId: "run:example",
 *     inputTokens: 120,
 *     outputTokens: 30,
 *     cacheCreationInputTokens: 10,
 *     cacheReadInputTokens: 80,
 * });
 * ```
 *
 * @public
 */
export function createRunUsage(definition: RunUsageDefinition): RunUsage {
    const values = readRunUsageDefinition(definition);
    return createCanonicalSnapshot({
        cache_creation_input_tokens: values.cacheCreationInputTokens,
        cache_read_input_tokens: values.cacheReadInputTokens,
        cost_usd: values.costUsd ?? null,
        input_tokens: values.inputTokens,
        output_tokens: values.outputTokens,
        run_id: values.runId,
        usage_version: runProtocolConfig.usageVersion,
    }) as RunUsage;
}
