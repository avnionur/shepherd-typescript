import { randomUUID } from "node:crypto";
import {
    closeSync,
    constants,
    fstatSync,
    fsyncSync,
    ftruncateSync,
    lstatSync,
    mkdtempSync,
    openSync,
    readFileSync,
    writeFileSync,
} from "node:fs";
import path from "node:path";
import { ensureDurableDirectory, syncDirectory } from "../blob/directory-durability.ts";
import {
    canonicalizeRecord,
    createRecordId,
    type SemanticRecord,
} from "../canonical/canonical-record.ts";
import { workspaceProtocolConfig } from "../protocol/config.ts";
import { WORLD_ENTRY_KINDS } from "../protocol/values.generated.ts";
import { assertRecordId } from "../record/guards.ts";
import { removePathSync } from "../runtime/remove-path.ts";
import { assertScopeText, readScopeDataObject } from "../scope/validation.ts";
import { AppendIntentConflictError } from "../store/errors.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import { CarrierBackendUnavailableError, openCarrierBackend } from "./carrier-backends.ts";
import { DeviceLayerError } from "./errors.ts";
import {
    assertRetainedDeviceTreeBoundary,
    listRetainedDeviceFiles,
    retainedDeviceFilePath,
    retainedDeviceParent,
    retainedDeviceTreeIdentity,
} from "./retained-device-files.ts";
import type {
    RetainedDeviceLayerCheckpoint,
    RetainedDeviceLayerInspection,
    RetainedDeviceLayerNamedCommand,
    RetainedDeviceLayerRecoveryOptions,
    RetainedDeviceLayerRestore,
    RetainedDeviceLayerSelector,
    RetainedDeviceLayerSnapshot,
    RetainedDeviceLayerWorld,
    RetainedDeviceLayerWorldOptions,
} from "./retained-device-layer-types.ts";
import {
    assertRetainedDevicePending,
    assertRetainedDevicePhysical,
    cleanupRetainedDeviceGarbage,
    materializeRetainedDevicePlan,
    validateRetainedDeviceState,
} from "./retained-device-physical.ts";
import { planRetainedDeviceCommand, planRetainedDeviceCreation } from "./retained-device-plans.ts";
import {
    deriveRetainedDeviceLayerId,
    type PlannedDeviceTree,
    type RetainedDeviceHead,
    type RetainedDeviceJournal,
    type RetainedDevicePlan,
    type RetainedDeviceState,
    readRetainedDeviceHead,
    readRetainedDeviceJournal,
    retainedDeviceAppend,
    retainedDeviceConfigurationId,
} from "./retained-device-records.ts";

const device = workspaceProtocolConfig.deviceLayers;
const config = device.retained;

/**
 * Creates an explicitly retained copy/clone world or reopens an exactly repeated completed creation.
 * The complete source prefix and lifecycle are journaled before physical publication. The store
 * must be file-backed; imported records or a copied database confer no local resource authority.
 * @param store - Writable local trace store owning the lifecycle journal.
 * @param options - Exact creation command, existing parent, optional seed and supported adapter.
 * @returns A durable handle whose close detaches without deleting resources.
 * @throws {TypeError} For malformed, incompatible or interrupted state requiring explicit recovery.
 * @throws {DeviceLayerError} If the selected durable adapter is unsupported or unavailable.
 * @throws {AppendIntentConflictError} If command identity names a different request.
 * @example
 * const world = await openRetainedDeviceLayerWorld(store, { commandId: "create", root });
 * await world.checkpoint({ commandId: "first", name: "first" });
 */
export async function openRetainedDeviceLayerWorld(
    store: SQLiteTraceStore,
    options: RetainedDeviceLayerWorldOptions,
): Promise<RetainedDeviceLayerWorld> {
    const fields = readScopeDataObject(options, ["commandId", "root"], "retained device creation", [
        "adapter",
        "seed",
        "depth",
    ]);
    assertScopeText(fields.commandId, "creation command");
    assertScopeText(fields.root, "device parent");
    const parent = retainedDeviceParent(fields.root);
    const adapter = fields.adapter === undefined ? device.selection.defaultAdapter : fields.adapter;
    if (typeof adapter !== "string" || !Object.values(config.adapters).includes(adapter))
        throw new DeviceLayerError(
            device.errors.unavailableCode,
            "selected adapter has no durable recovery protocol",
        );
    const depth = readScopeDataObject(
        fields.depth === undefined ? {} : fields.depth,
        [],
        "retained device depth",
        ["maxDepth", "retainNewest"],
    );
    const maxDepth = depth.maxDepth === undefined ? device.depth.maxDepth : depth.maxDepth;
    const retainNewest =
        depth.retainNewest === undefined
            ? Math.min(
                  device.depth.retainNewest,
                  (typeof maxDepth === "number" ? maxDepth : Number.NaN) - 2,
              )
            : depth.retainNewest;
    const effectiveDepth = { maxDepth: maxDepth as number, retainNewest: retainNewest as number };
    const seed =
        fields.seed === undefined ? null : retainedDeviceParent(fields.seed as string).path;
    const deviceId = deriveRetainedDeviceLayerId(fields.commandId);
    const request = {
        operation: config.actions.open,
        root: parent.path,
        seed,
        adapter,
        depth: effectiveDepth,
        configuration_id: retainedDeviceConfigurationId(),
    } as SemanticRecord;
    const prior = commandHead(store, fields.commandId);
    if (prior !== null) {
        assertCommand(prior.body, request, deviceId);
        return reopenRetainedDeviceLayerWorld(store, { deviceId });
    }
    // Fresh physical names cannot be reused by a later store while a killed parent
    // still has a native no-replace clone helper finishing against the old paths.
    const ownershipKey = randomUUID();
    const state: RetainedDeviceState = {
        adapter: adapter as string,
        configuration_id: retainedDeviceConfigurationId(),
        root: path.join(parent.path, config.rootDirectoryPrefix + ownershipKey),
        parent_identity: parent.identity,
        root_identity: null,
        layers_identity: null,
        ownership_key: ownershipKey,
        depth: effectiveDepth,
        generation: 0,
        ordinal: 1,
        layers: [],
        retired: [],
        writable: null,
        garbage: [],
        cleaned: false,
    };
    validateRetainedDeviceState(deviceId, state);
    if (
        seed !== null &&
        (seed === state.root ||
            state.root.startsWith(`${seed}${path.sep}`) ||
            seed.startsWith(`${state.root}${path.sep}`))
    )
        throw new TypeError("retained device seed overlaps its resource root");
    store.deviceLayerDatabaseIdentity();
    const scratch = mkdtempSync(path.join(parent.path, config.stagingDirectoryPrefix));
    try {
        openCarrierBackend(adapter, scratch);
    } catch (error) {
        if (error instanceof CarrierBackendUnavailableError)
            throw new DeviceLayerError(
                device.errors.unavailableCode,
                `durable adapter unavailable: ${error.reason}`,
                { cause: error },
            );
        throw error;
    } finally {
        removePathSync(scratch, { recursive: true });
    }
    const sourceContent =
        seed === null
            ? createRecordId({
                  entries: [{ path: "", mode: config.directoryMode, kind: WORLD_ENTRY_KINDS[0] }],
              })
            : retainedDeviceTreeIdentity(seed);
    const plan = planRetainedDeviceCreation(state, seed, sourceContent);
    const body = journal(deviceId, fields.commandId, config.actions.open, request, state, plan);
    store.runDeviceLayerJournalWork(deviceId, null, () => {
        if (commandHead(store, fields.commandId as string) !== null)
            throw new AppendIntentConflictError("device command already exists");
        return { request: retainedDeviceAppend(body, null), value: null };
    });
    finishPendingDevice(store, readRetainedDeviceHead(store, deviceId));
    return reopenRetainedDeviceLayerWorld(store, { deviceId });
}

/**
 * Reopens a complete locally owned world after verifying configuration, roots and frozen bytes.
 * Pending operations require explicit exact-head recovery; this operation never cleans resources.
 * @param store - Original writable local file-backed trace store.
 * @param options - Exact retained device identity.
 * @returns A new handle bound to the current journal head.
 * @throws {TypeError} If state is missing, pending, cleaned, incompatible, imported or corrupt.
 * @example
 * const world = await reopenRetainedDeviceLayerWorld(store, { deviceId });
 */
export async function reopenRetainedDeviceLayerWorld(
    store: SQLiteTraceStore,
    options: RetainedDeviceLayerSelector,
): Promise<RetainedDeviceLayerWorld> {
    const fields = readScopeDataObject(options, ["deviceId"], "retained device reopen");
    const head = readRetainedDeviceHead(store, fields.deviceId as string);
    assertLocalDevice(store, head.body.device_id);
    if (head.body.phase !== config.phases.completed || head.body.state.cleaned)
        throw new TypeError("retained device is pending recovery or cleaned");
    assertRetainedDevicePhysical(head.body.device_id, head.body.state);
    return retainedHandle(store, head);
}

/**
 * Diagnoses a retained lifecycle without changing the store or physical resources.
 * Imported/copied stores expose journal facts but report physical authority unavailable.
 * @param store - Open original or imported store, including read-only handles.
 * @param options - Exact device identity.
 * @returns Frozen lifecycle, exact head, generation, named layers and an explicit refusal reason.
 * @throws {TypeError} If canonical journal evidence is absent or malformed.
 * @example
 * const diagnosis = inspectRetainedDeviceLayerWorld(store, { deviceId });
 */
export function inspectRetainedDeviceLayerWorld(
    store: SQLiteTraceStore,
    options: RetainedDeviceLayerSelector,
): RetainedDeviceLayerInspection {
    const fields = readScopeDataObject(options, ["deviceId"], "retained device inspection");
    const head = readRetainedDeviceHead(store, fields.deviceId as string);
    const { state } = head.body;
    let status = (
        head.body.phase !== config.phases.completed
            ? config.statuses.pending
            : state.cleaned
              ? config.statuses.cleaned
              : config.statuses.ready
    ) as RetainedDeviceLayerInspection["status"];
    let reason: string | null = null;
    try {
        assertLocalDevice(store, head.body.device_id);
        validateRetainedDeviceState(head.body.device_id, state);
        if (status === config.statuses.ready)
            assertRetainedDevicePhysical(head.body.device_id, state);
        if (status === config.statuses.pending)
            assertRetainedDevicePending(
                head.body.device_id,
                state,
                head.body.plan,
                head.body.phase,
            );
    } catch (error) {
        status = config.statuses.unavailable as RetainedDeviceLayerInspection["status"];
        reason = error instanceof Error ? error.message : String(error);
    }
    return Object.freeze({
        deviceId: head.body.device_id,
        headRecordId: head.recordId,
        adapter: state.adapter,
        configurationId: state.configuration_id,
        generation: state.generation,
        layers: publicLayers(state),
        retiredNames: Object.freeze([...state.retired]),
        status,
        reason,
        pendingCommandId: head.body.phase === config.phases.completed ? null : head.body.command_id,
    });
}

/**
 * Resumes one exact interrupted lifecycle after retaining an explicit recovery command.
 * A moved head or command conflict refuses before filesystem work. Completed command retries
 * inspect the current world without executing a later unrelated pending command.
 * @param store - Original writable local trace store.
 * @param options - Device, exact diagnosed head and stable recovery command.
 * @returns Current read-only diagnosis after the selected operation completes.
 * @throws {TypeError} For unavailable, corrupt, imported or incompatible resources.
 * @throws {AppendIntentConflictError} For moved heads or conflicting command identities.
 * @example
 * await recoverRetainedDeviceLayerWorld(store, { deviceId, commandId: "repair", expectedHeadRecordId: diagnosis.headRecordId });
 */
export async function recoverRetainedDeviceLayerWorld(
    store: SQLiteTraceStore,
    options: RetainedDeviceLayerRecoveryOptions,
): Promise<RetainedDeviceLayerInspection> {
    const fields = readScopeDataObject(
        options,
        ["deviceId", "commandId", "expectedHeadRecordId"],
        "retained device recovery",
    );
    assertScopeText(fields.commandId, "recovery command");
    let head = readRetainedDeviceHead(store, fields.deviceId as string);
    assertLocalDevice(store, head.body.device_id);
    const prior = commandHead(store, fields.commandId);
    if (prior !== null) {
        if (
            prior.body.device_id !== fields.deviceId ||
            prior.body.recovery?.command_id !== fields.commandId ||
            prior.body.recovery.expected_head_record_id !== fields.expectedHeadRecordId
        )
            throw new AppendIntentConflictError("recovery command request differs");
        const completion = commandHead(store, prior.body.command_id);
        if (completion?.body.phase === config.phases.completed)
            return inspectRetainedDeviceLayerWorld(store, { deviceId: head.body.device_id });
        // Device and command heads are separate reads; a concurrent successor can appear between them.
        if (head.body.command_id !== prior.body.command_id)
            throw new AppendIntentConflictError("recovery target operation changed");
    } else {
        if (
            head.recordId !== fields.expectedHeadRecordId ||
            head.body.phase === config.phases.completed ||
            fields.commandId === head.body.command_id
        )
            throw new AppendIntentConflictError("recovery basis is not the exact pending head");
        const body = {
            ...head.body,
            recovery: { command_id: fields.commandId, expected_head_record_id: head.recordId },
        };
        store.runDeviceLayerJournalWork(head.body.device_id, head.recordId, () => {
            if (commandHead(store, fields.commandId as string) !== null)
                throw new AppendIntentConflictError("recovery command already exists");
            assertRetainedDevicePending(
                head.body.device_id,
                head.body.state,
                head.body.plan,
                head.body.phase,
            );
            return { request: retainedDeviceAppend(body, head.recordId), value: null };
        });
        head = readRetainedDeviceHead(store, head.body.device_id);
    }
    finishPendingDevice(store, head);
    return inspectRetainedDeviceLayerWorld(store, { deviceId: head.body.device_id });
}

function journal(
    deviceId: string,
    commandId: string,
    operation: string,
    request: SemanticRecord,
    state: RetainedDeviceState,
    plan: RetainedDevicePlan,
): RetainedDeviceJournal {
    return {
        compatibility_version: config.compatibilityVersion,
        record_version: config.recordVersion,
        device_id: deviceId,
        command_id: commandId,
        operation,
        phase: config.phases.prepared,
        request,
        state,
        plan,
        recovery: null,
    };
}

function commandHead(store: SQLiteTraceStore, commandId: string): RetainedDeviceHead | null {
    const record = store.readOwner(config.commandOwnerPrefix + commandId).at(-1);
    if (record === undefined) return null;
    const body = readRetainedDeviceJournal(record.body);
    const retained = store.readRecord(record.envelope.record_id);
    if (!retained?.views.some((view) => view.owner_id === body.device_id))
        throw new TypeError("device command has no lifecycle journal occurrence");
    readRetainedDeviceHead(store, body.device_id);
    return { recordId: record.envelope.record_id, body };
}

function assertCommand(
    body: RetainedDeviceJournal,
    request: SemanticRecord,
    deviceId: string,
): void {
    if (
        body.device_id !== deviceId ||
        canonicalizeRecord(body.request) !== canonicalizeRecord(request)
    )
        throw new AppendIntentConflictError("retained device command names a different request");
}

function assertLocalDevice(store: SQLiteTraceStore, deviceId: string): void {
    const registration = store.readDeviceLayerRegistration(deviceId);
    if (
        registration === undefined ||
        registration.database_identity !== store.deviceLayerDatabaseIdentity()
    )
        throw new TypeError("retained device has no local authority in this database file");
    const first = store.readOwner(deviceId)[0];
    if (first?.envelope.record_id !== registration.creation_record_id)
        throw new TypeError("retained device creation authority differs");
}

function finishPendingDevice(
    store: SQLiteTraceStore,
    start: RetainedDeviceHead,
): RetainedDeviceHead {
    let head = start;
    while (head.body.phase !== config.phases.completed) {
        const current = head;
        store.runDeviceLayerJournalWork(current.body.device_id, current.recordId, () => {
            let state: RetainedDeviceState;
            let phase: string;
            if (current.body.phase === config.phases.prepared) {
                // readRetainedDeviceHead already rejects null plans before returning frozen state.
                /* node:coverage ignore next 2 */
                if (current.body.plan === null)
                    throw new TypeError("retained device has no prepared plan");
                state = materializeRetainedDevicePlan(
                    current.body.device_id,
                    current.body.state,
                    current.body.plan,
                );
                phase = config.phases.published;
            } else {
                state = cleanupRetainedDeviceGarbage(current.body.device_id, current.body.state);
                phase = config.phases.completed;
            }
            const body = { ...current.body, phase, state };
            return { request: retainedDeviceAppend(body, current.recordId), value: null };
        });
        head = readRetainedDeviceHead(store, current.body.device_id);
    }
    return head;
}

function publicLayers(state: RetainedDeviceState): readonly RetainedDeviceLayerSnapshot[] {
    return Object.freeze(
        state.layers.map((layer, index) => {
            assertRecordId(layer.tree.content_id, "retained layer content identity");
            return Object.freeze({
                checkpoint: layer.checkpoint,
                layer: layer.layer,
                index,
                contentId: layer.tree.content_id,
            });
        }),
    );
}

function retainedHandle(
    store: SQLiteTraceStore,
    initial: RetainedDeviceHead,
): RetainedDeviceLayerWorld {
    let head = initial;
    let closed = false;
    const check = (): void => {
        if (closed)
            throw new DeviceLayerError(device.errors.closedCode, device.errors.closedMessage);
    };
    const access = async <T>(work: (world: string) => T): Promise<T> => {
        check();
        return store.runDeviceLayerJournalWork(head.body.device_id, head.recordId, () => {
            assertRetainedDevicePhysical(head.body.device_id, head.body.state);
            const world = path.join(
                (head.body.state.writable as PlannedDeviceTree).directory,
                config.treeDirectory,
            );
            return { request: null, value: work(world) };
        }).value;
    };
    const command = async (
        action: string,
        value: RetainedDeviceLayerNamedCommand | Readonly<{ commandId: string }>,
    ): Promise<RetainedDeviceHead> => {
        check();
        const fields = readScopeDataObject(
            value,
            action === config.actions.cleanup ? ["commandId"] : ["commandId", "name"],
            "retained device command",
        );
        assertScopeText(fields.commandId, "device command");
        const request = {
            operation: action,
            device_id: head.body.device_id,
            name: fields.name ?? null,
        } as SemanticRecord;
        const previous = commandHead(store, fields.commandId);
        if (previous !== null) {
            assertCommand(previous.body, request, head.body.device_id);
            if (previous.body.phase !== config.phases.completed)
                throw new TypeError("retained device command is pending explicit recovery");
            return previous;
        }
        store.runDeviceLayerJournalWork(head.body.device_id, head.recordId, () => {
            if (commandHead(store, fields.commandId as string) !== null)
                throw new AppendIntentConflictError("device command already exists");
            assertRetainedDevicePhysical(head.body.device_id, head.body.state);
            const contentId =
                action === config.actions.checkpoint
                    ? retainedDeviceTreeIdentity(
                          path.join(
                              (head.body.state.writable as PlannedDeviceTree).directory,
                              config.treeDirectory,
                          ),
                      )
                    : null;
            const plan = planRetainedDeviceCommand(
                head.body.state,
                action,
                fields.name as string | undefined,
                contentId,
            );
            assertRetainedDevicePending(
                head.body.device_id,
                head.body.state,
                plan,
                config.phases.prepared,
            );
            return {
                request: retainedDeviceAppend(
                    journal(
                        head.body.device_id,
                        fields.commandId as string,
                        action,
                        request,
                        head.body.state,
                        plan,
                    ),
                    head.recordId,
                ),
                value: null,
            };
        });
        head = finishPendingDevice(store, readRetainedDeviceHead(store, head.body.device_id));
        return head;
    };
    return Object.freeze({
        adapter: initial.body.state.adapter,
        deviceId: initial.body.device_id,
        depth: Object.freeze({ ...initial.body.state.depth }),
        get path() {
            check();
            return path.join(
                (head.body.state.writable as PlannedDeviceTree).directory,
                config.treeDirectory,
            );
        },
        layers: () => publicLayers(head.body.state),
        readFile: (relative: string) =>
            access((world) => {
                const descriptor = openSync(
                    retainedDeviceFilePath(world, relative),
                    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
                );
                try {
                    const status = fstatSync(descriptor);
                    if (
                        !status.isFile() ||
                        status.nlink !== 1 ||
                        status.size > config.limits.maxFileBytes
                    )
                        throw new TypeError("retained device read requires a bounded regular file");
                    return readFileSync(descriptor);
                } finally {
                    closeSync(descriptor);
                }
            }),
        writeFile: (relative: string, bytes: Buffer) =>
            access((world) => {
                if (!Buffer.isBuffer(bytes) || bytes.length > config.limits.maxFileBytes)
                    throw new TypeError("retained device write requires bounded bytes");
                const target = retainedDeviceFilePath(world, relative);
                ensureDurableDirectory(path.dirname(target));
                const descriptor = openSync(
                    target,
                    constants.O_WRONLY |
                        constants.O_CREAT |
                        constants.O_NOFOLLOW |
                        constants.O_NONBLOCK,
                    config.fileMode,
                );
                try {
                    const status = fstatSync(descriptor);
                    if (!status.isFile() || status.nlink !== 1)
                        throw new TypeError("retained device write requires an owned regular file");
                    writeFileSync(descriptor, bytes);
                    ftruncateSync(descriptor, bytes.length);
                    fsyncSync(descriptor);
                } finally {
                    closeSync(descriptor);
                }
                syncDirectory(path.dirname(target));
            }),
        removePath: (relative: string) =>
            access((world) => {
                const target = retainedDeviceFilePath(world, relative);
                if (lstatSync(target, { throwIfNoEntry: false })?.isDirectory())
                    assertRetainedDeviceTreeBoundary(target);
                removePathSync(target, { recursive: true, force: true });
                if (lstatSync(path.dirname(target), { throwIfNoEntry: false })?.isDirectory())
                    syncDirectory(path.dirname(target));
            }),
        listFiles: () => access(listRetainedDeviceFiles),
        checkpoint: async (
            value: RetainedDeviceLayerNamedCommand,
        ): Promise<RetainedDeviceLayerCheckpoint> => {
            const result = await command(config.actions.checkpoint, value);
            const plan = result.body.plan as RetainedDevicePlan;
            return Object.freeze({
                checkpoint: plan.checkpoint as string,
                layer: plan.layer as string,
                depth: result.body.state.layers.length,
                recordId: result.recordId,
                generation: result.body.state.generation,
                compaction: plan.compaction,
                contentId: result.body.state.layers.find((entry) => entry.layer === plan.layer)
                    ?.tree.content_id as string,
            });
        },
        restore: async (
            value: RetainedDeviceLayerNamedCommand,
        ): Promise<RetainedDeviceLayerRestore> => {
            const result = await command(config.actions.restore, value);
            const plan = result.body.plan as RetainedDevicePlan;
            return Object.freeze({
                checkpoint: plan.checkpoint as string,
                depth: result.body.state.layers.length,
                recordId: result.recordId,
                generation: result.body.state.generation,
                discarded: Object.freeze([...plan.discarded]),
            });
        },
        cleanup: async (value: Readonly<{ commandId: string }>) => {
            await command(config.actions.cleanup, value);
            closed = true;
        },
        close: async () => {
            closed = true;
        },
    });
}
