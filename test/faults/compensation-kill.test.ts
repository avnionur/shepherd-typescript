import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";

import {
    createEffectCompensationRegistry,
    deriveEffectCompensationId,
    inspectEffectCompensation,
    rewindReplaySession,
    SQLiteTraceStore,
} from "../../src/index.ts";
import {
    ROW_INSERT_KIND,
    readCompensationLog,
    readRowIds,
    rowCompensation,
    runRowSession,
} from "../effect/compensation-fixtures.ts";
import { createPrng, deriveSeed } from "../support/prng.ts";
import { addCounts, emptyCounts, recoverAfterKill, waitForCompensationExpiry } from "./recovery.ts";
import {
    COMPENSATION_SESSION_COMMAND,
    type FaultProcessArguments,
    faultSeeds,
    faultSettings,
    inRange,
    runFaultProcess,
} from "./workload.ts";

const settings = faultSettings.processKill;
const FIXTURE = new URL("../fixtures/compensation-process.ts", import.meta.url).pathname;

/** Prepares a store whose root replay session materialized the configured compensable rows. */
async function prepareCompensationStore(directory: string, seed: number) {
    const databasePath = path.join(directory, "trace.sqlite");
    const worldPath = path.join(directory, "world.sqlite");
    const store = new SQLiteTraceStore(databasePath);
    try {
        const { inspection } = await runRowSession(
            store,
            worldPath,
            COMPENSATION_SESSION_COMMAND,
            Array.from(
                { length: settings.compensation.effects },
                (_, index) => [`row:${seed}:${index}`, "compensable"] as const,
            ),
        );
        return { databasePath, source: inspection, worldPath };
    } finally {
        store.close();
    }
}

test("SIGKILL during compensation never compensates an effect twice", {
    timeout: faultSettings.testTimeoutMilliseconds,
}, async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-kill-compensation-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const totals = emptyCounts();
    let killedDuringOperation = 0;
    for (const seed of faultSeeds()) {
        const seedDirectory = path.join(directory, String(seed));
        mkdirSync(seedDirectory);
        const { databasePath, worldPath } = await prepareCompensationStore(seedDirectory, seed);
        const childTemporary = path.join(seedDirectory, "tmp");
        mkdirSync(childTemporary);
        const random = createPrng(deriveSeed(seed, "kill:compensation", 0));
        for (let cycle = 0; cycle < settings.compensation.cycles; cycle += 1) {
            const args: FaultProcessArguments = {
                databasePath,
                label: `compensation-${cycle}`,
                operation: "compensation",
                seed,
                worldPath,
            };
            const result = await runFaultProcess(args, {
                killAfterReady: inRange(random.next, settings.killDelayMilliseconds),
                temporaryDirectory: childTemporary,
            });
            assert.equal(result.signal, "SIGKILL", result.stderr);
            const started = result.events.filter((event) => event.event === "start").length;
            const done = result.events.filter((event) => event.event === "done").length;
            // A child that compensated every prepared effect idles at one more started index.
            if (started > done && started <= settings.compensation.effects) {
                killedDuringOperation += 1;
            }
            addCounts(totals, await recoverAfterKill(args, result.events));
        }
        // Across every cycle, each compensated row was deleted by exactly one world change.
        for (const [key, entry] of readCompensationLog(worldPath)) {
            assert.equal(entry.deleted, 1, key);
        }
    }
    context.diagnostic(
        `compensation: ${JSON.stringify(totals)}, ${killedDuringOperation} kill(s) landed inside an operation`,
    );
    assert.ok(totals.complete + totals.retryable > 0);
});

test("a kill after the handler changed the world is uncertain and recovery re-invokes it idempotently", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-kill-compensation-world-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const { databasePath, source, worldPath } = await prepareCompensationStore(directory, 1);
    const step = source.steps.at(-1);
    assert.ok(step);
    await kill(
        await runUntil(
            context,
            ["after-world-change", databasePath, worldPath, step.record_id],
            "compensating",
        ),
    );
    using store = new SQLiteTraceStore(databasePath);
    const compensationId = deriveEffectCompensationId(step.record_id);
    const crashed = inspectEffectCompensation(store, { compensationId });
    assert.equal(crashed.status, "uncertain");
    assert.deepEqual(readCompensationLog(worldPath).get(compensationId), {
        deleted: 1,
        invocations: 1,
    });
    await waitForCompensationExpiry(store, compensationId);
    // The rewind trigger reaches the same compensation and completes it without a second deletion.
    const calls: string[] = [];
    await rewindReplaySession(store, {
        claimId: "operator",
        commandId: "rewind:after-kill",
        compensation: rowCompensation(worldPath, calls),
        sourceSessionId: source.session_id,
        target: { stepCount: source.steps.length - 1 },
    });
    assert.equal(calls.length, 1);
    const recovered = inspectEffectCompensation(store, { compensationId });
    assert.equal(recovered.status, "compensated");
    assert.deepEqual(
        recovered.attempts.map((attempt) => attempt.outcome?.status ?? null),
        [null, "compensated"],
    );
    assert.deepEqual(readCompensationLog(worldPath).get(compensationId), {
        deleted: 1,
        invocations: 2,
    });
    assert.equal(readRowIds(worldPath).length, source.steps.length - 1);
    assert.equal(store.verifyIntegrity().ok, true);
});

test("a kill after the outcome is retained never invokes the handler again", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-kill-compensation-outcome-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const { databasePath, source, worldPath } = await prepareCompensationStore(directory, 2);
    const step = source.steps.at(-1);
    assert.ok(step);
    await kill(
        await runUntil(
            context,
            ["after-outcome", databasePath, worldPath, step.record_id],
            "compensated",
        ),
    );
    using store = new SQLiteTraceStore(databasePath);
    const compensationId = deriveEffectCompensationId(step.record_id);
    assert.equal(inspectEffectCompensation(store, { compensationId }).status, "compensated");
    let invoked = 0;
    await rewindReplaySession(store, {
        claimId: "operator",
        commandId: "rewind:after-outcome",
        compensation: createEffectCompensationRegistry([
            {
                compensate: () => {
                    invoked += 1;
                    return { ok: true, value: null };
                },
                handlerId: "compensation:forbidden",
                kind: ROW_INSERT_KIND,
            },
        ]),
        sourceSessionId: source.session_id,
        target: { stepCount: source.steps.length - 1 },
    });
    assert.equal(invoked, 0);
    assert.deepEqual(readCompensationLog(worldPath).get(compensationId), {
        deleted: 1,
        invocations: 1,
    });
    assert.equal(inspectEffectCompensation(store, { compensationId }).attempts.length, 1);
});

async function runUntil(
    context: TestContext,
    args: readonly string[],
    line: string,
): Promise<ChildProcess> {
    const child = spawn(process.execPath, [FIXTURE, ...args], {
        stdio: ["ignore", "pipe", "pipe"],
    });
    context.after(() => {
        if (child.exitCode === null && child.signalCode === null) {
            child.kill("SIGKILL");
        }
    });
    let output = "";
    let errors = "";
    child.stderr?.on("data", (chunk: Buffer) => {
        errors += chunk.toString();
    });
    while (!output.split("\n").includes(line)) {
        const [chunk] = (await Promise.race([
            once(child.stdout as NonNullable<typeof child.stdout>, "data"),
            once(child, "exit").then(() => {
                throw new Error(`fixture exited before ${line}: ${errors}`);
            }),
        ])) as [Buffer];
        output += chunk.toString();
    }
    return child;
}

async function kill(child: ChildProcess): Promise<void> {
    const exit = once(child, "exit");
    assert.equal(child.kill("SIGKILL"), true);
    const [, signal] = (await exit) as [number | null, NodeJS.Signals | null];
    assert.equal(signal, "SIGKILL");
}
