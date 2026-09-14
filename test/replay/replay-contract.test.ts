import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { Ajv2020, type AnySchemaObject } from "ajv/dist/2020.js";

import * as facade from "../../src/facades/replay.ts";
import {
    analyzeReplayDependencies,
    analyzeReplayDivergence,
    REPLAY_COMPATIBILITY_VERSION,
    REPLAY_LIMITS,
    ReplayEvidenceError,
    replayReplaySession,
    runReplaySession,
    SQLiteTraceStore,
} from "../../src/index.ts";
import { REPLAY_PROTOCOL_V1_CONTRACT } from "../../src/protocol/compatibility-constants.ts";
import { parseProtocolConfig } from "../../src/protocol/config-validation.ts";
import {
    emptyDirectory,
    exchangeOf,
    intentOf,
    providerOf,
    requestOf,
    reviewProgram,
    reviewProvider,
    temporaryDirectory,
    worldHandlers,
} from "./fixtures.ts";

const validConfig = JSON.parse(
    readFileSync(new URL("../../protocol.config.json", import.meta.url), "utf8"),
) as Record<string, unknown>;

test("dependency and divergence analysis follow declared dependencies", async (context) => {
    const directory = await temporaryDirectory(context, "analysis");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const world = await emptyDirectory(directory, "world");
    const { inspection: source } = await runReplaySession(store, {
        claimId: "worker:1",
        commandId: "session:analysis",
        handlers: worldHandlers(world),
        program: reviewProgram,
        programId: "program:review.v1",
        provider: reviewProvider(),
    });
    assert.deepEqual(
        analyzeReplayDependencies(store, { sessionId: source.session_id, stepIndex: 0 }),
        {
            dependents: [1, 3, 4],
            independent: [2, 5],
            session_id: source.session_id,
            step_index: 0,
        },
    );
    assert.deepEqual(
        analyzeReplayDependencies(store, {
            clock: Date.now,
            sessionId: source.session_id,
            stepIndex: 5,
        }).dependents,
        [],
    );
    for (const stepIndex of [-1, 6, 1.5]) {
        assert.throws(
            () => analyzeReplayDependencies(store, { sessionId: source.session_id, stepIndex }),
            TypeError,
        );
    }
    const handlersProgram = async (replayContext: Parameters<typeof reviewProgram>[0]) => {
        await replayContext.invokeProvider(requestOf(0));
        await replayContext.dispatchEffect(
            intentOf("effect:a", "file.write", { name: "a", text: "a" }),
        );
        await replayContext.dispatchEffect(intentOf("effect:b", "notify", {}), { dependsOn: [] });
        return "done";
    };
    const { inspection: base } = await runReplaySession(store, {
        claimId: "worker:1",
        commandId: "session:handlers",
        handlers: worldHandlers(world),
        program: handlersProgram,
        programId: "program:handlers",
        provider: providerOf("p", [exchangeOf(requestOf(0), { text: "x" })]),
    });
    const branch = async (
        commandId: string,
        changes: readonly string[],
        program: (
            replayContext: Parameters<typeof reviewProgram>[0],
        ) => Promise<unknown> = handlersProgram,
    ) =>
        (
            await replayReplaySession(store, {
                changes: changes as never,
                claimId: "operator",
                commandId,
                handlers: worldHandlers(world, [], "!"),
                program,
                provider: providerOf("p", [exchangeOf(requestOf(0), { text: "y" })]),
                sourceSessionId: base.session_id,
                target: { stepCount: 0 },
            })
        ).inspection;
    const declared = await branch("replay:declared", ["provider", "handlers"]);
    const declaredAnalysis = analyzeReplayDivergence(store, {
        clock: Date.now,
        replaySessionId: declared.session_id,
        sourceSessionId: base.session_id,
    });
    assert.deepEqual(
        declaredAnalysis.steps.map((step) => [step.status, step.cause]),
        [
            ["diverged", "root"],
            ["identical", null],
            ["identical", null],
        ],
    );
    assert.equal(declaredAnalysis.common_prefix_id, null);
    assert.equal(declaredAnalysis.first_divergence_index, 0);
    const undeclared = await branch("replay:undeclared", []);
    assert.deepEqual(
        analyzeReplayDivergence(store, {
            replaySessionId: undeclared.session_id,
            sourceSessionId: base.session_id,
        }).unexplained,
        [0],
    );
    const shorter = await branch("replay:shorter", ["provider"], async (replayContext) => {
        await replayContext.invokeProvider(requestOf(0));
        await replayContext.dispatchEffect(intentOf("effect:c", "notify", {}), { dependsOn: [] });
        await replayContext.dispatchEffect(intentOf("effect:d", "notify", {}), { dependsOn: [] });
        await replayContext.dispatchEffect(intentOf("effect:e", "notify", {}), { dependsOn: [] });
    });
    const shorterAnalysis = analyzeReplayDivergence(store, {
        replaySessionId: shorter.session_id,
        sourceSessionId: base.session_id,
    });
    assert.deepEqual(
        shorterAnalysis.steps.map((step) => [step.status, step.cause]),
        [
            ["diverged", "root"],
            ["diverged", "unexplained"],
            ["diverged", "unexplained"],
            ["replay_only", "unexplained"],
        ],
    );
    const truncated = await branch("replay:truncated", ["provider"], async (replayContext) => {
        await replayContext.invokeProvider(requestOf(0));
    });
    assert.deepEqual(
        analyzeReplayDivergence(store, {
            replaySessionId: truncated.session_id,
            sourceSessionId: base.session_id,
        }).steps.map((step) => step.status),
        ["diverged", "source_only", "source_only"],
    );
    assert.throws(
        () =>
            analyzeReplayDivergence(store, {
                replaySessionId: base.session_id,
                sourceSessionId: source.session_id,
            }),
        ReplayEvidenceError,
    );
    for (const invalid of [
        {},
        { replaySessionId: "", sourceSessionId: "x" },
        { replaySessionId: "x", sourceSessionId: "" },
    ]) {
        assert.throws(() => analyzeReplayDivergence(store, invalid as never), TypeError);
    }
    assert.throws(
        () => analyzeReplayDependencies(store, { sessionId: "", stepIndex: 0 }),
        TypeError,
    );
});

test("the replay facade, generated schemas, and configuration contract agree", async (context) => {
    assert.equal(facade.REPLAY_COMPATIBILITY_VERSION, REPLAY_COMPATIBILITY_VERSION);
    assert.equal(typeof facade.runReplaySession, "function");
    assert.equal(typeof facade.rewindReplaySession, "function");
    assert.equal(typeof facade.createCooperativeProcessAdapter, "function");
    assert.equal(REPLAY_LIMITS.maxSteps, 4096);
    const directory = await temporaryDirectory(context, "schemas");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const world = await emptyDirectory(directory, "world");
    const { inspection } = await runReplaySession(store, {
        claimId: "worker:1",
        commandId: "session:schemas",
        handlers: worldHandlers(world),
        program: reviewProgram,
        programId: "program:review.v1",
        provider: reviewProvider(),
        worlds: [{ name: "main", root: world }],
    });
    const branch = await replayReplaySession(store, {
        changes: ["handlers"],
        claimId: "operator",
        commandId: "replay:schemas",
        handlers: worldHandlers(await emptyDirectory(directory, "branch")),
        program: reviewProgram,
        provider: providerOf("p", [exchangeOf(requestOf(1), { text: "final" })]),
        sourceSessionId: inspection.session_id,
        target: { checkpointId: String(inspection.checkpoints[0]?.checkpoint_id) },
        worlds: [{ name: "main", root: await emptyDirectory(directory, "branch-main") }],
    });
    const records = [
        ...store.readOwner(inspection.session_id),
        ...store.readOwner(branch.inspection.session_id),
    ];
    const cases = [
        ["replay-session-v1.schema.json", "shepherd.replay.session.v1"],
        ["replay-step-v1.schema.json", "shepherd.replay.step.v1"],
        ["replay-admission-v1.schema.json", "shepherd.replay.admission.v1"],
        ["replay-checkpoint-v1.schema.json", "shepherd.replay.checkpoint.v1"],
        ["replay-restore-v1.schema.json", "shepherd.replay.restore.v1"],
        ["replay-terminal-v1.schema.json", "shepherd.replay.terminal.v1"],
    ] as const;
    for (const [file, schemaRef] of cases) {
        const validate = compile(file);
        const bodies = records
            .filter((record) => record.envelope.schema_ref === schemaRef)
            .map((record) => record.body as Record<string, unknown>);
        assert.ok(bodies.length > 0, schemaRef);
        for (const body of bodies) {
            assert.equal(validate(body), true, JSON.stringify(validate.errors));
            assert.equal(validate({ ...body, extra: true }), false);
            assert.equal(validate({ ...body, replay_version: 2 }), false);
        }
    }
    const parsed = parseProtocolConfig(structuredClone(validConfig));
    assert.deepEqual(parsed.replay, REPLAY_PROTOCOL_V1_CONTRACT);
    assert.equal(Object.isFrozen(parsed.replay), true);
});

test("replay configuration rejects malformed and inconsistent values", () => {
    const mutations: readonly ((replay: ReplaySection) => void)[] = [
        (replay) => {
            replay.extra = true;
        },
        (replay) => {
            replay.lease.renewalMilliseconds = replay.lease.leaseMilliseconds;
        },
        (replay) => {
            replay.processes.cooperative.maxLineBytes = 1;
        },
        (replay) => {
            replay.processes.cooperative.messageTypes.error = "image";
        },
        (replay) => {
            replay.traceSchemas.step = String(replay.traceSchemas.session);
        },
        (replay) => {
            replay.effects.approvalRequiredTiers = ["unknown"];
        },
        (replay) => {
            replay.modes = ["root"];
        },
        (replay) => {
            replay.compatibilityVersion = "shepherd.replay.v2";
        },
        (replay) => {
            replay.limits.maxSteps = 0;
        },
        (replay) => {
            replay.schemas.stepId = "relative";
        },
    ];
    for (const mutate of mutations) {
        const config = structuredClone(validConfig);
        mutate(config.replay as ReplaySection);
        assert.throws(() => parseProtocolConfig(config), TypeError);
    }
});

type ReplaySection = Record<string, unknown> & {
    effects: Record<string, unknown>;
    lease: { leaseMilliseconds: number; renewalMilliseconds: number };
    limits: Record<string, number>;
    modes: string[];
    processes: {
        cooperative: { maxLineBytes: number; messageTypes: Record<string, string> };
    };
    schemas: Record<string, string>;
    traceSchemas: Record<string, string>;
};

function compile(file: string) {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    ajv.addKeyword("x-shepherd-max-utf8-bytes");
    return ajv.compile(
        JSON.parse(
            readFileSync(new URL(`../../spec/schemas/${file}`, import.meta.url), "utf8"),
        ) as AnySchemaObject,
    );
}
