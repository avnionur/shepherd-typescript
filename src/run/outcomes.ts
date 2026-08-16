import { createCanonicalSnapshot } from "../canonical/snapshot.ts";
import { runProtocolConfig } from "../protocol/config.ts";
import type { RunOutcomeDefinition, RunOutcomeFor, RunTerminalDefinition } from "./types.ts";
import { readRunOutcomeDefinition } from "./validation.ts";

/**
 * Creates an immutable versioned record for exactly one terminal task-run result.
 *
 * @param definition - Run identity, exact task lock, and one terminal outcome definition.
 * @returns A deeply frozen canonical record preserving the exact terminal discriminant.
 * @throws {TypeError} If the definition, task lock, or terminal payload is malformed.
 *
 * @example
 * ```ts
 * const outcome = createRunOutcome({
 *     runId: "run:example",
 *     taskArtifactLock: taskDescriptor.artifactLock,
 *     outcome: { status: "finished", value: { answer: 42 } },
 * });
 * ```
 *
 * @public
 */
export function createRunOutcome<O extends RunTerminalDefinition>(
    definition: RunOutcomeDefinition<O>,
): RunOutcomeFor<O> {
    const values = readRunOutcomeDefinition(definition);
    return createCanonicalSnapshot({
        outcome_version: runProtocolConfig.outcomeVersion,
        outcome: values.outcome,
        run_id: values.runId,
        task_artifact_lock: values.taskArtifactLock,
    }) as RunOutcomeFor<O>;
}
