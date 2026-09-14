import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { Ajv2020, type AnySchemaObject } from "ajv/dist/2020.js";

import * as supervision from "../../src/facades/supervision.ts";
import {
    deriveSupervisedDispatchId,
    dispatchSupervisedEffect,
    injectSupervisionContext,
    openTraceSubscription,
    resolveSupervisedApproval,
    SQLiteTraceStore,
    type TraceSubscriptionDelivery,
} from "../../src/index.ts";
import { SUPERVISION_PROTOCOL_V1_CONTRACT } from "../../src/protocol/compatibility-constants.ts";
import { parseProtocolConfig } from "../../src/protocol/config-validation.ts";
import {
    always,
    appendOwnerRecord,
    eventually,
    intentOf,
    interceptor,
    recordingHandlers,
} from "./fixtures.ts";

test("the supervision facade exposes the complete runtime surface", () => {
    assert.deepEqual(Object.keys(supervision).sort(), [
        "AppendIntentConflictError",
        "SUPERVISION_APPROVAL_GATES",
        "SUPERVISION_APPROVAL_LIMITS",
        "SUPERVISION_APPROVAL_PHASES",
        "SUPERVISION_APPROVAL_REQUIRED_TIERS",
        "SUPERVISION_APPROVAL_VERDICTS",
        "SUPERVISION_COMPATIBILITY_VERSION",
        "SUPERVISION_DECISIONS",
        "SUPERVISION_DECISION_SOURCES",
        "SUPERVISION_DISPOSITIONS",
        "SUPERVISION_FAIL_OPEN_FORBIDDEN_TIERS",
        "SUPERVISION_INTERCEPTION_LIMITS",
        "SUPERVISION_LIMITS",
        "SUPERVISION_RECORD_VERSION",
        "SUPERVISION_RECOVERY_CLASSIFICATIONS",
        "SUPERVISION_SUBSCRIPTION_LIMITS",
        "SUPERVISION_SUBSCRIPTION_OVERFLOW_POLICIES",
        "SUPERVISION_SUBSCRIPTION_START_POSITIONS",
        "SUPERVISION_TIMEOUT_POLICIES",
        "SupervisionApprovalConflictError",
        "SupervisionCursorConflictError",
        "SupervisionEvidenceError",
        "SupervisionLeaseConflictError",
        "SupervisionLeaseFencedError",
        "SupervisionMaterializationUncertainError",
        "SupervisionSubscriptionOverflowError",
        "TraceStoreError",
        "cancelDurableTask",
        "deriveSupervisedDispatchId",
        "deriveSupervisionContextChannelId",
        "dispatchSupervisedEffect",
        "injectSupervisionContext",
        "inspectSupervisedDispatch",
        "openTraceSubscription",
        "readSupervisionContext",
        "requestDurableTaskCancellation",
        "requestDurableTaskPause",
        "resolveSupervisedApproval",
        "resumeDurableTask",
    ]);
    assert.deepEqual(supervision.SUPERVISION_DECISIONS, ["allow", "deny", "replace", "pause"]);
    assert.deepEqual(supervision.SUPERVISION_APPROVAL_REQUIRED_TIERS, ["irreversible"]);
    assert.deepEqual(supervision.SUPERVISION_FAIL_OPEN_FORBIDDEN_TIERS, ["irreversible"]);
    assert.equal(
        new supervision.SupervisionEvidenceError("x").code,
        "SUPERVISION_EVIDENCE_INVALID",
    );
    assert.equal(
        new supervision.SupervisionCursorConflictError(null, "x").code,
        "SUPERVISION_CURSOR_CONFLICT",
    );
    assert.equal(
        new supervision.SupervisionSubscriptionOverflowError(2, 1).code,
        "SUPERVISION_SUBSCRIPTION_OVERFLOW",
    );
    assert.equal(
        new supervision.SupervisionLeaseConflictError("d", "c").code,
        "SUPERVISION_LEASE_CONFLICT",
    );
    assert.equal(
        new supervision.SupervisionLeaseFencedError("d", "c").code,
        "SUPERVISION_LEASE_FENCED",
    );
    assert.equal(
        new supervision.SupervisionMaterializationUncertainError("d", "a").code,
        "SUPERVISION_MATERIALIZATION_UNCERTAIN",
    );
    assert.equal(
        new supervision.SupervisionApprovalConflictError("d").code,
        "SUPERVISION_APPROVAL_CONFLICT",
    );
});

test("supervision protocol configuration matches v1", () => {
    const config = JSON.parse(
        readFileSync(new URL("../../protocol.config.json", import.meta.url), "utf8"),
    ) as Record<string, unknown>;
    assert.deepEqual(
        parseProtocolConfig(structuredClone(config)).supervision,
        SUPERVISION_PROTOCOL_V1_CONTRACT,
    );
    const mutations: readonly [RegExp, (section: SupervisionSection) => void][] = [
        [/exactly its declared fields/u, (section) => Object.assign(section, { extra: true })],
        [
            /leaseRenewalMilliseconds must be shorter/u,
            (section) => {
                section.interception.leaseRenewalMilliseconds =
                    section.interception.decisionLeaseMilliseconds;
            },
        ],
        [
            /defaultBufferCapacity must not exceed/u,
            (section) => {
                section.subscriptions.defaultBufferCapacity = 5_000;
            },
        ],
        [
            /defaultWaitMilliseconds must not exceed/u,
            (section) => {
                section.approval.defaultWaitMilliseconds = 3_600_001;
            },
        ],
        [
            /traceSchemas must be distinct/u,
            (section) => {
                section.traceSchemas.admission = section.traceSchemas.approval;
            },
        ],
        [
            /must contain exactly 4 values/u,
            (section) => {
                section.interception.decisions = ["allow", "deny"];
            },
        ],
        [
            /must cite configured effect reversibility tiers/u,
            (section) => {
                section.approval.requiredTiers = ["catastrophic"];
            },
        ],
        [
            /must be an absolute URL|absolute/u,
            (section) => {
                section.schemas.cursorId = "relative";
            },
        ],
        [
            /positive/u,
            (section) => {
                section.limits.maxReasonBytes = 0;
            },
        ],
    ];
    for (const [message, mutate] of mutations) {
        const candidate = structuredClone(config);
        mutate(candidate.supervision as SupervisionSection);
        assert.throws(
            () => parseProtocolConfig(candidate, { enforceCompatibility: false }),
            message,
        );
    }
    const drifted = structuredClone(config);
    (drifted.supervision as Record<string, unknown>).recordVersion = 2;
    assert.throws(() => parseProtocolConfig(drifted), /new supervision protocol/u);
});

test("published supervision schemas accept retained records and reject malformed copies", async () => {
    using store = new SQLiteTraceStore();
    const cited = appendOwnerRecord(store, "worker:a", "observed");
    const context = injectSupervisionContext(store, {
        channel: "guidance",
        citedRecordIds: [cited],
        commandId: "context:schema",
        data: { hint: "drafts only" },
        supervisorId: "supervisor:main",
    });
    const dispatchId = deriveSupervisedDispatchId("effect:schema");
    const subscription = openTraceSubscription(store, { owners: [dispatchId] });
    const running = dispatchSupervisedEffect(store, {
        citedRecordIds: [context.record_id],
        claimId: "dispatcher:1",
        commandId: "effect:schema",
        handlers: recordingHandlers(),
        intent: intentOf("compensable"),
        interceptors: [
            interceptor(
                "policy:rewrite",
                always({
                    decision: "replace",
                    payload: { path: "drafts/notes.txt" },
                    reason: "confine",
                    reversibility: "irreversible",
                }),
            ),
        ],
    });
    const deliveries: TraceSubscriptionDelivery[] = [];
    await eventually(() => store.readOwner(dispatchId).length === 3);
    const request = store.readOwner(dispatchId)[2];
    resolveSupervisedApproval(store, {
        approverId: "reviewer",
        commandId: "approval:schema",
        dispatchId,
        requestRecordId: request?.envelope.record_id as string,
        verdict: "approved",
    });
    await running;
    while (deliveries.length < 6) {
        deliveries.push((await subscription.next()) as TraceSubscriptionDelivery);
    }
    subscription.close();
    const bodies = new Map<string, Record<string, unknown>[]>();
    for (const delivery of deliveries) {
        const list = bodies.get(delivery.record.envelope.schema_ref) ?? [];
        list.push(delivery.record.body as Record<string, unknown>);
        bodies.set(delivery.record.envelope.schema_ref, list);
    }
    const cases: readonly [string, string, readonly Record<string, unknown>[]][] = [
        ["supervision-dispatch-v1.schema.json", "shepherd.supervision.dispatch.v1", []],
        ["supervision-decision-v1.schema.json", "shepherd.supervision.decision.v1", []],
        ["supervision-approval-v1.schema.json", "shepherd.supervision.approval.v1", []],
        ["supervision-admission-v1.schema.json", "shepherd.supervision.admission.v1", []],
        ["supervision-resolution-v1.schema.json", "shepherd.supervision.resolution.v1", []],
        [
            "supervision-context-v1.schema.json",
            "shepherd.supervision.context.v1",
            [store.readRecord(context.record_id)?.body as Record<string, unknown>],
        ],
    ];
    for (const [file, schemaRef, extra] of cases) {
        const validate = compile(file);
        const retained = [...(bodies.get(schemaRef) ?? []), ...extra];
        assert.ok(retained.length > 0, schemaRef);
        for (const body of retained) {
            assert.equal(validate(body), true, JSON.stringify(validate.errors));
            assert.equal(validate({ ...body, extra: true }), false);
            assert.equal(validate({ ...body, supervision_version: 2 }), false);
        }
    }
    const validateCursor = compile("supervision-cursor-v1.schema.json");
    const cursor = deliveries[0]?.cursor as unknown as Record<string, unknown>;
    assert.equal(validateCursor(cursor), true, JSON.stringify(validateCursor.errors));
    assert.equal(validateCursor({ ...cursor, positions: [] }), false);
    assert.equal(validateCursor({ ...cursor, cursor_id: "cursor" }), false);
});

type SupervisionSection = Record<string, unknown> & {
    readonly approval: Record<string, unknown>;
    readonly interception: Record<string, unknown>;
    readonly limits: Record<string, unknown>;
    readonly schemas: Record<string, unknown>;
    readonly subscriptions: Record<string, unknown>;
    readonly traceSchemas: Record<string, unknown>;
};

function compile(file: string) {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    ajv.addKeyword("x-shepherd-max-utf8-bytes");
    ajv.addKeyword("x-shepherd-max-canonical-bytes");
    return ajv.compile(
        JSON.parse(
            readFileSync(new URL(`../../spec/schemas/${file}`, import.meta.url), "utf8"),
        ) as AnySchemaObject,
    );
}
