import {
    createEffectReconciliationAuthority,
    isPublicError,
    type ReconcileEffectOptions,
    reconcileEffect,
    SQLiteTraceStore,
} from "../../src/index.ts";

const [databasePath, payloadText, mode] = process.argv.slice(2);
if (databasePath === undefined || payloadText === undefined || mode === undefined)
    throw new Error("missing fixture arguments");
const payload = JSON.parse(payloadText) as {
    readonly actorId: string;
    readonly policyId: string;
    readonly command: Omit<ReconcileEffectOptions, "authority">;
};
using store = new SQLiteTraceStore(databasePath);
const authority = createEffectReconciliationAuthority({
    actorId: payload.actorId,
    policyId: payload.policyId,
    authorize: async () => {
        if (mode === "hold") {
            process.send?.({ kind: "ready" });
            await new Promise<void>((resolve) => process.once("message", () => resolve()));
        }
        return true;
    },
    verifyCompletion: () => false,
});
const append = store.appendEffectReconciliationRecord.bind(store);
if (mode === "before" || mode === "after")
    store.appendEffectReconciliationRecord = (...args) => {
        if (mode === "before") process.kill(process.pid, "SIGKILL");
        const receipt = append(...args);
        process.kill(process.pid, "SIGKILL");
        return receipt;
    };
try {
    const receipt = await reconcileEffect(store, { ...payload.command, authority });
    process.send?.({ kind: "ok", receipt });
} catch (error) {
    process.send?.({
        kind: "error",
        name: error instanceof Error ? error.name : "unknown",
        code: isPublicError(error) ? error.code : null,
    });
} finally {
    process.disconnect?.();
}
