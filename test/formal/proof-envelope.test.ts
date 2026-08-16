import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
    classifyProofEnvelope,
    TypedEffectTraceValidationError,
    validateTypedEffectTrace,
} from "../../src/index.ts";

const PROGRAM_REF =
    "program:sha256:386f6477ff0406a20e1c2a6d8025387dd794ad4aaafbfe976b475f984c84e529";

const fixture = JSON.parse(
    readFileSync(new URL("../fixtures/typed-effect-reference-v1.json", import.meta.url), "utf8"),
) as {
    readonly cases: readonly {
        readonly boundary: string;
        readonly case: string;
        readonly completed: boolean;
        readonly program_ref: string;
        readonly trace: readonly unknown[];
    }[];
    readonly source: { readonly revision: string };
};

const HANDLED_RETURN_TRACE = [
    {
        branch_ref: "branch:root",
        effect_kind: "eff.a",
        execution_context_ref: "ctx:runtime:4",
        full_continuation_ref: "continuation:runtime:3",
        operation_result_schema_ref: null,
        payload: null,
        payload_schema_ref: null,
        program_ref: PROGRAM_REF,
        record_type: "EffectDeclaration",
        ref: "declaration:0",
    },
    {
        captured_continuation_control_ref: "continuation-control:runtime:6",
        captured_continuation_ref: "continuation:runtime:5",
        declaration_ref: "declaration:0",
        handled_result_schema_ref: "schema:handled-result:h.v1",
        handler_context_ref: "ctx:runtime:9",
        handler_frame_ref: "handler-env:0",
        handler_id: "h.v1",
        outer_context_ref: "ctx:runtime:4",
        outer_continuation_control_ref: "continuation-control:runtime:6",
        outer_continuation_ref: "continuation:runtime:7",
        record_type: "HandlerSelection",
        ref: "selection:1",
        selected_binding_ref: "install:1",
        worker_context_ref: "ctx:runtime:4",
    },
    {
        continuation_ref: "continuation:runtime:5",
        declaration_ref: "declaration:0",
        handled_result_schema_ref: "schema:handled-result:h.v1",
        operation_result_schema_ref: null,
        record_type: "ResumptionHandle",
        ref: "resumption:2",
        selection_ref: "selection:1",
    },
    {
        action_kind: "return",
        action_payload: "handled",
        branch_ref: "branch:root",
        continuation_disposition: "completed",
        outer_context_ref: "ctx:runtime:4",
        record_type: "EffectCapture",
        ref: "capture:3",
        selection_path_ref: "path:selection:1/resumption:2/branch:root",
        selection_ref: "selection:1",
    },
] as const;

test("typed-effect machine accepts pinned Core-0 and Core-A lifecycle vectors", () => {
    assert.equal(fixture.source.revision, "d45074e0099d9ccafeed4a233702ad68ff8a2fa6");
    assert.deepEqual(
        fixture.cases.map((item) => item.case),
        [
            "core0-pure-let",
            "core0-handled-return",
            "core0-one-resume",
            "core0-deep-handling",
            "core0-handler-side-outward-perform",
            "core0-unhandled-suspension-prefix",
            "core-a-answer-abort",
            "core-a-outer-return-closes-inner",
            "core-a-outer-abort-closes-inner",
        ],
    );
    for (const item of fixture.cases) {
        const result = validateTypedEffectTrace({
            completed: item.completed,
            programRef: item.program_ref,
            trace: item.trace,
        });
        assert.equal(result.record_count, item.trace.length, item.case);
        assert.equal(result.open_path_count, 0, item.case);
    }

    const completed = validateTypedEffectTrace({
        completed: true,
        programRef: PROGRAM_REF,
        trace: HANDLED_RETURN_TRACE,
    });
    assert.deepEqual(completed, {
        completed: true,
        open_path_count: 0,
        program_ref: PROGRAM_REF,
        record_count: 4,
    });
    assert.ok(Object.isFrozen(completed));

    const abortTrace = HANDLED_RETURN_TRACE.map((record) =>
        record.record_type === "EffectCapture"
            ? {
                  ...record,
                  action_kind: "abort",
                  action_payload: "blocked",
                  continuation_disposition: "aborted",
              }
            : record,
    );
    assert.equal(
        validateTypedEffectTrace({ completed: true, programRef: PROGRAM_REF, trace: abortTrace })
            .record_count,
        4,
    );
});

test("typed-effect machine distinguishes valid live prefixes from completed traces", () => {
    const prefix = validateTypedEffectTrace({
        completed: false,
        programRef: PROGRAM_REF,
        trace: HANDLED_RETURN_TRACE.slice(0, 3),
    });
    assert.equal(prefix.open_path_count, 1);
    assert.throws(
        () =>
            validateTypedEffectTrace({
                completed: true,
                programRef: PROGRAM_REF,
                trace: HANDLED_RETURN_TRACE.slice(0, 3),
            }),
        TypedEffectTraceValidationError,
    );
});

test("typed-effect machine rejects malformed ordering, correlation, and unsupported records", () => {
    const selectionBeforeDeclaration = [HANDLED_RETURN_TRACE[1], HANDLED_RETURN_TRACE[0]];
    const changedContinuation = HANDLED_RETURN_TRACE.map((record) =>
        record.record_type === "ResumptionHandle"
            ? { ...record, continuation_ref: "continuation:changed" }
            : record,
    );
    const duplicateRef = [...HANDLED_RETURN_TRACE, { ...HANDLED_RETURN_TRACE[3] }];
    const unsupported = [
        ...HANDLED_RETURN_TRACE.slice(0, 3),
        { record_type: "HandlerForward", ref: "forward:3" },
    ];
    for (const trace of [
        selectionBeforeDeclaration,
        changedContinuation,
        duplicateRef,
        unsupported,
    ]) {
        assert.throws(
            () => validateTypedEffectTrace({ completed: true, programRef: PROGRAM_REF, trace }),
            TypedEffectTraceValidationError,
        );
    }
});

test("proof-envelope classifier upgrades only validated reference evidence", () => {
    const envelope = classifyProofEnvelope({
        completed: true,
        programRef: PROGRAM_REF,
        trace: HANDLED_RETURN_TRACE,
    });
    assert.equal(envelope.profile, "reference_core_a");
    assert.equal(envelope.strength, "reference_validated");
    assert.equal(
        envelope.evidence_id,
        "proof-evidence:sha256:9e0dcfeb86a068b6c82c7ecb0261da46fb2293d136d4a3a200971500ffb3fb4a",
    );
    assert.equal(
        envelope.trace_ref,
        "trace:sha256:3a06aa43deea117af6931045aa1f7ae82a396aa39db0162d9f66146786480bed",
    );
    assert.deepEqual(envelope.theorem_ids, []);
    assert.equal(envelope.proof_backed, false);
    assert.equal(envelope.reference_validated, true);
    assert.ok(Object.isFrozen(envelope));
    assert.ok(Object.isFrozen(envelope.metadata));
    assert.ok(Object.isFrozen(envelope.theorem_ids));
});

test("proof-envelope classifier keeps missing, malformed, and unsupported evidence runtime-only", () => {
    const cases = [
        { completed: true, trace: HANDLED_RETURN_TRACE },
        {
            completed: true,
            programRef: PROGRAM_REF,
            trace: HANDLED_RETURN_TRACE.slice(0, 3),
        },
        {
            completed: true,
            programRef: PROGRAM_REF,
            trace: [{ record_type: "HandlerForward", ref: "forward:0" }],
        },
    ] as const;
    for (const options of cases) {
        const envelope = classifyProofEnvelope(options);
        assert.equal(envelope.profile, "runtime_only");
        assert.equal(envelope.strength, "runtime_only");
        assert.equal(envelope.evidence_id, null);
        assert.equal(envelope.program_ref, null);
        assert.equal(envelope.trace_ref, null);
        assert.deepEqual(envelope.theorem_ids, []);
        assert.equal(envelope.proof_backed, false);
        assert.equal(envelope.reference_validated, false);
        assert.equal(typeof envelope.metadata.reason, "string");
    }
});

test("live reference prefixes remain reference-validated without a proof-backed claim", () => {
    const envelope = classifyProofEnvelope({
        completed: false,
        programRef: PROGRAM_REF,
        trace: HANDLED_RETURN_TRACE.slice(0, 3),
    });
    assert.equal(envelope.profile, "reference_core_a");
    assert.equal(envelope.strength, "reference_validated");
    assert.match(envelope.trace_ref ?? "", /^trace-prefix:sha256:[0-9a-f]{64}$/u);
    assert.equal(envelope.metadata.completed, false);
    assert.equal(envelope.proof_backed, false);
});

test("typed-effect machine rejects malformed public option and record containers", () => {
    for (const options of [
        null,
        [],
        { completed: "yes", programRef: PROGRAM_REF, trace: [] },
        { completed: true, programRef: PROGRAM_REF, trace: {} },
        { completed: true, programRef: null, trace: [] },
        { completed: true, programRef: "program:sha256:short", trace: [] },
        { completed: true, programRef: `program:sha256:${"g".repeat(64)}`, trace: [] },
        { completed: true, extra: true, programRef: PROGRAM_REF, trace: [] },
    ]) {
        assert.throws(
            () => validateTypedEffectTrace(options as never),
            (error: unknown) =>
                error instanceof TypeError || error instanceof TypedEffectTraceValidationError,
        );
    }
    const accessor = Object.defineProperty({}, "record_type", {
        enumerable: true,
        get: () => "EffectDeclaration",
    });
    for (const record of [
        null,
        [],
        Object.create({ record_type: "EffectDeclaration", ref: "declaration:0" }),
        accessor,
        { record_type: "", ref: "record:0" },
        { record_type: "EffectDeclaration", ref: 1 },
    ]) {
        assert.throws(
            () =>
                validateTypedEffectTrace({
                    completed: false,
                    programRef: PROGRAM_REF,
                    trace: [record],
                }),
            TypedEffectTraceValidationError,
        );
    }
});

test("typed-effect machine rejects corrupted declaration, selection, and handle evidence", () => {
    const base = fixtureCase("core0-handled-return");
    const corruptions = [
        replaceRecord(base.trace, "EffectDeclaration", { branch_ref: "branch:other" }),
        replaceRecord(base.trace, "EffectDeclaration", { effect_kind: "" }),
        replaceRecord(base.trace, "EffectDeclaration", { execution_context_ref: "" }),
        replaceRecord(base.trace, "EffectDeclaration", { full_continuation_ref: "" }),
        replaceRecord(base.trace, "EffectDeclaration", { operation_result_schema_ref: 1 }),
        replaceRecord(base.trace, "EffectDeclaration", { payload: Number.NaN }),
        replaceRecord(base.trace, "EffectDeclaration", { payload_schema_ref: 1 }),
        replaceRecord(base.trace, "EffectDeclaration", { program_ref: `${PROGRAM_REF}0` }),
        replaceRecord(base.trace, "EffectDeclaration", { extra: true }),
        replaceRecord(base.trace, "HandlerSelection", { declaration_ref: "declaration:missing" }),
        replaceRecord(base.trace, "HandlerSelection", { worker_context_ref: "ctx:other" }),
        replaceRecord(base.trace, "HandlerSelection", { selected_binding_ref: "" }),
        replaceRecord(base.trace, "HandlerSelection", { handler_id: "" }),
        replaceRecord(base.trace, "HandlerSelection", { handler_frame_ref: "" }),
        replaceRecord(base.trace, "HandlerSelection", { outer_continuation_ref: "" }),
        replaceRecord(base.trace, "HandlerSelection", { captured_continuation_ref: "" }),
        replaceRecord(base.trace, "HandlerSelection", { handled_result_schema_ref: "" }),
        replaceRecord(base.trace, "HandlerSelection", { handler_context_ref: "" }),
        replaceRecord(base.trace, "HandlerSelection", { outer_context_ref: "" }),
        replaceRecord(base.trace, "HandlerSelection", {
            captured_continuation_control_ref: "",
        }),
        replaceRecord(base.trace, "HandlerSelection", { outer_continuation_control_ref: "" }),
        replaceRecord(base.trace, "ResumptionHandle", { selection_ref: "selection:missing" }),
        replaceRecord(base.trace, "ResumptionHandle", { declaration_ref: "declaration:missing" }),
        replaceRecord(base.trace, "ResumptionHandle", { continuation_ref: "continuation:other" }),
        replaceRecord(base.trace, "ResumptionHandle", {
            handled_result_schema_ref: "schema:other",
        }),
        replaceRecord(base.trace, "ResumptionHandle", {
            operation_result_schema_ref: "schema:other",
        }),
        replaceRecord(base.trace, "ResumptionHandle", { ref: "" }),
    ];
    const duplicateSelection = [
        ...base.trace.slice(0, 2),
        { ...asRecord(base.trace[1]), ref: "selection:duplicate" },
        ...base.trace.slice(2),
    ];
    const duplicateHandle = [
        ...base.trace.slice(0, 3),
        { ...asRecord(base.trace[2]), ref: "resumption:duplicate" },
        ...base.trace.slice(3),
    ];
    for (const trace of [...corruptions, duplicateSelection, duplicateHandle]) {
        expectTraceRejection(base, trace);
    }
    assert.throws(
        () =>
            validateTypedEffectTrace({
                completed: true,
                programRef: base.program_ref,
                trace: base.trace.slice(0, 2),
            }),
        TypedEffectTraceValidationError,
    );
});

test("typed-effect machine rejects corrupted resume, return, and capture evidence", () => {
    const base = fixtureCase("core0-one-resume");
    const resumeCorruptions = [
        { source_record_type: "ContinuationPending" },
        { source_ref: "resumption:missing" },
        { selection_ref: "selection:missing" },
        { declaration_ref: "declaration:missing" },
        { selection_path_ref: "path:missing" },
        { returns_to_handler: false },
        { continuation_ref: "continuation:other" },
        { branch_ref: "branch:other" },
        { worker_context_ref: "ctx:other" },
        { handler_context_ref: "" },
        { handler_continuation_ref: "" },
        { handler_dynamic_tail_ref: "" },
        { value: Number.NaN },
        { ref: "" },
    ].map((change) => replaceRecord(base.trace, "ContinuationResume", change));
    const returnCorruptions = [
        { resume_ref: "resume:missing" },
        { selection_ref: "selection:missing" },
        { selection_path_ref: "path:missing" },
        { branch_ref: "branch:other" },
        { handler_continuation_ref: "continuation:other" },
        { handler_dynamic_tail_ref: "continuation:other" },
        { handler_context_ref: "ctx:other" },
        { value: "different" },
        { ref: "" },
    ].map((change) => replaceRecord(base.trace, "ResumeReturn", change));
    const captureCorruptions = [
        { selection_ref: "selection:missing" },
        { selection_path_ref: "path:missing" },
        { branch_ref: "branch:other" },
        { action_kind: "forward" },
        { continuation_disposition: "aborted" },
        { action_payload: Number.NaN },
        { outer_context_ref: "ctx:other" },
        { ref: "" },
    ].map((change) => replaceRecord(base.trace, "EffectCapture", change));
    const duplicateResume = [
        ...base.trace.slice(0, 4),
        { ...asRecord(base.trace[3]), ref: "resume:duplicate" },
        ...base.trace.slice(4),
    ];
    const duplicateReturn = [
        ...base.trace.slice(0, 5),
        { ...asRecord(base.trace[4]), ref: "resume-return:duplicate" },
        ...base.trace.slice(5),
    ];
    const captureBeforeReturn = [...base.trace.slice(0, 4), base.trace[5], base.trace[4]];
    for (const trace of [
        ...resumeCorruptions,
        ...returnCorruptions,
        ...captureCorruptions,
        duplicateResume,
        duplicateReturn,
        captureBeforeReturn,
    ]) {
        expectTraceRejection(base, trace);
    }
});

test("typed-effect machine rejects corrupted Core-A selection closure evidence", () => {
    const base = fixtureCase("core-a-outer-return-closes-inner");
    const corruptions = [
        { selection_path_ref: "path:missing" },
        { selection_ref: "selection:missing" },
        { branch_ref: "branch:other" },
        { caused_by_record_type: "ResumeReturn" },
        { caused_by_ref: "capture:missing" },
        { closed_by_selection_ref: "selection:missing" },
        { closed_by_selection_path_ref: "path:missing" },
        { reason: "skipped_by_outer_abort" },
        { ref: "" },
    ].map((change) => replaceRecord(base.trace, "SelectionClosed", change));
    const unrelatedClosure = replaceRecord(
        base.trace,
        "HandlerSelection",
        {
            outer_continuation_control_ref: "continuation-control:unrelated",
        },
        1,
    );
    const closureBeforeCause = [...base.trace.slice(0, 6), base.trace[7], base.trace[6]];
    for (const trace of [...corruptions, unrelatedClosure, closureBeforeCause]) {
        expectTraceRejection(base, trace);
    }
});

test("typed-effect machine closes a dynamically nested path after an outer resume returns", () => {
    const base = fixtureCase("core-a-outer-return-closes-inner");
    const resumedOuterPath = [
        ...base.trace.slice(0, 3),
        {
            branch_ref: "branch:root",
            continuation_ref: "continuation:runtime:7",
            declaration_ref: "declaration:0",
            handler_context_ref: "ctx:runtime:12",
            handler_continuation_ref: "continuation:handler:outer",
            handler_dynamic_tail_ref: "continuation:handler:tail",
            record_type: "ContinuationResume",
            ref: "resume:outer",
            returns_to_handler: true,
            selection_path_ref: "path:selection:1/resumption:2/branch:root",
            selection_ref: "selection:1",
            source_record_type: "ResumptionHandle",
            source_ref: "resumption:2",
            value: "outer-value",
            worker_context_ref: "ctx:runtime:6",
        },
        {
            branch_ref: "branch:root",
            handler_context_ref: "ctx:runtime:12",
            handler_continuation_ref: "continuation:handler:outer",
            handler_dynamic_tail_ref: "continuation:handler:tail",
            record_type: "ResumeReturn",
            ref: "resume-return:outer",
            resume_ref: "resume:outer",
            selection_path_ref: "path:selection:1/resumption:2/branch:root",
            selection_ref: "selection:1",
            value: "outer-value",
        },
        ...base.trace.slice(3),
    ];
    const result = validateTypedEffectTrace({
        completed: true,
        programRef: base.program_ref,
        trace: resumedOuterPath,
    });
    assert.equal(result.open_path_count, 0);
    assert.equal(result.record_count, base.trace.length + 2);
});

test("proof-envelope classifier validates top-level data and propagates unexpected failures", () => {
    const accessor = Object.defineProperty({}, "completed", {
        enumerable: true,
        get: () => true,
    });
    for (const options of [
        null,
        [],
        Object.create({ completed: true, trace: [] }),
        accessor,
        { completed: true, extra: true, trace: [] },
        { completed: "yes", trace: [] },
        { completed: true, trace: {} },
        { completed: true, programRef: 1, trace: [] },
    ]) {
        assert.throws(() => classifyProofEnvelope(options as never), TypeError);
    }
    const unexpected = new Proxy(
        {},
        {
            getPrototypeOf() {
                throw new Error("unexpected proxy failure");
            },
        },
    );
    assert.throws(
        () =>
            classifyProofEnvelope({
                completed: true,
                programRef: PROGRAM_REF,
                trace: [unexpected],
            }),
        /unexpected proxy failure/u,
    );
});

function fixtureCase(name: string): (typeof fixture.cases)[number] {
    const found = fixture.cases.find((item) => item.case === name);
    assert.ok(found);
    return found;
}

function replaceRecord(
    trace: readonly unknown[],
    recordType: string,
    replacement: Readonly<Record<string, unknown>>,
    occurrence = 0,
): readonly unknown[] {
    let selected = 0;
    return trace.map((value) => {
        const record = asRecord(value);
        if (record.record_type !== recordType || selected++ !== occurrence) {
            return value;
        }
        return { ...record, ...replacement };
    });
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
    assert.ok(value !== null && typeof value === "object" && !Array.isArray(value));
    return value as Readonly<Record<string, unknown>>;
}

function expectTraceRejection(
    fixtureItem: (typeof fixture.cases)[number],
    trace: readonly unknown[],
): void {
    assert.throws(
        () =>
            validateTypedEffectTrace({
                completed: fixtureItem.completed,
                programRef: fixtureItem.program_ref,
                trace,
            }),
        TypedEffectTraceValidationError,
    );
}
