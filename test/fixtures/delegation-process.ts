import { writeSync } from "node:fs";

import {
    executeTaskDurably,
    openChildRun,
    runChildRun,
    SQLiteTraceStore,
} from "../../src/index.ts";
import { echoTask, openOptions, providerFor } from "../delegation/fixtures.ts";

const [mode, databasePath] = process.argv.slice(2);
if (mode === undefined || databasePath === undefined) {
    throw new TypeError("delegation process fixture requires mode and database path");
}

/** Store that reports the worker claim authority the durable start was published under. */
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
            report(`started ${claimId} ${fencingToken} ${appended.receipt.record_ids[0]}`);
        }
        return appended;
    }
}

const store = new ReportingStartStore(databasePath);
const hang = () => new Promise<never>(() => {});
const { handle } = openChildRun(store, openOptions(`delegate:${mode}`));

if (mode === "before-terminal") {
    await runChildRun(store, { handle, program: hang });
} else {
    await executeTaskDurably(store, {
        budget: handle.budget.effective,
        input: "hello",
        provider: providerFor(echoTask, "hello", "terminal before completion"),
        runId: handle.child_run_id,
        task: echoTask,
    });
    report("terminal");
    await hang();
}

function report(line: string): void {
    writeSync(1, `${line}\n`);
}
