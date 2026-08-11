import {
    canonicalizeRecord,
    type SemanticRecord,
    type SemanticValue,
} from "../canonical/canonical-record.ts";
import { runProtocolConfig } from "../protocol/config.ts";
import {
    RUN_ARTIFACT_CONTENT_TYPES,
    RUN_BUDGET_METRICS,
    RUN_CONTROL_STATUSES,
    RUN_TERMINAL_STATUSES,
} from "../protocol/values.generated.ts";
import type { ProviderDescriptor } from "../provider/types.ts";
import { readProviderDescriptor } from "../provider/validation.ts";
import { readTaskArtifactLock } from "../task/registry-codec.ts";
import type { TaskArtifactLock } from "../task/types.ts";
import type { RunArtifact } from "./artifact-types.ts";
import { createRunArtifact } from "./artifacts.ts";
import { formatRunBudgetExhaustionReason } from "./control-errors.ts";
import type {
    RunBudgetDefinition,
    RunBudgetExhaustionReason,
    RunCancellationReason,
    RunControlSnapshot,
} from "./control-types.ts";
import { readRunControlOptions, readRunControlSnapshot } from "./control-validation.ts";
import type { TaskExecutionResult } from "./execution-types.ts";
import { createRunOutcome } from "./outcomes.ts";
import type { RunOutcome } from "./types.ts";
import { createRunUsage } from "./usage.ts";
import type { RunUsage } from "./usage-types.ts";
import { assertRunText, readRunDataObject } from "./validation-values.ts";

const [FINISHED_STATUS, FAILED_STATUS, EXHAUSTED_STATUS, CANCELLED_STATUS] = RUN_TERMINAL_STATUSES;
const [TEXT_ARTIFACT_TYPE, BLOB_ARTIFACT_TYPE] = RUN_ARTIFACT_CONTENT_TYPES;
const [ACTIVE_CONTROL_STATUS, EXHAUSTED_CONTROL_STATUS, CANCELLED_CONTROL_STATUS] =
    RUN_CONTROL_STATUSES;
const [
    TURNS_METRIC,
    EFFECTS_METRIC,
    DURATION_METRIC,
    INPUT_TOKENS_METRIC,
    OUTPUT_TOKENS_METRIC,
    COST_METRIC,
] = RUN_BUDGET_METRICS;

type DurableCreationEvidence = {
    readonly budget: RunBudgetDefinition;
    readonly provider: ProviderDescriptor;
    readonly taskArtifactLock: TaskArtifactLock;
};

/** Reads validated execution evidence retained by a durable creation payload. @internal */
export function readDurableCreation(value: unknown, runId: string): DurableCreationEvidence {
    const fields = readRunDataObject(
        value,
        [
            "budget",
            "execution_id",
            "inputs",
            "parent_execution_id",
            "provider",
            "task_artifact_lock",
            "task_ref",
        ],
        "durable execution creation payload",
    );
    if (fields.execution_id !== runId || fields.parent_execution_id !== null) {
        throw new TypeError("durable execution creation identity is inconsistent");
    }
    const { budget } = readRunControlOptions({ budget: fields.budget as never });
    const lock = readTaskArtifactLock(fields.task_artifact_lock);
    if (fields.task_ref !== lock.artifact_digest) {
        throw new TypeError("durable execution task reference does not match its lock");
    }
    const inputs = readRunDataObject(fields.inputs, ["value"], "durable execution inputs");
    canonicalizeRecord({ value: inputs.value as SemanticValue });
    return Object.freeze({
        budget,
        provider: readProviderDescriptor(fields.provider),
        taskArtifactLock: lock,
    });
}

/** Reconstructs one validated immutable execution result from retained values. @internal */
export function readDurableExecutionResult(
    artifactValues: readonly unknown[],
    outcomeValue: unknown,
    usageValue: unknown,
    providerValue: unknown,
    controlValue: unknown,
    budget: RunBudgetDefinition,
    started: boolean,
    runId: string,
): TaskExecutionResult {
    const result = Object.freeze({
        artifacts: Object.freeze(
            artifactValues.map((value, index) => readStoredRunArtifact(value, runId, index)),
        ),
        control: readRunControlSnapshot(controlValue),
        outcome: readStoredRunOutcome(outcomeValue, runId),
        provider: readProviderDescriptor(providerValue),
        usage: usageValue === null ? null : readStoredRunUsage(usageValue, runId),
    });
    const expectedControlStatus =
        result.outcome.outcome.status === EXHAUSTED_STATUS
            ? EXHAUSTED_CONTROL_STATUS
            : result.outcome.outcome.status === CANCELLED_STATUS
              ? CANCELLED_CONTROL_STATUS
              : ACTIVE_CONTROL_STATUS;
    if (result.control.status !== expectedControlStatus) {
        throw new TypeError("durable outcome and control statuses are inconsistent");
    }
    if (
        result.outcome.outcome.status === EXHAUSTED_STATUS &&
        result.outcome.outcome.reason !==
            formatRunBudgetExhaustionReason(result.control.reason as RunBudgetExhaustionReason)
    ) {
        throw new TypeError("durable exhausted outcome and control reasons are inconsistent");
    }
    if (
        result.outcome.outcome.status === CANCELLED_STATUS &&
        (result.outcome.outcome.reason !==
            (result.control.reason as RunCancellationReason).message ||
            result.outcome.outcome.reason !== runProtocolConfig.control.cancellationReason)
    ) {
        throw new TypeError("durable cancelled outcome and control reasons are inconsistent");
    }
    validateRecoveredAccounting(result.control, result.usage, budget, started);
    return result;
}

function readStoredRunArtifact(value: unknown, runId: string, index: number): RunArtifact {
    const fields = readRunDataObject(
        value,
        ["artifact_ordinal", "artifact_version", "content", "kind", "metadata", "name", "run_id"],
        `durable run artifact[${index}]`,
    );
    const expectedOrdinal = runProtocolConfig.firstArtifactOrdinal + index;
    if (
        fields.artifact_version !== runProtocolConfig.artifactVersion ||
        fields.artifact_ordinal !== expectedOrdinal ||
        fields.run_id !== runId
    ) {
        throw new TypeError("durable run artifact identity, version, or order is inconsistent");
    }
    const content = readRunDataObject(
        fields.content,
        ["type"],
        `durable run artifact[${index}] content`,
        ["blob_id", "byte_length", "text"],
    );
    if (content.type === TEXT_ARTIFACT_TYPE) {
        const text = readRunDataObject(
            fields.content,
            ["text", "type"],
            `durable run artifact[${index}] text content`,
        );
        return createRunArtifact({
            artifactOrdinal: expectedOrdinal,
            content: {
                text: text.text as string,
                type: TEXT_ARTIFACT_TYPE,
            },
            kind: fields.kind as string,
            metadata: fields.metadata as SemanticRecord,
            name: fields.name as string,
            runId,
        });
    }
    if (content.type !== BLOB_ARTIFACT_TYPE) {
        throw new TypeError("durable run artifact content type is not configured");
    }
    const blob = readRunDataObject(
        fields.content,
        ["blob_id", "byte_length", "type"],
        `durable run artifact[${index}] blob content`,
    );
    return createRunArtifact({
        artifactOrdinal: expectedOrdinal,
        content: {
            receipt: {
                blob_id: blob.blob_id as string,
                byte_length: blob.byte_length as number,
            },
            type: BLOB_ARTIFACT_TYPE,
        },
        kind: fields.kind as string,
        metadata: fields.metadata as SemanticRecord,
        name: fields.name as string,
        runId,
    });
}

function validateRecoveredAccounting(
    control: RunControlSnapshot,
    usage: RunUsage | null,
    budget: RunBudgetDefinition,
    started: boolean,
): void {
    const { consumed } = control;
    if (consumed.effects !== 0) {
        throw new TypeError("durable execution control contains unsupported effect consumption");
    }
    const exhaustionReason =
        control.status === EXHAUSTED_CONTROL_STATUS
            ? (control.reason as RunBudgetExhaustionReason)
            : null;
    const turnExhaustion = exhaustionReason !== null && exhaustionReason.metric === TURNS_METRIC;
    if (consumed.turns !== (started || turnExhaustion ? 1 : 0)) {
        throw new TypeError("durable execution start and turn consumption are inconsistent");
    }
    if (exhaustionReason !== null) {
        const reason = exhaustionReason;
        const configuredLimit = readBudgetLimit(budget, reason.metric);
        if (configuredLimit !== reason.limit || reason.observed <= reason.limit) {
            throw new TypeError("durable exhaustion reason disagrees with its creation budget");
        }
        const observed = readConsumedMetric(consumed, reason.metric);
        if (observed !== null && observed !== reason.observed) {
            throw new TypeError("durable exhaustion reason disagrees with control consumption");
        }
    }
    const providerConsumption = [consumed.inputTokens, consumed.outputTokens, consumed.costUsd];
    if (usage === null) {
        if (providerConsumption.some((value) => value !== 0)) {
            throw new TypeError("durable control fabricates provider usage");
        }
        return;
    }
    const expected = [usage.input_tokens, usage.output_tokens, usage.cost_usd ?? 0];
    const exact = providerConsumption.every((value, index) => value === expected[index]);
    const late = providerConsumption.every((value) => value === 0);
    const lateAllowed =
        control.status === CANCELLED_CONTROL_STATUS || exhaustionReason?.metric === DURATION_METRIC;
    if (!exact && !(lateAllowed && late)) {
        throw new TypeError("durable control and retained provider usage are inconsistent");
    }
}

function readBudgetLimit(budget: RunBudgetDefinition, metric: string): number | undefined {
    const limits: Readonly<Record<string, number | undefined>> = {
        [COST_METRIC]: budget.maxCostUsd,
        [DURATION_METRIC]: budget.maxDurationMilliseconds,
        [EFFECTS_METRIC]: budget.maxEffects,
        [INPUT_TOKENS_METRIC]: budget.maxInputTokens,
        [OUTPUT_TOKENS_METRIC]: budget.maxOutputTokens,
        [TURNS_METRIC]: budget.maxTurns,
    };
    return limits[metric];
}

function readConsumedMetric(
    consumed: RunControlSnapshot["consumed"],
    metric: string,
): number | null {
    const values: Readonly<Record<string, number | null>> = {
        [COST_METRIC]: consumed.costUsd,
        [DURATION_METRIC]: null,
        [EFFECTS_METRIC]: consumed.effects,
        [INPUT_TOKENS_METRIC]: consumed.inputTokens,
        [OUTPUT_TOKENS_METRIC]: consumed.outputTokens,
        [TURNS_METRIC]: consumed.turns,
    };
    return values[metric] ?? null;
}

function readStoredRunOutcome(value: unknown, runId: string): RunOutcome {
    const fields = readRunDataObject(
        value,
        ["outcome", "outcome_version", "run_id", "task_artifact_lock"],
        "durable run outcome",
    );
    if (fields.outcome_version !== runProtocolConfig.outcomeVersion || fields.run_id !== runId) {
        throw new TypeError("durable run outcome identity or version is inconsistent");
    }
    const candidate = readRunDataObject(fields.outcome, ["status"], "durable terminal outcome", [
        "error_type",
        "message",
        "reason",
        "retryable",
        "value",
    ]);
    const taskArtifactLock = readTaskArtifactLock(fields.task_artifact_lock);
    if (candidate.status === FINISHED_STATUS) {
        const terminal = readRunDataObject(
            fields.outcome,
            ["status", "value"],
            "durable finished outcome",
        );
        return createRunOutcome({
            outcome: { status: FINISHED_STATUS, value: terminal.value as SemanticValue },
            runId,
            taskArtifactLock,
        });
    }
    if (candidate.status === FAILED_STATUS) {
        const terminal = readRunDataObject(
            fields.outcome,
            ["error_type", "message", "retryable", "status"],
            "durable failed outcome",
        );
        assertRunText(terminal.error_type, "durable failed outcome error type");
        assertRunText(terminal.message, "durable failed outcome message");
        if (terminal.retryable !== null && typeof terminal.retryable !== "boolean") {
            throw new TypeError("durable failed outcome retryable is malformed");
        }
        return createRunOutcome({
            outcome: {
                errorType: terminal.error_type,
                message: terminal.message,
                ...(terminal.retryable === null ? {} : { retryable: terminal.retryable }),
                status: FAILED_STATUS,
            },
            runId,
            taskArtifactLock,
        });
    }
    if (candidate.status !== EXHAUSTED_STATUS && candidate.status !== CANCELLED_STATUS) {
        throw new TypeError("durable terminal outcome status is not configured");
    }
    const terminal = readRunDataObject(
        fields.outcome,
        ["reason", "status"],
        "durable control outcome",
    );
    assertRunText(terminal.reason, "durable control outcome reason");
    return createRunOutcome({
        outcome: { reason: terminal.reason, status: candidate.status },
        runId,
        taskArtifactLock,
    });
}

function readStoredRunUsage(value: unknown, runId: string): RunUsage {
    const fields = readRunDataObject(
        value,
        [
            "cache_creation_input_tokens",
            "cache_read_input_tokens",
            "cost_usd",
            "input_tokens",
            "output_tokens",
            "run_id",
            "usage_version",
        ],
        "durable run usage",
    );
    if (fields.usage_version !== runProtocolConfig.usageVersion || fields.run_id !== runId) {
        throw new TypeError("durable run usage identity or version is inconsistent");
    }
    return createRunUsage({
        cacheCreationInputTokens: fields.cache_creation_input_tokens as number,
        cacheReadInputTokens: fields.cache_read_input_tokens as number,
        ...(fields.cost_usd === null ? {} : { costUsd: fields.cost_usd as number }),
        inputTokens: fields.input_tokens as number,
        outputTokens: fields.output_tokens as number,
        runId,
    });
}
