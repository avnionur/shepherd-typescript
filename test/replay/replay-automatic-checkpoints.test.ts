import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
    createEffectCompensationRegistry,
    type EffectReversibility,
    inspectReplaySession,
    REPLAY_CHECKPOINT_POLICIES,
    REPLAY_LIMITS,
    type ReplayCheckpointPolicy,
    type ReplaySessionProgram,
    replayReplaySession,
    rewindReplaySession,
    runReplaySession,
    SQLiteTraceStore,
} from "../../src/index.ts";
import { parseProtocolConfig } from "../../src/protocol/config-validation.ts";
import {
    emptyDirectory,
    exchangeOf,
    intentOf,
    providerOf,
    readTree,
    requestOf,
    temporaryDirectory,
    worldHandlers,
} from "./fixtures.ts";

const STEP_COUNT = 6;

/** Hashes a world tree (paths, modes, links, and bytes) into one digest. */
async function hashWorld(root: string): Promise<string> {
    return createHash("sha256")
        .update(JSON.stringify(await readTree(root)))
        .digest("hex");
}

/**
 * Deterministic world-bound program: even steps invoke the provider, odd steps write files through
 * the handler stack (step 3 overwrites step 1's file). Before every step and at the end, the hash
 * of `root` is recorded under the current boundary.
 */
function worldProgram(
    root: string,
    hashes: Map<number, string>,
    reversibility: EffectReversibility = "reversible",
): ReplaySessionProgram {
    return async (context) => {
        for (let index = 0; index < STEP_COUNT; index += 1) {
            hashes.set(context.step_count, await hashWorld(root));
            if (index % 2 === 0) {
                await context.invokeProvider(requestOf(index));
            } else {
                await context.dispatchEffect(
                    intentOf(
                        `effect:${index}`,
                        "file.write",
                        { name: index === 5 ? "b.txt" : "a.txt", text: `v${index}` },
                        reversibility,
                    ),
                );
            }
        }
        hashes.set(context.step_count, await hashWorld(root));
        return { steps: context.step_count };
    };
}

/** Static provider serving the program's provider steps at or after step `from`. */
function worldProvider(id: string, from = 0) {
    return providerOf(
        id,
        [0, 2, 4]
            .filter((index) => index >= from)
            .map((index) => exchangeOf(requestOf(index), { text: `answer:${index}` })),
    );
}

async function recordWorldSession(
    directory: string,
    store: SQLiteTraceStore,
    commandId: string,
    checkpointPolicy: ReplayCheckpointPolicy | undefined,
    reversibility: EffectReversibility = "reversible",
) {
    const world = await emptyDirectory(directory, `${commandId.replaceAll(":", "-")}-world`);
    const hashes = new Map<number, string>();
    const { inspection } = await runReplaySession(store, {
        ...(checkpointPolicy === undefined ? {} : { checkpointPolicy }),
        claimId: "worker:1",
        commandId,
        handlers: worldHandlers(world),
        program: worldProgram(world, hashes, reversibility),
        programId: "program:world.v1",
        provider: worldProvider("provider:source"),
        worlds: [{ name: "main", root: world }],
    });
    assert.equal(inspection.terminal?.status, "finished");
    return { hashes, inspection, world };
}

test("an every-step policy checkpoints every boundary and each restores the world byte-equivalently", async (context) => {
    const directory = await temporaryDirectory(context, "auto-every");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const source = await recordWorldSession(directory, store, "session:every", {
        interval: 1,
        kind: "every_n_steps",
    });
    assert.deepEqual(
        source.inspection.checkpoints.map((checkpoint) => checkpoint.step_count),
        [0, 1, 2, 3, 4, 5],
    );
    // The world differs at every effect boundary, so each restore proves a distinct state.
    assert.equal(new Set(source.hashes.values()).size, 4);
    const branches = new Map<number, string>();
    for (const checkpoint of source.inspection.checkpoints) {
        assert.equal(checkpoint.classification, "reconstructive");
        assert.deepEqual(
            checkpoint.constituents.map((entry) => [entry.kind, entry.status]),
            [
                ["trace_cut", "verified"],
                ["world", "verified"],
                ["provider_session", "reconstructive"],
                ["irreversible_effects", "verified"],
            ],
        );
        const boundary = checkpoint.step_count;
        const rewoundRoot = await emptyDirectory(directory, `rewind-${boundary}`);
        const { inspection: rewound } = await rewindReplaySession(store, {
            claimId: "operator",
            commandId: `rewind:every:${boundary}`,
            sourceSessionId: source.inspection.session_id,
            target: { checkpointId: checkpoint.checkpoint_id },
            worlds: [{ name: "main", root: rewoundRoot }],
        });
        assert.equal(rewound.terminal?.status, "rewound");
        assert.equal(await hashWorld(rewoundRoot), source.hashes.get(boundary));

        const replayRoot = await emptyDirectory(directory, `replay-${boundary}`);
        const replayHashes = new Map<number, string>();
        const { inspection: replayed } = await replayReplaySession(store, {
            changes: ["handlers"],
            checkpointPolicy: { interval: 1, kind: "every_n_steps" },
            claimId: "operator",
            commandId: `replay:every:${boundary}`,
            handlers: worldHandlers(replayRoot),
            program: worldProgram(replayRoot, replayHashes),
            provider: worldProvider(`provider:replay:${boundary}`, boundary),
            sourceSessionId: source.inspection.session_id,
            target: { checkpointId: checkpoint.checkpoint_id },
            worlds: [{ name: "main", root: replayRoot }],
        });
        assert.equal(replayed.terminal?.status, "finished", JSON.stringify(replayed.terminal));
        branches.set(boundary, replayed.session_id);
        assert.equal(replayed.restore?.classification, "reconstructive");
        assert.equal(replayHashes.get(boundary), source.hashes.get(boundary));
        assert.equal(await hashWorld(replayRoot), source.hashes.get(STEP_COUNT));
        assert.deepEqual(
            replayed.steps.map((step) => step.step_id),
            source.inspection.steps.map((step) => step.step_id),
        );
        // The branch captures only its own boundaries at or after the target.
        assert.deepEqual(
            replayed.checkpoints.map((entry) => entry.step_count),
            [0, 1, 2, 3, 4, 5].filter((entry) => entry >= boundary),
        );
        for (const entry of replayed.checkpoints) {
            assert.equal(entry.session_id, replayed.session_id);
        }
    }
    // A branch checkpoint is itself a restorable target.
    const branch = inspectReplaySession(store, { sessionId: String(branches.get(2)) });
    const nested = branch.checkpoints.find((entry) => entry.step_count === 4);
    assert.ok(nested);
    const nestedRoot = await emptyDirectory(directory, "nested");
    await rewindReplaySession(store, {
        claimId: "operator",
        commandId: "rewind:nested",
        sourceSessionId: branch.session_id,
        target: { checkpointId: nested.checkpoint_id },
        worlds: [{ name: "main", root: nestedRoot }],
    });
    assert.equal(await hashWorld(nestedRoot), source.hashes.get(4));
    assert.equal(store.verifyIntegrity().ok, true);
});

test("configured policies select provider, effect, and interval boundaries only", async (context) => {
    const directory = await temporaryDirectory(context, "auto-policies");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    assert.deepEqual(REPLAY_CHECKPOINT_POLICIES, [
        "none",
        "provider_step",
        "effect_step",
        "every_n_steps",
    ]);
    const cases: readonly [ReplayCheckpointPolicy | undefined, readonly number[]][] = [
        [undefined, []],
        [{ kind: "none" }, []],
        [{ kind: "provider_step" }, [0, 2, 4]],
        [{ kind: "effect_step" }, [1, 3, 5]],
        [{ interval: 2, kind: "every_n_steps" }, [0, 2, 4]],
        [{ interval: 4, kind: "every_n_steps" }, [0, 4]],
    ];
    for (const [index, [policy, boundaries]] of cases.entries()) {
        const { inspection } = await recordWorldSession(
            directory,
            store,
            `session:policy:${index}`,
            policy,
        );
        assert.deepEqual(
            inspection.checkpoints.map((checkpoint) => checkpoint.step_count),
            boundaries,
            JSON.stringify(policy),
        );
    }

    // An explicit checkpoint at a selected boundary returns the automatic capture.
    const world = await emptyDirectory(directory, "explicit");
    const explicit: string[] = [];
    const { inspection } = await runReplaySession(store, {
        checkpointPolicy: { kind: "provider_step" },
        claimId: "worker:1",
        commandId: "session:explicit",
        handlers: worldHandlers(world),
        program: async (replayContext) => {
            const first = await replayContext.checkpoint();
            await replayContext.invokeProvider(requestOf(0));
            const second = await replayContext.checkpoint();
            await replayContext.invokeProvider(requestOf(2));
            explicit.push(first.checkpoint_id, second.checkpoint_id);
            return null;
        },
        programId: "program:explicit.v1",
        provider: worldProvider("provider:explicit"),
        worlds: [{ name: "main", root: world }],
    });
    assert.deepEqual(
        inspection.checkpoints.map((checkpoint) => checkpoint.step_count),
        [0, 1],
    );
    assert.deepEqual(
        explicit,
        inspection.checkpoints.map((checkpoint) => checkpoint.checkpoint_id),
    );

    // A replay branch never captures inside its recorded prefix.
    const source = await recordWorldSession(directory, store, "session:branch-source", {
        kind: "provider_step",
    });
    const target = source.inspection.checkpoints.find((checkpoint) => checkpoint.step_count === 2);
    assert.ok(target);
    const root = await emptyDirectory(directory, "branch-root");
    const { inspection: branch } = await replayReplaySession(store, {
        changes: ["handlers"],
        checkpointPolicy: { kind: "effect_step" },
        claimId: "operator",
        commandId: "replay:policy",
        handlers: worldHandlers(root),
        program: worldProgram(root, new Map()),
        provider: worldProvider("provider:branch", 2),
        sourceSessionId: source.inspection.session_id,
        target: { checkpointId: target.checkpoint_id },
        worlds: [{ name: "main", root }],
    });
    assert.equal(branch.terminal?.status, "finished");
    assert.deepEqual(
        branch.checkpoints.map((checkpoint) => checkpoint.step_count),
        [3, 5],
    );
});

test("malformed automatic checkpoint policies are refused before anything is written", async (context) => {
    const directory = await temporaryDirectory(context, "auto-invalid");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const world = await emptyDirectory(directory, "world");
    const invalid: readonly unknown[] = [
        null,
        {},
        { kind: "unknown" },
        { kind: "every_n_steps" },
        { interval: 0, kind: "every_n_steps" },
        { interval: 1.5, kind: "every_n_steps" },
        { interval: REPLAY_LIMITS.maxSteps + 1, kind: "every_n_steps" },
        { interval: 1, kind: "provider_step" },
        { extra: true, kind: "none" },
    ];
    for (const [index, checkpointPolicy] of invalid.entries()) {
        await assert.rejects(
            runReplaySession(store, {
                checkpointPolicy: checkpointPolicy as ReplayCheckpointPolicy,
                claimId: "worker:1",
                commandId: `session:invalid:${index}`,
                handlers: worldHandlers(world),
                program: worldProgram(world, new Map()),
                programId: "program:world.v1",
                provider: worldProvider("provider:invalid"),
                worlds: [{ name: "main", root: world }],
            }),
            TypeError,
            JSON.stringify(checkpointPolicy),
        );
    }
    const source = await recordWorldSession(directory, store, "session:valid", {
        kind: "provider_step",
    });
    await assert.rejects(
        replayReplaySession(store, {
            checkpointPolicy: { kind: "unknown" } as never,
            claimId: "operator",
            commandId: "replay:invalid",
            program: worldProgram(world, new Map()),
            sourceSessionId: source.inspection.session_id,
            target: {
                checkpointId: String(source.inspection.checkpoints[0]?.checkpoint_id),
            },
            worlds: [{ name: "main", root: await emptyDirectory(directory, "invalid-root") }],
        }),
        TypeError,
    );
    await assert.rejects(
        rewindReplaySession(store, {
            checkpointPolicy: { kind: "provider_step" },
            claimId: "operator",
            commandId: "rewind:policy",
            sourceSessionId: source.inspection.session_id,
            target: {
                checkpointId: String(source.inspection.checkpoints[0]?.checkpoint_id),
            },
        } as never),
        TypeError,
    );
    assert.equal(store.listOwnersBySchema("shepherd.replay.session.v1", 100, 0).length, 1);

    const validConfig = JSON.parse(
        readFileSync(new URL("../../protocol.config.json", import.meta.url), "utf8"),
    ) as { replay: { checkpoint: { automatic: Record<string, unknown> } } };
    assert.deepEqual(
        parseProtocolConfig(structuredClone(validConfig)).replay.checkpoint.automatic,
        {
            defaultPolicy: { interval: null, kind: "none" },
            policies: REPLAY_CHECKPOINT_POLICIES,
        },
    );
    for (const automatic of [
        { defaultPolicy: { kind: "none" } },
        { defaultPolicy: { kind: "none" }, policies: ["none", "provider_step", "effect_step"] },
        { defaultPolicy: { kind: "unknown" }, policies: REPLAY_CHECKPOINT_POLICIES },
        { defaultPolicy: { kind: "every_n_steps" }, policies: REPLAY_CHECKPOINT_POLICIES },
        {
            defaultPolicy: { interval: 0, kind: "every_n_steps" },
            policies: REPLAY_CHECKPOINT_POLICIES,
        },
    ]) {
        const config = structuredClone(validConfig);
        config.replay.checkpoint.automatic = automatic;
        assert.throws(
            () => parseProtocolConfig(config, { enforceCompatibility: false }),
            /replay\.checkpoint\.automatic/u,
            JSON.stringify(automatic),
        );
    }
    const configured = structuredClone(validConfig);
    configured.replay.checkpoint.automatic.defaultPolicy = { interval: 3, kind: "every_n_steps" };
    assert.deepEqual(
        parseProtocolConfig(configured, { enforceCompatibility: false }).replay.checkpoint.automatic
            .defaultPolicy,
        { interval: 3, kind: "every_n_steps" },
    );
    // The default is part of the pinned replay protocol contract.
    assert.throws(() => parseProtocolConfig(structuredClone(configured)), /replay constants/u);
});

test("rewinding a world-bound session to an automatic checkpoint compensates the suffix once", async (context) => {
    const directory = await temporaryDirectory(context, "auto-compensation");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const source = await recordWorldSession(
        directory,
        store,
        "session:compensable",
        { kind: "effect_step" },
        "compensable",
    );
    const calls: string[] = [];
    const compensation = createEffectCompensationRegistry([
        {
            compensate: (request) => {
                calls.push(request.intent.effect_id);
                return { ok: true, value: null };
            },
            handlerId: "compensation:file.write",
            kind: "file.write",
        },
    ]);
    const target = source.inspection.checkpoints.find((checkpoint) => checkpoint.step_count === 3);
    assert.ok(target);
    const root = await emptyDirectory(directory, "rewound");
    const options = {
        claimId: "operator",
        commandId: "rewind:compensable",
        compensation,
        sourceSessionId: source.inspection.session_id,
        target: { checkpointId: target.checkpoint_id },
        worlds: [{ name: "main", root }],
    };
    const { inspection } = await rewindReplaySession(store, options);
    assert.equal(inspection.terminal?.status, "rewound");
    // Effects at steps 3 and 5 are past the target and are compensated in reverse order.
    assert.deepEqual(calls, ["effect:5", "effect:3"]);
    assert.equal(await hashWorld(root), source.hashes.get(3));
    assert.deepEqual((await rewindReplaySession(store, options)).inspection, inspection);
    assert.deepEqual(calls, ["effect:5", "effect:3"]);

    // A later replay from an earlier checkpoint compensates only the effect not yet compensated.
    const earlier = source.inspection.checkpoints.find((checkpoint) => checkpoint.step_count === 1);
    assert.ok(earlier);
    const replayRoot = await emptyDirectory(directory, "replayed");
    const { inspection: replayed } = await replayReplaySession(store, {
        changes: ["handlers"],
        claimId: "operator",
        commandId: "replay:compensable",
        compensation,
        handlers: worldHandlers(replayRoot),
        program: worldProgram(replayRoot, new Map(), "compensable"),
        provider: worldProvider("provider:compensable", 1),
        sourceSessionId: source.inspection.session_id,
        target: { checkpointId: earlier.checkpoint_id },
        worlds: [{ name: "main", root: replayRoot }],
    });
    assert.equal(replayed.terminal?.status, "finished");
    assert.deepEqual(calls, ["effect:5", "effect:3", "effect:1"]);
    assert.equal(await hashWorld(replayRoot), source.hashes.get(STEP_COUNT));
});
