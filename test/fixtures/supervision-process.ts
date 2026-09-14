import { writeSync } from "node:fs";

import {
    createEffectHandlerStack,
    dispatchSupervisedEffect,
    openTraceSubscription,
    SQLiteTraceStore,
    type TraceSubscriptionDelivery,
} from "../../src/index.ts";
import { intentOf, interceptor } from "../supervision/fixtures.ts";

const [mode, databasePath, name] = process.argv.slice(2);
if (mode === undefined || databasePath === undefined || name === undefined) {
    throw new TypeError("supervision process fixture requires mode, database path, and name");
}
const store = new SQLiteTraceStore(databasePath);
const hang = () => new Promise<never>(() => {});
const report = (line: string) => writeSync(1, `${line}\n`);

if (mode === "dispatch-deciding") {
    await dispatchSupervisedEffect(store, {
        claimId: "dispatcher:crashed",
        commandId: name,
        handlers: createEffectHandlerStack([
            {
                handle: () => ({ ok: true, value: null }),
                handlerId: "handler:file",
                kind: "file.write",
            },
        ]),
        intent: intentOf(),
        interceptors: [
            interceptor("policy:first", () => ({ decision: "allow" })),
            interceptor(
                "policy:hanging",
                () => {
                    report("deciding");
                    return hang();
                },
                { priority: 1, timeoutMilliseconds: 3_600_000 },
            ),
        ],
    });
} else if (mode === "dispatch-materializing") {
    await dispatchSupervisedEffect(store, {
        claimId: "dispatcher:crashed",
        commandId: name,
        handlers: createEffectHandlerStack([
            {
                handle: () => {
                    report("materializing");
                    return hang();
                },
                handlerId: "handler:file",
                kind: "file.write",
            },
        ]),
        intent: intentOf(),
    });
} else if (mode === "subscribe") {
    const subscription = openTraceSubscription(store, {
        owners: ["worker:a"],
        subscriptionId: name,
    });
    const first = (await subscription.next()) as TraceSubscriptionDelivery;
    const second = (await subscription.next()) as TraceSubscriptionDelivery;
    subscription.acknowledge(first.cursor);
    report(`acknowledged ${String((first.record.body as { label: string }).label)}`);
    report(`delivered ${String((second.record.body as { label: string }).label)}`);
    await hang();
} else {
    throw new TypeError(`unsupported supervision process fixture mode ${mode}`);
}
