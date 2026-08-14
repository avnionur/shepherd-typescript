import { createHash } from "node:crypto";

import {
    canonicalizeRecord,
    createRecordId,
    type SemanticRecord,
} from "../canonical/canonical-record.ts";
import { workspaceProtocolConfig } from "../protocol/config.ts";
import { WORLD_CHANGE_OPERATIONS, WORLD_ENTRY_KINDS } from "../protocol/values.generated.ts";
import { WorldChangesetError } from "./errors.ts";
import { assertReferenceCopyCarrier } from "./reference-copy-carrier.ts";
import type {
    ReferenceCopyCarrier,
    WorldChangeNode,
    WorldChangeOperation,
    WorldChangeset,
    WorldChangesetOptions,
    WorldManifestEntry,
    WorldPathChange,
    WorldRevision,
} from "./types.ts";

const ADD = WORLD_CHANGE_OPERATIONS[0];
const DELETE = WORLD_CHANGE_OPERATIONS[1];
const MODIFY = WORLD_CHANGE_OPERATIONS[2];
const REPLACE = WORLD_CHANGE_OPERATIONS[3];

/**
 * Constructs an immutable, content-addressed comparison of two verified world revisions.
 *
 * The comparison reads only retained carrier custody, never the user workspace, and mutates
 * neither revision. Each change reconstructs the head manifest from the base manifest exactly.
 *
 * @param options - Exact ordered base and head revisions for one binding.
 * @returns A frozen canonical changeset with derived changed paths.
 * @throws {WorldChangesetError} If either revision is malformed, inconsistent, cross-binding, or
 * exceeds configured changeset limits.
 *
 * @example
 * ```ts
 * const changeset = await createWorldChangeset({ baseRevision, carrier, headRevision });
 * console.log(changeset.changed_paths);
 * ```
 */
export async function createWorldChangeset(
    options: WorldChangesetOptions,
): Promise<WorldChangeset> {
    return (await createVerifiedWorldChangeset(options)).changeset;
}

/** Authenticated retained revisions and canonical comparison used by package projections. @internal */
export type VerifiedWorldChangeset = {
    readonly baseRevision: WorldRevision;
    readonly carrier: ReferenceCopyCarrier;
    readonly changeset: WorldChangeset;
    readonly headRevision: WorldRevision;
};

/** @internal Creates a canonical changeset and returns its exact authenticated carrier evidence. */
export async function createVerifiedWorldChangeset(
    options: WorldChangesetOptions,
): Promise<VerifiedWorldChangeset> {
    try {
        const optionFields = exactObject(options, ["baseRevision", "carrier", "headRevision"]);
        const base = validateRevision(optionFields.baseRevision as WorldRevision);
        const head = validateRevision(optionFields.headRevision as WorldRevision);
        const carrier = optionFields.carrier as ReferenceCopyCarrier;
        assertReferenceCopyCarrier(carrier);
        if (base.binding_id !== head.binding_id) fail("revisions cite different bindings");
        const baseEntries = new Map(base.manifest.map((entry) => [entry.path, entry]));
        const headEntries = new Map(head.manifest.map((entry) => [entry.path, entry]));
        const paths = [...new Set([...baseEntries.keys(), ...headEntries.keys()])].sort(
            comparePath,
        );
        const changes: WorldPathChange[] = [];
        let referencedBytes = 0;
        for (const path of paths) {
            const beforeEntry = baseEntries.get(path);
            const afterEntry = headEntries.get(path);
            if (
                beforeEntry !== undefined &&
                afterEntry !== undefined &&
                sameEntry(beforeEntry, afterEntry)
            )
                continue;
            const before = beforeEntry === undefined ? null : worldChangeNodeOf(beforeEntry);
            const after = afterEntry === undefined ? null : worldChangeNodeOf(afterEntry);
            const operation = worldChangeOperationOf(before, after);
            referencedBytes += referencedSize(before) + referencedSize(after);
            changes.push(Object.freeze({ after, before, operation, path }));
        }
        enforceLimits(changes, referencedBytes);
        const semantic = {
            base_revision_id: base.revision_id,
            binding_id: base.binding_id,
            changes: changes as unknown as SemanticRecord["changes"],
            head_revision_id: head.revision_id,
            schema_version: workspaceProtocolConfig.changesets.version,
        };
        const canonical = canonicalizeRecord(semantic);
        if (Buffer.byteLength(canonical) > workspaceProtocolConfig.changesets.maxRecordBytes)
            limit();
        const retainedBase = await carrier.openRevision(base.revision_id);
        const retainedHead = await carrier.openRevision(head.revision_id);
        await carrier.verifyRevision(base.revision_id);
        await carrier.verifyRevision(head.revision_id);
        if (
            canonicalizeRecord(base as unknown as SemanticRecord) !==
                canonicalizeRecord(retainedBase as unknown as SemanticRecord) ||
            canonicalizeRecord(head as unknown as SemanticRecord) !==
                canonicalizeRecord(retainedHead as unknown as SemanticRecord)
        )
            fail("revision does not match retained carrier evidence");
        const digest = createHash(workspaceProtocolConfig.digestAlgorithm)
            .update(canonical)
            .digest("hex");
        const changedPaths = Object.freeze(changes.map((change) => change.path));
        const changeset = Object.freeze({
            ...semantic,
            changes: Object.freeze(changes),
            changed_paths: changedPaths,
            changeset_id: `${workspaceProtocolConfig.changesets.idPrefix}${digest}`,
        }) as WorldChangeset;
        return Object.freeze({
            baseRevision: retainedBase,
            carrier,
            changeset,
            headRevision: retainedHead,
        });
    } catch (error) {
        if (error instanceof WorldChangesetError) throw error;
        throw invalid(error instanceof Error ? error.message : undefined);
    }
}

function validateRevision(value: WorldRevision): WorldRevision {
    const fields = exactObject(value, [
        "backend",
        "basis_ref",
        "binding_id",
        "capture_kind",
        "content_id",
        "descriptor_version",
        "manifest",
        "parent_revision_id",
        "path",
        "revision_id",
    ]);
    if (
        !Array.isArray(fields.manifest) ||
        Object.keys(fields.manifest).length !== fields.manifest.length
    )
        fail("revision manifest must be a dense array");
    if (fields.manifest.length > workspaceProtocolConfig.changesets.maxManifestEntries) limit();
    const manifest = fields.manifest.map(validateEntry);
    for (let index = 1; index < manifest.length; index += 1) {
        const previous = manifest[index - 1] as WorldManifestEntry;
        const current = manifest[index] as WorldManifestEntry;
        if (comparePath(previous.path, current.path) >= 0) fail("manifest is not canonical");
    }
    validateAncestors(manifest);
    const manifestRecord = canonicalizeRecord({
        entries: manifest as unknown as SemanticRecord["entries"],
        manifest_version: workspaceProtocolConfig.carrier.manifestVersion,
    });
    if (
        Buffer.byteLength(manifestRecord) >
        workspaceProtocolConfig.changesets.maxManifestRecordBytes
    )
        limit();
    const contentId = digestId(
        workspaceProtocolConfig.carrier.worldContentIdPrefix,
        manifestRecord,
    );
    if (fields.content_id !== contentId) fail("revision content identity is invalid");
    if (
        typeof fields.binding_id !== "string" ||
        typeof fields.revision_id !== "string" ||
        typeof fields.backend !== "string" ||
        fields.capture_kind !== workspaceProtocolConfig.carrier.captureKind ||
        fields.descriptor_version !== workspaceProtocolConfig.carrier.descriptorVersion ||
        !(fields.basis_ref === null || typeof fields.basis_ref === "string") ||
        !(fields.parent_revision_id === null || typeof fields.parent_revision_id === "string") ||
        typeof fields.path !== "string"
    )
        fail("revision descriptor is invalid");
    const semanticId = createRecordId({
        basis_ref: fields.basis_ref as string | null,
        binding_id: fields.binding_id,
        capture_kind: fields.capture_kind,
        content_id: contentId,
        descriptor_version: fields.descriptor_version,
        manifest_version: workspaceProtocolConfig.carrier.manifestVersion,
        parent_revision_id: fields.parent_revision_id as string | null,
    });
    const revisionId = `${workspaceProtocolConfig.carrier.revisionIdPrefix}${semanticId.slice(semanticId.lastIndexOf(":") + 1)}`;
    if (fields.revision_id !== revisionId) fail("revision identity is invalid");
    return { ...fields, manifest } as unknown as WorldRevision;
}

function validateEntry(value: unknown): WorldManifestEntry {
    const fields = exactObject(value, [
        "blob_id",
        "kind",
        "mode",
        "path",
        "size",
        "symlink_target",
    ]);
    if (
        typeof fields.path !== "string" ||
        !validPath(fields.path) ||
        !WORLD_ENTRY_KINDS.includes(fields.kind as never)
    )
        fail("manifest entry path or kind is invalid");
    const bytes = Buffer.byteLength(fields.path);
    if (bytes > workspaceProtocolConfig.changesets.maxPathBytes) limit();
    if (fields.kind === WORLD_ENTRY_KINDS[0]) {
        if (
            !isMode(fields.mode) ||
            fields.blob_id !== null ||
            fields.size !== null ||
            fields.symlink_target !== null
        )
            fail();
    } else if (fields.kind === WORLD_ENTRY_KINDS[1]) {
        if (
            !isMode(fields.mode) ||
            typeof fields.blob_id !== "string" ||
            !validDigest(fields.blob_id, workspaceProtocolConfig.carrier.blobIdPrefix) ||
            !Number.isSafeInteger(fields.size) ||
            Number(fields.size) < 0 ||
            fields.symlink_target !== null
        )
            fail();
        if (Number(fields.size) > workspaceProtocolConfig.changesets.maxSingleBlobBytes) limit();
    } else {
        if (
            fields.mode !== null ||
            fields.blob_id !== null ||
            fields.size !== null ||
            typeof fields.symlink_target !== "string"
        )
            fail();
        if (
            Buffer.byteLength(fields.symlink_target) >
            workspaceProtocolConfig.changesets.maxSymlinkTargetBytes
        )
            limit();
    }
    return fields as WorldManifestEntry;
}

/** @internal Projects one authenticated carrier-manifest entry into canonical changeset state. */
export function worldChangeNodeOf(entry: WorldManifestEntry): WorldChangeNode {
    if (entry.kind === WORLD_ENTRY_KINDS[0])
        return Object.freeze({ kind: WORLD_ENTRY_KINDS[0], mode: entry.mode as number });
    if (entry.kind === WORLD_ENTRY_KINDS[1])
        return Object.freeze({
            byte_length: entry.size as number,
            content_id: entry.blob_id as string,
            kind: WORLD_ENTRY_KINDS[1],
            mode: entry.mode as number,
        });
    return Object.freeze({
        kind: WORLD_ENTRY_KINDS[2],
        mode: null,
        target: entry.symlink_target as string,
    });
}

/** @internal Derives the canonical operation for two authenticated path states. */
export function worldChangeOperationOf(
    before: WorldChangeNode | null,
    after: WorldChangeNode | null,
): WorldChangeOperation {
    if (before === null) return ADD;
    if (after === null) return DELETE;
    return before.kind === after.kind ? MODIFY : REPLACE;
}

function sameEntry(left: WorldManifestEntry, right: WorldManifestEntry): boolean {
    return (
        left.kind === right.kind &&
        left.mode === right.mode &&
        left.blob_id === right.blob_id &&
        left.size === right.size &&
        left.symlink_target === right.symlink_target
    );
}

function validateAncestors(manifest: readonly WorldManifestEntry[]): void {
    const entries = new Map(manifest.map((entry) => [entry.path, entry]));
    for (const entry of manifest) {
        const parts = entry.path.split("/");
        for (let index = 1; index < parts.length; index += 1) {
            if (entries.get(parts.slice(0, index).join("/"))?.kind !== WORLD_ENTRY_KINDS[0])
                fail("manifest ancestor is absent or not a directory");
        }
    }
}

function enforceLimits(changes: readonly WorldPathChange[], referencedBytes: number): void {
    if (
        changes.length > workspaceProtocolConfig.changesets.maxChanges ||
        referencedBytes > workspaceProtocolConfig.changesets.maxAggregateReferencedBytes
    )
        limit();
}

function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
    if (
        value === null ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
        Reflect.ownKeys(value).some((key) => typeof key === "symbol")
    )
        fail();
    for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor === undefined || !("value" in descriptor)) fail();
    }
    if (Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) fail();
    return value as Record<string, unknown>;
}

function validPath(value: string): boolean {
    return (
        value.length > 0 &&
        !value.startsWith("/") &&
        !value.endsWith("/") &&
        !value.includes("\\") &&
        !value.includes("\0") &&
        value
            .split("/")
            .every(
                (part) =>
                    part !== "" &&
                    part !== "." &&
                    part !== ".." &&
                    part !== workspaceProtocolConfig.controlDirectory,
            ) &&
        isWellFormed(value)
    );
}
function isWellFormed(value: string): boolean {
    return !/[\uD800-\uDFFF]/u.test(value.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/gu, ""));
}
function isMode(value: unknown): value is number {
    return Number.isSafeInteger(value) && Number(value) >= 0;
}
function validDigest(value: string, prefix: string): boolean {
    return (
        value.startsWith(prefix) &&
        value.length === prefix.length + workspaceProtocolConfig.hexLength &&
        /^[0-9a-f]+$/u.test(value.slice(prefix.length))
    );
}
function comparePath(left: string, right: string): number {
    return Buffer.from(left).compare(Buffer.from(right));
}
function referencedSize(node: WorldChangeNode | null): number {
    return node?.kind === "file" ? node.byte_length : 0;
}
function digestId(prefix: string, value: string): string {
    return `${prefix}${createHash(workspaceProtocolConfig.digestAlgorithm).update(value).digest("hex")}`;
}
function fail(detail?: string): never {
    throw invalid(detail);
}
function invalid(detail?: string): WorldChangesetError {
    const error = workspaceProtocolConfig.changesets.errors;
    return new WorldChangesetError(
        error.invalidCode,
        detail === undefined ? error.invalidMessage : `${error.invalidMessage}: ${detail}`,
    );
}
function limit(): never {
    const error = workspaceProtocolConfig.changesets.errors;
    throw new WorldChangesetError(error.limitCode, error.limitMessage);
}
