import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
    createGitRepositoryBindings,
    createGitRepositoryGrantPlan,
    createWorkspaceBindings,
    grantTaskRepositories,
    initializeWorkspace,
    schema,
    task,
} from "../../src/index.ts";
import { readRepositoryGrantPlanEvidence } from "../../src/protocol/repository-grant-evidence.ts";
import {
    assertCurrentGitRepositoryBinding,
    gitRepositoryBindingWorkspaceRoot,
} from "../../src/workspace/bindings.ts";
import { assertGitRepositoryGrantPlan } from "../../src/workspace/repository-grants.ts";

const taskGrantFixture = JSON.parse(
    readFileSync(new URL("../fixtures/repository-task-grant-v1.json", import.meta.url), "utf8"),
) as Readonly<Record<string, unknown>>;

test("repository task grants are canonical identity-bearing task artifacts", () => {
    const descriptor = task({
        name: "updateRepositories",
        version: "1",
        instruction: "Read documentation and update the implementation.",
        input: schema.object({ issue: schema.string() }),
        output: schema.void(),
    });
    const left = grantTaskRepositories({
        grants: [
            { binding: "source", profile: "read-write" },
            { binding: "docs", profile: "read-only" },
        ],
        task: descriptor,
    });
    const reordered = grantTaskRepositories({
        grants: [
            { binding: "docs", profile: "read-only" },
            { binding: "source", profile: "read-write" },
        ],
        task: descriptor,
    });
    const attenuated = grantTaskRepositories({
        grants: [
            { binding: "docs", profile: "read-only" },
            { binding: "source", profile: "read-only" },
        ],
        task: descriptor,
    });

    assert.deepEqual(left.artifact, reordered.artifact);
    assert.deepEqual(left.artifact, taskGrantFixture.artifact);
    assert.deepEqual(left.artifactLock, taskGrantFixture.artifact_lock);
    assert.equal(left.artifactLock.artifact_digest, reordered.artifactLock.artifact_digest);
    assert.notEqual(left.artifactLock.artifact_digest, attenuated.artifactLock.artifact_digest);
    assert.equal(left.artifact.task_artifact_digest, descriptor.artifactLock.artifact_digest);
    assert.deepEqual(
        left.grants.map((grant) => grant.binding),
        ["docs", "source"],
    );
    assert.equal(Object.isFrozen(left), true);
    assert.equal(Object.isFrozen(left.artifact), true);
    assert.equal(Object.isFrozen(left.grants), true);
});

test("repository task grant definitions fail closed", () => {
    const descriptor = task({
        name: "validateGrant",
        version: "1",
        instruction: "Validate repository authority.",
        input: schema.object({ issue: schema.string() }),
        output: schema.void(),
    });
    const granted = grantTaskRepositories({
        grants: [{ binding: "repo", profile: "read-only" }],
        task: descriptor,
    });

    for (const definition of [
        null,
        1,
        [],
        new Date(),
        {},
        { grants: {}, task: descriptor },
        { grants: [], task: descriptor },
        { grants: [null], task: descriptor },
        { grants: [{ binding: "repo", profile: "admin" }], task: descriptor },
        { grants: [{ binding: "repo", profile: 1 }], task: descriptor },
        { grants: [{ binding: "", profile: "read-only" }], task: descriptor },
        { grants: [{ binding: " ", profile: "read-only" }], task: descriptor },
        { grants: [{ binding: ".", profile: "read-only" }], task: descriptor },
        { grants: [{ binding: "..", profile: "read-only" }], task: descriptor },
        { grants: [{ binding: "../repo", profile: "read-only" }], task: descriptor },
        { grants: [{ binding: "repo\\nested", profile: "read-only" }], task: descriptor },
        { grants: [{ binding: "repo\0invalid", profile: "read-only" }], task: descriptor },
        { grants: [{ binding: "\uD800", profile: "read-only" }], task: descriptor },
        { grants: [{ binding: 1, profile: "read-only" }], task: descriptor },
        {
            grants: [
                { binding: "repo", profile: "read-only" },
                { binding: "repo", profile: "read-write" },
            ],
            task: descriptor,
        },
        {
            grants: [{ binding: "repo", extra: true, profile: "read-only" }],
            task: descriptor,
        },
        { extra: true, grants: [{ binding: "repo", profile: "read-only" }], task: descriptor },
        { grants: [{ binding: "repo", profile: "read-only" }], wrong: descriptor },
        {
            grants: [{ binding: "repo", profile: "read-only" }],
            task: { ...descriptor },
        },
        {
            grants: [{ binding: "repo", profile: "read-write" }],
            task: granted,
        },
        {
            grants: [{ binding: "repo", profile: "read-only", [Symbol("invalid")]: true }],
            task: descriptor,
        },
        {
            grants: [{ binding: "repo", profile: "read-only" }],
            task: descriptor,
            [Symbol("invalid")]: true,
        },
        Object.defineProperty(
            { grants: [{ binding: "repo", profile: "read-only" }], task: descriptor },
            "grants",
            { get: () => [] },
        ),
    ]) {
        assert.throws(() => grantTaskRepositories(definition as never), TypeError);
    }
});

test("repository grant plans bind all exact resources and intersect the whole-run ceiling", async (context) => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "shepherd-repository-grants-"));
    context.after(() => rm(workspaceRoot, { force: true, recursive: true }));
    initializeWorkspace({ adopt: "worktree", initializeGit: false, rootPath: workspaceRoot });
    await createRepository(workspaceRoot, "docs");
    await createRepository(workspaceRoot, "source");
    await mkdir(path.join(workspaceRoot, "ordinary"));
    const resources = createGitRepositoryBindings({
        bindings: [
            { name: "source", root: "source" },
            { name: "docs", root: "docs" },
        ],
        workspaceRoot,
    });
    const descriptor = task({
        name: "admitRepositories",
        version: "1",
        instruction: "Admit exact repositories.",
        input: schema.object({ issue: schema.string() }),
        output: schema.void(),
    });
    const granted = grantTaskRepositories({
        grants: [
            { binding: "source", profile: "read-write" },
            { binding: "docs", profile: "read-only" },
        ],
        task: descriptor,
    });
    const ordinary = createWorkspaceBindings({
        bindings: [{ name: "ordinary", root: "ordinary" }],
        workspaceRoot,
    }).bindings[0];
    assert.ok(ordinary);
    assert.throws(() => gitRepositoryBindingWorkspaceRoot({} as never), TypeError);
    assert.throws(() => assertCurrentGitRepositoryBinding(ordinary as never), TypeError);

    const readonly = createGitRepositoryGrantPlan({
        authorityCeiling: "read-only",
        bindings: resources.bindings,
        task: granted,
    });
    const writable = createGitRepositoryGrantPlan({
        authorityCeiling: "read-write",
        bindings: resources.bindings,
        task: granted,
    });
    const reopenedResources = createGitRepositoryBindings({
        bindings: [
            { name: "docs", root: "docs" },
            { name: "source", root: "source" },
        ],
        workspaceRoot,
    });
    const reopenedPlan = createGitRepositoryGrantPlan({
        authorityCeiling: "read-only",
        bindings: reopenedResources.bindings,
        task: grantTaskRepositories({ grants: granted.grants, task: descriptor }),
    });

    assert.deepEqual(
        readonly.grants.map(({ authority, binding_name }) => [binding_name, authority]),
        [
            ["docs", ["read"]],
            ["source", ["read"]],
        ],
    );
    assert.deepEqual(
        writable.grants.map(({ authority, binding_name }) => [binding_name, authority]),
        [
            ["docs", ["read"]],
            ["source", ["read", "write"]],
        ],
    );
    assert.notEqual(readonly.plan_id, writable.plan_id);
    assert.equal(reopenedPlan.plan_id, readonly.plan_id);
    assert.equal(repositoryGrantPlanInChild(workspaceRoot), readonly.plan_id);
    assert.equal(readonly.enforcement, "advisory");
    assert.equal(Object.isFrozen(readonly.grants), true);
    assert.deepEqual(readRepositoryGrantPlanEvidence(readonly), readonly);
    assert.deepEqual(
        readRepositoryGrantPlanEvidence(Object.assign(Object.create(null), readonly)),
        readonly,
    );
    assert.throws(
        () =>
            assertGitRepositoryGrantPlan(
                readonly,
                `sha256:${"f".repeat(64)}`,
                resources.bindings[0] as NonNullable<(typeof resources.bindings)[0]>,
            ),
        /invalid for the task artifact/u,
    );
    for (const grant of readonly.grants) {
        const resource = resources.bindings.find(({ name }) => name === grant.binding_name);
        assert.equal(grant.binding_id, resource?.binding_id);
        assert.equal(grant.resource_id, resource?.resource_id);
    }
    const firstGrant = readonly.grants[0];
    const secondGrant = readonly.grants[1];
    assert.ok(firstGrant);
    assert.ok(secondGrant);
    for (const evidence of [
        null,
        1,
        [],
        new Date(),
        { ...readonly, extra: true },
        { ...readonly, enforcement: "jail" },
        { ...readonly, grant_plan_version: 2 },
        { ...readonly, authority_ceiling: 1 },
        { ...readonly, grants: [] },
        { ...readonly, grants: [null] },
        { ...readonly, task_artifact_digest: 1 },
        { ...readonly, task_artifact_digest: "invalid" },
        { ...readonly, task_grant_artifact_digest: "sha256:0" },
        { ...readonly, task_grant_artifact_digest: `sha256:${"g".repeat(64)}` },
        { ...readonly, task_grant_artifact_digest: "invalid" },
        { ...readonly, plan_id: "invalid" },
        { ...readonly, grants: [{ ...firstGrant, extra: true }, secondGrant] },
        { ...readonly, grants: [{ ...firstGrant, authority: "read" }, secondGrant] },
        { ...readonly, grants: [{ ...firstGrant, authority: ["admin"] }, secondGrant] },
        { ...readonly, grants: [{ ...firstGrant, authority: [1] }, secondGrant] },
        { ...readonly, grants: [{ ...firstGrant, authority: ["read", "read"] }, secondGrant] },
        { ...readonly, grants: [{ ...firstGrant, authority: [] }, secondGrant] },
        { ...readonly, grants: [{ ...firstGrant, authority: ["write"] }, secondGrant] },
        { ...readonly, grants: [{ ...firstGrant, binding_id: "sha256:0" }, secondGrant] },
        { ...readonly, grants: [{ ...firstGrant, binding_id: "invalid" }, secondGrant] },
        { ...readonly, grants: [{ ...firstGrant, resource_id: "invalid" }, secondGrant] },
        { ...readonly, grants: [{ ...firstGrant, binding_name: "../docs" }, secondGrant] },
        { ...readonly, grants: [{ ...firstGrant, binding_name: 1 }, secondGrant] },
        { ...readonly, grants: [{ ...firstGrant, binding_name: " " }, secondGrant] },
        { ...readonly, grants: [{ ...firstGrant, binding_name: "." }, secondGrant] },
        { ...readonly, grants: [{ ...firstGrant, binding_name: ".." }, secondGrant] },
        { ...readonly, grants: [{ ...firstGrant, binding_name: "docs\\nested" }, secondGrant] },
        { ...readonly, grants: [{ ...firstGrant, binding_name: "docs\0invalid" }, secondGrant] },
        { ...readonly, grants: [{ ...firstGrant, binding_name: "\uD800" }, secondGrant] },
        { ...readonly, grants: [{ ...firstGrant, task_profile: "admin" }, secondGrant] },
        { ...readonly, grants: [{ ...firstGrant, task_profile: 1 }, secondGrant] },
        { ...readonly, grants: [secondGrant, firstGrant] },
        {
            ...readonly,
            grants: [firstGrant, { ...secondGrant, binding_name: firstGrant.binding_name }],
        },
    ]) {
        assert.throws(() => readRepositoryGrantPlanEvidence(evidence), TypeError);
    }

    for (const options of [
        null,
        1,
        [],
        new Date(),
        { authorityCeiling: "read-only", bindings: resources.bindings, wrong: granted },
        { authorityCeiling: "admin", bindings: resources.bindings, task: granted },
        { authorityCeiling: 1, bindings: resources.bindings, task: granted },
        { authorityCeiling: "read-only", bindings: {}, task: granted },
        { authorityCeiling: "read-only", bindings: [ordinary], task: granted },
        { authorityCeiling: "read-only", bindings: [], task: granted },
        {
            authorityCeiling: "read-only",
            bindings: [resources.bindings[0]],
            task: granted,
        },
        {
            authorityCeiling: "read-only",
            bindings: [...resources.bindings, resources.bindings[0]],
            task: granted,
        },
        {
            authorityCeiling: "read-only",
            bindings: resources.bindings,
            task: { ...granted },
        },
        {
            authorityCeiling: "read-only",
            bindings: resources.bindings.map((binding) => ({ ...binding })),
            task: granted,
        },
        {
            authorityCeiling: "read-only",
            bindings: resources.bindings,
            task: granted,
            [Symbol("invalid")]: true,
        },
        Object.defineProperty(
            {
                authorityCeiling: "read-only",
                bindings: resources.bindings,
                task: granted,
            },
            "bindings",
            { get: () => [] },
        ),
    ]) {
        assert.throws(() => createGitRepositoryGrantPlan(options as never), TypeError);
    }

    const otherWorkspaceRoot = await mkdtemp(
        path.join(tmpdir(), "shepherd-cross-workspace-grants-"),
    );
    context.after(() => rm(otherWorkspaceRoot, { force: true, recursive: true }));
    initializeWorkspace({
        adopt: "worktree",
        initializeGit: false,
        rootPath: otherWorkspaceRoot,
    });
    await createRepository(otherWorkspaceRoot, "source");
    const otherSource = createGitRepositoryBindings({
        bindings: [{ name: "source", root: "source" }],
        workspaceRoot: otherWorkspaceRoot,
    }).bindings[0];
    const docs = resources.bindings.find(({ name }) => name === "docs");
    assert.ok(docs);
    assert.ok(otherSource);
    assert.throws(
        () =>
            createGitRepositoryGrantPlan({
                authorityCeiling: "read-only",
                bindings: [docs, otherSource],
                task: granted,
            }),
        TypeError,
    );

    await createRepository(workspaceRoot, "other");
    const other = createGitRepositoryBindings({
        bindings: [{ name: "other", root: "other" }],
        workspaceRoot,
    }).bindings[0];
    assert.ok(other);
    assert.throws(
        () =>
            createGitRepositoryGrantPlan({
                authorityCeiling: "read-only",
                bindings: [docs, other],
                task: granted,
            }),
        TypeError,
    );
    assert.throws(
        () => assertGitRepositoryGrantPlan(readonly, readonly.task_artifact_digest, other),
        /invalid for the active resource/u,
    );
});

async function createRepository(workspaceRoot: string, name: string): Promise<void> {
    const root = path.join(workspaceRoot, name);
    await mkdir(root);
    execFileSync("git", ["init", "--quiet"], { cwd: root });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
    await writeFile(path.join(root, "tracked.txt"), `${name}\n`);
    execFileSync("git", ["add", "tracked.txt"], { cwd: root });
    execFileSync("git", ["commit", "--quiet", "-m", "initial"], { cwd: root });
}

function repositoryGrantPlanInChild(workspaceRoot: string): string {
    const source = `
        import {
            createGitRepositoryBindings,
            createGitRepositoryGrantPlan,
            grantTaskRepositories,
            schema,
            task,
        } from "./src/index.ts";
        const workspaceRoot = process.argv[1];
        const resources = createGitRepositoryBindings({
            bindings: [
                { name: "source", root: "source" },
                { name: "docs", root: "docs" },
            ],
            workspaceRoot,
        });
        const descriptor = task({
            name: "admitRepositories",
            version: "1",
            instruction: "Admit exact repositories.",
            input: schema.object({ issue: schema.string() }),
            output: schema.void(),
        });
        const granted = grantTaskRepositories({
            grants: [
                { binding: "source", profile: "read-write" },
                { binding: "docs", profile: "read-only" },
            ],
            task: descriptor,
        });
        console.log(createGitRepositoryGrantPlan({
            authorityCeiling: "read-only",
            bindings: resources.bindings,
            task: granted,
        }).plan_id);
    `;
    return execFileSync(process.execPath, ["--input-type=module", "-e", source, workspaceRoot], {
        cwd: process.cwd(),
        encoding: "utf8",
    }).trim();
}
