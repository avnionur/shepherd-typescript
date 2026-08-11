import type { SemanticValue } from "../canonical/canonical-record.ts";
import { runProtocolConfig } from "../protocol/config.ts";
import { RUN_CONTROL_STATUSES } from "../protocol/values.generated.ts";
import type { ModelResponse } from "../provider/types.ts";
import { readModelResponse } from "../provider/validation.ts";
import type { TaskSchema } from "../task/schema.ts";
import type { RunArtifact } from "./artifact-types.ts";
import { createRunArtifact } from "./artifacts.ts";
import { createRunControl } from "./control.ts";
import type { RunControlSnapshot } from "./control-types.ts";
import {
    normalizeTaskValue,
    type PreparedTaskExecution,
    prepareTaskExecution,
} from "./execution-preparation.ts";
import {
    createControlEnding,
    createFailedExecution,
    createFinishedExecution,
    readExecutionErrorMessage,
    readProviderErrorName,
} from "./execution-results.ts";
import type { TaskExecutionOptions, TaskExecutionResult } from "./execution-types.ts";
import { createRunUsage } from "./usage.ts";

const [ACTIVE_CONTROL_STATUS] = RUN_CONTROL_STATUSES;

/**
 * Executes one validated bodyless task through a provider-neutral structured boundary.
 *
 * @param options - Exact task, inferred input, provider, run identity, budget, and cancellation.
 * @returns Ordered artifacts, terminal outcome, aggregate usage, provider identity, and control.
 * @throws {TypeError} If caller-owned task input or execution control options are malformed.
 *
 * @example
 * ```ts
 * const execution = await executeTask({
 *     task: greet,
 *     input: { name: "Ada" },
 *     provider,
 *     runId: "run:greet:1",
 *     budget: { maxTurns: 1 },
 * });
 * ```
 *
 * @public
 */
export async function executeTask<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>>(
    options: TaskExecutionOptions<I, O>,
): Promise<TaskExecutionResult> {
    return executePreparedTask(prepareTaskExecution(options));
}

/** Executes validated inputs and optionally records the exact start boundary. @internal */
export async function executePreparedTask<
    I extends TaskSchema<unknown>,
    O extends TaskSchema<unknown>,
>(prepared: PreparedTaskExecution<I, O>, onStarted?: () => void): Promise<TaskExecutionResult> {
    const { definition, input, provider } = prepared;
    const control = createRunControl({
        budget: definition.budget,
        ...(definition.signal === undefined ? {} : { signal: definition.signal }),
    });
    try {
        const initialSnapshot = control.snapshot();
        if (initialSnapshot.status !== ACTIVE_CONTROL_STATUS) {
            return createControlEnding(
                definition.runId,
                definition.task.artifactLock,
                provider,
                control,
                initialSnapshot,
                null,
            );
        }
        const turnSnapshot = control.consume({ turns: 1 });
        if (turnSnapshot.status !== ACTIVE_CONTROL_STATUS) {
            return createControlEnding(
                definition.runId,
                definition.task.artifactLock,
                provider,
                control,
                turnSnapshot,
                null,
            );
        }
        onStarted?.();
        let response: ModelResponse;
        try {
            response = readModelResponse(
                await definition.provider.invoke(
                    {
                        input,
                        instruction: definition.task.instruction,
                        outputSchema: definition.task.artifact.output_schema,
                    },
                    control.signal,
                ),
            );
        } catch (error) {
            const snapshot = control.snapshot();
            if (snapshot.status !== ACTIVE_CONTROL_STATUS) {
                return createControlEnding(
                    definition.runId,
                    definition.task.artifactLock,
                    provider,
                    control,
                    snapshot,
                    null,
                );
            }
            return createFailedExecution(
                definition.runId,
                definition.task.artifactLock,
                provider,
                snapshot,
                null,
                readProviderErrorName(error),
                readExecutionErrorMessage(
                    error,
                    runProtocolConfig.execution.errors.providerFailureMessage,
                ),
            );
        }
        const usage = createRunUsage({
            cacheCreationInputTokens: response.usage.cacheCreationInputTokens,
            cacheReadInputTokens: response.usage.cacheReadInputTokens,
            ...(response.usage.costUsd === null ? {} : { costUsd: response.usage.costUsd }),
            inputTokens: response.usage.inputTokens,
            outputTokens: response.usage.outputTokens,
            runId: definition.runId,
        });
        const artifacts = createExecutionArtifacts(definition.runId, response);
        let usageSnapshot: RunControlSnapshot;
        try {
            usageSnapshot = control.consume({
                ...(response.usage.costUsd === null ? {} : { costUsd: response.usage.costUsd }),
                inputTokens: response.usage.inputTokens,
                outputTokens: response.usage.outputTokens,
            });
        } catch {
            return createControlEnding(
                definition.runId,
                definition.task.artifactLock,
                provider,
                control,
                control.snapshot(),
                usage,
                artifacts,
            );
        }
        if (usageSnapshot.status !== ACTIVE_CONTROL_STATUS) {
            return createControlEnding(
                definition.runId,
                definition.task.artifactLock,
                provider,
                control,
                usageSnapshot,
                usage,
                artifacts,
            );
        }
        if (definition.budget.maxCostUsd !== undefined && response.usage.costUsd === null) {
            return createFailedExecution(
                definition.runId,
                definition.task.artifactLock,
                provider,
                usageSnapshot,
                usage,
                runProtocolConfig.execution.errors.costUnavailableType,
                runProtocolConfig.execution.errors.costUnavailableMessage,
                false,
                artifacts,
            );
        }
        let value: SemanticValue;
        try {
            value = normalizeTaskValue(definition.task.parseOutput(response.output));
        } catch (error) {
            const message = readExecutionErrorMessage(
                error,
                runProtocolConfig.execution.errors.outputValidationMessage,
            );
            return createFailedExecution(
                definition.runId,
                definition.task.artifactLock,
                provider,
                control.snapshot(),
                usage,
                runProtocolConfig.execution.errors.outputValidationType,
                message,
                false,
                artifacts,
            );
        }
        return createFinishedExecution(
            definition.runId,
            definition.task.artifactLock,
            provider,
            control.snapshot(),
            usage,
            value,
            artifacts,
        );
    } finally {
        control.dispose();
    }
}

function createExecutionArtifacts(runId: string, response: ModelResponse): readonly RunArtifact[] {
    return Object.freeze(
        (response.artifacts ?? []).map((artifact, index) =>
            createRunArtifact({
                artifactOrdinal: runProtocolConfig.firstArtifactOrdinal + index,
                content: artifact.content,
                kind: artifact.kind,
                metadata: artifact.metadata,
                name: artifact.name,
                runId,
            }),
        ),
    );
}
