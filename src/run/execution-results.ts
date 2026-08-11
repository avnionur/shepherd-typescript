import type { SemanticValue } from "../canonical/canonical-record.ts";
import { runProtocolConfig } from "../protocol/config.ts";
import { RUN_CONTROL_STATUSES, RUN_TERMINAL_STATUSES } from "../protocol/values.generated.ts";
import type { ProviderDescriptor } from "../provider/types.ts";
import type { TaskArtifactLock } from "../task/types.ts";
import type { RunArtifact } from "./artifact-types.ts";
import type { RunCancellationReason, RunControl, RunControlSnapshot } from "./control-types.ts";
import type { TaskExecutionResult } from "./execution-types.ts";
import { createRunOutcome } from "./outcomes.ts";
import type { RunUsage } from "./usage-types.ts";

const [FINISHED_STATUS, FAILED_STATUS, EXHAUSTED_STATUS, CANCELLED_STATUS] = RUN_TERMINAL_STATUSES;
const [, EXHAUSTED_CONTROL_STATUS] = RUN_CONTROL_STATUSES;

/** Creates a successful immutable executor result. @internal */
export function createFinishedExecution(
    runId: string,
    taskArtifactLock: TaskArtifactLock,
    provider: ProviderDescriptor,
    control: RunControlSnapshot,
    usage: RunUsage,
    value: SemanticValue,
    artifacts: readonly RunArtifact[],
): TaskExecutionResult {
    return Object.freeze({
        artifacts,
        control,
        outcome: createRunOutcome({
            outcome: { status: FINISHED_STATUS, value },
            runId,
            taskArtifactLock,
        }),
        provider,
        usage,
    });
}

/** Creates a failed immutable executor result. @internal */
export function createFailedExecution(
    runId: string,
    taskArtifactLock: TaskArtifactLock,
    provider: ProviderDescriptor,
    control: RunControlSnapshot,
    usage: RunUsage | null,
    errorType: string,
    message: string,
    retryable?: boolean,
    artifacts: readonly RunArtifact[] = Object.freeze([]),
): TaskExecutionResult {
    return Object.freeze({
        artifacts,
        control,
        outcome: createRunOutcome({
            outcome: {
                errorType,
                message,
                ...(retryable === undefined ? {} : { retryable }),
                status: FAILED_STATUS,
            },
            runId,
            taskArtifactLock,
        }),
        provider,
        usage,
    });
}

/** Creates an exhausted or cancelled immutable executor result. @internal */
export function createControlEnding(
    runId: string,
    taskArtifactLock: TaskArtifactLock,
    provider: ProviderDescriptor,
    control: RunControl,
    snapshot: RunControlSnapshot,
    usage: RunUsage | null,
    artifacts: readonly RunArtifact[] = Object.freeze([]),
): TaskExecutionResult {
    if (snapshot.status === EXHAUSTED_CONTROL_STATUS) {
        return Object.freeze({
            artifacts,
            control: snapshot,
            outcome: createRunOutcome({
                outcome: {
                    reason: readExecutionErrorMessage(
                        control.signal.reason,
                        runProtocolConfig.execution.errors.providerFailureMessage,
                    ),
                    status: EXHAUSTED_STATUS,
                },
                runId,
                taskArtifactLock,
            }),
            provider,
            usage,
        });
    }
    const reason = snapshot.reason as RunCancellationReason;
    return Object.freeze({
        artifacts,
        control: snapshot,
        outcome: createRunOutcome({
            outcome: { reason: reason.message, status: CANCELLED_STATUS },
            runId,
            taskArtifactLock,
        }),
        provider,
        usage,
    });
}

/** Reads safe error text with a caller-selected fallback. @internal */
export function readExecutionErrorMessage(error: unknown, fallback: string): string {
    return readErrorText(error, "message", fallback);
}

/** Reads safe provider error classification with the configured fallback. @internal */
export function readProviderErrorName(error: unknown): string {
    return readErrorText(error, "name", runProtocolConfig.execution.errors.providerFailureType);
}

function readErrorText(error: unknown, key: "message" | "name", fallback: string): string {
    if (!(error instanceof Error)) {
        return fallback;
    }
    let value: unknown;
    try {
        value = Reflect.get(error, key);
    } catch {
        return fallback;
    }
    return typeof value === "string" && isNonEmptyWellFormedText(value) ? value : fallback;
}

function isNonEmptyWellFormedText(value: string): boolean {
    return value.length > 0 && !/[\uD800-\uDFFF]/u.test(value);
}
