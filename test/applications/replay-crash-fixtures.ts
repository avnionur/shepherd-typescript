import type {
    RunCounterfactualOptimizationOptions,
    RunTreeRlRolloutsOptions,
    SQLiteTraceStore,
} from "../../src/index.ts";
import { keyedProvider, optimizerOptions, providerCandidate } from "./counterfactual-fixtures.ts";
import { recordSource, treeRlOptions } from "./tree-rl-fixtures.ts";

/** Lease clock value the killed process writes under. */
export const CRASH_CLOCK_MILLISECONDS = 1_000_000;

/** Options of one replay-backed application run by the process crash fixture. */
export type ReplayCrashOptions =
    | {
          readonly kind: "counterfactual_optimization";
          readonly options: RunCounterfactualOptimizationOptions;
      }
    | { readonly kind: "tree_rl"; readonly options: RunTreeRlRolloutsOptions };

/**
 * Builds the options the process crash fixture and its test share: the Tree-RL run over the
 * synthetic source (recorded idempotently under a fixed command) or the optimizer with two provider
 * candidates, both writing under a fixed or caller-supplied lease clock.
 */
export async function replayCrashOptions(
    store: SQLiteTraceStore,
    application: "counterfactual_optimization" | "tree_rl",
    commandId: string,
    clock: () => number = () => CRASH_CLOCK_MILLISECONDS,
): Promise<ReplayCrashOptions> {
    if (application === "tree_rl") {
        const sourceSessionId = await recordSource(store, `${commandId}:source`);
        return { kind: application, options: treeRlOptions(commandId, sourceSessionId, { clock }) };
    }
    return {
        kind: application,
        options: optimizerOptions(commandId, {
            candidates: [
                providerCandidate("dies", 0, keyedProvider("alt")),
                providerCandidate("later", 2, keyedProvider("later")),
            ],
            clock,
        }),
    };
}
