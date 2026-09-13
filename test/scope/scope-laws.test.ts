import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
    claimScopeWriter,
    createReferenceCopyCarrier,
    discardScope,
    emitScopeRecord,
    forkScope,
    initializeWorkspace,
    inspectScope,
    inspectWorkspacePlatformConformance,
    mergeScope,
    type RecordBody,
    type ReferenceCopyCarrier,
    registerChildScope,
    releaseScopeWriter,
    ScopeEvidenceError,
    type ScopeInspection,
    ScopeMergeConflictError,
    ScopeQuiescenceError,
    ScopeTerminalConflictError,
    SQLiteTraceStore,
} from "../../src/index.ts";
import { bindingGrant, createForkWorkspace, type ForkWorkspace } from "./fork-fixtures.ts";
import {
    type LawOperation,
    type LawRefusal,
    ScopeReferenceModel,
    seededRandom,
} from "./scope-reference-model.ts";

const LAW_CONFIG = JSON.parse(
    await readFile(new URL("../../config/scope-law.config.json", import.meta.url), "utf8"),
) as {
    readonly operationsPerSeed: number;
    readonly restartEvery: number;
    readonly optimizedBackends: string[];
    readonly seeds: number[];
};
const HOST_CARRIERS = await (async () => {
    const workspaceRoot = await realpath(await mkdtemp(path.join(tmpdir(), "shepherd-law-probe-")));
    try {
        initializeWorkspace({ adopt: "none", initializeGit: false, rootPath: workspaceRoot });
        return inspectWorkspacePlatformConformance({ workspaceRoot }).optimized_carriers;
    } finally {
        await rm(workspaceRoot, { force: true, recursive: true });
    }
})();
const CARRIER_CONFIG = JSON.parse(
    await readFile(
        new URL("../../config/carrier-conformance.config.json", import.meta.url),
        "utf8",
    ),
) as {
    readonly requiredBackendsEnvironmentVariable: string;
    readonly requiredBackendsSeparator: string;
};
// Host runs that require an optimized backend fail instead of silently omitting its laws.
for (const required of (process.env[CARRIER_CONFIG.requiredBackendsEnvironmentVariable] ?? "")
    .split(CARRIER_CONFIG.requiredBackendsSeparator)
    .filter((backend) => backend.length > 0)) {
    assert.ok(
        HOST_CARRIERS.some((entry) => entry.backend === required && entry.status === "conformant"),
        `required carrier backend ${required} is unavailable for scope laws`,
    );
}
const PATHS = ["file.txt", "a.txt", "b.txt", "c.txt"];
const ROOT = "root";

/** Reference copy always runs; an optimized backend joins when the host proves it available. */
const LAW_CARRIERS: readonly {
    readonly create: (workspace: ForkWorkspace) => ReferenceCopyCarrier;
    readonly name: string;
}[] = [
    { create: (workspace) => workspace.carrier, name: "copy" },
    ...LAW_CONFIG.optimizedBackends
        .filter((backend) =>
            HOST_CARRIERS.some(
                (entry) => entry.backend === backend && entry.status === "conformant",
            ),
        )
        .map((backend) => ({
            create: (workspace: ForkWorkspace) =>
                createReferenceCopyCarrier({
                    backend: backend as "clone",
                    workspaceRoot: workspace.workspaceRoot,
                }),
            name: backend,
        })),
];

type Environment = {
    carrier: ReferenceCopyCarrier;
    readonly custodies: Map<string, string | null>;
    readonly databasePath: string;
    readonly scopes: Map<string, string>;
    store: SQLiteTraceStore;
    readonly workspace: ForkWorkspace;
};

function generate(random: () => number, model: ScopeReferenceModel, step: number): LawOperation {
    const keys = [...model.scopes.keys()];
    const pick = <T>(values: readonly T[]): T => values[Math.floor(random() * values.length)] as T;
    const nonRoot = keys.filter((key) => key !== ROOT);
    const worlds = keys.filter((key) => {
        const scope = model.scopes.get(key);
        return scope?.state === "open" && scope.world !== null;
    });
    const roll = random();
    if (roll < 0.25 || nonRoot.length === 0) {
        return { key: `s${step}`, kind: "fork", parent: pick(keys), world: random() < 0.7 };
    }
    if (roll < 0.4) {
        return { kind: "emit", scope: pick(keys), token: `t${step}` };
    }
    if (roll < 0.65 && worlds.length > 0) {
        return random() < 0.8
            ? { content: `c${step}\n`, kind: "write", path: pick(PATHS), scope: pick(worlds) }
            : { kind: "delete", path: pick(PATHS), scope: pick(worlds) };
    }
    return roll < 0.85
        ? { kind: "merge", scope: pick(nonRoot) }
        : { kind: "discard", scope: pick(nonRoot) };
}

function writer(environment: Environment, key: string) {
    return claimScopeWriter(environment.store, {
        claimId: `claim:law:${key}`,
        scopeId: environment.scopes.get(key) as string,
    });
}

function head(environment: Environment, key: string): string {
    return (
        inspectScope(environment.store, environment.scopes.get(key) as string) as ScopeInspection
    ).head.record_id;
}

async function applyReal(
    environment: Environment,
    model: ScopeReferenceModel,
    operation: LawOperation,
    step: number,
): Promise<LawRefusal | null> {
    const { carrier, store } = environment;
    try {
        switch (operation.kind) {
            case "fork": {
                const parent = writer(environment, operation.parent);
                const parentCustody = environment.custodies.get(operation.parent) ?? null;
                if (!operation.world) {
                    const child = registerChildScope(store, {
                        commandId: `law:fork:${operation.key}`,
                        expectedHeadRecordId: head(environment, operation.parent),
                        grant: [bindingGrant(environment.workspace.source)],
                        parent,
                    });
                    environment.scopes.set(operation.key, child.scope_id);
                    environment.custodies.set(operation.key, null);
                    return null;
                }
                const origin =
                    parentCustody === null
                        ? await carrier.snapshot(environment.workspace.source)
                        : await carrier.captureCustody(parentCustody);
                const child = await forkScope(store, {
                    binding: environment.workspace.source,
                    carrier,
                    commandId: `law:fork:${operation.key}`,
                    expectedHeadRecordId: head(environment, operation.parent),
                    grant: [bindingGrant(environment.workspace.source)],
                    originRevisionId: origin.revision_id,
                    parent,
                });
                environment.scopes.set(operation.key, child.scope_id);
                environment.custodies.set(operation.key, child.world.custody_id);
                return null;
            }
            case "emit":
                emitScopeRecord(store, {
                    commandId: `law:emit:${operation.token}`,
                    data: { token: operation.token },
                    expectedHeadRecordId: head(environment, operation.scope),
                    writer: writer(environment, operation.scope),
                });
                return null;
            case "write":
            case "delete": {
                const custody = await carrier.openCustody(
                    environment.custodies.get(operation.scope) as string,
                );
                const target = path.join(custody.path, operation.path);
                if (operation.kind === "write") {
                    await writeFile(target, operation.content);
                } else {
                    await rm(target, { force: true });
                }
                return null;
            }
            case "merge": {
                const parentKey = model.scopes.get(operation.scope)?.parent as string;
                const child = writer(environment, operation.scope);
                const parent = writer(environment, parentKey);
                await mergeScope(store, {
                    carrier,
                    child,
                    commandId: `law:merge:${operation.scope}:${step}`,
                    expectedChildHeadRecordId: head(environment, operation.scope),
                    expectedParentHeadRecordId: head(environment, parentKey),
                    parent,
                });
                return null;
            }
            case "discard": {
                const parentKey = model.scopes.get(operation.scope)?.parent as string;
                const parent = writer(environment, parentKey);
                const release = (key: string) => {
                    const scopeId = environment.scopes.get(key) as string;
                    const inspection = inspectScope(store, scopeId) as ScopeInspection;
                    if (inspection.state !== "open") {
                        return;
                    }
                    releaseScopeWriter(store, { writer: writer(environment, key) });
                    for (const childKey of model.scopes.get(key)?.children ?? []) {
                        release(childKey);
                    }
                };
                release(operation.scope);
                await discardScope(store, {
                    carrier,
                    commandId: `law:discard:${operation.scope}:${step}`,
                    expectedHeadRecordId: head(environment, operation.scope),
                    parent,
                    scopeId: environment.scopes.get(operation.scope) as string,
                });
                return null;
            }
        }
    } catch (error) {
        if (error instanceof ScopeTerminalConflictError) return "terminal";
        if (error instanceof ScopeQuiescenceError) return "quiescence";
        if (error instanceof ScopeMergeConflictError) return "conflict";
        if (error instanceof ScopeEvidenceError) return "evidence";
        throw error;
    }
}

async function assertAgreement(environment: Environment, model: ScopeReferenceModel) {
    const { carrier, store } = environment;
    for (const [key, scope] of model.scopes) {
        const inspection = inspectScope(
            store,
            environment.scopes.get(key) as string,
        ) as ScopeInspection;
        assert.equal(inspection.state, scope.state, `state of ${key}`);
        const tokens = inspection.selected_history.map(
            (occurrence) =>
                (
                    (store.readRecord(occurrence.record_id) as { readonly body: RecordBody }).body
                        .data as { readonly token: string }
                ).token,
        );
        assert.deepEqual(tokens, scope.selected, `selected history of ${key}`);
        if (scope.state === "open" && scope.world !== null) {
            const custody = await carrier.openCustody(environment.custodies.get(key) as string);
            const files = (await readdir(custody.path)).sort();
            const actual = new Map<string, string>();
            for (const file of files) {
                actual.set(file, await readFile(path.join(custody.path, file), "utf8"));
            }
            assert.deepEqual(actual, new Map([...scope.world].sort()), `world of ${key}`);
        }
    }
}

for (const backend of LAW_CARRIERS) {
    for (const seed of LAW_CONFIG.seeds) {
        test(`scope algebra agrees with the reference model on ${backend.name} carrier seed ${seed}`, async (context) => {
            const workspace = await createForkWorkspace(context, `law-${backend.name}-${seed}`);
            const environment: Environment = {
                carrier: backend.create(workspace),
                custodies: new Map([[ROOT, null]]),
                databasePath: workspace.databasePath,
                scopes: new Map([[ROOT, workspace.root.scope_id]]),
                store: workspace.store,
                workspace,
            };
            context.after(() => environment.store.close());
            releaseScopeWriter(workspace.store, { writer: workspace.rootWriter });
            const model = new ScopeReferenceModel(ROOT, new Map([["file.txt", "source\n"]]));
            const random = seededRandom(seed);
            const applied: LawOperation[] = [];
            try {
                for (let step = 0; step < LAW_CONFIG.operationsPerSeed; step += 1) {
                    const operation = generate(random, model, step);
                    applied.push(operation);
                    try {
                        const expected = model.apply(operation);
                        const actual = await applyReal(environment, model, operation, step);
                        assert.equal(actual, expected, "refusal classification");
                        await assertAgreement(environment, model);
                        if ((step + 1) % LAW_CONFIG.restartEvery === 0) {
                            const before = [...environment.scopes.values()].map((scopeId) =>
                                inspectScope(environment.store, scopeId),
                            );
                            environment.store.close();
                            environment.store = new SQLiteTraceStore(environment.databasePath);
                            assert.deepEqual(
                                [...environment.scopes.values()].map((scopeId) =>
                                    inspectScope(environment.store, scopeId),
                                ),
                                before,
                            );
                        }
                    } catch (error) {
                        throw new Error(
                            `scope law failed for ${backend.name} seed ${seed} at step ${step}; operations ${JSON.stringify(applied)}`,
                            { cause: error },
                        );
                    }
                }
                assert.equal(environment.store.verifyIntegrity().ok, true);
            } finally {
                // Release every custody, including overlay mounts, before the workspace is removed.
                for (const custodyId of environment.custodies.values()) {
                    if (custodyId !== null) {
                        await environment.carrier.discard(custodyId);
                    }
                }
            }
        });
    }
}

test("merging disjoint sibling deltas commutes and matches the reference three-way result", async (context) => {
    const results = [];
    for (const order of [
        ["left", "right"],
        ["right", "left"],
    ] as const) {
        const workspace = await createForkWorkspace(context, `law-commute-${order[0]}`);
        const environment: Environment = {
            carrier: workspace.carrier,
            custodies: new Map([[ROOT, null]]),
            databasePath: workspace.databasePath,
            scopes: new Map([[ROOT, workspace.root.scope_id]]),
            store: workspace.store,
            workspace,
        };
        releaseScopeWriter(workspace.store, { writer: workspace.rootWriter });
        const model = new ScopeReferenceModel(ROOT, new Map([["file.txt", "source\n"]]));
        const operations: LawOperation[] = [
            { key: "world", kind: "fork", parent: ROOT, world: true },
            { key: "left", kind: "fork", parent: "world", world: true },
            { key: "right", kind: "fork", parent: "world", world: true },
            { content: "left\n", kind: "write", path: "a.txt", scope: "left" },
            { kind: "delete", path: "file.txt", scope: "right" },
            { content: "right\n", kind: "write", path: "b.txt", scope: "right" },
            { kind: "merge", scope: order[0] },
            { kind: "merge", scope: order[1] },
        ];
        for (const [step, operation] of operations.entries()) {
            assert.equal(
                await applyReal(environment, model, operation, step),
                model.apply(operation),
            );
        }
        await assertAgreement(environment, model);
        results.push(
            (await workspace.carrier.verifyCustody(environment.custodies.get("world") as string))
                .content_id,
        );
        assert.deepEqual(
            new Map([...(model.scopes.get("world")?.world ?? [])].sort()),
            new Map([
                ["a.txt", "left\n"],
                ["b.txt", "right\n"],
            ]),
        );
    }
    assert.equal(results[0], results[1]);
});
