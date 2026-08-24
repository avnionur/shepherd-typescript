import { readFile } from "node:fs/promises";

import { type OrphanRepairCommand, SQLiteTraceStore } from "../../src/index.ts";

const [databasePath, commandPath, mode] = process.argv.slice(2);
if (databasePath === undefined || commandPath === undefined) {
    throw new TypeError("orphan repair process fixture requires database and command paths");
}
const command = JSON.parse(await readFile(commandPath, "utf8")) as OrphanRepairCommand;
using store = new SQLiteTraceStore(databasePath);
if (mode === "prepare-crash") {
    store.prepareOrphanedOperationRepair(command);
    process.kill(process.pid, "SIGKILL");
}
process.stdout.write(JSON.stringify(store.repairOrphanedOperations(command)));
