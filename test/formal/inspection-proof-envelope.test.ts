import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
    createRuntimeInspectionEnvelope,
    withPublicationControls,
} from "../../src/formal/inspection-envelope.ts";
import {
    classifyProofEnvelope,
    createEffectHandlerStack,
    deriveReplaySessionId,
    executeTaskDurably,
    inspectDurableTaskExecution,
    inspectReplaySession,
    type ModelProvider,
    type ReplaySessionProgram,
    replayReplaySession,
    rewindReplaySession,
    runReplaySession,
    type SemanticRecord,
    SQLiteTraceStore,
    schema,
    task,
    validateTypedEffectTrace,
} from "../../src/index.ts";
import { formalAssuranceProtocolConfig as formal } from "../../src/protocol/config.ts";
import { parseProtocolConfig } from "../../src/protocol/config-validation.ts";
import {
    emptyDirectory,
    intentOf,
    reviewProgram,
    reviewProvider,
    temporaryDirectory,
    worldHandlers,
} from "../replay/fixtures.ts";

const { inspection: config, proofEnvelope } = formal;
const protocolConfig = JSON.parse(
    readFileSync(new URL("../../protocol.config.json", import.meta.url), "utf8"),
) as unknown;
const EVIDENCE_ID = `${proofEnvelope.evidenceRefPrefix}${"a".repeat(proofEnvelope.hexLength)}`;
const VALID_CLAIM = {
    evidence_id: EVIDENCE_ID,
    profile: "core_a",
    strength: "semantic_adequacy",
    validator: proofEnvelope.validator,
};

function artifactProvider(metadata: readonly SemanticRecord[]): ModelProvider {
    return {
        descriptor: () => ({
            capabilities: { streaming: false, structuredOutput: true, tools: false },
            id: "proof-claim-provider",
            kind: "static" as const,
            model: "offline-v1",
        }),
        invoke: async () => ({
            artifacts: metadata.map((entry, index) => ({
                content: { text: `artifact ${index}`, type: "text" as const },
                kind: "report",
                metadata: entry,
                name: `report-${index}.txt`,
            })),
            output: "complete",
            usage: {
                cacheCreationInputTokens: 0,
                cacheReadInputTokens: 0,
                costUsd: null,
                inputTokens: 1,
                outputTokens: 1,
            },
        }),
    };
}

async function runWithArtifacts(
    store: SQLiteTraceStore,
    runId: string,
    metadata: SemanticRecord[],
) {
    await executeTaskDurably(store, {
        budget: { maxTurns: 1 },
        input: undefined,
        provider: artifactProvider(metadata),
        runId,
        task: task({
            input: schema.void(),
            instruction: "Return artifacts carrying proof metadata.",
            name: "proof-claim",
            output: schema.string(),
            version: "1.0.0",
        }),
    });
    return inspectDurableTaskExecution(store, runId);
}

test("run inspections default to a runtime_only proof envelope", async () => {
    using store = new SQLiteTraceStore();
    const absent = inspectDurableTaskExecution(store, "run:proof:absent");
    assert.equal(absent.proof.profile, proofEnvelope.runtimeOnlyProfile);
    const committed = await runWithArtifacts(store, "run:proof:plain", [{ media: "text" }]);
    assert.equal(committed.status, "committed");
    assert.deepEqual(committed.proof, {
        evidence_id: null,
        excluded_runtime_surfaces: [...proofEnvelope.excludedRuntimeSurfaces],
        metadata: { claimed_proof_backed: false, reason: config.reasons.productionRuntime },
        profile: proofEnvelope.runtimeOnlyProfile,
        program_ref: null,
        proof_backed: false,
        reference_validated: false,
        schema_version: proofEnvelope.schemaVersion,
        strength: proofEnvelope.runtimeOnlyStrength,
        theorem_ids: [],
        trace_ref: null,
        validator: proofEnvelope.validator,
    });
    assert.equal(Object.isFrozen(committed.proof), true);
    assert.equal(Object.isFrozen(committed.proof.metadata), true);
});

test("imported non-runtime claims surface only as claimed_proof_backed metadata", async () => {
    using store = new SQLiteTraceStore();
    const claimed = await runWithArtifacts(store, "run:proof:claimed", [
        { media: "text" },
        { [config.importedClaim.metadataKey]: VALID_CLAIM },
    ]);
    assert.equal(claimed.proof.profile, proofEnvelope.runtimeOnlyProfile);
    assert.equal(claimed.proof.strength, proofEnvelope.runtimeOnlyStrength);
    assert.equal(claimed.proof.proof_backed, false);
    assert.equal(claimed.proof.reference_validated, false);
    assert.equal(claimed.proof.evidence_id, null);
    assert.deepEqual(claimed.proof.theorem_ids, []);
    assert.deepEqual(claimed.proof.metadata, {
        claim: { ...VALID_CLAIM, record_id: claimed.artifacts[1]?.record_id },
        claimed_proof_backed: true,
        reason: config.reasons.productionRuntime,
    });

    const rejected: readonly [SemanticRecord, string][] = [
        [{ ...VALID_CLAIM, extra: true }, config.importedClaim.rejections.malformed],
        [{ ...VALID_CLAIM, profile: "unknown" }, config.importedClaim.rejections.malformed],
        [{ ...VALID_CLAIM, strength: 1 }, config.importedClaim.rejections.malformed],
        [
            { ...VALID_CLAIM, strength: proofEnvelope.runtimeOnlyStrength },
            config.importedClaim.rejections.runtime,
        ],
        [
            { ...VALID_CLAIM, profile: proofEnvelope.runtimeOnlyProfile },
            config.importedClaim.rejections.runtime,
        ],
        [{ ...VALID_CLAIM, validator: "self-issued" }, config.importedClaim.rejections.provenance],
        [
            { ...VALID_CLAIM, evidence_id: "proof-evidence:sha256:short" },
            config.importedClaim.rejections.evidenceRef,
        ],
    ];
    for (const [index, [claim, rejection]] of rejected.entries()) {
        const inspection = await runWithArtifacts(store, `run:proof:rejected:${index}`, [
            { [config.importedClaim.metadataKey]: claim },
        ]);
        assert.equal(inspection.proof.profile, proofEnvelope.runtimeOnlyProfile);
        assert.deepEqual(inspection.proof.metadata, {
            claim_record_id: inspection.artifacts[0]?.record_id,
            claim_rejection: rejection,
            claimed_proof_backed: false,
            reason: config.reasons.productionRuntime,
        });
    }
    const malformedValue = await runWithArtifacts(store, "run:proof:scalar", [
        { [config.importedClaim.metadataKey]: "core_a" },
    ]);
    assert.equal(
        malformedValue.proof.metadata.claim_rejection,
        config.importedClaim.rejections.malformed,
    );
    const ambiguous = await runWithArtifacts(store, "run:proof:ambiguous", [
        { [config.importedClaim.metadataKey]: VALID_CLAIM },
        { [config.importedClaim.metadataKey]: VALID_CLAIM },
    ]);
    assert.deepEqual(ambiguous.proof.metadata, {
        claim_rejection: config.importedClaim.rejections.ambiguous,
        claimed_proof_backed: false,
        reason: config.reasons.productionRuntime,
    });
});

const staticEffectProgram: ReplaySessionProgram = async (context) => {
    await context.dispatchEffect(
        intentOf("effect:draft", "file.write", { name: "draft.txt", text: "draft" }),
        { dependsOn: [] },
    );
    await context.dispatchEffect(intentOf("effect:notify", "notify", { stage: "draft" }), {
        dependsOn: [],
    });
    return { done: true };
};

function memoryHandlers() {
    return createEffectHandlerStack(
        ["file.write", "notify"].map((kind) => ({
            handle: (intent: { readonly effect_id: string }) => ({
                ok: true as const,
                value: { seen: intent.effect_id },
            }),
            handlerId: `handler:memory:${kind}`,
            kind,
        })),
    );
}

test("replay inspections expose runtime_only envelopes and lower eligible static sessions", async (context) => {
    const directory = await temporaryDirectory(context, "proof-lowering");
    const world = await emptyDirectory(directory, "world");
    using store = new SQLiteTraceStore();
    const { inspection } = await runReplaySession(store, {
        claimId: "worker:1",
        commandId: "session:static",
        handlers: worldHandlers(world),
        program: staticEffectProgram,
        programId: "program:static.v1",
        worlds: [{ name: "main", root: world }],
    });
    assert.equal(inspection.proof.profile, proofEnvelope.runtimeOnlyProfile);
    assert.deepEqual(inspection.proof.metadata, {
        claimed_proof_backed: false,
        reason: config.reasons.productionRuntime,
    });
    assert.deepEqual(inspectReplaySession(store, { sessionId: inspection.session_id }), inspection);

    const lowered = inspectReplaySession(store, {
        lowerProof: true,
        sessionId: inspection.session_id,
    });
    assert.deepEqual({ ...lowered, proof: inspection.proof }, inspection);
    assert.equal(lowered.proof.profile, proofEnvelope.referenceValidatedProfile);
    assert.equal(lowered.proof.strength, proofEnvelope.referenceValidatedStrength);
    assert.equal(lowered.proof.reference_validated, true);
    assert.equal(lowered.proof.proof_backed, false);
    assert.deepEqual(lowered.proof.theorem_ids, []);
    assert.match(lowered.proof.program_ref ?? "", /^program:sha256:[0-9a-f]{64}$/u);
    assert.match(lowered.proof.trace_ref ?? "", /^trace:sha256:[0-9a-f]{64}$/u);
    assert.match(lowered.proof.evidence_id ?? "", /^proof-evidence:sha256:[0-9a-f]{64}$/u);
    assert.deepEqual(lowered.proof.metadata, {
        claimed_proof_backed: false,
        completed: true,
        lowering: config.lowering.schemaVersion,
        validator: proofEnvelope.validationOperations.completed,
    });
    assert.deepEqual(
        inspectReplaySession(store, { lowerProof: true, sessionId: inspection.session_id }),
        lowered,
    );
    assert.equal(Object.isFrozen(lowered), true);

    const reviewWorld = await emptyDirectory(directory, "review-world");
    const review = await runReplaySession(store, {
        claimId: "worker:1",
        commandId: "session:review",
        handlers: worldHandlers(reviewWorld),
        program: reviewProgram,
        programId: "program:review.v1",
        provider: reviewProvider(),
        worlds: [{ name: "main", root: reviewWorld }],
    });
    const nonStatic = inspectReplaySession(store, {
        lowerProof: true,
        sessionId: review.inspection.session_id,
    });
    assert.equal(nonStatic.proof.profile, proofEnvelope.runtimeOnlyProfile);
    assert.equal(
        nonStatic.proof.metadata.lowering_ineligible,
        config.lowering.ineligibility.stepKind,
    );

    await runReplaySession(store, {
        claimId: "worker:1",
        commandId: "session:failing",
        handlers: memoryHandlers(),
        program: async (replayContext) => {
            await staticEffectProgram(replayContext);
            throw new Error("program gave up");
        },
        programId: "program:failing.v1",
    }).catch(() => undefined);
    const failed = inspectReplaySession(store, {
        lowerProof: true,
        sessionId: deriveReplaySessionId("session:failing"),
    });
    assert.equal(failed.terminal?.status, "failed");
    assert.equal(failed.proof.profile, proofEnvelope.runtimeOnlyProfile);
    assert.equal(failed.proof.metadata.lowering_ineligible, config.lowering.ineligibility.terminal);

    await runReplaySession(store, {
        claimId: "worker:1",
        commandId: "session:handler-failure",
        handlers: createEffectHandlerStack([
            {
                handle: () => {
                    throw new Error("handler unavailable");
                },
                handlerId: "handler:broken",
                kind: "file.write",
            },
        ]),
        program: async (replayContext) => {
            try {
                await staticEffectProgram(replayContext);
            } catch {
                return { recovered: true };
            }
            return { recovered: false };
        },
        programId: "program:handler-failure.v1",
    });
    const unmaterialized = inspectReplaySession(store, {
        lowerProof: true,
        sessionId: deriveReplaySessionId("session:handler-failure"),
    });
    assert.equal(unmaterialized.terminal?.status, "finished");
    assert.notEqual(unmaterialized.steps[0]?.effect?.disposition, "materialized");
    assert.equal(
        unmaterialized.proof.metadata.lowering_ineligible,
        config.lowering.ineligibility.disposition,
    );
    assert.throws(
        () =>
            inspectReplaySession(store, {
                lowerProof: "yes" as unknown as boolean,
                sessionId: inspection.session_id,
            }),
        /lowerProof must be a boolean/u,
    );
});

test("lowered records are the ones accepted by the executable reference machine", async () => {
    using store = new SQLiteTraceStore();
    const empty = await runReplaySession(store, {
        claimId: "worker:1",
        commandId: "session:empty",
        program: async () => ({ done: true }),
        programId: "program:empty.v1",
    });
    const emptyLowered = inspectReplaySession(store, {
        lowerProof: true,
        sessionId: empty.inspection.session_id,
    });
    assert.equal(emptyLowered.proof.reference_validated, true);
    const { inspection } = await runReplaySession(store, {
        claimId: "worker:1",
        commandId: "session:memory",
        handlers: memoryHandlers(),
        program: staticEffectProgram,
        programId: "program:static.v1",
    });
    const lowered = inspectReplaySession(store, {
        lowerProof: true,
        sessionId: inspection.session_id,
    });
    assert.equal(lowered.proof.reference_validated, true);
    assert.notEqual(lowered.proof.trace_ref, emptyLowered.proof.trace_ref);
    assert.notEqual(lowered.proof.program_ref, emptyLowered.proof.program_ref);
    // The lowered trace identity is bound to its program; an empty trace for the same program
    // is still reference-valid but content-addresses differently.
    const emptyForProgram = classifyProofEnvelope({
        completed: true,
        programRef: lowered.proof.program_ref as string,
        trace: [],
    });
    assert.equal(emptyForProgram.reference_validated, true);
    assert.notEqual(emptyForProgram.trace_ref, lowered.proof.trace_ref);
    assert.equal(
        validateTypedEffectTrace({
            completed: true,
            programRef: lowered.proof.program_ref as string,
            trace: [],
        }).record_count,
        0,
    );
});

test("branch replay sessions classify as the extension publication-control profile", async () => {
    using store = new SQLiteTraceStore();
    const source = await runReplaySession(store, {
        claimId: "worker:1",
        commandId: "session:source",
        handlers: memoryHandlers(),
        program: staticEffectProgram,
        programId: "program:static.v1",
    });
    const expected = (mode: "replay" | "rewind") => ({
        claimed_proof_backed: false,
        publication_controls: [config.publicationControls.replayModes[mode]],
        reason: config.reasons.publicationControl,
    });
    const rewound = await rewindReplaySession(store, {
        claimId: "operator",
        commandId: "rewind:proof",
        sourceSessionId: source.inspection.session_id,
        target: { stepCount: 1 },
    });
    assert.equal(rewound.inspection.mode, "rewind");
    assert.equal(rewound.inspection.proof.profile, config.extensionProfile);
    assert.deepEqual(rewound.inspection.proof.metadata, expected("rewind"));
    const replayed = await replayReplaySession(store, {
        changes: ["handlers"],
        claimId: "operator",
        commandId: "replay:proof",
        handlers: memoryHandlers(),
        program: staticEffectProgram,
        sourceSessionId: source.inspection.session_id,
        target: { stepCount: 1 },
    });
    assert.equal(replayed.inspection.mode, "replay");
    assert.equal(replayed.inspection.proof.profile, config.extensionProfile);
    assert.equal(replayed.inspection.proof.strength, proofEnvelope.runtimeOnlyStrength);
    assert.equal(replayed.inspection.proof.proof_backed, false);
    assert.equal(replayed.inspection.proof.reference_validated, false);
    assert.equal(replayed.inspection.proof.evidence_id, null);
    assert.deepEqual(replayed.inspection.proof.metadata, expected("replay"));
    const lowered = inspectReplaySession(store, {
        lowerProof: true,
        sessionId: replayed.inspection.session_id,
    });
    assert.equal(lowered.proof.profile, config.extensionProfile);
    assert.deepEqual(lowered.proof.metadata, {
        ...expected("replay"),
        lowering_ineligible: config.lowering.ineligibility.mode,
    });
});

test("publication controls merge in configured order and preserve imported claims", () => {
    const base = createRuntimeInspectionEnvelope([
        { metadata: { [config.importedClaim.metadataKey]: VALID_CLAIM }, record_id: "record:1" },
    ]);
    assert.equal(withPublicationControls(base, []), base);
    const [first, second] = [...config.publicationControls.kinds].reverse();
    const once = withPublicationControls(base, [first as string]);
    const twice = withPublicationControls(once, [second as string, first as string]);
    assert.equal(twice.profile, config.extensionProfile);
    assert.deepEqual(
        twice.metadata.publication_controls,
        config.publicationControls.kinds.filter((kind) => kind === first || kind === second),
    );
    assert.equal(twice.metadata.claimed_proof_backed, true);
    assert.deepEqual(twice.metadata.claim, { ...VALID_CLAIM, record_id: "record:1" });
});

test("inspection envelope configuration is validated", () => {
    const mutate = (edit: (inspection: Record<string, unknown>) => void) => {
        const copy = structuredClone(protocolConfig) as unknown as {
            formalAssurance: { inspection: Record<string, unknown> };
        };
        edit(copy.formalAssurance.inspection);
        return () => parseProtocolConfig(copy, { enforceCompatibility: false });
    };
    assert.doesNotThrow(mutate(() => {}));
    assert.throws(
        mutate((inspection) => {
            inspection.extensionProfile = "runtime_only";
        }),
        /extensionProfile must differ/u,
    );
    assert.throws(
        mutate((inspection) => {
            inspection.extensionProfile = "unknown";
        }),
        /extensionProfile must belong/u,
    );
    assert.throws(
        mutate((inspection) => {
            (inspection.publicationControls as Record<string, unknown>).replayModes = {
                replay: "replay",
            };
        }),
        /every replay mode/u,
    );
    assert.throws(
        mutate((inspection) => {
            (inspection.publicationControls as Record<string, unknown>).replayModes = {
                replay: "replay",
                rewind: "teleport",
            };
        }),
        /replayModes.rewind must belong/u,
    );
    assert.throws(
        mutate((inspection) => {
            (inspection.lowering as Record<string, unknown>).eligibleStepKinds = ["unknown"];
        }),
        /eligibleStepKinds\[0\] must belong/u,
    );
    assert.throws(
        mutate((inspection) => {
            (inspection.publicationControls as Record<string, unknown>).delegationHandoff =
                "unknown";
        }),
        /delegationHandoff must belong/u,
    );
    assert.throws(
        mutate((inspection) => {
            (inspection.reasons as Record<string, unknown>).productionRuntime = "";
        }),
        /reasons.productionRuntime/u,
    );
});
