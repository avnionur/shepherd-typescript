import assert from "node:assert/strict";
import { test } from "node:test";

import {
    ApplicationBudgetError,
    ApplicationEvidenceError,
    ApplicationProtocolError,
    ApplicationVerificationError,
    deriveApplicationOwnerId,
    inspectTrajectoryCompression,
    JSONSchemaValidationError,
    runTrajectoryCompression,
    SQLiteTraceStore,
    type TrajectoryCompressorContext,
    type TrajectoryVerifierContext,
} from "../../src/index.ts";
import {
    childOutput,
    compressionDefinition,
    compressionOptions,
    compressionProtocol,
    compressionProtocolWithBudgets,
    compressorOf,
    compressorTask,
    exploreWorkflow,
    forkAt,
    notifyHandlers,
    sameResult,
    stageProvider,
    verifierOf,
} from "./compression-fixtures.ts";

const SESSION_SCHEMA = "shepherd.replay.session.v1";

function ownerCount(store: SQLiteTraceStore, commandId: string): number {
    return store.readOwner(deriveApplicationOwnerId(commandId)).length;
}

function recordCount(store: SQLiteTraceStore): number {
    return (JSON.parse(store.exportTrace()) as { readonly records: readonly unknown[] }).records
        .length;
}

function withProposal(proposal: (context: TrajectoryCompressorContext) => unknown) {
    return compressorOf(proposal);
}

test("proposals the grammar or the source refuses reject the candidate and prune nothing", async () => {
    const longHint = "x".repeat(16_385);
    const cases: readonly [string, Parameters<typeof compressorOf>[0] | null, RegExp][] = [
        ["not-json", null, /JSON/u],
        [
            "extra-field",
            (context) => ({ ...forkAt(1)(context), extra: true }),
            /violates schema surface compression\.fork-hint\.v2: \$\.extra is not a declared property/u,
        ],
        [
            "fractional-step",
            (context) => ({
                ...forkAt(1)(context),
                fork_point: { ...forkAt(1)(context).fork_point, step_index: 1.5 },
            }),
            /\$\.fork_point\.step_index/u,
        ],
        [
            "other-session",
            (context) => ({
                ...forkAt(1)(context),
                fork_point: {
                    ...forkAt(1)(context).fork_point,
                    session_id: `replay-session:sha256:${"0".repeat(64)}`,
                },
            }),
            /step boundary of the source session/u,
        ],
        [
            "prefix-mismatch",
            (context) => ({
                ...forkAt(2)(context),
                fork_point: {
                    ...forkAt(2)(context).fork_point,
                    prefix_id: context.source.steps[0]?.prefix_id,
                },
            }),
            /prefix identity does not equal/u,
        ],
        [
            "long-hint",
            (context) => ({
                ...forkAt(1)(context),
                hint: { cited_step_indices: [], text: longHint },
            }),
            /prompt bound/u,
        ],
        [
            "unordered-citations",
            (context) => ({
                ...forkAt(1)(context),
                hint: { cited_step_indices: [2, 1], text: "hint" },
            }),
            /strictly ascending/u,
        ],
        [
            "compressor-throws",
            () => {
                throw new Error("compressor unavailable");
            },
            /compressor child delegation:sha256:[0-9a-f]{64} ended failed/u,
        ],
        [
            "citation-outside-source",
            (context) => ({
                ...forkAt(1)(context),
                hint: { cited_step_indices: [1, 5], text: "hint" },
            }),
            /hint cites a step outside the source session/u,
        ],
    ];
    for (const [label, proposal, cause] of cases) {
        using store = new SQLiteTraceStore();
        const commandId = `application:compression:proposal:${label}`;
        const options = compressionOptions(commandId, {
            compressor:
                proposal === null
                    ? {
                          budget: { maxTurns: 1 },
                          grant: [],
                          program: () => ({ result: "not json" }),
                          task: compressorTask,
                      }
                    : withProposal(proposal),
        });
        await assert.rejects(
            runTrajectoryCompression(store, options),
            (error: unknown) =>
                error instanceof ApplicationEvidenceError &&
                error.code === "APPLICATION_EVIDENCE_INVALID" &&
                cause.test(String((error.cause as Error).message)),
            label,
        );
        const inspection = inspectTrajectoryCompression(store, deriveApplicationOwnerId(commandId));
        const rejected = inspection.compression.outcome;
        assert.equal(rejected?.status, "rejected", label);
        assert.equal(rejected?.failure?.code, "APPLICATION_EVIDENCE_INVALID", label);
        assert.equal(rejected?.fork_point, null, label);
        assert.equal(inspection.compression.proposed, null, label);
        assert.equal(inspection.outcome, null, label);
        assert.equal(inspection.manifest, null, label);
        // Only the source session exists: nothing was rewound, replayed, or pruned.
        assert.deepEqual(store.listOwnersBySchema(SESSION_SCHEMA, 16, 0), [
            inspection.source_session_id,
        ]);
        const records = ownerCount(store, commandId);
        await assert.rejects(runTrajectoryCompression(store, options), ApplicationEvidenceError);
        assert.equal(ownerCount(store, commandId), records, label);
    }
});

test("a verifier that throws or returns a malformed verdict fails verification and prunes nothing", async () => {
    const judges: readonly [string, (context: TrajectoryVerifierContext) => unknown][] = [
        [
            "throws",
            () => {
                throw new Error("verifier unavailable");
            },
        ],
        ["malformed", () => ({ reason: "maybe", score: 1, verdict: "maybe" })],
        ["non-finite", () => ({ reason: "score", score: "high", verdict: "accepted" })],
    ];
    for (const [label, judge] of judges) {
        using store = new SQLiteTraceStore();
        const commandId = `application:compression:verifier:${label}`;
        const base = stageProvider("base");
        const options = compressionOptions(commandId, {
            verifier: verifierOf(judge),
            workflow: {
                handlers: notifyHandlers,
                program: exploreWorkflow(),
                programId: "workflow:explore-answer.v1",
                provider: base,
            },
        });
        await assert.rejects(
            runTrajectoryCompression(store, options),
            (error: unknown) =>
                error instanceof ApplicationVerificationError &&
                error.code === "APPLICATION_VERIFICATION_FAILED" &&
                error.cause instanceof Error,
            label,
        );
        const inspection = inspectTrajectoryCompression(store, deriveApplicationOwnerId(commandId));
        const rejected = inspection.compression.outcome;
        assert.equal(rejected?.status, "rejected");
        assert.equal(rejected?.failure?.code, "APPLICATION_VERIFICATION_FAILED");
        assert.equal(rejected?.outcome, null);
        assert.equal(rejected?.verdict, null);
        assert.match(rejected?.verifier_handle_id as string, /^delegation:sha256:/u);
        assert.equal(rejected?.restoration_session_id, null);
        assert.equal(inspection.compression.rewound?.status, "rewound");
        assert.equal(inspection.outcome, null);
        assert.equal(inspection.manifest, null);
        assert.deepEqual(inspection.controls[0]?.outcome, null);
        // A rerun with a verifier that would accept re-raises the retained failure.
        const calls = base.calls.length;
        await assert.rejects(
            runTrajectoryCompression(store, { ...options, verifier: verifierOf() }),
            ApplicationVerificationError,
        );
        assert.equal(base.calls.length, calls);
        assert.equal(
            inspectTrajectoryCompression(store, deriveApplicationOwnerId(commandId)).outcome,
            null,
        );
    }
});

test("a restoration or control session that ended failed rejects its candidate and stops the run", async () => {
    for (const label of ["restoration", "control"] as const) {
        using store = new SQLiteTraceStore();
        const commandId = `application:compression:failed-${label}`;
        const judged: string[] = [];
        // Restoration: the verifier rejects, and the restored suffix fails at its second
        // exploration call. Control: the seeded rerun fails at its first exploration.
        const options = compressionOptions(commandId, {
            ...(label === "control"
                ? {
                      controlProvider: () => stageProvider("base", { failStage: "explore-b" }),
                      protocol: compressionProtocolWithBudgets({ bestOfN: 1 }),
                  }
                : {
                      protocol: compressionProtocolWithBudgets({ bestOfN: 0 }),
                      workflow: {
                          handlers: notifyHandlers,
                          program: exploreWorkflow(),
                          programId: "workflow:explore-answer.v1",
                          provider: stageProvider("base", {
                              failOnCall: 2,
                              failStage: "explore-a",
                          }),
                      },
                  }),
            verifier: verifierOf((context) => {
                judged.push(context.candidate);
                return label === "control"
                    ? { ...sameResult(context), verdict: "accepted" }
                    : { reason: "restore the exploration", score: 0, verdict: "rejected" };
            }),
        });
        await assert.rejects(
            runTrajectoryCompression(store, options),
            (error: unknown) =>
                error instanceof ApplicationEvidenceError &&
                error.code === "APPLICATION_EVIDENCE_INVALID" &&
                /ended failed instead of finished/u.test(error.message),
            label,
        );
        // A failed control is never judged, so it can never be accepted as the best control.
        assert.deepEqual(judged, ["compression"], label);
        const inspection = inspectTrajectoryCompression(store, deriveApplicationOwnerId(commandId));
        const rejected =
            label === "control" ? inspection.controls[0]?.outcome : inspection.compression.outcome;
        assert.equal(rejected?.status, "rejected", label);
        assert.equal(rejected?.failure?.code, "APPLICATION_EVIDENCE_INVALID", label);
        assert.equal(rejected?.verdict, null, label);
        assert.equal(inspection.outcome, null, label);
        const records = ownerCount(store, commandId);
        await assert.rejects(runTrajectoryCompression(store, options), ApplicationEvidenceError);
        assert.equal(ownerCount(store, commandId), records, label);
        assert.equal(store.verifyIntegrity().ok, true, label);
    }
});

test("a control verifier failure rejects the control and stops the run", async () => {
    using store = new SQLiteTraceStore();
    const commandId = "application:compression:control-verifier";
    const options = compressionOptions(commandId, {
        verifier: verifierOf((context) => {
            if (context.candidate === "control") {
                throw new Error("control verifier unavailable");
            }
            return sameResult(context);
        }),
    });
    await assert.rejects(runTrajectoryCompression(store, options), ApplicationVerificationError);
    const inspection = inspectTrajectoryCompression(store, deriveApplicationOwnerId(commandId));
    assert.equal(inspection.compression.outcome?.outcome, "pruned");
    const [first, second] = inspection.controls;
    assert.equal(first?.outcome?.status, "rejected");
    assert.equal(first?.outcome?.failure?.code, "APPLICATION_VERIFICATION_FAILED");
    assert.match(first?.outcome?.session_id as string, /^replay-session:sha256:/u);
    assert.equal(second?.outcome, null);
    assert.equal(inspection.outcome, null);
    await assert.rejects(runTrajectoryCompression(store, options), ApplicationVerificationError);
});

test("malformed options, an over-bound best-of-N, and protocol refusals write no record", async () => {
    using store = new SQLiteTraceStore();
    const pristine = recordCount(store);
    const base = stageProvider("base");
    const workflow = {
        handlers: notifyHandlers,
        program: exploreWorkflow(),
        programId: "workflow:explore-answer.v1",
        provider: base,
    };
    const surfaces = compressionDefinition.surfaces as readonly { readonly role: string }[];
    const refusals: readonly [Record<string, unknown>, (error: unknown) => boolean][] = [
        [
            { protocol: compressionProtocolWithBudgets({ bestOfN: 9 }) },
            (error) =>
                error instanceof ApplicationBudgetError &&
                error.code === "APPLICATION_BUDGET_EXCEEDED" &&
                /configured bound 8/u.test(error.message),
        ],
        [
            { protocol: compressionProtocolWithBudgets({ bestOfN: 4 }) },
            (error) =>
                error instanceof ApplicationProtocolError && /declared seed/u.test(error.message),
        ],
        [
            { protocol: { ...compressionDefinition, kind: "tree_rl" } },
            (error) => error instanceof ApplicationProtocolError,
        ],
        [
            {
                protocol: {
                    ...compressionDefinition,
                    surfaces: surfaces.filter((surface) => surface.role !== "verifier"),
                },
            },
            (error) =>
                error instanceof ApplicationProtocolError &&
                /role verifier is required/u.test(error.message),
        ],
        [
            { protocol: { ...compressionDefinition, budgets: { bestOfN: 1 } } },
            (error) =>
                error instanceof ApplicationProtocolError &&
                /budgets must declare/u.test(`${error}`),
        ],
        [
            {
                compressor: {
                    ...compressorOf(forkAt(1)),
                    provider: stageProvider("both"),
                },
            },
            (error) => error instanceof TypeError && /exactly one of program/u.test(`${error}`),
        ],
        [
            { verifier: { budget: { maxTurns: 1 }, grant: [], task: compressorTask } },
            (error) => error instanceof TypeError,
        ],
        [
            { compressor: { ...compressorOf(forkAt(1)), program: "no" } },
            (error) => error instanceof TypeError,
        ],
        [{ workflow: { ...workflow, program: "no" } }, (error) => error instanceof TypeError],
        [{ controlProvider: "no" }, (error) => error instanceof TypeError],
        [{ clock: "no" }, (error) => error instanceof TypeError],
        [{ baselines: ["whole_trajectory"] }, (error) => error instanceof TypeError],
        [{ supervisorId: "" }, (error) => error instanceof TypeError],
        [{ unknown: true }, (error) => error instanceof TypeError],
    ];
    for (const [index, [overrides, matches]] of refusals.entries()) {
        const commandId = `application:compression:refusal:${index}`;
        await assert.rejects(
            runTrajectoryCompression(store, {
                ...compressionOptions(commandId, { workflow }),
                ...overrides,
            } as never),
            matches,
            `refusal ${index}`,
        );
        assert.equal(ownerCount(store, commandId), 0);
    }
    // Nothing was recorded: no application record, no source session, and no provider call.
    assert.equal(recordCount(store), pristine);
    assert.deepEqual(base.calls, []);
});

test("a rerun under another protocol or baselines is refused without a record", async () => {
    using store = new SQLiteTraceStore();
    const commandId = "application:compression:rerun";
    const options = compressionOptions(commandId, {
        protocol: compressionProtocolWithBudgets({ bestOfN: 0 }),
    });
    await runTrajectoryCompression(store, options);
    const records = ownerCount(store, commandId);
    await assert.rejects(
        runTrajectoryCompression(store, {
            ...options,
            protocol: compressionProtocol({ protocolVersion: "appendix-d.v2" }),
        }),
        ApplicationProtocolError,
    );
    await assert.rejects(
        runTrajectoryCompression(store, { ...options, baselines: ["no_compression"] }),
        (error: unknown) =>
            error instanceof ApplicationEvidenceError && /different baselines/u.test(`${error}`),
    );
    assert.equal(ownerCount(store, commandId), records);
});

test("the provider-call budget refuses a session or child before it starts and keeps evidence", async () => {
    using store = new SQLiteTraceStore();
    const control = stageProvider("control");
    const commandId = "application:compression:budget";
    // Source 4, compressor 1, compressed suffix 1, verifier 1: the first control's 4 exceed 10.
    const options = compressionOptions(commandId, {
        controlProvider: () => control,
        protocol: compressionProtocolWithBudgets({ maxProviderCalls: 10 }),
    });
    await assert.rejects(
        runTrajectoryCompression(store, options),
        (error: unknown) =>
            error instanceof ApplicationBudgetError && /maxProviderCalls 10/u.test(error.message),
    );
    const inspection = inspectTrajectoryCompression(store, deriveApplicationOwnerId(commandId));
    assert.equal(inspection.compression.outcome?.outcome, "pruned");
    assert.equal(inspection.controls[0]?.outcome, null);
    assert.deepEqual(control.calls, []);
    const records = ownerCount(store, commandId);
    await assert.rejects(runTrajectoryCompression(store, options), ApplicationBudgetError);
    assert.equal(ownerCount(store, commandId), records);
    // A budget that cannot start the compressor child refuses it after the opened record.
    const childCommand = "application:compression:budget-child";
    await assert.rejects(
        runTrajectoryCompression(
            store,
            compressionOptions(childCommand, {
                protocol: compressionProtocolWithBudgets({ maxProviderCalls: 4 }),
            }),
        ),
        ApplicationBudgetError,
    );
    assert.equal(ownerCount(store, childCommand), 1);
    // A budget that cannot replay the restoration suffix refuses it after the verdict.
    const restorationCommand = "application:compression:budget-restoration";
    await assert.rejects(
        runTrajectoryCompression(
            store,
            compressionOptions(restorationCommand, {
                protocol: compressionProtocolWithBudgets({ bestOfN: 0, maxProviderCalls: 8 }),
                verifier: verifierOf(() => ({ reason: "no", score: 0, verdict: "rejected" })),
            }),
        ),
        ApplicationBudgetError,
    );
    // And one that cannot start the verifier child refuses it after the compressed suffix.
    await assert.rejects(
        runTrajectoryCompression(
            store,
            compressionOptions("application:compression:budget-verifier", {
                protocol: compressionProtocolWithBudgets({ bestOfN: 0, maxProviderCalls: 6 }),
            }),
        ),
        ApplicationBudgetError,
    );
});

test("a source trajectory that did not finish is refused before the opened record", async () => {
    using store = new SQLiteTraceStore();
    const commandId = "application:compression:failed-source";
    await assert.rejects(
        runTrajectoryCompression(
            store,
            compressionOptions(commandId, {
                workflow: {
                    handlers: notifyHandlers,
                    program: exploreWorkflow(),
                    programId: "workflow:explore-answer.v1",
                    provider: stageProvider("base", { failStage: "explore-b" }),
                },
            }),
        ),
        (error: unknown) =>
            error instanceof ApplicationEvidenceError && /did not finish/u.test(error.message),
    );
    assert.equal(ownerCount(store, commandId), 0);
});

/** Store that fails the first application append of a chosen record once, simulating a crash. */
class CrashingStore extends SQLiteTraceStore {
    crashWhen: ((body: Record<string, unknown>, schema: string) => boolean) | null = null;
    moveHead = false;

    override appendApplicationRecord(
        ...args: Parameters<SQLiteTraceStore["appendApplicationRecord"]>
    ): ReturnType<SQLiteTraceStore["appendApplicationRecord"]> {
        const [, , request] = args;
        const record = request.batch.groups[0]?.records[0];
        if (this.moveHead) {
            this.moveHead = false;
            return { status: "head_moved" };
        }
        if (
            this.crashWhen?.(record?.body as Record<string, unknown>, record?.schema_ref as string)
        ) {
            this.crashWhen = null;
            throw new Error("simulated crash");
        }
        return super.appendApplicationRecord(...args);
    }
}

test("crashes before the settled, control, outcome, and manifest records converge without re-execution", async () => {
    using store = new CrashingStore();
    const base = stageProvider("base");
    const control = stageProvider("base");
    const compressorContexts: TrajectoryCompressorContext[] = [];
    const verifierContexts: TrajectoryVerifierContext[] = [];
    const commandId = "application:compression:crash";
    const options = compressionOptions(commandId, {
        compressor: compressorOf(forkAt(1), compressorContexts),
        controlProvider: () => control,
        protocol: compressionProtocolWithBudgets({ bestOfN: 1 }),
        verifier: verifierOf((context) => {
            const verdict = sameResult(context);
            return context.candidate === "compression"
                ? { ...verdict, verdict: "rejected" }
                : verdict;
        }, verifierContexts),
        workflow: {
            handlers: notifyHandlers,
            program: exploreWorkflow(),
            programId: "workflow:explore-answer.v1",
            provider: base,
        },
    });
    const applicationId = deriveApplicationOwnerId(commandId);
    const counts = () => [
        base.calls.length,
        control.calls.length,
        compressorContexts.length,
        verifierContexts.length,
        store.listOwnersBySchema(SESSION_SCHEMA, 32, 0).length,
    ];
    const crashes: readonly ((body: Record<string, unknown>, schema: string) => boolean)[] = [
        (body) => body.status === "settled" && body.candidate === "compression",
        (body) => body.status === "settled" && body.candidate === "control",
        (body) => body.phase === "outcome",
        (_body, schema) => schema === "shepherd.application.manifest.v1",
    ];
    // Each rerun resumes after the crashed record: the compressed, restoration, and control
    // sessions, the compressor, and every verifier run exactly once.
    const expected = [
        [8, 0, 1, 1, 4],
        [8, 4, 1, 2, 5],
        [8, 4, 1, 2, 5],
        [8, 4, 1, 2, 5],
    ];
    for (const [index, crash] of crashes.entries()) {
        store.crashWhen = crash;
        await assert.rejects(runTrajectoryCompression(store, options), /simulated crash/u);
        assert.deepEqual(counts(), expected[index]);
    }
    const before = counts();
    const { inspection, manifest } = await runTrajectoryCompression(store, options);
    assert.deepEqual(counts(), before);
    assert.equal(inspection.compression.outcome?.outcome, "restored");
    assert.equal(inspection.controls[0]?.outcome?.verdict, "accepted");
    assert.equal(inspection.outcome?.control?.step_count, 5);
    assert.equal(manifest.application_id, applicationId);
    assert.equal(store.verifyIntegrity().ok, true);
    // A moved application head is refused as inconsistent evidence.
    store.moveHead = true;
    await assert.rejects(
        runTrajectoryCompression(store, {
            ...options,
            commandId: "application:compression:moved",
        }),
        (error: unknown) =>
            error instanceof ApplicationEvidenceError && /head moved/u.test(error.message),
    );
});

test("child outputs that are not the configured canonical text field fail closed", async () => {
    using store = new SQLiteTraceStore();
    await assert.rejects(
        runTrajectoryCompression(
            store,
            compressionOptions("application:compression:output-field", {
                compressor: {
                    budget: { maxTurns: 1 },
                    grant: [],
                    program: () => childOutput(null),
                    task: compressorTask,
                },
            }),
        ),
        (error: unknown) =>
            error instanceof ApplicationEvidenceError &&
            error.cause instanceof JSONSchemaValidationError &&
            error.cause.issues.some((issue) => issue.path === "$" && issue.keyword === "type"),
    );
});
