import { canonicalizeRecord, type SemanticRecord } from "../canonical/canonical-record.ts";
import { workspaceProtocolConfig } from "../protocol/config.ts";
import {
    GIT_SYMLINK_MODE,
    GITLINK_ENTRY_KIND,
    GITLINK_MODE,
    WORLD_CHANGE_OPERATIONS,
    WORLD_ENTRY_KINDS,
} from "../protocol/values.generated.ts";
import { createWorldChangesetInspection } from "./changeset-inspection.ts";
import { worldChangeNodeOf } from "./changesets.ts";
import { WorldChangesetError } from "./errors.ts";
import { createGitAwareCustody } from "./git-aware-custody.ts";
import { createReferenceCopyCarrierForRetainedCustody } from "./reference-copy-carrier.ts";
import type {
    GitChangesetInspection,
    GitChangesetInspectionOptions,
    GitChangesetNode,
    GitChangesetPathChange,
    GitIndexEntry,
    GitRetainedOutput,
    GitSymlinkModePresentation,
    WorldManifestEntry,
} from "./types.ts";

const SYMLINK_KIND = WORLD_ENTRY_KINDS[2];
const [ADD, DELETE, MODIFY, REPLACE] = WORLD_CHANGE_OPERATIONS;

/**
 * Opens an authenticated Git-aware changeset projection over two retained outputs.
 *
 * The canonical copy-world changeset remains authoritative. Gitlink commit citations and retained
 * symbolic-link modes are read-only presentation evidence and never affect its identity.
 *
 * @param options - Exact retained Git custody identities and their initialized workspace.
 * @returns Frozen canonical world inspection plus Git-aware presentation changes.
 * @throws {WorldChangesetError} If retained carrier or Git evidence is unavailable or inconsistent.
 *
 * @example
 * ```ts
 * const inspection = await createGitChangesetInspection({
 *   baseCustodyId,
 *   headCustodyId,
 *   workspaceRoot,
 * });
 * console.log(inspection.git_changes);
 * ```
 */
export async function createGitChangesetInspection(
    options: GitChangesetInspectionOptions,
): Promise<GitChangesetInspection> {
    try {
        const fields = readOptions(options);
        const custody = createGitAwareCustody({ workspaceRoot: fields.workspaceRoot });
        const [base, head] = await openOutputs(
            custody.open,
            fields.baseCustodyId,
            fields.headCustodyId,
        );
        const carrier = createReferenceCopyCarrierForRetainedCustody({
            workspaceRoot: fields.workspaceRoot,
        });
        const world = await createWorldChangesetInspection({
            baseRevision: base.revision,
            carrier,
            headRevision: head.revision,
        });
        const gitChanges = projectGitChanges(base, head);
        const symlinkModes = projectSymlinkModes(base, head, world.changeset.changes);
        return Object.freeze({
            git_changes: gitChanges,
            inspection_version: workspaceProtocolConfig.changesetInspection.version,
            symlink_modes: symlinkModes,
            world,
        });
    } catch (error) {
        if (error instanceof WorldChangesetError) throw error;
        throw invalid(error instanceof Error ? error.message : undefined);
    }
}

async function openOutputs(
    open: (custodyId: string) => Promise<GitRetainedOutput>,
    baseCustodyId: string,
    headCustodyId: string,
): Promise<readonly [GitRetainedOutput, GitRetainedOutput]> {
    const identifiers = [baseCustodyId, headCustodyId] as const;
    const outputs: GitRetainedOutput[] = [];
    let cursor = 0;
    const workers = Array.from(
        {
            length: Math.min(
                workspaceProtocolConfig.changesetInspection.maxVerificationConcurrency,
                identifiers.length,
            ),
        },
        async () => {
            while (cursor < identifiers.length) {
                const index = cursor;
                cursor += 1;
                outputs[index] = await open(identifiers[index] as string);
            }
        },
    );
    await Promise.all(workers);
    return [outputs[0] as GitRetainedOutput, outputs[1] as GitRetainedOutput];
}

function projectGitChanges(
    base: GitRetainedOutput,
    head: GitRetainedOutput,
): readonly GitChangesetPathChange[] {
    const baseGitlinks = gitlinkEntries(base);
    const headGitlinks = gitlinkEntries(head);
    const baseWorld = new Map(base.revision.manifest.map((entry) => [entry.path, entry]));
    const headWorld = new Map(head.revision.manifest.map((entry) => [entry.path, entry]));
    const paths = [...new Set([...baseGitlinks.keys(), ...headGitlinks.keys()])].sort(comparePath);
    const changes: GitChangesetPathChange[] = [];
    for (const path of paths) {
        const before = projectedNode(baseGitlinks.get(path), baseWorld.get(path));
        const after = projectedNode(headGitlinks.get(path), headWorld.get(path));
        if (sameNode(before, after)) continue;
        changes.push(
            Object.freeze({
                after,
                before,
                operation:
                    before === null
                        ? ADD
                        : after === null
                          ? DELETE
                          : before.kind === after.kind
                            ? MODIFY
                            : REPLACE,
                path,
            }),
        );
    }
    return Object.freeze(changes);
}

function projectSymlinkModes(
    base: GitRetainedOutput,
    head: GitRetainedOutput,
    worldChanges: readonly {
        readonly before: GitChangesetNode | null;
        readonly after: GitChangesetNode | null;
        readonly path: string;
    }[],
): readonly GitSymlinkModePresentation[] {
    const baseIndex = indexEntries(base);
    const headIndex = indexEntries(head);
    const modes: GitSymlinkModePresentation[] = [];
    for (const change of worldChanges) {
        if (change.before?.kind !== SYMLINK_KIND && change.after?.kind !== SYMLINK_KIND) continue;
        const beforeMode = baseIndex.get(change.path)?.mode;
        const afterMode = headIndex.get(change.path)?.mode;
        modes.push(
            Object.freeze({
                after_mode: afterMode === GIT_SYMLINK_MODE ? afterMode : null,
                before_mode: beforeMode === GIT_SYMLINK_MODE ? beforeMode : null,
                path: change.path,
            }),
        );
    }
    return Object.freeze(modes);
}

function gitlinkEntries(output: GitRetainedOutput): Map<string, GitIndexEntry> {
    return new Map([...indexEntries(output)].filter(([, entry]) => entry.mode === GITLINK_MODE));
}

function indexEntries(output: GitRetainedOutput): Map<string, GitIndexEntry> {
    return new Map(
        (output.basis.index?.entries ?? [])
            .filter((entry) => entry.stage === 0)
            .map((entry) => [entry.path, entry]),
    );
}

function projectedNode(
    gitlink: GitIndexEntry | undefined,
    world: WorldManifestEntry | undefined,
): GitChangesetNode | null {
    if (gitlink !== undefined)
        return Object.freeze({
            commit_oid: gitlink.object_id,
            kind: GITLINK_ENTRY_KIND,
            mode: gitlink.mode,
        });
    return world === undefined ? null : worldChangeNodeOf(world);
}

function sameNode(left: GitChangesetNode | null, right: GitChangesetNode | null): boolean {
    return (
        canonicalizeRecord({ node: left as unknown as SemanticRecord["node"] }) ===
        canonicalizeRecord({ node: right as unknown as SemanticRecord["node"] })
    );
}

function readOptions(options: GitChangesetInspectionOptions): {
    baseCustodyId: string;
    headCustodyId: string;
    workspaceRoot: string;
} {
    if (
        options === null ||
        typeof options !== "object" ||
        Array.isArray(options) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(options)) ||
        Reflect.ownKeys(options).some((key) => typeof key === "symbol")
    )
        throw invalid("Git inspection options are invalid");
    const descriptors = Object.getOwnPropertyDescriptors(options);
    if (
        Object.keys(descriptors).sort().join("\0") !==
            ["baseCustodyId", "headCustodyId", "workspaceRoot"].sort().join("\0") ||
        Object.values(descriptors).some((descriptor) => !("value" in descriptor))
    )
        throw invalid("Git inspection options are invalid");
    const baseCustodyId = descriptors.baseCustodyId?.value;
    const headCustodyId = descriptors.headCustodyId?.value;
    const workspaceRoot = descriptors.workspaceRoot?.value;
    if (
        typeof baseCustodyId !== "string" ||
        typeof headCustodyId !== "string" ||
        typeof workspaceRoot !== "string"
    )
        throw invalid("Git inspection options are invalid");
    return { baseCustodyId, headCustodyId, workspaceRoot };
}

function comparePath(left: string, right: string): number {
    return Buffer.from(left).compare(Buffer.from(right));
}

function invalid(detail?: string): WorldChangesetError {
    const error = workspaceProtocolConfig.changesets.errors;
    return new WorldChangesetError(
        error.invalidCode,
        detail === undefined ? error.invalidMessage : `${error.invalidMessage}: ${detail}`,
    );
}
