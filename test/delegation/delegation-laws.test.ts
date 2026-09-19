import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
    type ChildRunHandle,
    DELEGATION_LIMITS,
    DelegationAuthorityError,
    inspectChildRun,
    openChildRun,
    type RunBudgetDefinition,
    runChildRun,
    type ScopeResourceGrant,
    SQLiteTraceStore,
} from "../../src/index.ts";
import { seededRandom } from "../support/prng.ts";
import { echoTask, grantOf, temporaryDatabasePath } from "./fixtures.ts";

const LAW_CONFIG = JSON.parse(
    await readFile(new URL("../../config/delegation-law.config.json", import.meta.url), "utf8"),
) as {
    readonly childrenPerHandle: number;
    readonly maxDepth: number;
    readonly resources: readonly string[];
    readonly seeds: readonly number[];
};
const ATOMS = ["read", "write"] as const;
const METRICS = ["maxEffects", "maxInputTokens", "maxTurns"] as const;

type Grant = readonly ScopeResourceGrant[];

function includes(ceiling: Grant, effective: Grant): boolean {
    return effective.every((grant) => {
        const above = ceiling.find(
            (entry) =>
                entry.resource_kind === grant.resource_kind &&
                entry.resource_id === grant.resource_id,
        );
        return above !== undefined && grant.atoms.every((atom) => above.atoms.includes(atom));
    });
}

function budgetIncludes(ceiling: RunBudgetDefinition, budget: RunBudgetDefinition): boolean {
    return Object.entries(ceiling).every(
        ([metric, limit]) =>
            (budget as Record<string, number | undefined>)[metric] !== undefined &&
            ((budget as Record<string, number>)[metric] as number) <= (limit as number),
    );
}

function randomGrant(
    random: () => number,
    allowed: readonly string[],
    foreign: readonly string[] = [],
): Grant {
    const candidates = [
        ...allowed.filter(() => random() < 0.8),
        ...foreign.filter(() => random() < 0.15),
    ];
    return LAW_CONFIG.resources
        .filter((resource) => candidates.includes(resource))
        .map((resource) =>
            grantOf(
                ATOMS.filter(() => random() < 0.7),
                resource,
            ),
        );
}

function randomBudget(random: () => number, ceiling: RunBudgetDefinition): RunBudgetDefinition {
    const budget: Record<string, number> = {};
    for (const metric of METRICS) {
        const limit = (ceiling as Record<string, number | undefined>)[metric];
        if (limit !== undefined) {
            budget[metric] = Math.floor(random() * (limit + 1));
        } else if (random() < 0.3) {
            budget[metric] = Math.floor(random() * 8);
        }
    }
    return budget as RunBudgetDefinition;
}

test("delegation never amplifies resource or budget authority across random handle chains", async (context) => {
    for (const seed of LAW_CONFIG.seeds) {
        const random = seededRandom(seed);
        const databasePath = await temporaryDatabasePath(context, `laws-${seed}`);
        using store = new SQLiteTraceStore(databasePath);
        const ceiling = randomGrant(random, LAW_CONFIG.resources);
        const rootBudget: RunBudgetDefinition = { maxInputTokens: 64, maxTurns: 4 };
        const frontier: {
            readonly handle: ChildRunHandle | null;
            readonly authority: Grant;
            readonly budget: RunBudgetDefinition;
            readonly depth: number;
        }[] = [{ authority: ceiling, budget: rootBudget, depth: 0, handle: null }];
        const opened: ChildRunHandle[] = [];
        let refusals = 0;
        let command = 0;
        while (frontier.length > 0) {
            const parent = frontier.shift() as (typeof frontier)[number];
            if (parent.depth >= LAW_CONFIG.maxDepth) {
                continue;
            }
            for (let index = 0; index < LAW_CONFIG.childrenPerHandle; index += 1) {
                command += 1;
                const allowed = parent.authority.map((entry) => entry.resource_id);
                const grant = randomGrant(
                    random,
                    allowed,
                    LAW_CONFIG.resources.filter((resource) => !allowed.includes(resource)),
                );
                const exceeds = grant.some(
                    (entry) =>
                        !parent.authority.some((above) => above.resource_id === entry.resource_id),
                );
                const budget =
                    random() < 0.2
                        ? { maxTurns: (parent.budget.maxTurns ?? 0) + 1 }
                        : randomBudget(random, parent.budget);
                const open = () =>
                    openChildRun(store, {
                        budget,
                        commandId: `law:${seed}:${command}`,
                        grant,
                        input: "law",
                        parent:
                            parent.handle === null
                                ? { budget: rootBudget, ceiling, kind: "root" }
                                : parent.handle,
                        supervisorId: "supervisor:law",
                        task: echoTask,
                    });
                if (exceeds || !budgetIncludes(parent.budget, budget)) {
                    assert.throws(open, DelegationAuthorityError);
                    refusals += 1;
                    continue;
                }
                const { handle, inspection } = open();
                opened.push(handle);
                assert.equal(inspection.depth, parent.depth + 1);
                assert.deepEqual(inspection.authority.ceiling, parent.authority);
                assert.ok(includes(inspection.authority.ceiling, inspection.authority.effective));
                assert.ok(includes(grant, inspection.authority.effective));
                assert.ok(includes(parent.authority, inspection.authority.effective));
                assert.ok(budgetIncludes(inspection.budget.ceiling, inspection.budget.effective));
                assert.deepEqual(inspection.budget.ceiling, parent.budget);
                frontier.push({
                    authority: inspection.authority.effective,
                    budget: inspection.budget.effective,
                    depth: inspection.depth,
                    handle,
                });
            }
        }
        assert.ok(opened.length > 0, `seed ${seed} opened no handles`);
        assert.ok(refusals > 0, `seed ${seed} refused nothing`);
        const leaf = opened.at(-1) as ChildRunHandle;
        const ran = await runChildRun(store, {
            handle: leaf,
            program: ({ authority, handle }) => {
                assert.deepEqual(authority, handle.authority);
                return "leaf";
            },
        });
        // A leaf drawn with a zero turn budget is exhausted before its program runs.
        assert.ok(["finished", "exhausted"].includes(String(ran.inspection.completion?.status)));
        assert.equal(
            ran.inspection.completion?.status,
            ran.inspection.child?.outcome?.outcome.outcome.status,
        );
        for (const handle of opened) {
            const inspection = inspectChildRun(store, handle.handle_id);
            assert.ok(includes(inspection.authority.ceiling, inspection.authority.effective));
            assert.ok(budgetIncludes(inspection.budget.ceiling, inspection.budget.effective));
            if (inspection.parent.kind === "handle") {
                const parent = inspectChildRun(store, inspection.parent.handle_id);
                assert.deepEqual(inspection.authority.ceiling, parent.authority.effective);
                assert.deepEqual(inspection.budget.ceiling, parent.budget.effective);
                assert.equal(inspection.depth, parent.depth + 1);
                assert.equal(
                    store.readCut(inspection.parent.origin_cut_id).target_owner_id,
                    parent.handle_id,
                );
            }
        }
        using imported = new SQLiteTraceStore();
        imported.importTrace(store.exportTrace());
        assert.deepEqual(
            inspectChildRun(imported, leaf.handle_id),
            inspectChildRun(store, leaf.handle_id),
        );
        assert.equal(store.verifyIntegrity().ok, true);
    }
});

test("nesting depth is bounded by configuration", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "depth");
    using store = new SQLiteTraceStore(databasePath);
    let parent: ChildRunHandle | null = null;
    for (let depth = 1; depth <= DELEGATION_LIMITS.maxNestingDepth; depth += 1) {
        const { handle, inspection } = openChildRun(store, {
            budget: { maxTurns: 1 },
            commandId: `depth:${depth}`,
            grant: [],
            input: "deep",
            parent: parent ?? { budget: { maxTurns: 1 }, ceiling: [], kind: "root" },
            supervisorId: "supervisor:depth",
            task: echoTask,
        });
        assert.equal(inspection.depth, depth);
        parent = handle;
    }
    assert.throws(
        () =>
            openChildRun(store, {
                budget: { maxTurns: 1 },
                commandId: "depth:beyond",
                grant: [],
                input: "deep",
                parent: parent as ChildRunHandle,
                supervisorId: "supervisor:depth",
                task: echoTask,
            }),
        DelegationAuthorityError,
    );
});
