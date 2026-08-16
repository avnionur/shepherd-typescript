import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { Ajv2020, type AnySchemaObject } from "ajv/dist/2020.js";

import { RUN_PROTOCOL_V1_CONTRACT } from "../../src/protocol/compatibility-constants.ts";
import { parseProtocolConfig } from "../../src/protocol/config-validation.ts";

const validConfig = readJson("../../protocol.config.json") as Record<string, unknown>;
const fixture = readJson("../fixtures/run-outcome-v1.json") as Record<string, unknown>;
const artifactUsageFixture = readJson("../fixtures/run-artifact-usage-v1.json") as Record<
    string,
    unknown
>;
const artifactSchema = readJson(
    "../../spec/schemas/run-artifact-v1.schema.json",
) as AnySchemaObject;
const outcomeSchema = readJson("../../spec/schemas/run-outcome-v1.schema.json") as AnySchemaObject;
const usageSchema = readJson("../../spec/schemas/run-usage-v1.schema.json") as AnySchemaObject;

test("published run artifact and usage schemas accept independent fixtures", () => {
    const validator = new Ajv2020({ strict: true });
    const validateArtifact = validator.compile(artifactSchema);
    const validateUsage = validator.compile(usageSchema);

    for (const artifact of artifactUsageFixture.artifacts as readonly unknown[]) {
        assert.equal(
            validateArtifact(artifact),
            true,
            validator.errorsText(validateArtifact.errors),
        );
    }
    assert.equal(
        validateUsage(artifactUsageFixture.usage),
        true,
        validator.errorsText(validateUsage.errors),
    );
});

test("published run artifact and usage schemas reject malformed closed records", () => {
    const validator = new Ajv2020({ strict: true });
    const validateArtifact = validator.compile(artifactSchema);
    const validateUsage = validator.compile(usageSchema);
    const [artifact] = artifactUsageFixture.artifacts as readonly Record<string, unknown>[];
    const usage = artifactUsageFixture.usage as Record<string, unknown>;

    for (const invalid of [
        { ...artifact, artifact_version: 2 },
        { ...artifact, artifact_ordinal: -1 },
        { ...artifact, content: { type: "blob", blob_id: "bad", byte_length: 3 } },
        {
            ...artifact,
            content: {
                type: "blob",
                blob_id: `sha256:${"a".repeat(64)}`,
                byte_length: Number.MAX_SAFE_INTEGER + 1,
            },
        },
        { ...artifact, extra: true },
    ]) {
        assert.equal(validateArtifact(invalid), false);
    }
    for (const invalid of [
        { ...usage, usage_version: 2 },
        { ...usage, input_tokens: -1 },
        { ...usage, input_tokens: Number.MAX_SAFE_INTEGER + 1 },
        { ...usage, cost_usd: -1 },
        { ...usage, extra: true },
    ]) {
        assert.equal(validateUsage(invalid), false);
    }
});

test("published run-outcome schema accepts all four independent fixture variants", () => {
    const validator = new Ajv2020({ strict: true });
    const validate = validator.compile(outcomeSchema);

    for (const outcome of Object.values(fixture)) {
        assert.equal(validate(outcome), true, validator.errorsText(validate.errors));
    }
});

test("published run-outcome schema rejects malformed closed records", () => {
    const validator = new Ajv2020({ strict: true });
    const validate = validator.compile(outcomeSchema);
    const finished = fixture.finished as Record<string, unknown>;
    const failed = fixture.failed as Record<string, unknown>;

    for (const invalid of [
        { ...finished, outcome_version: 2 },
        { ...finished, extra: true },
        { ...finished, outcome: { status: "finished" } },
        { ...failed, outcome: { status: "failed", error_type: "Error", message: "bad" } },
        { ...finished, task_artifact_lock: { artifact_lock_version: 1 } },
    ]) {
        assert.equal(validate(invalid), false);
    }
});

test("run protocol configuration is frozen and compatibility locked", () => {
    const parsed = parseProtocolConfig(structuredClone(validConfig));

    assert.deepEqual(parsed.runs, RUN_PROTOCOL_V1_CONTRACT);
    assert.equal(Object.isFrozen(parsed.runs), true);
    assert.equal(Object.isFrozen(parsed.runs.control), true);
    assert.equal(Object.isFrozen(parsed.runs.control.budgetMetrics), true);
    assert.equal(Object.isFrozen(parsed.runs.execution), true);
    assert.equal(Object.isFrozen(parsed.runs.execution.controlCommandKinds), true);
    assert.equal(Object.isFrozen(parsed.runs.execution.continuationConstituentKinds), true);
    assert.equal(Object.isFrozen(parsed.runs.execution.continuationEvidenceStatuses), true);
    assert.equal(Object.isFrozen(parsed.runs.execution.errors), true);
    assert.equal(Object.isFrozen(parsed.runs.execution.invocationClaimAppendStatuses), true);
    assert.equal(Object.isFrozen(parsed.runs.execution.invocationClaimStatuses), true);
    assert.equal(Object.isFrozen(parsed.runs.execution.lifecycleStatuses), true);
    assert.equal(Object.isFrozen(parsed.runs.execution.lifecycleTerminalTransitions), true);
    assert.equal(Object.isFrozen(parsed.runs.execution.lifecycleTerminalTransitions[0]), true);
    assert.equal(Object.isFrozen(parsed.runs.execution.lifecycleTransitions), true);
    assert.equal(Object.isFrozen(parsed.runs.execution.lifecycleTransitions[0]), true);
    assert.equal(Object.isFrozen(parsed.runs.execution.recoveryStatuses), true);
    assert.equal(Object.isFrozen(parsed.runs.terminalStatuses), true);
    assert.equal(Object.isFrozen(RUN_PROTOCOL_V1_CONTRACT), true);

    for (const mutate of [
        (runs: Record<string, unknown>) => {
            runs.outcomeVersion = 0;
        },
        (runs: Record<string, unknown>) => {
            runs.artifactVersion = 0;
        },
        (runs: Record<string, unknown>) => {
            runs.usageVersion = 0;
        },
        (runs: Record<string, unknown>) => {
            runs.firstArtifactOrdinal = 2;
            runs.lastArtifactOrdinal = 1;
        },
        (runs: Record<string, unknown>) => {
            runs.lastArtifactOrdinal = Number.MAX_SAFE_INTEGER;
        },
        (runs: Record<string, unknown>) => {
            runs.artifactContentTypes = [];
        },
        (runs: Record<string, unknown>) => {
            const control = runs.control as Record<string, unknown>;
            control.budgetMetrics = [];
        },
        (runs: Record<string, unknown>) => {
            const control = runs.control as Record<string, unknown>;
            control.statuses = ["active", "exhausted", "stopped"];
        },
        (runs: Record<string, unknown>) => {
            const control = runs.control as Record<string, unknown>;
            control.reasonTypes = ["budget_exhausted", "stopped"];
        },
        (runs: Record<string, unknown>) => {
            const control = runs.control as Record<string, unknown>;
            control.cancellationReason = "";
        },
        (runs: Record<string, unknown>) => {
            const control = runs.control as Record<string, unknown>;
            control.disposalReason = "";
        },
        (runs: Record<string, unknown>) => {
            const control = runs.control as Record<string, unknown>;
            control.maxTimerDurationMilliseconds = 0;
        },
        (runs: Record<string, unknown>) => {
            runs.outcomeVersion = 2;
        },
        (runs: Record<string, unknown>) => {
            runs.terminalStatuses = [];
        },
        (runs: Record<string, unknown>) => {
            runs.terminalStatuses = ["finished", "failed", "exhausted", "stopped"];
        },
        (runs: Record<string, unknown>) => {
            (runs.execution as Record<string, unknown>).recoveryStatuses = [];
        },
        (runs: Record<string, unknown>) => {
            (runs.execution as Record<string, unknown>).continuationConstituentKinds = [];
        },
        (runs: Record<string, unknown>) => {
            (runs.execution as Record<string, unknown>).continuationEvidenceStatuses = [];
        },
        (runs: Record<string, unknown>) => {
            (runs.execution as Record<string, unknown>).continuationEvidenceStatuses = ["verified"];
        },
        (runs: Record<string, unknown>) => {
            (runs.execution as Record<string, unknown>).continuationVerifiedStatus = "unknown";
        },
        (runs: Record<string, unknown>) => {
            (runs.execution as Record<string, unknown>).continuationVersion = 0;
        },
        (runs: Record<string, unknown>) => {
            (runs.execution as Record<string, unknown>).lifecycleStatuses = [];
        },
        (runs: Record<string, unknown>) => {
            (runs.execution as Record<string, unknown>).lifecycleTerminalStatus = "unknown";
        },
        (runs: Record<string, unknown>) => {
            (runs.execution as Record<string, unknown>).lifecycleWaitingStatus = "unknown";
        },
        (runs: Record<string, unknown>) => {
            (runs.execution as Record<string, unknown>).lifecycleSuspendedStatus = "waiting";
        },
        (runs: Record<string, unknown>) => {
            (runs.execution as Record<string, unknown>).lifecycleTransitions = [];
        },
        (runs: Record<string, unknown>) => {
            (runs.execution as Record<string, unknown>).lifecycleTransitions = [["created"]];
        },
        (runs: Record<string, unknown>) => {
            (runs.execution as Record<string, unknown>).lifecycleTransitions = [
                ["created", "running"],
                ["created", "running"],
            ];
        },
        (runs: Record<string, unknown>) => {
            (runs.execution as Record<string, unknown>).lifecycleTransitions = [
                ["unknown", "running"],
            ];
        },
        (runs: Record<string, unknown>) => {
            (runs.execution as Record<string, unknown>).lifecycleTransitions = [
                ["terminal", "running"],
            ];
        },
        (runs: Record<string, unknown>) => {
            (runs.execution as Record<string, unknown>).lifecycleTransitions = [
                ["created", "terminal"],
            ];
        },
        (runs: Record<string, unknown>) => {
            (runs.execution as Record<string, unknown>).lifecycleTerminalTransitions = [
                ["unknown", "failed"],
            ];
        },
        (runs: Record<string, unknown>) => {
            (runs.execution as Record<string, unknown>).lifecycleTerminalTransitions = [
                ["terminal", "failed"],
            ];
        },
        (runs: Record<string, unknown>) => {
            (runs.execution as Record<string, unknown>).lifecycleTerminalTransitions = [
                ["created", "unknown"],
            ];
        },
        (runs: Record<string, unknown>) => {
            (runs.execution as Record<string, unknown>).lifecycleVersion = 0;
        },
        (runs: Record<string, unknown>) => {
            (runs.execution as Record<string, unknown>).controlCommandKinds = [];
        },
        (runs: Record<string, unknown>) => {
            (runs.execution as Record<string, unknown>).controlCommandSchemaId = "";
        },
        (runs: Record<string, unknown>) => {
            (runs.execution as Record<string, unknown>).invocationClaimAppendStatuses = [];
        },
        (runs: Record<string, unknown>) => {
            (runs.execution as Record<string, unknown>).invocationClaimStatuses = [];
        },
        (runs: Record<string, unknown>) => {
            const execution = runs.execution as Record<string, unknown>;
            const errors = execution.errors as Record<string, unknown>;
            errors.recoveryAbsentCode = "";
        },
        (runs: Record<string, unknown>) => {
            const execution = runs.execution as Record<string, unknown>;
            const errors = execution.errors as Record<string, unknown>;
            errors.recoveryAbsentMessage = "";
        },
        (runs: Record<string, unknown>) => {
            const execution = runs.execution as Record<string, unknown>;
            const errors = execution.errors as Record<string, unknown>;
            errors.recoveryCommandRequiredCode = "";
        },
        (runs: Record<string, unknown>) => {
            const execution = runs.execution as Record<string, unknown>;
            const errors = execution.errors as Record<string, unknown>;
            errors.recoveryCommandRequiredMessage = "";
        },
        (runs: Record<string, unknown>) => {
            const execution = runs.execution as Record<string, unknown>;
            const errors = execution.errors as Record<string, unknown>;
            errors.recoveryStartedCode = "";
        },
        (runs: Record<string, unknown>) => {
            const execution = runs.execution as Record<string, unknown>;
            const errors = execution.errors as Record<string, unknown>;
            errors.recoveryStartedMessage = "";
        },
        (runs: Record<string, unknown>) => {
            (runs.schemas as Record<string, unknown>).outcomeId = "relative";
        },
        (runs: Record<string, unknown>) => {
            (runs.schemas as Record<string, unknown>).artifactId = "relative";
        },
        (runs: Record<string, unknown>) => {
            (runs.schemas as Record<string, unknown>).usageId = "relative";
        },
        (runs: Record<string, unknown>) => {
            (runs.schemas as Record<string, unknown>).continuationDescriptorId = "relative";
        },
        (runs: Record<string, unknown>) => {
            (runs.schemas as Record<string, unknown>).waitingLifecycleId = "relative";
        },
        (runs: Record<string, unknown>) => {
            (runs.schemas as Record<string, unknown>).suspendedLifecycleId = "relative";
        },
        (runs: Record<string, unknown>) => {
            (runs.artifacts as Record<string, unknown>).outcomeSchema = "";
        },
        (runs: Record<string, unknown>) => {
            (runs.artifacts as Record<string, unknown>).artifactSchema = "";
        },
        (runs: Record<string, unknown>) => {
            (runs.artifacts as Record<string, unknown>).usageSchema = "";
        },
        (runs: Record<string, unknown>) => {
            (runs.artifacts as Record<string, unknown>).continuationDescriptorSchema = "";
        },
        (runs: Record<string, unknown>) => {
            (runs.artifacts as Record<string, unknown>).waitingLifecycleSchema = "";
        },
        (runs: Record<string, unknown>) => {
            (runs.artifacts as Record<string, unknown>).suspendedLifecycleSchema = "";
        },
    ]) {
        const candidate = structuredClone(validConfig);
        mutate(candidate.runs as Record<string, unknown>);
        assert.throws(() => parseProtocolConfig(candidate), TypeError);
    }
});

function readJson(relativePath: string): unknown {
    return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8")) as unknown;
}
