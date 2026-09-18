import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { type TestContext, test } from "node:test";

import {
    deriveApplicationOwnerId,
    inspectReplaySession,
    inspectTrajectoryCompression,
    REPLAY_LEASE_LIMITS,
    ReplaySessionInterruptedError,
    runTrajectoryCompression,
    SQLiteTraceStore,
    type TrajectoryCompressorContext,
} from "../../src/index.ts";
import { compressionOptions, compressorOf, forkAt } from "./compression-fixtures.ts";
import { temporaryDatabasePath } from "./fixtures.ts";

const FIXTURE = new URL("../fixtures/applications-compression-process.ts", import.meta.url)
    .pathname;
const RESTORE_SCHEMA = "shepherd.replay.restore.v1";

test("a process killed after the rewind restore and before the suffix replay converges without a second restore", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "compression-crash");
    const commandId = "application:compression:killed";
    new SQLiteTraceStore(databasePath).close();
    const { child, line } = await runUntil(context, [databasePath, commandId], "rewound ");
    await kill(child);
    using store = new SQLiteTraceStore(databasePath);
    const applicationId = deriveApplicationOwnerId(commandId);
    const crashed = inspectTrajectoryCompression(store, applicationId);
    const rewound = crashed.compression.rewound;
    assert.ok(rewound);
    assert.equal(line, `rewound ${rewound.record_id}`);
    assert.equal(crashed.compression.outcome, null);
    assert.equal(crashed.manifest, null);
    const rewindId = rewound.restore?.rewind_session_id as string;
    const rewind = inspectReplaySession(store, { sessionId: rewindId });
    assert.equal(rewind.terminal?.status, "rewound");
    const rewindRecords = store.readOwner(rewindId).length;
    // Only the source and the rewind exist: the suffix replay never started.
    assert.deepEqual(
        [...store.listOwnersBySchema("shepherd.replay.session.v1", 16, 0)].sort(),
        [crashed.source_session_id, rewindId].sort(),
    );
    assert.deepEqual(store.listOwnersBySchema(RESTORE_SCHEMA, 16, 0), [rewindId]);
    const compressorContexts: TrajectoryCompressorContext[] = [];
    const { inspection } = await runTrajectoryCompression(
        store,
        compressionOptions(commandId, { compressor: compressorOf(forkAt(1), compressorContexts) }),
    );
    // The rerun converged through the retained rewind receipt: no second rewind restore, no second
    // compressor run, and the same rewound record.
    assert.deepEqual(compressorContexts, []);
    assert.equal(store.readOwner(rewindId).length, rewindRecords);
    assert.equal(
        store.readOwner(rewindId).filter((record) => record.envelope.schema_ref === RESTORE_SCHEMA)
            .length,
        1,
    );
    assert.equal(inspection.compression.rewound?.record_id, rewound.record_id);
    assert.equal(inspection.compression.outcome?.outcome, "pruned");
    assert.deepEqual(
        [...store.listOwnersBySchema(RESTORE_SCHEMA, 16, 0)].sort(),
        [rewindId, inspection.compression.outcome?.session_id as string].sort(),
    );
    assert.equal(inspection.outcome?.step_count_ratio, 2 / 5);
    assert.equal(store.verifyIntegrity().ok, true);
});

test("a process killed after the rewind's replay restore record and before its terminal converges with one restore", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "compression-restore-crash");
    const commandId = "application:compression:killed-restore";
    new SQLiteTraceStore(databasePath).close();
    const { child, line } = await runUntil(
        context,
        [databasePath, commandId, "restore"],
        "restore ",
    );
    await kill(child);
    const [, rewindId, restoreRecordId] = line.split(" ") as [string, string, string];
    using store = new SQLiteTraceStore(databasePath);
    const applicationId = deriveApplicationOwnerId(commandId);
    const crashed = inspectTrajectoryCompression(store, applicationId);
    assert.ok(crashed.compression.proposed);
    assert.equal(crashed.compression.rewound, null);
    // The rewind retains its replay-level restore record but no terminal record.
    assert.equal(inspectReplaySession(store, { sessionId: rewindId }).terminal, null);
    assert.deepEqual(store.listOwnersBySchema(RESTORE_SCHEMA, 16, 0), [rewindId]);
    const records = store.readOwner(applicationId).length;
    const rewindRecords = store.readOwner(rewindId).length;
    // While the dead writer's lease is live the rewind may still be held: nothing is written.
    await assert.rejects(
        runTrajectoryCompression(store, compressionOptions(commandId)),
        (error: unknown) =>
            error instanceof ReplaySessionInterruptedError &&
            error.session_id === rewindId &&
            error.classification === "running",
    );
    assert.equal(store.readOwner(applicationId).length, records);
    // Once the lease expired, the retained restore record is the rewind evidence: the rerun
    // retains `rewound` from it without a second restore and runs the suffix.
    const expired = 5_000 + REPLAY_LEASE_LIMITS.leaseMilliseconds + 1;
    const options = compressionOptions(commandId, { clock: () => expired });
    const { inspection, manifest } = await runTrajectoryCompression(store, options);
    const rewound = inspection.compression.rewound;
    assert.equal(rewound?.restore?.rewind_session_id, rewindId);
    assert.equal(rewound?.restore?.restore_record_id, restoreRecordId);
    assert.equal(inspection.compression.outcome?.outcome, "pruned");
    assert.equal(inspection.outcome?.step_count_ratio, 2 / 5);
    assert.equal(store.readOwner(rewindId).length, rewindRecords);
    assert.equal(
        inspectReplaySession(store, { clock: () => expired, sessionId: rewindId }).terminal,
        null,
    );
    assert.deepEqual(
        [...store.listOwnersBySchema(RESTORE_SCHEMA, 16, 0)].sort(),
        [rewindId, inspection.compression.outcome?.session_id as string].sort(),
    );
    const rewindArtifact = manifest.artifacts.find(
        (artifact) => artifact.role === "rewind_session",
    );
    assert.equal(rewindArtifact?.record_id, restoreRecordId);
    // The converged run is idempotent and its inspection is stable.
    const repeated = await runTrajectoryCompression(store, options);
    assert.deepEqual(repeated.manifest, manifest);
    assert.deepEqual(repeated.inspection, inspection);
    assert.equal(store.verifyIntegrity().ok, true);
});

async function runUntil(
    context: TestContext,
    args: readonly string[],
    prefix: string,
): Promise<{ readonly child: ChildProcess; readonly line: string }> {
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
    for (;;) {
        const line = output.split("\n").find((candidate) => candidate.startsWith(prefix));
        if (line !== undefined) {
            return { child, line };
        }
        const [chunk] = (await Promise.race([
            once(child.stdout as NonNullable<typeof child.stdout>, "data"),
            once(child, "exit").then(() => {
                throw new Error(`fixture exited before ${prefix}: ${errors}`);
            }),
        ])) as [Buffer];
        output += chunk.toString();
    }
}

async function kill(child: ChildProcess): Promise<void> {
    const exit = once(child, "exit");
    assert.equal(child.kill("SIGKILL"), true);
    const [, signal] = (await exit) as [number | null, NodeJS.Signals | null];
    assert.equal(signal, "SIGKILL");
}
