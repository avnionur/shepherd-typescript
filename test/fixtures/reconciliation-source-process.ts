import {
    createEffectHandlerStack,
    deriveReplaySessionId,
    runReplaySession,
    SQLiteTraceStore,
} from "../../src/index.ts";
import { ROW_INSERT_KIND, rowInsertHandlers, rowProgram } from "../effect/compensation-fixtures.ts";

const [databasePath, worldPath] = process.argv.slice(2);
if (databasePath === undefined || worldPath === undefined) throw new Error("missing fixture paths");
using store = new SQLiteTraceStore(databasePath);
const handlers = rowInsertHandlers(worldPath);
await runReplaySession(store, {
    commandId: "uncertain-source",
    claimId: "source",
    programId: "uncertain-source",
    program: rowProgram([["a", "compensable"]]),
    handlers: createEffectHandlerStack([
        {
            handlerId: "interrupted",
            kind: ROW_INSERT_KIND,
            handle: async (intent) => {
                const dispatch = await handlers.dispatch(intent);
                process.send?.({
                    kind: "world_changed",
                    sessionId: deriveReplaySessionId("uncertain-source"),
                });
                await new Promise<void>((resolve) => process.once("message", () => resolve()));
                return dispatch.outcome.result;
            },
        },
    ]),
});
