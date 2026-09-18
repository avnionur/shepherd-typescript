import { writeSync } from "node:fs";

import {
    runCounterfactualOptimization,
    runTreeRlRollouts,
    SQLiteTraceStore,
} from "../../src/index.ts";
import { replayCrashOptions } from "../applications/replay-crash-fixtures.ts";

const [databasePath, application, commandId, haltAt] = process.argv.slice(2);
if (
    databasePath === undefined ||
    commandId === undefined ||
    (application !== "tree_rl" && application !== "counterfactual_optimization") ||
    !/^[1-9][0-9]*$/u.test(haltAt ?? "")
) {
    throw new TypeError(
        "applications replay process fixture requires a path, an application, a command, and a terminal ordinal",
    );
}

function block(): void {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
}

/**
 * Store that reports the replay session about to receive its Nth terminal record of this process,
 * then blocks before appending it until the parent kills the process, so that session keeps its
 * steps and its writer lease but never reaches a terminal record.
 */
class HaltingStore extends SQLiteTraceStore {
    terminals = 0;

    override appendReplaySessionRecord(
        ...args: Parameters<SQLiteTraceStore["appendReplaySessionRecord"]>
    ): ReturnType<SQLiteTraceStore["appendReplaySessionRecord"]> {
        if (args[3].terminal) {
            this.terminals += 1;
            if (this.terminals === Number(haltAt)) {
                writeSync(1, `halted ${args[0]}\n`);
                block();
            }
        }
        return super.appendReplaySessionRecord(...args);
    }
}

const store = new HaltingStore(databasePath);
const options = await replayCrashOptions(store, application, commandId);
if (options.kind === "tree_rl") {
    await runTreeRlRollouts(store, options.options);
} else {
    await runCounterfactualOptimization(store, options.options);
}
