import { writeSync } from "node:fs";

import { runReplaySession, SQLiteTraceStore } from "../../src/index.ts";
import { intentOf, requestOf, reviewProvider, worldHandlers } from "../replay/fixtures.ts";

const [mode, databasePath, world] = process.argv.slice(2);
if (mode === undefined || databasePath === undefined || world === undefined) {
    throw new TypeError("replay process fixture requires mode, database path, and world root");
}
const store = new SQLiteTraceStore(databasePath);
const hang = () => new Promise<never>(() => {});
const report = (line: string) => writeSync(1, `${line}\n`);
const handlers = worldHandlers(world);

await runReplaySession(store, {
    claimId: "worker:crashed",
    commandId: `session:${mode}`,
    handlers: {
        dispatch: async (intent) => {
            if (mode === "admitted" && intent.effect_id === "effect:final") {
                report("materializing");
                return hang();
            }
            return handlers.dispatch(intent);
        },
    },
    program: async (context) => {
        const plan = await context.invokeProvider(requestOf(0));
        await context.dispatchEffect(
            intentOf("effect:draft", "file.write", { name: "draft.txt", text: "draft" }),
            { dependsOn: [plan.handle] },
        );
        await context.checkpoint();
        if (mode === "between") {
            report("checkpointed");
            return hang();
        }
        await context.dispatchEffect(
            intentOf("effect:final", "file.write", { name: "final.txt", text: "x" }),
        );
    },
    programId: "program:crash",
    provider: reviewProvider(),
    worlds: [{ name: "main", root: world }],
});
