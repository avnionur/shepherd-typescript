import { writeSync } from "node:fs";

import { runTrajectoryCompression, SQLiteTraceStore } from "../../src/index.ts";
import { compressionOptions } from "../applications/compression-fixtures.ts";

const RESTORE_SCHEMA = "shepherd.replay.restore.v1";
const [databasePath, commandId, stopAt = "rewound"] = process.argv.slice(2);
if (databasePath === undefined || commandId === undefined) {
    throw new TypeError("applications compression process fixture requires a path and command");
}
if (stopAt !== "rewound" && stopAt !== "restore") {
    throw new TypeError("applications compression process fixture stops at rewound or restore");
}

function block(): void {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
}

/**
 * Store that reports either the retained application `rewound` record or the first replay-level
 * restore record (the rewind session's, before its `rewound` terminal), then blocks until the
 * parent kills it.
 */
class HaltingStore extends SQLiteTraceStore {
    override appendApplicationRecord(
        ...args: Parameters<SQLiteTraceStore["appendApplicationRecord"]>
    ): ReturnType<SQLiteTraceStore["appendApplicationRecord"]> {
        const appended = super.appendApplicationRecord(...args);
        const body = args[2].batch.groups[0]?.records[0]?.body as Record<string, unknown>;
        if (stopAt === "rewound" && appended.status === "appended" && body.status === "rewound") {
            writeSync(1, `rewound ${String(appended.receipt.record_ids[0])}\n`);
            block();
        }
        return appended;
    }

    override appendReplaySessionRecord(
        ...args: Parameters<SQLiteTraceStore["appendReplaySessionRecord"]>
    ): ReturnType<SQLiteTraceStore["appendReplaySessionRecord"]> {
        const appended = super.appendReplaySessionRecord(...args);
        const recordId =
            appended.status === "appended" ? appended.receipt.record_ids[0] : undefined;
        if (
            stopAt === "restore" &&
            recordId !== undefined &&
            this.readRecord(recordId)?.envelope.schema_ref === RESTORE_SCHEMA
        ) {
            writeSync(1, `restore ${args[0]} ${String(recordId)}\n`);
            block();
        }
        return appended;
    }
}

const store = new HaltingStore(databasePath);
await runTrajectoryCompression(store, compressionOptions(commandId));
