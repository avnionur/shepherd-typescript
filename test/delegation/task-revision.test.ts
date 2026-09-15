import assert from "node:assert/strict";
import { test } from "node:test";

import {
    createChildRunHandleId,
    readDelegationApprovalBody,
    readDelegationContextBody,
    readDelegationDecisionBody,
    readDelegationHandoffBody,
    readDelegationOpenedBody,
} from "../../src/delegation/records.ts";
import {
    acceptChildRunResult,
    approveChildRunTask,
    type ChildRunProvenanceDeclaration,
    DelegationApprovalRequiredError,
    DelegationEvidenceError,
    DelegationStatusError,
    DelegationSupervisorError,
    discardChildRun,
    handoffChildRun,
    injectChildRunContext,
    inspectChildRun,
    openChildRun,
    retryChildRun,
    runChildRun,
    SQLiteTraceStore,
    schema,
    task,
    taskValueOf,
} from "../../src/index.ts";
import type { OwnerRecord } from "../../src/store/types.ts";
import { appendOwnerRecord } from "../supervision/fixtures.ts";
import {
    echoTask,
    grantOf,
    openOptions,
    providerFor,
    summaryTask,
    temporaryDatabasePath,
} from "./fixtures.ts";

const LEAD = "supervisor:lead";
const NEXT = "supervisor:next";

type Body = Record<string, unknown>;

/** Echo task with a revised instruction; it keeps the echo task identity. */
const loudEchoTask = task({
    input: schema.string(),
    instruction: "Echo the input loudly.",
    name: "echo",
    output: schema.string(),
    version: "1",
});

/** Echo task with a revised instruction and version. */
const versionedEchoTask = task({
    input: schema.string(),
    instruction: "Echo the input twice.",
    name: "echo",
    output: schema.string(),
    version: "2",
});

const echoValue = taskValueOf(echoTask);
const loudValue = taskValueOf(loudEchoTask);
const versionedValue = taskValueOf(versionedEchoTask);

function revised(changes: readonly string[]): ChildRunProvenanceDeclaration {
    return { changes: changes as never, kind: "revised", source: echoValue };
}

function viewing(
    store: SQLiteTraceStore,
    owners: Readonly<Record<string, readonly OwnerRecord[]>>,
): SQLiteTraceStore {
    return new Proxy(store, {
        get(target, key) {
            if (key === "readOwner") {
                return (ownerId: string) => owners[ownerId] ?? target.readOwner(ownerId);
            }
            const value = Reflect.get(target, key);
            return typeof value === "function" ? value.bind(target) : value;
        },
    });
}

function withBody(record: OwnerRecord, body: Body): OwnerRecord {
    return { ...record, body: body as never };
}

function rejects(read: (body: never) => unknown, body: Body, mutate: (body: Body) => void): void {
    const copy = structuredClone(body);
    mutate(copy);
    assert.throws(() => read(copy as never), DelegationEvidenceError, mutate.toString());
}

test("a revised task value is approval pending until the current supervisor approves it", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "revised");
    using store = new SQLiteTraceStore(databasePath);
    const { handle, inspection } = openChildRun(store, {
        ...openOptions("delegate:revised"),
        provenance: revised(["instruction"]),
        task: loudValue,
    });
    assert.equal(inspection.status, "approval_pending");
    assert.deepEqual(inspection.provenance, {
        fields: ["instruction"],
        kind: "revised",
        source_task: echoValue,
    });
    assert.equal(inspection.approval, null);
    assert.deepEqual(inspection.task, loudValue);
    assert.notEqual(
        inspection.task.artifact_lock.artifact_digest,
        echoValue.artifact_lock.artifact_digest,
    );
    assert.equal(inspection.task.artifact_lock.task_id, echoValue.artifact_lock.task_id);

    await assert.rejects(
        runChildRun(store, { handle, provider: providerFor(loudEchoTask, "hello", "HELLO") }),
        (error: unknown) =>
            error instanceof DelegationApprovalRequiredError &&
            error.handle_id === handle.handle_id &&
            error.code === "DELEGATION_APPROVAL_REQUIRED",
    );
    assert.equal(store.readOwner(handle.child_run_id).length, 0);
    assert.equal(inspectChildRun(store, handle.handle_id).child, null);

    for (const invalid of [
        { verdict: "maybe" },
        { approverId: "" },
        { reason: 5 },
        { extra: true, verdict: "approved" },
    ]) {
        assert.throws(
            () =>
                approveChildRunTask(store, {
                    commandId: "approve:invalid",
                    handle,
                    supervisorId: LEAD,
                    verdict: "approved",
                    ...invalid,
                } as never),
            TypeError,
        );
    }
    assert.throws(
        () =>
            approveChildRunTask(store, {
                commandId: "approve:other",
                handle,
                supervisorId: NEXT,
                verdict: "approved",
            }),
        DelegationSupervisorError,
    );
    assert.equal(store.readOwner(handle.handle_id).length, 1);

    const approved = approveChildRunTask(store, {
        approverId: "reviewer:one",
        commandId: "approve:1",
        handle,
        reason: "instruction change reviewed",
        supervisorId: LEAD,
        verdict: "approved",
    });
    assert.equal(approved.inspection.status, "ready");
    assert.deepEqual(approved.inspection.approval, {
        approver_id: "reviewer:one",
        command_id: "approve:1",
        reason: "instruction change reviewed",
        record_id: approved.record_id,
        supervisor_id: LEAD,
        task_artifact_digest: loudValue.artifact_lock.artifact_digest,
        verdict: "approved",
    });
    const repeat = approveChildRunTask(store, {
        approverId: "reviewer:one",
        commandId: "approve:1",
        handle,
        reason: "instruction change reviewed",
        supervisorId: LEAD,
        verdict: "approved",
    });
    assert.equal(repeat.record_id, approved.record_id);
    assert.throws(
        () =>
            approveChildRunTask(store, {
                commandId: "approve:2",
                handle,
                supervisorId: LEAD,
                verdict: "rejected",
            }),
        (error: unknown) =>
            error instanceof DelegationStatusError &&
            error.status === "ready" &&
            error.message.includes("already approved"),
    );

    const ran = await runChildRun(store, {
        handle,
        provider: providerFor(loudEchoTask, "hello", "HELLO"),
    });
    assert.equal(ran.inspection.status, "settling");
    assert.equal(ran.inspection.completion?.status, "finished");
    const accepted = acceptChildRunResult(store, {
        commandId: "accept:1",
        handle,
        supervisorId: LEAD,
    });
    assert.equal(accepted.inspection.status, "accepted");

    using reopened = new SQLiteTraceStore(databasePath, { readOnly: true });
    assert.deepEqual(inspectChildRun(reopened, handle.handle_id), accepted.inspection);
});

test("a rejected task value never runs but can still be discarded or handed off", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "rejected");
    using store = new SQLiteTraceStore(databasePath);
    const { handle } = openChildRun(store, {
        ...openOptions("delegate:rejected"),
        provenance: revised(["instruction", "task_version"]),
        task: versionedValue,
    });
    const rejected = approveChildRunTask(store, {
        commandId: "reject:1",
        handle,
        supervisorId: LEAD,
        verdict: "rejected",
    });
    assert.equal(rejected.inspection.status, "rejected");
    assert.equal(rejected.inspection.approval?.verdict, "rejected");
    assert.equal(rejected.inspection.approval?.approver_id, LEAD);
    assert.equal(rejected.inspection.approval?.reason, null);
    await assert.rejects(
        runChildRun(store, { handle, provider: providerFor(versionedEchoTask, "hello", "x") }),
        (error: unknown) => error instanceof DelegationStatusError && error.status === "rejected",
    );
    assert.equal(store.readOwner(handle.child_run_id).length, 0);
    const cited = appendOwnerRecord(store, "worker:notes", "n0");
    assert.throws(
        () =>
            injectChildRunContext(store, {
                citedRecordIds: [cited],
                commandId: "inject:rejected",
                data: { hint: "x" },
                handle,
                supervisorId: LEAD,
            }),
        (error: unknown) => error instanceof DelegationStatusError && error.status === "rejected",
    );
    assert.throws(
        () =>
            approveChildRunTask(store, {
                commandId: "approve:again",
                handle,
                supervisorId: LEAD,
                verdict: "approved",
            }),
        DelegationStatusError,
    );
    assert.throws(
        () =>
            openChildRun(store, {
                ...openOptions("delegate:rejected-child", { maxTurns: 1 }),
                parent: handle,
            }),
        (error: unknown) =>
            error instanceof DelegationStatusError &&
            error.status === "rejected" &&
            error.handle_id === handle.handle_id,
    );
    const handed = handoffChildRun(store, {
        commandId: "handoff:rejected",
        handle,
        successorSupervisorId: NEXT,
        supervisorId: LEAD,
    });
    assert.equal(handed.inspection.supervisor_id, NEXT);
    assert.equal(handed.inspection.status, "rejected");
    const discarded = discardChildRun(store, {
        commandId: "discard:rejected",
        handle,
        reason: "rejected revision",
        supervisorId: NEXT,
    });
    assert.equal(discarded.inspection.status, "discarded");
    assert.equal(store.readOwner(handle.child_run_id).length, 0);
});

test("revised provenance must keep the task identity and list exactly the differing fields", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "revised-refusals");
    using store = new SQLiteTraceStore(databasePath);
    const handleId = (commandId: string) => createChildRunHandleId(commandId);
    const elsewhere = appendOwnerRecord(store, "worker:other", "n0");
    const absent = `${elsewhere.slice(0, -1)}${elsewhere.endsWith("0") ? "1" : "0"}`;
    const attempts: readonly [string, Record<string, unknown>][] = [
        ["value without provenance", { task: loudValue }],
        ["unknown change field", { provenance: revised(["name"]), task: loudValue }],
        [
            "changes not an array",
            { provenance: { ...revised([]), changes: "instruction" }, task: loudValue },
        ],
        ["missing change", { provenance: revised(["instruction"]), task: versionedValue }],
        ["extra change", { provenance: revised(["instruction", "task_version"]), task: loudValue }],
        [
            "duplicate change",
            { provenance: revised(["instruction", "instruction"]), task: loudValue },
        ],
        ["identical task", { provenance: revised([]), task: echoValue }],
        [
            "different task identity",
            {
                provenance: revised(["instruction", "input_schema", "output_schema"]),
                task: taskValueOf(summaryTask),
            },
        ],
        [
            "malformed source",
            {
                provenance: {
                    ...revised(["instruction"]),
                    source: { artifact: loudValue.artifact },
                },
                task: loudValue,
            },
        ],
        ["unknown kind", { provenance: { kind: "guessed" }, task: loudValue }],
        [
            "unknown kind with producer",
            {
                provenance: {
                    kind: "guessed",
                    producer: { record_id: elsewhere, run_id: "worker:other" },
                },
                task: loudValue,
            },
        ],
        [
            "declared with extra key",
            { provenance: { extra: 1, kind: "declared" }, task: loudValue },
        ],
        ["synthesized without producer", { provenance: { kind: "synthesized" }, task: loudValue }],
        [
            "synthesized producer malformed",
            {
                provenance: {
                    kind: "synthesized",
                    producer: { record_id: "record", run_id: "worker:x" },
                },
                task: loudValue,
            },
        ],
        [
            "synthesized producer run empty",
            {
                provenance: { kind: "synthesized", producer: { record_id: elsewhere, run_id: "" } },
                task: loudValue,
            },
        ],
    ];
    for (const [label, overrides] of attempts) {
        assert.throws(
            () =>
                openChildRun(store, { ...openOptions(`delegate:${label}`), ...overrides } as never),
            TypeError,
            label,
        );
        assert.equal(store.readOwner(handleId(`delegate:${label}`)).length, 0, label);
    }
    assert.throws(
        () =>
            openChildRun(store, {
                ...openOptions("delegate:absent-producer"),
                provenance: {
                    kind: "synthesized",
                    producer: { record_id: absent, run_id: "worker:x" },
                },
                task: loudValue,
            }),
        DelegationEvidenceError,
    );
    assert.throws(
        () =>
            openChildRun(store, {
                ...openOptions("delegate:other-run-producer"),
                provenance: {
                    kind: "synthesized",
                    producer: { record_id: elsewhere, run_id: "worker:x" },
                },
                task: loudValue,
            }),
        DelegationEvidenceError,
    );
    const declared = openChildRun(store, {
        ...openOptions("delegate:declared-value"),
        provenance: { kind: "declared" },
        task: loudValue,
    });
    assert.equal(declared.inspection.status, "ready");
    assert.throws(
        () =>
            approveChildRunTask(store, {
                commandId: "approve:declared",
                handle: declared.handle,
                supervisorId: LEAD,
                verdict: "approved",
            }),
        (error: unknown) =>
            error instanceof DelegationStatusError && error.message.includes("needs no approval"),
    );
});

test("a revision retry retains the causal replay point and the revised identity", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "revision-retry");
    using store = new SQLiteTraceStore(databasePath);
    const first = openChildRun(store, openOptions("delegate:first"));
    await runChildRun(store, {
        handle: first.handle,
        provider: providerFor(echoTask, "hello", "wrong"),
    });
    const discarded = discardChildRun(store, {
        commandId: "discard:first",
        handle: first.handle,
        reason: "answer rejected",
        supervisorId: LEAD,
    });
    assert.throws(
        () =>
            retryChildRun(store, {
                commandId: "delegate:second",
                handle: first.handle,
                provenance: revised(["instruction"]),
                supervisorId: LEAD,
            }),
        TypeError,
    );
    const successor = retryChildRun(store, {
        commandId: "delegate:second",
        handle: first.handle,
        provenance: revised(["instruction"]),
        supervisorId: LEAD,
        task: loudValue,
    });
    assert.equal(successor.inspection.status, "approval_pending");
    assert.deepEqual(successor.inspection.predecessor, {
        cut_id: successor.inspection.predecessor?.cut_id,
        decision_record_id: discarded.record_id,
        handle_id: first.handle.handle_id,
    });
    const cut = store.readCut(String(successor.inspection.predecessor?.cut_id));
    assert.equal(cut.target_owner_id, first.handle.handle_id);
    assert.equal(cut.through_record_id, discarded.record_id);
    assert.equal(cut.publisher_owner_id, successor.handle.handle_id);

    const inherited = retryChildRun(store, {
        commandId: "delegate:third",
        handle: first.handle,
        supervisorId: LEAD,
    });
    assert.equal(inherited.inspection.status, "ready");
    assert.deepEqual(inherited.inspection.provenance, { kind: "declared" });

    approveChildRunTask(store, {
        commandId: "approve:second",
        handle: successor.handle,
        supervisorId: LEAD,
        verdict: "approved",
    });
    await runChildRun(store, {
        handle: successor.handle,
        provider: providerFor(loudEchoTask, "hello", "HELLO"),
    });
    const settled = discardChildRun(store, {
        commandId: "discard:second",
        handle: successor.handle,
        reason: "still wrong",
        supervisorId: LEAD,
    });
    const third = retryChildRun(store, {
        commandId: "delegate:fourth",
        handle: successor.handle,
        supervisorId: LEAD,
    });
    assert.equal(third.inspection.status, "approval_pending");
    assert.deepEqual(third.inspection.provenance, successor.inspection.provenance);
    assert.equal(third.inspection.predecessor?.decision_record_id, settled.record_id);

    using reopened = new SQLiteTraceStore(databasePath, { readOnly: true });
    const read = inspectChildRun(reopened, successor.handle.handle_id);
    assert.equal(read.task.artifact_lock.artifact_digest, loudValue.artifact_lock.artifact_digest);
    assert.equal(read.task.artifact_lock.task_id, echoValue.artifact_lock.task_id);
    assert.equal(
        read.provenance.kind === "revised"
            ? read.provenance.source_task.artifact_lock.artifact_digest
            : null,
        echoValue.artifact_lock.artifact_digest,
    );
    assert.equal(read.predecessor?.decision_record_id, discarded.record_id);
    assert.equal(
        reopened.readCut(String(read.predecessor?.cut_id)).through_record_id,
        discarded.record_id,
    );

    const opened = structuredClone(store.readOwner(successor.handle.handle_id)[0]?.body) as Body;
    for (const mutate of [
        (value: Body) => {
            (value.predecessor as Body).handle_id = value.handle_id;
        },
        (value: Body) => {
            (value.predecessor as Body).cut_id = "cut";
        },
        (value: Body) => {
            (value.predecessor as Body).decision_record_id = "record";
        },
        (value: Body) => {
            value.predecessor = { handle_id: (value.predecessor as Body).handle_id };
        },
        (value: Body) => {
            (value.provenance as Body).fields = ["task_version"];
        },
        (value: Body) => {
            (value.provenance as Body).fields = "instruction";
        },
        (value: Body) => {
            (value.provenance as Body).source_task = loudValue;
        },
        (value: Body) => {
            (value.provenance as Body).source_task = { artifact: echoValue.artifact };
        },
        (value: Body) => {
            value.provenance = { kind: "revised", source_task: echoValue };
        },
        (value: Body) => {
            value.provenance = { kind: "other", source_record_id: "x", source_run_id: "y" };
        },
        (value: Body) => {
            value.provenance = {
                kind: "synthesized",
                source_record_id: "record",
                source_run_id: "y",
            };
        },
        (value: Body) => {
            value.provenance = {
                kind: "synthesized",
                source_record_id: `record:sha256:${"0".repeat(64)}`,
                source_run_id: "",
            };
        },
    ]) {
        rejects(readDelegationOpenedBody, opened, mutate);
    }
});

test("synthesized task values cite their producing record and are verified at inspection", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "synthesized");
    using store = new SQLiteTraceStore(databasePath);
    const producerId = appendOwnerRecord(store, "worker:planner", "definition");
    const { handle, inspection } = openChildRun(store, {
        ...openOptions("delegate:synthesized"),
        provenance: {
            kind: "synthesized",
            producer: { record_id: producerId, run_id: "worker:planner" },
        },
        task: loudValue,
    });
    assert.equal(inspection.status, "approval_pending");
    assert.deepEqual(inspection.provenance, {
        kind: "synthesized",
        source_record_id: producerId,
        source_run_id: "worker:planner",
    });
    const records = store.readOwner(handle.handle_id);
    const opened = records[0] as OwnerRecord;
    const forged = viewing(store, {
        [handle.handle_id]: [
            withBody(opened, {
                ...opened.body,
                provenance: { ...(opened.body.provenance as Body), source_run_id: "worker:other" },
            }),
        ],
    });
    assert.throws(() => inspectChildRun(forged, handle.handle_id), DelegationEvidenceError);
    assert.deepEqual(inspectChildRun(viewing(store, {}), handle.handle_id), inspection);

    const approved = approveChildRunTask(store, {
        commandId: "approve:synthesized",
        handle,
        supervisorId: LEAD,
        verdict: "approved",
    });
    await runChildRun(store, { handle, provider: providerFor(loudEchoTask, "hello", "HELLO") });
    const afterRun = store.readOwner(handle.handle_id);
    const approval = afterRun[1] as OwnerRecord;
    const completion = afterRun[2] as OwnerRecord;
    assert.equal(approval.envelope.record_id, approved.record_id);
    const declared = openChildRun(store, openOptions("delegate:declared-for-forgery"));
    const declaredRecords = store.readOwner(declared.handle.handle_id);
    const cases: readonly [string, string, readonly OwnerRecord[]][] = [
        ["repeated approval", handle.handle_id, [opened, approval, approval, completion]],
        ["approval after completion", handle.handle_id, [opened, completion, approval]],
        [
            "approval digest disagrees",
            handle.handle_id,
            [
                withBody(opened, opened.body as Body),
                withBody(approval, {
                    ...approval.body,
                    task_artifact_digest: echoValue.artifact_lock.artifact_digest,
                }),
                completion,
            ],
        ],
        [
            "approval names a former supervisor",
            handle.handle_id,
            [opened, withBody(approval, { ...approval.body, supervisor_id: NEXT }), completion],
        ],
        [
            "approval on declared provenance",
            declared.handle.handle_id,
            [...declaredRecords, approval],
        ],
        ["completion without approval", handle.handle_id, [opened, completion]],
    ];
    for (const [label, handleId, forgedRecords] of cases) {
        assert.throws(
            () => inspectChildRun(viewing(store, { [handleId]: forgedRecords }), handleId),
            DelegationEvidenceError,
            label,
        );
    }

    const approvalBody = structuredClone(approval.body) as Body;
    assert.equal(readDelegationApprovalBody(approvalBody as never).verdict, "approved");
    for (const mutate of [
        (value: Body) => {
            value.approver_id = "";
        },
        (value: Body) => {
            value.reason = "r".repeat(1025);
        },
        (value: Body) => {
            value.task_artifact_digest = "md5:abc";
        },
        (value: Body) => {
            value.verdict = "maybe";
        },
        (value: Body) => {
            value.handle_id = "delegation:x";
        },
        (value: Body) => {
            value.extra = 1;
        },
    ]) {
        rejects(readDelegationApprovalBody, approvalBody, mutate);
    }
});

test("context, handoff, and decision readers refuse inconsistent retained bodies", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "readers");
    using store = new SQLiteTraceStore(databasePath);
    const { handle } = openChildRun(store, openOptions("delegate:readers"));
    const cited = appendOwnerRecord(store, "worker:notes", "n0");
    const injected = injectChildRunContext(store, {
        citedRecordIds: [cited],
        commandId: "inject:readers",
        data: { hint: "x" },
        handle,
        supervisorId: LEAD,
    });
    const handed = handoffChildRun(store, {
        commandId: "handoff:readers",
        handle,
        reason: "rotation",
        successorSupervisorId: NEXT,
        supervisorId: LEAD,
    });
    await runChildRun(store, { handle, program: () => "hi" });
    const accepted = acceptChildRunResult(store, {
        commandId: "accept:readers",
        handle,
        supervisorId: NEXT,
    });
    const bodyOf = (recordId: string): Body =>
        structuredClone(store.readRecord(recordId)?.body) as Body;
    const injection = bodyOf(injected.record_id);
    const consumed = structuredClone(
        store.readOwner(handle.handle_id).find((record) => record.body.phase === "consumed")?.body,
    ) as Body;
    const handoff = bodyOf(handed.record_id);
    const decision = bodyOf(accepted.record_id);
    assert.equal(readDelegationContextBody(injection as never).phase, "injected");
    assert.equal(readDelegationContextBody(consumed as never).phase, "consumed");
    assert.equal(readDelegationHandoffBody(handoff as never).successor_id, NEXT);
    assert.equal(readDelegationDecisionBody(decision as never).kind, "accepted");
    for (const mutate of [
        (value: Body) => {
            value.phase = "pending";
        },
        (value: Body) => {
            value.cited_record_ids = [];
        },
        (value: Body) => {
            value.data = [];
        },
        (value: Body) => {
            value.handle_id = "delegation:x";
        },
    ]) {
        rejects(readDelegationContextBody, injection, mutate);
    }
    for (const mutate of [
        (value: Body) => {
            value.request_digest = "digest";
        },
        (value: Body) => {
            value.consumed_record_ids = [];
        },
        (value: Body) => {
            value.supervisor_id = "";
        },
    ]) {
        rejects(readDelegationContextBody, consumed, mutate);
    }
    for (const mutate of [
        (value: Body) => {
            value.successor_id = value.supervisor_id;
        },
        (value: Body) => {
            value.successor_id = "";
        },
        (value: Body) => {
            value.reason = 5;
        },
        (value: Body) => {
            value.command_id = "";
        },
    ]) {
        rejects(readDelegationHandoffBody, handoff, mutate);
    }
    for (const mutate of [
        (value: Body) => {
            value.kind = "deferred";
        },
        (value: Body) => {
            value.reason = "kept";
        },
        (value: Body) => {
            value.output_id = null;
        },
        (value: Body) => {
            value.child_outcome_record_id = null;
        },
        (value: Body) => {
            value.child_outcome_record_id = "record";
        },
        (value: Body) => {
            value.output_id = "digest";
        },
        (value: Body) => {
            value.kind = "discarded";
        },
    ]) {
        rejects(readDelegationDecisionBody, decision, mutate);
    }
    const discardedBody = {
        ...decision,
        child_outcome_record_id: null,
        kind: "discarded",
        output_id: null,
        reason: "no",
    };
    assert.equal(readDelegationDecisionBody(discardedBody as never).kind, "discarded");
    rejects(readDelegationDecisionBody, discardedBody, (value) => {
        value.reason = null;
    });
    assert.deepEqual(
        [grantOf(["read"])].map((grant) => grant.resource_kind),
        ["repository_binding"],
    );
});
