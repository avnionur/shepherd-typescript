import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import {
    type AppendReceipt,
    claimScopeWriter,
    inspectScope,
    releaseScopeWriter,
    runScopeTree,
    type ScopeTreeContext,
    type ScopeTreeNode,
    type ScopeTreeOutcome,
    ScopeWriterConflictError,
    SQLiteTraceStore,
} from "../../src/index.ts";
import { registerAndClaim, temporaryDatabasePath } from "./fixtures.ts";
import { bindingGrant, createForkWorkspace } from "./fork-fixtures.ts";

function traceTree(calls: string[], concurrency: { active: number; peak: number }) {
    const work =
        (label: string, decision: "discard" | "merge", pause = 0) =>
        async (scope: ScopeTreeContext) => {
            calls.push(label);
            concurrency.active += 1;
            concurrency.peak = Math.max(concurrency.peak, concurrency.active);
            await new Promise((resolve) => setTimeout(resolve, pause));
            scope.emit("note", { label });
            concurrency.active -= 1;
            return decision;
        };
    const nodes: readonly ScopeTreeNode[] = [
        { grant: [], key: "alpha", run: work("alpha", "merge", 20) },
        {
            grant: [],
            key: "beta",
            run: async (scope) => {
                calls.push("beta");
                scope.emit("partial", { label: "beta" });
                throw new Error("beta work failed");
            },
        },
        {
            children: [
                { grant: [], key: "leaf", run: work("leaf", "merge") },
                { grant: [], key: "probe", run: work("probe", "discard") },
                { grant: [], key: "plain" },
            ],
            grant: [],
            key: "gamma",
            run: async (scope): Promise<"merge"> => {
                calls.push("gamma");
                assert.deepEqual(
                    scope.children.map((child) => child.status),
                    ["merged", "discarded", "merged"],
                );
                scope.emit("summary", { children: scope.children.length });
                return "merge";
            },
        },
        {
            grant: [],
            key: "delta",
            run: () => {
                calls.push("delta");
                throw "string failure";
            },
        },
        { grant: [], key: "epsilon", run: () => "unsupported" as never },
    ];
    return nodes;
}

function statuses(outcomes: readonly ScopeTreeOutcome[]): unknown {
    return outcomes.map((outcome) => ({
        children: statuses(outcome.children),
        key: outcome.key,
        status: outcome.status,
    }));
}

test("a scheduled tree settles nested children once with deterministic results at any parallelism", async (context) => {
    const reports = [];
    for (const maxParallel of [1, 3]) {
        const databasePath = await temporaryDatabasePath(context, `tree-${maxParallel}`);
        using store = new SQLiteTraceStore(databasePath);
        const { root, writer } = registerAndClaim(store);
        const calls: string[] = [];
        const concurrency = { active: 0, peak: 0 };
        const report = await runScopeTree(store, {
            children: traceTree(calls, concurrency),
            commandPrefix: "schedule:review",
            maxParallel,
            parent: writer,
        });
        assert.equal(report.parent_scope_id, root.scope_id);
        assert.deepEqual(statuses(report.outcomes), [
            { children: [], key: "alpha", status: "merged" },
            { children: [], key: "beta", status: "failed" },
            {
                children: [
                    { children: [], key: "leaf", status: "merged" },
                    { children: [], key: "probe", status: "discarded" },
                    { children: [], key: "plain", status: "merged" },
                ],
                key: "gamma",
                status: "merged",
            },
            { children: [], key: "delta", status: "failed" },
            { children: [], key: "epsilon", status: "failed" },
        ]);
        assert.equal(report.outcomes[1]?.failure, "beta work failed");
        assert.equal(report.outcomes[3]?.failure, "string failure");
        assert.match(report.outcomes[4]?.failure as string, /unsupported decision/u);
        assert.equal(Object.isFrozen(report.outcomes), true);
        assert.equal(concurrency.peak <= maxParallel, true);
        if (maxParallel > 1) {
            assert.equal(concurrency.peak > 1, true);
        }
        // A failed scope's partial emission is discarded with its subtree, never selected.
        const selected = inspectScope(store, root.scope_id)?.selected_history ?? [];
        assert.equal(selected.length, 3);
        assert.equal(
            inspectScope(store, report.outcomes[1]?.scope_id as string)?.state,
            "discarded",
        );
        reports.push({ report, selected });
        assert.equal(store.verifyIntegrity().ok, true);
    }
    // Identical command identities yield identical scopes and selected history.
    assert.deepEqual(reports[0]?.report, reports[1]?.report);
    assert.deepEqual(reports[0]?.selected, reports[1]?.selected);
});

class InterruptedMergeStore extends SQLiteTraceStore {
    #remaining: number;

    constructor(databasePath: string, remaining: number) {
        super(databasePath);
        this.#remaining = remaining;
    }

    override completeScopeMerge(
        ...parameters: Parameters<SQLiteTraceStore["completeScopeMerge"]>
    ): AppendReceipt {
        this.#remaining -= 1;
        if (this.#remaining === 0) {
            throw new Error("interrupted before merge completion");
        }
        return super.completeScopeMerge(...parameters);
    }
}

test("re-running an interrupted schedule resumes from receipts without duplicating work", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "tree-recovery");
    const calls: string[] = [];
    const nodes = traceTree(calls, { active: 0, peak: 0 });
    const interrupted = new InterruptedMergeStore(databasePath, 3);
    const { root, writer } = registerAndClaim(interrupted);
    await assert.rejects(
        runScopeTree(interrupted, {
            children: nodes,
            commandPrefix: "schedule:recover",
            maxParallel: 1,
            parent: writer,
        }),
        /before merge completion/u,
    );
    interrupted.close();
    const firstCalls = [...calls];
    using recovered = new SQLiteTraceStore(databasePath);
    const parent = claimScopeWriter(recovered, {
        claimId: "claim:root",
        nowMilliseconds: Date.now(),
        scopeId: root.scope_id,
    });
    const report = await runScopeTree(recovered, {
        children: nodes,
        commandPrefix: "schedule:recover",
        maxParallel: 2,
        parent,
    });
    assert.deepEqual(
        report.outcomes.map((outcome) => outcome.status),
        ["merged", "failed", "merged", "failed", "failed"],
    );
    // Settled leaf and the reserved alpha merge resumed without running again; unsettled work reran.
    assert.equal(calls.filter((call) => call === "alpha").length, 1);
    assert.equal(calls.filter((call) => call === "leaf").length, 1);
    assert.ok(firstCalls.includes("leaf"));
    assert.equal(inspectScope(recovered, root.scope_id)?.selected_history.length, 3);
    // Emissions replay by command identity instead of duplicating.
    const gamma = report.outcomes[2]?.scope_id as string;
    assert.equal(
        inspectScope(recovered, gamma)?.history.filter((entry) => entry.kind === "emission").length,
        1,
    );
    assert.equal(recovered.verifyIntegrity().ok, true);
    // Re-running a completed schedule reports the same settled tree.
    const repeat = await runScopeTree(recovered, {
        children: nodes,
        commandPrefix: "schedule:recover",
        maxParallel: 2,
        parent,
    });
    assert.deepEqual(
        repeat.outcomes.map((outcome) => [outcome.status, outcome.failure]),
        [
            ["merged", null],
            ["discarded", null],
            ["merged", null],
            ["discarded", null],
            ["discarded", null],
        ],
    );
    assert.deepEqual(
        repeat.outcomes[2]?.children.map((outcome) => outcome.status),
        ["merged", "discarded", "merged"],
    );
});

test("scheduled world forks merge disjoint siblings and discard conflicting ones", async (context) => {
    const workspace = await createForkWorkspace(context, "tree-world");
    const write =
        (file: string, content: string) =>
        async (scope: ScopeTreeContext): Promise<"merge"> => {
            await writeFile(path.join(scope.custodyPath as string, file), content);
            return "merge";
        };
    const report = await runScopeTree(workspace.store, {
        carrier: workspace.carrier,
        children: [
            {
                children: [
                    {
                        fork: { binding: workspace.source },
                        grant: [bindingGrant(workspace.source)],
                        key: "one",
                        run: write("one.txt", "one\n"),
                    },
                    {
                        fork: { binding: workspace.source },
                        grant: [bindingGrant(workspace.source)],
                        key: "two",
                        run: write("file.txt", "two\n"),
                    },
                    {
                        fork: { binding: workspace.source },
                        grant: [bindingGrant(workspace.source)],
                        key: "clash",
                        run: write("file.txt", "clash\n"),
                    },
                ],
                fork: { binding: workspace.source },
                grant: [bindingGrant(workspace.source)],
                key: "world",
                run: async (scope): Promise<"discard"> => {
                    const custody = scope.custodyPath as string;
                    assert.equal(await readFile(path.join(custody, "one.txt"), "utf8"), "one\n");
                    assert.equal(await readFile(path.join(custody, "file.txt"), "utf8"), "two\n");
                    // A world child of a trace-only parent can only be discarded.
                    return "discard";
                },
            },
        ],
        commandPrefix: "schedule:world",
        maxParallel: 3,
        parent: workspace.rootWriter,
    });
    assert.deepEqual(statuses(report.outcomes), [
        {
            children: [
                { children: [], key: "one", status: "merged" },
                { children: [], key: "two", status: "merged" },
                { children: [], key: "clash", status: "conflicted" },
            ],
            key: "world",
            status: "discarded",
        },
    ]);
    assert.equal(
        await readFile(path.join(workspace.workspaceRoot, "source", "file.txt"), "utf8"),
        "source\n",
    );
    assert.equal(workspace.store.verifyIntegrity().ok, true);
});

test("scheduling validates options and fails closed on foreign writers", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "tree-validation");
    using store = new SQLiteTraceStore(databasePath);
    const { root, writer } = registerAndClaim(store);
    const base = {
        children: [],
        commandPrefix: "schedule:validate",
        maxParallel: 1,
        parent: writer,
    };
    for (const options of [
        { ...base, maxParallel: 0 },
        { ...base, maxParallel: 65 },
        { ...base, commandPrefix: "" },
        { ...base, children: [{ grant: [], key: "a/b" }] },
        {
            ...base,
            children: [
                { grant: [], key: "a" },
                { grant: [], key: "a" },
            ],
        },
        { ...base, children: [{ grant: [], key: "a", run: "merge" }] },
        { ...base, children: [{ grant: [], key: "a", extra: true }] },
        { ...base, carrier: {} },
    ]) {
        await assert.rejects(runScopeTree(store, options as never), TypeError);
    }
    const workspace = await createForkWorkspace(context, "tree-validation-fork");
    await assert.rejects(
        runScopeTree(workspace.store, {
            children: [{ fork: { binding: workspace.source }, grant: [], key: "world" }],
            commandPrefix: "schedule:no-carrier",
            maxParallel: 1,
            parent: workspace.rootWriter,
        }),
        TypeError,
    );
    let deep: ScopeTreeNode = { grant: [], key: "leaf" };
    for (let depth = 0; depth < 16; depth += 1) {
        deep = { children: [deep], grant: [], key: `level-${depth}` };
    }
    await assert.rejects(runScopeTree(store, { ...base, children: [deep] }), TypeError);
    await assert.rejects(
        runScopeTree(store, {
            ...base,
            children: Array.from({ length: 257 }, (_, index) => ({ grant: [], key: `n${index}` })),
        }),
        TypeError,
    );
    // Another active holder of a scheduled writer fails the schedule closed after every run settles.
    const report = await runScopeTree(store, {
        ...base,
        children: [{ grant: [], key: "held", run: () => "discard" }],
    });
    const held = report.outcomes[0]?.scope_id as string;
    assert.equal(inspectScope(store, held)?.state, "discarded");
    const busy = await runScopeTree(store, {
        ...base,
        children: [{ grant: [], key: "busy" }],
        commandPrefix: "schedule:busy",
    });
    assert.equal(busy.outcomes[0]?.status, "merged");
    releaseScopeWriter(store, {
        writer: claimScopeWriter(store, { claimId: "claim:root", scopeId: root.scope_id }),
    });
    claimScopeWriter(store, { claimId: "claim:intruder", scopeId: root.scope_id });
    await assert.rejects(
        runScopeTree(store, {
            ...base,
            children: [{ grant: [], key: "blocked" }],
            commandPrefix: "schedule:blocked",
        }),
        ScopeWriterConflictError,
    );
});

class NestedRegistrationFailureStore extends SQLiteTraceStore {
    override registerChildScope(
        ...parameters: Parameters<SQLiteTraceStore["registerChildScope"]>
    ): ReturnType<SQLiteTraceStore["registerChildScope"]> {
        const [registration] = parameters;
        if (inspectScope(this, registration.parentScopeId)?.parent !== null) {
            throw new Error("nested registration unavailable");
        }
        return super.registerChildScope(...parameters);
    }
}

test("scheduler refusals inside a subtree fail the schedule after siblings settle and emits stay exact", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "tree-subtree-failure");
    using store = new NestedRegistrationFailureStore(databasePath);
    const { writer } = registerAndClaim(store);
    const calls: string[] = [];
    await assert.rejects(
        runScopeTree(store, {
            children: [
                { children: [{ grant: [], key: "inner" }], grant: [], key: "outer" },
                {
                    grant: [],
                    key: "sibling",
                    run: (scope) => {
                        calls.push("sibling");
                        scope.emit("note", { value: 1 });
                        scope.emit("note", { value: 1 });
                        scope.emit("note", { value: 2 });
                        return "merge";
                    },
                },
            ],
            commandPrefix: "schedule:subtree",
            maxParallel: 2,
            parent: writer,
        }),
        /nested registration unavailable/u,
    );
    assert.deepEqual(calls, ["sibling"]);
    using plain = new SQLiteTraceStore(databasePath);
    const parent = claimScopeWriter(plain, { claimId: "claim:root", scopeId: writer.scope_id });
    const report = await runScopeTree(plain, {
        children: [
            { children: [{ grant: [], key: "inner" }], grant: [], key: "outer" },
            {
                grant: [],
                key: "sibling",
                run: (scope) => {
                    scope.emit("note", { value: 1 });
                    scope.emit("note", { value: 2 });
                    return "merge";
                },
            },
        ],
        commandPrefix: "schedule:subtree",
        maxParallel: 2,
        parent,
    });
    assert.equal(report.outcomes[0]?.status, "merged");
    assert.equal(report.outcomes[1]?.status, "failed");
    assert.match(report.outcomes[1]?.failure as string, /already names different content/u);
});

class InterruptedForkCompletionStore extends SQLiteTraceStore {
    override completeScopeFork(): never {
        throw new Error("interrupted fork completion");
    }
}

test("a scheduled fork interrupted before completion resumes from its retained origin", async (context) => {
    const workspace = await createForkWorkspace(
        context,
        "tree-fork-resume",
        InterruptedForkCompletionStore,
    );
    const children = [
        {
            fork: { binding: workspace.source },
            grant: [bindingGrant(workspace.source)],
            key: "world",
            run: (): "discard" => "discard",
        },
    ];
    await assert.rejects(
        runScopeTree(workspace.store, {
            carrier: workspace.carrier,
            children,
            commandPrefix: "schedule:fork-resume",
            maxParallel: 1,
            parent: workspace.rootWriter,
        }),
        /interrupted fork completion/u,
    );
    // The binding changes after the prepared fork; resumption still uses the retained origin.
    await writeFile(path.join(workspace.workspaceRoot, "source", "file.txt"), "changed\n");
    workspace.store.close();
    using recovered = new SQLiteTraceStore(workspace.databasePath);
    const report = await runScopeTree(recovered, {
        carrier: workspace.carrier,
        children,
        commandPrefix: "schedule:fork-resume",
        maxParallel: 1,
        parent: claimScopeWriter(recovered, {
            claimId: "claim:root",
            scopeId: workspace.root.scope_id,
        }),
    });
    assert.equal(report.outcomes[0]?.status, "discarded");
    assert.equal(recovered.verifyIntegrity().ok, true);
});
