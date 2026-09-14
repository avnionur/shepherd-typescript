import { supervisionProtocolConfig } from "../protocol/config.ts";
import {
    SUPERVISION_SUBSCRIPTION_OVERFLOW_POLICIES,
    SUPERVISION_SUBSCRIPTION_START_POSITIONS,
} from "../protocol/values.generated.ts";
import { assertScopeText, readScopeArray, readScopeDataObject } from "../scope/validation.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import type { OwnerRecord } from "../store/types.ts";
import { SupervisionCursorConflictError, SupervisionSubscriptionOverflowError } from "./errors.ts";
import {
    assertBoundedMilliseconds,
    compareText,
    createTraceSubscriptionCursor,
    readTraceSubscriptionCursor,
} from "./records.ts";
import type {
    OpenTraceSubscriptionOptions,
    TraceSubscription,
    TraceSubscriptionCursor,
    TraceSubscriptionDelivery,
    TraceSubscriptionOverflow,
    TraceSubscriptionStartPosition,
} from "./types.ts";
import { waitFor } from "./wait.ts";

const limits = supervisionProtocolConfig.subscriptions;
const [, FAIL_POLICY] = SUPERVISION_SUBSCRIPTION_OVERFLOW_POLICIES;
const [ORIGIN_POSITION] = SUPERVISION_SUBSCRIPTION_START_POSITIONS;

/**
 * Opens a live cursor subscription over committed records of exact owner paths.
 *
 * A subscription is a read-only projection: it never appends records, and its cursor identity is
 * the canonical vector of next owner ordinals, never delivery order or time. Records are read only
 * when the consumer pulls, so the bounded buffer applies backpressure to the observer and never to
 * writers. Owners are interleaved one record per owner per refill in canonical owner order.
 *
 * A durable subscription (with `subscriptionId`) retains its acknowledged cursor in store
 * bookkeeping outside the record graph and trace export. Reopening it resumes strictly after that
 * cursor: acknowledged records are never redelivered and none is skipped, while delivered but
 * unacknowledged records are delivered again with the same owner ordinals. An ephemeral
 * subscription retains nothing and also works on read-only stores.
 *
 * @param store - Open trace store; durable subscriptions require a writable handle.
 * @param options - Owners, optional durable identity, start, buffer, overflow, poll, and signal.
 * @returns A frozen async-iterable subscription.
 * @throws {SupervisionCursorConflictError} If a durable subscription names different owners, the
 * start cursor differs from the acknowledged cursor, or a cursor passes retained records.
 * @throws {TraceStoreError} If the store is closed or subscription bookkeeping is corrupt.
 * @throws {TypeError} If options are malformed or a durable subscription targets a read-only store.
 *
 * @example
 * ```ts
 * const subscription = openTraceSubscription(store, {
 *     owners: [dispatchId],
 *     subscriptionId: "observer:audit",
 * });
 * for await (const delivery of subscription) {
 *     console.log(delivery.record.envelope.schema_ref);
 *     subscription.acknowledge(delivery.cursor);
 * }
 * ```
 */
export function openTraceSubscription(
    store: SQLiteTraceStore,
    options: OpenTraceSubscriptionOptions,
): TraceSubscription {
    const fields = readScopeDataObject(options, ["owners"], "openTraceSubscription options", [
        "bufferCapacity",
        "overflow",
        "pollIntervalMilliseconds",
        "signal",
        "start",
        "subscriptionId",
    ]);
    const owners = readScopeArray(fields.owners, "owners")
        .map((owner, index) => {
            assertScopeText(owner, `owners[${index}]`);
            return owner;
        })
        .sort(compareText);
    if (
        owners.length === 0 ||
        owners.length > limits.maxOwners ||
        new Set(owners).size !== owners.length
    ) {
        throw new TypeError("owners must be distinct and within the configured owner bound");
    }
    const bufferCapacity = readOptionalBound(
        fields.bufferCapacity,
        limits.defaultBufferCapacity,
        limits.maxBufferCapacity,
        "bufferCapacity",
    );
    const pollIntervalMilliseconds = readOptionalBound(
        fields.pollIntervalMilliseconds,
        limits.pollIntervalMilliseconds,
        supervisionProtocolConfig.interception.maxTimeoutMilliseconds,
        "pollIntervalMilliseconds",
    );
    const overflow = readOverflow(fields.overflow);
    const signal = readSignal(fields.signal);
    const start = readStart(fields.start);
    let subscriptionId: string | null = null;
    let acknowledged: TraceSubscriptionCursor;
    if (fields.subscriptionId === undefined) {
        acknowledged = store.resolveTraceSubscriptionStart(owners, start ?? ORIGIN_POSITION);
    } else {
        assertScopeText(fields.subscriptionId, "subscriptionId");
        if (store.readOnly) {
            throw new TypeError("durable subscriptions require a writable trace store");
        }
        subscriptionId = fields.subscriptionId;
        acknowledged = store.openTraceSubscription(subscriptionId, owners, start);
    }
    return createSubscription(store, {
        acknowledged,
        bufferCapacity,
        overflow,
        owners,
        pollIntervalMilliseconds,
        signal,
        subscriptionId,
    });
}

function createSubscription(
    store: SQLiteTraceStore,
    settings: {
        readonly acknowledged: TraceSubscriptionCursor;
        readonly bufferCapacity: number;
        readonly overflow: TraceSubscriptionOverflow | undefined;
        readonly owners: readonly string[];
        readonly pollIntervalMilliseconds: number;
        readonly signal: AbortSignal | undefined;
        readonly subscriptionId: string | null;
    },
): TraceSubscription {
    const closer = new AbortController();
    const buffer: TraceSubscriptionDelivery[] = [];
    let acknowledged = settings.acknowledged;
    let delivered = settings.acknowledged;
    const readPositions = new Map(
        delivered.positions.map((position) => [position.owner_id, position.next_ordinal]),
    );
    let deliveredRecords = 0;
    let lagRecords = 0;
    let highWaterLagRecords = 0;
    const isClosed = () => closer.signal.aborted || settings.signal?.aborted === true;

    const refill = () => {
        const next = store.readOwnerNextOrdinals(settings.owners);
        lagRecords = delivered.positions.reduce(
            (total, position) =>
                total + ((next.get(position.owner_id) as number) - position.next_ordinal),
            0,
        );
        highWaterLagRecords = Math.max(highWaterLagRecords, lagRecords);
        if (
            settings.overflow?.policy === FAIL_POLICY &&
            lagRecords > settings.overflow.maxLagRecords
        ) {
            closer.abort();
            throw new SupervisionSubscriptionOverflowError(
                lagRecords,
                settings.overflow.maxLagRecords,
            );
        }
        let progressed = true;
        while (progressed && buffer.length < settings.bufferCapacity) {
            progressed = false;
            for (const owner of settings.owners) {
                const ordinal = readPositions.get(owner) as number;
                if (
                    buffer.length === settings.bufferCapacity ||
                    ordinal >= (next.get(owner) as number)
                ) {
                    continue;
                }
                const record: OwnerRecord = store.readOwnerOccurrence(owner, ordinal);
                readPositions.set(owner, ordinal + 1);
                buffer.push(
                    Object.freeze({
                        cursor: createTraceSubscriptionCursor(
                            settings.owners.map((owner_id) => ({
                                next_ordinal: readPositions.get(owner_id) as number,
                                owner_id,
                            })),
                        ),
                        record,
                    }),
                );
                progressed = true;
            }
        }
    };

    const next = async (): Promise<TraceSubscriptionDelivery | undefined> => {
        while (!isClosed()) {
            if (buffer.length === 0) {
                refill();
            }
            const delivery = buffer.shift();
            if (delivery !== undefined) {
                delivered = delivery.cursor;
                deliveredRecords += 1;
                return delivery;
            }
            await waitFor(settings.pollIntervalMilliseconds, [closer.signal, settings.signal]);
        }
        buffer.length = 0;
        return undefined;
    };

    const subscription: TraceSubscription = {
        get acknowledgedCursor() {
            return acknowledged;
        },
        get deliveredCursor() {
            return delivered;
        },
        subscriptionId: settings.subscriptionId,
        acknowledge: (cursor: TraceSubscriptionCursor) => {
            const candidate = readTraceSubscriptionCursor(cursor);
            if (
                candidate.positions.map((position) => position.owner_id).join("\0") !==
                    settings.owners.join("\0") ||
                candidate.positions.some(
                    (position, index) =>
                        position.next_ordinal >
                            (delivered.positions[index] as { readonly next_ordinal: number })
                                .next_ordinal ||
                        position.next_ordinal <
                            (acknowledged.positions[index] as { readonly next_ordinal: number })
                                .next_ordinal,
                )
            ) {
                throw new SupervisionCursorConflictError(
                    settings.subscriptionId,
                    "acknowledgement regresses, passes delivered records, or names other owners",
                );
            }
            acknowledged =
                settings.subscriptionId === null
                    ? candidate
                    : store.acknowledgeTraceSubscription(settings.subscriptionId, candidate);
            return acknowledged;
        },
        close: () => {
            buffer.length = 0;
            closer.abort();
        },
        metrics: () =>
            Object.freeze({
                buffered_records: buffer.length,
                delivered_records: deliveredRecords,
                high_water_lag_records: highWaterLagRecords,
                lag_records: lagRecords,
            }),
        next,
        [Symbol.asyncIterator]: async function* () {
            for (let delivery = await next(); delivery !== undefined; delivery = await next()) {
                yield delivery;
            }
        },
    };
    return Object.freeze(subscription);
}

function readOptionalBound(
    value: unknown,
    fallback: number,
    maximum: number,
    subject: string,
): number {
    if (value === undefined) {
        return fallback;
    }
    assertBoundedMilliseconds(value, maximum, subject);
    return value as number;
}

function readOverflow(value: unknown): TraceSubscriptionOverflow | undefined {
    if (value === undefined) {
        return undefined;
    }
    const fields = readScopeDataObject(value, ["maxLagRecords", "policy"], "overflow");
    if (
        !Number.isSafeInteger(fields.maxLagRecords) ||
        (fields.maxLagRecords as number) < 0 ||
        !SUPERVISION_SUBSCRIPTION_OVERFLOW_POLICIES.includes(
            fields.policy as TraceSubscriptionOverflow["policy"],
        )
    ) {
        throw new TypeError("overflow must declare a configured policy and non-negative lag bound");
    }
    return Object.freeze(fields) as unknown as TraceSubscriptionOverflow;
}

/** Validates an optional abort signal. @internal */
export function readSignal(value: unknown): AbortSignal | undefined {
    if (value !== undefined && !(value instanceof AbortSignal)) {
        throw new TypeError("signal must be an AbortSignal");
    }
    return value;
}

function readStart(
    value: unknown,
): TraceSubscriptionCursor | TraceSubscriptionStartPosition | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (typeof value === "string") {
        if (
            !SUPERVISION_SUBSCRIPTION_START_POSITIONS.includes(
                value as TraceSubscriptionStartPosition,
            )
        ) {
            throw new TypeError("start must be a configured start position or cursor");
        }
        return value as TraceSubscriptionStartPosition;
    }
    return readTraceSubscriptionCursor(value);
}
