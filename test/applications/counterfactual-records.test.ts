import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { Ajv2020, type AnySchemaObject } from "ajv/dist/2020.js";

import {
    readCroCandidateBody,
    readCroChanges,
    readCroEdit,
    readCroOpenedBody,
    readCroProposalBody,
    readCroSelectionBody,
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
    APPLICATION_CRO_EDIT_SCOPES,
    APPLICATION_CRO_EXAMPLE_ROLES,
    APPLICATION_CRO_PHASES,
    APPLICATION_CRO_SPLITS,
    ApplicationEvidenceError,
    createApplicationManifest,
    deriveApplicationOwnerId,
    inspectCounterfactualOptimization,
    type RecordBody,
    type RecordId,
    runCounterfactualOptimization,
    SQLiteTraceStore,
    validateApplicationManifest,
} from "../../src/index.ts";
import {
    APPLICATIONS_PROTOCOL_V8_CONTRACT,
    APPLICATIONS_PROTOCOL_V9_CONTRACT,
} from "../../src/protocol/compatibility-constants.ts";
import { applicationsProtocolConfig } from "../../src/protocol/config.ts";
import { parseProtocolConfig } from "../../src/protocol/config-validation.ts";
import {
    counterfactualProtocolWith,
    labelMetric,
    optimizerOptions,
    providerEdit,
    reflection,
    scriptedProposer,
} from "./counterfactual-fixtures.ts";

const validConfig = JSON.parse(
    readFileSync(new URL("../../protocol.config.json", import.meta.url), "utf8"),
) as Record<string, Record<string, Record<string, unknown>>>;

/** One iteration: a promoted, an archived, and (on a second iteration) an evaluated candidate. */
async function completedRun(store: SQLiteTraceStore, commandId: string) {
    return runCounterfactualOptimization(
        store,
        optimizerOptions(commandId, {
            baselines: ["full_replay"],
            metric: labelMetric({
                good: { "dev-1": 1, "dev-2": 1, "train-1": 1 },
                weak: { "train-1": 1, "train-4": 1 },
            }),
            proposer: scriptedProposer([
                [
                    {
                        edits: [
                            providerEdit("promoted", 0, "good"),
                            providerEdit("archived", 3, "none"),
                        ],
                        parent: null,
                        reflection: reflection(null),
                    },
                ],
                [
                    {
                        edits: [
                            providerEdit("evaluated", 3, "weak", {
                                fix_set: ["train-4"],
                                guard_set: ["train-1"],
                            }),
                        ],
                        parent: "promoted",
                        reflection: reflection("promoted", ["archived did not reach the plan"]),
                    },
                ],
            ]),
            protocol: counterfactualProtocolWith({ iterations: 2 }),
        }),
    );
}

/** Store that fails the append of the first candidate outcome, simulating a crash before it. */
class OutcomeCrashingStore extends SQLiteTraceStore {
    armed = true;

    override appendApplicationRecord(
        ...args: Parameters<SQLiteTraceStore["appendApplicationRecord"]>
    ): ReturnType<SQLiteTraceStore["appendApplicationRecord"]> {
        const body = args[2].batch.groups[0]?.records[0]?.body as { readonly phase?: string };
        if (this.armed && body?.phase === "candidate") {
            this.armed = false;
            throw new Error("simulated crash");
        }
        return super.appendApplicationRecord(...args);
    }
}

function bodyOf(store: SQLiteTraceStore, recordId: RecordId | undefined): RecordBody {
    return store.readRecord(recordId as RecordId)?.body as RecordBody;
}

test("applications protocol v9 replaces the cro vocabulary for Algorithm 1 and refuses cro drift", () => {
    const { cro: _v9, ...v9Rest } = APPLICATIONS_PROTOCOL_V9_CONTRACT;
    const { cro: _v8, ...v8Rest } = APPLICATIONS_PROTOCOL_V8_CONTRACT;
    assert.deepEqual(v9Rest, v8Rest);
    assert.deepEqual(applicationsProtocolConfig.cro, APPLICATIONS_PROTOCOL_V9_CONTRACT.cro);
    assert.deepEqual(APPLICATION_CRO_PHASES, ["opened", "proposal", "candidate", "selection"]);
    assert.deepEqual(APPLICATION_CRO_CANDIDATE_STATUSES, [
        "archived",
        "evaluated",
        "promoted",
        "rejected",
    ]);
    assert.deepEqual(APPLICATION_CRO_EDIT_SCOPES, ["request", "downstream"]);
    assert.deepEqual(APPLICATION_CRO_SPLITS, ["train", "dev"]);
    assert.deepEqual(APPLICATION_CRO_EXAMPLE_ROLES, ["fix", "guard", "dev", "train"]);
    assert.deepEqual(APPLICATION_CRO_BASELINE_KINDS, ["full_replay"]);
    const mutations: readonly ((cro: Record<string, unknown>) => void)[] = [
        (cro) => {
            cro.artifactRoles = { ...(cro.artifactRoles as object), selection: "candidate" };
        },
        (cro) => {
            cro.budgetKeys = { ...(cro.budgetKeys as object), iterations: "maxCandidates" };
        },
        (cro) => {
            cro.thresholdKeys = {
                ...(cro.thresholdKeys as object),
                minScoreLift: "promoteDevEpsilon",
            };
        },
        (cro) => {
            cro.candidateStatuses = ["archived"];
        },
        (cro) => {
            cro.splits = ["train"];
        },
        (cro) => {
            cro.exampleRoles = ["fix", "guard", "dev"];
        },
        (cro) => {
            cro.proposer = { ...(cro.proposer as object), programId: "" };
        },
        (cro) => {
            cro.reflection = { differsByPhrase: "differs by:" };
        },
        (cro) => {
            delete cro.thresholdKeys;
        },
    ];
    for (const mutate of mutations) {
        const config = structuredClone(validConfig);
        mutate(config.applications?.cro as Record<string, unknown>);
        assert.throws(() => parseProtocolConfig(config), TypeError, mutate.toString());
    }
    const drifted = structuredClone(validConfig);
    const croConfig = drifted.applications?.cro as Record<string, Record<string, unknown>>;
    croConfig.reflection = { ...croConfig.reflection, differsByPhrase: "differs because:" };
    assert.throws(
        () => parseProtocolConfig(drifted),
        (error: unknown) =>
            error instanceof TypeError && /new applications protocol/u.test(error.message),
    );
});

test("the applications facade exposes the optimizer and the proposer as the root does", () => {
    assert.equal(applications.runCounterfactualOptimization, root.runCounterfactualOptimization);
    assert.equal(
        applications.inspectCounterfactualOptimization,
        root.inspectCounterfactualOptimization,
    );
    assert.equal(
        applications.createToolLoopCounterfactualProposer,
        root.createToolLoopCounterfactualProposer,
    );
    assert.equal(applications.APPLICATION_CRO_PHASES, root.APPLICATION_CRO_PHASES);
    assert.equal(applications.APPLICATION_CRO_SPLITS, root.APPLICATION_CRO_SPLITS);
    assert.equal(applications.APPLICATION_CRO_EXAMPLE_ROLES, root.APPLICATION_CRO_EXAMPLE_ROLES);
});

test("retained optimizer records and the manifest conform to the generated schemas", async () => {
    using store = new SQLiteTraceStore();
    const { inspection, manifest } = await completedRun(store, "application:cro:schema");
    assert.deepEqual(
        inspection.candidates.map((candidate) => candidate.status),
        ["promoted", "archived", "evaluated"],
    );
    const validator = new Ajv2020({ strict: true, strictTypes: false });
    const compile = (artifact: string) =>
        validator.compile(
            JSON.parse(
                readFileSync(new URL(`../../${artifact}`, import.meta.url), "utf8"),
            ) as AnySchemaObject,
        );
    const validate = compile(applicationsProtocolConfig.artifacts.croCandidateSchema);
    const applicationId = deriveApplicationOwnerId("application:cro:schema");
    const bodies = store
        .readOwner(applicationId)
        .filter((record) => record.envelope.schema_ref === "shepherd.application.cro_candidate.v1")
        .map((record) => record.body);
    // opened, 2 proposals, 3 outcomes, selection
    assert.equal(bodies.length, 7);
    for (const body of bodies) {
        assert.equal(validate(body), true, validator.errorsText(validate.errors));
    }
    const outcome = bodyOf(store, inspection.candidates[0]?.record_id);
    assert.equal(validate({ ...outcome, status: "merged" }), false);
    assert.equal(validate({ ...outcome, extra: true }), false);
    assert.equal(validate({ ...outcome, prior: 2 }), false);
    assert.equal(validate({ ...bodyOf(store, inspection.opened_record_id), examples: [] }), false);
    // Retained computation reuse is re-validated: sessions from zero and the exact ratio.
    for (const computation_reuse of [
        [{ live_steps: 1, recorded_steps: 1, reuse_ratio: 0.5, session_index: 1 }],
        [{ live_steps: 1, recorded_steps: 1, reuse_ratio: 0.25, session_index: 0 }],
    ]) {
        assert.throws(
            () => validateApplicationManifest({ ...manifest, computation_reuse }),
            ApplicationEvidenceError,
        );
    }
    const empty = createApplicationManifest({
        applicationId: manifest.application_id,
        artifacts: [],
        computationReuse: [
            { live_steps: 0, recorded_steps: 0, reuse_ratio: null, session_index: 0 },
        ],
        costs: manifest.costs,
        protocol: counterfactualProtocolWith({ iterations: 2 }),
    });
    assert.equal(empty.computation_reuse?.[0]?.reuse_ratio, null);
    const validateManifest = compile(applicationsProtocolConfig.artifacts.manifestSchema);
    assert.equal(validateManifest(manifest), true, validator.errorsText(validateManifest.errors));
    assert.equal(
        validateManifest({ ...manifest, computation_reuse: [{ session_index: 0 }] }),
        false,
    );
});

test("the optimizer record codecs refuse every inconsistent retained body", async () => {
    using store = new SQLiteTraceStore();
    const { inspection } = await completedRun(store, "application:cro:codec");
    const opened = bodyOf(store, inspection.opened_record_id);
    const proposal = bodyOf(store, inspection.proposals[0]?.record_id);
    const promoted = bodyOf(store, inspection.candidates[0]?.record_id);
    const archived = bodyOf(store, inspection.candidates[1]?.record_id);
    const evaluated = bodyOf(store, inspection.candidates[2]?.record_id);
    const selection = bodyOf(store, inspection.selection?.record_id);
    assert.equal(readCroOpenedBody(opened).examples.length, 6);
    assert.equal(readCroProposalBody(proposal).candidates.length, 2);
    assert.equal(readCroSelectionBody(selection).pool.length, 1);
    for (const body of [promoted, archived, evaluated]) {
        assert.equal(
            readCroCandidateBody(body).candidate_id,
            (body as { candidate_id: string }).candidate_id,
        );
    }
    const examples = opened.examples as readonly RecordBody[];
    const openedMutations: readonly RecordBody[] = [
        { ...opened, kind: "tree_rl" },
        { ...opened, phase: "candidate" },
        { ...opened, baselines: ["whole_replay"] },
        { ...opened, examples: [] },
        { ...opened, examples: [...examples].reverse() },
        { ...opened, examples: [examples[0] as RecordBody, examples[0] as RecordBody] },
        { ...opened, examples: [{ ...(examples[0] as RecordBody), split: "test" }] },
        { ...opened, thresholds: { minPromotionScore: "0.5" } },
        { ...opened, budgets: { iterations: 0.5 } },
        { ...opened, budgets: null },
        { ...opened, application_version: 2 },
    ];
    for (const body of openedMutations) {
        assert.throws(() => readCroOpenedBody(body), ApplicationEvidenceError);
    }
    const plans = proposal.candidates as readonly RecordBody[];
    const proposalMutations: readonly RecordBody[] = [
        { ...proposal, attempts: 0 },
        { ...proposal, refusals: ["one"] },
        { ...proposal, candidates: [] },
        { ...proposal, candidates: [plans[0] as RecordBody, plans[0] as RecordBody] },
        { ...proposal, candidates: [{ ...(plans[0] as RecordBody), iteration: 3 }] },
        { ...proposal, failure: { code: "APPLICATION_VERIFICATION_FAILED", reason: "x" } },
        { ...proposal, candidates: [{ ...(plans[0] as RecordBody), fix_set: [] }] },
        {
            ...proposal,
            candidates: [{ ...(plans[0] as RecordBody), fix_set: ["train-1", "train-1"] }],
        },
        {
            ...proposal,
            candidates: [{ ...(plans[0] as RecordBody), changes: ["provider", "task"] }],
        },
        {
            ...proposal,
            candidates: [{ ...(plans[0] as RecordBody), guard_set: ["train-1"] }],
        },
    ];
    for (const body of proposalMutations) {
        assert.throws(() => readCroProposalBody(body), ApplicationEvidenceError);
    }
    const targeted = promoted.targeted as readonly RecordBody[];
    const first = targeted[0] as RecordBody;
    const candidateMutations: readonly RecordBody[] = [
        { ...promoted, phase: "opened" },
        { ...promoted, status: "merged" },
        { ...promoted, status: "archived" },
        { ...promoted, train: null },
        { ...promoted, dev_score: null },
        { ...promoted, failure: { code: "OTHER", reason: "x" } },
        { ...promoted, status: "rejected" },
        { ...promoted, targeted: [{ ...first, role: "guard" }] },
        { ...promoted, targeted: [{ ...first, example_id: "train-2" }] },
        { ...promoted, targeted: [{ ...first, affected_steps: [3, 2] }] },
        {
            ...promoted,
            targeted: [
                {
                    ...first,
                    divergence: { ...(first.divergence as RecordBody), unexplained: [3] },
                },
            ],
        },
        {
            ...promoted,
            targeted: [{ ...first, target: { ...(first.target as RecordBody), step_index: 1 } }],
        },
        { ...promoted, targeted: [{ ...first, role: "other" }] },
        {
            ...promoted,
            targeted: [
                { ...first, baseline: { ...(first.baseline as RecordBody), kind: "whole" } },
            ],
        },
        {
            ...promoted,
            dev: [
                ...(promoted.dev as RecordBody[]),
                (promoted.dev as RecordBody[])[0] as RecordBody,
            ],
        },
        { ...promoted, gate: { ...(promoted.gate as RecordBody), passed: "yes" } },
        { ...archived, dev: [] },
        { ...archived, gate: { ...(archived.gate as RecordBody), passed: true } },
        { ...evaluated, promotion_reference: null },
        { ...evaluated, edit_scope: "suffix" },
    ];
    for (const body of candidateMutations) {
        assert.throws(() => readCroCandidateBody(body), ApplicationEvidenceError);
    }
    for (const body of [
        { ...selection, phase: "opened" },
        { ...selection, selected_candidate_id: "cro-candidate:sha256:zz" },
        { ...selection, pool: [], selected_candidate_id: selection.selected_candidate_id },
    ] as readonly RecordBody[]) {
        assert.throws(() => readCroSelectionBody(body), ApplicationEvidenceError);
    }
    assert.throws(() => readCroChanges([], "changes"), TypeError);
    assert.throws(
        () => readCroEdit({ ...providerEdit("x", 0, "x"), prior: 1.5 }, "edit"),
        TypeError,
    );
});

test("inspection refuses forged, late, recomputation-inconsistent, or duplicate optimizer records", async () => {
    using store = new SQLiteTraceStore();
    const commandId = "application:cro:forged";
    const { inspection } = await completedRun(store, commandId);
    const applicationId = deriveApplicationOwnerId(commandId);
    const forge = (target: SQLiteTraceStore, owner: string, step: string, body: RecordBody) => {
        const head = target.readOwner(owner).at(-1)?.envelope.record_id as RecordId;
        const appended = target.appendApplicationRecord(
            owner,
            head,
            createApplicationAppendRequest(
                createApplicationAppendIntentId(owner, step),
                owner,
                body,
                applicationsProtocolConfig.traceSchemas.croCandidate,
                [head],
            ),
            null,
        );
        assert.equal(appended.status, "appended");
    };
    // A second selection after the terminal cut is refused.
    forge(store, applicationId, "forged-selection", bodyOf(store, inspection.selection?.record_id));
    assert.throws(
        () => inspectCounterfactualOptimization(store, applicationId),
        (error: unknown) =>
            error instanceof ApplicationEvidenceError && /terminal cut/u.test(error.message),
    );
    // An outcome whose gate disagrees with the gate recomputed from its results is refused.
    using crashed = new OutcomeCrashingStore();
    await assert.rejects(completedRun(crashed, commandId), /simulated crash/u);
    const forgedGate = bodyOf(store, inspection.candidates[0]?.record_id);
    forge(crashed, applicationId, "forged-outcome", {
        ...forgedGate,
        gate: { ...(forgedGate.gate as RecordBody), aggregate_lift: 0.123 },
    });
    assert.throws(
        () => inspectCounterfactualOptimization(crashed, applicationId),
        (error: unknown) =>
            error instanceof ApplicationEvidenceError &&
            /outcome disagrees with its parent, examples, gate, promotion, or cost/u.test(
                error.message,
            ),
    );
    // An application path that holds no optimizer record is not an optimization.
    assert.throws(
        () => inspectCounterfactualOptimization(store, deriveApplicationOwnerId("absent")),
        (error: unknown) =>
            error instanceof ApplicationEvidenceError && /not retained/u.test(error.message),
    );
    assert.throws(() => inspectCounterfactualOptimization(store, "application:bad"), TypeError);
});
