import { createRecordId } from "../canonical/canonical-record.ts";
import { createCanonicalSnapshot } from "../canonical/snapshot.ts";
import { workspaceProtocolConfig } from "../protocol/config.ts";
import { RETAINED_WORLD_APPLICATION_CONFLICT_KINDS } from "../protocol/values.generated.ts";
import { isCanonicalWorldPath } from "./changesets.ts";
import { RetainedWorldApplicationConflictError } from "./errors.ts";
import type {
    InspectRetainedWorldApplicationConflictsOptions,
    RetainedWorldApplicationConflict,
    RetainedWorldApplicationConflictEvidence,
} from "./retained-world-application-types.ts";

type PathTrieNode = {
    readonly children: Map<string, PathTrieNode>;
    readonly terminalPaths: string[];
};

const [EQUAL_PATH, ANCESTOR_DESCENDANT, PORTABLE_ALIAS] = RETAINED_WORLD_APPLICATION_CONFLICT_KINDS;

/** Refuses with exact bounded evidence unless candidate and current changed paths are disjoint. */
export function assertRetainedWorldApplicationPathsDisjoint(
    candidatePaths: readonly string[],
    currentPaths: readonly string[],
): void {
    const evidence = inspectRetainedWorldApplicationConflicts({
        candidatePaths,
        currentPaths,
    });
    if (evidence !== null) throw new RetainedWorldApplicationConflictError(evidence);
}

/**
 * Computes bounded portable equal/prefix/alias conflicts without granting apply authority.
 *
 * @param options - Exact canonical candidate and current changed-path sets.
 * @returns Content-addressed conflict evidence, or `null` when the sets are disjoint.
 * @throws {TypeError} If options or canonical path arrays are malformed or exceed limits.
 *
 * @public
 */
export function inspectRetainedWorldApplicationConflicts(
    options: InspectRetainedWorldApplicationConflictsOptions,
): RetainedWorldApplicationConflictEvidence | null {
    const fields = exactOptions(options);
    const candidatePaths = readPaths(fields.candidatePaths);
    const currentPaths = readPaths(fields.currentPaths);
    const application = workspaceProtocolConfig.settlement.application;
    const root = createTrieNode();
    for (const currentPath of currentPaths) insertPath(root, currentPath);
    const conflicts: RetainedWorldApplicationConflict[] = [];
    for (const candidatePath of candidatePaths) {
        collectConflicts(root, candidatePath, conflicts, application.maxConflicts);
        if (conflicts.length >= application.maxConflicts) break;
    }
    if (conflicts.length === 0) return null;
    conflicts.sort((left, right) =>
        Buffer.from(`${left.candidate_path}\0${left.current_path}\0${left.kind}`).compare(
            Buffer.from(`${right.candidate_path}\0${right.current_path}\0${right.kind}`),
        ),
    );
    const retainedConflicts = Object.freeze(conflicts.map((conflict) => Object.freeze(conflict)));
    const semantic = createCanonicalSnapshot({
        compatibility_version: application.compatibilityVersion,
        conflicts: retainedConflicts,
        conflict_version: application.conflictVersion,
    });
    const digest = createRecordId({ retained_world_application_conflict: semantic });
    const evidence = Object.freeze({
        ...semantic,
        conflict_id: `${application.conflictIdPrefix}${digest.slice(digest.lastIndexOf(":") + 1)}`,
    }) as RetainedWorldApplicationConflictEvidence;
    return evidence;
}

function collectConflicts(
    root: PathTrieNode,
    candidatePath: string,
    conflicts: RetainedWorldApplicationConflict[],
    maximum: number,
): void {
    const normalizedCandidate = normalizePath(candidatePath);
    const segments = normalizedCandidate.split("/");
    let node: PathTrieNode | undefined = root;
    for (let index = 0; index < segments.length && node !== undefined; index += 1) {
        if (index > 0) {
            for (const currentPath of node.terminalPaths) {
                addConflict(conflicts, candidatePath, currentPath, ANCESTOR_DESCENDANT, maximum);
            }
        }
        node = node.children.get(segments[index] as string);
    }
    if (node === undefined || conflicts.length >= maximum) return;
    for (const currentPath of node.terminalPaths) {
        addConflict(
            conflicts,
            candidatePath,
            currentPath,
            candidatePath === currentPath ? EQUAL_PATH : PORTABLE_ALIAS,
            maximum,
        );
    }
    const pending = [...node.children.values()];
    while (pending.length > 0 && conflicts.length < maximum) {
        const descendant = pending.pop() as PathTrieNode;
        for (const currentPath of descendant.terminalPaths) {
            addConflict(conflicts, candidatePath, currentPath, ANCESTOR_DESCENDANT, maximum);
        }
        pending.push(...descendant.children.values());
    }
}

function addConflict(
    conflicts: RetainedWorldApplicationConflict[],
    candidatePath: string,
    currentPath: string,
    kind: RetainedWorldApplicationConflict["kind"],
    maximum: number,
): void {
    if (conflicts.length >= maximum) return;
    conflicts.push({ candidate_path: candidatePath, current_path: currentPath, kind });
}

function insertPath(root: PathTrieNode, path: string): void {
    let node = root;
    for (const segment of normalizePath(path).split("/")) {
        let child = node.children.get(segment);
        if (child === undefined) {
            child = createTrieNode();
            node.children.set(segment, child);
        }
        node = child;
    }
    node.terminalPaths.push(path);
}

function normalizePath(path: string): string {
    const application = workspaceProtocolConfig.settlement.application;
    const normalized = path.normalize(application.normalizationForm);
    // Compatibility locks case folding on; the false branch remains explicit for config typing.
    /* node:coverage ignore next 1 */
    return application.caseFold ? normalized.toLowerCase() : normalized;
}

function createTrieNode(): PathTrieNode {
    return { children: new Map(), terminalPaths: [] };
}

function readPaths(value: unknown): readonly string[] {
    if (
        !Array.isArray(value) ||
        Object.keys(value).length !== value.length ||
        value.length > workspaceProtocolConfig.changesets.maxChanges
    ) {
        throw new TypeError("retained world application paths must be a bounded dense array");
    }
    const paths = value.map((path) => {
        if (typeof path !== "string" || !isCanonicalWorldPath(path)) {
            throw new TypeError("retained world application path is invalid");
        }
        return path;
    });
    if (new Set(paths).size !== paths.length) {
        throw new TypeError("retained world application paths must be unique");
    }
    paths.sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
    return Object.freeze(paths);
}

function exactOptions(value: unknown): Record<"candidatePaths" | "currentPaths", unknown> {
    if (
        value === null ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    ) {
        throw new TypeError("retained world application conflict options must be exact data");
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const expected = ["candidatePaths", "currentPaths"] as const;
    const keys = Reflect.ownKeys(descriptors).sort();
    if (
        keys.length !== expected.length ||
        keys.some((key, index) => key !== expected[index]) ||
        expected.some((key) => !("value" in (descriptors[key] as PropertyDescriptor)))
    ) {
        throw new TypeError("retained world application conflict options must be exact data");
    }
    return Object.fromEntries(
        expected.map((key) => [key, (descriptors[key] as PropertyDescriptor).value]),
    ) as Record<(typeof expected)[number], unknown>;
}
