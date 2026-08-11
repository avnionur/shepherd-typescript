import type { SemanticRecord } from "../canonical/canonical-record.ts";
import { DURABLE_EXECUTION_CONTROL_COMMAND_KINDS } from "../protocol/values.generated.ts";
import { assertRecordId } from "../record/guards.ts";
import type {
    DurableExecutionCancellationCommand,
    DurableExecutionPauseCommand,
    DurableExecutionRecoveryCommand,
    DurableExecutionResumeCommand,
} from "./durable-execution-control-types.ts";
import { assertRunText, readRunDataObject } from "./validation-values.ts";

const [RECOVER_COMMAND_KIND, PAUSE_COMMAND_KIND, RESUME_COMMAND_KIND, CANCEL_COMMAND_KIND] =
    DURABLE_EXECUTION_CONTROL_COMMAND_KINDS;

/**
 * Creates one canonical durable cancellation-command body.
 *
 * @param runId - Running durable run to cancel.
 * @param commandId - Globally idempotent caller command identity.
 * @param expectedLifecycleRecordId - Exact running lifecycle record expected by the caller.
 * @param fencingToken - Exact current invocation fencing token.
 * @param reason - Non-empty operator or controller reason.
 * @returns The canonical cancellation-command semantic body.
 * @internal
 */
export function createDurableCancellationCommand(
    runId: string,
    commandId: string,
    expectedLifecycleRecordId: string,
    fencingToken: number,
    reason: string,
): DurableExecutionCancellationCommand & SemanticRecord {
    return {
        command_id: commandId,
        command_kind: CANCEL_COMMAND_KIND,
        execution_id: runId,
        expected_lifecycle_record_id: expectedLifecycleRecordId,
        fencing_token: fencingToken,
        reason,
    };
}

/**
 * Validates and decodes one canonical durable cancellation-command body.
 *
 * @param value - Unknown retained semantic body.
 * @param runId - Durable run the command must target.
 * @returns The validated cancellation command.
 * @throws {TypeError} If the body is malformed or targets another run.
 * @internal
 */
export function readDurableCancellationCommand(
    value: unknown,
    runId: string,
): DurableExecutionCancellationCommand {
    const body = readRunDataObject(
        value,
        [
            "command_id",
            "command_kind",
            "execution_id",
            "expected_lifecycle_record_id",
            "fencing_token",
            "reason",
        ],
        "durable cancellation command",
    );
    assertRunText(body.command_id, "durable cancellation command identity");
    assertRecordId(
        body.expected_lifecycle_record_id,
        "durable cancellation expected lifecycle identity",
    );
    assertRunText(body.reason, "durable cancellation reason");
    if (
        body.command_kind !== CANCEL_COMMAND_KIND ||
        body.execution_id !== runId ||
        !Number.isSafeInteger(body.fencing_token) ||
        (body.fencing_token as number) <= 0
    ) {
        throw new TypeError("durable cancellation command payload is inconsistent");
    }
    return body as DurableExecutionCancellationCommand;
}

/**
 * Creates one canonical durable resume-command body.
 *
 * @param runId - Suspended durable run to resume.
 * @param commandId - Globally idempotent caller command identity.
 * @param expectedLifecycleRecordId - Exact suspension acknowledgement expected by the caller.
 * @param continuationDescriptorRecordId - Exact continuation descriptor cited by suspension.
 * @returns The canonical resume-command semantic body.
 * @internal
 */
export function createDurableResumeCommand(
    runId: string,
    commandId: string,
    expectedLifecycleRecordId: string,
    continuationDescriptorRecordId: string,
): DurableExecutionResumeCommand & SemanticRecord {
    return {
        command_id: commandId,
        command_kind: RESUME_COMMAND_KIND,
        continuation_descriptor_id: continuationDescriptorRecordId,
        execution_id: runId,
        expected_lifecycle_record_id: expectedLifecycleRecordId,
    };
}

/**
 * Validates and decodes one canonical durable resume-command body.
 *
 * @param value - Unknown retained semantic body.
 * @param runId - Durable run the command must target.
 * @returns The validated resume command.
 * @throws {TypeError} If the body is malformed or targets another run.
 * @internal
 */
export function readDurableResumeCommand(
    value: unknown,
    runId: string,
): DurableExecutionResumeCommand {
    const body = readRunDataObject(
        value,
        [
            "command_id",
            "command_kind",
            "continuation_descriptor_id",
            "execution_id",
            "expected_lifecycle_record_id",
        ],
        "durable resume command",
    );
    assertRunText(body.command_id, "durable resume command identity");
    assertRecordId(
        body.continuation_descriptor_id,
        "durable resume continuation descriptor identity",
    );
    assertRecordId(body.expected_lifecycle_record_id, "durable resume lifecycle identity");
    if (body.command_kind !== RESUME_COMMAND_KIND || body.execution_id !== runId) {
        throw new TypeError("durable resume command payload is inconsistent");
    }
    return body as DurableExecutionResumeCommand;
}

/**
 * Creates one canonical durable pause-command body.
 *
 * @param runId - Durable run whose running lifecycle is targeted.
 * @param commandId - Globally idempotent caller command identity.
 * @param expectedLifecycleRecordId - Exact running lifecycle record expected by the caller.
 * @param fencingToken - Exact current invocation fencing token.
 * @param reason - Non-empty operator or controller reason.
 * @returns The canonical pause-command semantic body.
 * @internal
 */
export function createDurablePauseCommand(
    runId: string,
    commandId: string,
    expectedLifecycleRecordId: string,
    fencingToken: number,
    reason: string,
): DurableExecutionPauseCommand & SemanticRecord {
    return {
        command_id: commandId,
        command_kind: PAUSE_COMMAND_KIND,
        execution_id: runId,
        expected_lifecycle_record_id: expectedLifecycleRecordId,
        fencing_token: fencingToken,
        reason,
    };
}

/**
 * Validates and decodes one canonical durable pause-command body.
 *
 * @param value - Unknown retained semantic body.
 * @param runId - Durable run the command must target.
 * @returns The validated pause command.
 * @throws {TypeError} If the body is malformed or targets another run.
 * @internal
 */
export function readDurablePauseCommand(
    value: unknown,
    runId: string,
): DurableExecutionPauseCommand {
    const body = readRunDataObject(
        value,
        [
            "command_id",
            "command_kind",
            "execution_id",
            "expected_lifecycle_record_id",
            "fencing_token",
            "reason",
        ],
        "durable pause command",
    );
    assertRunText(body.command_id, "durable pause command identity");
    assertRecordId(body.expected_lifecycle_record_id, "durable pause expected lifecycle identity");
    assertRunText(body.reason, "durable pause reason");
    if (
        body.command_kind !== PAUSE_COMMAND_KIND ||
        body.execution_id !== runId ||
        !Number.isSafeInteger(body.fencing_token) ||
        (body.fencing_token as number) <= 0
    ) {
        throw new TypeError("durable pause command payload is inconsistent");
    }
    return body as DurableExecutionPauseCommand;
}

/**
 * Creates one canonical durable recovery-command body.
 *
 * @param runId - Existing durable run to recover.
 * @param commandId - Globally idempotent caller command identity.
 * @returns The canonical recovery-command semantic body.
 * @internal
 */
export function createDurableRecoveryCommand(
    runId: string,
    commandId: string,
): DurableExecutionRecoveryCommand & SemanticRecord {
    return {
        command_id: commandId,
        command_kind: RECOVER_COMMAND_KIND,
        execution_id: runId,
    };
}

/**
 * Validates and decodes one canonical durable recovery-command body.
 *
 * @param value - Unknown retained semantic body.
 * @param runId - Durable run the command must target.
 * @returns The validated recovery command.
 * @throws {TypeError} If the body is malformed or targets another run.
 * @internal
 */
export function readDurableRecoveryCommand(
    value: unknown,
    runId: string,
): DurableExecutionRecoveryCommand {
    const body = readRunDataObject(
        value,
        ["command_id", "command_kind", "execution_id"],
        "durable recovery command",
    );
    assertRunText(body.command_id, "durable recovery command identity");
    if (body.command_kind !== RECOVER_COMMAND_KIND || body.execution_id !== runId) {
        throw new TypeError("durable recovery command payload is inconsistent");
    }
    return body as DurableExecutionRecoveryCommand;
}
