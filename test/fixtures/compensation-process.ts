import { writeSync } from "node:fs";

import { compensateEffects, SQLiteTraceStore } from "../../src/index.ts";
import { rowCompensation } from "../effect/compensation-fixtures.ts";

// Compensates one prepared effect and then stops at a chosen point until it is killed:
// `after-world-change` inside the handler after the row deletion committed but before the outcome
// is retained, and `after-outcome` after the compensation returned.
const [mode, databasePath, worldPath, recordId] = process.argv.slice(2);
if (
    mode === undefined ||
    databasePath === undefined ||
    worldPath === undefined ||
    recordId === undefined
) {
    throw new TypeError("compensation fixture requires mode, database, world, and record");
}
const store = new SQLiteTraceStore(databasePath);
const hang = () => new Promise<never>(() => {});
const report = (line: string) => writeSync(1, `${line}\n`);

await compensateEffects(store, {
    commandId: `compensate:${mode}`,
    effectRecordIds: [recordId],
    registry: rowCompensation(worldPath, [], async () => {
        if (mode === "after-world-change") {
            report("compensating");
            await hang();
        }
    }),
});
report("compensated");
await hang();
