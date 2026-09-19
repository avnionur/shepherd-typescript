import { readFileSync, writeSync } from "node:fs";
import path from "node:path";

import { backupTraceStore, SQLiteTraceStore } from "../../src/index.ts";
import {
    appendRequestFor,
    blobContentFor,
    cutIdFor,
    type FaultEvent,
    type FaultProcessArguments,
} from "../faults/workload.ts";

// A looping writer for the kill/restart and file-size suites. It reports each operation's start
// and completion as JSON lines on stdout (written synchronously, so a line is on the pipe before
// the next write begins) and runs until it is killed or, with `stopAfterError`, until one
// operation fails.
const args = JSON.parse(process.argv[2] ?? "") as FaultProcessArguments;
const emit = (event: FaultEvent): void => {
    writeSync(1, `${JSON.stringify(event)}\n`);
};

const store = new SQLiteTraceStore(args.databasePath);
const archive = args.archivePath === undefined ? "" : readFileSync(args.archivePath, "utf8");
emit({ event: "ready" });

async function step(index: number): Promise<void> {
    switch (args.operation) {
        case "append":
            store.append(appendRequestFor(args.seed, args.label, index));
            return;
        case "blob":
            store.putBlob(blobContentFor(args.seed, args.label, index));
            return;
        case "cut": {
            const request = appendRequestFor(args.seed, `${args.label}:cut`, index);
            const receipt = store.append(request);
            store.publishCut({
                cut_id: cutIdFor(args.label, index),
                target_owner_id: request.batch.groups[0]?.owner_id as string,
                through_record_id: receipt.record_ids.at(-1) as string,
            });
            return;
        }
        case "import": {
            const target = new SQLiteTraceStore(
                path.join(args.importRoot as string, `${args.label}-${index}.sqlite`),
            );
            try {
                target.importTrace(archive);
            } finally {
                target.close();
            }
            return;
        }
        case "backup":
            store.append(appendRequestFor(args.seed, `${args.label}:backup`, index));
            await backupTraceStore(store, {
                destination: path.join(args.backupRoot as string, `${args.label}-${index}`),
            });
            return;
        case "vacuum":
            store.append(appendRequestFor(args.seed, `${args.label}:vacuum`, index));
            store.maintain({ mode: "vacuum" });
            return;
    }
}

for (let index = 0; ; index += 1) {
    emit({ event: "start", index });
    try {
        await step(index);
    } catch (error) {
        if (args.stopAfterError !== true) throw error;
        const failure = error as Error & { code?: unknown; errcode?: unknown };
        emit({
            code: typeof failure.code === "string" ? failure.code : null,
            errcode: typeof failure.errcode === "number" ? failure.errcode : null,
            event: "error",
            index,
            message: failure.message,
            name: failure.constructor.name,
        });
        store.close();
        process.exit(0);
    }
    emit({ event: "done", index });
}
