import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import { Ajv2020, type AnySchemaObject } from "ajv/dist/2020.js";

import {
    type ApplicationEvaluationBinding,
    type ApplicationEvaluationExperiment,
    type ApplicationEvaluationReport,
    type ApplicationManifest,
    applicationProtocolId,
    type CodingSupervisorDecision,
    type CodingSupervisorPolicyContext,
    type CodingSupervisorWorkerDefinition,
    type CodingSupervisorWorkerProgram,
    deriveApplicationOwnerId,
    exportTreeRlTrainingBatch,
    inspectApplicationManifest,
    inspectCodingSupervisorRun,
    inspectCounterfactualOptimization,
    inspectTrajectoryCompression,
    inspectTreeRlRun,
    readApplicationProtocol,
    runApplicationEvaluation,
    runCodingSupervisor,
    TraceStoreError,
    validateApplicationEvaluationReport,
    validateApplicationManifest,
} from "../../src/facades/applications.ts";
import {
    inspectChildRun,
    inspectReplaySession,
    inspectScope,
    type RecordId,
    type ReplaySessionInspection,
    ROOT_WITNESS_ID,
    SQLiteTraceStore,
    type StoreAppendRequest,
} from "../../src/index.ts";
import { applicationsProtocolConfig } from "../../src/protocol/config.ts";
import { renderEvaluationReportJson } from "../../tooling/evaluation/writer.ts";
import { bindingGrant } from "../scope/fork-fixtures.ts";
import { repositoryEvaluation, researchConfiguration } from "./evaluation-fixtures.ts";
import { createSupervisorWorld, type SupervisorWorld } from "./world-adapter-fixture.ts";

const MANIFEST_SCHEMA = "shepherd.application.manifest.v1";
const SUCCESSOR = "supervisor:evaluation-successor";

/** Program that writes the edit into its world custody, or echoes it on the trace-only path. */
const writeEdit: CodingSupervisorWorkerProgram = async ({ custody, input }) => {
    const edit = input as { readonly path: string; readonly text: string };
    if (custody !== null) {
        await writeFile(path.join(custody.root, edit.path), `${edit.text}\n`);
    }
    return { path: edit.path, text: edit.text };
};

/**
 * The repository supervisor binding moved onto real scope custody: program-serviced workers edit
 * the configured dataset file in forked worlds, and the policy injects, discards and restarts,
 * hands off, and accepts, so every causal fork and replay seam is exercised.
 */
function worldBinding(
    binding: ApplicationEvaluationBinding,
    world: SupervisorWorld,
): ApplicationEvaluationBinding {
    if (binding.kind !== "coding_supervisor") {
        return binding;
    }
    const { changedPaths: _changedPaths, ...options } = binding.options;
    const grant = [bindingGrant(world.source)];
    const workers: CodingSupervisorWorkerDefinition[] = options.workers.map((worker) => {
        const { provider: _provider, ...rest } = worker;
        return { ...rest, grant, program: writeEdit };
    });
    const policy = (context: CodingSupervisorPolicyContext): CodingSupervisorDecision => {
        const [first] = context.observations;
        const decisions: readonly CodingSupervisorDecision[] = [
            {
                cited_record_ids: [first?.head_record_id as RecordId],
                data: { hint: "keep the greeting short" },
                kind: "inject",
                worker_id: "a",
            },
            { kind: "discard_restart", reason: "b overlaps a on the same path", worker_id: "b" },
            {
                kind: "handoff",
                reason: "second reviewer",
                successor_supervisor_id: SUCCESSOR,
                worker_id: "b",
            },
            { kind: "accept", worker_id: "b" },
        ];
        return decisions[context.round - 1] as CodingSupervisorDecision;
    };
    return {
        kind: binding.kind,
        options: {
            ...options,
            clock: () => 2_000,
            parent: { ...options.parent, ceiling: grant },
            policy,
            workers,
            world: world.adapter,
        },
    };
}

/** Every inspection the scenario compares across the live, read-only, and imported stores. */
function inspectAll(store: SQLiteTraceStore, report: ApplicationEvaluationReport) {
    const [supervisorRun, optimizerRun, compressionRun, treeRlRun] = report.runs.map(
        (run) => run.application_id,
    ) as [string, string, string, string];
    const supervisor = inspectCodingSupervisorRun(store, supervisorRun);
    const optimizer = inspectCounterfactualOptimization(store, optimizerRun);
    const compression = inspectTrajectoryCompression(store, compressionRun);
    const treeRl = inspectTreeRlRun(store, treeRlRun);
    const handles = [
        ...supervisor.workers.flatMap((worker) => worker.attempts.map((a) => a.handle_id)),
        ...(report.baselines[0]?.evidence ?? []),
    ];
    const sessions = [
        ...optimizer.examples.map((example) => example.session_id),
        ...optimizer.candidates.flatMap((candidate) =>
            [...candidate.targeted, ...(candidate.dev ?? []), ...(candidate.train ?? [])].flatMap(
                (result) => [result.session_id, result.baseline?.session_id as string],
            ),
        ),
        compression.source_session_id,
        compression.compression.rewound?.restore?.rewind_session_id as string,
        compression.outcome?.result_session_id as string,
        ...treeRl.roots.map((root) => root.root_session_id),
        ...treeRl.rollouts.map((rollout) => rollout.replay_session_id),
    ];
    return {
        batch: exportTreeRlTrainingBatch(store, treeRlRun),
        compression,
        handles: handles.map((handleId) => inspectChildRun(store, handleId)),
        manifests: report.runs.map((run) => inspectApplicationManifest(store, run.application_id)),
        optimizer,
        sessions: sessions.map((sessionId) =>
            sessionView(inspectReplaySession(store, { sessionId })),
        ),
        supervisor,
        treeRl,
    };
}

/** A replay session inspection without the store-local writer-row flag. */
function sessionView(session: ReplaySessionInspection) {
    const { live: _live, ...view } = session;
    return view;
}

/** Proves that a branch session was restored from the named source prefix. */
function assertBranchOrigin(
    store: SQLiteTraceStore,
    branchSessionId: string,
    target: {
        readonly prefix_id: string | null;
        readonly source_session_id: string;
        readonly step_index: number;
    },
    label: string,
): void {
    const branch = inspectReplaySession(store, { sessionId: branchSessionId });
    const source = inspectReplaySession(store, { sessionId: target.source_session_id });
    assert.equal(branch.origin?.source_session_id, target.source_session_id, label);
    assert.equal(branch.origin?.source_session_record_id, source.session_record_id, label);
    assert.equal(branch.origin?.target_step_count, target.step_index, label);
    assert.equal(branch.restore?.prefix_id, target.prefix_id, label);
    assert.equal(
        target.step_index === 0 ? null : source.steps[target.step_index - 1]?.prefix_id,
        target.prefix_id,
        label,
    );
    assert.ok(store.readCut(branch.origin?.target_trace_cut_id as never), label);
    // Steps before the target are served from the source journal, never live.
    for (const step of branch.steps.slice(0, target.step_index)) {
        assert.notEqual(step.source, "live", label);
    }
}

test("research applications conformance: four applications in one store, visible causal fork and replay evidence, and identical inspection from an imported archive", async (context) => {
    const world = await createSupervisorWorld(context, "applications-conformance");
    const { store } = world;
    const configuration = researchConfiguration();
    const evaluation = repositoryEvaluation();
    const bound: string[] = [];
    const bind = (experiment: ApplicationEvaluationExperiment) => {
        bound.push(experiment.id);
        return worldBinding(evaluation.bind(experiment), world);
    };
    const report = await runApplicationEvaluation(store, {
        bind,
        definition: evaluation.definition,
    });
    assert.deepEqual(
        report.runs.map((run) => run.kind),
        ["coding_supervisor", "counterfactual_optimization", "trajectory_compression", "tree_rl"],
    );
    assert.deepEqual(bound, [
        "coding-supervisor",
        "counterfactual-optimization",
        "trajectory-compression",
        "tree-rl",
    ]);

    // The evaluation report cites exactly the manifests the store retains, one per application,
    // each under the application identity derived from the experiment's command.
    const retainedApplications = [...store.listOwnersBySchema(MANIFEST_SCHEMA, 64, 0)].sort();
    assert.deepEqual(retainedApplications, report.runs.map((run) => run.application_id).sort());
    const manifestSchema = new Ajv2020({ strict: true, strictTypes: false }).compile(
        JSON.parse(
            readFileSync(
                new URL(
                    `../../${applicationsProtocolConfig.artifacts.manifestSchema}`,
                    import.meta.url,
                ),
                "utf8",
            ),
        ) as AnySchemaObject,
    );
    const manifests: ApplicationManifest[] = [];
    for (const [index, run] of report.runs.entries()) {
        const experiment = evaluation.definition.experiments[
            index
        ] as ApplicationEvaluationExperiment;
        assert.equal(run.application_id, deriveApplicationOwnerId(experiment.commandId));
        const { manifest } = inspectApplicationManifest(store, run.application_id);
        manifests.push(manifest);
        assert.equal(manifest.manifest_id, run.manifest_id);
        assert.deepEqual(
            validateApplicationManifest(JSON.parse(JSON.stringify(manifest))),
            manifest,
        );
        assert.equal(
            manifestSchema(JSON.parse(JSON.stringify(manifest))),
            true,
            JSON.stringify(manifestSchema.errors),
        );
        // Every manifest cites the configured protocol: the section named by the experiment.
        const configured = readApplicationProtocol(
            configuration[
                (
                    configuration.evaluation as {
                        definition: { experiments: { protocol: string }[] };
                    }
                ).definition.experiments[index]?.protocol as string
            ],
        );
        assert.equal(manifest.protocol_id, applicationProtocolId(configured));
        assert.equal(manifest.protocol_version, configured.protocolVersion);
        assert.equal(manifest.kind, configured.kind);
        assert.deepEqual(manifest.seeds, configured.seeds);
        assert.deepEqual(manifest.dataset, configured.dataset);
        assert.deepEqual(
            manifest.surfaces.map((surface) => [surface.id, surface.kind, surface.role]),
            configured.surfaces.map((surface) => [surface.id, surface.kind, surface.role]),
        );
        assert.deepEqual(run.costs, manifest.costs);
        assert.equal(run.protocol_id, manifest.protocol_id);
    }
    const reportText = renderEvaluationReportJson(report);
    assert.deepEqual(validateApplicationEvaluationReport(JSON.parse(reportText)), report);
    // The three unchanged experiments reproduce the checked repository report exactly.
    const generated = JSON.parse(
        readFileSync(new URL(`../../${evaluation.artifacts.report}`, import.meta.url), "utf8"),
    ) as ApplicationEvaluationReport;
    for (const key of ["runs", "baselines", "comparisons"] as const) {
        assert.deepEqual(
            JSON.parse(JSON.stringify(report[key].slice(1))),
            generated[key].slice(1),
            key,
        );
    }
    assert.notEqual(report.runs[0]?.manifest_id, generated.runs[0]?.manifest_id);

    // Export the archive and read it back into a fresh store and read-only through the file.
    const live = inspectAll(store, report);
    const archive = store.exportTrace();
    using imported = new SQLiteTraceStore();
    imported.importTrace(archive);
    using readOnly = new SQLiteTraceStore(world.databasePath, { readOnly: true });
    assert.deepEqual(inspectAll(imported, report), live);
    assert.deepEqual(inspectAll(readOnly, report), live);
    assert.equal(
        exportTreeRlTrainingBatch(imported, report.runs[3]?.application_id as string).batch_digest,
        live.batch.batch_digest,
    );
    assert.deepEqual(
        [...imported.listOwnersBySchema(MANIFEST_SCHEMA, 64, 0)].sort(),
        retainedApplications,
    );

    // Everything below reads only the imported archive.
    // Every manifest artifact resolves to a retained record and a published cut.
    for (const manifest of manifests) {
        for (const artifact of manifest.artifacts) {
            if (artifact.record_id !== null) {
                assert.ok(imported.readRecord(artifact.record_id), artifact.role);
            }
            if (artifact.cut_id !== null) {
                assert.ok(imported.readCut(artifact.cut_id as never), artifact.role);
            }
        }
    }

    // Coding supervisor: delegation discard decision and retry cut, and scope fork, merge, and
    // discard records.
    const supervisor = inspectCodingSupervisorRun(
        imported,
        report.runs[0]?.application_id as string,
    );
    assert.equal(supervisor.world, true);
    assert.deepEqual(
        supervisor.decisions.map((decision) => [decision.decision.kind, decision.conflict.kind]),
        [
            ["inject", "none"],
            ["discard_restart", "path_overlap"],
            ["handoff", "path_overlap"],
            ["accept", "path_overlap"],
        ],
    );
    const restart = supervisor.decisions[1]?.evidence as {
        readonly decision_record_id: RecordId;
        readonly discard_receipt_id: RecordId;
        readonly fork_receipt_id: RecordId;
        readonly retry_cut_id: string;
        readonly successor_handle_id: string;
    };
    const [restarted, successor] = supervisor.workers[1]?.attempts ?? [];
    assert.equal(restarted?.status, "restarted");
    assert.equal(restarted?.inspection.decision?.kind, "discarded");
    assert.equal(restarted?.inspection.decision?.record_id, restart.decision_record_id);
    assert.equal(successor?.handle_id, restart.successor_handle_id);
    assert.deepEqual(successor?.inspection.predecessor, {
        cut_id: restart.retry_cut_id,
        decision_record_id: restart.decision_record_id,
        handle_id: restarted?.handle_id,
    });
    assert.match(restart.retry_cut_id, /^delegation-retry:sha256:/u);
    assert.ok(imported.readCut(restart.retry_cut_id as never));
    assert.equal(successor?.status, "accepted");
    assert.equal(successor?.inspection.supervisor_id, SUCCESSOR);
    const accept = supervisor.decisions[3]?.evidence as {
        readonly discarded: readonly { readonly discard_receipt_id: RecordId }[];
        readonly merge_receipt_id: RecordId;
    };
    const children = (inspectScope(imported, world.parent.scope_id)?.children ?? []).map(
        (scopeId) => inspectScope(imported, scopeId),
    );
    assert.deepEqual(children.map((child) => child?.state).sort(), [
        "discarded",
        "discarded",
        "merged",
    ]);
    for (const child of children) {
        assert.equal(child?.parent?.scope_id, world.parent.scope_id);
    }
    const receipts = [
        restart.fork_receipt_id,
        restart.discard_receipt_id,
        accept.merge_receipt_id,
        ...accept.discarded.map((entry) => entry.discard_receipt_id),
    ];
    for (const receipt of receipts) {
        assert.ok(imported.readRecord(receipt), receipt);
    }
    const roles = (manifest: ApplicationManifest) =>
        manifest.artifacts.map((artifact) => artifact.role).sort();
    assert.deepEqual(
        roles(manifests[0] as ApplicationManifest).filter((role) => role.startsWith("world_")),
        ["world_discard", "world_discard", "world_fork", "world_fork", "world_fork", "world_merge"],
    );

    // Counterfactual optimizer: every candidate example branch is restored from its target prefix
    // on its parent's session for that example, and the promoted candidate is selected.
    const optimizer = inspectCounterfactualOptimization(
        imported,
        report.runs[1]?.application_id as string,
    );
    assert.equal(optimizer.candidates.length, 3);
    const baselineSessions = new Set(optimizer.examples.map((example) => example.session_id));
    for (const candidate of optimizer.candidates) {
        const parent = optimizer.candidates.find(
            (entry) => entry.candidate_id === candidate.parent_candidate_id,
        );
        const parentSessions = new Set(
            parent === undefined
                ? baselineSessions
                : [...parent.targeted, ...(parent.dev ?? []), ...(parent.train ?? [])].map(
                      (result) => result.session_id,
                  ),
        );
        for (const result of [
            ...candidate.targeted,
            ...(candidate.dev ?? []),
            ...(candidate.train ?? []),
        ]) {
            assert.ok(parentSessions.has(result.target.source_session_id));
            assertBranchOrigin(
                imported,
                result.session_id,
                result.target,
                `candidate ${candidate.candidate_id} on ${result.example_id}`,
            );
            // The full-replay baseline starts at step zero of the same source.
            const full = inspectReplaySession(imported, {
                sessionId: result.baseline?.session_id as string,
            });
            assert.equal(full.origin?.source_session_id, result.target.source_session_id);
            assert.equal(full.origin?.target_step_count, 0);
        }
    }
    assert.equal(
        optimizer.selection?.selected_candidate_id,
        optimizer.candidates.find((candidate) => candidate.status === "promoted")?.candidate_id,
    );

    // Trajectory compression: the rewind and the compressed suffix are restored from the
    // compressor's fork point on the source.
    const compression = inspectTrajectoryCompression(
        imported,
        report.runs[2]?.application_id as string,
    );
    const forkPoint = compression.compression.outcome?.fork_point;
    assert.ok(forkPoint);
    assert.equal(forkPoint.session_id, compression.source_session_id);
    assert.equal(compression.outcome?.outcome, "pruned");
    const rewind = inspectReplaySession(imported, {
        sessionId: compression.compression.rewound?.restore?.rewind_session_id as string,
    });
    assert.equal(rewind.terminal?.status, "rewound");
    assert.equal(rewind.origin?.target_step_count, forkPoint.step_index);
    assertBranchOrigin(
        imported,
        compression.outcome?.result_session_id as string,
        { ...forkPoint, source_session_id: forkPoint.session_id },
        "compressed",
    );
    assert.ok(
        (compression.outcome?.result_step_count as number) <
            (compression.outcome?.original_step_count as number),
    );

    // Tree-RL: every rollout is restored from its root's selected fork point, and the training batch
    // digest reads identically.
    const treeRl = inspectTreeRlRun(imported, report.runs[3]?.application_id as string);
    for (const rollout of treeRl.rollouts) {
        assertBranchOrigin(
            imported,
            rollout.replay_session_id,
            { ...rollout.fork_point, source_session_id: rollout.root_session_id },
            rollout.rollout_id,
        );
    }
    assert.equal(treeRl.batch?.batch_digest, live.batch.batch_digest);

    // The imported archive is an inspection source: raw appends to an application owner path are
    // refused and leave every inspection unchanged.
    const forgedAppend: StoreAppendRequest = {
        append_intent_id: "conformance:forged-application-append",
        batch: {
            groups: [
                {
                    owner_id: report.runs[0]?.application_id as string,
                    records: [
                        {
                            body: { forged: true },
                            mode: "capture",
                            schema_ref: MANIFEST_SCHEMA,
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    };
    assert.throws(() => imported.append(forgedAppend), TraceStoreError);
    assert.deepEqual(inspectAll(imported, report), live);

    // Repeating the supervisor command on the live store returns the retained manifest without
    // consulting the policy or any worker again.
    const supervisorBinding = worldBinding(
        evaluation.bind(evaluation.definition.experiments[0] as ApplicationEvaluationExperiment),
        world,
    );
    if (supervisorBinding.kind !== "coding_supervisor") {
        throw new TypeError("expected the supervisor binding");
    }
    const repeated = await runCodingSupervisor(store, {
        ...supervisorBinding.options,
        commandId: evaluation.definition.experiments[0]?.commandId as string,
        policy: () => {
            throw new Error("the policy must not run again");
        },
        protocol: evaluation.definition.experiments[0]?.protocol as never,
    });
    assert.deepEqual(repeated.manifest, manifests[0]);
    assert.equal(imported.verifyIntegrity().ok, true);
    assert.equal(store.verifyIntegrity().ok, true);
});
