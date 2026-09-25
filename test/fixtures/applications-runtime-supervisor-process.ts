import { writeSync } from "node:fs";

import { encodeToolTurnRequest } from "../../src/agent/bindings.ts";
import { applicationDigest } from "../../src/applications/records.ts";
import { runRuntimeSupervisor, SQLiteTraceStore } from "../../src/index.ts";
import {
    CRASH_CLOCK,
    CRASH_COMMAND,
    CRASH_DECISIONS,
    CRASH_SUPERVISOR,
    crashWorkers,
    discardWorkers,
    reopenSupervisorWorld,
    SETTLEMENT_COMMAND,
    SETTLEMENT_DECISIONS,
} from "../applications/runtime-supervisor-crash-fixtures.ts";
import { runtimeProtocol, until } from "../applications/runtime-supervisor-fixtures.ts";

const [workspaceRoot, databasePath, parentScopeId, mode = "tick"] = process.argv.slice(2);
if (workspaceRoot === undefined || databasePath === undefined || parentScopeId === undefined) {
    throw new TypeError(
        "runtime supervisor process fixture requires a workspace, a database, and a parent scope",
    );
}

/** Blocks the process until the parent kills it. */
function block(): never {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
    throw new Error("unreachable");
}

if (mode === "settlement") {
    // Both workers are discarded at tick 1; settlement then discards both abandoned custodies, and
    // the process reports the first completed discard and blocks before the second.
    const settling = discardWorkers();
    const store = new SQLiteTraceStore(databasePath);
    const world = reopenSupervisorWorld(workspaceRoot, store, parentScopeId);
    let ticks = 0;
    await runRuntimeSupervisor(store, {
        clock: CRASH_CLOCK,
        commandId: SETTLEMENT_COMMAND,
        policy: ({ tick }) => ({
            output: { decisions: tick === 1 ? SETTLEMENT_DECISIONS : [] },
            usage: null,
        }),
        protocol: runtimeProtocol(),
        supervisorId: CRASH_SUPERVISOR,
        wait: async () => {
            ticks += 1;
            if (ticks === 1) {
                await until(
                    () => settling.requests.a.length === 2 && settling.requests.b.length === 2,
                    "both workers mid-turn",
                );
            } else {
                await new Promise((resolve) => setTimeout(resolve, 5));
            }
        },
        workers: settling.workers,
        world: {
            ...world,
            discard: async (request) => {
                await world.discard(request);
                writeSync(1, `discarded ${request.custodyId}\n`);
                return block();
            },
        },
    });
    throw new Error("the settlement scenario must be killed before it returns");
}

const scenario = crashWorkers(true);

/**
 * Store that, once tick 1 is retained, reports the digest of worker a's in-flight second request
 * and blocks before any tick 1 decision is applied, until the parent kills the process.
 */
class CrashAfterTickStore extends SQLiteTraceStore {
    override appendApplicationRecord(
        ...args: Parameters<SQLiteTraceStore["appendApplicationRecord"]>
    ): ReturnType<SQLiteTraceStore["appendApplicationRecord"]> {
        const appended = super.appendApplicationRecord(...args);
        const body = args[2].batch.groups[0]?.records[0]?.body as { readonly phase?: string };
        if (body.phase === "tick") {
            const inFlight = scenario.requests.a[1];
            if (inFlight === undefined) {
                throw new Error("worker a has no in-flight second request");
            }
            writeSync(1, `tick ${applicationDigest(encodeToolTurnRequest(inFlight).input)}\n`);
            block();
        }
        return appended;
    }
}

const store = new CrashAfterTickStore(databasePath);
await runRuntimeSupervisor(store, {
    clock: CRASH_CLOCK,
    commandId: CRASH_COMMAND,
    policy: () => ({ output: { decisions: CRASH_DECISIONS }, usage: null }),
    protocol: runtimeProtocol(),
    supervisorId: CRASH_SUPERVISOR,
    // Tick 1 fires only once both workers are mid-turn after retaining their first turn.
    wait: () =>
        until(
            () => scenario.requests.a.length === 2 && scenario.requests.b.length === 2,
            "both workers mid-turn",
        ),
    workers: scenario.workers,
    world: reopenSupervisorWorld(workspaceRoot, store, parentScopeId),
});
