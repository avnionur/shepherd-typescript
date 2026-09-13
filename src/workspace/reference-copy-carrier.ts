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
    linkSync,
    lstatSync,
    mkdirSync,
    opendirSync,
    openSync,
    readdirSync,
    readFileSync,
    readlinkSync,
    realpathSync,
    renameSync,
    rmdirSync,
    rmSync,
    symlinkSync,
    unlinkSync,
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
    assertWorkspaceMetadataSupported,
    assertWorkspaceNamesPortable,
    injectWorkspaceCustodyFault,
    readWorkspaceCustodyFaultInjection,
    type WorkspaceCustodyFaultInjection,
} from "./platform-conformance.ts";
import {
    assertWorkspacePathUnprotected,
    type WorkspacePathProtectionOptions,
    WorkspaceProtectedPathError,
} from "./protected-control-paths.ts";
import {
    decodeScheduledSelectionPublicationReceipt,
    decodeScheduledSelectionPublicationStep,
    decodeSelectionPublicationPlan,
    decodeSelectionPublicationSchedule,
    encodeScheduledSelectionPublicationReceipt,
    encodeScheduledSelectionPublicationStep,
    orderWorldPathChangesForPublication,
    type ScheduledSelectionPublicationReceiptEncoding,
    type ScheduledSelectionPublicationStepEncoding,
    type SelectionPublicationPlanEncoding,
    type SelectionPublicationScheduleEncoding,
} from "./selection-publication-codec.ts";
import type {
    ReferenceCopyCarrier,
    ReferenceCopyCarrierOptions,
    WorkspaceBinding,
    WorldChangeNode,
    WorldChangeset,
    WorldCustody,
    WorldManifestEntry,
    WorldPathChange,
    WorldRevision,
    WorldVerification,
} from "./types.ts";

type CarrierPaths = {
    readonly carrier: string;
    readonly custodies: string;
    readonly discarded: string;
    readonly revisions: string;
    readonly selectionPublications: string;
    readonly selectionStaging: string;
    readonly staging: string;
    readonly workspaceRoot: string;
    readonly identities: readonly { readonly identity: string; readonly path: string }[];
    readonly createBindings: typeof createWorkspaceBindings;
    readonly faultInjection: WorkspaceCustodyFaultInjection | null;
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

const snapshotSourceInspectionPhase = workspaceProtocolConfig.platformConformance.faults.phases[0];
assert.ok(snapshotSourceInspectionPhase);
const SNAPSHOT_SOURCE_INSPECTION_PHASE_NAME = snapshotSourceInspectionPhase.name;

type DiscardDescriptor = {
    readonly backend: string;
    readonly custody_id: string;
    readonly descriptor_format: string;
    readonly descriptor_version: number;
    readonly status: string;
};

type WorkspacePathProtectionAuthority = Omit<WorkspacePathProtectionOptions, "path">;

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

/** @internal Publishes or reopens one exact deterministic custody identity. */
export function forkReferenceCopyRevisionWithIdentity(
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
 * Creates or reopens one deterministic merged revision by applying a disjoint candidate delta to
 * an immutable current revision inside protected carrier custody. @internal
 */
export function createReferenceCopyApplicationRevision(
    carrier: ReferenceCopyCarrier,
    definition: Readonly<{
        candidateChangeset: WorldChangeset;
        currentRevisionId: string;
        operationKey: string;
    }>,
): Readonly<{ custody: WorldCustody; revision: WorldRevision }> {
    assertReferenceCopyCarrier(carrier);
    const paths = REFERENCE_CARRIER_PATHS.get(carrier);
    assert.ok(paths, "reference carrier paths are unavailable");
    return invokeCarrier(() => {
        if (typeof definition.operationKey !== "string" || definition.operationKey.length === 0) {
            throw new TypeError("application operation key is invalid");
        }
        const current = loadRevision(paths, definition.currentRevisionId);
        const candidateBase = loadRevision(paths, definition.candidateChangeset.base_revision_id);
        const candidate = loadRevision(paths, definition.candidateChangeset.head_revision_id);
        if (
            current.binding_id !== definition.candidateChangeset.binding_id ||
            candidateBase.binding_id !== current.binding_id ||
            candidate.binding_id !== current.binding_id
        ) {
            throw new TypeError("application revisions cite different bindings");
        }
        const identity = createRecordId({
            candidate_changeset_id: definition.candidateChangeset.changeset_id,
            current_revision_id: current.revision_id,
            operation_key: definition.operationKey,
        });
        const custodyId = `${workspaceProtocolConfig.carrier.custodyIdPrefix}${identity.slice(
            identity.lastIndexOf(":") + 1,
        )}`;
        const custody = forkRevision(paths, current.revision_id, NO_ADAPTER_RECEIPTS, custodyId);
        for (const change of orderWorldPathChangesForPublication(
            definition.candidateChangeset.changes,
        )) {
            const observed = readPathNode(custody.path, change.path);
            if (sameNode(observed, change.after)) continue;
            if (!sameNode(observed, change.before)) {
                throw selectionError("recovery");
            }
            applyPathChange(custody.path, candidate.path, change);
        }
        const revision = captureCustody(paths, custody.custody_id);
        // captureCustody constructs this parent from the just-opened custody descriptor.
        /* node:coverage ignore next 3 */
        if (revision.parent_revision_id !== current.revision_id) {
            throw new TypeError("application revision parent is inconsistent");
        }
        return Object.freeze({ custody, revision });
    });
}

/**
 * Publishes one verified changeset onto owned mutable custody, converging from any prefix.
 *
 * The changeset base and head must be owned verified revisions of the custody binding. Each path
 * already in its head state is skipped, a path in its base state is replaced from the head
 * revision, and any third state fails closed as an unknown physical state. @internal
 */
export function publishReferenceCopyCustodyChangeset(
    carrier: ReferenceCopyCarrier,
    custodyId: string,
    changeset: WorldChangeset,
): WorldVerification {
    assertReferenceCopyCarrier(carrier);
    const paths = REFERENCE_CARRIER_PATHS.get(carrier);
    assert.ok(paths, "reference carrier paths are unavailable");
    return invokeCarrier(() => {
        const custody = loadCustody(paths, custodyId);
        verifyRevision(paths, changeset.base_revision_id);
        verifyRevision(paths, changeset.head_revision_id);
        const head = loadRevision(paths, changeset.head_revision_id);
        const base = loadRevision(paths, changeset.base_revision_id);
        assert.equal(base.binding_id, custody.binding_id, "changeset base binding differs");
        assert.equal(head.binding_id, custody.binding_id, "changeset head binding differs");
        const descriptor = readOwnedRevisionDescriptor(paths, custody.base_revision_id);
        assertChangesetPathsUnprotected(
            changeset,
            pathProtection(paths.workspaceRoot, descriptor.binding_root),
        );
        for (const change of orderWorldPathChangesForPublication(changeset.changes)) {
            const observed = readPathNode(custody.path, change.path);
            if (sameNode(observed, change.after)) continue;
            if (!sameNode(observed, change.before)) throw selectionError("recovery");
            applyPathChange(custody.path, head.path, change);
        }
        return verifyCustody(paths, custodyId);
    });
}

/**
 * Durably discards one exact custody identity whether or not it was ever published.
 *
 * The discard decision is retained first, so a late publication under the identity can never be
 * reopened, and an existing custody tree is removed only after verification. Retries converge.
 * @internal
 */
export function discardReferenceCopyCustodyIdentity(
    carrier: ReferenceCopyCarrier,
    custodyId: string,
): void {
    assertReferenceCopyCarrier(carrier);
    const paths = REFERENCE_CARRIER_PATHS.get(carrier);
    assert.ok(paths, "reference carrier paths are unavailable");
    invokeCarrier(() => {
        const marker = discardMarker(paths, custodyId);
        if (!existsSync(marker) && !existsSync(custodyRoot(paths, custodyId))) {
            publishDiscardDescriptor(paths, marker, custodyId);
            return;
        }
        discardCustody(paths, custodyId);
    });
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

/**
 * Applies and recovers one exact staged selection under a package-owned basis observer.
 *
 * @param carrier - Authenticated reference carrier that owns staging and receipt custody.
 * @param definition - Exact publication evidence and semantic-basis observer.
 * @returns Canonical terminal carrier receipt after every scheduled path is durably applied.
 * @throws {WorldCarrierError} If basis, path, staging, prefix, or publication evidence disagrees.
 * @throws {TypeError} If the carrier authority is forged.
 * @internal
 */
export async function publishReferenceCopySelection(
    carrier: ReferenceCopyCarrier,
    definition: Readonly<{
        changeset: WorldChangeset;
        observeUserBasis: () => Promise<string>;
        operation: RetainedWorldSettlementOperationEncoding;
        plan: SelectionPublicationPlanEncoding;
        schedule: SelectionPublicationScheduleEncoding;
    }>,
): Promise<ScheduledSelectionPublicationReceiptEncoding> {
    assertReferenceCopyCarrier(carrier);
    const paths = REFERENCE_CARRIER_PATHS.get(carrier);
    assert.ok(paths, "reference carrier paths are unavailable");
    try {
        return await publishSelection(paths, definition);
    } catch (error) {
        throwCarrierError(error);
    }
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
    const { faultInjection, workspaceRoot } = readOptions(options);
    const workspace = open(workspaceRoot);
    const paths = createCarrierPaths(workspace.control_path, createBindings, faultInjection);

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
    const protection = pathProtection(paths.workspaceRoot, baseDescriptor.binding_root);
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
        const [sourceInspection, stagingWrite, sourceRevalidation, publication, postPublication] =
            workspaceProtocolConfig.platformConformance.faults.phases.slice(5, 10);
        assert.ok(
            sourceInspection &&
                stagingWrite &&
                sourceRevalidation &&
                publication &&
                postPublication,
        );
        injectWorkspaceCustodyFault(paths.faultInjection, sourceInspection.name);
        mkdirSync(stagedWorld);
        injectWorkspaceCustodyFault(paths.faultInjection, stagingWrite.name);
        const manifest = captureTree(
            custody.path,
            stagedWorld,
            null,
            protection,
            sourceInspection.name,
        );
        assertManifestMetadataSupported(custody.path, manifest, sourceInspection.name);
        injectWorkspaceCustodyFault(paths.faultInjection, sourceRevalidation.name);
        const secondManifest = captureTree(
            custody.path,
            null,
            null,
            protection,
            sourceRevalidation.name,
        );
        assertManifestMetadataSupported(custody.path, secondManifest, sourceRevalidation.name);
        assert.equal(
            canonicalManifest(manifest),
            canonicalManifest(secondManifest),
            "world custody changed during capture",
        );
        assertManifestEqual(manifest, captureTree(stagedWorld, null, null, protection));
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
        injectWorkspaceCustodyFault(paths.faultInjection, publication.name);
        publishDirectory(paths, stagingRoot, revisionRoot(paths, revisionId), () =>
            assertRevisionPublicationEqual(paths, revisionId, descriptor),
        );
        injectWorkspaceCustodyFault(paths.faultInjection, postPublication.name);
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
    bindingRoot: string,
): WorldVerification {
    const workspace = openWorkspace(workspaceRoot);
    const source = assertGitStagingSource(workspace.control_path, sourceRoot);
    return invokeCarrier(() => {
        const manifest = captureTree(
            source,
            null,
            null,
            pathProtection(workspace.root_path, bindingRoot),
        );
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

function readOptions(value: unknown): Readonly<{
    faultInjection: WorkspaceCustodyFaultInjection | null;
    workspaceRoot: string;
}> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError("reference copy carrier options must be an object");
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (
        Object.getPrototypeOf(value) !== Object.prototype ||
        Object.getOwnPropertySymbols(value).length > 0 ||
        ![1, 2].includes(Object.keys(descriptors).length) ||
        !("workspaceRoot" in descriptors) ||
        !("value" in descriptors.workspaceRoot) ||
        Object.keys(descriptors).some((key) => !["faultInjection", "workspaceRoot"].includes(key))
    ) {
        throw new TypeError("reference copy carrier options must be exact data");
    }
    const workspaceRoot = descriptors.workspaceRoot.value as unknown;
    if (typeof workspaceRoot !== "string" || workspaceRoot.length === 0) {
        throw new TypeError("reference copy carrier workspaceRoot must be a non-empty string");
    }
    return {
        faultInjection: readWorkspaceCustodyFaultInjection(
            "faultInjection" in descriptors ? descriptors.faultInjection?.value : undefined,
        ),
        workspaceRoot,
    };
}

function createCarrierPaths(
    controlPath: string,
    createBindings: typeof createWorkspaceBindings,
    faultInjection: WorkspaceCustodyFaultInjection | null = null,
): CarrierPaths {
    const config = workspaceProtocolConfig.carrier;
    const carrier = path.join(controlPath, config.carrierDirectory);
    const basePaths = {
        carrier,
        custodies: path.join(carrier, config.custodiesDirectory),
        discarded: path.join(carrier, config.discardedDirectory),
        revisions: path.join(carrier, config.revisionsDirectory),
        selectionPublications: path.join(
            carrier,
            workspaceProtocolConfig.selectionPublication.publicationsDirectory,
        ),
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
            faultInjection,
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
    const baseDescriptor = readOwnedRevisionDescriptor(paths, baseRevisionId);
    const protection = pathProtection(paths.workspaceRoot, baseDescriptor.binding_root);
    assertChangesetPathsUnprotected(changeset, protection);

    const stagingRoot = createStaging(paths);
    const stagedWorld = path.join(stagingRoot, workspaceProtocolConfig.carrier.worldDirectory);
    const finalRoot = selectionStagingRoot(paths, validatedPlan.staging_id);
    try {
        mkdirSync(stagedWorld);
        mkdirSync(
            path.join(stagingRoot, workspaceProtocolConfig.selectionPublication.stepsDirectory),
        );
        assertManifestEqual(head.manifest, captureTree(head.path, stagedWorld, null, protection));
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
        ensureSelectionStepsDirectory(finalRoot);
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

function ensureSelectionStepsDirectory(stagingRoot: string): void {
    const stepsRoot = path.join(
        stagingRoot,
        workspaceProtocolConfig.selectionPublication.stepsDirectory,
    );
    mkdirSync(stepsRoot, { recursive: true });
    syncDirectory(stepsRoot);
    syncDirectory(stagingRoot);
    assertSelectionDirectory(stepsRoot);
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
    const descriptor = readOwnedRevisionDescriptor(paths, head.revision_id);
    assertManifestEqual(
        head.manifest,
        captureTree(
            safeWorldPath(root),
            null,
            null,
            pathProtection(paths.workspaceRoot, descriptor.binding_root),
        ),
    );
    assertReceiptRootStable(root, retained);
}

async function publishSelection(
    paths: CarrierPaths,
    definition: Readonly<{
        changeset: WorldChangeset;
        observeUserBasis: () => Promise<string>;
        operation: RetainedWorldSettlementOperationEncoding;
        plan: SelectionPublicationPlanEncoding;
        schedule: SelectionPublicationScheduleEncoding;
    }>,
): Promise<ScheduledSelectionPublicationReceiptEncoding> {
    const [beforeWrite, afterWrite, postPublication] =
        workspaceProtocolConfig.platformConformance.faults.phases.slice(16, 19);
    assert.ok(beforeWrite && afterWrite && postPublication);
    const staging = stageSelection(paths, definition);
    const base = readOwnedRevisionDescriptor(paths, definition.plan.value.base_revision_id);
    const head = loadRevision(paths, definition.plan.value.head_revision_id);
    const binding = paths.createBindings({
        bindings: [{ name: base.binding_name, root: base.binding_root }],
        workspaceRoot: paths.workspaceRoot,
    }).bindings[0];
    assert.ok(binding, "selection binding is unavailable");
    assert.equal(binding.binding_id, definition.plan.value.binding_id);
    const stepsRoot = path.join(
        selectionStagingRoot(paths, staging.staging_id),
        workspaceProtocolConfig.selectionPublication.stepsDirectory,
    );
    assertSelectionDirectory(stepsRoot);
    let previous: ScheduledSelectionPublicationStepEncoding | null = null;
    const retainedNames = new Set(readdirSync(stepsRoot));
    injectWorkspaceCustodyFault(paths.faultInjection, beforeWrite.name);
    if (retainedNames.size === 0) {
        const observed = await definition.observeUserBasis();
        if (observed !== definition.plan.value.user_basis_before) throw selectionError("basis");
    }
    for (const _ordinal of definition.schedule.value.change_ordinals) {
        const expected = encodeScheduledSelectionPublicationStep(
            definition.plan,
            definition.schedule,
            previous,
        );
        const name = identityToken(
            expected.id,
            workspaceProtocolConfig.selectionPublication.scheduledStepIdPrefix,
        );
        const receiptPath = path.join(stepsRoot, name);
        if (retainedNames.delete(name)) {
            const retained = canonicalizeRecord(readJson(receiptPath) as SemanticRecord);
            previous = decodeScheduledSelectionPublicationStep(
                retained,
                definition.plan,
                definition.schedule,
                previous,
            );
            assert.equal(previous.id, expected.id);
            assertPathNode(
                binding.canonical_root,
                expected.value.change.path,
                expected.value.change.after,
            );
            continue;
        }
        assert.equal(retainedNames.size, 0, "selection step prefix is skipped or conflicting");
        const change = expected.value.change;
        const current = readPathNode(binding.canonical_root, change.path);
        if (!sameNode(current, change.after)) {
            if (!sameNode(current, change.before)) throw selectionError("recovery");
            applyPathChange(binding.canonical_root, staging.staging_path, change);
        }
        assertPathNode(binding.canonical_root, change.path, change.after);
        publishSelectionStep(paths, stepsRoot, expected);
        previous = expected;
    }
    assert.equal(retainedNames.size, 0, "selection step prefix contains unknown evidence");
    for (const change of definition.plan.value.changes) {
        assertPathNode(binding.canonical_root, change.path, change.after);
    }
    injectWorkspaceCustodyFault(paths.faultInjection, afterWrite.name);
    const journalReceiptPath = path.join(
        selectionStagingRoot(paths, staging.staging_id),
        workspaceProtocolConfig.selectionPublication.publicationFile,
    );
    if (existsSync(journalReceiptPath)) {
        const retainedValue = readJson(journalReceiptPath) as Record<string, unknown>;
        if (typeof retainedValue.user_basis_after !== "string") throw selectionError("recovery");
        const retained = decodeScheduledSelectionPublicationReceipt(
            canonicalizeRecord(retainedValue as SemanticRecord),
            definition.plan,
            definition.schedule,
            previous,
            retainedValue.user_basis_after,
        );
        if ((await definition.observeUserBasis()) !== retained.value.user_basis_after) {
            throw selectionError("recovery");
        }
        publishSelectionReceipt(paths, retained);
        verifySelectionReceipt(paths, retained);
        injectWorkspaceCustodyFault(paths.faultInjection, postPublication.name);
        return retained;
    }
    const userBasisAfter = await definition.observeUserBasis();
    if (typeof userBasisAfter !== "string" || userBasisAfter.length === 0) {
        throw selectionError("recovery");
    }
    const receipt = encodeScheduledSelectionPublicationReceipt(
        definition.plan,
        definition.schedule,
        previous,
        userBasisAfter,
    );
    publishCanonicalFile(paths, journalReceiptPath, receipt.json, receipt.value);
    publishSelectionReceipt(paths, receipt);
    verifySelectionReceipt(paths, receipt);
    assertManifestEqual(
        head.manifest,
        captureTree(
            staging.staging_path,
            null,
            null,
            pathProtection(paths.workspaceRoot, base.binding_root),
        ),
    );
    injectWorkspaceCustodyFault(paths.faultInjection, postPublication.name);
    return receipt;
}

function publishCanonicalFile(
    paths: CarrierPaths,
    finalPath: string,
    canonical: string,
    value: object,
): void {
    const temporary = path.join(paths.staging, randomUUID());
    try {
        writeClosedDescriptor(temporary, value);
        linkSync(temporary, finalPath);
        syncDirectory(path.dirname(finalPath));
    } catch (error) {
        if (!existsSync(finalPath)) throw error;
        assert.equal(canonicalizeRecord(readJson(finalPath) as SemanticRecord), canonical);
    } finally {
        rmSync(temporary, { force: true });
    }
}

function publishSelectionStep(
    paths: CarrierPaths,
    stepsRoot: string,
    step: ScheduledSelectionPublicationStepEncoding,
): void {
    const finalPath = path.join(
        stepsRoot,
        identityToken(step.id, workspaceProtocolConfig.selectionPublication.scheduledStepIdPrefix),
    );
    publishCanonicalFile(paths, finalPath, step.json, step.value);
}

function publishSelectionReceipt(
    paths: CarrierPaths,
    receipt: ScheduledSelectionPublicationReceiptEncoding,
): void {
    const stagingRoot = createStaging(paths);
    try {
        const finalRoot = selectionPublicationRoot(paths, receipt.id);
        writeClosedDescriptor(
            path.join(stagingRoot, workspaceProtocolConfig.selectionPublication.publicationFile),
            receipt.value,
        );
        syncDirectory(stagingRoot);
        publishDirectory(paths, stagingRoot, finalRoot, () =>
            verifySelectionReceipt(paths, receipt),
        );
    } catch (error) {
        cleanupStaging(paths, stagingRoot);
        throw error;
    }
}

function verifySelectionReceipt(
    paths: CarrierPaths,
    receipt: ScheduledSelectionPublicationReceiptEncoding,
): void {
    const root = selectionPublicationRoot(paths, receipt.id);
    const retained = assertReceiptRoot(paths.selectionPublications, root);
    assert.equal(
        canonicalizeRecord(
            readJson(
                path.join(root, workspaceProtocolConfig.selectionPublication.publicationFile),
            ) as SemanticRecord,
        ),
        receipt.json,
    );
    assertReceiptRootStable(root, retained);
}

function applyPathChange(root: string, stagedRoot: string, change: WorldPathChange): void {
    const target = safeManagedPath(root, change.path);
    const before = change.before;
    const after = change.after;
    const source = after === null ? null : safeManagedPath(stagedRoot, change.path);
    if (before !== null && after !== null && before.kind === after.kind) {
        if (after.kind === DIRECTORY_KIND) {
            setDirectoryModeDurably(target, after.mode);
        } else {
            assert.ok(source);
            replaceLeaf(source, target, after);
        }
    } else {
        if (before !== null) removeManagedNode(target, before);
        if (after !== null) {
            assert.ok(source);
            createManagedNode(source, target, after);
        }
    }
    syncDirectory(path.dirname(target));
}

function replaceLeaf(
    source: string,
    target: string,
    node: Exclude<WorldChangeNode, { kind: typeof DIRECTORY_KIND }>,
): void {
    const temporary = path.join(path.dirname(target), `.${randomUUID()}`);
    try {
        createManagedNode(source, temporary, node);
        renameSync(temporary, target);
        syncDirectory(path.dirname(target));
    } finally {
        rmSync(temporary, { force: true });
    }
}

function createManagedNode(source: string, target: string, node: WorldChangeNode): void {
    if (node.kind === DIRECTORY_KIND) {
        mkdirSync(target, { mode: node.mode });
        setDirectoryModeDurably(target, node.mode);
        return;
    }
    if (node.kind === FILE_KIND) {
        const sourceStatus = lstatSync(source, { bigint: true });
        assert.equal(sourceStatus.isFile() && !sourceStatus.isSymbolicLink(), true);
        const bytes = readRegularFile(source, sourceStatus);
        assert.equal(
            digestId(workspaceProtocolConfig.carrier.blobIdPrefix, bytes),
            node.content_id,
        );
        const descriptor = openSync(target, "wx", node.mode);
        try {
            writeFileSync(descriptor, bytes);
            fchmodSync(descriptor, node.mode);
            fsyncSync(descriptor);
        } finally {
            closeSync(descriptor);
        }
        return;
    }
    assert.equal(readlinkSync(source), node.target);
    symlinkSync(node.target, target);
}

function removeManagedNode(target: string, node: WorldChangeNode): void {
    if (node.kind === DIRECTORY_KIND) rmdirSync(target);
    else unlinkSync(target);
}

function assertPathNode(
    root: string,
    relativePath: string,
    expected: WorldChangeNode | null,
): void {
    if (!sameNode(readPathNode(root, relativePath), expected)) throw selectionError("recovery");
}

function readPathNode(root: string, relativePath: string): WorldChangeNode | null {
    const target = managedPath(root, relativePath);
    let status: BigIntStats;
    try {
        status = lstatSync(target, { bigint: true });
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
    }
    if (status.isDirectory() && !status.isSymbolicLink()) {
        return { kind: DIRECTORY_KIND, mode: Number(status.mode & 0o777n) };
    }
    if (status.isFile() && !status.isSymbolicLink()) {
        const bytes = readRegularFile(target, status);
        return {
            byte_length: bytes.length,
            content_id: digestId(workspaceProtocolConfig.carrier.blobIdPrefix, bytes),
            kind: FILE_KIND,
            mode: Number(status.mode & 0o777n),
        };
    }
    if (status.isSymbolicLink()) {
        return { kind: SYMLINK_KIND, mode: null, target: readlinkSync(target) };
    }
    throw selectionError("unsupported");
}

function readRegularFile(filePath: string, retained: BigIntStats): Buffer {
    const descriptor = openSync(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
        assert.equal(stableStatus(retained, fstatSync(descriptor, { bigint: true })), true);
        const bytes = readFileSync(descriptor);
        assert.equal(stableStatus(retained, fstatSync(descriptor, { bigint: true })), true);
        assert.equal(stableStatus(retained, lstatSync(filePath, { bigint: true })), true);
        return bytes;
    } finally {
        closeSync(descriptor);
    }
}

function sameNode(left: WorldChangeNode | null, right: WorldChangeNode | null): boolean {
    return (
        canonicalizeRecord({ node: left } as unknown as SemanticRecord) ===
        canonicalizeRecord({ node: right } as unknown as SemanticRecord)
    );
}

function safeManagedPath(root: string, relativePath: string): string {
    const candidate = managedPath(root, relativePath);
    const parent = path.dirname(candidate);
    const parentStatus = lstatSync(parent);
    assert.equal(parentStatus.isDirectory() && !parentStatus.isSymbolicLink(), true);
    assert.equal(realpathSync(parent), parent);
    return candidate;
}

function managedPath(root: string, relativePath: string): string {
    const candidate = path.join(root, ...relativePath.split("/"));
    assert.equal(containsPath(root, candidate) && candidate !== root, true);
    return candidate;
}

function assertSelectionDirectory(directory: string): void {
    const status = lstatSync(directory);
    assert.equal(status.isDirectory() && !status.isSymbolicLink(), true);
    assert.equal(realpathSync(directory), directory);
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
    const protection = pathProtection(workspaceRoot, retainedBinding.canonical_root);
    try {
        const [sourceInspection, stagingWrite, sourceRevalidation, publication, postPublication] =
            workspaceProtocolConfig.platformConformance.faults.phases;
        assert.ok(
            sourceInspection &&
                stagingWrite &&
                sourceRevalidation &&
                publication &&
                postPublication,
        );
        injectWorkspaceCustodyFault(paths.faultInjection, sourceInspection.name);
        mkdirSync(stagedWorld);
        injectWorkspaceCustodyFault(paths.faultInjection, stagingWrite.name);
        const manifest = captureTree(
            sourceRoot,
            stagedWorld,
            captureControlPath,
            protection,
            sourceInspection.name,
        );
        assertManifestMetadataSupported(sourceRoot, manifest, sourceInspection.name);
        injectWorkspaceCustodyFault(paths.faultInjection, sourceRevalidation.name);
        const secondManifest = captureTree(
            sourceRoot,
            null,
            captureControlPath,
            protection,
            sourceRevalidation.name,
        );
        assertManifestMetadataSupported(sourceRoot, secondManifest, sourceRevalidation.name);
        assert.equal(
            canonicalManifest(manifest),
            canonicalManifest(secondManifest),
            "workspace binding changed during snapshot",
        );
        assertManifestEqual(manifest, captureTree(stagedWorld, null, null, protection));
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
        injectWorkspaceCustodyFault(paths.faultInjection, publication.name);
        publishDirectory(paths, stagingRoot, finalRoot, () =>
            assertRevisionPublicationEqual(paths, revisionId, descriptor),
        );
        injectWorkspaceCustodyFault(paths.faultInjection, postPublication.name);
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
    const revisionDescriptor = readOwnedRevisionDescriptor(paths, revisionId);
    verifyRevision(paths, revisionId);
    const custodyId =
        requestedCustodyId ?? `${workspaceProtocolConfig.carrier.custodyIdPrefix}${randomUUID()}`;
    const stagingRoot = createStaging(paths);
    const stagedWorld = path.join(stagingRoot, workspaceProtocolConfig.carrier.worldDirectory);
    try {
        mkdirSync(stagedWorld);
        const copied = captureTree(
            revision.path,
            stagedWorld,
            null,
            pathProtection(paths.workspaceRoot, revisionDescriptor.binding_root),
        );
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

function loadCustody(paths: CarrierPaths, custodyId: string, allowDiscarded = false): WorldCustody {
    const marker = discardMarker(paths, custodyId);
    if (!allowDiscarded && existsSync(marker)) {
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
    const manifest = captureTree(
        revision.path,
        null,
        null,
        pathProtection(paths.workspaceRoot, descriptor.binding_root),
    );
    assertManifestMetadataSupported(revision.path, manifest, SNAPSHOT_SOURCE_INSPECTION_PHASE_NAME);
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

function verifyCustody(
    paths: CarrierPaths,
    custodyId: string,
    allowDiscarded = false,
): WorldVerification {
    const custody = loadCustody(paths, custodyId, allowDiscarded);
    const descriptor = readOwnedRevisionDescriptor(paths, custody.base_revision_id);
    verifyRevision(paths, custody.base_revision_id);
    const manifest = captureTree(
        custody.path,
        null,
        null,
        pathProtection(paths.workspaceRoot, descriptor.binding_root),
    );
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
            verifyCustody(paths, custodyId, true);
            const cleanup = workspaceProtocolConfig.platformConformance.faults.phases[10];
            assert.ok(cleanup);
            injectWorkspaceCustodyFault(paths.faultInjection, cleanup.name);
            const status = lstatSync(root);
            /* node:coverage disable */
            if (!status.isDirectory() || status.isSymbolicLink()) {
                throw carrierError("control");
            }
            /* node:coverage enable */
            rmSync(root, { recursive: true });
            syncDirectory(paths.custodies);
        }
    } catch (error) {
        throwCarrierError(error);
    }
}

function pathProtection(
    workspaceRoot: string,
    bindingRoot: string,
): WorkspacePathProtectionAuthority {
    return { bindingRoot, workspaceRoot };
}

function assertChangesetPathsUnprotected(
    changeset: WorldChangeset,
    protection: WorkspacePathProtectionAuthority,
): void {
    for (const change of changeset.changes) {
        assertWorkspacePathUnprotected({ ...protection, path: change.path });
    }
}

function captureTree(
    sourceRoot: string,
    targetRoot: string | null,
    controlPath: string | null,
    protection: WorkspacePathProtectionAuthority,
    platformPhase = SNAPSHOT_SOURCE_INSPECTION_PHASE_NAME,
): readonly WorldManifestEntry[] {
    const manifest: WorldManifestEntry[] = [];
    const seenHardLinks = new Set<string>();
    walkDirectory(
        sourceRoot,
        targetRoot,
        "",
        controlPath,
        protection,
        platformPhase,
        manifest,
        seenHardLinks,
    );
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
    protection: WorkspacePathProtectionAuthority,
    platformPhase: string,
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
    assertWorkspaceNamesPortable(beforeNames, platformPhase);
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
        assertWorkspacePathUnprotected({ ...protection, path: relativePath });
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
                protection,
                platformPhase,
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

function assertManifestMetadataSupported(
    sourceRoot: string,
    manifest: readonly WorldManifestEntry[],
    phase: string,
): void {
    const ordinary = [sourceRoot];
    const symbolicLinks: string[] = [];
    for (const entry of manifest) {
        const candidate = path.join(sourceRoot, ...entry.path.split("/"));
        if (entry.kind === SYMLINK_KIND) symbolicLinks.push(candidate);
        else ordinary.push(candidate);
    }
    assertWorkspaceMetadataSupported(ordinary, phase);
    assertWorkspaceMetadataSupported(symbolicLinks, phase, true);
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

function selectionPublicationRoot(paths: CarrierPaths, publicationId: string): string {
    assertOwnedDirectory(paths, paths.selectionPublications);
    return identityRoot(
        paths.selectionPublications,
        publicationId,
        workspaceProtocolConfig.selectionPublication.scheduledPublicationIdPrefix,
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

function selectionError(kind: "basis" | "recovery" | "unsupported"): WorldCarrierError {
    const errors = workspaceProtocolConfig.selectionPublication.errors;
    const contracts = {
        basis: [errors.basisMovedCode, errors.basisMovedMessage],
        recovery: [errors.recoveryRequiredCode, errors.recoveryRequiredMessage],
        unsupported: [errors.unsupportedCode, errors.unsupportedMessage],
    } as const;
    const [code, message] = contracts[kind];
    return new WorldCarrierError(code, message);
}

function invokeCarrier<T>(operation: () => T): T {
    try {
        return operation();
    } catch (error) {
        throwCarrierError(error);
    }
}

function throwCarrierError(error: unknown): never {
    if (error instanceof WorldCarrierError || error instanceof WorkspaceProtectedPathError) {
        throw error;
    }
    throw carrierError("control", String(error));
}
