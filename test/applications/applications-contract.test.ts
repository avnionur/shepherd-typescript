import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
    assertApplicationDigest,
    createApplicationAppendIntentId,
    createApplicationAppendRequest,
    readApplicationDecisionBody,
    readApplicationOpenedBody,
    readApplicationReason,
    readSupervisorDecision,
} from "../../src/applications/records.ts";
import {
    APPLICATION_LIMITS,
    AppendIntentConflictError,
    ApplicationEvidenceError,
    deriveApplicationOwnerId,
    type RecordBody,
    type RecordId,
    runCodingSupervisor,
    SQLiteTraceStore,
} from "../../src/index.ts";
import { APPLICATIONS_PROTOCOL_V5_CONTRACT } from "../../src/protocol/compatibility-constants.ts";
import { applicationsProtocolConfig } from "../../src/protocol/config.ts";
import { parseProtocolConfig } from "../../src/protocol/config-validation.ts";
import {
    acceptAfterObserve,
    LEAD,
    outputPaths,
    rootParent,
    supervisionProtocol,
    workerOf,
} from "./fixtures.ts";

const validConfig = JSON.parse(
    readFileSync(new URL("../../protocol.config.json", import.meta.url), "utf8"),
) as Record<string, unknown>;

function applications(config: Record<string, unknown>): Record<string, Record<string, unknown>> {
    return config.applications as Record<string, Record<string, unknown>>;
}

function supervision(config: Record<string, unknown>): Record<string, Record<string, unknown>> {
    return applications(config).supervision as unknown as Record<string, Record<string, unknown>>;
}

test("the applications protocol section equals the locked latest (v5) contract and refuses drift", () => {
    const parsed = parseProtocolConfig(structuredClone(validConfig));
    assert.deepEqual(parsed.applications, APPLICATIONS_PROTOCOL_V5_CONTRACT);
    const mutations: readonly ((config: Record<string, unknown>) => void)[] = [
        (config) => {
            applications(config).traceSchemas = {
                compression: "shepherd.application.same.v1",
                croCandidate: "shepherd.application.same.v1",
                manifest: "shepherd.application.same.v1",
                supervision: "shepherd.application.same.v1",
                treeRlRollout: "shepherd.application.same.v1",
            };
        },
        (config) => {
            applications(config).identity = {
                ...applications(config).identity,
                artifactIdPrefix: "application:sha256:",
            };
        },
        (config) => {
            applications(config).limits = { ...applications(config).limits, minWorkers: 9 };
        },
        (config) => {
            supervision(config).artifactRoles = {
                ...supervision(config).artifactRoles,
                worldMerge: "world_fork",
            };
        },
        (config) => {
            supervision(config).surfaceRoles = { action: "same", observation: "same" };
        },
        (config) => {
            supervision(config).budgetKeys = {
                ...supervision(config).budgetKeys,
                rounds: "maxProviderCalls",
            };
        },
        (config) => {
            (supervision(config) as Record<string, unknown>).phases = ["opened"];
        },
        (config) => {
            applications(config).limits = { ...applications(config).limits, maxRounds: 65 };
        },
    ];
    for (const mutate of mutations) {
        const config = structuredClone(validConfig);
        mutate(config);
        assert.throws(() => parseProtocolConfig(config), TypeError, mutate.toString());
    }
    // A well-formed value that differs from the locked contract requires a new protocol version.
    const drifted = structuredClone(validConfig);
    applications(drifted).errors = {
        ...applications(drifted).errors,
        budgetMessage: "a different message",
    };
    assert.throws(
        () => parseProtocolConfig(drifted),
        (error: unknown) =>
            error instanceof TypeError && /new applications protocol/u.test(error.message),
    );
});

test("the supervision record codec refuses every inconsistent retained body", async () => {
    using store = new SQLiteTraceStore();
    const { inspection } = await runCodingSupervisor(store, {
        changedPaths: outputPaths,
        commandId: "application:codec-refusals",
        parent: rootParent(),
        policy: acceptAfterObserve("a"),
        protocol: supervisionProtocol(),
        supervisorId: LEAD,
        workers: [workerOf("a"), workerOf("b")],
    });
    const opened = store.readRecord(inspection.opened_record_id)?.body as RecordBody;
    const observed = store.readRecord(inspection.decisions[0]?.record_id as RecordId)
        ?.body as RecordBody;
    const accepted = store.readRecord(inspection.decisions[1]?.record_id as RecordId)
        ?.body as RecordBody;
    assert.equal(readApplicationOpenedBody(opened).workers.length, 2);
    const [firstObservation] = observed.observations as readonly RecordBody[];
    const evidence = accepted.evidence as RecordBody;
    const [discarded] = evidence.discarded as readonly RecordBody[];
    const openedMutations: readonly RecordBody[] = [
        { ...opened, world: "no" },
        { ...opened, application_version: 2 },
    ];
    for (const body of openedMutations) {
        assert.throws(() => readApplicationOpenedBody(body), ApplicationEvidenceError);
    }
    const decisionMutations: readonly RecordBody[] = [
        { ...observed, round: 0 },
        { ...observed, observations: [firstObservation as RecordBody] },
        {
            ...observed,
            observations: [{ ...(firstObservation as RecordBody), worker_status: "lost" }],
        },
        { ...observed, conflict: { kind: "none", paths: ["greet.ts"], worker_ids: ["a"] } },
        { ...observed, decision: { kind: "accept", worker_id: "a" } },
        { ...accepted, evidence: { ...evidence, kind: "unknown" } },
        {
            ...accepted,
            evidence: {
                ...evidence,
                discarded: Array.from({ length: APPLICATION_LIMITS.maxWorkers }, (_, index) => ({
                    ...(discarded as RecordBody),
                    worker_id: `w${index}`,
                })),
            },
        },
    ];
    for (const body of decisionMutations) {
        assert.throws(() => readApplicationDecisionBody(body), ApplicationEvidenceError);
    }
    assert.throws(() => readSupervisorDecision({ kind: "unknown", worker_id: "a" }), TypeError);
    assert.throws(() => assertApplicationDigest(1, "application:sha256:", "value"), TypeError);
    assert.throws(
        () =>
            readApplicationReason(
                "x".repeat(APPLICATION_LIMITS.maxReasonLength + 1),
                "decision.reason",
            ),
        TypeError,
    );
    // The identical opened append replays regardless of the current head.
    const replayed = store.appendApplicationRecord(
        deriveApplicationOwnerId("application:codec-refusals"),
        null,
        createApplicationAppendRequest(
            createApplicationAppendIntentId(
                deriveApplicationOwnerId("application:codec-refusals"),
                "opened",
            ),
            deriveApplicationOwnerId("application:codec-refusals"),
            opened,
            applicationsProtocolConfig.traceSchemas.supervision,
            store.readRecord(inspection.opened_record_id)?.envelope
                .caused_by_record_ids as readonly RecordId[],
        ),
        null,
    );
    assert.equal(replayed.status, "replayed");
    // A different body under a retained application intent rolls back and is refused.
    const applicationId = deriveApplicationOwnerId("application:codec-refusals");
    const head = store.readOwner(applicationId).at(-1)?.envelope.record_id as RecordId;
    assert.throws(
        () =>
            store.appendApplicationRecord(
                applicationId,
                head,
                createApplicationAppendRequest(
                    createApplicationAppendIntentId(applicationId, "opened"),
                    applicationId,
                    { forged: true },
                    applicationsProtocolConfig.traceSchemas.supervision,
                    [],
                ),
                null,
            ),
        AppendIntentConflictError,
    );
    assert.equal(store.verifyIntegrity().ok, true);
    // A world adapter must be an object.
    await assert.rejects(
        runCodingSupervisor(store, {
            commandId: "application:null-world",
            parent: rootParent(),
            policy: acceptAfterObserve("a"),
            protocol: supervisionProtocol(),
            supervisorId: LEAD,
            workers: [workerOf("a"), workerOf("b")],
            world: null as never,
        }),
        (error: unknown) =>
            error instanceof TypeError && /world adapter object/u.test(error.message),
    );
});
