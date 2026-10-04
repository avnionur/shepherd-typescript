import {
    compensateEffects,
    createEffectCompensationRegistry,
    SQLiteTraceStore,
} from "../../src/index.ts";
import { compensateRow, ROW_INSERT_KIND } from "../effect/compensation-fixtures.ts";

const [databasePath, worldPath, recordId, mode] = process.argv.slice(2);
if (
    databasePath === undefined ||
    worldPath === undefined ||
    recordId === undefined ||
    mode === undefined
)
    throw new Error("missing process fixture arguments");
using store = new SQLiteTraceStore(databasePath);
if (mode === "before") {
    const renew = store.renewEffectCompensationClaim.bind(store);
    store.renewEffectCompensationClaim = (...args) => {
        renew(...args);
        process.kill(process.pid, "SIGKILL");
    };
}
if (mode === "publication") {
    store.appendEffectCompensationOutcome = () => {
        process.kill(process.pid, "SIGKILL");
        throw new Error("SIGKILL did not terminate fixture");
    };
}
const registry = createEffectCompensationRegistry([
    {
        handlerId: "process-owner",
        kind: ROW_INSERT_KIND,
        compensate: async (request) => {
            const result = compensateRow(worldPath, request);
            if (mode === "after") process.kill(process.pid, "SIGKILL");
            if (mode === "hold") {
                process.send?.({
                    kind: "entered",
                    claimId: request.claimId,
                    fencingToken: request.fencingToken,
                });
                await new Promise<void>((resolve) => process.once("message", () => resolve()));
            }
            return { ok: true, value: result };
        },
    },
]);
try {
    await compensateEffects(store, {
        commandId: `process:${mode}`,
        effectRecordIds: [recordId],
        registry,
    });
    process.send?.({ kind: "done" });
} catch (error) {
    process.send?.({ kind: "error", name: error instanceof Error ? error.name : "unknown" });
} finally {
    process.disconnect?.();
}
