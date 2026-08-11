import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { classifyProofEnvelope } from "../../src/index.ts";

const fixture = JSON.parse(
    readFileSync(new URL("../fixtures/typed-effect-reference-v1.json", import.meta.url), "utf8"),
) as {
    readonly cases: readonly {
        readonly case: string;
        readonly completed: boolean;
        readonly program_ref: string;
        readonly trace: readonly unknown[];
    }[];
};

test("completed Core-0 evidence upgrades only with exact lowering and theorem metadata", () => {
    const core0 = fixtureCase("core0-handled-return");
    const reference = classifyProofEnvelope({
        completed: true,
        programRef: core0.program_ref,
        trace: core0.trace,
    });
    const envelope = classifyProofEnvelope({
        completed: true,
        programRef: core0.program_ref,
        proofEvidence: {
            core0h_sidecar: null,
            lowering: {
                assumptions: [
                    "static_source_fragment",
                    "generated_trace_exact",
                    "lean_fragment_assumptions",
                ],
                completed: true,
                generated_trace_ref: reference.trace_ref,
                lowering_ref:
                    "proof-lowering:sha256:c160daf16228e78c4143f82c56eca660125131a942b540a92ecab2ac5ba37c15",
                oracle_case: "core0-handled-return",
                oracle_path: "shepherd/packages/kernel-v3-reference/tests/golden_cases.py",
                oracle_repository: "https://github.com/shepherd-agents/shepherd",
                oracle_revision: "d45074e0099d9ccafeed4a233702ad68ff8a2fa6",
                profile: "core0",
                program_ref: core0.program_ref,
                schema_version: "shepherd.kernel-v3-static-lowering.v1",
                source_ref:
                    "source:sha256:f5552b4da3737e87d158c349dd6c03041c64b2c7c49bb3707a2e2b68438ef42e",
                validator: "shepherd-kernel-v3-reference.static-lowering.v1",
            },
            profile: "core0",
            strength: "semantic_adequacy",
            theorem_artifact: {
                authority: "shepherd-kernel-v3-proof-artifact.v1",
                build_gate: "make verify-proof-envelope-claim",
                extension_theorem_ids: ["vcscore_run_record_sound"],
                metadata_ref:
                    "proof-artifact:sha256:36d1bed0b6e9bc280691d7a27fad334ef7ec44ef45f82bbab62fe720dc837eb2",
                revision: "arxiv:2605.10913v3",
                schema_version: "shepherd.kernel-v3-proof-artifact.v1",
                theorem_ids: [
                    "source_eval_to_machine",
                    "core0_machine_eval_to_source",
                    "coreA_machine_eval_to_source",
                    "core0h_source_eval_to_machine",
                    "trace_monotonic",
                    "core0h_trace_monotonic",
                    "single_child_branch_replay_sound",
                ],
            },
        },
        trace: core0.trace,
    } as never);

    assert.equal(envelope.profile, "core0");
    assert.equal(envelope.strength, "semantic_adequacy");
    assert.equal(envelope.proof_backed, true);
    assert.deepEqual(envelope.theorem_ids, [
        "source_eval_to_machine",
        "core0_machine_eval_to_source",
        "trace_monotonic",
    ]);
});

test("Core-A emits its configured strength while untrusted Core-0H remains reference-only", () => {
    const coreA = fixtureCase("core-a-answer-abort");
    const coreAEnvelope = classifyWithEvidence(coreA, buildEvidence(coreA, "core_a"));
    assert.equal(coreAEnvelope.profile, "core_a");
    assert.equal(coreAEnvelope.strength, "semantic_adequacy");
    assert.equal(coreAEnvelope.proof_backed, true);
    assert.deepEqual(coreAEnvelope.theorem_ids, [
        "source_eval_to_machine",
        "coreA_machine_eval_to_source",
        "trace_monotonic",
    ]);

    const core0h = fixtureCase("core0-one-resume");
    const core0hEnvelope = classifyWithEvidence(core0h, buildEvidence(core0h, "core0h"));
    assertReferenceOnly(core0hEnvelope);
});

test("live prefixes and unsupported strong requests remain reference-validated", () => {
    const core0 = fixtureCase("core0-handled-return");
    const prefixEnvelope = classifyProofEnvelope({
        completed: false,
        programRef: core0.program_ref,
        proofEvidence: buildEvidence(core0, "core0") as never,
        trace: core0.trace.slice(0, 3),
    });
    assertReferenceOnly(prefixEnvelope);

    const extension = buildEvidence(core0, "core0") as Record<string, unknown>;
    extension.profile = "extension";
    extension.strength = "semantic_adequacy";
    const extensionEnvelope = classifyWithEvidence(core0, extension);
    assertReferenceOnly(extensionEnvelope);
});

test("lowering and theorem metadata drift falls back without weakening reference evidence", () => {
    const core0 = fixtureCase("core0-handled-return");
    const mutations: readonly ((evidence: Record<string, unknown>) => void)[] = [
        (evidence) => {
            evidence.extra = true;
        },
        (evidence) => {
            evidence.strength = "forward_simulation";
        },
        (evidence) => {
            evidence.profile = "";
        },
        (evidence) => {
            evidence.core0h_sidecar = {};
        },
        (evidence) => {
            objectAt(evidence, "lowering").completed = false;
        },
        (evidence) => {
            objectAt(evidence, "lowering").profile = "core_a";
        },
        (evidence) => {
            objectAt(evidence, "lowering").program_ref = `${core0.program_ref}0`;
        },
        (evidence) => {
            objectAt(evidence, "lowering").generated_trace_ref = `trace:sha256:${"0".repeat(64)}`;
        },
        (evidence) => {
            objectAt(evidence, "lowering").schema_version = "v2";
        },
        (evidence) => {
            objectAt(evidence, "lowering").validator = "other";
        },
        (evidence) => {
            objectAt(evidence, "lowering").oracle_case = "other";
        },
        (evidence) => {
            objectAt(evidence, "lowering").oracle_path = "other";
        },
        (evidence) => {
            objectAt(evidence, "lowering").oracle_repository = "other";
        },
        (evidence) => {
            objectAt(evidence, "lowering").oracle_revision = "other";
        },
        (evidence) => {
            objectAt(evidence, "lowering").assumptions = ["static_source_fragment"];
        },
        (evidence) => {
            objectAt(evidence, "lowering").source_ref = "source:not-a-digest";
        },
        (evidence) => {
            objectAt(evidence, "lowering").source_ref = "source:sha256:short";
        },
        (evidence) => {
            objectAt(evidence, "lowering").source_ref = `source:sha256:${"g".repeat(64)}`;
        },
        (evidence) => {
            objectAt(evidence, "lowering").lowering_ref = `proof-lowering:sha256:${"0".repeat(64)}`;
        },
        (evidence) => {
            objectAt(evidence, "theorem_artifact").authority = "other";
        },
        (evidence) => {
            objectAt(evidence, "theorem_artifact").build_gate = "other";
        },
        (evidence) => {
            objectAt(evidence, "theorem_artifact").metadata_ref =
                `proof-artifact:sha256:${"0".repeat(64)}`;
        },
        (evidence) => {
            objectAt(evidence, "theorem_artifact").revision = "other";
        },
        (evidence) => {
            objectAt(evidence, "theorem_artifact").schema_version = "v2";
        },
        (evidence) => {
            objectAt(evidence, "theorem_artifact").theorem_ids = ["source_eval_to_machine"];
        },
        (evidence) => {
            objectAt(evidence, "theorem_artifact").theorem_ids = {};
        },
        (evidence) => {
            objectAt(evidence, "theorem_artifact").theorem_ids = [
                "source_eval_to_machine",
                "source_eval_to_machine",
            ];
        },
        (evidence) => {
            objectAt(evidence, "theorem_artifact").extension_theorem_ids = ["other"];
        },
    ];
    for (const mutate of mutations) {
        const evidence = structuredClone(buildEvidence(core0, "core0"));
        mutate(evidence);
        assertReferenceOnly(classifyWithEvidence(core0, evidence));
    }
    for (const malformed of [null, [], Object.create({}), accessorObject()]) {
        assertReferenceOnly(classifyWithEvidence(core0, malformed));
    }
    const untrusted = structuredClone(buildEvidence(core0, "core0"));
    const lowering = objectAt(untrusted, "lowering");
    lowering.source_ref = `source:sha256:${"c".repeat(64)}`;
    const { lowering_ref: _ignored, ...payload } = lowering;
    lowering.lowering_ref = testContentRef("proof-lowering:sha256:", payload);
    assertReferenceOnly(classifyWithEvidence(core0, untrusted));
});

test("strong Core-A admits only one direct abort without resume or closure suffix", () => {
    const cases = [
        fixtureCase("core0-handled-return"),
        fixtureCase("core0-one-resume"),
        fixtureCase("core-a-outer-abort-closes-inner"),
    ];
    for (const item of cases) {
        assertReferenceOnly(classifyWithEvidence(item, buildEvidence(item, "core_a")));
    }
    const abort = fixtureCase("core-a-answer-abort");
    assertReferenceOnly(classifyWithEvidence(abort, buildEvidence(abort, "core0")));

    const nestedAbort = fixtureCase("core-a-outer-abort-closes-inner");
    const traceWithUnrelatedReturnedResume = [
        ...nestedAbort.trace.slice(0, 3),
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
        ...nestedAbort.trace.slice(3),
    ];
    const synthetic = { ...nestedAbort, trace: traceWithUnrelatedReturnedResume };
    assertReferenceOnly(classifyWithEvidence(synthetic, buildEvidence(synthetic, "core_a")));
});

test("Core-0H sidecars fail closed on missing, stale, duplicate, or malformed phase evidence", () => {
    const core0h = fixtureCase("core0-one-resume");
    const mutations: readonly ((evidence: Record<string, unknown>) => void)[] = [
        (evidence) => {
            evidence.core0h_sidecar = null;
        },
        (evidence) => {
            objectAt(evidence, "core0h_sidecar").lowering_ref =
                `proof-lowering:sha256:${"0".repeat(64)}`;
        },
        (evidence) => {
            objectAt(evidence, "core0h_sidecar").program_ref = `${core0h.program_ref}0`;
        },
        (evidence) => {
            objectAt(evidence, "core0h_sidecar").trace_ref = `trace:sha256:${"0".repeat(64)}`;
        },
        (evidence) => {
            objectAt(evidence, "core0h_sidecar").schema_version = "v2";
        },
        (evidence) => {
            objectAt(evidence, "core0h_sidecar").validator = "other";
        },
        (evidence) => {
            objectAt(evidence, "core0h_sidecar").handler_phases = [];
        },
        (evidence) => {
            objectAt(evidence, "core0h_sidecar").handler_phases = {};
        },
        (evidence) => {
            const phases = arrayAt(objectAt(evidence, "core0h_sidecar"), "handler_phases");
            phases.push(structuredClone(phases[0]));
        },
        (evidence) => {
            const phase = objectAt(
                arrayAt(objectAt(evidence, "core0h_sidecar"), "handler_phases")[0],
            );
            phase.phase_two_ref = phase.phase_one_ref;
        },
        (evidence) => {
            const phase = objectAt(
                arrayAt(objectAt(evidence, "core0h_sidecar"), "handler_phases")[0],
            );
            phase.handler_ref = "handler:not-a-digest";
        },
        (evidence) => {
            const phase = objectAt(
                arrayAt(objectAt(evidence, "core0h_sidecar"), "handler_phases")[0],
            );
            phase.extra = true;
        },
        (evidence) => {
            objectAt(evidence, "core0h_sidecar").sidecar_ref =
                `core0h-sidecar:sha256:${"0".repeat(64)}`;
        },
    ];
    for (const mutate of mutations) {
        const evidence = structuredClone(buildEvidence(core0h, "core0h"));
        mutate(evidence);
        assertReferenceOnly(classifyWithEvidence(core0h, evidence));
    }
});

function fixtureCase(name: string): (typeof fixture.cases)[number] {
    const found = fixture.cases.find((item) => item.case === name);
    assert.ok(found);
    return found;
}

const THEOREM_ARTIFACT = {
    authority: "shepherd-kernel-v3-proof-artifact.v1",
    build_gate: "make verify-proof-envelope-claim",
    extension_theorem_ids: ["vcscore_run_record_sound"],
    metadata_ref:
        "proof-artifact:sha256:36d1bed0b6e9bc280691d7a27fad334ef7ec44ef45f82bbab62fe720dc837eb2",
    revision: "arxiv:2605.10913v3",
    schema_version: "shepherd.kernel-v3-proof-artifact.v1",
    theorem_ids: [
        "source_eval_to_machine",
        "core0_machine_eval_to_source",
        "coreA_machine_eval_to_source",
        "core0h_source_eval_to_machine",
        "trace_monotonic",
        "core0h_trace_monotonic",
        "single_child_branch_replay_sound",
    ],
} as const;

function buildEvidence(
    item: (typeof fixture.cases)[number],
    profile: "core0" | "core_a" | "core0h",
): Record<string, unknown> {
    const reference = classifyProofEnvelope({
        completed: true,
        programRef: item.program_ref,
        trace: item.trace,
    });
    assert.ok(reference.trace_ref);
    const oracle = {
        oracle_case: item.case,
        oracle_path: "shepherd/packages/kernel-v3-reference/tests/golden_cases.py",
        oracle_repository: "https://github.com/shepherd-agents/shepherd",
        oracle_revision: "d45074e0099d9ccafeed4a233702ad68ff8a2fa6",
    };
    const sourceRef = testContentRef("source:sha256:", oracle);
    const assumptions =
        profile === "core0"
            ? ["static_source_fragment", "generated_trace_exact", "lean_fragment_assumptions"]
            : profile === "core_a"
              ? [
                    "static_source_fragment",
                    "generated_trace_exact",
                    "lean_fragment_assumptions",
                    "single_direct_abort_capture",
                ]
              : [
                    "static_source_fragment",
                    "generated_trace_exact",
                    "lean_fragment_assumptions",
                    "deterministic_two_phase_handlers",
                ];
    const loweringPayload = {
        assumptions,
        completed: true,
        generated_trace_ref: reference.trace_ref,
        ...oracle,
        profile,
        program_ref: item.program_ref,
        schema_version: "shepherd.kernel-v3-static-lowering.v1",
        source_ref: sourceRef,
        validator: "shepherd-kernel-v3-reference.static-lowering.v1",
    };
    const loweringRef = testContentRef("proof-lowering:sha256:", loweringPayload);
    const sidecarPayload = {
        handler_phases: [
            {
                handler_ref: `handler:sha256:${"d".repeat(64)}`,
                phase_one_ref: `handler-phase:sha256:${"e".repeat(64)}`,
                phase_two_ref: `handler-phase:sha256:${"f".repeat(64)}`,
            },
        ],
        lowering_ref: loweringRef,
        program_ref: item.program_ref,
        schema_version: "shepherd.kernel-v3-core0h-sidecar.v1",
        trace_ref: reference.trace_ref,
        validator: "shepherd-kernel-v3-reference.core0h-sidecar.v1",
    };
    return {
        core0h_sidecar:
            profile === "core0h"
                ? {
                      ...sidecarPayload,
                      sidecar_ref: testContentRef("core0h-sidecar:sha256:", sidecarPayload),
                  }
                : null,
        lowering: { ...loweringPayload, lowering_ref: loweringRef },
        profile,
        strength: profile === "core0h" ? "forward_simulation" : "semantic_adequacy",
        theorem_artifact: structuredClone(THEOREM_ARTIFACT),
    };
}

function classifyWithEvidence(
    item: (typeof fixture.cases)[number],
    proofEvidence: unknown,
): ReturnType<typeof classifyProofEnvelope> {
    return classifyProofEnvelope({
        completed: true,
        programRef: item.program_ref,
        proofEvidence: proofEvidence as never,
        trace: item.trace,
    });
}

function assertReferenceOnly(envelope: ReturnType<typeof classifyProofEnvelope>): void {
    assert.equal(envelope.profile, "reference_core_a");
    assert.equal(envelope.strength, "reference_validated");
    assert.equal(envelope.reference_validated, true);
    assert.equal(envelope.proof_backed, false);
    assert.deepEqual(envelope.theorem_ids, []);
}

function testContentRef(prefix: string, value: unknown): string {
    return `${prefix}${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function objectAt(
    objectOrValue: Record<string, unknown> | unknown,
    key?: string,
): Record<string, unknown> {
    const value =
        key === undefined ? objectOrValue : (objectOrValue as Record<string, unknown>)[key];
    assert.ok(value !== null && typeof value === "object" && !Array.isArray(value));
    return value as Record<string, unknown>;
}

function arrayAt(object: Record<string, unknown>, key: string): unknown[] {
    const value = object[key];
    assert.ok(Array.isArray(value));
    return value;
}

function accessorObject(): object {
    return Object.defineProperty({}, "profile", {
        enumerable: true,
        get: () => "core0",
    });
}
