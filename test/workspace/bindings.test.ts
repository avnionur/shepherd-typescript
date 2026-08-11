import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
    createWorkspaceBindings,
    initializeWorkspace,
    WorkspaceBindingError,
} from "../../src/index.ts";

test("createWorkspaceBindings returns stable canonical disjoint authorities", async (context) => {
    const workspaceRoot = await initializedWorkspace(context, "canonical");
    await mkdir(path.join(workspaceRoot, "docs"));
    await mkdir(path.join(workspaceRoot, "backend"));
    await symlink("docs", path.join(workspaceRoot, "docs-alias"));

    const bindings = createWorkspaceBindings({
        bindings: [
            { name: "docs", root: "docs/." },
            { name: "backend", root: "backend" },
        ],
        workspaceRoot,
    });
    const reopened = createWorkspaceBindings({
        bindings: [
            { name: "docs", root: "docs-alias" },
            { name: "backend", root: path.join(workspaceRoot, "backend") },
        ],
        workspaceRoot,
    });

    assert.equal(bindings.workspace_root, await realpath(workspaceRoot));
    assert.equal(bindings.binding_version, 2);
    assert.deepEqual(
        bindings.bindings.map(({ canonical_root, name }) => ({ canonical_root, name })),
        [
            { canonical_root: await realpath(path.join(workspaceRoot, "docs")), name: "docs" },
            {
                canonical_root: await realpath(path.join(workspaceRoot, "backend")),
                name: "backend",
            },
        ],
    );
    assert.deepEqual(
        reopened.bindings.map(({ binding_id }) => binding_id),
        bindings.bindings.map(({ binding_id }) => binding_id),
    );
    assert.match(bindings.bindings[0]?.binding_id ?? "", /^sha256:[0-9a-f]{64}$/u);
    assert.equal(Object.isFrozen(bindings), true);
    assert.equal(Object.isFrozen(bindings.bindings), true);
    assert.equal(Object.isFrozen(bindings.bindings[0]), true);
});

test("createWorkspaceBindings rejects equal and nested roots in either order", async (context) => {
    const workspaceRoot = await initializedWorkspace(context, "overlap");
    await mkdir(path.join(workspaceRoot, "source", "nested"), { recursive: true });
    await mkdir(path.join(workspaceRoot, "source-sibling"));
    await mkdir(path.join(workspaceRoot, "CaseRoot"));
    await symlink("source", path.join(workspaceRoot, "source-alias"));

    for (const bindings of [
        [
            { name: "first", root: "source" },
            { name: "second", root: "source/." },
        ],
        [
            { name: "parent", root: "source" },
            { name: "child", root: "source/nested" },
        ],
        [
            { name: "child", root: "source/nested" },
            { name: "parent", root: "source" },
        ],
        [
            { name: "source", root: "source" },
            { name: "alias", root: "source-alias" },
        ],
    ]) {
        assert.throws(
            () => createWorkspaceBindings({ bindings, workspaceRoot }),
            (error: unknown) =>
                error instanceof WorkspaceBindingError &&
                error.code === "WORKSPACE_BINDING_ROOT_OVERLAP" &&
                error.message.includes(bindings[0]?.name ?? "") &&
                error.message.includes(bindings[1]?.name ?? ""),
        );
    }

    assert.equal(
        createWorkspaceBindings({
            bindings: [
                { name: "source", root: "source" },
                { name: "sibling", root: "source-sibling" },
            ],
            workspaceRoot,
        }).bindings.length,
        2,
    );

    let caseAliasExists = true;
    try {
        await realpath(path.join(workspaceRoot, "caseroot"));
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            throw error;
        }
        caseAliasExists = false;
    }
    if (caseAliasExists) {
        assert.throws(
            () =>
                createWorkspaceBindings({
                    bindings: [
                        { name: "case-original", root: "CaseRoot" },
                        { name: "case-alias", root: "caseroot" },
                    ],
                    workspaceRoot,
                }),
            (error: unknown) =>
                error instanceof WorkspaceBindingError &&
                error.code === "WORKSPACE_BINDING_ROOT_OVERLAP" &&
                error.message.includes("case-original") &&
                error.message.includes("case-alias"),
        );
    }
});

test("createWorkspaceBindings fails closed for invalid names, roots, and authority escape", async (context) => {
    const workspaceRoot = await initializedWorkspace(context, "invalid");
    const outsideRoot = await temporaryDirectory(context, "outside");
    await mkdir(path.join(workspaceRoot, "valid"));
    await writeFile(path.join(workspaceRoot, "file.txt"), "file\n");
    await symlink(outsideRoot, path.join(workspaceRoot, "escape"));
    await symlink("missing", path.join(workspaceRoot, "broken"));
    await symlink("loop-b", path.join(workspaceRoot, "loop-a"));
    await symlink("loop-a", path.join(workspaceRoot, "loop-b"));
    await symlink("valid", path.join(workspaceRoot, "chain-target"));
    await symlink("chain-target", path.join(workspaceRoot, "chain-head"));

    const chained = createWorkspaceBindings({
        bindings: [{ name: "chained", root: "chain-head" }],
        workspaceRoot,
    });
    assert.equal(
        chained.bindings[0]?.canonical_root,
        await realpath(path.join(workspaceRoot, "valid")),
    );

    const cases: readonly (readonly [unknown, string])[] = [
        [
            { bindings: [{ name: "", root: "valid" }], workspaceRoot },
            "WORKSPACE_BINDING_INVALID_NAME",
        ],
        ...[" ", ".", "..", "bad\\name", "bad\0name", "bad\uD800"].map(
            (name) =>
                [
                    { bindings: [{ name, root: "valid" }], workspaceRoot },
                    "WORKSPACE_BINDING_INVALID_NAME",
                ] as const,
        ),
        [
            { bindings: [{ name: "../bad", root: "valid" }], workspaceRoot },
            "WORKSPACE_BINDING_INVALID_NAME",
        ],
        [
            {
                bindings: [
                    { name: "duplicate", root: "valid" },
                    { name: "duplicate", root: "." },
                ],
                workspaceRoot,
            },
            "WORKSPACE_BINDING_DUPLICATE_NAME",
        ],
        [
            { bindings: [{ name: "missing", root: "missing" }], workspaceRoot },
            "WORKSPACE_BINDING_INVALID_ROOT",
        ],
        [
            { bindings: [{ name: "empty-root", root: "" }], workspaceRoot },
            "WORKSPACE_BINDING_INVALID_ROOT",
        ],
        [
            { bindings: [{ name: "file", root: "file.txt" }], workspaceRoot },
            "WORKSPACE_BINDING_INVALID_ROOT",
        ],
        [
            { bindings: [{ name: "broken", root: "broken" }], workspaceRoot },
            "WORKSPACE_BINDING_INVALID_ROOT",
        ],
        [
            { bindings: [{ name: "loop", root: "loop-a" }], workspaceRoot },
            "WORKSPACE_BINDING_INVALID_ROOT",
        ],
        [
            { bindings: [{ name: "escape", root: "escape" }], workspaceRoot },
            "WORKSPACE_BINDING_AUTHORITY_ESCAPE",
        ],
        [
            { bindings: [{ name: "outside", root: outsideRoot }], workspaceRoot },
            "WORKSPACE_BINDING_AUTHORITY_ESCAPE",
        ],
    ];
    for (const [options, code] of cases) {
        assert.throws(
            () => createWorkspaceBindings(options as never),
            (error: unknown) => error instanceof WorkspaceBindingError && error.code === code,
        );
    }

    const sparseBindings = Array<unknown>(1);
    const accessorBindings: unknown[] = [];
    Object.defineProperty(accessorBindings, "0", {
        configurable: true,
        enumerable: true,
        get: () => ({ name: "valid", root: "valid" }),
    });
    accessorBindings.length = 1;
    const customBindings = [{ name: "valid", root: "valid" }];
    Object.defineProperty(customBindings, "extra", { enumerable: true, value: true });
    const symbolBindings = [] as unknown[];
    Object.defineProperty(symbolBindings, Symbol("extra"), { value: true });
    const customPrototypeBindings = Object.setPrototypeOf([], null) as unknown[];
    const symbolOptions = { bindings: [], workspaceRoot };
    Object.defineProperty(symbolOptions, Symbol("extra"), { value: true });
    const nullPrototypeOptions = Object.assign(Object.create(null) as Record<string, unknown>, {
        bindings: [] as unknown[],
        workspaceRoot,
    });
    assert.deepEqual(createWorkspaceBindings(nullPrototypeOptions as never).bindings, []);

    for (const malformed of [
        null,
        [],
        new Date(),
        {},
        { bindings: [], workspaceRoot, extra: true },
        { bindings: [], workspaceRoot: "" },
        { bindings: [], workspaceRoot: 1 },
        { bindings: null, workspaceRoot },
        { bindings: sparseBindings, workspaceRoot },
        { bindings: accessorBindings, workspaceRoot },
        { bindings: customBindings, workspaceRoot },
        { bindings: symbolBindings, workspaceRoot },
        { bindings: customPrototypeBindings, workspaceRoot },
        symbolOptions,
        { bindings: [{}], workspaceRoot },
        { bindings: [new Date()], workspaceRoot },
        { bindings: [{ name: 1, root: "valid" }], workspaceRoot },
        { bindings: [{ name: "valid", root: 1 }], workspaceRoot },
        { bindings: [{ name: "valid", root: "valid", extra: true }], workspaceRoot },
        Object.defineProperty({ bindings: [], workspaceRoot }, "workspaceRoot", {
            enumerable: true,
            get: () => workspaceRoot,
        }),
        {
            bindings: [
                Object.defineProperty({ name: "valid", root: "valid" }, "root", {
                    enumerable: true,
                    get: () => "valid",
                }),
            ],
            workspaceRoot,
        },
    ]) {
        assert.throws(() => createWorkspaceBindings(malformed as never), TypeError);
    }
});

async function initializedWorkspace(
    context: { after: (callback: () => Promise<void>) => void },
    name: string,
): Promise<string> {
    const workspaceRoot = await temporaryDirectory(context, name);
    initializeWorkspace({ adopt: "none", initializeGit: false, rootPath: workspaceRoot });
    return workspaceRoot;
}

async function temporaryDirectory(
    context: { after: (callback: () => Promise<void>) => void },
    name: string,
): Promise<string> {
    const root = await mkdtemp(path.join(tmpdir(), `shepherd-bindings-${name}-`));
    context.after(() => rm(root, { force: true, recursive: true }));
    return root;
}
