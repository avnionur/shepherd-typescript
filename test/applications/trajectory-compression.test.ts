import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
    ApplicationEvidenceError,
    deriveApplicationOwnerId,
    inspectReplaySession,
    inspectTrajectoryCompression,
    runTrajectoryCompression,
    SQLiteTraceStore,
    type TrajectoryCompressionGuidance,
    type TrajectoryCompressorContext,
    type TrajectoryVerifierContext,
} from "../../src/index.ts";
import {
    childProvider,
    compressionOptions,
    compressionProtocolWithBudgets,
    compressorOf,
    exploreWorkflow,
    forkAt,
    notifyHandlers,
    stageProvider,
    unavailableSession,
    verifiedSession,
    verifierOf,
} from "./compression-fixtures.ts";

const SESSION_SCHEMA = "shepherd.replay.session.v1";
const RESTORE_SCHEMA = "shepherd.replay.restore.v1";

function replaySessions(store: SQLiteTraceStore): readonly string[] {
    return store.listOwnersBySchema(SESSION_SCHEMA, 256, 0);
}

function restoreRecords(store: SQLiteTraceStore, sessionId: string): number {
    return store
        .readOwner(sessionId)
        .filter((record) => record.envelope.schema_ref === RESTORE_SCHEMA).length;
}

function seededControls(seed: number) {
    return stageProvider("base", seed === 19 ? { doneAt: "explore-a" } : {});
}

test("an accepted fork point prunes the suffix into a shorter verified session with measured controls", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-compression-pruned-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const databasePath = path.join(directory, "trace.sqlite");
    using store = new SQLiteTraceStore(databasePath);
    const base = stageProvider("base");
    const guided: TrajectoryCompressionGuidance[] = [];
    const compressorContexts: TrajectoryCompressorContext[] = [];
    const verifierContexts: TrajectoryVerifierContext[] = [];
    const controlProviders = new Map<number, ReturnType<typeof stageProvider>>();
    const commandId = "application:compression:pruned";
    const options = compressionOptions(commandId, {
        baselines: ["no_compression"],
        compressor: compressorOf(forkAt(1), compressorContexts),
        controlProvider: (seed) => {
            const provider = seededControls(seed);
            controlProviders.set(seed, provider);
            return provider;
        },
        verifier: verifierOf(undefined, verifierContexts),
        workflow: {
            handlers: notifyHandlers,
            program: exploreWorkflow({ guided }),
            programId: "workflow:explore-answer.v1",
            provider: base,
        },
    });
    const { inspection, manifest } = await runTrajectoryCompression(store, options);
    const applicationId = deriveApplicationOwnerId(commandId);
    assert.equal(inspection.application_id, applicationId);
    assert.equal(inspection.kind, "trajectory_compression");
    assert.deepEqual(inspection.baselines, ["no_compression"]);
    const source = inspectReplaySession(store, { sessionId: inspection.source_session_id });
    assert.deepEqual(
        source.steps.map((step) => step.kind),
        ["provider", "provider", "provider", "effect", "provider"],
    );
    // The compressor saw the source, and its fork point and hint were validated and retained.
    assert.equal(compressorContexts.length, 1);
    assert.equal(compressorContexts[0]?.source.session_id, source.session_id);
    const evidence = JSON.parse(
        ((compressorContexts[0] as TrajectoryCompressorContext).input as Record<string, string>)
            .evidence as string,
    ) as { readonly source: { readonly step_count: number; readonly steps: readonly unknown[] } };
    assert.equal(evidence.source.step_count, 5);
    assert.equal(evidence.source.steps.length, 5);
    const { outcome: settled, proposed, rewound } = inspection.compression;
    assert.ok(settled && proposed && rewound);
    const forkPoint = {
        prefix_id: source.steps[0]?.prefix_id,
        session_id: source.session_id,
        step_index: 1,
    };
    assert.deepEqual(proposed.fork_point, forkPoint);
    assert.equal(proposed.status, "proposed");
    assert.equal(proposed.restore, null);
    assert.match(proposed.fork_id as string, /^compression-fork:sha256:[0-9a-f]{64}$/u);
    assert.match(proposed.hint_digest as string, /^sha256:[0-9a-f]{64}$/u);
    // The rewind restored the fork point before any suffix ran, exactly once.
    assert.equal(rewound.status, "rewound");
    assert.equal(rewound.restore?.classification, "reconstructive");
    assert.deepEqual(
        rewound.restore?.constituents.map((entry) => [entry.kind, entry.status]),
        [
            ["trace_cut", "verified"],
            ["provider_session", "reconstructive"],
            ["irreversible_effects", "verified"],
        ],
    );
    const rewind = inspectReplaySession(store, {
        sessionId: rewound.restore?.rewind_session_id as string,
    });
    assert.equal(rewind.mode, "rewind");
    assert.equal(rewind.terminal?.status, "rewound");
    assert.equal(rewind.restore?.record_id, rewound.restore?.restore_record_id);
    assert.equal(restoreRecords(store, rewind.session_id), 1);
    // The suffix was re-executed under the hint: one recorded step, then the answer live.
    assert.equal(settled.status, "settled");
    assert.equal(settled.outcome, "pruned");
    assert.equal(settled.verdict, "accepted");
    assert.equal(settled.score, 1);
    assert.equal(settled.reason, "the candidate reaches the original result");
    assert.equal(settled.restoration_session_id, null);
    assert.deepEqual(settled.restore, rewound.restore);
    const compressed = inspectReplaySession(store, { sessionId: settled.session_id as string });
    assert.equal(compressed.origin?.source_session_id, source.session_id);
    assert.equal(compressed.origin?.target_step_count, 1);
    assert.deepEqual(
        compressed.steps.map((step) => step.source),
        ["recorded", "live"],
    );
    assert.ok(compressed.steps.length < source.steps.length);
    assert.equal(settled.step_count, 2);
    assert.deepEqual(compressed.terminal?.result, source.terminal?.result);
    assert.deepEqual(guided, [
        {
            fork_point: forkPoint,
            hint: { cited_step_indices: [1, 2], text: "answer directly from the plan" },
        },
    ]);
    // The verifier received the original and compressed inspections, the fork point, and the hint.
    const [compressionVerdict, ...controlVerdicts] = verifierContexts;
    assert.equal(compressionVerdict?.candidate, "compression");
    assert.equal(compressionVerdict?.seed, null);
    assert.equal(compressionVerdict?.original.session_id, source.session_id);
    assert.equal(compressionVerdict?.compressed.session_id, compressed.session_id);
    assert.deepEqual(compressionVerdict?.fork_point, forkPoint);
    assert.equal(compressionVerdict?.hint?.text, "answer directly from the plan");
    // Two seeded plain reruns form the best-of-N control; seed 19 finishes exploring early.
    assert.deepEqual(
        controlVerdicts.map((entry) => [entry.candidate, entry.seed, entry.fork_point]),
        [
            ["control", 7, null],
            ["control", 19, null],
        ],
    );
    assert.deepEqual(
        inspection.controls.map((control) => [
            control.seed,
            control.outcome?.status,
            control.outcome?.verdict,
            control.outcome?.step_count,
            control.outcome?.outcome,
        ]),
        [
            [7, "settled", "accepted", 5, null],
            [19, "settled", "accepted", 4, null],
        ],
    );
    assert.deepEqual(controlProviders.get(19)?.calls, ["plan", "explore-a", "answer"]);
    // The aggregate outcome reports measured step counts and ratios only.
    const outcome = inspection.outcome;
    assert.ok(outcome);
    assert.deepEqual(Object.keys(outcome).sort(), [
        "baseline",
        "control",
        "original_step_count",
        "outcome",
        "record_id",
        "result_session_id",
        "result_step_count",
        "step_count_ratio",
    ]);
    assert.equal(outcome.outcome, "pruned");
    assert.equal(outcome.result_session_id, compressed.session_id);
    assert.equal(outcome.original_step_count, 5);
    assert.equal(outcome.result_step_count, 2);
    assert.equal(outcome.step_count_ratio, 2 / 5);
    assert.deepEqual(outcome.control, {
        seed: 19,
        session_id: inspection.controls[1]?.outcome?.session_id,
        step_count: 4,
        step_count_ratio: 4 / 5,
    });
    assert.deepEqual(outcome.baseline, {
        kind: "no_compression",
        session_id: source.session_id,
        step_count: 5,
        step_count_ratio: 1,
    });
    // The manifest cites every session, child, candidate, and the outcome by identity.
    assert.equal(manifest.kind, "trajectory_compression");
    assert.deepEqual(
        manifest.artifacts.map((artifact) => artifact.role),
        [
            "source_session",
            "compression_candidate",
            "compressor_child",
            "verifier_child",
            "rewind_session",
            "compressed_session",
            "compression_candidate",
            "verifier_child",
            "control_session",
            "compression_candidate",
            "verifier_child",
            "control_session",
            "compression_outcome",
        ],
    );
    assert.equal(manifest.costs.provider_calls, 4 + 1 + 1 + 1 + (4 + 1) + (3 + 1));
    assert.equal(inspection.manifest?.manifest_id, manifest.manifest_id);
    assert.match(inspection.cut_id as string, /^application-cut:sha256:[0-9a-f]{64}$/u);
    // Inspection is identical on reopened read-only and imported stores.
    using readOnly = new SQLiteTraceStore(databasePath, { readOnly: true });
    assert.deepEqual(inspectTrajectoryCompression(readOnly, applicationId), inspection);
    using imported = new SQLiteTraceStore();
    imported.importTrace(store.exportTrace());
    assert.deepEqual(inspectTrajectoryCompression(imported, applicationId), inspection);
    // Repeating the command returns the retained manifest without executing anything.
    const calls = [base.calls.length, ...[...controlProviders.values()].map((p) => p.calls.length)];
    const sessions = replaySessions(store).length;
    const repeated = await runTrajectoryCompression(store, options);
    assert.deepEqual(repeated.manifest, manifest);
    assert.deepEqual(repeated.inspection, inspection);
    assert.deepEqual(
        [base.calls.length, ...[...controlProviders.values()].map((p) => p.calls.length)],
        calls,
    );
    assert.equal(compressorContexts.length, 1);
    assert.equal(verifierContexts.length, 3);
    assert.equal(replaySessions(store).length, sessions);
    assert.equal(store.verifyIntegrity().ok, true);
});

test("seeded runs in fresh stores retain an identical manifest digest", async () => {
    const manifests = [];
    for (let index = 0; index < 2; index += 1) {
        using store = new SQLiteTraceStore();
        const { manifest } = await runTrajectoryCompression(
            store,
            compressionOptions("application:compression:seeded", {
                controlProvider: seededControls,
            }),
        );
        manifests.push(manifest);
    }
    assert.equal(manifests[0]?.manifest_id, manifests[1]?.manifest_id);
    assert.deepEqual(manifests[0], manifests[1]);
    assert.deepEqual(manifests[0]?.seeds, [7, 19, 23]);
});

test("a rejected verdict restores the original suffix and retains the reason", async () => {
    using store = new SQLiteTraceStore();
    const base = stageProvider("base");
    const { inspection, manifest } = await runTrajectoryCompression(
        store,
        compressionOptions("application:compression:restored", {
            protocol: compressionProtocolWithBudgets({ bestOfN: 0 }),
            verifier: verifierOf(() => ({
                reason: "the shortcut skips the required exploration",
                score: 0.25,
                verdict: "rejected",
            })),
            workflow: {
                handlers: notifyHandlers,
                program: exploreWorkflow(),
                programId: "workflow:explore-answer.v1",
                provider: base,
            },
        }),
    );
    const settled = inspection.compression.outcome;
    assert.ok(settled);
    assert.equal(settled.outcome, "restored");
    assert.equal(settled.verdict, "rejected");
    assert.equal(settled.score, 0.25);
    assert.equal(settled.reason, "the shortcut skips the required exploration");
    assert.equal(settled.step_count, 2);
    const source = inspectReplaySession(store, { sessionId: inspection.source_session_id });
    const restoration = inspectReplaySession(store, {
        sessionId: settled.restoration_session_id as string,
    });
    assert.equal(restoration.origin?.target_step_count, 1);
    assert.deepEqual(
        restoration.steps.map((step) => step.source),
        ["recorded", "live", "live", "live", "live"],
    );
    assert.deepEqual(
        restoration.steps.map((step) => step.step_id),
        source.steps.map((step) => step.step_id),
    );
    assert.deepEqual(restoration.terminal?.result, source.terminal?.result);
    assert.deepEqual(base.calls, [
        "plan",
        "explore-a",
        "explore-b",
        "answer",
        "answer",
        "explore-a",
        "explore-b",
        "answer",
    ]);
    assert.deepEqual(inspection.controls, []);
    assert.equal(inspection.outcome?.outcome, "restored");
    assert.equal(inspection.outcome?.result_session_id, restoration.session_id);
    assert.equal(inspection.outcome?.step_count_ratio, 1);
    assert.equal(inspection.outcome?.control, null);
    assert.equal(inspection.outcome?.baseline, null);
    assert.deepEqual(
        manifest.artifacts.map((artifact) => artifact.role),
        [
            "source_session",
            "compression_candidate",
            "compressor_child",
            "verifier_child",
            "rewind_session",
            "compressed_session",
            "restoration_session",
            "compression_outcome",
        ],
    );
});

test("a fork point without a hint is not admissible and is restored without the verifier", async () => {
    using store = new SQLiteTraceStore();
    const verifierContexts: TrajectoryVerifierContext[] = [];
    const { inspection } = await runTrajectoryCompression(
        store,
        compressionOptions("application:compression:inadmissible", {
            compressor: compressorOf(forkAt(2, null)),
            protocol: compressionProtocolWithBudgets({ bestOfN: 0 }),
            verifier: verifierOf(undefined, verifierContexts),
        }),
    );
    const settled = inspection.compression.outcome;
    assert.equal(settled?.outcome, "restored");
    assert.equal(settled?.hint_digest, null);
    assert.equal(settled?.fork_point?.step_index, 2);
    assert.equal(settled?.verdict, null);
    assert.equal(settled?.score, null);
    assert.equal(settled?.verifier_handle_id, null);
    assert.equal(
        settled?.reason,
        "the compressed session did not finish with strictly fewer steps than the original",
    );
    assert.equal(settled?.step_count, 5);
    assert.deepEqual(verifierContexts, []);
    assert.equal(inspection.outcome?.step_count_ratio, 1);
});

test("a compressed session that ended failed is restored without the verifier and costs are unknown", async () => {
    using store = new SQLiteTraceStore();
    const verifierContexts: TrajectoryVerifierContext[] = [];
    // The source answers once; the compressed suffix's answer (the second call) fails.
    const base = stageProvider("base", { failOnCall: 2, failStage: "answer" });
    const { inspection, manifest } = await runTrajectoryCompression(
        store,
        compressionOptions("application:compression:failed-compressed", {
            // A provider-serviced compressor reports a cost, so only the failed call is unknown.
            compressor: {
                budget: { maxTurns: 1 },
                grant: [],
                provider: childProvider("compressor", (evidence) => {
                    const source = evidence.source as {
                        readonly session_id: string;
                        readonly steps: readonly { readonly prefix_id: string }[];
                    };
                    return {
                        fork_point: {
                            prefix_id: source.steps[0]?.prefix_id,
                            session_id: source.session_id,
                            step_index: 1,
                        },
                        hint: { cited_step_indices: [], text: "answer from the plan" },
                    };
                }),
                task: compressorOf(forkAt(1)).task,
            },
            protocol: compressionProtocolWithBudgets({ bestOfN: 0 }),
            verifier: verifierOf(undefined, verifierContexts),
            workflow: {
                handlers: notifyHandlers,
                program: exploreWorkflow(),
                programId: "workflow:explore-answer.v1",
                provider: base,
            },
        }),
    );
    const settled = inspection.compression.outcome;
    assert.equal(settled?.outcome, "restored");
    assert.equal(settled?.verdict, null);
    assert.deepEqual(verifierContexts, []);
    const compressed = inspectReplaySession(store, { sessionId: settled?.session_id as string });
    assert.equal(compressed.terminal?.status, "failed");
    // Compressor child, the failed compressed call, and the three restored suffix calls.
    assert.equal(settled?.cost?.provider_calls, 1 + 1 + 3);
    assert.equal(settled?.cost?.cost_usd, null);
    assert.equal(manifest.costs.cost_usd, null);
});

test("a null fork point settles no_prune and leaves the source untouched", async () => {
    using store = new SQLiteTraceStore();
    const verifierContexts: TrajectoryVerifierContext[] = [];
    const commandId = "application:compression:no-prune";
    // Without a clock option every session and child uses the wall clock.
    const { clock: _clock, ...options } = compressionOptions(commandId, {
        compressor: compressorOf(() => ({ fork_point: null, hint: null })),
        protocol: compressionProtocolWithBudgets({ bestOfN: 0 }),
        verifier: verifierOf(undefined, verifierContexts),
    });
    const { inspection, manifest } = await runTrajectoryCompression(store, options);
    const settled = inspection.compression.outcome;
    assert.equal(inspection.compression.rewound, null);
    assert.equal(inspection.compression.proposed?.fork_point, null);
    assert.equal(settled?.outcome, "no_prune");
    assert.equal(settled?.reason, "the compressor proposed no fork point");
    assert.equal(settled?.restore, null);
    assert.equal(settled?.session_id, null);
    assert.equal(settled?.fork_id, null);
    assert.equal(settled?.step_count, 5);
    assert.equal(settled?.cost?.provider_calls, 1);
    assert.deepEqual(verifierContexts, []);
    // Only the source session exists; its suffix was never rewound or replayed.
    assert.deepEqual(replaySessions(store), [inspection.source_session_id]);
    assert.equal(inspection.outcome?.outcome, "no_prune");
    assert.equal(inspection.outcome?.result_session_id, inspection.source_session_id);
    assert.equal(inspection.outcome?.step_count_ratio, 1);
    assert.deepEqual(
        manifest.artifacts.map((artifact) => artifact.role),
        ["source_session", "compression_candidate", "compressor_child", "compression_outcome"],
    );
});

test("a missing fork step settles no_prune, with or without a hint", async () => {
    const proposals: readonly [string, (context: TrajectoryCompressorContext) => unknown][] = [
        ["absent", () => ({})],
        ["hint-only", () => ({ hint: { cited_step_indices: [1], text: "answer from the plan" } })],
        [
            "no-step",
            ({ source }) => ({
                fork_point: { prefix_id: null, session_id: source.session_id },
                hint: null,
            }),
        ],
    ];
    for (const [label, propose] of proposals) {
        using store = new SQLiteTraceStore();
        const verifierContexts: TrajectoryVerifierContext[] = [];
        const { inspection } = await runTrajectoryCompression(
            store,
            compressionOptions(`application:compression:missing-step:${label}`, {
                compressor: compressorOf(propose),
                protocol: compressionProtocolWithBudgets({ bestOfN: 0 }),
                verifier: verifierOf(undefined, verifierContexts),
            }),
        );
        const settled = inspection.compression.outcome;
        assert.equal(settled?.outcome, "no_prune", label);
        assert.equal(settled?.reason, "the compressor proposed no fork point", label);
        assert.equal(settled?.fork_point, null, label);
        assert.equal(settled?.fork_clamp, null, label);
        assert.equal(settled?.hint_digest === null, label !== "hint-only", label);
        assert.deepEqual(verifierContexts, [], label);
        assert.deepEqual(replaySessions(store), [inspection.source_session_id], label);
        assert.equal(inspection.outcome?.step_count_ratio, 1, label);
    }
});

test("fork step 0 restarts from the initial prefix with the hint applied", async () => {
    using store = new SQLiteTraceStore();
    const guided: TrajectoryCompressionGuidance[] = [];
    const base = stageProvider("base");
    const { inspection } = await runTrajectoryCompression(
        store,
        compressionOptions("application:compression:restart", {
            compressor: compressorOf(forkAt(0)),
            protocol: compressionProtocolWithBudgets({ bestOfN: 0 }),
            workflow: {
                handlers: notifyHandlers,
                program: exploreWorkflow({ guided }),
                programId: "workflow:explore-answer.v1",
                provider: base,
            },
        }),
    );
    const { outcome: settled, proposed, rewound } = inspection.compression;
    const forkPoint = { prefix_id: null, session_id: inspection.source_session_id, step_index: 0 };
    assert.deepEqual(proposed?.fork_point, forkPoint);
    assert.equal(proposed?.fork_clamp, null);
    const rewind = inspectReplaySession(store, {
        sessionId: rewound?.restore?.rewind_session_id as string,
    });
    assert.equal(rewind.origin?.target_step_count, 0);
    assert.equal(rewind.steps.length, 0);
    // Every step of the rerun is live: nothing of the source is reused, and the hint shortcut ran.
    assert.equal(settled?.outcome, "pruned");
    const compressed = inspectReplaySession(store, { sessionId: settled?.session_id as string });
    assert.equal(compressed.origin?.target_step_count, 0);
    assert.deepEqual(
        compressed.steps.map((step) => step.source),
        ["live", "live"],
    );
    assert.equal(settled?.step_count, 2);
    assert.deepEqual(guided, [
        {
            fork_point: forkPoint,
            hint: { cited_step_indices: [1, 2], text: "answer directly from the plan" },
        },
    ]);
    assert.equal(inspection.outcome?.step_count_ratio, 2 / 5);
});

test("out-of-range fork steps are clamped to [0, n - 1] under the configured policy and retained", async () => {
    // The explore source has n = 5 steps: f = n and beyond clamp to 4, f = -1 clamps to 0.
    const cases: readonly [number, number, string, number][] = [
        [5, 4, "restored", 5],
        [99, 4, "restored", 5],
        [-1, 0, "pruned", 2],
    ];
    for (const [proposedStep, appliedStep, outcome, stepCount] of cases) {
        using store = new SQLiteTraceStore();
        const guided: TrajectoryCompressionGuidance[] = [];
        let proposedPrefix: string | null = null;
        const { inspection } = await runTrajectoryCompression(
            store,
            compressionOptions(`application:compression:clamp:${proposedStep}`, {
                compressor: compressorOf((context) => {
                    const proposal = forkAt(proposedStep)(context);
                    proposedPrefix = proposal.fork_point?.prefix_id ?? null;
                    return proposal;
                }),
                protocol: compressionProtocolWithBudgets({ bestOfN: 0 }),
                workflow: {
                    handlers: notifyHandlers,
                    program: exploreWorkflow({ guided }),
                    programId: "workflow:explore-answer.v1",
                    provider: stageProvider("base"),
                },
            }),
        );
        const label = `f=${proposedStep}`;
        const source = inspectReplaySession(store, { sessionId: inspection.source_session_id });
        const forkPoint = {
            prefix_id: appliedStep === 0 ? null : source.steps[appliedStep - 1]?.prefix_id,
            session_id: source.session_id,
            step_index: appliedStep,
        };
        const clamp = {
            policy: "clamp",
            proposed_prefix_id: proposedPrefix,
            proposed_step_index: proposedStep,
        };
        const { outcome: settled, proposed, rewound } = inspection.compression;
        // The clamp is retained on every candidate record, and the rerun used the clamped step.
        for (const record of [proposed, rewound, settled]) {
            assert.deepEqual(record?.fork_point, forkPoint, label);
            assert.deepEqual(record?.fork_clamp, clamp, label);
        }
        assert.deepEqual(
            guided.map((guidance) => guidance.fork_point),
            [forkPoint],
            label,
        );
        assert.equal(settled?.outcome, outcome, label);
        assert.equal(settled?.step_count, stepCount, label);
        const compressed = inspectReplaySession(store, {
            sessionId: settled?.session_id as string,
        });
        assert.equal(compressed.origin?.target_step_count, appliedStep, label);
    }
});

test("an unavailable restore constituent refuses the prune and retains the reason", async () => {
    using store = new SQLiteTraceStore();
    const verifierContexts: TrajectoryVerifierContext[] = [];
    const { inspection } = await runTrajectoryCompression(
        store,
        compressionOptions("application:compression:unavailable", {
            protocol: compressionProtocolWithBudgets({ bestOfN: 0 }),
            verifier: verifierOf(undefined, verifierContexts),
            workflow: {
                handlers: notifyHandlers,
                program: exploreWorkflow({ checkpoint: true }),
                programId: "workflow:explore-answer.v1",
                provider: stageProvider("base"),
                providerSession: unavailableSession("provider refuses capture"),
            },
        }),
    );
    const source = inspectReplaySession(store, { sessionId: inspection.source_session_id });
    assert.equal(source.checkpoints[0]?.classification, "unavailable");
    const settled = inspection.compression.outcome;
    assert.equal(inspection.compression.rewound, null);
    assert.equal(settled?.outcome, "no_prune");
    assert.equal(settled?.reason, "the fork point has an unavailable restore constituent");
    assert.equal(settled?.restore?.classification, "unavailable");
    assert.equal(settled?.restore?.rewind_session_id, null);
    assert.equal(settled?.restore?.restore_record_id, null);
    assert.deepEqual(
        settled?.restore?.constituents.find((entry) => entry.kind === "provider_session"),
        {
            kind: "provider_session",
            name: "adapter:unavailable",
            reason: "provider refuses capture",
            status: "unavailable",
        },
    );
    assert.equal(settled?.session_id, null);
    assert.deepEqual(verifierContexts, []);
    assert.deepEqual(replaySessions(store), [source.session_id]);
    assert.equal(inspection.outcome?.result_session_id, source.session_id);
});

test("a fork point at a verified checkpoint rewinds atomically and replays from the checkpoint", async () => {
    using store = new SQLiteTraceStore();
    const providerSession = verifiedSession();
    const { inspection } = await runTrajectoryCompression(
        store,
        compressionOptions("application:compression:atomic", {
            protocol: compressionProtocolWithBudgets({ bestOfN: 0 }),
            workflow: {
                handlers: notifyHandlers,
                program: exploreWorkflow({ checkpoint: true }),
                programId: "workflow:explore-answer.v1",
                provider: stageProvider("base"),
                providerSession,
            },
        }),
    );
    const source = inspectReplaySession(store, { sessionId: inspection.source_session_id });
    const checkpoint = source.checkpoints[0];
    assert.equal(checkpoint?.classification, "atomic");
    const settled = inspection.compression.outcome;
    assert.equal(settled?.outcome, "pruned");
    assert.equal(settled?.restore?.classification, "atomic");
    const rewind = inspectReplaySession(store, {
        sessionId: settled?.restore?.rewind_session_id as string,
    });
    const compressed = inspectReplaySession(store, { sessionId: settled?.session_id as string });
    assert.equal(rewind.origin?.target_checkpoint_id, checkpoint?.checkpoint_id);
    assert.equal(compressed.origin?.target_checkpoint_id, checkpoint?.checkpoint_id);
    assert.equal(providerSession.restores.length, 2);
    assert.deepEqual(compressed.terminal?.result, source.terminal?.result);
});

test("a failed rewind rejects the candidate and prunes nothing", async () => {
    using store = new SQLiteTraceStore();
    const commandId = "application:compression:rewind-failed";
    const options = compressionOptions(commandId, {
        protocol: compressionProtocolWithBudgets({ bestOfN: 0 }),
        workflow: {
            handlers: notifyHandlers,
            program: exploreWorkflow({ checkpoint: true }),
            programId: "workflow:explore-answer.v1",
            provider: stageProvider("base"),
            providerSession: verifiedSession(true),
        },
    });
    await assert.rejects(
        runTrajectoryCompression(store, options),
        (error: unknown) =>
            error instanceof ApplicationEvidenceError && /did not restore/u.test(error.message),
    );
    const inspection = inspectTrajectoryCompression(store, deriveApplicationOwnerId(commandId));
    const rejected = inspection.compression.outcome;
    assert.equal(rejected?.status, "rejected");
    assert.equal(rejected?.failure?.code, "APPLICATION_EVIDENCE_INVALID");
    assert.equal(rejected?.restore, null);
    assert.equal(rejected?.outcome, null);
    assert.equal(inspection.compression.proposed?.status, "proposed");
    assert.equal(inspection.compression.rewound, null);
    assert.equal(inspection.outcome, null);
    assert.equal(inspection.manifest, null);
    assert.equal(inspection.cut_id, null);
    assert.equal(inspection.manifest_record_id, null);
    const records = store.readOwner(deriveApplicationOwnerId(commandId)).length;
    await assert.rejects(runTrajectoryCompression(store, options), ApplicationEvidenceError);
    assert.equal(store.readOwner(deriveApplicationOwnerId(commandId)).length, records);
});

test("provider-serviced children compress, and a control rerun reporting no cost has an unknown cost", async () => {
    using store = new SQLiteTraceStore();
    const compressor = childProvider("compressor", (evidence) => {
        const source = evidence.source as {
            readonly session_id: string;
            readonly steps: readonly { readonly prefix_id: string }[];
        };
        return {
            fork_point: {
                prefix_id: source.steps[0]?.prefix_id,
                session_id: source.session_id,
                step_index: 1,
            },
            hint: { cited_step_indices: [], text: "answer from the plan" },
        };
    });
    const verifier = childProvider("verifier", (evidence) => {
        const compressed = evidence.compressed as { readonly result: unknown };
        const original = evidence.original as { readonly result: unknown };
        return JSON.stringify(compressed.result) === JSON.stringify(original.result)
            ? { reason: "same result", score: 2, verdict: "accepted" }
            : { reason: "different result", score: -1, verdict: "rejected" };
    });
    const uncosted = stageProvider("base", { costUsd: null });
    const { inspection, manifest } = await runTrajectoryCompression(
        store,
        compressionOptions("application:compression:providers", {
            compressor: {
                budget: { maxTurns: 1 },
                grant: [],
                provider: compressor,
                task: compressorOf(forkAt(1)).task,
            },
            controlProvider: () => uncosted,
            protocol: compressionProtocolWithBudgets({ bestOfN: 1 }),
            verifier: {
                budget: { maxTurns: 1 },
                grant: [],
                provider: verifier,
                task: verifierOf().task,
            },
        }),
    );
    assert.deepEqual(compressor.calls, ["compressor"]);
    assert.deepEqual(verifier.calls, ["verifier", "verifier"]);
    assert.equal(inspection.compression.outcome?.outcome, "pruned");
    assert.equal(inspection.compression.outcome?.score, 2);
    assert.equal(inspection.compression.outcome?.cost?.cost_usd, 0.1 + 0.25 + 0.1);
    const control = inspection.controls[0]?.outcome;
    assert.equal(control?.verdict, "accepted");
    assert.equal(control?.score, 2);
    // A reported null cost makes the control's cost, and the whole run's, unknown.
    assert.equal(control?.cost?.cost_usd, null);
    assert.equal(control?.cost?.provider_calls, 4 + 1);
    const rerun = inspectReplaySession(store, { sessionId: control?.session_id as string });
    assert.equal(rerun.terminal?.status, "finished");
    assert.equal(inspection.outcome?.control?.seed, control?.seed);
    assert.equal(manifest.costs.cost_usd, null);
});
