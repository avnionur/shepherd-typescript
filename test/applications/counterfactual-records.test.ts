import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { Ajv2020, type AnySchemaObject } from "ajv/dist/2020.js";

import {
    readCroCandidateBody,
    readCroChanges,
    readCroOpenedBody,
    readEvaluation,
} from "../../src/applications/counterfactual-records.ts";
import {
    createApplicationAppendIntentId,
    createApplicationAppendRequest,
} from "../../src/applications/records.ts";
import * as applications from "../../src/facades/applications.ts";
import * as root from "../../src/index.ts";
import {
    APPLICATION_CRO_BASELINE_KINDS,
    APPLICATION_CRO_CANDIDATE_STATUSES,
    APPLICATION_CRO_PHASES,
    ApplicationEvidenceError,
    deriveApplicationOwnerId,
    inspectCounterfactualOptimization,
    type RecordBody,
    type RecordId,
    runCounterfactualOptimization,
    SQLiteTraceStore,
} from "../../src/index.ts";
import {
    APPLICATIONS_PROTOCOL_V1_CONTRACT,
    APPLICATIONS_PROTOCOL_V2_CONTRACT,
} from "../../src/protocol/compatibility-constants.ts";
import { applicationsProtocolConfig } from "../../src/protocol/config.ts";
import { parseProtocolConfig } from "../../src/protocol/config-validation.ts";
import {
    fail,
    keyedProvider,
    mismatchedProgram,
    optimizerOptions,
    pass,
    providerCandidate,
} from "./counterfactual-fixtures.ts";

const validConfig = JSON.parse(
    readFileSync(new URL("../../protocol.config.json", import.meta.url), "utf8"),
) as Record<string, Record<string, Record<string, unknown>>>;

async function completedRun(store: SQLiteTraceStore, commandId: string) {
    return runCounterfactualOptimization(
        store,
        optimizerOptions(commandId, {
            baselines: ["full_replay"],
            candidates: [
                providerCandidate("promoted", 0, keyedProvider("alt")),
                providerCandidate("rejected", 2, keyedProvider("other"), { parent: "promoted" }),
            ],
            evaluate: ({ candidate }) => (candidate.name === "promoted" ? pass(2) : fail(1)),
        }),
    );
}

function bodyOf(store: SQLiteTraceStore, recordId: RecordId | undefined): RecordBody {
    return store.readRecord(recordId as RecordId)?.body as RecordBody;
}

test("applications protocol v2 appends the cro vocabulary to v1 and refuses cro drift", () => {
    assert.deepEqual(
        APPLICATIONS_PROTOCOL_V2_CONTRACT.kinds,
        APPLICATIONS_PROTOCOL_V1_CONTRACT.kinds,
    );
    assert.deepEqual(
        APPLICATIONS_PROTOCOL_V2_CONTRACT.supervision,
        APPLICATIONS_PROTOCOL_V1_CONTRACT.supervision,
    );
    assert.equal(
        APPLICATIONS_PROTOCOL_V2_CONTRACT.artifacts.manifestSchema,
        APPLICATIONS_PROTOCOL_V1_CONTRACT.artifacts.manifestSchema,
    );
    assert.deepEqual(applicationsProtocolConfig.cro, APPLICATIONS_PROTOCOL_V2_CONTRACT.cro);
    assert.deepEqual(APPLICATION_CRO_PHASES, ["opened", "candidate"]);
    assert.deepEqual(APPLICATION_CRO_CANDIDATE_STATUSES, [
        "proposed",
        "evaluated",
        "promoted",
        "rejected",
    ]);
    assert.deepEqual(APPLICATION_CRO_BASELINE_KINDS, ["full_replay"]);
    const mutations: readonly ((cro: Record<string, unknown>) => void)[] = [
        (cro) => {
            cro.artifactRoles = { ...(cro.artifactRoles as object), promotion: "candidate" };
        },
        (cro) => {
            cro.baselineKinds = ["full_replay", "other"];
        },
        (cro) => {
            cro.budgetKeys = { ...(cro.budgetKeys as object), providerCalls: "maxCandidates" };
        },
        (cro) => {
            cro.surfaceRoles = { handoff: "same", proposer: "same", reflection: "other" };
        },
        (cro) => {
            cro.candidateStatuses = ["proposed"];
        },
        (cro) => {
            delete cro.phases;
        },
    ];
    for (const mutate of mutations) {
        const config = structuredClone(validConfig);
        mutate(config.applications?.cro as Record<string, unknown>);
        assert.throws(() => parseProtocolConfig(config), TypeError, mutate.toString());
    }
    const drifted = structuredClone(validConfig);
    (drifted.applications?.cro as Record<string, unknown>).baselineKinds = ["whole_replay"];
    assert.throws(
        () => parseProtocolConfig(drifted),
        (error: unknown) =>
            error instanceof TypeError && /new applications protocol/u.test(error.message),
    );
});

test("the applications facade exposes the optimizer as the root does", () => {
    assert.equal(applications.runCounterfactualOptimization, root.runCounterfactualOptimization);
    assert.equal(
        applications.inspectCounterfactualOptimization,
        root.inspectCounterfactualOptimization,
    );
    assert.equal(applications.APPLICATION_CRO_PHASES, root.APPLICATION_CRO_PHASES);
    assert.equal(
        applications.APPLICATION_CRO_CANDIDATE_STATUSES,
        root.APPLICATION_CRO_CANDIDATE_STATUSES,
    );
    assert.equal(applications.APPLICATION_CRO_BASELINE_KINDS, root.APPLICATION_CRO_BASELINE_KINDS);
});

test("retained optimizer records conform to the generated candidate schema", async () => {
    using store = new SQLiteTraceStore();
    const { inspection } = await completedRun(store, "application:cro:schema");
    const validator = new Ajv2020({ strict: true, strictTypes: false });
    const validate = validator.compile(
        JSON.parse(
            readFileSync(
                new URL(
                    `../../${applicationsProtocolConfig.artifacts.croCandidateSchema}`,
                    import.meta.url,
                ),
                "utf8",
            ),
        ) as AnySchemaObject,
    );
    const applicationId = deriveApplicationOwnerId("application:cro:schema");
    const bodies = store
        .readOwner(applicationId)
        .filter((record) => record.envelope.schema_ref === "shepherd.application.cro_candidate.v1")
        .map((record) => record.body);
    assert.equal(bodies.length, 6);
    for (const body of bodies) {
        assert.equal(validate(body), true, validator.errorsText(validate.errors));
    }
    const outcome = bodyOf(store, inspection.candidates[0]?.outcome?.record_id);
    assert.equal(validate({ ...outcome, status: "merged" }), false);
    assert.equal(validate({ ...outcome, extra: true }), false);
    assert.equal(
        validate({ ...bodyOf(store, inspection.opened_record_id), candidates: [] }),
        false,
    );
});

test("the optimizer record codecs refuse every inconsistent retained body", async () => {
    using store = new SQLiteTraceStore();
    const { inspection } = await completedRun(store, "application:cro:codec");
    const opened = bodyOf(store, inspection.opened_record_id);
    const proposed = bodyOf(store, inspection.candidates[0]?.proposed?.record_id);
    const evaluated = bodyOf(store, inspection.candidates[0]?.outcome?.record_id);
    const rejected = bodyOf(store, inspection.candidates[1]?.outcome?.record_id);
    const promoted = bodyOf(store, inspection.promotion?.record_id);
    assert.equal(readCroOpenedBody(opened).candidates.length, 2);
    for (const body of [proposed, evaluated, rejected, promoted]) {
        assert.equal(
            readCroCandidateBody(body).candidate_id,
            (body as { candidate_id: string }).candidate_id,
        );
    }
    const [firstPlan, secondPlan] = opened.candidates as readonly RecordBody[];
    const openedMutations: readonly RecordBody[] = [
        { ...opened, kind: "tree_rl" },
        { ...opened, phase: "candidate" },
        { ...opened, baselines: ["whole_replay"] },
        { ...opened, baselines: ["full_replay", "full_replay"] },
        { ...opened, candidates: [] },
        { ...opened, candidates: [firstPlan as RecordBody, firstPlan as RecordBody] },
        { ...opened, candidates: [secondPlan as RecordBody, firstPlan as RecordBody] },
        { ...opened, application_version: 2 },
    ];
    for (const body of openedMutations) {
        assert.throws(() => readCroOpenedBody(body), ApplicationEvidenceError);
    }
    const divergence = evaluated.divergence as RecordBody;
    const candidateMutations: readonly RecordBody[] = [
        { ...evaluated, phase: "opened" },
        { ...evaluated, status: "merged" },
        { ...evaluated, affected_steps: [3, 2] },
        { ...evaluated, affected_steps: [3] },
        { ...evaluated, edited_step_index: 5 },
        { ...evaluated, failure: { code: "OTHER", reason: "x" } },
        { ...evaluated, baseline: { ...(evaluated.baseline as RecordBody), kind: "whole" } },
        { ...evaluated, evaluation: { ...(evaluated.evaluation as RecordBody), passed: false } },
        { ...evaluated, evaluation: null },
        { ...evaluated, cost: null },
        { ...evaluated, divergence: { ...divergence, unexplained: [3] } },
        { ...evaluated, divergence: { ...divergence, first_divergence_index: 1 } },
        { ...proposed, cost: evaluated.cost as RecordBody },
        { ...proposed, divergence },
        { ...rejected, evaluation: { ...(rejected.evaluation as RecordBody), passed: true } },
        { ...evaluated, changes: ["provider", "task"] },
        { ...evaluated, parent_candidate_id: "cro-candidate:sha256:zz" },
    ];
    for (const body of candidateMutations) {
        assert.throws(() => readCroCandidateBody(body), ApplicationEvidenceError);
    }
    assert.throws(() => readCroChanges([], "changes"), TypeError);
    assert.throws(() => readEvaluation({ passed: "yes", reason: "r", score: 1 }), TypeError);
    assert.throws(
        () =>
            readEvaluation({
                passed: true,
                reason: "x".repeat(applicationsProtocolConfig.limits.maxReasonLength + 1),
                score: 1,
            }),
        TypeError,
    );
});

test("inspection refuses forged, late, or duplicate optimizer records", async () => {
    using store = new SQLiteTraceStore();
    const commandId = "application:cro:forged";
    const { inspection } = await completedRun(store, commandId);
    const applicationId = deriveApplicationOwnerId(commandId);
    const promotion = bodyOf(store, inspection.promotion?.record_id);
    const forge = (step: string, body: RecordBody) => {
        const head = store.readOwner(applicationId).at(-1)?.envelope.record_id as RecordId;
        const appended = store.appendApplicationRecord(
            applicationId,
            head,
            createApplicationAppendRequest(
                createApplicationAppendIntentId(applicationId, step),
                applicationId,
                body,
                applicationsProtocolConfig.traceSchemas.croCandidate,
                [head],
            ),
            null,
        );
        assert.equal(appended.status, "appended");
    };
    // A second promotion after the terminal cut is refused.
    forge("forged-promotion", promotion);
    assert.throws(
        () => inspectCounterfactualOptimization(store, applicationId),
        (error: unknown) =>
            error instanceof ApplicationEvidenceError && /terminal cut/u.test(error.message),
    );
    // A stopped run refuses any later candidate record.
    using stopped = new SQLiteTraceStore();
    const stoppedCommand = "application:cro:stopped";
    await assert.rejects(
        runCounterfactualOptimization(
            stopped,
            optimizerOptions(stoppedCommand, {
                candidates: [
                    providerCandidate("wrong-prefix", 0, keyedProvider("alt"), {
                        program: mismatchedProgram,
                    }),
                ],
            }),
        ),
        ApplicationEvidenceError,
    );
    const stoppedId = deriveApplicationOwnerId(stoppedCommand);
    const stoppedInspection = inspectCounterfactualOptimization(stopped, stoppedId);
    const failed = bodyOf(stopped, stoppedInspection.candidates[0]?.outcome?.record_id);
    const head = stopped.readOwner(stoppedId).at(-1)?.envelope.record_id as RecordId;
    stopped.appendApplicationRecord(
        stoppedId,
        head,
        createApplicationAppendRequest(
            createApplicationAppendIntentId(stoppedId, "forged-promotion"),
            stoppedId,
            failed,
            applicationsProtocolConfig.traceSchemas.croCandidate,
            [head],
        ),
        null,
    );
    assert.throws(
        () => inspectCounterfactualOptimization(stopped, stoppedId),
        (error: unknown) =>
            error instanceof ApplicationEvidenceError && /late/u.test(error.message),
    );
    // An application path that holds no optimizer record is not an optimization.
    assert.throws(
        () => inspectCounterfactualOptimization(store, deriveApplicationOwnerId("absent")),
        (error: unknown) =>
            error instanceof ApplicationEvidenceError && /not retained/u.test(error.message),
    );
    assert.throws(() => inspectCounterfactualOptimization(store, "application:bad"), TypeError);
});
