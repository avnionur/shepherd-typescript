import { once } from "node:events";
import { writeSync } from "node:fs";
import { createInterface } from "node:readline";

import { createSQLiteStorageCoordinator } from "../../src/facades/operations.ts";

const [databasePath, worker, iterationText, ttlText, nowText] = process.argv.slice(2);
if (
    databasePath === undefined ||
    worker === undefined ||
    iterationText === undefined ||
    ttlText === undefined ||
    nowText === undefined
) {
    throw new TypeError("database path, worker, iterations, ttl, and clock are required");
}
const iterations = Number(iterationText);
const ttl = Number(ttlText);
const now = Number(nowText);
const pause = new Int32Array(new SharedArrayBuffer(4));

using coordinator = createSQLiteStorageCoordinator(databasePath);
const input = createInterface({ input: process.stdin });
writeSync(1, "ready\n");
await once(input, "line");
input.close();

const lease = await coordinator.acquireLease("race/lease", worker, ttl, now);
const generations: number[] = [];
let conflicts = 0;
for (let iteration = 0; iteration < iterations; iteration += 1) {
    for (;;) {
        const current = await coordinator.readRef("race/counter");
        // Widen the read-to-swap window so competing processes observe the same generation.
        Atomics.wait(pause, 0, 0, 2);
        const result = await coordinator.compareAndSwapRef(
            "race/counter",
            current?.generation ?? 0,
            `${worker}:${iteration}`,
        );
        if (result.status === "swapped") {
            generations.push(result.ref.generation);
            break;
        }
        conflicts += 1;
    }
}
const fenced = await coordinator.compareAndSwapRef("race/fenced", 0, worker, {
    fencingToken: lease.lease.fencingToken,
    key: "race/lease",
    now,
    owner: worker,
});
writeSync(
    1,
    `${JSON.stringify({
        conflicts,
        fenced: fenced.status,
        generations,
        lease: lease.status,
        owner: lease.lease.owner,
        token: lease.lease.fencingToken,
        worker,
    })}\n`,
);
