import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { createRunOutcome, type TaskArtifactLock } from "../../src/index.ts";

const fixture = JSON.parse(
    readFileSync(new URL("../fixtures/run-outcome-v1.json", import.meta.url), "utf8"),
) as Readonly<Record<string, unknown>>;
const taskArtifactLock = (fixture.finished as { readonly task_artifact_lock: TaskArtifactLock })
    .task_artifact_lock;

test("createRunOutcome creates every immutable terminal run outcome", () => {
    const outcomes = {
        cancelled: createRunOutcome({
            outcome: { reason: "caller aborted", status: "cancelled" },
            runId: "run:write-note:4",
            taskArtifactLock,
        }),
        exhausted: createRunOutcome({
            outcome: { reason: "maximum turns reached", status: "exhausted" },
            runId: "run:write-note:3",
            taskArtifactLock,
        }),
        failed: createRunOutcome({
            outcome: {
                errorType: "ProviderError",
                message: "provider unavailable",
                retryable: true,
                status: "failed",
            },
            runId: "run:write-note:2",
            taskArtifactLock,
        }),
        finished: createRunOutcome({
            outcome: {
                status: "finished",
                value: { note: "Shepherd records execution as data." },
            },
            runId: "run:write-note:1",
            taskArtifactLock,
        }),
    };

    assert.deepEqual(outcomes, fixture);
    for (const outcome of Object.values(outcomes)) {
        assert.equal(Object.isFrozen(outcome), true);
        assert.equal(Object.isFrozen(outcome.task_artifact_lock), true);
        assert.equal(Object.isFrozen(outcome.outcome), true);
    }
    assert.equal(Object.isFrozen(outcomes.finished.outcome.value), true);
});

test("createRunOutcome preserves terminal discriminants and optional retryability", () => {
    const failed = createRunOutcome({
        outcome: {
            errorType: "ValidationError",
            message: "output did not match the task schema",
            status: "failed",
        },
        runId: "run:failure",
        taskArtifactLock,
    });

    assert.deepEqual(failed.outcome, {
        error_type: "ValidationError",
        message: "output did not match the task schema",
        retryable: null,
        status: "failed",
    });
});

test("createRunOutcome rejects malformed definitions and terminal payloads", () => {
    const base = { runId: "run:1", taskArtifactLock };
    const invalid = [
        null,
        [],
        {},
        { ...base, outcome: { status: "unknown" } },
        { ...base, extra: true, outcome: { status: "cancelled", reason: "stop" } },
        { ...base, runId: "", outcome: { status: "cancelled", reason: "stop" } },
        { ...base, outcome: { status: "finished" } },
        { ...base, outcome: { status: "finished", value: undefined } },
        { ...base, outcome: { status: "finished", value: Number.NaN } },
        { ...base, outcome: { status: "failed", errorType: "Error", message: "" } },
        {
            ...base,
            outcome: {
                status: "failed",
                errorType: "Error",
                message: "bad",
                retryable: "yes",
            },
        },
        { ...base, outcome: { status: "exhausted", reason: "" } },
        { ...base, outcome: { status: "cancelled", reason: "stop", extra: true } },
        {
            ...base,
            taskArtifactLock: { ...taskArtifactLock, artifact_lock_version: 2 },
            outcome: { status: "cancelled", reason: "stop" },
        },
        {
            ...base,
            taskArtifactLock: { ...taskArtifactLock, artifact_digest: "digest:invalid" },
            outcome: { status: "cancelled", reason: "stop" },
        },
        {
            ...base,
            taskArtifactLock: { ...taskArtifactLock, artifact_digest: "sha256:abc" },
            outcome: { status: "cancelled", reason: "stop" },
        },
        {
            ...base,
            taskArtifactLock: {
                ...taskArtifactLock,
                artifact_digest: `sha256:${"g".repeat(64)}`,
            },
            outcome: { status: "cancelled", reason: "stop" },
        },
        {
            ...base,
            taskArtifactLock: { ...taskArtifactLock, task_id: "task:invalid" },
            outcome: { status: "cancelled", reason: "stop" },
        },
        {
            ...base,
            taskArtifactLock: { ...taskArtifactLock, task_id: "task:sha256:abc" },
            outcome: { status: "cancelled", reason: "stop" },
        },
        {
            ...base,
            taskArtifactLock: {
                ...taskArtifactLock,
                task_id: `task:sha256:${"g".repeat(64)}`,
            },
            outcome: { status: "cancelled", reason: "stop" },
        },
        { ...base, outcome: new Date() },
        { ...base, outcome: { [Symbol("invalid")]: true, status: "cancelled", reason: "stop" } },
        {
            ...base,
            outcome: Object.defineProperty({ status: "cancelled", reason: "stop" }, "reason", {
                get: () => "stop",
            }),
        },
        Object.defineProperty(
            { ...base, outcome: { status: "cancelled", reason: "stop" } },
            "runId",
            { get: () => "run:1" },
        ),
    ];

    for (const candidate of invalid) {
        assert.throws(() => createRunOutcome(candidate as never), TypeError);
    }
});
