import path from "node:path";
import {
    canonicalizeRecord,
    createRecordId,
    type SemanticRecord,
} from "../canonical/canonical-record.ts";
import { createCanonicalSnapshot } from "../canonical/snapshot.ts";
import { recordIdConfig, workspaceProtocolConfig } from "../protocol/config.ts";
import { RECORD_MODES } from "../protocol/values.generated.ts";
import { assertRecordId } from "../record/guards.ts";
import { ROOT_WITNESS_ID } from "../record/root-witness.ts";
import type { RecordBody, RecordId } from "../record/types.ts";
import { assertPrefixedDigest, assertScopeText, readScopeDataObject } from "../scope/validation.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import type { StoreAppendRequest } from "../store/types.ts";
import type { DeviceLayerCompaction, DeviceLayerDepthPolicy } from "./device-layer-types.ts";
import type { DeviceDirectoryIdentity, RetainedDeviceTree } from "./retained-device-files.ts";
import { planRetainedDeviceCommand, planRetainedDeviceCreation } from "./retained-device-plans.ts";

const config = workspaceProtocolConfig.deviceLayers.retained;
const [CAPTURE] = RECORD_MODES;
// readOwner authenticates every body/envelope on every read. Cache only semantic validation of an
// unchanged authenticated prefix; filesystem ownership and bytes are always checked separately.
const validatedPrefixes = new WeakMap<
    SQLiteTraceStore,
    Map<string, { readonly ids: readonly RecordId[]; readonly head: RetainedDeviceHead }>
>();

/** Tree planned for publication; identity is filled only after complete verification. @internal */
export type PlannedDeviceTree = Omit<RetainedDeviceTree, "identity" | "payload_identity"> & {
    readonly identity: DeviceDirectoryIdentity | null;
    readonly payload_identity: DeviceDirectoryIdentity | null;
};
/** Named frozen full-view layer. @internal */
export type RetainedDeviceLayer = {
    readonly checkpoint: string;
    readonly layer: string;
    readonly tree: PlannedDeviceTree;
};
/** Durable logical and physical state of one locally owned device. @internal */
export type RetainedDeviceState = {
    readonly adapter: string;
    readonly configuration_id: string;
    readonly root: string;
    readonly parent_identity: DeviceDirectoryIdentity;
    readonly root_identity: DeviceDirectoryIdentity | null;
    readonly layers_identity: DeviceDirectoryIdentity | null;
    readonly ownership_key: string;
    readonly depth: DeviceLayerDepthPolicy;
    readonly generation: number;
    readonly ordinal: number;
    readonly layers: readonly RetainedDeviceLayer[];
    readonly retired: readonly string[];
    readonly writable: PlannedDeviceTree | null;
    readonly garbage: readonly RetainedDeviceTree[];
    readonly cleaned: boolean;
};
/** Deterministic verified-copy stage. @internal */
export type DeviceTreeCopy = {
    readonly source: string | null;
    readonly target: string;
    readonly content_id: string;
};
/** Exact operation prepared before physical work. @internal */
export type RetainedDevicePlan = {
    readonly copies: readonly DeviceTreeCopy[];
    readonly next: RetainedDeviceState;
    readonly checkpoint: string | null;
    readonly layer: string | null;
    readonly discarded: readonly string[];
    readonly compaction: DeviceLayerCompaction | null;
};
/** Canonical lifecycle record carried on the device and command owners. @internal */
export type RetainedDeviceJournal = {
    readonly compatibility_version: string;
    readonly record_version: number;
    readonly device_id: string;
    readonly command_id: string;
    readonly operation: string;
    readonly phase: string;
    readonly request: SemanticRecord;
    readonly state: RetainedDeviceState;
    readonly plan: RetainedDevicePlan | null;
    readonly recovery: {
        readonly command_id: string;
        readonly expected_head_record_id: RecordId;
    } | null;
};
/** Retained journal record paired with its content identity. @internal */
export type RetainedDeviceHead = {
    readonly recordId: RecordId;
    readonly body: RetainedDeviceJournal;
};

/**
 * Derives the stable device identity before creation, so interrupted creation remains diagnosable.
 * The identity is scoped to its trace store; it does not authorize physical resource access.
 * @param commandId - Exact creation command identity.
 * @returns Content-derived device owner identity.
 * @throws {TypeError} If the command identity is empty or malformed.
 * @example
 * const deviceId = deriveRetainedDeviceLayerId("create-worker-world");
 */
export function deriveRetainedDeviceLayerId(commandId: string): string {
    assertScopeText(commandId, "device creation command");
    return (
        config.ownerIdPrefix +
        createRecordId({ command_id: commandId }).slice(recordIdConfig.prefix.length)
    );
}

/** Binds the exact device, materializer and durable configuration. @internal */
export function retainedDeviceConfigurationId(): string {
    return (
        config.configurationIdPrefix +
        createRecordId({
            device: workspaceProtocolConfig.deviceLayers as unknown as SemanticRecord,
            backends: workspaceProtocolConfig.carrierBackends as unknown as SemanticRecord,
        }).slice(recordIdConfig.prefix.length)
    );
}

/** Reads one exact canonical journal head; an absent device is an explicit refusal. @internal */
export function readRetainedDeviceHead(
    store: SQLiteTraceStore,
    deviceId: string,
): RetainedDeviceHead {
    assertPrefixedDigest(deviceId, config.ownerIdPrefix, "retained device identity");
    const records = store.readOwner(deviceId);
    const last = records.at(-1);
    if (last === undefined) throw new TypeError("retained device journal is absent");
    const cache =
        validatedPrefixes.get(store) ??
        new Map<string, { readonly ids: readonly RecordId[]; readonly head: RetainedDeviceHead }>();
    const retained = cache.get(deviceId);
    const reusable =
        retained !== undefined &&
        retained.ids.length <= records.length &&
        retained.ids.every((id, index) => records[index]?.envelope.record_id === id);
    let previous: RecordId = reusable ? retained.head.recordId : ROOT_WITNESS_ID;
    let prior: RetainedDeviceJournal | null = reusable ? retained.head.body : null;
    for (const record of records.slice(reusable ? retained.ids.length : 0)) {
        if (
            record.envelope.schema_ref !== config.traceSchema ||
            record.envelope.mode !== CAPTURE ||
            record.envelope.caused_by_record_ids.length !== 1 ||
            record.envelope.caused_by_record_ids[0] !== previous
        )
            throw new TypeError("retained device journal causality is inconsistent");
        const body = readRetainedDeviceJournal(record.body);
        if (body.device_id !== deviceId)
            throw new TypeError("retained device journal owner differs");
        assertDeviceJournalTransition(prior, body, previous);
        prior = body;
        previous = record.envelope.record_id;
    }
    const head = Object.freeze({
        recordId: last.envelope.record_id,
        body: prior as RetainedDeviceJournal,
    });
    cache.set(deviceId, { ids: records.map((record) => record.envelope.record_id), head });
    validatedPrefixes.set(store, cache);
    return head;
}

/** Validates closed, versioned lifecycle structure before any filesystem use. @internal */
export function readRetainedDeviceJournal(value: RecordBody): RetainedDeviceJournal {
    const fields = readScopeDataObject(
        value,
        [
            "compatibility_version",
            "record_version",
            "device_id",
            "command_id",
            "operation",
            "phase",
            "request",
            "state",
            "plan",
            "recovery",
        ],
        "retained device journal",
    );
    if (
        fields.compatibility_version !== config.compatibilityVersion ||
        fields.record_version !== config.recordVersion ||
        !Object.values(config.actions).includes(fields.operation as string) ||
        !Object.values(config.phases).includes(fields.phase as string)
    )
        throw new TypeError("retained device journal version or phase is incompatible");
    assertPrefixedDigest(fields.device_id, config.ownerIdPrefix, "device identity");
    assertScopeText(fields.command_id, "device command identity");
    if (fields.recovery !== null) {
        const recovery = readScopeDataObject(
            fields.recovery,
            ["command_id", "expected_head_record_id"],
            "device recovery admission",
        );
        assertScopeText(recovery.command_id, "recovery command identity");
        assertRecordId(recovery.expected_head_record_id, "recovery head identity");
    }
    readScopeDataObject(fields.request, Object.keys(fields.request as object), "device request");
    const state = readScopeDataObject(
        fields.state,
        [
            "adapter",
            "configuration_id",
            "root",
            "parent_identity",
            "root_identity",
            "layers_identity",
            "ownership_key",
            "depth",
            "generation",
            "ordinal",
            "layers",
            "retired",
            "writable",
            "garbage",
            "cleaned",
        ],
        "retained device state",
    );
    for (const key of ["adapter", "configuration_id", "root", "ownership_key"])
        assertScopeText(state[key], key);
    for (const key of ["generation", "ordinal"])
        if (!Number.isSafeInteger(state[key]) || (state[key] as number) < 0)
            throw new TypeError("retained device ordinal is invalid");
    if (
        !Array.isArray(state.layers) ||
        !Array.isArray(state.retired) ||
        !Array.isArray(state.garbage) ||
        typeof state.cleaned !== "boolean"
    )
        throw new TypeError("retained device state collections are invalid");
    // Physical path, identity, depth and tree validation is shared with the filesystem admission.
    return createCanonicalSnapshot(fields as SemanticRecord) as unknown as RetainedDeviceJournal;
}

/** Creates a causally chained append also indexed by globally exact command owner. @internal */
export function retainedDeviceAppend(
    body: RetainedDeviceJournal,
    previous: RecordId | null,
): StoreAppendRequest {
    const record = {
        body: body as unknown as RecordBody,
        mode: CAPTURE,
        schema_ref: config.traceSchema,
        witness_ref: ROOT_WITNESS_ID,
        caused_by_record_ids: [previous ?? ROOT_WITNESS_ID],
    };
    return {
        append_intent_id: createRecordId({
            device_command: body.command_id,
            phase: body.phase,
            body: createRecordId(body as unknown as SemanticRecord),
        }),
        batch: {
            groups: [
                { owner_id: config.commandOwnerPrefix + body.command_id, records: [record] },
                { owner_id: body.device_id, records: [record] },
                ...(body.recovery === null
                    ? []
                    : [
                          {
                              owner_id: config.commandOwnerPrefix + body.recovery.command_id,
                              records: [record],
                          },
                      ]),
            ],
        },
    };
}

function equalJournalValue(left: unknown, right: unknown): boolean {
    return (
        canonicalizeRecord({ value: left } as SemanticRecord) ===
        canonicalizeRecord({ value: right } as SemanticRecord)
    );
}

function immutableDeviceHeader(state: RetainedDeviceState): SemanticRecord {
    return {
        adapter: state.adapter,
        configuration_id: state.configuration_id,
        root: state.root,
        parent_identity: state.parent_identity,
        ownership_key: state.ownership_key,
        depth: state.depth,
    } as unknown as SemanticRecord;
}

function assertDeviceJournalTransition(
    previous: RetainedDeviceJournal | null,
    body: RetainedDeviceJournal,
    previousId: RecordId,
): void {
    const plan = body.plan;
    if (plan === null) throw new TypeError("retained device journal requires a deterministic plan");
    readScopeDataObject(
        plan,
        ["copies", "next", "checkpoint", "layer", "discarded", "compaction"],
        "retained device plan",
    );
    if (
        !Array.isArray(plan.copies) ||
        !Array.isArray(plan.discarded) ||
        !equalJournalValue(immutableDeviceHeader(body.state), immutableDeviceHeader(plan.next))
    )
        throw new TypeError("retained device plan changes immutable ownership");
    if (previous === null || body.command_id !== previous.command_id) {
        if (body.phase !== config.phases.prepared || body.recovery !== null)
            throw new TypeError("retained device command must begin with preparation");
        let expected: RetainedDevicePlan;
        if (previous === null) {
            const state = body.state;
            const seed = body.request.seed;
            if (
                body.operation !== config.actions.open ||
                deriveRetainedDeviceLayerId(body.command_id) !== body.device_id ||
                state.root_identity !== null ||
                state.layers_identity !== null ||
                state.generation !== 0 ||
                state.ordinal !== 1 ||
                state.layers.length !== 0 ||
                state.retired.length !== 0 ||
                state.garbage.length !== 0 ||
                state.writable !== null ||
                state.cleaned ||
                (seed !== null && (typeof seed !== "string" || !path.isAbsolute(seed))) ||
                !equalJournalValue(body.request, {
                    operation: config.actions.open,
                    root: path.dirname(state.root),
                    seed,
                    adapter: state.adapter,
                    depth: state.depth,
                    configuration_id: state.configuration_id,
                })
            )
                throw new TypeError("retained device creation evidence is inconsistent");
            expected = planRetainedDeviceCreation(
                state,
                seed as string | null,
                plan.copies[0]?.content_id as string,
            );
        } else {
            if (
                previous.phase !== config.phases.completed ||
                previous.state.cleaned ||
                !equalJournalValue(previous.state, body.state) ||
                !equalJournalValue(body.request, {
                    operation: body.operation,
                    device_id: body.device_id,
                    name: plan.checkpoint,
                })
            )
                throw new TypeError("retained device command basis is inconsistent");
            expected = planRetainedDeviceCommand(
                body.state,
                body.operation,
                plan.checkpoint ?? undefined,
                plan.copies[0]?.content_id ?? null,
            );
        }
        if (!equalJournalValue(plan, expected))
            throw new TypeError("retained device plan contradicts the requested transition");
        return;
    }
    if (
        body.operation !== previous.operation ||
        !equalJournalValue(body.request, previous.request) ||
        !equalJournalValue(plan, previous.plan)
    )
        throw new TypeError("retained device operation identity changed during recovery");
    if (body.phase === previous.phase) {
        if (
            body.phase === config.phases.completed ||
            body.recovery === null ||
            body.recovery.command_id === body.command_id ||
            body.recovery.command_id === previous.recovery?.command_id ||
            body.recovery.expected_head_record_id !== previousId ||
            !equalJournalValue(body.state, previous.state)
        )
            throw new TypeError("retained device recovery admission is inconsistent");
        return;
    }
    if (!equalJournalValue(body.recovery, previous.recovery))
        throw new TypeError("retained device recovery identity changed without admission");
    if (previous.phase === config.phases.prepared && body.phase === config.phases.published) {
        const fill = (tree: PlannedDeviceTree): PlannedDeviceTree => {
            const actual = [
                ...body.state.layers.map((layer) => layer.tree),
                ...(body.state.writable === null ? [] : [body.state.writable]),
            ].find((entry) => entry.directory === tree.directory);
            if (
                actual?.identity === null ||
                actual?.identity === undefined ||
                actual.payload_identity === null
            )
                throw new TypeError("retained device publication lacks physical identities");
            return {
                ...tree,
                identity: tree.identity ?? actual.identity,
                payload_identity: tree.payload_identity ?? actual.payload_identity,
            };
        };
        const expected = {
            ...plan.next,
            root_identity: plan.next.root_identity ?? body.state.root_identity,
            layers_identity: plan.next.layers_identity ?? body.state.layers_identity,
            layers: plan.next.layers.map((layer) => ({ ...layer, tree: fill(layer.tree) })),
            writable: plan.next.writable === null ? null : fill(plan.next.writable),
        };
        if (
            body.state.root_identity === null ||
            body.state.layers_identity === null ||
            !equalJournalValue(body.state, expected)
        )
            throw new TypeError("retained device publication contradicts its plan");
    } else if (
        previous.phase === config.phases.published &&
        body.phase === config.phases.completed
    ) {
        if (!equalJournalValue(body.state, { ...previous.state, garbage: [] }))
            throw new TypeError("retained device completion changes published state");
    } else throw new TypeError("retained device journal phase order is invalid");
}
