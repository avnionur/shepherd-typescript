import assert from "node:assert/strict";
import { test } from "node:test";
import { ROOT_WITNESS_ID } from "../../src/index.ts";
import {
    createDurableCancellationCommand,
    createDurablePauseCommand,
    createDurableRecoveryCommand,
    createDurableResumeCommand,
    readDurableCancellationCommand,
    readDurablePauseCommand,
    readDurableRecoveryCommand,
    readDurableResumeCommand,
} from "../../src/run/durable-execution-control-codec.ts";

test("durable cancellation command codec validates exact fenced command content", () => {
    const command = createDurableCancellationCommand(
        "run:cancel-command-codec",
        "command:cancel-codec",
        ROOT_WITNESS_ID,
        3,
        "operator cancellation",
    );
    assert.deepEqual(
        { ...readDurableCancellationCommand(command, "run:cancel-command-codec") },
        command,
    );
    for (const malformed of [
        { ...command, command_id: "" },
        { ...command, command_kind: "unsupported" },
        { ...command, execution_id: "run:other" },
        { ...command, expected_lifecycle_record_id: "invalid" },
        { ...command, fencing_token: "3" },
        { ...command, fencing_token: 0 },
        { ...command, reason: "" },
    ]) {
        assert.throws(
            () => readDurableCancellationCommand(malformed, "run:cancel-command-codec"),
            TypeError,
        );
    }
});

test("durable resume command codec binds command, suspension, descriptor, and run", () => {
    const command = createDurableResumeCommand(
        "run:resume-command-codec",
        "command:resume-codec",
        ROOT_WITNESS_ID,
        ROOT_WITNESS_ID,
    );
    assert.deepEqual({ ...readDurableResumeCommand(command, "run:resume-command-codec") }, command);
    for (const malformed of [
        { ...command, command_id: "" },
        { ...command, command_kind: "unsupported" },
        { ...command, execution_id: "run:other" },
        { ...command, expected_lifecycle_record_id: "invalid" },
        { ...command, continuation_descriptor_id: "invalid" },
    ]) {
        assert.throws(
            () => readDurableResumeCommand(malformed, "run:resume-command-codec"),
            TypeError,
        );
    }
});

test("durable pause command codec validates the exact fenced lifecycle request", () => {
    const command = createDurablePauseCommand(
        "run:pause-command-codec",
        "command:pause-codec",
        ROOT_WITNESS_ID,
        3,
        "operator pause",
    );
    assert.deepEqual({ ...readDurablePauseCommand(command, "run:pause-command-codec") }, command);
    for (const malformed of [
        { ...command, command_id: "" },
        { ...command, command_kind: "unsupported" },
        { ...command, execution_id: "run:other" },
        { ...command, expected_lifecycle_record_id: "invalid" },
        { ...command, fencing_token: "3" },
        { ...command, fencing_token: 0 },
        { ...command, reason: "" },
    ]) {
        assert.throws(
            () => readDurablePauseCommand(malformed, "run:pause-command-codec"),
            TypeError,
        );
    }
});

test("durable recovery command codec validates identity, kind, and run binding", () => {
    const command = createDurableRecoveryCommand(
        "run:recovery-command-codec",
        "command:recovery-codec",
    );
    assert.deepEqual(
        { ...readDurableRecoveryCommand(command, "run:recovery-command-codec") },
        command,
    );
    for (const malformed of [
        { ...command, command_id: "" },
        { ...command, command_kind: "unsupported" },
        { ...command, execution_id: "run:other" },
    ]) {
        assert.throws(
            () => readDurableRecoveryCommand(malformed, "run:recovery-command-codec"),
            TypeError,
        );
    }
});
