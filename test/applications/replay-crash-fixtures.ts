import type {
    RunCounterfactualOptimizationOptions,
    RunTreeRlRolloutsOptions,
    SQLiteTraceStore,
} from "../../src/index.ts";
import {
    optimizerOptions,
    providerEdit,
    reflection,
    scriptedProposer,
} from "./counterfactual-fixtures.ts";
import { recordRoots, treeRlOptions } from "./tree-rl-fixtures.ts";

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
 * Builds the options the process crash fixture and its test share: the serial Tree-RL run over two
 * synthetic roots (recorded idempotently under fixed commands) or the optimizer with one scripted
 * iteration of two provider edits, both writing under a fixed or caller-supplied lease clock.
 */
export async function replayCrashOptions(
    store: SQLiteTraceStore,
    application: "counterfactual_optimization" | "tree_rl",
    commandId: string,
    clock: () => number = () => CRASH_CLOCK_MILLISECONDS,
): Promise<ReplayCrashOptions> {
    if (application === "tree_rl") {
        const labels = await recordRoots(store, ["base", "alt"], `${commandId}:root`);
        return {
            kind: application,
            options: treeRlOptions(commandId, labels, { clock, concurrency: 1 }),
        };
    }
    return {
        kind: application,
        options: optimizerOptions(commandId, {
            clock,
            proposer: scriptedProposer([
                [
                    {
                        edits: [providerEdit("dies", 0, "alt"), providerEdit("later", 2, "later")],
                        parent: null,
                        reflection: reflection(null),
                    },
                ],
            ]),
        }),
    };
}
