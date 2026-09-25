import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { Ajv2020, type AnySchemaObject } from "ajv/dist/2020.js";

import {
    readChildOutputText,
    readCompressionCandidateBody,
    readCompressionOpenedBody,
    readCompressionOutcomeBody,
    readTrajectoryProposal,
    readTrajectoryVerdict,
    resolveTrajectoryProposal,
} from "../../src/applications/compression-records.ts";
import {
    createApplicationAppendIntentId,
    createApplicationAppendRequest,
} from "../../src/applications/records.ts";
import * as applications from "../../src/facades/applications.ts";
import * as root from "../../src/index.ts";
import {
    APPLICATION_COMPRESSION_BASELINE_KINDS,
    APPLICATION_COMPRESSION_CANDIDATE_KINDS,
    APPLICATION_COMPRESSION_CANDIDATE_STATUSES,
    APPLICATION_COMPRESSION_FORK_STEP_POLICIES,
    APPLICATION_COMPRESSION_OUTCOMES,
    APPLICATION_COMPRESSION_PHASES,
    APPLICATION_COMPRESSION_VERDICTS,
    ApplicationEvidenceError,
    deriveApplicationOwnerId,
    inspectTrajectoryCompression,
    type RecordBody,
    type RecordId,
    runTrajectoryCompression,
    SQLiteTraceStore,
    type TrajectoryCompressionInspection,
} from "../../src/index.ts";
import {
    APPLICATIONS_PROTOCOL_V2_CONTRACT,
    APPLICATIONS_PROTOCOL_V3_CONTRACT,
    APPLICATIONS_PROTOCOL_V7_CONTRACT,
} from "../../src/protocol/compatibility-constants.ts";
import { applicationsProtocolConfig } from "../../src/protocol/config.ts";
import { parseProtocolConfig } from "../../src/protocol/config-validation.ts";
import {
    compressionOptions,
    compressionProtocolWithBudgets,
    compressorOf,
    exploreWorkflow,
    forkAt,
    notifyHandlers,
    stageProvider,
    unavailableSession,
    verifierOf,
} from "./compression-fixtures.ts";

const validConfig = JSON.parse(
    readFileSync(new URL("../../protocol.config.json", import.meta.url), "utf8"),
) as Record<string, Record<string, Record<string, unknown>>>;
const traceSchema = applicationsProtocolConfig.traceSchemas.compression;

function bodyOf(store: SQLiteTraceStore, recordId: RecordId | undefined): RecordBody {
    return store.readRecord(recordId as RecordId)?.body as RecordBody;
}

async function completedRun(
    store: SQLiteTraceStore,
    commandId: string,
): Promise<TrajectoryCompressionInspection> {
    const { inspection } = await runTrajectoryCompression(
        store,
        compressionOptions(commandId, {
            baselines: ["no_compression"],
            controlProvider: (seed) =>
                stageProvider("base", seed === 19 ? { doneAt: "explore-a" } : {}),
        }),
    );
    return inspection;
}

/** Bodies of every record shape a run retains, keyed by shape. */
async function recordShapes(): Promise<Record<string, RecordBody>> {
    const shapes: Record<string, RecordBody> = {};
    using store = new SQLiteTraceStore();
    const pruned = await completedRun(store, "application:compression:shapes:pruned");
    shapes.opened = bodyOf(store, pruned.opened_record_id);
    shapes.proposed = bodyOf(store, pruned.compression.proposed?.record_id);
    shapes.rewound = bodyOf(store, pruned.compression.rewound?.record_id);
    shapes.pruned = bodyOf(store, pruned.compression.outcome?.record_id);
    shapes.control = bodyOf(store, pruned.controls[0]?.outcome?.record_id);
    shapes.outcome = bodyOf(store, pruned.outcome?.record_id);
    const restored = (
        await runTrajectoryCompression(
            store,
            compressionOptions("application:compression:shapes:restored", {
                protocol: compressionProtocolWithBudgets({ bestOfN: 0 }),
                verifier: verifierOf(() => ({ reason: "no", score: 0, verdict: "rejected" })),
            }),
        )
    ).inspection;
    shapes.restored = bodyOf(store, restored.compression.outcome?.record_id);
    shapes.bareOutcome = bodyOf(store, restored.outcome?.record_id);
    const unavailable = (
        await runTrajectoryCompression(
            store,
            compressionOptions("application:compression:shapes:unavailable", {
                protocol: compressionProtocolWithBudgets({ bestOfN: 0 }),
                workflow: {
                    handlers: notifyHandlers,
                    program: exploreWorkflow({ checkpoint: true }),
                    programId: "workflow:explore-answer.v1",
                    provider: stageProvider("base"),
                    providerSession: unavailableSession("refused"),
                },
            }),
        )
    ).inspection;
    shapes.unavailable = bodyOf(store, unavailable.compression.outcome?.record_id);
    const noPrune = (
        await runTrajectoryCompression(
            store,
            compressionOptions("application:compression:shapes:no-prune", {
                compressor: compressorOf(() => ({ fork_point: null, hint: null })),
                protocol: compressionProtocolWithBudgets({ bestOfN: 0 }),
            }),
        )
    ).inspection;
    shapes.noPrune = bodyOf(store, noPrune.compression.outcome?.record_id);
    const restart = (
        await runTrajectoryCompression(
            store,
            compressionOptions("application:compression:shapes:restart", {
                compressor: compressorOf(forkAt(0)),
                protocol: compressionProtocolWithBudgets({ bestOfN: 0 }),
            }),
        )
    ).inspection;
    shapes.restart = bodyOf(store, restart.compression.outcome?.record_id);
    const clamped = (
        await runTrajectoryCompression(
            store,
            compressionOptions("application:compression:shapes:clamped", {
                compressor: compressorOf(forkAt(-1)),
                protocol: compressionProtocolWithBudgets({ bestOfN: 0 }),
            }),
        )
    ).inspection;
    shapes.clamped = bodyOf(store, clamped.compression.outcome?.record_id);
    const verificationCommand = "application:compression:shapes:verification";
    await assert.rejects(
        runTrajectoryCompression(
            store,
            compressionOptions(verificationCommand, {
                verifier: verifierOf((context) => {
                    if (context.candidate === "control") {
                        throw new Error("control verifier unavailable");
                    }
                    throw new Error("verifier unavailable");
                }),
            }),
        ),
        root.ApplicationVerificationError,
    );
    shapes.verificationRejected = bodyOf(
        store,
        inspectTrajectoryCompression(store, deriveApplicationOwnerId(verificationCommand))
            .compression.outcome?.record_id,
    );
    const controlCommand = "application:compression:shapes:control";
    await assert.rejects(
        runTrajectoryCompression(
            store,
            compressionOptions(controlCommand, {
                verifier: verifierOf((context) => {
                    if (context.candidate === "control") {
                        throw new Error("control verifier unavailable");
                    }
                    return { reason: "same", score: 1, verdict: "accepted" };
                }),
            }),
        ),
        root.ApplicationVerificationError,
    );
    shapes.controlRejected = bodyOf(
        store,
        inspectTrajectoryCompression(store, deriveApplicationOwnerId(controlCommand)).controls[0]
            ?.outcome?.record_id,
    );
    const proposalCommand = "application:compression:shapes:proposal";
    await assert.rejects(
        runTrajectoryCompression(
            store,
            compressionOptions(proposalCommand, {
                compressor: compressorOf(() => ({ fork_point: 1, hint: null })),
            }),
        ),
        ApplicationEvidenceError,
    );
    shapes.proposalRejected = bodyOf(
        store,
        inspectTrajectoryCompression(store, deriveApplicationOwnerId(proposalCommand)).compression
            .outcome?.record_id,
    );
    return shapes;
}

test("applications protocol v3 appends the compression vocabulary to v2 and refuses drift", () => {
    for (const key of ["kinds", "supervision", "cro", "identity", "limits", "errors"] as const) {
        assert.deepEqual(
            APPLICATIONS_PROTOCOL_V3_CONTRACT[key],
            APPLICATIONS_PROTOCOL_V2_CONTRACT[key],
        );
    }
    assert.equal(
        APPLICATIONS_PROTOCOL_V3_CONTRACT.artifacts.croCandidateSchema,
        APPLICATIONS_PROTOCOL_V2_CONTRACT.artifacts.croCandidateSchema,
    );
    assert.equal(
        APPLICATIONS_PROTOCOL_V3_CONTRACT.traceSchemas.compression,
        "shepherd.application.compression.v1",
    );
    const { forkStepPolicies, forkStepPolicy, ...v3Compression } =
        APPLICATIONS_PROTOCOL_V7_CONTRACT.compression;
    assert.deepEqual(v3Compression, APPLICATIONS_PROTOCOL_V3_CONTRACT.compression);
    assert.deepEqual(forkStepPolicies, ["clamp", "reject"]);
    assert.equal(forkStepPolicy, "clamp");
    assert.deepEqual(APPLICATION_COMPRESSION_FORK_STEP_POLICIES, forkStepPolicies);
    assert.deepEqual(
        applicationsProtocolConfig.compression,
        APPLICATIONS_PROTOCOL_V7_CONTRACT.compression,
    );
    assert.deepEqual(APPLICATION_COMPRESSION_PHASES, ["opened", "candidate", "outcome"]);
    assert.deepEqual(APPLICATION_COMPRESSION_CANDIDATE_KINDS, ["compression", "control"]);
    assert.deepEqual(APPLICATION_COMPRESSION_CANDIDATE_STATUSES, [
        "proposed",
        "rewound",
        "settled",
        "rejected",
    ]);
    assert.deepEqual(APPLICATION_COMPRESSION_OUTCOMES, ["pruned", "no_prune", "restored"]);
    assert.deepEqual(APPLICATION_COMPRESSION_VERDICTS, ["accepted", "rejected"]);
    assert.deepEqual(APPLICATION_COMPRESSION_BASELINE_KINDS, ["no_compression"]);
    const mutations: readonly ((compression: Record<string, unknown>) => void)[] = [
        (compression) => {
            compression.artifactRoles = {
                ...(compression.artifactRoles as object),
                outcome: "compression_candidate",
            };
        },
        (compression) => {
            compression.baselineKinds = ["no_compression", "other"];
        },
        (compression) => {
            compression.budgetKeys = { bestOfN: "same", providerCalls: "same" };
        },
        (compression) => {
            compression.childFields = { input: "same", output: "same" };
        },
        (compression) => {
            compression.outcomes = ["pruned"];
        },
        (compression) => {
            compression.reasons = { noForkPoint: "" };
        },
        (compression) => {
            delete compression.verdicts;
        },
        (compression) => {
            compression.forkStepPolicy = "wrap";
        },
        (compression) => {
            compression.forkStepPolicies = ["clamp"];
        },
    ];
    for (const mutate of mutations) {
        const config = structuredClone(validConfig);
        mutate(config.applications?.compression as Record<string, unknown>);
        assert.throws(() => parseProtocolConfig(config), TypeError, mutate.toString());
    }
    const drifted = structuredClone(validConfig);
    (drifted.applications?.compression as Record<string, unknown>).baselineKinds = ["full_trace"];
    assert.throws(
        () => parseProtocolConfig(drifted),
        (error: unknown) =>
            error instanceof TypeError && /new applications protocol/u.test(error.message),
    );
});

test("the applications facade exposes trajectory compression as the root does", () => {
    assert.equal(applications.runTrajectoryCompression, root.runTrajectoryCompression);
    assert.equal(applications.inspectTrajectoryCompression, root.inspectTrajectoryCompression);
    assert.equal(
        applications.APPLICATION_COMPRESSION_BASELINE_KINDS,
        root.APPLICATION_COMPRESSION_BASELINE_KINDS,
    );
    assert.equal(
        applications.APPLICATION_COMPRESSION_CANDIDATE_KINDS,
        root.APPLICATION_COMPRESSION_CANDIDATE_KINDS,
    );
    assert.equal(
        applications.APPLICATION_COMPRESSION_CANDIDATE_STATUSES,
        root.APPLICATION_COMPRESSION_CANDIDATE_STATUSES,
    );
    assert.equal(
        applications.APPLICATION_COMPRESSION_OUTCOMES,
        root.APPLICATION_COMPRESSION_OUTCOMES,
    );
    assert.equal(applications.APPLICATION_COMPRESSION_PHASES, root.APPLICATION_COMPRESSION_PHASES);
    assert.equal(
        applications.APPLICATION_COMPRESSION_VERDICTS,
        root.APPLICATION_COMPRESSION_VERDICTS,
    );
});

test("every retained compression record conforms to the generated schema", async () => {
    const shapes = await recordShapes();
    const validator = new Ajv2020({ strict: true, strictTypes: false });
    const document = JSON.parse(
        readFileSync(
            new URL(
                `../../${applicationsProtocolConfig.artifacts.compressionSchema}`,
                import.meta.url,
            ),
            "utf8",
        ),
    ) as AnySchemaObject;
    const validate = validator.compile(document);
    for (const [shape, body] of Object.entries(shapes)) {
        assert.equal(validate(body), true, `${shape}: ${validator.errorsText(validate.errors)}`);
        assert.equal(validate({ ...body, extra: true }), false, shape);
    }
    assert.equal(validate({ ...shapes.pruned, status: "merged" }), false);
    assert.equal(validate({ ...shapes.opened, controls: [1, 1] }), false);
    const proposal = new Ajv2020({ strict: true, strictTypes: false }).compile({
        ...document,
        $ref: "#/$defs/proposal",
        oneOf: undefined,
    } as AnySchemaObject);
    assert.equal(
        proposal({
            fork_point: (shapes.proposed as { fork_point: unknown }).fork_point,
            hint: { cited_step_indices: [1], text: "hint" },
        }),
        true,
    );
    assert.equal(proposal({ fork_point: null, hint: null }), true);
    // A missing fork step (Appendix D.6) is admitted and settles no_prune.
    assert.equal(proposal({}), true);
    assert.equal(proposal({ fork_point: null }), true);
    const sessionId = (shapes.proposed as { fork_point: { session_id: string } }).fork_point
        .session_id;
    for (const stepIndex of [-1, 0, 99]) {
        assert.equal(
            proposal({
                fork_point: { prefix_id: null, session_id: sessionId, step_index: stepIndex },
            }),
            true,
        );
    }
    assert.equal(proposal({ fork_point: { prefix_id: null, session_id: sessionId } }), true);
    assert.equal(proposal({ fork_point: { session_id: sessionId, step_index: 1 } }), false);
    assert.equal(
        proposal({ fork_point: { prefix_id: null, session_id: sessionId, step_index: 1.5 } }),
        false,
    );
});

test("the compression record codecs refuse every inconsistent retained body", async () => {
    const shapes = await recordShapes();
    const {
        clamped,
        control,
        controlRejected,
        noPrune,
        opened,
        outcome,
        proposalRejected,
        proposed,
        pruned,
        restored,
        restart,
        rewound,
        unavailable,
        verificationRejected,
    } = shapes as Record<string, RecordBody>;
    for (const body of [
        proposed,
        rewound,
        pruned,
        restart,
        clamped,
        restored,
        unavailable,
        noPrune,
        control,
        controlRejected,
        verificationRejected,
        proposalRejected,
    ]) {
        assert.equal(
            readCompressionCandidateBody(body as RecordBody).status,
            (body as RecordBody).status,
        );
    }
    assert.deepEqual(readCompressionOpenedBody(opened as RecordBody).controls, [7, 19]);
    assert.equal(readCompressionOutcomeBody(outcome as RecordBody).outcome, "pruned");
    const openedMutations: readonly RecordBody[] = [
        { ...opened, kind: "tree_rl" },
        { ...opened, phase: "candidate" },
        { ...opened, baselines: ["no_compression", "no_compression"] },
        { ...opened, controls: [1.5] },
        { ...opened, controls: [7, 7] },
        { ...opened, controls: [1, 2, 3, 4, 5, 6, 7, 8, 9] },
        { ...opened, source_session_id: "replay-session:sha256:zz" },
        { ...opened, application_version: 2 },
    ];
    for (const body of openedMutations) {
        assert.throws(() => readCompressionOpenedBody(body), ApplicationEvidenceError);
    }
    const restore = pruned?.restore as RecordBody;
    const [constituent] = restore.constituents as readonly RecordBody[];
    const unavailableRestore = unavailable?.restore as RecordBody;
    const candidateMutations: readonly RecordBody[] = [
        { ...pruned, phase: "opened" },
        { ...pruned, status: "merged" },
        { ...pruned, outcome: null },
        { ...proposed, cost: pruned?.cost as RecordBody },
        { ...pruned, seed: 7 },
        { ...control, seed: null },
        { ...control, seed: 1.5 },
        { ...pruned, fork_id: null },
        { ...pruned, score: null },
        { ...pruned, score: "high" },
        { ...control, verdict: "maybe" },
        { ...pruned, verdict: "rejected" },
        { ...restored, verdict: "accepted" },
        { ...pruned, compressor_handle_id: "delegation:sha256:zz" },
        { ...pruned, session_id: "replay-session:sha256:zz" },
        { ...pruned, fork_id: "compression-fork:sha256:zz" },
        { ...pruned, hint_digest: "sha256:zz" },
        { ...pruned, step_count: -1 },
        { ...pruned, reason: "x".repeat(applicationsProtocolConfig.limits.maxReasonLength + 1) },
        { ...pruned, cost: { ...(pruned?.cost as RecordBody), cost_usd: -1 } },
        { ...pruned, fork_point: { ...(pruned?.fork_point as RecordBody), step_index: 0 } },
        { ...restart, fork_point: { ...(pruned?.fork_point as RecordBody), step_index: 0 } },
        { ...restart, fork_point: { ...(restart?.fork_point as RecordBody), step_index: 1 } },
        { ...restart, fork_point: { ...(restart?.fork_point as RecordBody), step_index: -1 } },
        { ...clamped, fork_clamp: { ...(clamped?.fork_clamp as RecordBody), policy: "reject" } },
        {
            ...clamped,
            fork_clamp: { ...(clamped?.fork_clamp as RecordBody), proposed_step_index: 1.5 },
        },
        // A clamp below range must land on step 0; one above range must land below it.
        {
            ...clamped,
            fork_clamp: { ...(clamped?.fork_clamp as RecordBody), proposed_step_index: 0 },
        },
        {
            ...pruned,
            fork_clamp: { ...(clamped?.fork_clamp as RecordBody), proposed_step_index: -1 },
        },
        {
            ...pruned,
            fork_clamp: { ...(clamped?.fork_clamp as RecordBody), proposed_step_index: 1 },
        },
        { ...noPrune, fork_clamp: clamped?.fork_clamp as RecordBody },
        {
            ...clamped,
            fork_clamp: { ...(clamped?.fork_clamp as RecordBody), proposed_prefix_id: "zz" },
        },
        { ...verificationRejected, failure: { code: "OTHER", reason: "x" } },
        { ...pruned, restore: { ...restore, classification: "partial" } },
        { ...pruned, restore: { ...restore, constituents: [] } },
        {
            ...pruned,
            restore: { ...restore, constituents: [{ ...constituent, kind: "memory" }] },
        },
        { ...pruned, restore: { ...restore, restore_record_id: "not-a-record" } },
        { ...pruned, restore: { ...restore, rewind_session_id: "replay-session:sha256:zz" } },
        { ...pruned, restore: { ...restore, classification: "unavailable" } },
        { ...pruned, restore: { ...restore, restore_record_id: null } },
        { ...pruned, restore: unavailableRestore },
        { ...rewound, restore: unavailableRestore },
        { ...unavailable, restore: restore },
    ];
    for (const [index, body] of candidateMutations.entries()) {
        assert.throws(
            () => readCompressionCandidateBody(body),
            ApplicationEvidenceError,
            `candidate mutation ${index}`,
        );
    }
    const baseline = outcome?.baseline as RecordBody;
    const controlComparison = outcome?.control as RecordBody;
    const outcomeMutations: readonly RecordBody[] = [
        { ...outcome, phase: "candidate" },
        { ...outcome, outcome: "trimmed" },
        { ...outcome, original_step_count: 0, step_count_ratio: null },
        { ...outcome, step_count_ratio: 0.5 },
        { ...outcome, baseline: { ...baseline, kind: "whole" } },
        { ...outcome, baseline: { ...baseline, step_count_ratio: 0.5 } },
        { ...outcome, control: { ...controlComparison, seed: 1.5 } },
        { ...outcome, result_session_id: "replay-session:sha256:zz" },
    ];
    for (const [index, body] of outcomeMutations.entries()) {
        assert.throws(
            () => readCompressionOutcomeBody(body),
            ApplicationEvidenceError,
            `outcome mutation ${index}`,
        );
    }
    assert.throws(
        () => readTrajectoryVerdict({ reason: "r", score: 1, verdict: "maybe" }),
        TypeError,
    );
    // A missing fork step validates to a null fork point instead of refusing the proposal.
    assert.equal(readTrajectoryProposal({}).fork_point, null);
    assert.equal(readTrajectoryProposal({ fork_point: null }).fork_point, null);
    assert.equal(
        readTrajectoryProposal({
            fork_point: {
                prefix_id: null,
                session_id: ((pruned as RecordBody).fork_point as { session_id: string })
                    .session_id,
            },
            hint: null,
        }).fork_point,
        null,
    );
    assert.throws(() => readTrajectoryProposal({ fork_point: 1 }), TypeError);
    assert.throws(
        () =>
            readTrajectoryProposal({
                fork_point: { ...(pruned?.fork_point as RecordBody), step_index: 1.5 },
            }),
        TypeError,
    );
    assert.throws(() => readChildOutputText({ result: "" }), TypeError);
    assert.throws(() => readChildOutputText({ other: "{}" }), TypeError);
});

test("fork-step resolution restarts at step 0 and clamps or rejects out-of-range steps by policy", () => {
    const [clamp, reject] = APPLICATION_COMPRESSION_FORK_STEP_POLICIES;
    const sessionId = `replay-session:sha256:${"a".repeat(64)}`;
    const prefixes = [1, 2, 3].map((digit) => `replay-prefix:sha256:${String(digit).repeat(64)}`);
    const source = { session_id: sessionId, steps: prefixes.map((prefix_id) => ({ prefix_id })) };
    const resolve = (
        stepIndex: number,
        prefixId: string | null,
        policy: typeof clamp | typeof reject = clamp,
        hint: { cited_step_indices: number[]; text: string } | null = null,
    ) =>
        resolveTrajectoryProposal(
            readTrajectoryProposal({
                fork_point: { prefix_id: prefixId, session_id: sessionId, step_index: stepIndex },
                hint,
            }),
            source as never,
            policy as never,
        );
    // f = 0 restarts from the initial prefix: the prefix identity is null and nothing is clamped.
    assert.deepEqual(resolve(0, null), {
        fork_clamp: null,
        fork_point: { prefix_id: null, session_id: sessionId, step_index: 0 },
    });
    assert.throws(() => resolve(0, prefixes[0] as string), /prefix identity/u);
    // In range, the retained prefix identity is required.
    assert.equal(resolve(2, prefixes[1] as string).fork_point?.step_index, 2);
    assert.throws(() => resolve(2, prefixes[0] as string), /prefix identity/u);
    // f = n clamps to n - 1 and f = -1 clamps to 0, retaining the proposal as evidence.
    assert.deepEqual(resolve(3, null), {
        fork_clamp: { policy: clamp, proposed_prefix_id: null, proposed_step_index: 3 },
        fork_point: { prefix_id: prefixes[1], session_id: sessionId, step_index: 2 },
    });
    assert.deepEqual(resolve(-1, prefixes[2] as string), {
        fork_clamp: { policy: clamp, proposed_prefix_id: prefixes[2], proposed_step_index: -1 },
        fork_point: { prefix_id: null, session_id: sessionId, step_index: 0 },
    });
    // The reject policy refuses every out-of-range step.
    for (const stepIndex of [-1, 3, 99]) {
        assert.throws(() => resolve(stepIndex, null, reject), /reject fork-step policy/u);
    }
    assert.equal(resolve(0, null, reject).fork_clamp, null);
    // Session, empty-source, and citation checks run under either policy.
    assert.throws(
        () =>
            resolveTrajectoryProposal(
                readTrajectoryProposal({
                    fork_point: {
                        prefix_id: null,
                        session_id: `replay-session:sha256:${"b".repeat(64)}`,
                        step_index: 0,
                    },
                }),
                source as never,
                clamp as never,
            ),
        /source session/u,
    );
    assert.throws(
        () =>
            resolveTrajectoryProposal(
                readTrajectoryProposal({
                    fork_point: { prefix_id: null, session_id: sessionId, step_index: 0 },
                }),
                { session_id: sessionId, steps: [] } as never,
                clamp as never,
            ),
        /retains no step/u,
    );
    assert.throws(
        () => resolve(9, null, clamp, { cited_step_indices: [3], text: "hint" }),
        /hint cites a step outside/u,
    );
    // A missing fork step resolves to null, with or without a hint.
    for (const proposal of [
        {},
        { fork_point: null },
        { hint: { cited_step_indices: [0], text: "h" } },
    ]) {
        assert.deepEqual(
            resolveTrajectoryProposal(
                readTrajectoryProposal(proposal),
                source as never,
                clamp as never,
            ),
            { fork_clamp: null, fork_point: null },
        );
    }
});

test("inspection refuses forged, late, reordered, or inconsistent compression records", async () => {
    using store = new SQLiteTraceStore();
    const commandId = "application:compression:forged";
    const inspection = await completedRun(store, commandId);
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
                traceSchema,
                [head],
            ),
            null,
        );
        assert.equal(appended.status, "appended");
    };
    const refuses = (target: SQLiteTraceStore, owner: string, pattern: RegExp) =>
        assert.throws(
            () => inspectTrajectoryCompression(target, owner),
            (error: unknown) =>
                error instanceof ApplicationEvidenceError && pattern.test(error.message),
        );
    // A record after the terminal cut is refused.
    forge(store, applicationId, "forged-outcome", bodyOf(store, inspection.outcome?.record_id));
    refuses(store, applicationId, /terminal cut/u);
    // Runs stopped by a failure, and runs forged out of order, refuse later records.
    const partial = async (label: string, options: Parameters<typeof compressionOptions>[1]) => {
        const partialStore = new SQLiteTraceStore();
        const partialCommand = `application:compression:forged:${label}`;
        await runTrajectoryCompression(
            partialStore,
            compressionOptions(partialCommand, options),
        ).catch(() => undefined);
        return { owner: deriveApplicationOwnerId(partialCommand), store: partialStore };
    };
    const stopped = await partial("stopped", {
        compressor: compressorOf(() => ({ fork_point: 1, hint: null })),
    });
    forge(
        stopped.store,
        stopped.owner,
        "late",
        bodyOf(
            stopped.store,
            inspectTrajectoryCompression(stopped.store, stopped.owner).compression.outcome
                ?.record_id,
        ),
    );
    refuses(stopped.store, stopped.owner, /late/u);
    stopped.store.close();
    const budgeted = await partial("budgeted", {
        controlProvider: () => stageProvider("base"),
        protocol: compressionProtocolWithBudgets({ maxProviderCalls: 10 }),
    });
    const budgetedInspection = inspectTrajectoryCompression(budgeted.store, budgeted.owner);
    const settledBody = bodyOf(budgeted.store, budgetedInspection.compression.outcome?.record_id);
    const proposedBody = bodyOf(budgeted.store, budgetedInspection.compression.proposed?.record_id);
    const forgeries: readonly [string, RecordBody, RegExp][] = [
        ["second-settled", settledBody, /control record is out of seed order/u],
        [
            "foreign",
            { ...settledBody, application_id: deriveApplicationOwnerId("x") },
            /another application/u,
        ],
        [
            "outcome-early",
            bodyOf(store, inspection.outcome?.record_id),
            /outcome record disagrees/u,
        ],
        [
            "proposal-late",
            {
                ...proposedBody,
                candidate: "control",
                compressor_handle_id: null,
                fork_id: null,
                fork_point: null,
                hint_digest: null,
                seed: 7,
            },
            /trajectory compression candidate evidence is malformed/u,
        ],
    ];
    for (const [label, body, pattern] of forgeries) {
        const forged = new SQLiteTraceStore();
        forged.importTrace(budgeted.store.exportTrace());
        forge(forged, budgeted.owner, label, body);
        refuses(forged, budgeted.owner, pattern);
        forged.close();
    }
    budgeted.store.close();
    // A second proposal after the first is out of order.
    const reordered = await partial("reordered", {
        protocol: compressionProtocolWithBudgets({ bestOfN: 0, maxProviderCalls: 5 }),
    });
    const reorderedInspection = inspectTrajectoryCompression(reordered.store, reordered.owner);
    forge(
        reordered.store,
        reordered.owner,
        "second-proposed",
        bodyOf(reordered.store, reorderedInspection.compression.proposed?.record_id),
    );
    refuses(reordered.store, reordered.owner, /out of order/u);
    reordered.store.close();
    // An application path that holds no compression record is not a compression.
    refuses(store, deriveApplicationOwnerId("absent"), /not retained/u);
    assert.throws(() => inspectTrajectoryCompression(store, "application:bad"), TypeError);
});
