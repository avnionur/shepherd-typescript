import assert from "node:assert/strict";
import { test } from "node:test";
import {
    readDelegationCompletionBody,
    readDelegationOpenedBody,
} from "../../src/delegation/records.ts";
import {
    DelegationEvidenceError,
    inspectChildRun,
    openChildRun,
    runChildRun,
    SQLiteTraceStore,
} from "../../src/index.ts";
import type { Cut, OwnerRecord } from "../../src/store/types.ts";
import { echoTask, grantOf, openOptions, providerFor, temporaryDatabasePath } from "./fixtures.ts";

type Body = Record<string, unknown>;

function rejects(read: (body: never) => unknown, body: Body, mutate: (body: Body) => void): void {
    const copy = structuredClone(body);
    mutate(copy);
    assert.throws(() => read(copy as never), DelegationEvidenceError, mutate.toString());
}

test("record readers reject malformed and forged delegation evidence", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "codec");
    using store = new SQLiteTraceStore(databasePath);
    const { handle } = openChildRun(store, {
        ...openOptions("delegate:codec"),
        grant: [grantOf(["read"]), grantOf(["write"], "repo:other")],
        parent: {
            budget: { maxTurns: 4 },
            ceiling: [grantOf(["read", "write"]), grantOf(["read", "write"], "repo:other")],
            kind: "root",
        },
    });
    const child = openChildRun(store, {
        ...openOptions("delegate:codec-child", { maxTurns: 1 }),
        parent: handle,
    });
    await runChildRun(store, { handle, provider: providerFor(echoTask, "hello", "x") });
    const records = store.readOwner(handle.handle_id);
    const opened = structuredClone(records[0]?.body) as Body;
    const completion = structuredClone(records[1]?.body) as Body;
    const childOpened = structuredClone(store.readOwner(child.handle.handle_id)[0]?.body) as Body;
    assert.deepEqual(readDelegationOpenedBody(opened as never).handle_id, handle.handle_id);
    assert.deepEqual(readDelegationOpenedBody(childOpened as never).depth, 2);
    assert.equal(readDelegationCompletionBody(completion as never).status, "finished");
    const nested = (value: Body, key: string) => value[key] as Body;
    for (const mutate of [
        (value: Body) => {
            value.delegation_version = 2;
        },
        (value: Body) => {
            value.compatibility_version = "shepherd.delegation.v2";
        },
        (value: Body) => {
            value.extra = true;
        },
        (value: Body) => {
            value.command_id = "";
        },
        (value: Body) => {
            value.command_id = "delegate:other";
        },
        (value: Body) => {
            value.supervisor_id = "s".repeat(257);
        },
        (value: Body) => {
            value.child_run_id = childOpened.child_run_id;
        },
        (value: Body) => {
            value.depth = 0;
        },
        (value: Body) => {
            value.depth = 17;
        },
        (value: Body) => {
            value.depth = 1.5;
        },
        (value: Body) => {
            value.depth = 2;
        },
        (value: Body) => {
            nested(value, "task").artifact_lock = childOpened.task;
        },
        (value: Body) => {
            value.task = { artifact: nested(value, "task").artifact };
        },
        (value: Body) => {
            value.input = 5;
        },
        (value: Body) => {
            value.grant = [...(value.grant as Body[])].reverse();
        },
        (value: Body) => {
            value.grant = [grantOf(["read"], "repo:missing")];
        },
        (value: Body) => {
            nested(value, "authority").effective = nested(value, "authority").ceiling;
        },
        (value: Body) => {
            nested(value, "authority").ceiling = [grantOf(["read"])];
        },
        (value: Body) => {
            value.authority = { ceiling: [] };
        },
        (value: Body) => {
            value.budget = { maxTurns: 5 };
        },
        (value: Body) => {
            value.budget = {};
        },
        (value: Body) => {
            value.budget_ceiling = { maxTurns: -1 };
        },
        (value: Body) => {
            value.parent = { kind: "handle" };
        },
        (value: Body) => {
            value.parent = { kind: "other" };
        },
        (value: Body) => {
            value.parent = { ...(childOpened.parent as Body), kind: "other" };
        },
        (value: Body) => {
            value.parent = { ...(childOpened.parent as Body), handle_id: "delegation:x" };
        },
        (value: Body) => {
            value.parent = { ...(childOpened.parent as Body), origin_cut_id: "cut" };
        },
        (value: Body) => {
            value.parent = { ...(childOpened.parent as Body), origin_record_id: "record" };
        },
        (value: Body) => {
            value.provenance = { kind: "revised" };
        },
        (value: Body) => {
            value.provenance = { kind: "declared", extra: 1 };
        },
    ]) {
        rejects(readDelegationOpenedBody, opened, mutate);
    }
    rejects(readDelegationOpenedBody, childOpened, (value) => {
        value.parent = { kind: "root" };
    });
    for (const mutate of [
        (value: Body) => {
            value.delegation_version = 2;
        },
        (value: Body) => {
            value.handle_id = "delegation:x";
        },
        (value: Body) => {
            value.child_run_id = childOpened.child_run_id;
        },
        (value: Body) => {
            value.child_cut_id = "";
        },
        (value: Body) => {
            value.child_terminal_record_id = "record";
        },
        (value: Body) => {
            value.execution_kind = "manual";
        },
        (value: Body) => {
            value.status = "done";
        },
        (value: Body) => {
            value.supervisor_id = "";
        },
    ]) {
        rejects(readDelegationCompletionBody, completion, mutate);
    }
});

test("inspection refuses forged handle, origin cut, parent chain, and completion evidence", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "forged");
    using store = new SQLiteTraceStore(databasePath);
    const root = openChildRun(store, openOptions("delegate:forged"));
    const child = openChildRun(store, {
        ...openOptions("delegate:forged-child", { maxTurns: 1 }),
        parent: root.handle,
    });
    await runChildRun(store, {
        handle: root.handle,
        provider: providerFor(echoTask, "hello", "x"),
    });
    const rootId = root.handle.handle_id;
    const childId = child.handle.handle_id;
    const rootRecords = store.readOwner(rootId);
    const childRecords = store.readOwner(childId);
    const childParent = childRecords[0]?.body.parent as
        | { readonly origin_cut_id: string }
        | undefined;
    const originCutId = String(childParent?.origin_cut_id);
    const forge = (
        source: readonly OwnerRecord[],
        index: number,
        patch: Partial<OwnerRecord["envelope"]> & { readonly body?: Record<string, unknown> },
    ): OwnerRecord[] =>
        source.map((record, position) =>
            position === index
                ? {
                      ...record,
                      body: (patch.body ?? record.body) as never,
                      envelope: { ...record.envelope, ...patch, body: undefined } as never,
                  }
                : record,
        );
    const viewing = (
        owners: Readonly<Record<string, readonly OwnerRecord[]>>,
        cut?: Cut,
    ): SQLiteTraceStore =>
        new Proxy(store, {
            get(target, key) {
                if (key === "readOwner") {
                    return (ownerId: string) => owners[ownerId] ?? target.readOwner(ownerId);
                }
                if (key === "readCut" && cut !== undefined) {
                    return () => cut;
                }
                const value = Reflect.get(target, key);
                return typeof value === "function" ? value.bind(target) : value;
            },
        });
    const opened = rootRecords[0] as OwnerRecord;
    const completion = rootRecords[1] as OwnerRecord;
    const childOpened = childRecords[0] as OwnerRecord;
    const cases: readonly [string, string, SQLiteTraceStore][] = [
        [
            "opened schema",
            rootId,
            viewing({
                [rootId]: forge(rootRecords, 0, { schema_ref: "shepherd.delegation.context.v1" }),
            }),
        ],
        ["opened mode", rootId, viewing({ [rootId]: forge(rootRecords, 0, { mode: "capture" }) })],
        [
            "opened names another handle",
            rootId,
            viewing({ [rootId]: forge(rootRecords, 0, { body: childOpened.body }) }),
        ],
        [
            "root opened with causes",
            rootId,
            viewing({
                [rootId]: forge(rootRecords, 0, {
                    caused_by_record_ids: [completion.envelope.record_id],
                }),
            }),
        ],
        [
            "child opened without the parent head cause",
            childId,
            viewing({ [childId]: forge(childRecords, 0, { caused_by_record_ids: [] }) }),
        ],
        ["origin cut missing", childId, viewing({ [childId]: childRecords.slice(0, 1) })],
        [
            "origin cut record replaced",
            childId,
            viewing({
                [childId]: forge(childRecords, 1, {
                    schema_ref: "shepherd.delegation.completion.v1",
                }),
            }),
        ],
        [
            "origin cut record mode",
            childId,
            viewing({ [childId]: forge(childRecords, 1, { mode: "declaration" }) }),
        ],
        [
            "origin cut disagrees",
            childId,
            viewing(
                {},
                { ...store.readCut(originCutId), through_record_id: opened.envelope.record_id },
            ),
        ],
        [
            "child ceiling differs from the parent",
            childId,
            viewing({
                [childId]: forge(childRecords, 0, {
                    body: {
                        ...childOpened.body,
                        authority: { ceiling: [], effective: [] },
                        grant: [],
                    },
                }),
            }),
        ],
        [
            "child budget ceiling differs from the parent",
            childId,
            viewing({
                [childId]: forge(childRecords, 0, {
                    body: { ...childOpened.body, budget_ceiling: { maxTurns: 3 } },
                }),
            }),
        ],
        [
            "child depth differs from the parent",
            childId,
            viewing({
                [childId]: forge(childRecords, 0, { body: { ...childOpened.body, depth: 3 } }),
            }),
        ],
        [
            "completion status disagrees",
            rootId,
            viewing({
                [rootId]: forge(rootRecords, 1, { body: { ...completion.body, status: "failed" } }),
            }),
        ],
        [
            "completion supervisor disagrees",
            rootId,
            viewing({
                [rootId]: forge(rootRecords, 1, {
                    body: { ...completion.body, supervisor_id: "supervisor:other" },
                }),
            }),
        ],
        [
            "completion causes",
            rootId,
            viewing({
                [rootId]: forge(rootRecords, 1, {
                    caused_by_record_ids: [opened.envelope.record_id],
                }),
            }),
        ],
        [
            "completion mode",
            rootId,
            viewing({ [rootId]: forge(rootRecords, 1, { mode: "declaration" }) }),
        ],
        [
            "unsupported record",
            rootId,
            viewing({
                [rootId]: forge(rootRecords, 1, { schema_ref: "shepherd.delegation.handoff.v1" }),
            }),
        ],
        ["repeated completion", rootId, viewing({ [rootId]: [...rootRecords, completion] })],
        [
            "completion before the child terminal",
            childId,
            viewing({ [childId]: [...childRecords, completion] }),
        ],
        [
            "child run evidence",
            rootId,
            viewing({
                [root.handle.child_run_id]: store.readOwner(root.handle.child_run_id).slice(0, 1),
            }),
        ],
    ];
    for (const [label, handleId, forged] of cases) {
        assert.throws(() => inspectChildRun(forged, handleId), DelegationEvidenceError, label);
    }
    assert.deepEqual(inspectChildRun(viewing({}), childId), inspectChildRun(store, childId));
});
