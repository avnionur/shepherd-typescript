import {
    captureTaskWorldDurably,
    createRetainedWorldRunner,
    executeTask,
    SQLiteTraceStore,
    WORLD_EFFECT_PHASES,
} from "../../src/index.ts";
import { openWorldEffectFixture } from "../workspace/world-effect-fixtures.ts";

const [stage, workspaceRoot] = process.argv.slice(2);
if ((stage !== "before" && stage !== "after") || workspaceRoot === undefined)
    throw new TypeError("world-effect process fixture arguments are invalid");
const [, intentPhase, , outcomePhase] = WORLD_EFFECT_PHASES;
class InterruptedWorldOperationStore extends SQLiteTraceStore {
    override appendDurableExecutionTerminal(
        ...args: Parameters<SQLiteTraceStore["appendDurableExecutionTerminal"]>
    ): ReturnType<SQLiteTraceStore["appendDurableExecutionTerminal"]> {
        const phases = args[3].batch.groups.flatMap((group) =>
            group.records
                .filter((record) => record.body.world_effect_version !== undefined)
                .map((record) => record.body.phase),
        );
        if (stage === "after" && phases.includes(outcomePhase))
            process.kill(process.pid, "SIGKILL");
        const retained = super.appendDurableExecutionTerminal(...args);
        if (stage === "before" && phases.includes(intentPhase))
            process.kill(process.pid, "SIGKILL");
        return retained;
    }
}
const fixture = await openWorldEffectFixture(workspaceRoot);
using store = new InterruptedWorldOperationStore(fixture.storePath);
const runner = createRetainedWorldRunner({
    enforcement: "advisory",
    runnerId: "crash-world-effect",
    run: async (context) => {
        await context.world.writeText("value.txt", "changed");
        return executeTask(context.execution);
    },
});
await captureTaskWorldDurably({ ...fixture.options, runner, store });
throw new Error("world-effect process fixture missed its interruption boundary");
