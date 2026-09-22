import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
    chmodSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    realpathSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
    canonicalizeRecord,
    createReferenceCopyCarrier,
    createWorkspaceBindings,
    initializeWorkspace,
    type SemanticRecord,
    type WorldRevision,
} from "../../../src/index.ts";
import { workspaceProtocolConfig } from "../../../src/protocol/config.ts";
import {
    RETAINED_WORLD_SETTLEMENT_ACTIONS,
    RETAINED_WORLD_SETTLEMENT_STATES,
    RETAINED_WORLD_SETTLEMENT_VERSION,
    WORLD_CHANGE_OPERATIONS,
    WORLD_ENTRY_KINDS,
} from "../../../src/protocol/values.generated.ts";
import { removePathSync } from "../../../src/runtime/remove-path.ts";
import { encodeRetainedWorldSettlementOperation } from "../../../src/store/retained-world-settlement-codec.ts";
import {
    createVerifiedWorldChangeset,
    isCanonicalWorldPath,
} from "../../../src/workspace/changesets.ts";
import {
    decodeSelectionPublicationPlan,
    decodeSelectionPublicationReceipt,
    decodeSelectionPublicationSchedule,
    decodeSelectionPublicationStep,
    encodeSelectionPublicationPlan,
    encodeSelectionPublicationReceipt,
    encodeSelectionPublicationSchedule,
    encodeSelectionPublicationStep,
    type SelectionPublicationPlanEncoding,
    type SelectionPublicationStepEncoding,
} from "../../../src/workspace/selection-publication-codec.ts";
import type { WorldChangeset, WorldPathChange } from "../../../src/workspace/types.ts";
import { createPrng, type Prng } from "../../support/prng.ts";
import { type FuzzInput, type FuzzTarget, fuzzSettings } from "../harness.ts";
import { mutateText, mutateValue } from "../mutators.ts";

const [DIRECTORY, FILE, SYMLINK] = WORLD_ENTRY_KINDS;
const [ADD, DELETE, MODIFY, REPLACE] = WORLD_CHANGE_OPERATIONS;
const PATH_PARTS = ["a", "b", "c.txt", "d", "e.md", "é", "f g"];

const worldPath: FuzzTarget = {
    name: "isCanonicalWorldPath",
    prepare: async () => ({
        execute: (input) => {
            // The predicate's domain is strings; every caller checks the type first.
            const raw = (input as { value: unknown }).value;
            const value = typeof raw === "string" ? raw : typeof raw;
            return { accepted: isCanonicalWorldPath(value), value };
        },
        generate: (random, seed) => {
            const text = (seed as { value: string }).value;
            const parts = text.split("/");
            if (random.chance(0.3)) {
                // Segment-level edits: dot segments, empty segments, the control directory.
                parts.splice(
                    random.int(parts.length + 1),
                    random.int(2),
                    random.pick([".", "..", "", workspaceProtocolConfig.controlDirectory, "x"]),
                );
                return { kind: "value", value: parts.join("/") };
            }
            return {
                kind: "value",
                value: random.chance(0.6)
                    ? mutateText(text, random, fuzzSettings.mutation)
                    : mutateValue(text, random, fuzzSettings.mutation),
            };
        },
        seeds: ["a", "a/b", "dir/file.txt", "é/\u{1f600}"].map((value) => ({
            kind: "value",
            value,
        })),
        verifyAccepted: (result) => {
            const { accepted, value } = result as { accepted: unknown; value: unknown };
            assert.equal(typeof accepted, "boolean");
            if (accepted !== true) return;
            // Properties every accepted path has, independent of the implementation.
            const text = value as string;
            assert.equal(typeof text, "string");
            assert.equal(path.posix.normalize(text), text);
            assert.equal(path.posix.isAbsolute(text), false);
            assert.equal(text.includes("\\") || text.includes("\0"), false);
            assert.equal(
                /[\uD800-\uDFFF]/u.test(text.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/gu, "")),
                false,
            );
            for (const part of text.split("/")) {
                assert.notEqual(part, "..");
                assert.notEqual(part, workspaceProtocolConfig.controlDirectory);
            }
        },
    }),
};

type ModelNode =
    | { readonly kind: typeof DIRECTORY; readonly mode: number }
    | { readonly bytes: string; readonly kind: typeof FILE; readonly mode: number }
    | { readonly kind: typeof SYMLINK; readonly target: string };

type Tree = Map<string, ModelNode>;

function randomTree(random: Prng): Tree {
    const tree: Tree = new Map();
    const count = 1 + random.int(8);
    for (let index = 0; index < count; index += 1) addRandomEntry(tree, random);
    return tree;
}

function addRandomEntry(tree: Tree, random: Prng): void {
    const directories = [
        "",
        ...[...tree].filter(([, node]) => node.kind === DIRECTORY).map(([key]) => key),
    ];
    const parent = random.pick(directories);
    const name = random.pick(PATH_PARTS);
    const entryPath = parent === "" ? name : `${parent}/${name}`;
    if (tree.has(entryPath)) return;
    tree.set(entryPath, randomNode(random));
}

function randomNode(random: Prng): ModelNode {
    const kind = random.int(3);
    if (kind === 0) return { kind: DIRECTORY, mode: random.pick([0o755, 0o700]) };
    if (kind === 1)
        return {
            bytes: random.pick(["", "x", "hello\n", "éé"]),
            kind: FILE,
            mode: random.pick([0o644, 0o600, 0o755]),
        };
    return { kind: SYMLINK, target: random.pick(["a", "c.txt", "missing", "d/e.md"]) };
}

function mutateTree(base: Tree, random: Prng): Tree {
    const tree: Tree = new Map(base);
    const operations = 1 + random.int(5);
    for (let index = 0; index < operations; index += 1) {
        const paths = [...tree.keys()];
        const choice = random.int(4);
        if (choice === 0 || paths.length === 0) {
            addRandomEntry(tree, random);
        } else if (choice === 1) {
            const removed = random.pick(paths);
            for (const key of paths)
                if (key === removed || key.startsWith(`${removed}/`)) tree.delete(key);
        } else if (choice === 2) {
            // Same kind, different content, mode, or target.
            const key = random.pick(paths);
            const node = tree.get(key) as ModelNode;
            tree.set(
                key,
                node.kind === DIRECTORY
                    ? { kind: DIRECTORY, mode: node.mode === 0o755 ? 0o700 : 0o755 }
                    : node.kind === FILE
                      ? random.chance(0.5)
                          ? { ...node, bytes: `${node.bytes}+` }
                          : { ...node, mode: node.mode === 0o644 ? 0o755 : 0o644 }
                      : { kind: SYMLINK, target: `${node.target}2` },
            );
        } else {
            // Kind replacement; a replaced directory loses its descendants.
            const key = random.pick(paths);
            for (const child of paths) if (child.startsWith(`${key}/`)) tree.delete(child);
            const current = tree.get(key) as ModelNode;
            let next = randomNode(random);
            while (next.kind === current.kind) next = randomNode(random);
            tree.set(key, next);
        }
    }
    return tree;
}

function materialize(root: string, tree: Tree): void {
    for (const entry of readdirSync(root))
        removePathSync(path.join(root, entry), { force: true, recursive: true });
    for (const key of [...tree.keys()].sort()) {
        const node = tree.get(key) as ModelNode;
        const target = path.join(root, ...key.split("/"));
        if (node.kind === DIRECTORY) {
            mkdirSync(target);
        } else if (node.kind === FILE) {
            writeFileSync(target, node.bytes);
            chmodSync(target, node.mode);
        } else {
            symlinkSync(node.target, target);
        }
    }
    // Directory modes last, so restrictive modes never block creating children.
    for (const [key, node] of tree)
        if (node.kind === DIRECTORY) chmodSync(path.join(root, ...key.split("/")), node.mode);
}

function modelChanges(base: Tree, head: Tree): readonly unknown[] {
    const keys = [...new Set([...base.keys(), ...head.keys()])].sort(comparePaths);
    const changes: unknown[] = [];
    for (const key of keys) {
        const before = base.get(key);
        const after = head.get(key);
        if (
            before !== undefined &&
            after !== undefined &&
            JSON.stringify(before) === JSON.stringify(after)
        )
            continue;
        const operation =
            before === undefined
                ? ADD
                : after === undefined
                  ? DELETE
                  : before.kind === after.kind
                    ? MODIFY
                    : REPLACE;
        changes.push({
            after: changeNode(after),
            before: changeNode(before),
            operation,
            path: key,
        });
    }
    return changes;
}

function comparePaths(left: string, right: string): number {
    const leftBytes = Buffer.from(left.replaceAll("/", "\0"));
    const rightBytes = Buffer.from(right.replaceAll("/", "\0"));
    return Buffer.compare(leftBytes, rightBytes);
}

function changeNode(node: ModelNode | undefined): unknown {
    if (node === undefined) return null;
    if (node.kind === DIRECTORY) return { kind: DIRECTORY, mode: node.mode };
    if (node.kind === SYMLINK) return { kind: SYMLINK, mode: null, target: node.target };
    return {
        byte_length: Buffer.byteLength(node.bytes),
        content_id: `${workspaceProtocolConfig.carrier.blobIdPrefix}${createHash(workspaceProtocolConfig.digestAlgorithm).update(node.bytes).digest("hex")}`,
        kind: FILE,
        mode: node.mode,
    };
}

const changesets: FuzzTarget = {
    name: "createVerifiedWorldChangeset",
    prepare: async () => {
        const root = realpathSync(mkdtempSync(path.join(tmpdir(), "shepherd-fuzz-changeset-")));
        initializeWorkspace({ adopt: "none", initializeGit: false, rootPath: root });
        const source = path.join(root, "source");
        mkdirSync(source);
        const binding = createWorkspaceBindings({
            bindings: [{ name: "source", root: "source" }],
            workspaceRoot: root,
        }).bindings[0];
        assert.ok(binding);
        const carrier = createReferenceCopyCarrier({ workspaceRoot: root });
        return {
            dispose: () => rmSync(root, { force: true, recursive: true }),
            execute: async (input) => {
                const { corrupt, seed } = (input as { value: { corrupt: boolean; seed: number } })
                    .value;
                const random = createPrng(seed);
                const base = randomTree(random);
                materialize(source, base);
                let baseRevision: unknown = await carrier.snapshot(binding);
                const head = mutateTree(base, random);
                materialize(source, head);
                let headRevision: unknown = await carrier.snapshot(binding);
                if (corrupt) {
                    if (random.chance(0.5))
                        baseRevision = mutateValue(baseRevision, random, fuzzSettings.mutation);
                    else headRevision = mutateValue(headRevision, random, fuzzSettings.mutation);
                }
                const verified = await createVerifiedWorldChangeset({
                    baseRevision: baseRevision as WorldRevision,
                    carrier,
                    headRevision: headRevision as WorldRevision,
                });
                return { changeset: verified.changeset, expected: modelChanges(base, head) };
            },
            generate: (random) => ({
                kind: "value",
                value: { corrupt: random.chance(0.3), seed: random.int(2 ** 31) },
            }),
            seeds: [{ kind: "value", value: { corrupt: false, seed: 1 } }],
            verifyAccepted: (result) => {
                const { changeset, expected } = result as {
                    changeset: WorldChangeset;
                    expected: readonly unknown[];
                };
                // Accepted changesets (even from mutated revision objects) equal the model diff.
                assert.deepEqual(JSON.parse(JSON.stringify(changeset.changes)), expected);
                assert.deepEqual(
                    changeset.changed_paths,
                    changeset.changes.map((change) => change.path),
                );
                const semantic = {
                    base_revision_id: changeset.base_revision_id,
                    binding_id: changeset.binding_id,
                    changes: changeset.changes as unknown as SemanticRecord["changes"],
                    head_revision_id: changeset.head_revision_id,
                    schema_version: changeset.schema_version,
                };
                const digest = createHash(workspaceProtocolConfig.digestAlgorithm)
                    .update(canonicalizeRecord(semantic))
                    .digest("hex");
                assert.equal(
                    changeset.changeset_id,
                    `${workspaceProtocolConfig.changesets.idPrefix}${digest}`,
                );
            },
        };
    },
};

type SelectionFixture = {
    readonly baseContentId: string;
    readonly changeset: WorldChangeset;
    readonly headContentId: string;
    readonly operation: ReturnType<typeof encodeRetainedWorldSettlementOperation>;
};

function hexId(prefix: string, character: string): string {
    return `${prefix}${character.repeat(workspaceProtocolConfig.hexLength)}`;
}

function selectionFixture(changes: readonly WorldPathChange[]): SelectionFixture {
    const [selectAction] = RETAINED_WORLD_SETTLEMENT_ACTIONS;
    const semantic = {
        base_revision_id: "revision:base",
        binding_id: "binding:one",
        changes: changes as unknown as SemanticRecord["changes"],
        head_revision_id: "revision:head",
        schema_version: workspaceProtocolConfig.changesets.version,
    };
    const changesetId = `${workspaceProtocolConfig.changesets.idPrefix}${createHash(workspaceProtocolConfig.digestAlgorithm).update(canonicalizeRecord(semantic)).digest("hex")}`;
    const baseContentId = hexId(workspaceProtocolConfig.carrier.worldContentIdPrefix, "a");
    const request = Object.freeze({
        action: selectAction,
        base_revision_id: semantic.base_revision_id,
        binding_id: semantic.binding_id,
        capture_record_id: "record:capture",
        changeset_id: changesetId,
        command_id: "command:one",
        custody_id: "custody:one",
        execution_cut_id: "cut:one",
        head_revision_id: semantic.head_revision_id,
        output_id: "output:one",
        run_id: "run:one",
        settlement_version: RETAINED_WORLD_SETTLEMENT_VERSION,
        user_basis_before: baseContentId,
    });
    const operation = encodeRetainedWorldSettlementOperation({
        action: selectAction,
        command_id: request.command_id,
        output_id: request.output_id,
        request,
        request_id: "request:one",
        state: RETAINED_WORLD_SETTLEMENT_STATES[0],
    } as Parameters<typeof encodeRetainedWorldSettlementOperation>[0]);
    const changeset = Object.freeze({
        ...semantic,
        changed_paths: Object.freeze(changes.map((change) => change.path)),
        changes: Object.freeze(changes),
        changeset_id: changesetId,
    }) as unknown as WorldChangeset;
    return {
        baseContentId,
        changeset,
        headContentId: hexId(workspaceProtocolConfig.carrier.worldContentIdPrefix, "b"),
        operation,
    };
}

const SELECTION_CHANGES: readonly WorldPathChange[] = [
    {
        after: {
            byte_length: 3,
            content_id: hexId(workspaceProtocolConfig.carrier.blobIdPrefix, "1"),
            kind: FILE,
            mode: 420,
        },
        before: null,
        operation: ADD,
        path: "one",
    },
    {
        after: { kind: SYMLINK, mode: null, target: "one" },
        before: { kind: DIRECTORY, mode: 493 },
        operation: REPLACE,
        path: "two",
    },
] as unknown as readonly WorldPathChange[];

type Decoded = { readonly decoder: string; readonly json: string };

const selectionDecoders: FuzzTarget = {
    name: "decodeSelectionPublication",
    prepare: async () => {
        const fixture = selectionFixture(SELECTION_CHANGES);
        const plan = encodeSelectionPublicationPlan(
            fixture.operation,
            fixture.changeset,
            fixture.baseContentId,
            fixture.headContentId,
        );
        const first = encodeSelectionPublicationStep(plan, null);
        const second = encodeSelectionPublicationStep(plan, first);
        const schedule = encodeSelectionPublicationSchedule(plan);
        const receipt = encodeSelectionPublicationReceipt(plan, second, "basis:after");
        const decoders: Readonly<Record<string, (json: string) => { readonly json: string }>> = {
            plan: (json) =>
                decodeSelectionPublicationPlan(
                    json,
                    fixture.operation,
                    fixture.changeset,
                    fixture.baseContentId,
                    fixture.headContentId,
                ),
            receipt: (json) => decodeSelectionPublicationReceipt(json, plan, second, "basis:after"),
            schedule: (json) => decodeSelectionPublicationSchedule(json, plan),
            step: (json) =>
                decodeSelectionPublicationStep(
                    json,
                    plan,
                    first as SelectionPublicationStepEncoding,
                ),
        };
        const seeds: Decoded[] = [
            { decoder: "plan", json: plan.json },
            { decoder: "receipt", json: receipt.json },
            { decoder: "schedule", json: schedule.json },
            { decoder: "step", json: second.json },
        ];
        return {
            execute: (input) => {
                const { decoder, json } = (input as { value: Decoded }).value;
                return {
                    decoded: (decoders[decoder] as (json: string) => { readonly json: string })(
                        json,
                    ),
                    json,
                };
            },
            generate: (random, seed) => {
                const value = (seed as { value: Decoded }).value;
                return {
                    kind: "value",
                    value: {
                        ...value,
                        json: mutateText(value.json, random, fuzzSettings.mutation),
                    },
                };
            },
            seeds: seeds.map((value) => ({ kind: "value", value })),
            verifyAccepted: (result) => {
                // Only the exact canonical encoding for the authenticated context is accepted.
                const { decoded, json } = result as { decoded: { json: string }; json: string };
                assert.equal(decoded.json, json);
                assert.equal(canonicalizeRecord(JSON.parse(json) as SemanticRecord), json);
            },
        };
    },
};

const selectionPlanEncoder: FuzzTarget = {
    name: "encodeSelectionPublicationPlan",
    prepare: async () => {
        const fixture = selectionFixture(SELECTION_CHANGES);
        const expected: SelectionPublicationPlanEncoding = encodeSelectionPublicationPlan(
            fixture.operation,
            fixture.changeset,
            fixture.baseContentId,
            fixture.headContentId,
        );
        return {
            execute: (input) =>
                encodeSelectionPublicationPlan(
                    fixture.operation,
                    (input as { value: unknown }).value as WorldChangeset,
                    fixture.baseContentId,
                    fixture.headContentId,
                ),
            seeds: [
                {
                    kind: "value",
                    value: JSON.parse(JSON.stringify(fixture.changeset)),
                } as FuzzInput,
            ],
            verifyAccepted: (result) => {
                // The operation pins the changeset identity, so only an equivalent changeset encodes.
                assert.equal((result as SelectionPublicationPlanEncoding).json, expected.json);
            },
        };
    },
};

/** Canonical world paths, changesets against a model, and selection-publication codecs. */
export const WORKSPACE_TARGETS: readonly FuzzTarget[] = [
    worldPath,
    changesets,
    selectionDecoders,
    selectionPlanEncoder,
];
