import { delegationProtocolConfig } from "../protocol/config.ts";
import { assertPrefixedDigest, readScopeDataObject } from "../scope/validation.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import { openTraceSubscription } from "../supervision/subscription.ts";
import type { OpenTraceSubscriptionOptions, TraceSubscription } from "../supervision/types.ts";
import { assertChildRunHandle } from "./handle.ts";
import { createChildRunId } from "./records.ts";
import type { ObserveChildRunOptions } from "./types.ts";

const SUBSCRIPTION_KEYS = [
    "bufferCapacity",
    "overflow",
    "pollIntervalMilliseconds",
    "signal",
    "start",
    "subscriptionId",
] as const;

/**
 * Opens a trace subscription over one handle owner path and its child run owner path.
 *
 * Observation is the Phase 7 subscription contract applied to the two owners a handle spans: the
 * handle path (opened, context, handoff, approval, completion, and decision records) and the
 * derived child run path (durable creation, start, artifacts, usage, outcome, terminal, and
 * control records). The cursor is the canonical vector of the two owners' next ordinals in
 * canonical owner order; because the child run prefix sorts before the handle prefix, the child
 * run position is first. A durable subscription (`subscriptionId`) resumes strictly after its
 * acknowledged cursor; an ephemeral one retains nothing and works on read-only stores. The handle
 * need not be retained yet when given by identity, so an observer can subscribe before opening.
 *
 * @param store - Open trace store; durable subscriptions require a writable handle.
 * @param options - Exactly one of the authenticated handle or its identity, plus subscription
 * options.
 * @returns A frozen async-iterable subscription.
 * @throws {SupervisionCursorConflictError} If a durable subscription names different owners or
 * its start disagrees with the acknowledged cursor.
 * @throws {TraceStoreError} If the store is closed.
 * @throws {TypeError} If options are malformed.
 *
 * @example
 * ```ts
 * const subscription = observeChildRun(store, { handle, subscriptionId: "observer:lead" });
 * for await (const delivery of subscription) {
 *     console.log(delivery.record.envelope.schema_ref);
 *     subscription.acknowledge(delivery.cursor);
 * }
 * ```
 */
export function observeChildRun(
    store: SQLiteTraceStore,
    options: ObserveChildRunOptions,
): TraceSubscription {
    const fields = readScopeDataObject(options, [], "observeChildRun options", [
        "handle",
        "handleId",
        ...SUBSCRIPTION_KEYS,
    ]);
    if ((fields.handle === undefined) === (fields.handleId === undefined)) {
        throw new TypeError("observeChildRun options must name exactly one of handle or handleId");
    }
    let handleId: string;
    if (fields.handle === undefined) {
        assertPrefixedDigest(
            fields.handleId,
            delegationProtocolConfig.identity.handleIdPrefix,
            "handleId",
        );
        handleId = fields.handleId as string;
    } else {
        assertChildRunHandle(fields.handle, store);
        handleId = fields.handle.handle_id;
    }
    const subscription: Record<string, unknown> = {
        owners: [handleId, createChildRunId(handleId)],
    };
    for (const key of SUBSCRIPTION_KEYS) {
        if (fields[key] !== undefined) {
            subscription[key] = fields[key];
        }
    }
    return openTraceSubscription(store, subscription as unknown as OpenTraceSubscriptionOptions);
}
