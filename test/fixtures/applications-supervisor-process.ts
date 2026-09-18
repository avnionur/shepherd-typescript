import { writeSync } from "node:fs";

import { runCodingSupervisor, SQLiteTraceStore } from "../../src/index.ts";
import {
    LEAD,
    outputPaths,
    rootParent,
    supervisionProtocol,
    workerOf,
} from "../applications/fixtures.ts";

const [databasePath] = process.argv.slice(2);
if (databasePath === undefined) {
    throw new TypeError("applications supervisor process fixture requires a database path");
}

/** Store that reports the worker claim authority each durable start was published under. */
class ReportingStartStore extends SQLiteTraceStore {
    override appendDurableExecutionStart(
        runId: string,
        claimId: string,
        fencingToken: number,
        nowMilliseconds = Date.now(),
        recoveryCommandRecordId: string | null = null,
    ) {
        const appended = super.appendDurableExecutionStart(
            runId,
            claimId,
            fencingToken,
            nowMilliseconds,
            recoveryCommandRecordId,
        );
        if (appended.status === "committed") {
            writeSync(
                1,
                `started ${runId} ${claimId} ${fencingToken} ${appended.receipt.record_ids[0]}\n`,
            );
        }
        return appended;
    }
}

const store = new ReportingStartStore(databasePath);
await runCodingSupervisor(store, {
    changedPaths: outputPaths,
    commandId: "application:crash",
    parent: rootParent(),
    policy: ({ round }) => (round === 1 ? { kind: "observe" } : { kind: "accept", worker_id: "b" }),
    protocol: supervisionProtocol(),
    supervisorId: LEAD,
    workers: [workerOf("a", () => new Promise<never>(() => {})), workerOf("b")],
});
