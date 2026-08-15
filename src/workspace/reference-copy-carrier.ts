import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import type { BigIntStats } from "node:fs";
import {
    closeSync,
    constants,
    existsSync,
    fchmodSync,
    fstatSync,
    fsyncSync,
    lstatSync,
    mkdirSync,
    opendirSync,
    openSync,
    readFileSync,
    readlinkSync,
    realpathSync,
    renameSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from "node:fs";
import path from "node:path";

import {
    canonicalizeRecord,
    createRecordId,
    type SemanticRecord,
} from "../canonical/canonical-record.ts";
import { workspaceProtocolConfig } from "../protocol/config.ts";
import { WORLD_ENTRY_KINDS } from "../protocol/values.generated.ts";
import type { RetainedWorldSettlementOperationEncoding } from "../store/retained-world-settlement-codec.ts";
import { createWorkspaceBindings, createWorkspaceBindingsForRetainedCustody } from "./bindings.ts";
import { WorldCarrierError } from "./errors.ts";
import { openWorkspace, openWorkspaceForRetainedCustody } from "./initialization.ts";
import {
    decodeSelectionPublicationPlan,
    decodeSelectionPublicationSchedule,
    type SelectionPublicationPlanEncoding,
    type SelectionPublicationScheduleEncoding,
} from "./selection-publication-codec.ts";
import type {
    ReferenceCopyCarrier,
    ReferenceCopyCarrierOptions,
    WorkspaceBinding,
    WorldChangeset,
    WorldCustody,
    WorldManifestEntry,
    WorldRevision,
    WorldVerification,
} from "./types.ts";

type CarrierPaths = {
    readonly carrier: string;
    readonly custodies: string;
    readonly discarded: string;
    readonly revisions: string;
    readonly selectionStaging: string;
    readonly staging: string;
    readonly workspaceRoot: string;
    readonly identities: readonly { readonly identity: string; readonly path: string }[];
    readonly createBindings: typeof createWorkspaceBindings;
};

type RevisionDescriptor = {
    readonly backend: string;
    readonly basis_ref: string | null;
    readonly binding_id: string;
    readonly binding_name: string;
    readonly binding_root: string;
    readonly capture_kind: string;
    readonly content_id: string;
    readonly descriptor_format: string;
    readonly descriptor_version: number;
    readonly manifest: readonly WorldManifestEntry[];
    readonly parent_revision_id: string | null;
    readonly revision_id: string;
};

type CustodyDescriptor = {
    readonly backend: string;
    readonly base_content_id: string;
    readonly base_revision_id: string;
    readonly binding_id: string;
    readonly custody_id: string;
    readonly descriptor_format: string;
    readonly descriptor_version: number;
};

type DiscardDescriptor = {
    readonly backend: string;
    readonly custody_id: string;
    readonly descriptor_format: string;
    readonly descriptor_version: number;
    readonly status: string;
};

const [DIRECTORY_KIND, FILE_KIND, SYMLINK_KIND] = WORLD_ENTRY_KINDS;
const NO_ADAPTER_RECEIPTS = (): void => undefined;
const REFERENCE_CARRIERS = new WeakSet<object>();
const REFERENCE_CARRIER_PATHS = new WeakMap<object, CarrierPaths>();

/**
 * Rejects structurally forged carrier objects at internal composition boundaries.
 *
 * @param value - Candidate reference carrier.
 * @throws {TypeError} If the value was not created by this module.
 * @internal
 */
export function assertReferenceCopyCarrier(value: unknown): asserts value is ReferenceCopyCarrier {
    if (value === null || typeof value !== "object" || !REFERENCE_CARRIERS.has(value)) {
        throw new TypeError("reference copy carrier authority is invalid");
    }
}

/**
 * Creates a workspace protocol v3 reference copy carrier.
 *
 * The carrier retains immutable snapshots and isolated mutable forks exclusively beneath the
 * initialized workspace control root. It never mutates the source binding.
 *
 * @param options - Initialized workspace that owns the carrier control storage.
 * @returns Frozen copy-carrier operations.
 * @throws {WorldCarrierError} If carrier storage or retained evidence is unsafe or malformed.
 * @throws {WorkspaceControlError} If workspace control state cannot be reopened.
 * @throws {TypeError} If options are malformed.
 */
export function createReferenceCopyCarrier(
    options: ReferenceCopyCarrierOptions,
): ReferenceCopyCarrier {
    return createCarrier(options, openWorkspace, createWorkspaceBindings);
}

/** @internal Opens a carrier whose Git objects were internalized by retained custody. */
export function createReferenceCopyCarrierForRetainedCustody(
    options: ReferenceCopyCarrierOptions,
): ReferenceCopyCarrier {
    return createCarrier(
        options,
        openWorkspaceForRetainedCustody,
        createWorkspaceBindingsForRetainedCustody,
    );
}

/** @internal Atomically publishes a custody with adapter-owned closed receipts. */
export function forkReferenceCopyRevisionWithReceipts(
    workspaceRoot: string,
    revisionId: string,
    publishReceipts: (stagingRoot: string, custodyId: string) => void,
): WorldCustody {
    const workspace = openWorkspace(workspaceRoot);
    return invokeCarrier(() =>
        forkRevision(
            createCarrierPaths(workspace.control_path, createWorkspaceBindings),
            revisionId,
            publishReceipts,
            null,
        ),
    );
}

/** @internal Publishes or reopens one exact task-world custody identity. */
export function forkReferenceCopyRevisionForTaskWorld(
    carrier: ReferenceCopyCarrier,
    revisionId: string,
    custodyId: string,
): WorldCustody {
    assertReferenceCopyCarrier(carrier);
    const paths = REFERENCE_CARRIER_PATHS.get(carrier);
    assert.ok(paths, "reference carrier paths are unavailable");
    return invokeCarrier(() => forkRevision(paths, revisionId, NO_ADAPTER_RECEIPTS, custodyId));
}

/**
 * Authenticates and durably stages one exact retained-world selection plan.
 *
 * Staging copies only from the immutable retained head revision into deterministic protected
 * carrier custody. It never reads or mutates the user binding. Equal retries reopen the same
 * verified staging identity; conflicting retained evidence fails closed.
 *
 * @param carrier - Package-created reference carrier authority.
 * @param definition - Exact operation, changeset, plan, and schedule evidence to authenticate.
 * @returns Frozen protected staging identity and operational path for later carrier publication.
 * @throws {WorldCarrierError} If plan, schedule, revision, or staging evidence is unsafe or
 * inconsistent.
 * @throws {TypeError} If the carrier authority is forged.
 * @internal
 */
export function stageReferenceCopySelection(
    carrier: ReferenceCopyCarrier,
    definition: Readonly<{
        changeset: WorldChangeset;
        operation: RetainedWorldSettlementOperationEncoding;
        plan: SelectionPublicationPlanEncoding;
        schedule: SelectionPublicationScheduleEncoding;
    }>,
): Readonly<{
    plan_id: string;
    schedule_id: string;
    staging_id: string;
    staging_path: string;
}> {
    assertReferenceCopyCarrier(carrier);
    const paths = REFERENCE_CARRIER_PATHS.get(carrier);
    assert.ok(paths, "reference carrier paths are unavailable");
    return invokeCarrier(() => stageSelection(paths, definition));
}

/** @internal Reads and authenticates one retained regular-file blob from an owned revision. */
export function readReferenceCopyRevisionBlob(
    carrier: ReferenceCopyCarrier,
    revisionId: string,
    relativePath: string,
    expectedBlobId: string,
    expectedByteLength: number,
): Buffer {
    assertReferenceCopyCarrier(carrier);
    const paths = REFERENCE_CARRIER_PATHS.get(carrier);
    assert.ok(paths, "reference carrier paths are unavailable");
    return invokeCarrier(() => {
        verifyRevision(paths, revisionId);
        const revision = loadRevision(paths, revisionId);
        const entry = revision.manifest.find((candidate) => candidate.path === relativePath);
        assert.equal(
            entry?.kind === FILE_KIND &&
                entry.blob_id === expectedBlobId &&
                entry.size === expectedByteLength,
            true,
            "retained blob citation differs from its revision manifest",
        );
        const filePath = path.join(revision.path, ...relativePath.split("/"));
        assert.equal(containsPath(revision.path, filePath) && filePath !== revision.path, true);
        const before = lstatSync(filePath, { bigint: true });
        assert.equal(before.isFile() && !before.isSymbolicLink(), true);
        const descriptor = openSync(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
            assert.equal(stableStatus(before, fstatSync(descriptor, { bigint: true })), true);
            const bytes = readFileSync(descriptor);
            assert.equal(stableStatus(before, fstatSync(descriptor, { bigint: true })), true);
            assert.equal(bytes.length, expectedByteLength);
            assert.equal(
                digestId(workspaceProtocolConfig.carrier.blobIdPrefix, bytes),
                expectedBlobId,
            );
            return bytes;
        } finally {
            closeSync(descriptor);
        }
    });
}

function createCarrier(
    options: ReferenceCopyCarrierOptions,
    open: typeof openWorkspace,
    createBindings: typeof createWorkspaceBindings,
): ReferenceCopyCarrier {
    const workspaceRoot = readOptions(options);
    const workspace = open(workspaceRoot);
    const paths = createCarrierPaths(workspace.control_path, createBindings);

    const carrier = Object.freeze({
        captureCustody: async (custodyId: string) =>
            invokeCarrier(() => captureCustody(paths, custodyId)),
        discard: async (custodyId: string) => invokeCarrier(() => discardCustody(paths, custodyId)),
        fork: async (revisionId: string) =>
            invokeCarrier(() => forkRevision(paths, revisionId, NO_ADAPTER_RECEIPTS, null)),
        openCustody: async (custodyId: string) =>
            invokeCarrier(() => {
                verifyCustody(paths, custodyId);
                return loadCustody(paths, custodyId);
            }),
        openRevision: async (revisionId: string) =>
            invokeCarrier(() => {
                verifyRevision(paths, revisionId);
                return loadRevision(paths, revisionId);
            }),
        snapshot: async (binding: WorkspaceBinding) =>
            invokeCarrier(() =>
                snapshotBinding(
                    paths,
                    workspace.root_path,
                    workspace.control_path,
                    workspace.adoption.baseline_ref,
                    binding,
                    binding.canonical_root,
                    workspace.control_path,
                ),
            ),
        verifyCustody: async (custodyId: string) =>
            invokeCarrier(() => verifyCustody(paths, custodyId)),
        verifyRevision: async (revisionId: string) =>
            invokeCarrier(() => verifyRevision(paths, revisionId)),
    });
    REFERENCE_CARRIERS.add(carrier);
    REFERENCE_CARRIER_PATHS.set(carrier, paths);
    return carrier;
}

function captureCustody(paths: CarrierPaths, custodyId: string): WorldRevision {
    const custody = loadCustody(paths, custodyId);
    const baseDescriptor = readOwnedRevisionDescriptor(paths, custody.base_revision_id);
    verifyRevision(paths, custody.base_revision_id);
    const verifiedBaseDescriptor = readOwnedRevisionDescriptor(paths, custody.base_revision_id);
    assert.equal(
        canonicalizeRecord(baseDescriptor as unknown as SemanticRecord),
        canonicalizeRecord(verifiedBaseDescriptor as unknown as SemanticRecord),
        "base revision changed during custody capture",
    );
    const stagingRoot = createStaging(paths);
    const stagedWorld = path.join(stagingRoot, workspaceProtocolConfig.carrier.worldDirectory);
    try {
        mkdirSync(stagedWorld);
        const manifest = captureTree(custody.path, stagedWorld, null);
        const secondManifest = captureTree(custody.path, null, null);
        assert.equal(
            canonicalManifest(manifest),
            canonicalManifest(secondManifest),
            "world custody changed during capture",
        );
        assertManifestEqual(manifest, captureTree(stagedWorld, null, null));
        const contentId = createContentId(manifest);
        const revisionId = createRevisionId(
            custody.binding_id,
            contentId,
            baseDescriptor.basis_ref,
            custody.base_revision_id,
        );
        const descriptor: RevisionDescriptor = {
            backend: workspaceProtocolConfig.carrier.backendKind,
            basis_ref: baseDescriptor.basis_ref,
            binding_id: custody.binding_id,
            binding_name: baseDescriptor.binding_name,
            binding_root: baseDescriptor.binding_root,
            capture_kind: workspaceProtocolConfig.carrier.captureKind,
            content_id: contentId,
            descriptor_format: workspaceProtocolConfig.carrier.descriptorFormat,
            descriptor_version: workspaceProtocolConfig.carrier.descriptorVersion,
            manifest,
            parent_revision_id: custody.base_revision_id,
            revision_id: revisionId,
        };
        writeClosedDescriptor(
            path.join(stagingRoot, workspaceProtocolConfig.carrier.revisionDescriptorFile),
            descriptor,
        );
        syncDirectory(stagingRoot);
        publishDirectory(paths, stagingRoot, revisionRoot(paths, revisionId), () =>
            assertRevisionPublicationEqual(paths, revisionId, descriptor),
        );
        verifyRevision(paths, revisionId);
        return loadRevision(paths, revisionId);
    } catch (error) {
        cleanupStaging(paths, stagingRoot);
        throwCarrierError(error);
    }
}

/** @internal Captures a Git-adapter staging tree under the protected control root. */
export function snapshotReferenceCopySource(
    workspaceRoot: string,
    binding: WorkspaceBinding,
    sourceRoot: string,
    basisRef: string,
): WorldRevision {
    const workspace = openWorkspace(workspaceRoot);
    const source = assertGitStagingSource(workspace.control_path, sourceRoot);
    return invokeCarrier(() =>
        snapshotBinding(
            createCarrierPaths(workspace.control_path, createWorkspaceBindings),
            workspace.root_path,
            workspace.control_path,
            basisRef,
            binding,
            source,
            null,
        ),
    );
}

/** @internal Computes copy-carrier content evidence for a Git-adapter staging tree. */
export function inspectReferenceCopySource(
    workspaceRoot: string,
    sourceRoot: string,
): WorldVerification {
    const workspace = openWorkspace(workspaceRoot);
    const source = assertGitStagingSource(workspace.control_path, sourceRoot);
    return invokeCarrier(() => {
        const manifest = captureTree(source, null, null);
        return freezeVerification(createContentId(manifest), false, manifest);
    });
}

function assertGitStagingSource(controlPath: string, sourceRoot: string): string {
    const stagingParent = path.join(
        controlPath,
        workspaceProtocolConfig.gitCustody.stagingDirectory,
    );
    const source = realpathSync(sourceRoot);
    const status = lstatSync(source);
    assert.equal(status.isDirectory() && !status.isSymbolicLink(), true);
    assert.equal(containsPath(stagingParent, source) && source !== stagingParent, true);
    return source;
}

function readOptions(value: unknown): string {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError("reference copy carrier options must be an object");
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (
        Object.getPrototypeOf(value) !== Object.prototype ||
        Object.getOwnPropertySymbols(value).length > 0 ||
        Object.keys(descriptors).length !== 1 ||
        !("workspaceRoot" in descriptors) ||
        !("value" in descriptors.workspaceRoot)
    ) {
        throw new TypeError("reference copy carrier options must be exact data");
    }
    const workspaceRoot = descriptors.workspaceRoot.value as unknown;
    if (typeof workspaceRoot !== "string" || workspaceRoot.length === 0) {
        throw new TypeError("reference copy carrier workspaceRoot must be a non-empty string");
    }
    return workspaceRoot;
}

function createCarrierPaths(
    controlPath: string,
    createBindings: typeof createWorkspaceBindings,
): CarrierPaths {
    const config = workspaceProtocolConfig.carrier;
    const carrier = path.join(controlPath, config.carrierDirectory);
    const basePaths = {
        carrier,
        custodies: path.join(carrier, config.custodiesDirectory),
        discarded: path.join(carrier, config.discardedDirectory),
        revisions: path.join(carrier, config.revisionsDirectory),
        selectionStaging: path.join(
            carrier,
            workspaceProtocolConfig.selectionPublication.stagingDirectory,
        ),
        staging: path.join(carrier, config.stagingDirectory),
    };
    try {
        for (const directory of Object.values(basePaths)) {
            mkdirSync(directory, { recursive: true, mode: 0o700 });
            const status = lstatSync(directory);
            if (!status.isDirectory() || status.isSymbolicLink()) {
                throw carrierError("control");
            }
            syncDirectory(directory);
            syncDirectory(path.dirname(directory));
        }
        return {
            ...basePaths,
            identities: Object.values(basePaths).map((directory) => ({
                identity: directoryIdentity(directory),
                path: directory,
            })),
            createBindings,
            workspaceRoot: path.dirname(controlPath),
        };
    } catch (error) {
        throwCarrierError(error);
    }
}

function stageSelection(
    paths: CarrierPaths,
    definition: Readonly<{
        changeset: WorldChangeset;
        operation: RetainedWorldSettlementOperationEncoding;
        plan: SelectionPublicationPlanEncoding;
        schedule: SelectionPublicationScheduleEncoding;
    }>,
): Readonly<{
    plan_id: string;
    schedule_id: string;
    staging_id: string;
    staging_path: string;
}> {
    const { changeset, operation, plan, schedule } = definition;
    const candidate = JSON.parse(plan.json) as Record<string, unknown>;
    const baseRevisionId = candidate.base_revision_id;
    const headRevisionId = candidate.head_revision_id;
    if (typeof baseRevisionId !== "string" || typeof headRevisionId !== "string") {
        throw new TypeError("selection publication revision authority is invalid");
    }
    verifyRevision(paths, baseRevisionId);
    verifyRevision(paths, headRevisionId);
    const base = loadRevision(paths, baseRevisionId);
    const head = loadRevision(paths, headRevisionId);
    const validatedPlan = decodeSelectionPublicationPlan(
        plan.json,
        operation,
        changeset,
        base.content_id,
        head.content_id,
    );
    if (
        plan.id !== validatedPlan.id ||
        plan.digest !== validatedPlan.digest ||
        plan.staging_id !== validatedPlan.staging_id ||
        canonicalizeRecord(plan.value as unknown as SemanticRecord) !== validatedPlan.json
    ) {
        throw new TypeError("selection publication plan authority is invalid");
    }
    const validatedSchedule = decodeSelectionPublicationSchedule(schedule.json, validatedPlan);
    if (
        schedule.id !== validatedSchedule.id ||
        schedule.digest !== validatedSchedule.digest ||
        canonicalizeRecord(schedule.value as unknown as SemanticRecord) !== validatedSchedule.json
    ) {
        throw new TypeError("selection publication schedule authority is invalid");
    }
    assert.equal(base.binding_id, validatedPlan.value.binding_id);
    assert.equal(base.content_id, validatedPlan.value.base_content_id);
    assert.equal(head.binding_id, validatedPlan.value.binding_id);
    assert.equal(head.content_id, validatedPlan.value.head_content_id);

    const stagingRoot = createStaging(paths);
    const stagedWorld = path.join(stagingRoot, workspaceProtocolConfig.carrier.worldDirectory);
    const finalRoot = selectionStagingRoot(paths, validatedPlan.staging_id);
    try {
        mkdirSync(stagedWorld);
        assertManifestEqual(head.manifest, captureTree(head.path, stagedWorld, null));
        writeClosedDescriptor(
            path.join(stagingRoot, workspaceProtocolConfig.selectionPublication.planFile),
            validatedPlan.value,
        );
        writeClosedDescriptor(
            path.join(stagingRoot, workspaceProtocolConfig.selectionPublication.scheduleFile),
            validatedSchedule.value,
        );
        syncDirectory(stagingRoot);
        publishDirectory(paths, stagingRoot, finalRoot, () =>
            verifySelectionStaging(paths, validatedPlan, validatedSchedule, head),
        );
        verifySelectionStaging(paths, validatedPlan, validatedSchedule, head);
        return Object.freeze({
            plan_id: validatedPlan.id,
            schedule_id: validatedSchedule.id,
            staging_id: validatedPlan.staging_id,
            staging_path: safeWorldPath(finalRoot),
        });
    } catch (error) {
        cleanupStaging(paths, stagingRoot);
        throw error;
    }
}

function verifySelectionStaging(
    paths: CarrierPaths,
    plan: SelectionPublicationPlanEncoding,
    schedule: SelectionPublicationScheduleEncoding,
    head: WorldRevision,
): void {
    const root = selectionStagingRoot(paths, plan.staging_id);
    const retained = assertReceiptRoot(paths.selectionStaging, root);
    const retainedPlan = canonicalizeRecord(
        readJson(
            path.join(root, workspaceProtocolConfig.selectionPublication.planFile),
        ) as SemanticRecord,
    );
    const retainedSchedule = canonicalizeRecord(
        readJson(
            path.join(root, workspaceProtocolConfig.selectionPublication.scheduleFile),
        ) as SemanticRecord,
    );
    assert.equal(retainedPlan, plan.json);
    assert.equal(retainedSchedule, schedule.json);
    assertManifestEqual(head.manifest, captureTree(safeWorldPath(root), null, null));
    assertReceiptRootStable(root, retained);
}

function snapshotBinding(
    paths: CarrierPaths,
    workspaceRoot: string,
    controlPath: string,
    basisRef: string | null,
    binding: WorkspaceBinding,
    sourceRoot: string,
    captureControlPath: string | null,
): WorldRevision {
    const retainedBinding = revalidateBinding(workspaceRoot, binding);
    assert.equal(
        containsPath(controlPath, retainedBinding.canonical_root),
        false,
        "workspace control paths cannot be captured as bindings",
    );
    const stagingRoot = createStaging(paths);
    const stagedWorld = path.join(stagingRoot, workspaceProtocolConfig.carrier.worldDirectory);
    try {
        mkdirSync(stagedWorld);
        const manifest = captureTree(sourceRoot, stagedWorld, captureControlPath);
        const secondManifest = captureTree(sourceRoot, null, captureControlPath);
        assert.equal(
            canonicalManifest(manifest),
            canonicalManifest(secondManifest),
            "workspace binding changed during snapshot",
        );
        assertManifestEqual(manifest, captureTree(stagedWorld, null, null));
        const contentId = createContentId(manifest);
        const revisionId = createRevisionId(retainedBinding.binding_id, contentId, basisRef, null);
        const descriptor: RevisionDescriptor = {
            backend: workspaceProtocolConfig.carrier.backendKind,
            basis_ref: basisRef,
            binding_id: retainedBinding.binding_id,
            binding_name: retainedBinding.name,
            binding_root: retainedBinding.canonical_root,
            capture_kind: workspaceProtocolConfig.carrier.captureKind,
            content_id: contentId,
            descriptor_format: workspaceProtocolConfig.carrier.descriptorFormat,
            descriptor_version: workspaceProtocolConfig.carrier.descriptorVersion,
            manifest,
            parent_revision_id: null,
            revision_id: revisionId,
        };
        writeClosedDescriptor(
            path.join(stagingRoot, workspaceProtocolConfig.carrier.revisionDescriptorFile),
            descriptor,
        );
        syncDirectory(stagingRoot);
        const finalRoot = revisionRoot(paths, revisionId);
        publishDirectory(paths, stagingRoot, finalRoot, () =>
            assertRevisionPublicationEqual(paths, revisionId, descriptor),
        );
        verifyRevision(paths, revisionId);
        return loadRevision(paths, revisionId);
    } catch (error) {
        cleanupStaging(paths, stagingRoot);
        throwCarrierError(error);
    }
}

function assertRevisionPublicationEqual(
    paths: CarrierPaths,
    revisionId: string,
    candidate: RevisionDescriptor,
): void {
    const existing = readOwnedRevisionDescriptor(paths, revisionId);
    if (
        canonicalizeRecord(existing as unknown as SemanticRecord) !==
        canonicalizeRecord(candidate as unknown as SemanticRecord)
    ) {
        throw carrierError("conflict");
    }
    verifyRevision(paths, revisionId);
}

function forkRevision(
    paths: CarrierPaths,
    revisionId: string,
    publishReceipts: (stagingRoot: string, custodyId: string) => void,
    requestedCustodyId: string | null,
): WorldCustody {
    const revision = loadRevision(paths, revisionId);
    verifyRevision(paths, revisionId);
    const custodyId =
        requestedCustodyId ?? `${workspaceProtocolConfig.carrier.custodyIdPrefix}${randomUUID()}`;
    const stagingRoot = createStaging(paths);
    const stagedWorld = path.join(stagingRoot, workspaceProtocolConfig.carrier.worldDirectory);
    try {
        mkdirSync(stagedWorld);
        const copied = captureTree(revision.path, stagedWorld, null);
        assertManifestEqual(revision.manifest, copied);
        const descriptor: CustodyDescriptor = {
            backend: workspaceProtocolConfig.carrier.backendKind,
            base_content_id: revision.content_id,
            base_revision_id: revision.revision_id,
            binding_id: revision.binding_id,
            custody_id: custodyId,
            descriptor_format: workspaceProtocolConfig.carrier.descriptorFormat,
            descriptor_version: workspaceProtocolConfig.carrier.descriptorVersion,
        };
        publishReceipts(stagingRoot, custodyId);
        writeClosedDescriptor(
            path.join(stagingRoot, workspaceProtocolConfig.carrier.custodyDescriptorFile),
            descriptor,
        );
        syncDirectory(stagingRoot);
        publishDirectory(paths, stagingRoot, custodyRoot(paths, custodyId), () => {
            const existing = loadCustody(paths, custodyId);
            verifyCustody(paths, custodyId);
            assert.equal(existing.base_revision_id, revision.revision_id);
            assert.equal(existing.base_content_id, revision.content_id);
            assert.equal(existing.binding_id, revision.binding_id);
        });
        return loadCustody(paths, custodyId);
    } catch (error) {
        cleanupStaging(paths, stagingRoot);
        throwCarrierError(error);
    }
}

function loadRevision(paths: CarrierPaths, revisionId: string): WorldRevision {
    const root = revisionRoot(paths, revisionId);
    const descriptor = readOwnedRevisionDescriptor(paths, revisionId);
    if (descriptor.revision_id !== revisionId) {
        throw carrierError("control");
    }
    const worldPath = safeWorldPath(root);
    return Object.freeze({
        backend: descriptor.backend,
        basis_ref: descriptor.basis_ref,
        binding_id: descriptor.binding_id,
        capture_kind: descriptor.capture_kind,
        content_id: descriptor.content_id,
        descriptor_version: descriptor.descriptor_version,
        manifest: freezeManifest(descriptor.manifest),
        path: worldPath,
        parent_revision_id: descriptor.parent_revision_id,
        revision_id: descriptor.revision_id,
    });
}

function loadCustody(paths: CarrierPaths, custodyId: string): WorldCustody {
    const marker = discardMarker(paths, custodyId);
    if (existsSync(marker)) {
        readDiscardDescriptor(marker, custodyId);
        throw carrierError("control", "world custody was discarded");
    }
    const root = custodyRoot(paths, custodyId);
    const rootStatus = assertReceiptRoot(paths.custodies, root);
    const descriptor = readCustodyDescriptor(
        path.join(root, workspaceProtocolConfig.carrier.custodyDescriptorFile),
    );
    assertReceiptRootStable(root, rootStatus);
    if (descriptor.custody_id !== custodyId) {
        throw carrierError("control");
    }
    const base = loadRevision(paths, descriptor.base_revision_id);
    assert.equal(descriptor.base_content_id, base.content_id);
    assert.equal(descriptor.binding_id, base.binding_id);
    return Object.freeze({
        backend: descriptor.backend,
        base_content_id: descriptor.base_content_id,
        base_revision_id: descriptor.base_revision_id,
        binding_id: descriptor.binding_id,
        custody_id: descriptor.custody_id,
        descriptor_version: descriptor.descriptor_version,
        path: safeWorldPath(root),
    });
}

function verifyRevision(paths: CarrierPaths, revisionId: string): WorldVerification {
    let depth = 0;
    let currentRevisionId: string | null = revisionId;
    let child: WorldRevision | null = null;
    let requestedVerification: WorldVerification | null = null;
    while (currentRevisionId !== null) {
        if (depth >= workspaceProtocolConfig.worldCapture.maxRevisionDepth) {
            throw carrierError("control", "world revision ancestry is cyclic or too deep");
        }
        depth += 1;
        const verification = verifyRevisionNode(paths, currentRevisionId);
        const current = loadRevision(paths, currentRevisionId);
        if (requestedVerification === null) requestedVerification = verification;
        if (child !== null) {
            assert.equal(
                current.binding_id,
                child.binding_id,
                "world revision parent binding differs",
            );
            assert.equal(current.basis_ref, child.basis_ref, "world revision parent basis differs");
        }
        child = current;
        currentRevisionId = current.parent_revision_id;
    }
    assert.ok(requestedVerification);
    return requestedVerification;
}

function verifyRevisionNode(paths: CarrierPaths, revisionId: string): WorldVerification {
    const descriptor = readOwnedRevisionDescriptor(paths, revisionId);
    const binding = paths.createBindings({
        bindings: [{ name: descriptor.binding_name, root: descriptor.binding_root }],
        workspaceRoot: paths.workspaceRoot,
    }).bindings[0];
    assert.ok(binding, "retained revision binding is unavailable");
    assert.equal(binding.binding_id, descriptor.binding_id, "retained revision binding changed");
    assert.equal(
        binding.canonical_root,
        descriptor.binding_root,
        "retained revision binding root changed",
    );
    const revision = loadRevision(paths, revisionId);
    const manifest = captureTree(revision.path, null, null);
    assertManifestEqual(revision.manifest, manifest);
    const contentId = createContentId(manifest);
    if (
        contentId !== revision.content_id ||
        createRevisionId(
            revision.binding_id,
            contentId,
            revision.basis_ref,
            revision.parent_revision_id,
        ) !== revision.revision_id
    ) {
        throw carrierError("control", "immutable world revision failed verification");
    }
    return freezeVerification(contentId, false, manifest);
}

function verifyCustody(paths: CarrierPaths, custodyId: string): WorldVerification {
    const custody = loadCustody(paths, custodyId);
    verifyRevision(paths, custody.base_revision_id);
    const manifest = captureTree(custody.path, null, null);
    const contentId = createContentId(manifest);
    return freezeVerification(contentId, contentId !== custody.base_content_id, manifest);
}

function discardCustody(paths: CarrierPaths, custodyId: string): void {
    const marker = discardMarker(paths, custodyId);
    const root = custodyRoot(paths, custodyId);
    try {
        /* node:coverage ignore next */
        if (existsSync(marker)) {
            readDiscardDescriptor(marker, custodyId);
        } else {
            loadCustody(paths, custodyId);
            publishDiscardDescriptor(paths, marker, custodyId);
        }
        if (existsSync(root)) {
            const status = lstatSync(root);
            if (!status.isDirectory() || status.isSymbolicLink()) {
                throw carrierError("control");
            }
            rmSync(root, { recursive: true });
            syncDirectory(paths.custodies);
        }
    } catch (error) {
        throwCarrierError(error);
    }
}

function captureTree(
    sourceRoot: string,
    targetRoot: string | null,
    controlPath: string | null,
): readonly WorldManifestEntry[] {
    const manifest: WorldManifestEntry[] = [];
    const seenHardLinks = new Set<string>();
    walkDirectory(sourceRoot, targetRoot, "", controlPath, manifest, seenHardLinks);
    if (targetRoot !== null) {
        syncDirectory(targetRoot);
    }
    manifest.sort((left, right) => Buffer.from(left.path).compare(Buffer.from(right.path)));
    return freezeManifest(manifest);
}

function walkDirectory(
    sourceRoot: string,
    targetRoot: string | null,
    relativeDirectory: string,
    controlPath: string | null,
    manifest: WorldManifestEntry[],
    seenHardLinks: Set<string>,
): void {
    const sourceDirectory =
        relativeDirectory === ""
            ? sourceRoot
            : path.join(sourceRoot, ...relativeDirectory.split("/"));
    const beforeDirectory = lstatSync(sourceDirectory, { bigint: true });
    assert.equal(beforeDirectory.isDirectory() && !beforeDirectory.isSymbolicLink(), true);
    assert.equal(realpathSync(sourceDirectory), sourceDirectory, "directory authority changed");
    const directory = opendirSync(sourceDirectory);
    const beforeNames: string[] = [];
    try {
        assert.equal(
            stableStatus(beforeDirectory, lstatSync(sourceDirectory, { bigint: true })),
            true,
            "directory authority changed while opening",
        );
        for (let item = directory.readSync(); item !== null; item = directory.readSync()) {
            beforeNames.push(item.name);
        }
    } finally {
        directory.closeSync();
    }
    beforeNames.sort();
    assert.equal(
        new Set(beforeNames.map((name) => name.normalize("NFC"))).size,
        beforeNames.length,
        "directory contains duplicate normalized names",
    );
    for (const name of beforeNames) {
        assert.equal(
            stableStatus(beforeDirectory, lstatSync(sourceDirectory, { bigint: true })) &&
                realpathSync(sourceDirectory) === sourceDirectory,
            true,
            "directory authority changed during traversal",
        );
        assertSafeName(name);
        const relativePath = relativeDirectory === "" ? name : `${relativeDirectory}/${name}`;
        const sourcePath = path.join(sourceRoot, ...relativePath.split("/"));
        if (controlPath !== null && samePath(sourcePath, controlPath)) {
            continue;
        }
        const before = lstatSync(sourcePath, { bigint: true });
        const targetPath =
            targetRoot === null ? null : path.join(targetRoot, ...relativePath.split("/"));
        assert.equal(
            !before.isDirectory() && !before.isFile() ? 0n : before.mode & 0o7000n,
            0n,
            `special permission bits are unsupported: ${relativePath}`,
        );
        if (before.isDirectory()) {
            if (targetPath !== null) {
                mkdirSync(targetPath, { mode: 0o700 });
            }
            manifest.push(
                entry(DIRECTORY_KIND, relativePath, Number(before.mode & 0o777n), null, null, null),
            );
            walkDirectory(
                sourceRoot,
                targetRoot,
                relativePath,
                controlPath,
                manifest,
                seenHardLinks,
            );
            if (targetPath !== null) {
                setDirectoryModeDurably(targetPath, Number(before.mode & 0o777n));
            }
        } else if (before.isFile()) {
            const hardLinkIdentity = `${before.dev}:${before.ino}`;
            if (before.nlink > 1n || seenHardLinks.has(hardLinkIdentity)) {
                throw carrierError(
                    "unsupported",
                    `hard-linked file is unsupported: ${relativePath}`,
                );
            }
            seenHardLinks.add(hardLinkIdentity);
            const sourceDescriptor = openSync(
                sourcePath,
                constants.O_RDONLY | constants.O_NOFOLLOW,
            );
            let bytes: Buffer;
            try {
                assert.equal(
                    stableStatus(before, fstatSync(sourceDescriptor, { bigint: true })),
                    true,
                    `file authority changed while opening: ${relativePath}`,
                );
                bytes = readFileSync(sourceDescriptor);
                assert.equal(
                    stableStatus(before, fstatSync(sourceDescriptor, { bigint: true })),
                    true,
                    `file changed while reading: ${relativePath}`,
                );
            } finally {
                closeSync(sourceDescriptor);
            }
            if (targetPath !== null) {
                const descriptor = openSync(targetPath, "wx", Number(before.mode & 0o777n));
                try {
                    writeFileSync(descriptor, bytes);
                    fchmodSync(descriptor, Number(before.mode & 0o777n));
                    fsyncSync(descriptor);
                } finally {
                    closeSync(descriptor);
                }
            }
            const blobId = digestId(workspaceProtocolConfig.carrier.blobIdPrefix, bytes);
            manifest.push(
                entry(
                    FILE_KIND,
                    relativePath,
                    Number(before.mode & 0o777n),
                    bytes.length,
                    blobId,
                    null,
                ),
            );
        } else if (before.isSymbolicLink()) {
            const target = readlinkSync(sourcePath);
            assertSafeSymlink(sourceRoot, controlPath, relativePath, target);
            if (targetPath !== null) symlinkSync(target, targetPath);
            manifest.push(entry(SYMLINK_KIND, relativePath, null, null, null, target));
        } else {
            throw carrierError("unsupported", `unsupported filesystem object: ${relativePath}`);
        }
        const after = lstatSync(sourcePath, { bigint: true });
        assert.equal(
            stableStatus(before, after),
            true,
            `filesystem entry changed during capture: ${relativePath}`,
        );
    }
    const afterDirectory = lstatSync(sourceDirectory, { bigint: true });
    assert.equal(stableStatus(beforeDirectory, afterDirectory), true, "directory changed");
    assert.equal(realpathSync(sourceDirectory), sourceDirectory, "directory authority changed");
    const afterNames = opendirSync(sourceDirectory);
    const retainedNames: string[] = [];
    try {
        assert.equal(
            stableStatus(afterDirectory, lstatSync(sourceDirectory, { bigint: true })),
            true,
            "directory authority changed while reopening",
        );
        for (let item = afterNames.readSync(); item !== null; item = afterNames.readSync()) {
            retainedNames.push(item.name);
        }
    } finally {
        afterNames.closeSync();
    }
    assert.deepEqual(retainedNames.sort(), beforeNames, "directory changed during capture");
}

function entry(
    kind: WorldManifestEntry["kind"],
    relativePath: string,
    mode: number | null,
    size: number | null,
    blobId: string | null,
    symlinkTarget: string | null,
): WorldManifestEntry {
    return { blob_id: blobId, kind, mode, path: relativePath, size, symlink_target: symlinkTarget };
}

function assertSafeName(name: string): void {
    assert.equal(
        name.length > 0 &&
            name !== "." &&
            name !== ".." &&
            !name.includes("/") &&
            !name.includes("\\") &&
            !name.includes("\0") &&
            !/[\uD800-\uDFFF]/u.test(name),
        true,
        "filesystem name is not portable",
    );
}

function assertSafeSymlink(
    sourceRoot: string,
    controlPath: string | null,
    relativePath: string,
    target: string,
): void {
    if (
        path.isAbsolute(target) ||
        target.includes("\\") ||
        target.includes("\0") ||
        /[\uD800-\uDFFF]/u.test(target)
    ) {
        throw carrierError("unsupported", `unsafe symbolic link: ${relativePath}`);
    }
    const resolved = path.resolve(
        path.dirname(path.join(sourceRoot, ...relativePath.split("/"))),
        target,
    );
    if (
        !containsPath(sourceRoot, resolved) ||
        (controlPath !== null && containsPath(controlPath, resolved))
    ) {
        throw carrierError("unsupported", `escaping symbolic link: ${relativePath}`);
    }
}

function stableStatus(left: BigIntStats, right: BigIntStats): boolean {
    return (
        left.dev === right.dev &&
        left.ino === right.ino &&
        left.mode === right.mode &&
        left.size === right.size &&
        left.mtimeNs === right.mtimeNs
    );
}

function createContentId(manifest: readonly WorldManifestEntry[]): string {
    return digestId(
        workspaceProtocolConfig.carrier.worldContentIdPrefix,
        canonicalManifest(manifest),
    );
}

function createRevisionId(
    bindingId: string,
    contentId: string,
    basisRef: string | null,
    parentRevisionId: string | null,
): string {
    const semanticId = createRecordId({
        basis_ref: basisRef,
        binding_id: bindingId,
        capture_kind: workspaceProtocolConfig.carrier.captureKind,
        content_id: contentId,
        descriptor_version: workspaceProtocolConfig.carrier.descriptorVersion,
        manifest_version: workspaceProtocolConfig.carrier.manifestVersion,
        parent_revision_id: parentRevisionId,
    });
    return `${workspaceProtocolConfig.carrier.revisionIdPrefix}${semanticId.slice(semanticId.lastIndexOf(":") + 1)}`;
}

function canonicalManifest(manifest: readonly WorldManifestEntry[]): string {
    return canonicalizeRecord({
        entries: manifest as unknown as SemanticRecord["entries"],
        manifest_version: workspaceProtocolConfig.carrier.manifestVersion,
    });
}

function digestId(prefix: string, value: string | Buffer): string {
    return `${prefix}${createHash(workspaceProtocolConfig.digestAlgorithm).update(value).digest("hex")}`;
}

function revalidateBinding(workspaceRoot: string, binding: WorkspaceBinding): WorkspaceBinding {
    /* node:coverage ignore next */
    if (binding === null || typeof binding !== "object") throw carrierError("control");
    const result = createWorkspaceBindings({
        bindings: [{ name: binding.name, root: binding.requested_root }],
        workspaceRoot,
    }).bindings[0];
    assert.ok(result, "workspace binding is unavailable");
    assert.equal(result.binding_id, binding.binding_id, "workspace binding identity changed");
    assert.equal(result.canonical_root, binding.canonical_root, "workspace binding root changed");
    return result;
}

function readRevisionDescriptor(descriptorPath: string): RevisionDescriptor {
    const value = exactObject(readJson(descriptorPath), [
        "backend",
        "basis_ref",
        "binding_id",
        "binding_name",
        "binding_root",
        "capture_kind",
        "content_id",
        "descriptor_format",
        "descriptor_version",
        "manifest",
        "parent_revision_id",
        "revision_id",
    ]);
    assert.equal(
        !(
            value.backend !== workspaceProtocolConfig.carrier.backendKind ||
            !(value.basis_ref === null || typeof value.basis_ref === "string") ||
            value.capture_kind !== workspaceProtocolConfig.carrier.captureKind ||
            value.descriptor_format !== workspaceProtocolConfig.carrier.descriptorFormat ||
            value.descriptor_version !== workspaceProtocolConfig.carrier.descriptorVersion ||
            typeof value.binding_id !== "string" ||
            typeof value.binding_name !== "string" ||
            typeof value.binding_root !== "string" ||
            typeof value.content_id !== "string" ||
            typeof value.revision_id !== "string" ||
            !(value.parent_revision_id === null || typeof value.parent_revision_id === "string") ||
            !Array.isArray(value.manifest)
        ),
        true,
    );
    assert.ok(Array.isArray(value.manifest));
    const manifest = validateManifest(value.manifest);
    return { ...value, manifest } as RevisionDescriptor;
}

function readOwnedRevisionDescriptor(paths: CarrierPaths, revisionId: string): RevisionDescriptor {
    const root = revisionRoot(paths, revisionId);
    const rootStatus = assertReceiptRoot(paths.revisions, root);
    const descriptor = readRevisionDescriptor(
        path.join(root, workspaceProtocolConfig.carrier.revisionDescriptorFile),
    );
    assertReceiptRootStable(root, rootStatus);
    return descriptor;
}

function readCustodyDescriptor(descriptorPath: string): CustodyDescriptor {
    const value = exactObject(readJson(descriptorPath), [
        "backend",
        "base_content_id",
        "base_revision_id",
        "binding_id",
        "custody_id",
        "descriptor_format",
        "descriptor_version",
    ]);
    assert.equal(
        !(
            value.backend !== workspaceProtocolConfig.carrier.backendKind ||
            value.descriptor_format !== workspaceProtocolConfig.carrier.descriptorFormat ||
            value.descriptor_version !== workspaceProtocolConfig.carrier.descriptorVersion ||
            typeof value.base_content_id !== "string" ||
            typeof value.base_revision_id !== "string" ||
            typeof value.binding_id !== "string" ||
            typeof value.custody_id !== "string"
        ),
        true,
    );
    return value as CustodyDescriptor;
}

function readDiscardDescriptor(descriptorPath: string, custodyId: string): DiscardDescriptor {
    const value = exactObject(readJson(descriptorPath), [
        "backend",
        "custody_id",
        "descriptor_format",
        "descriptor_version",
        "status",
    ]);
    assert.deepEqual(value, {
        backend: workspaceProtocolConfig.carrier.backendKind,
        custody_id: custodyId,
        descriptor_format: workspaceProtocolConfig.carrier.descriptorFormat,
        descriptor_version: workspaceProtocolConfig.carrier.descriptorVersion,
        status: workspaceProtocolConfig.carrier.discardStatus,
    });
    return value as DiscardDescriptor;
}

function publishDiscardDescriptor(
    paths: CarrierPaths,
    markerPath: string,
    custodyId: string,
): void {
    assertOwnedDirectory(paths, paths.staging);
    assertOwnedDirectory(paths, paths.discarded);
    const temporaryPath = path.join(paths.staging, randomUUID());
    try {
        writeClosedDescriptor(temporaryPath, {
            backend: workspaceProtocolConfig.carrier.backendKind,
            custody_id: custodyId,
            descriptor_format: workspaceProtocolConfig.carrier.descriptorFormat,
            descriptor_version: workspaceProtocolConfig.carrier.descriptorVersion,
            status: workspaceProtocolConfig.carrier.discardStatus,
        });
        assertOwnedDirectory(paths, paths.discarded);
        renameSync(temporaryPath, markerPath);
        syncDirectory(paths.discarded);
    } finally {
        rmSync(temporaryPath, { force: true });
    }
}

function validateManifest(value: readonly unknown[]): readonly WorldManifestEntry[] {
    const entries = value.map((item) => {
        const fields = exactObject(item, [
            "blob_id",
            "kind",
            "mode",
            "path",
            "size",
            "symlink_target",
        ]);
        assert.equal(
            !(
                typeof fields.path !== "string" ||
                !WORLD_ENTRY_KINDS.includes(fields.kind as never) ||
                !(fields.mode === null || Number.isSafeInteger(fields.mode)) ||
                !(
                    fields.size === null ||
                    (Number.isSafeInteger(fields.size) && Number(fields.size) >= 0)
                ) ||
                !(fields.blob_id === null || typeof fields.blob_id === "string") ||
                !(fields.symlink_target === null || typeof fields.symlink_target === "string")
            ),
            true,
        );
        return fields as WorldManifestEntry;
    });
    assert.equal(
        canonicalManifest(entries),
        canonicalManifest(
            [...entries].sort((left, right) =>
                Buffer.from(left.path).compare(Buffer.from(right.path)),
            ),
        ),
    );
    return entries;
}

function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
    assert.ok(value !== null && typeof value === "object" && !Array.isArray(value));
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    assert.deepEqual(actual, expected);
    return value as Record<string, unknown>;
}

function readJson(filePath: string): unknown {
    try {
        const before = lstatSync(filePath, { bigint: true });
        assert.equal(before.isFile() && !before.isSymbolicLink(), true);
        const descriptor = openSync(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
            assert.equal(stableStatus(before, fstatSync(descriptor, { bigint: true })), true);
            const value = readFileSync(descriptor, "utf8");
            assert.equal(stableStatus(before, fstatSync(descriptor, { bigint: true })), true);
            assert.equal(stableStatus(before, lstatSync(filePath, { bigint: true })), true);
            return JSON.parse(value) as unknown;
        } finally {
            closeSync(descriptor);
        }
    } catch (error) {
        throwCarrierError(error);
    }
}

function writeClosedDescriptor(filePath: string, value: object): void {
    const descriptor = openSync(filePath, "wx", 0o600);
    try {
        writeFileSync(descriptor, `${JSON.stringify(value)}\n`, "utf8");
        fsyncSync(descriptor);
    } finally {
        closeSync(descriptor);
    }
}

function publishDirectory(
    paths: CarrierPaths,
    stagingRoot: string,
    finalRoot: string,
    verifyExisting?: () => unknown,
): void {
    assertOwnedDirectory(paths, paths.staging);
    assertOwnedDirectory(paths, path.dirname(finalRoot));
    try {
        renameSync(stagingRoot, finalRoot);
    } catch (error) {
        assert.equal(
            ["EEXIST", "ENOTEMPTY"].includes(String((error as NodeJS.ErrnoException).code)),
            true,
            String(error),
        );
        assert.ok(verifyExisting, "retained publication conflicts with a different identity");
        verifyExisting();
        cleanupStaging(paths, stagingRoot);
    }
    syncDirectory(path.dirname(finalRoot));
}

function syncDirectory(directoryPath: string): void {
    const descriptor = openSync(directoryPath, "r");
    try {
        fsyncSync(descriptor);
    } finally {
        closeSync(descriptor);
    }
}

function setDirectoryModeDurably(directoryPath: string, mode: number): void {
    const descriptor = openSync(directoryPath, "r");
    try {
        fchmodSync(descriptor, mode);
        fsyncSync(descriptor);
    } finally {
        closeSync(descriptor);
    }
}

function createStaging(paths: CarrierPaths): string {
    assertOwnedDirectory(paths, paths.staging);
    const stagingRoot = path.join(paths.staging, randomUUID());
    mkdirSync(stagingRoot, { mode: 0o700 });
    return stagingRoot;
}

function cleanupStaging(paths: CarrierPaths, stagingRoot: string): void {
    assertOwnedDirectory(paths, paths.staging);
    if (existsSync(stagingRoot)) rmSync(stagingRoot, { force: true, recursive: true });
}

function revisionRoot(paths: CarrierPaths, revisionId: string): string {
    assertOwnedDirectory(paths, paths.revisions);
    return identityRoot(
        paths.revisions,
        revisionId,
        workspaceProtocolConfig.carrier.revisionIdPrefix,
    );
}

function selectionStagingRoot(paths: CarrierPaths, stagingId: string): string {
    assertOwnedDirectory(paths, paths.selectionStaging);
    return identityRoot(
        paths.selectionStaging,
        stagingId,
        workspaceProtocolConfig.selectionPublication.stagingIdPrefix,
    );
}

function custodyRoot(paths: CarrierPaths, custodyId: string): string {
    assertOwnedDirectory(paths, paths.custodies);
    return identityRoot(
        paths.custodies,
        custodyId,
        workspaceProtocolConfig.carrier.custodyIdPrefix,
    );
}

function discardMarker(paths: CarrierPaths, custodyId: string): string {
    assertOwnedDirectory(paths, paths.discarded);
    const token = identityToken(custodyId, workspaceProtocolConfig.carrier.custodyIdPrefix);
    return path.join(
        paths.discarded,
        `${token}${workspaceProtocolConfig.carrier.discardDescriptorSuffix}`,
    );
}

function directoryIdentity(directoryPath: string): string {
    const status = lstatSync(directoryPath, { bigint: true });
    return `${status.dev}:${status.ino}`;
}

function assertOwnedDirectory(paths: CarrierPaths, directoryPath: string): void {
    const retained = paths.identities.find((entry) => entry.path === directoryPath);
    assert.ok(retained, "carrier directory is not configured custody");
    const status = lstatSync(directoryPath);
    assert.equal(status.isDirectory() && !status.isSymbolicLink(), true);
    assert.equal(realpathSync(directoryPath), directoryPath);
    assert.equal(directoryIdentity(directoryPath), retained.identity);
}

function identityRoot(parent: string, identity: string, prefix: string): string {
    return path.join(parent, identityToken(identity, prefix));
}

function identityToken(identity: string, prefix: string): string {
    const token = identity.startsWith(prefix) ? identity.slice(prefix.length) : "";
    if (!/^[0-9a-f-]+$/u.test(token))
        throw carrierError("control", "world carrier identity is malformed");
    return token;
}

function safeWorldPath(root: string): string {
    const status = lstatSync(root);
    assert.equal(status.isDirectory() && !status.isSymbolicLink(), true);
    const world = path.join(realpathSync(root), workspaceProtocolConfig.carrier.worldDirectory);
    const worldStatus = lstatSync(world);
    assert.equal(
        worldStatus.isDirectory() && !worldStatus.isSymbolicLink() && containsPath(root, world),
        true,
    );
    return world;
}

function assertReceiptRoot(parent: string, root: string): BigIntStats {
    assert.equal(path.dirname(root), parent);
    const status = lstatSync(root, { bigint: true });
    assert.equal(status.isDirectory() && !status.isSymbolicLink(), true);
    assert.equal(realpathSync(root), root);
    assert.equal(containsPath(parent, root) && root !== parent, true);
    return status;
}

function assertReceiptRootStable(root: string, retained: BigIntStats): void {
    assert.equal(stableStatus(retained, lstatSync(root, { bigint: true })), true);
    assert.equal(realpathSync(root), root);
}

function containsPath(parent: string, candidate: string): boolean {
    const relative = path.relative(parent, candidate);
    return (
        relative === "" ||
        (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
    );
}

function samePath(left: string, right: string): boolean {
    return path.resolve(left) === path.resolve(right);
}

function assertManifestEqual(
    left: readonly WorldManifestEntry[],
    right: readonly WorldManifestEntry[],
): void {
    if (canonicalManifest(left) !== canonicalManifest(right))
        throw carrierError("control", "world manifest failed verification");
}

function freezeManifest(manifest: readonly WorldManifestEntry[]): readonly WorldManifestEntry[] {
    return Object.freeze(manifest.map((item) => Object.freeze({ ...item })));
}

function freezeVerification(
    contentId: string,
    modified: boolean,
    manifest: readonly WorldManifestEntry[],
): WorldVerification {
    return Object.freeze({ content_id: contentId, manifest: freezeManifest(manifest), modified });
}

function carrierError(
    kind: "conflict" | "control" | "unsupported",
    detail?: string,
): WorldCarrierError {
    const errors = workspaceProtocolConfig.carrier.errors;
    const contracts = {
        conflict: [errors.conflictCode, errors.conflictMessage],
        control: [errors.controlCode, errors.controlMessage],
        unsupported: [errors.unsupportedCode, errors.unsupportedMessage],
    } as const;
    const [code, message] = contracts[kind];
    const messages = [message, `${message}: ${String(detail)}`] as const;
    return new WorldCarrierError(code, messages[Number(detail !== undefined)] as string);
}

function invokeCarrier<T>(operation: () => T): T {
    try {
        return operation();
    } catch (error) {
        throwCarrierError(error);
    }
}

function throwCarrierError(error: unknown): never {
    if (error instanceof WorldCarrierError) throw error;
    throw carrierError("control", String(error));
}
