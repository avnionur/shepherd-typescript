import { isUtf8 } from "node:buffer";

import { workspaceProtocolConfig } from "../protocol/config.ts";
import {
    WORLD_DERIVED_MOVE_KINDS,
    WORLD_ENTRY_KINDS,
    WORLD_TEXT_PREVIEW_CLASSIFICATIONS,
    WORLD_TEXT_PREVIEW_ENCODING,
} from "../protocol/values.generated.ts";
import { createVerifiedWorldChangeset } from "./changesets.ts";
import { WorldChangesetError } from "./errors.ts";
import { readReferenceCopyRevisionBlob } from "./reference-copy-carrier.ts";
import type {
    WorldChangesetInspection,
    WorldChangesetInspectionOptions,
    WorldChangesetPage,
    WorldChangesetPageOptions,
    WorldContentRead,
    WorldContentReadOptions,
    WorldDerivedMove,
    WorldPathChange,
    WorldTextPreview,
    WorldTextPreviewOptions,
} from "./types.ts";

type ContentSource = {
    readonly byteLength: number;
    readonly contentId: string;
    readonly path: string;
    readonly revisionId: string;
};
type FileChangeNode = Extract<
    NonNullable<WorldPathChange["after"]>,
    { readonly kind: (typeof WORLD_ENTRY_KINDS)[1] }
>;
type FileAddition = WorldPathChange & { readonly after: FileChangeNode; readonly before: null };

const [TEXT_CLASSIFICATION, BINARY_CLASSIFICATION] = WORLD_TEXT_PREVIEW_CLASSIFICATIONS;
const FILE_KIND = WORLD_ENTRY_KINDS[1];
const [RENAME_KIND, COPY_KIND] = WORLD_DERIVED_MOVE_KINDS;

/**
 * Opens an authenticated read-only inspection of two retained world revisions.
 *
 * Authentication uses the same carrier-owned revision verification as canonical changeset
 * creation. Lookup and pagination use the frozen projection; bounded content methods authenticate
 * exact retained blobs without consulting the user workspace.
 *
 * @param options - Exact retained base/head revisions and their owning carrier.
 * @returns A frozen inspection with lookup, pagination, content, preview, and move projections.
 * @throws {WorldChangesetError} If revisions, carrier evidence, requests, or retained bytes fail.
 *
 * @example
 * ```ts
 * const inspection = await createWorldChangesetInspection({
 *   baseRevision,
 *   carrier,
 *   headRevision,
 * });
 * console.log(inspection.change("src/index.ts"));
 * ```
 */
export async function createWorldChangesetInspection(
    options: WorldChangesetInspectionOptions,
): Promise<WorldChangesetInspection> {
    const evidence = await createVerifiedWorldChangeset(options);
    const { baseRevision, carrier, changeset, headRevision } = evidence;
    const byPath = new Map(changeset.changes.map((change) => [change.path, change]));
    const derivedMoves = deriveMoves(changeset.changes, baseRevision, headRevision);
    const contentSources = new Map<string, ContentSource>();
    for (const change of changeset.changes) {
        if (change.before?.kind === FILE_KIND)
            contentSources.set(change.before.content_id, {
                byteLength: change.before.byte_length,
                contentId: change.before.content_id,
                path: change.path,
                revisionId: changeset.base_revision_id,
            });
        if (change.after?.kind === FILE_KIND)
            contentSources.set(change.after.content_id, {
                byteLength: change.after.byte_length,
                contentId: change.after.content_id,
                path: change.path,
                revisionId: changeset.head_revision_id,
            });
    }
    const readSource = (contentId: string): { bytes: Buffer; source: ContentSource } => {
        const source = contentSources.get(contentId);
        if (source === undefined) throw invalid("content identity is not cited by this changeset");
        const bytes = readReferenceCopyRevisionBlob(
            carrier,
            source.revisionId,
            source.path,
            source.contentId,
            source.byteLength,
        );
        return { bytes, source };
    };
    return Object.freeze({
        change: (path: string): WorldPathChange | null => {
            if (!isCanonicalPath(path)) throw invalid("inspection path is invalid");
            return byPath.get(path) ?? null;
        },
        changeset,
        derivedMoves: (): readonly WorldDerivedMove[] => derivedMoves,
        inspection_version: workspaceProtocolConfig.changesetInspection.version,
        page: (pageOptions?: WorldChangesetPageOptions): WorldChangesetPage => {
            try {
                const { limit, offset } = readPageOptions(pageOptions);
                const changes = Object.freeze(changeset.changes.slice(offset, offset + limit));
                const next = offset + changes.length;
                return Object.freeze({
                    changes,
                    next_offset: next < changeset.changes.length ? next : null,
                    offset,
                    total: changeset.changes.length,
                });
            } catch (error) {
                if (error instanceof WorldChangesetError) throw error;
                throw invalid(error instanceof Error ? error.message : undefined);
            }
        },
        previewText: async (previewOptions: WorldTextPreviewOptions): Promise<WorldTextPreview> => {
            try {
                const { contentId, maxBytes, maxLines } = readPreviewOptions(previewOptions);
                const { bytes, source } = readSource(contentId);
                const selected = bytes.subarray(0, maxBytes);
                if (bytes.includes(0) || !isUtf8(bytes))
                    return Object.freeze({
                        byte_length: source.byteLength,
                        classification: BINARY_CLASSIFICATION,
                        content_id: source.contentId,
                        encoding: null,
                        text: null,
                        truncated: source.byteLength > 0,
                    });
                const decoded = new TextDecoder(WORLD_TEXT_PREVIEW_ENCODING, {
                    fatal: true,
                }).decode(selected, { stream: selected.length < bytes.length });
                const lines = truncateLines(decoded, maxLines);
                return Object.freeze({
                    byte_length: source.byteLength,
                    classification: TEXT_CLASSIFICATION,
                    content_id: source.contentId,
                    encoding: WORLD_TEXT_PREVIEW_ENCODING,
                    text: lines.text,
                    truncated: selected.length < bytes.length || lines.truncated,
                });
            } catch (error) {
                if (error instanceof WorldChangesetError) throw error;
                throw invalid(error instanceof Error ? error.message : undefined);
            }
        },
        readContent: async (readOptions: WorldContentReadOptions): Promise<WorldContentRead> => {
            try {
                const { contentId, length, offset } = readContentOptions(readOptions);
                const { bytes, source } = readSource(contentId);
                if (offset > bytes.length) throw invalid("content offset exceeds byte length");
                const selected = bytes.subarray(offset, offset + length);
                return Object.freeze({
                    bytes: Uint8Array.from(selected),
                    content_id: source.contentId,
                    offset,
                    total_bytes: source.byteLength,
                    truncated: offset + selected.length < source.byteLength,
                });
            } catch (error) {
                if (error instanceof WorldChangesetError) throw error;
                throw invalid(error instanceof Error ? error.message : undefined);
            }
        },
    });
}

function deriveMoves(
    changes: readonly WorldPathChange[],
    baseRevision: WorldChangesetInspectionOptions["baseRevision"],
    headRevision: WorldChangesetInspectionOptions["headRevision"],
): readonly WorldDerivedMove[] {
    const baseSources = new Map<string, string[]>();
    for (const entry of baseRevision.manifest) {
        if (entry.kind !== FILE_KIND) continue;
        const blobId = entry.blob_id as string;
        const paths = baseSources.get(blobId) ?? [];
        paths.push(entry.path);
        baseSources.set(blobId, paths);
    }
    const headPaths = new Set(
        headRevision.manifest
            .filter((entry) => entry.kind === FILE_KIND)
            .map((entry) => entry.path),
    );
    const additions = changes.filter(isFileAddition);
    const additionsByContent = new Map<string, number>();
    let candidateCount = 0;
    for (const addition of additions) {
        const after = addition.after;
        const sources = baseSources.get(after.content_id) ?? [];
        candidateCount += sources.length;
        if (candidateCount > workspaceProtocolConfig.changesetInspection.maxDerivedMoveCandidates)
            throw limit();
        additionsByContent.set(
            after.content_id,
            (additionsByContent.get(after.content_id) ?? 0) + 1,
        );
    }
    const deletedPaths = new Set(
        changes
            .filter((change) => change.before?.kind === FILE_KIND && change.after === null)
            .map((change) => change.path),
    );
    const projections: WorldDerivedMove[] = [];
    for (const addition of additions) {
        const after = addition.after;
        const sources = baseSources.get(after.content_id) ?? [];
        if (sources.length !== 1) continue;
        const source = sources[0] as string;
        if (deletedPaths.has(source)) {
            if (additionsByContent.get(after.content_id) !== 1) continue;
            projections.push(
                Object.freeze({
                    content_id: after.content_id,
                    kind: RENAME_KIND,
                    source_path: source,
                    target_path: addition.path,
                }),
            );
        } else if (headPaths.has(source)) {
            projections.push(
                Object.freeze({
                    content_id: after.content_id,
                    kind: COPY_KIND,
                    source_path: source,
                    target_path: addition.path,
                }),
            );
        }
    }
    return Object.freeze(projections);
}

function isFileAddition(change: WorldPathChange): change is FileAddition {
    return change.before === null && change.after?.kind === FILE_KIND;
}

function readContentOptions(value: WorldContentReadOptions): {
    contentId: string;
    length: number;
    offset: number;
} {
    const fields = exactOptionValues(value, ["contentId", "length", "offset"]);
    if (typeof fields.contentId !== "string") throw invalid("content read is invalid");
    const length = readOptionalBound(
        fields.length,
        workspaceProtocolConfig.changesetInspection.defaultReadBytes,
        workspaceProtocolConfig.changesetInspection.maxReadBytes,
    );
    const offset = fields.offset === undefined ? 0 : Number(fields.offset);
    if (!Number.isSafeInteger(offset) || offset < 0) throw invalid("content read is invalid");
    return { contentId: fields.contentId, length, offset };
}

function readPreviewOptions(value: WorldTextPreviewOptions): {
    contentId: string;
    maxBytes: number;
    maxLines: number;
} {
    const fields = exactOptionValues(value, ["contentId", "maxBytes", "maxLines"]);
    if (typeof fields.contentId !== "string") throw invalid("text preview is invalid");
    return {
        contentId: fields.contentId,
        maxBytes: readOptionalBound(
            fields.maxBytes,
            workspaceProtocolConfig.changesetInspection.defaultPreviewBytes,
            workspaceProtocolConfig.changesetInspection.maxPreviewBytes,
        ),
        maxLines: readOptionalBound(
            fields.maxLines,
            workspaceProtocolConfig.changesetInspection.defaultPreviewLines,
            workspaceProtocolConfig.changesetInspection.maxPreviewLines,
        ),
    };
}

function exactOptionValues(
    value: unknown,
    allowedKeys: readonly string[],
): Record<string, unknown> {
    if (
        value === null ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
        Reflect.ownKeys(value).some((key) => typeof key === "symbol") ||
        Object.keys(value).some((key) => !allowedKeys.includes(key))
    )
        throw invalid("inspection options are invalid");
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.values(descriptors).some((descriptor) => !("value" in descriptor)))
        throw invalid("inspection options are invalid");
    const fields: Record<string, unknown> = {};
    for (const [key, descriptor] of Object.entries(descriptors)) {
        fields[key] = descriptor.value;
    }
    return fields;
}

function readOptionalBound(value: unknown, defaultValue: number, maximum: number): number {
    const selected = value === undefined ? defaultValue : Number(value);
    if (!Number.isSafeInteger(selected) || selected <= 0 || selected > maximum)
        throw invalid("inspection bound is invalid");
    return selected;
}

function truncateLines(value: string, maximum: number): { text: string; truncated: boolean } {
    let lines = 0;
    for (let index = 0; index < value.length; index += 1) {
        if (value[index] !== "\n") continue;
        lines += 1;
        if (lines === maximum && index + 1 < value.length)
            return { text: value.slice(0, index + 1), truncated: true };
    }
    return { text: value, truncated: false };
}

function readPageOptions(value: WorldChangesetPageOptions | undefined): {
    limit: number;
    offset: number;
} {
    if (value === undefined)
        return { limit: workspaceProtocolConfig.changesetInspection.defaultPageSize, offset: 0 };
    if (
        value === null ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
        Reflect.ownKeys(value).some((key) => typeof key === "symbol") ||
        Object.keys(value).some((key) => key !== "limit" && key !== "offset")
    )
        throw invalid("inspection page is invalid");
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (
        Object.values(descriptors).some((descriptor) => !("value" in descriptor)) ||
        (descriptors.limit !== undefined &&
            (!Number.isSafeInteger(descriptors.limit.value) ||
                Number(descriptors.limit.value) <= 0 ||
                Number(descriptors.limit.value) >
                    workspaceProtocolConfig.changesetInspection.maxPageSize)) ||
        (descriptors.offset !== undefined &&
            (!Number.isSafeInteger(descriptors.offset.value) ||
                Number(descriptors.offset.value) < 0))
    )
        throw invalid("inspection page is invalid");
    return {
        limit:
            descriptors.limit === undefined
                ? workspaceProtocolConfig.changesetInspection.defaultPageSize
                : Number(descriptors.limit.value),
        offset: descriptors.offset === undefined ? 0 : Number(descriptors.offset.value),
    };
}

function isCanonicalPath(value: unknown): value is string {
    return (
        typeof value === "string" &&
        value.length > 0 &&
        !value.startsWith("/") &&
        !value.endsWith("/") &&
        !value.includes("\\") &&
        !value.includes("\0") &&
        Buffer.byteLength(value) <= workspaceProtocolConfig.changesets.maxPathBytes &&
        value
            .split("/")
            .every(
                (part) =>
                    part !== "" &&
                    part !== "." &&
                    part !== ".." &&
                    part !== workspaceProtocolConfig.controlDirectory,
            ) &&
        !/[\uD800-\uDFFF]/u.test(value.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/gu, ""))
    );
}

function invalid(detail?: string): WorldChangesetError {
    const error = workspaceProtocolConfig.changesets.errors;
    return new WorldChangesetError(
        error.invalidCode,
        detail === undefined ? error.invalidMessage : `${error.invalidMessage}: ${detail}`,
    );
}

function limit(): WorldChangesetError {
    const error = workspaceProtocolConfig.changesets.errors;
    return new WorldChangesetError(error.limitCode, error.limitMessage);
}
