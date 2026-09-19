import assert from "node:assert/strict";
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { test } from "node:test";

import { createSQLiteStorageCoordinator } from "../../src/facades/operations.ts";
import {
    kernelProtocolConfig,
    storageProtocolConfig,
    taskProtocolConfig,
} from "../../src/protocol/config.ts";

const WORKERS = 4;
const ITERATIONS = 12;
const NOW = 1_000;
const FIRST_OPEN_ROUNDS = 4;
const FIRST_OPEN_KINDS = ["trace-store", "task-registry", "storage-coordinator"] as const;
// Bounds a wedged run: every child blocks on stdin until released, so a failure must never leave
// the file waiting on a child. Generous next to a passing run, far below the runner's own limit.
const RACE_TEST_TIMEOUT_MILLISECONDS = 120_000;

type WorkerReport = {
    readonly conflicts: number;
    readonly fenced: string;
    readonly generations: readonly number[];
    readonly lease: string;
    readonly owner: string;
    readonly token: number;
    readonly worker: string;
};

type Worker = {
    readonly child: ChildProcessWithoutNullStreams;
    readonly exited: Promise<number | null>;
    /** Resolves the next stdout line, failing with the child's stderr if it exits first. */
    readonly nextLine: () => Promise<string>;
};

/**
 * Runs one multi-process scenario and always reaps its children: on any outcome every child
 * still running has its stdin closed and is killed, and the scenario waits for each exit.
 */
async function withWorkers(
    scenario: (start: (fixture: string, args: readonly string[]) => Worker) => Promise<void>,
): Promise<void> {
    const workers: Worker[] = [];
    const start = (fixture: string, args: readonly string[]): Worker => {
        const child = spawn(
            process.execPath,
            [new URL(`../fixtures/${fixture}`, import.meta.url).pathname, ...args],
            { stdio: ["pipe", "pipe", "pipe"] },
        );
        const stderr: Buffer[] = [];
        child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
        // Capture exit at spawn: a listener attached after the child exits never fires.
        const exited = new Promise<number | null>((resolve) => {
            child.once("exit", (code) => resolve(code));
        });
        const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
        const worker: Worker = {
            child,
            exited,
            async nextLine() {
                const line = await lines.next();
                if (line.done === true) {
                    const code = await exited;
                    assert.fail(
                        `worker exited with ${code} before writing a line: ${Buffer.concat(stderr).toString()}`,
                    );
                }
                return String(line.value);
            },
        };
        workers.push(worker);
        return worker;
    };
    try {
        await scenario(start);
    } finally {
        for (const { child } of workers) {
            if (child.exitCode === null && child.signalCode === null) {
                child.stdin.destroy();
                child.kill("SIGKILL");
            }
        }
        await Promise.all(workers.map(({ exited }) => exited));
    }
}

/** Waits for every worker's `ready`, then releases all of them at once. */
async function releaseTogether(workers: readonly Worker[]): Promise<void> {
    for (const ready of await Promise.all(workers.map((worker) => worker.nextLine()))) {
        assert.equal(ready, "ready");
    }
    for (const { child } of workers) {
        child.stdin.end("go\n");
    }
}

/** Reads a worker's final line and requires a clean exit. */
async function finalLine(worker: Worker): Promise<string> {
    const line = await worker.nextLine();
    assert.equal(await worker.exited, 0);
    return line;
}

test("SQLite coordinator serializes compare-and-swap and leases across processes", {
    timeout: RACE_TEST_TIMEOUT_MILLISECONDS,
}, async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-storage-race-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const databasePath = path.join(directory, "coordinator.sqlite");
    const ttl = storageProtocolConfig.leases.maxTtlMilliseconds;
    let reports: WorkerReport[] = [];
    await withWorkers(async (start) => {
        const workers = Array.from({ length: WORKERS }, (_, index) =>
            start("storage-coordinator-process.ts", [
                databasePath,
                `worker-${index}`,
                String(ITERATIONS),
                String(ttl),
                String(NOW),
            ]),
        );
        await releaseTogether(workers);
        reports = (await Promise.all(workers.map(finalLine))).map(
            (line) => JSON.parse(line) as WorkerReport,
        );
    });

    context.diagnostic(
        `compare-and-swap conflicts retried: ${reports.reduce((sum, { conflicts }) => sum + conflicts, 0)}`,
    );
    const holders = reports.filter(({ lease }) => lease === "acquired");
    assert.equal(holders.length, 1, "exactly one process acquires the lease");
    const [holder] = holders as [WorkerReport];
    for (const report of reports) {
        assert.equal(report.token, 1);
        assert.equal(report.owner, holder.worker);
        assert.equal(report.fenced, report.worker === holder.worker ? "swapped" : "fenced");
    }
    const generations = reports.flatMap(({ generations: owned }) => owned).sort((a, b) => a - b);
    assert.deepEqual(
        generations,
        Array.from({ length: WORKERS * ITERATIONS }, (_, index) => index + 1),
        "every generation is committed exactly once",
    );

    using coordinator = createSQLiteStorageCoordinator(databasePath);
    const counter = await coordinator.readRef("race/counter");
    assert.equal(counter?.generation, WORKERS * ITERATIONS);
    const takeover = await coordinator.acquireLease("race/lease", "recovery", ttl, NOW + ttl);
    assert.equal(takeover.status, "acquired");
    assert.equal(takeover.lease.fencingToken, 2);
    const stale = await coordinator.compareAndSwapRef("race/fenced", 1, "stale", {
        fencingToken: 1,
        key: "race/lease",
        now: NOW + ttl,
        owner: holder.worker,
    });
    assert.equal(stale.status, "fenced");
    assert.equal((await coordinator.readRef("race/fenced"))?.value, holder.worker);
});

test("concurrent first opens of one new SQLite database all succeed across processes", {
    timeout: RACE_TEST_TIMEOUT_MILLISECONDS,
}, async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-first-open-race-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const expected: Record<(typeof FIRST_OPEN_KINDS)[number], string> = {
        "storage-coordinator": "opened",
        "task-registry": `opened ${taskProtocolConfig.registry.schemaVersion}`,
        "trace-store": `opened ${kernelProtocolConfig.store.schemaVersion}`,
    };
    for (const kind of FIRST_OPEN_KINDS) {
        for (let round = 0; round < FIRST_OPEN_ROUNDS; round += 1) {
            const databasePath = path.join(directory, `${kind}-${round}.sqlite`);
            await withWorkers(async (start) => {
                const workers = Array.from({ length: WORKERS }, () =>
                    start("sqlite-first-open-process.ts", [kind, databasePath]),
                );
                await releaseTogether(workers);
                assert.deepEqual(
                    await Promise.all(workers.map(finalLine)),
                    Array.from({ length: WORKERS }, () => expected[kind]),
                    `${kind} round ${round}`,
                );
            });
        }
    }
});
